import { realtimeClient } from './ws-client';

const RTC_CONFIG: RTCConfiguration = {
  iceServers: [
    { urls: 'stun:stun.l.google.com:19302' },
    { urls: 'stun:stun1.l.google.com:19302' },
    { urls: 'stun:stun2.l.google.com:19302' },
  ],
};

export class WebRtcMeshManager {
  private roomId: string;
  private myUserId: string;
  private localStream: MediaStream | null = null;
  private peerConnections = new Map<string, RTCPeerConnection>();
  private onRemoteStreamCallbacks = new Set<(peerId: string, stream: MediaStream) => void>();
  private onPeerLeftCallbacks = new Set<(peerId: string) => void>();
  private unsubSignal: (() => void) | null = null;

  constructor(roomId: string, myUserId: string) {
    this.roomId = roomId;
    this.myUserId = myUserId;
  }

  async initLocalStream(enableCam = true, enableMic = true): Promise<MediaStream | null> {
    try {
      this.localStream = await navigator.mediaDevices.getUserMedia({
        video: enableCam,
        audio: enableMic,
      });
    } catch (err) {
      console.warn('Could not acquire both video and audio, trying audio only...', err);
      try {
        this.localStream = await navigator.mediaDevices.getUserMedia({
          video: false,
          audio: enableMic,
        });
      } catch (audioErr) {
        console.warn('Could not acquire audio either, running in listen-only mode', audioErr);
        this.localStream = new MediaStream();
      }
    }

    this.bindSignaling();
    return this.localStream;
  }

  getLocalStream(): MediaStream | null {
    return this.localStream;
  }

  toggleCamera(enabled: boolean): boolean {
    if (!this.localStream) return false;
    const videoTrack = this.localStream.getVideoTracks()[0];
    if (videoTrack) {
      videoTrack.enabled = enabled;
      return videoTrack.enabled;
    }
    return false;
  }

  toggleMicrophone(enabled: boolean): boolean {
    if (!this.localStream) return false;
    const audioTrack = this.localStream.getAudioTracks()[0];
    if (audioTrack) {
      audioTrack.enabled = enabled;
      return audioTrack.enabled;
    }
    return false;
  }

  onRemoteStream(callback: (peerId: string, stream: MediaStream) => void): () => void {
    this.onRemoteStreamCallbacks.add(callback);
    return () => this.onRemoteStreamCallbacks.delete(callback);
  }

  onPeerLeft(callback: (peerId: string) => void): () => void {
    this.onPeerLeftCallbacks.add(callback);
    return () => this.onPeerLeftCallbacks.delete(callback);
  }

  /**
   * Gọi khi có một peer mới tham gia phòng (hoặc từ danh sách peers có sẵn)
   */
  async initiatePeerConnection(targetUserId: string): Promise<void> {
    if (this.peerConnections.has(targetUserId) || targetUserId === this.myUserId) {
      return;
    }

    const pc = this.createPeerConnection(targetUserId);
    this.peerConnections.set(targetUserId, pc);

    // Người có ID lớn hơn sẽ đóng vai trò là bên chủ động gửi Offer để tránh xung đột
    if (this.myUserId > targetUserId) {
      try {
        const offer = await pc.createOffer();
        await pc.setLocalDescription(offer);
        this.sendSignal(targetUserId, { type: 'offer', sdp: offer.sdp });
      } catch (err) {
        console.error('Failed to create offer for peer', targetUserId, err);
      }
    }
  }

  private createPeerConnection(targetUserId: string): RTCPeerConnection {
    const pc = new RTCPeerConnection(RTC_CONFIG);

    if (this.localStream) {
      for (const track of this.localStream.getTracks()) {
        pc.addTrack(track, this.localStream);
      }
    }

    pc.onicecandidate = (event) => {
      if (event.candidate) {
        this.sendSignal(targetUserId, {
          type: 'candidate',
          candidate: event.candidate,
        });
      }
    };

    pc.ontrack = (event) => {
      const remoteStream = event.streams[0] || new MediaStream([event.track]);
      for (const cb of this.onRemoteStreamCallbacks) {
        cb(targetUserId, remoteStream);
      }
    };

    pc.onconnectionstatechange = () => {
      if (['disconnected', 'failed', 'closed'].includes(pc.connectionState)) {
        this.closePeer(targetUserId);
      }
    };

    return pc;
  }

  private bindSignaling(): void {
    this.unsubSignal = realtimeClient.on(
      'webrtc:signal',
      async (payload: { senderUserId: string; signal: any }) => {
        const { senderUserId, signal } = payload;
        if (!senderUserId || !signal) return;

        let pc = this.peerConnections.get(senderUserId);
        if (!pc) {
          pc = this.createPeerConnection(senderUserId);
          this.peerConnections.set(senderUserId, pc);
        }

        try {
          if (signal.type === 'offer') {
            await pc.setRemoteDescription(new RTCSessionDescription({ type: 'offer', sdp: signal.sdp }));
            const answer = await pc.createAnswer();
            await pc.setLocalDescription(answer);
            this.sendSignal(senderUserId, { type: 'answer', sdp: answer.sdp });
          } else if (signal.type === 'answer') {
            await pc.setRemoteDescription(new RTCSessionDescription({ type: 'answer', sdp: signal.sdp }));
          } else if (signal.type === 'candidate' && signal.candidate) {
            await pc.addIceCandidate(new RTCIceCandidate(signal.candidate));
          }
        } catch (err) {
          console.error('Error handling WebRTC signal from', senderUserId, err);
        }
      }
    );
  }

  private sendSignal(targetUserId: string, signal: any): void {
    realtimeClient.send('webrtc:signal', {
      roomId: this.roomId,
      targetUserId,
      signal,
    });
  }

  closePeer(peerId: string): void {
    const pc = this.peerConnections.get(peerId);
    if (pc) {
      pc.close();
      this.peerConnections.delete(peerId);
    }
    for (const cb of this.onPeerLeftCallbacks) {
      cb(peerId);
    }
  }

  destroy(): void {
    if (this.unsubSignal) {
      this.unsubSignal();
      this.unsubSignal = null;
    }

    for (const [peerId, pc] of this.peerConnections.entries()) {
      pc.close();
    }
    this.peerConnections.clear();

    if (this.localStream) {
      for (const track of this.localStream.getTracks()) {
        track.stop();
      }
      this.localStream = null;
    }
  }
}
