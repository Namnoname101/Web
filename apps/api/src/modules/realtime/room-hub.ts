export interface PeerSocket {
  send(data: string): void;
  readyState: number;
}

export interface Peer {
  userId: string;
  name: string;
  studentId: string | null;
  socket: PeerSocket;
  isCamOn: boolean;
  isMicOn: boolean;
  currentTask?: string | null;
}

export interface PublicPeerInfo {
  userId: string;
  name: string;
  studentId: string | null;
  isCamOn: boolean;
  isMicOn: boolean;
  currentTask?: string | null;
}

function toPublicPeer(peer: Peer): PublicPeerInfo {
  return {
    userId: peer.userId,
    name: peer.name,
    studentId: peer.studentId,
    isCamOn: peer.isCamOn,
    isMicOn: peer.isMicOn,
    currentTask: peer.currentTask,
  };
}

export class RoomHub {
  private rooms = new Map<string, Map<string, Peer>>();
  private userSockets = new Map<string, Set<PeerSocket>>();

  /**
   * Đăng ký socket gắn liền với người dùng để nhận tin nhắn trực tiếp và lời mời.
   */
  registerUserSocket(userId: string, socket: PeerSocket): void {
    let sockets = this.userSockets.get(userId);
    if (!sockets) {
      sockets = new Set();
      this.userSockets.set(userId, sockets);
    }
    sockets.add(socket);
  }

  /**
   * Hủy socket của người dùng khi ngắt kết nối.
   */
  unregisterUserSocket(userId: string, socket: PeerSocket): void {
    const sockets = this.userSockets.get(userId);
    if (sockets) {
      sockets.delete(socket);
      if (sockets.size === 0) {
        this.userSockets.delete(userId);
      }
    }
  }

  /**
   * Gửi sự kiện trực tiếp tới tất cả socket đang mở của 1 user.
   */
  sendToUser(userId: string, event: string, payload: any): void {
    const sockets = this.userSockets.get(userId);
    if (!sockets) return;

    const data = JSON.stringify({ event, payload });
    for (const ws of sockets) {
      if (ws.readyState === 1) { // OPEN
        try {
          ws.send(data);
        } catch {
          // Ignore write failure on stale socket
        }
      }
    }
  }

  /**
   * Thêm một peer vào phòng học trực tuyến.
   * Gửi danh sách các peer hiện có cho peer mới, và thông báo cho các peer cũ trong phòng.
   */
  addPeer(roomId: string, peer: Peer): void {
    let room = this.rooms.get(roomId);
    if (!room) {
      room = new Map();
      this.rooms.set(roomId, room);
    }

    const existingPeers: PublicPeerInfo[] = [];
    for (const [id, existing] of room.entries()) {
      if (id !== peer.userId) {
        existingPeers.push(toPublicPeer(existing));
      }
    }

    // Gửi danh sách các peer đang có trong phòng cho peer mới
    if (peer.socket.readyState === 1) {
      peer.socket.send(
        JSON.stringify({
          event: 'room:peers',
          payload: { peers: existingPeers },
        })
      );
    }

    // Thông báo cho tất cả peer khác trong phòng rằng có người mới vào
    this.broadcastRoom(
      roomId,
      'room:peer_joined',
      toPublicPeer(peer),
      peer.userId
    );

    room.set(peer.userId, peer);
  }

  /**
   * Rời phòng học và thông báo cho những người còn lại.
   */
  removePeer(roomId: string, userId: string): void {
    const room = this.rooms.get(roomId);
    if (!room) return;

    if (room.delete(userId)) {
      this.broadcastRoom(roomId, 'room:peer_left', { userId });
      if (room.size === 0) {
        this.rooms.delete(roomId);
      }
    }
  }

  /**
   * Lấy danh sách peer trong một phòng.
   */
  getRoomPeers(roomId: string): Peer[] {
    const room = this.rooms.get(roomId);
    if (!room) return [];
    return Array.from(room.values());
  }

  /**
   * Chuyển tiếp tín hiệu WebRTC (SDP offer/answer, ICE candidates) tới đúng đích người nhận.
   */
  forwardSignal(roomId: string, senderUserId: string, targetUserId: string, signal: any): void {
    const room = this.rooms.get(roomId);
    if (!room) return;

    const targetPeer = room.get(targetUserId);
    if (targetPeer && targetPeer.socket.readyState === 1) {
      targetPeer.socket.send(
        JSON.stringify({
          event: 'webrtc:signal',
          payload: {
            senderUserId,
            signal,
          },
        })
      );
    }
  }

  /**
   * Cập nhật trạng thái Camera/Mic của một peer và phát thông báo tới phòng.
   */
  updateMedia(roomId: string, userId: string, media: { isCamOn?: boolean; isMicOn?: boolean }): void {
    const room = this.rooms.get(roomId);
    if (!room) return;

    const peer = room.get(userId);
    if (!peer) return;

    if (typeof media.isCamOn === 'boolean') peer.isCamOn = media.isCamOn;
    if (typeof media.isMicOn === 'boolean') peer.isMicOn = media.isMicOn;

    this.broadcastRoom(roomId, 'media:updated', {
      userId,
      isCamOn: peer.isCamOn,
      isMicOn: peer.isMicOn,
    });
  }

  /**
   * Cập nhật mục tiêu / task đang làm của peer.
   */
  updateTask(roomId: string, userId: string, currentTask: string): void {
    const room = this.rooms.get(roomId);
    if (!room) return;

    const peer = room.get(userId);
    if (!peer) return;

    peer.currentTask = currentTask;

    this.broadcastRoom(roomId, 'task:updated', {
      userId,
      currentTask,
    });
  }

  /**
   * Gửi tin nhắn phát thanh (broadcast) tới toàn bộ peer trong phòng, có thể bỏ qua 1 user.
   */
  broadcastRoom(roomId: string, event: string, payload: any, excludeUserId?: string): void {
    const room = this.rooms.get(roomId);
    if (!room) return;

    const data = JSON.stringify({ event, payload });
    for (const [id, peer] of room.entries()) {
      if (id !== excludeUserId && peer.socket.readyState === 1) {
        try {
          peer.socket.send(data);
        } catch {
          // Socket error handled on close
        }
      }
    }
  }
}

export const globalRoomHub = new RoomHub();
