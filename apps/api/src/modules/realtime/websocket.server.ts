import type { Server as HttpServer, IncomingMessage } from 'node:http';
import { WebSocketServer, WebSocket } from 'ws';
import { getPrismaClient } from '@personal-schedule/database';
import { hash } from '../../lib/crypto.js';
import { SESSION_COOKIE } from '../auth/session.js';
import { globalRoomHub, type Peer } from './room-hub.js';
import { joinStudyRoom, leaveStudyRoom } from '../study-rooms/study-rooms.service.js';
import { sendDirectMessage } from '../chat/chat.service.js';

function parseCookie(cookieHeader: string | undefined, name: string): string | undefined {
  if (!cookieHeader) return undefined;
  const value = cookieHeader
    .split(';')
    .map(x => x.trim())
    .find(x => x.startsWith(`${name}=`))
    ?.slice(name.length + 1);
  try {
    return value ? decodeURIComponent(value) : undefined;
  } catch {
    return undefined;
  }
}

export function setupWebSocketServer(httpServer: HttpServer): WebSocketServer {
  const wss = new WebSocketServer({ noServer: true });

  httpServer.on('upgrade', async (req: IncomingMessage, socket, head) => {
    // Only accept connections on /ws or /api/v1/ws
    const url = new URL(req.url || '/', `http://${req.headers.host || 'localhost'}`);
    if (url.pathname !== '/ws' && url.pathname !== '/api/v1/ws') {
      socket.write('HTTP/1.1 404 Not Found\r\n\r\n');
      socket.destroy();
      return;
    }

    const token = parseCookie(req.headers.cookie, SESSION_COOKIE);
    if (!token) {
      socket.write('HTTP/1.1 401 Unauthorized\r\n\r\n');
      socket.destroy();
      return;
    }

    try {
      const session = await getPrismaClient().session.findUnique({
        where: { tokenHash: hash(token) },
        include: { user: true },
      });

      if (!session || +session.expiresAt <= Date.now()) {
        socket.write('HTTP/1.1 401 Unauthorized\r\n\r\n');
        socket.destroy();
        return;
      }

      wss.handleUpgrade(req, socket, head, (ws) => {
        wss.emit('connection', ws, req, session.user);
      });
    } catch {
      socket.write('HTTP/1.1 500 Internal Server Error\r\n\r\n');
      socket.destroy();
    }
  });

  wss.on('connection', (ws: WebSocket, _req: IncomingMessage, user: any) => {
    if (!user) {
      ws.close(4001, 'Unauthorized');
      return;
    }

    // Register user socket for direct messages and invites
    globalRoomHub.registerUserSocket(user.id, ws);

    // Track active room for cleanup on disconnect
    let currentRoomId: string | null = null;

    ws.on('message', async (raw) => {
      try {
        const text = raw.toString();
        const { event, payload } = JSON.parse(text);

        switch (event) {
          case 'room:join': {
            const { roomId, passcode, currentTask } = payload;
            try {
              // Ensure participation in DB
              const result = await joinStudyRoom(user.id, roomId, passcode, currentTask);
              currentRoomId = roomId;

              const peer: Peer = {
                userId: user.id,
                name: user.name,
                studentId: user.studentId,
                socket: ws,
                isCamOn: result.participant.isCamOn,
                isMicOn: result.participant.isMicOn,
                currentTask: result.participant.currentTask,
              };

              globalRoomHub.addPeer(roomId, peer);

              // Send initial room & pomodoro state
              ws.send(JSON.stringify({
                event: 'room:joined',
                payload: {
                  room: result.room,
                  participant: result.participant,
                },
              }));
            } catch (err: any) {
              ws.send(JSON.stringify({
                event: 'room:error',
                payload: { message: err?.message || 'Không thể tham gia phòng' },
              }));
            }
            break;
          }

          case 'room:leave': {
            if (currentRoomId) {
              globalRoomHub.removePeer(currentRoomId, user.id);
              await leaveStudyRoom(user.id, currentRoomId);
              currentRoomId = null;
            }
            break;
          }

          case 'webrtc:signal': {
            const { roomId, targetUserId, signal } = payload;
            if (roomId && targetUserId && signal) {
              globalRoomHub.forwardSignal(roomId, user.id, targetUserId, signal);
            }
            break;
          }

          case 'media:toggle': {
            const { roomId, isCamOn, isMicOn } = payload;
            if (roomId) {
              globalRoomHub.updateMedia(roomId, user.id, { isCamOn, isMicOn });
              await getPrismaClient().studyRoomParticipant.updateMany({
                where: { roomId, userId: user.id },
                data: {
                  ...(typeof isCamOn === 'boolean' ? { isCamOn } : {}),
                  ...(typeof isMicOn === 'boolean' ? { isMicOn } : {}),
                },
              });
            }
            break;
          }

          case 'task:update': {
            const { roomId, currentTask } = payload;
            if (roomId && typeof currentTask === 'string') {
              globalRoomHub.updateTask(roomId, user.id, currentTask);
              await getPrismaClient().studyRoomParticipant.updateMany({
                where: { roomId, userId: user.id },
                data: { currentTask },
              });
            }
            break;
          }

          case 'chat:room_send': {
            const { roomId, content } = payload;
            const trimmed = (content || '').trim();
            if (roomId && trimmed) {
              const msg = await getPrismaClient().roomChatMessage.create({
                data: {
                  roomId,
                  senderId: user.id,
                  content: trimmed,
                },
              });

              globalRoomHub.broadcastRoom(roomId, 'chat:room_received', {
                id: msg.id,
                roomId,
                senderId: user.id,
                senderName: user.name,
                content: trimmed,
                createdAt: msg.createdAt,
              });
            }
            break;
          }

          case 'pomodoro:action': {
            const { roomId, action } = payload;
            if (!roomId) break;

            const room = await getPrismaClient().studyRoom.findUnique({ where: { id: roomId } });
            if (!room || room.hostId !== user.id) {
              ws.send(JSON.stringify({
                event: 'room:error',
                payload: { message: 'Chỉ Host mới có quyền điều khiển Pomodoro' },
              }));
              break;
            }

            let newState: 'IDLE' | 'FOCUS' | 'BREAK' = room.pomodoroState;
            let timerEndsAt: Date | null = room.timerEndsAt;

            const now = Date.now();

            if (action === 'start_focus') {
              newState = 'FOCUS';
              timerEndsAt = new Date(now + room.focusMinutes * 60 * 1000);
            } else if (action === 'start_break') {
              newState = 'BREAK';
              timerEndsAt = new Date(now + room.breakMinutes * 60 * 1000);
            } else if (action === 'reset' || action === 'stop') {
              newState = 'IDLE';
              timerEndsAt = null;
            }

            await getPrismaClient().studyRoom.update({
              where: { id: roomId },
              data: {
                pomodoroState: newState,
                timerEndsAt,
              },
            });

            globalRoomHub.broadcastRoom(roomId, 'pomodoro:sync', {
              pomodoroState: newState,
              timerEndsAt,
            });
            break;
          }

          case 'chat:direct_send': {
            const { conversationId, content } = payload;
            if (conversationId && content) {
              const msg = await sendDirectMessage(user.id, conversationId, content);

              const conv = await getPrismaClient().directConversation.findUnique({
                where: { id: conversationId },
              });

              if (conv) {
                const targetUserId = conv.user1Id === user.id ? conv.user2Id : conv.user1Id;
                globalRoomHub.sendToUser(targetUserId, 'chat:direct_received', {
                  conversationId,
                  message: msg,
                });
              }

              ws.send(JSON.stringify({
                event: 'chat:direct_sent',
                payload: { message: msg },
              }));
            }
            break;
          }
        }
      } catch (err: any) {
        console.error('WS message handling error', err);
      }
    });

    ws.on('close', async () => {
      globalRoomHub.unregisterUserSocket(user.id, ws);
      if (currentRoomId) {
        globalRoomHub.removePeer(currentRoomId, user.id);
        try {
          await leaveStudyRoom(user.id, currentRoomId);
        } catch {
          // Ignore error during cleanup
        }
      }
    });
  });

  return wss;
}
