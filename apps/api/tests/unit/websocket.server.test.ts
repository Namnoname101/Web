import { describe, expect, it, vi, beforeEach } from 'vitest';
import { RoomHub, type Peer } from '../../src/modules/realtime/room-hub.js';

describe('RoomHub (Realtime Signaling & Presence)', () => {
  let hub: RoomHub;

  const createMockSocket = () => ({
    send: vi.fn(),
    readyState: 1, // WebSocket.OPEN
    close: vi.fn(),
  });

  beforeEach(() => {
    hub = new RoomHub();
  });

  it('adds peer to room and notifies existing peers', () => {
    const ws1 = createMockSocket() as any;
    const ws2 = createMockSocket() as any;

    const peer1: Peer = {
      userId: 'user-1',
      name: 'Nguyen Van A',
      studentId: '111',
      socket: ws1,
      isCamOn: false,
      isMicOn: false,
      currentTask: 'Lam bai tap',
    };

    const peer2: Peer = {
      userId: 'user-2',
      name: 'Tran Thi B',
      studentId: '222',
      socket: ws2,
      isCamOn: true,
      isMicOn: true,
      currentTask: 'Doc sach',
    };

    hub.addPeer('room-1', peer1);
    expect(hub.getRoomPeers('room-1')).toHaveLength(1);

    // Peer 2 joins
    hub.addPeer('room-1', peer2);
    expect(hub.getRoomPeers('room-1')).toHaveLength(2);

    // ws1 should receive peer_joined notification for peer2
    expect(ws1.send).toHaveBeenCalledWith(
      JSON.stringify({
        event: 'room:peer_joined',
        payload: {
          userId: 'user-2',
          name: 'Tran Thi B',
          studentId: '222',
          isCamOn: true,
          isMicOn: true,
          currentTask: 'Doc sach',
        },
      })
    );

    // ws2 should receive the list of existing peers (peer1)
    expect(ws2.send).toHaveBeenCalledWith(
      JSON.stringify({
        event: 'room:peers',
        payload: {
          peers: [
            {
              userId: 'user-1',
              name: 'Nguyen Van A',
              studentId: '111',
              isCamOn: false,
              isMicOn: false,
              currentTask: 'Lam bai tap',
            },
          ],
        },
      })
    );
  });

  it('removes peer and notifies remaining peers', () => {
    const ws1 = createMockSocket() as any;
    const ws2 = createMockSocket() as any;

    const peer1: Peer = {
      userId: 'user-1',
      name: 'A',
      studentId: '111',
      socket: ws1,
      isCamOn: false,
      isMicOn: false,
    };
    const peer2: Peer = {
      userId: 'user-2',
      name: 'B',
      studentId: '222',
      socket: ws2,
      isCamOn: false,
      isMicOn: false,
    };

    hub.addPeer('room-1', peer1);
    hub.addPeer('room-1', peer2);

    hub.removePeer('room-1', 'user-2');
    expect(hub.getRoomPeers('room-1')).toHaveLength(1);

    expect(ws1.send).toHaveBeenCalledWith(
      JSON.stringify({
        event: 'room:peer_left',
        payload: { userId: 'user-2' },
      })
    );
  });

  it('forwards WebRTC signal exclusively to the target peer', () => {
    const ws1 = createMockSocket() as any;
    const ws2 = createMockSocket() as any;
    const ws3 = createMockSocket() as any;

    hub.addPeer('room-1', { userId: 'u1', name: '1', studentId: '1', socket: ws1, isCamOn: false, isMicOn: false });
    hub.addPeer('room-1', { userId: 'u2', name: '2', studentId: '2', socket: ws2, isCamOn: false, isMicOn: false });
    hub.addPeer('room-1', { userId: 'u3', name: '3', studentId: '3', socket: ws3, isCamOn: false, isMicOn: false });

    const signalData = { type: 'offer', sdp: 'mock-sdp-data' };
    hub.forwardSignal('room-1', 'u1', 'u2', signalData);

    expect(ws2.send).toHaveBeenCalledWith(
      JSON.stringify({
        event: 'webrtc:signal',
        payload: {
          senderUserId: 'u1',
          signal: signalData,
        },
      })
    );
    // ws3 should NOT receive u1's signal to u2
    expect(ws3.send).not.toHaveBeenCalledWith(expect.stringContaining('webrtc:signal'));
  });

  it('broadcasts media update to room members', () => {
    const ws1 = createMockSocket() as any;
    const ws2 = createMockSocket() as any;

    hub.addPeer('room-1', { userId: 'u1', name: '1', studentId: '1', socket: ws1, isCamOn: false, isMicOn: false });
    hub.addPeer('room-1', { userId: 'u2', name: '2', studentId: '2', socket: ws2, isCamOn: false, isMicOn: false });

    hub.updateMedia('room-1', 'u1', { isCamOn: true, isMicOn: false });

    const expectedPayload = JSON.stringify({
      event: 'media:updated',
      payload: {
        userId: 'u1',
        isCamOn: true,
        isMicOn: false,
      },
    });

    expect(ws1.send).toHaveBeenCalledWith(expectedPayload);
    expect(ws2.send).toHaveBeenCalledWith(expectedPayload);
  });

  it('tracks user sockets for direct notifications across rooms', () => {
    const wsUser1 = createMockSocket() as any;
    hub.registerUserSocket('u1', wsUser1);

    hub.sendToUser('u1', 'chat:direct_received', {
      conversationId: 'conv-1',
      message: { id: 'm1', content: 'Xin chao' },
    });

    expect(wsUser1.send).toHaveBeenCalledWith(
      JSON.stringify({
        event: 'chat:direct_received',
        payload: {
          conversationId: 'conv-1',
          message: { id: 'm1', content: 'Xin chao' },
        },
      })
    );

    hub.unregisterUserSocket('u1', wsUser1);
    hub.sendToUser('u1', 'chat:direct_received', { conversationId: 'conv-1', message: {} });
    // After unregistering, socket should receive no more messages
    expect(wsUser1.send).toHaveBeenCalledTimes(1);
  });
});
