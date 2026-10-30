import { useState, useEffect, useRef, useCallback } from 'react';
import {
  Users,
  Video,
  VideoOff,
  Mic,
  MicOff,
  CloudRain,
  Send,
  Plus,
  Lock,
  DoorOpen,
  LogOut,
  Play,
  Coffee,
  RotateCcw,
  UserPlus,
  MessageSquare,
  Sparkles,
  Edit2,
  Check,
  X,
} from 'lucide-react';
import { Spinner, type Translate } from './components';
import { realtimeClient } from './lib/ws-client';
import { WebRtcMeshManager } from './lib/webrtc';
import { playBellSound, ambientSound } from './lib/audio-effects';
import type { User, Locale, StudyRoomSummary, StudyRoomInvite } from './types';
import './study-room.css';

interface StudyRoomsPageProps {
  user: User;
  locale: Locale;
  t: Translate;
}

export function StudyRoomsPage({ user, locale, t }: StudyRoomsPageProps) {
  const [rooms, setRooms] = useState<StudyRoomSummary[]>([]);
  const [invites, setInvites] = useState<StudyRoomInvite[]>([]);
  const [activeRoomId, setActiveRoomId] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [createModal, setCreateModal] = useState(false);
  const [passcodeModal, setPasscodeModal] = useState<{ roomId: string; title: string } | null>(null);
  const [passcodeAttempt, setPasscodeAttempt] = useState('');
  const [joinError, setJoinError] = useState('');

  // Form tạo phòng
  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [passcode, setPasscode] = useState('');
  const [maxParticipants, setMaxParticipants] = useState(6);
  const [focusMinutes, setFocusMinutes] = useState(25);
  const [breakMinutes, setBreakMinutes] = useState(5);
  const [creating, setCreating] = useState(false);

  const loadData = useCallback(async () => {
    try {
      const [roomsRes, invitesRes] = await Promise.all([
        fetch('/api/v1/study-rooms'),
        fetch('/api/v1/study-rooms/invites/my'),
      ]);

      if (roomsRes.ok) {
        setRooms(await roomsRes.json());
      }
      if (invitesRes.ok) {
        setInvites(await invitesRes.json());
      }
    } catch (e) {
      console.error('Lỗi tải danh sách phòng', e);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    loadData();
    const interval = setInterval(loadData, 15000);
    return () => clearInterval(interval);
  }, [loadData]);

  // Tạo phòng mới
  const handleCreateRoom = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!title.trim() || creating) return;

    setCreating(true);
    try {
      const res = await fetch('/api/v1/study-rooms', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          title: title.trim(),
          description: description.trim() || undefined,
          passcode: passcode.trim() || undefined,
          maxParticipants: Number(maxParticipants),
          focusMinutes: Number(focusMinutes),
          breakMinutes: Number(breakMinutes),
        }),
      });

      if (res.ok) {
        const created = await res.json();
        setCreateModal(false);
        setTitle('');
        setDescription('');
        setPasscode('');
        setActiveRoomId(created.id);
      }
    } catch (err) {
      console.error('Lỗi tạo phòng', err);
    } finally {
      setCreating(false);
    }
  };

  const handleJoinClick = (room: StudyRoomSummary) => {
    if (room.hasPasscode) {
      setPasscodeModal({ roomId: room.id, title: room.title });
      setPasscodeAttempt('');
      setJoinError('');
    } else {
      setActiveRoomId(room.id);
    }
  };

  const submitPasscodeJoin = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!passcodeModal) return;

    try {
      const res = await fetch(`/api/v1/study-rooms/${passcodeModal.roomId}/join`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ passcode: passcodeAttempt.trim() }),
      });

      if (res.ok) {
        setActiveRoomId(passcodeModal.roomId);
        setPasscodeModal(null);
      } else {
        const err = await res.json();
        setJoinError(err.error?.message || t('Mật khẩu không chính xác', 'Incorrect passcode'));
      }
    } catch {
      setJoinError(t('Lỗi khi tham gia phòng', 'Error joining room'));
    }
  };

  if (activeRoomId) {
    return (
      <StudyRoomFocus
        roomId={activeRoomId}
        user={user}
        locale={locale}
        t={t}
        onLeave={() => {
          setActiveRoomId(null);
          loadData();
        }}
      />
    );
  }

  return (
    <div className="study-rooms-lobby">
      {/* Hero Banner */}
      <section className="study-hero">
        <div className="study-hero-copy">
          <span className="eyebrow" style={{ color: '#93c5fd', marginBottom: '6px' }}>
            {t('PHÒNG HỌC ẢO SINH VIÊN UED · STUDY WITH ME', 'UED VIRTUAL STUDY ROOM · STUDY WITH ME')}
          </span>
          <h1>{t('Cùng học, cùng tập trung.', 'Study Together, Focus Deeply.')}</h1>
          <p>
            {t(
              'Tạo phòng tự học nhóm online, bật đồng hồ Pomodoro đồng bộ và chia sẻ camera/mic P2P bảo mật để giữ nhịp học tập năng suất.',
              'Create virtual study rooms with synced Pomodoro timers and peer-to-peer video/audio to stay accountable.'
            )}
          </p>
        </div>
        <div className="study-hero-actions">
          <button
            className="button study-hero-btn"
            onClick={() => setCreateModal(true)}
          >
            <Plus size={18} />
            {t('Tạo phòng học mới', 'Create New Room')}
          </button>
        </div>
      </section>

      {/* Lời mời vào phòng (nếu có) */}
      {invites.length > 0 && (
        <section className="panel" style={{ padding: '16px 20px', background: '#eff6ff', borderColor: '#bfdbfe' }}>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '12px' }}>
            <div>
              <strong style={{ color: '#1d4ed8' }}>
                {t(`Bạn có ${invites.length} lời mời tham gia phòng học`, `You have ${invites.length} study room invite(s)`)}
              </strong>
              <p style={{ fontSize: '12px', color: '#475569', margin: '2px 0 0' }}>
                {invites.map((inv) => `"${inv.room.title}" từ bạn ${inv.inviter.name}`).join(', ')}
              </p>
            </div>
            <button
              className="button button-primary"
              style={{ fontSize: '12px', minHeight: '32px' }}
              onClick={() => setActiveRoomId(invites[0].roomId)}
            >
              {t('Vào phòng ngay', 'Join Now')}
            </button>
          </div>
        </section>
      )}

      {/* Danh sách phòng học đang mở */}
      <div>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '14px' }}>
          <h2>{t('Phòng học đang hoạt động', 'Active Study Rooms')}</h2>
          <span style={{ fontSize: '12px', color: '#64748b' }}>
            {rooms.length} {t('phòng đang mở', 'open room(s)')}
          </span>
        </div>

        {loading ? (
          <div style={{ padding: '60px', textAlign: 'center' }}>
            <Spinner />
          </div>
        ) : rooms.length === 0 ? (
          <div className="panel" style={{ padding: '48px 24px', textAlign: 'center' }}>
            <div style={{ width: '48px', height: '48px', borderRadius: '50%', background: '#eff6ff', color: '#2563eb', display: 'grid', placeItems: 'center', margin: '0 auto 14px' }}>
              <Users size={24} />
            </div>
            <h3>{t('Chưa có phòng học nào', 'No active study rooms')}</h3>
            <p style={{ color: '#64748b', fontSize: '13px', margin: '6px 0 16px' }}>
              {t('Hãy là người đầu tiên tạo phòng học và mời bạn bè cùng vào ôn bài!', 'Be the first to create a study room and invite your friends!')}
            </p>
            <button className="button button-primary" onClick={() => setCreateModal(true)}>
              <Plus size={16} /> {t('Tạo phòng học ngay', 'Create a Room')}
            </button>
          </div>
        ) : (
          <div className="study-grid">
            {rooms.map((room) => {
              const stateClass = room.pomodoroState === 'FOCUS' ? 'focus' : room.pomodoroState === 'BREAK' ? 'break' : 'idle';
              const stateLabel =
                room.pomodoroState === 'FOCUS'
                  ? t('Đang tập trung', 'Focusing')
                  : room.pomodoroState === 'BREAK'
                  ? t('Nghỉ giải lao', 'Break')
                  : t('Chờ bắt đầu', 'Idle');

              return (
                <div key={room.id} className="study-card">
                  <div className="study-card-top">
                    <div>
                      <div className="study-card-title">{room.title}</div>
                      {room.description && <div className="study-card-desc">{room.description}</div>}
                    </div>
                    {room.hasPasscode && (
                      <span title={t('Phòng có mật khẩu', 'Protected with passcode')}>
                        <Lock size={16} style={{ color: '#94a3b8' }} />
                      </span>
                    )}
                  </div>

                  <div className="study-card-host">
                    <div className="study-card-host-avatar">
                      {room.host.name.charAt(0).toUpperCase()}
                    </div>
                    <span>{t('Chủ phòng:', 'Host:')} <strong>{room.host.name}</strong></span>
                  </div>

                  {room.participants.length > 0 && (
                    <div style={{ fontSize: '11px', color: '#64748b', background: '#f8fafc', padding: '6px 10px', borderRadius: '6px' }}>
                      {room.participants.map(p => p.name).join(', ')}
                    </div>
                  )}

                  <div className="study-card-meta">
                    <span className={`study-card-state ${stateClass}`}>
                      <span style={{ width: '6px', height: '6px', borderRadius: '50%', background: 'currentColor' }} />
                      {stateLabel} ({room.focusMinutes}p / {room.breakMinutes}p)
                    </span>

                    <button
                      className="button button-secondary"
                      style={{ fontSize: '12px', minHeight: '32px' }}
                      onClick={() => handleJoinClick(room)}
                      disabled={room.participantCount >= room.maxParticipants}
                    >
                      <DoorOpen size={15} />
                      {room.participantCount >= room.maxParticipants
                        ? t('Phòng đầy', 'Room Full')
                        : `${t('Vào phòng', 'Join')} (${room.participantCount}/${room.maxParticipants})`}
                    </button>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>

      {/* Modal Tạo phòng mới */}
      {createModal && (
        <div className="modal-backdrop" onClick={() => setCreateModal(false)}>
          <div className="modal" onClick={(e) => e.stopPropagation()}>
            <div className="modal-heading">
              <div>
                <h2>{t('Tạo phòng học chung', 'Create Study Room')}</h2>
                <p>{t('Đặt thông số Pomodoro và giới hạn thành viên tham gia.', 'Configure Pomodoro and room capacity.')}</p>
              </div>
              <button className="icon-button" onClick={() => setCreateModal(false)}><X size={18} /></button>
            </div>
            <form className="form-stack" onSubmit={handleCreateRoom}>
              <label className="field">
                <span>{t('Tên phòng học *', 'Room Title *')}</span>
                <input
                  type="text"
                  placeholder={t('Ví dụ: Ôn thi An toàn thông tin, Cùng code đồ án…', 'e.g. Exam prep, Coding project…')}
                  value={title}
                  onChange={(e) => setTitle(e.target.value)}
                  required
                  autoFocus
                />
              </label>

              <label className="field">
                <span>{t('Mô tả mục tiêu (tùy chọn)', 'Description / Objective')}</span>
                <input
                  type="text"
                  placeholder={t('Ví dụ: Làm bài tập tuần 9 và ôn lý thuyết kíp 3', 'e.g. Chapter 9 assignment')}
                  value={description}
                  onChange={(e) => setDescription(e.target.value)}
                />
              </label>

              <div className="form-grid">
                <label className="field">
                  <span>{t('Thời gian tập trung (phút)', 'Focus Time (mins)')}</span>
                  <select value={focusMinutes} onChange={(e) => setFocusMinutes(Number(e.target.value))}>
                    <option value={15}>15 {t('phút', 'mins')}</option>
                    <option value={20}>20 {t('phút', 'mins')}</option>
                    <option value={25}>25 {t('phút (Chuẩn Pomodoro)', 'mins (Standard)')}</option>
                    <option value={45}>45 {t('phút', 'mins')}</option>
                    <option value={50}>50 {t('phút', 'mins')}</option>
                  </select>
                </label>

                <label className="field">
                  <span>{t('Thời gian nghỉ giải lao (phút)', 'Break Time (mins)')}</span>
                  <select value={breakMinutes} onChange={(e) => setBreakMinutes(Number(e.target.value))}>
                    <option value={5}>5 {t('phút', 'mins')}</option>
                    <option value={10}>10 {t('phút', 'mins')}</option>
                    <option value={15}>15 {t('phút', 'mins')}</option>
                  </select>
                </label>
              </div>

              <div className="form-grid">
                <label className="field">
                  <span>{t('Số người tối đa', 'Max Participants')}</span>
                  <select value={maxParticipants} onChange={(e) => setMaxParticipants(Number(e.target.value))}>
                    <option value={2}>2 {t('người (Cặp đôi)', 'students (Duo)')}</option>
                    <option value={4}>4 {t('người', 'students')}</option>
                    <option value={6}>6 {t('người (Khuyên dùng)', 'students (Recommended)')}</option>
                    <option value={8}>8 {t('người (Tối đa)', 'students (Max)')}</option>
                  </select>
                </label>

                <label className="field">
                  <span>{t('Mã PIN / Mật khẩu vào phòng (tùy chọn)', 'Passcode / PIN (Optional)')}</span>
                  <input
                    type="text"
                    placeholder={t('Để trống nếu công khai', 'Leave empty for public')}
                    value={passcode}
                    onChange={(e) => setPasscode(e.target.value)}
                  />
                </label>
              </div>

              <div className="form-footer">
                <button type="button" className="button button-quiet" onClick={() => setCreateModal(false)}>
                  {t('Hủy', 'Cancel')}
                </button>
                <button type="submit" className="button button-primary" disabled={creating || !title.trim()}>
                  {creating ? <Spinner /> : <Plus size={16} />}
                  {t('Tạo phòng ngay', 'Create Room')}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Modal Nhập Passcode khi vào phòng có khóa */}
      {passcodeModal && (
        <div className="modal-backdrop" onClick={() => setPasscodeModal(null)}>
          <div className="modal" style={{ maxWidth: '400px' }} onClick={(e) => e.stopPropagation()}>
            <div className="modal-heading">
              <div>
                <h2>{t('Nhập mật khẩu phòng', 'Enter Room Passcode')}</h2>
                <p>"{passcodeModal.title}" {t('yêu cầu mã bảo vệ.', 'is passcode protected.')}</p>
              </div>
              <button className="icon-button" onClick={() => setPasscodeModal(null)}><X size={18} /></button>
            </div>
            <form className="form-stack" onSubmit={submitPasscodeJoin}>
              {joinError && <div className="error-notice">{joinError}</div>}
              <label className="field">
                <span>{t('Mật khẩu / PIN', 'Passcode / PIN')}</span>
                <input
                  type="password"
                  value={passcodeAttempt}
                  onChange={(e) => setPasscodeAttempt(e.target.value)}
                  autoFocus
                  required
                />
              </label>
              <div className="form-footer">
                <button type="button" className="button button-quiet" onClick={() => setPasscodeModal(null)}>
                  {t('Hủy', 'Cancel')}
                </button>
                <button type="submit" className="button button-primary">
                  {t('Tham gia', 'Join')}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}

/**
 * Không gian học tập tập trung In-Room (Pomodoro + WebRTC Mesh + Chat nội bộ)
 */
interface StudyRoomFocusProps {
  roomId: string;
  user: User;
  locale: Locale;
  t: Translate;
  onLeave: () => void;
}

interface PeerState {
  userId: string;
  name: string;
  studentId: string | null;
  isCamOn: boolean;
  isMicOn: boolean;
  currentTask?: string | null;
  stream?: MediaStream;
}

function StudyRoomFocus({ roomId, user, t, onLeave }: StudyRoomFocusProps) {
  const [room, setRoom] = useState<StudyRoomSummary | null>(null);
  const [peers, setPeers] = useState<Map<string, PeerState>>(new Map());
  const [isCamOn, setIsCamOn] = useState(false);
  const [isMicOn, setIsMicOn] = useState(false);
  const [isAmbientOn, setIsAmbientOn] = useState(false);
  const [currentTask, setCurrentTask] = useState('Ôn bài kíp học');
  const [isEditingTask, setIsEditingTask] = useState(false);
  const [chatDrawerOpen, setChatDrawerOpen] = useState(false);
  const [messages, setMessages] = useState<{ id: string; senderName: string; content: string; createdAt: string }[]>([]);
  const [chatInput, setChatInput] = useState('');
  const [inviteModalOpen, setInviteModalOpen] = useState(false);
  const [inviteStudentId, setInviteStudentId] = useState('');
  const [inviteFeedback, setInviteFeedback] = useState('');

  // Pomodoro countdown
  const [timeLeftSeconds, setTimeLeftSeconds] = useState(25 * 60);

  const webrtcRef = useRef<WebRtcMeshManager | null>(null);
  const localVideoRef = useRef<HTMLVideoElement>(null);

  // Khởi tạo phòng và WebRTC
  useEffect(() => {
    realtimeClient.connect();

    const webrtc = new WebRtcMeshManager(roomId, user.id);
    webrtcRef.current = webrtc;

    webrtc.onRemoteStream((peerId, stream) => {
      setPeers((prev) => {
        const next = new Map(prev);
        const existing = next.get(peerId);
        if (existing) {
          next.set(peerId, { ...existing, stream });
        }
        return next;
      });
    });

    webrtc.onPeerLeft((peerId) => {
      setPeers((prev) => {
        const next = new Map(prev);
        next.delete(peerId);
        return next;
      });
    });

    // Lắng nghe sự kiện phòng từ WebSocket
    const unsubJoined = realtimeClient.on('room:joined', (payload) => {
      setRoom(payload.room);
    });

    const unsubPeers = realtimeClient.on('room:peers', (payload: { peers: any[] }) => {
      setPeers((prev) => {
        const next = new Map(prev);
        for (const p of payload.peers) {
          if (!next.has(p.userId)) {
            next.set(p.userId, p);
          }
          // Kết nối WebRTC
          void webrtc.initiatePeerConnection(p.userId);
        }
        return next;
      });
    });

    const unsubPeerJoined = realtimeClient.on('room:peer_joined', (p) => {
      setPeers((prev) => {
        const next = new Map(prev);
        next.set(p.userId, p);
        return next;
      });
      void webrtc.initiatePeerConnection(p.userId);
    });

    const unsubPeerLeft = realtimeClient.on('room:peer_left', (payload) => {
      webrtc.closePeer(payload.userId);
    });

    const unsubMediaUpdated = realtimeClient.on('media:updated', (payload) => {
      setPeers((prev) => {
        const next = new Map(prev);
        const p = next.get(payload.userId);
        if (p) {
          next.set(payload.userId, { ...p, isCamOn: payload.isCamOn, isMicOn: payload.isMicOn });
        }
        return next;
      });
    });

    const unsubTaskUpdated = realtimeClient.on('task:updated', (payload) => {
      setPeers((prev) => {
        const next = new Map(prev);
        const p = next.get(payload.userId);
        if (p) {
          next.set(payload.userId, { ...p, currentTask: payload.currentTask });
        }
        return next;
      });
    });

    const unsubPomoSync = realtimeClient.on('pomodoro:sync', (payload) => {
      setRoom((prev) => {
        if (!prev) return prev;
        return {
          ...prev,
          pomodoroState: payload.pomodoroState,
          timerEndsAt: payload.timerEndsAt,
        };
      });
    });

    const unsubChatReceived = realtimeClient.on('chat:room_received', (msg) => {
      setMessages((prev) => [...prev, msg]);
    });

    // Tham gia phòng
    realtimeClient.send('room:join', {
      roomId,
      currentTask,
    });

    // Khởi tạo stream camera / mic cục bộ
    void webrtc.initLocalStream(false, false).then((stream) => {
      if (localVideoRef.current && stream) {
        localVideoRef.current.srcObject = stream;
      }
    });

    return () => {
      unsubJoined();
      unsubPeers();
      unsubPeerJoined();
      unsubPeerLeft();
      unsubMediaUpdated();
      unsubTaskUpdated();
      unsubPomoSync();
      unsubChatReceived();
      webrtc.destroy();
      ambientSound.stop();
    };
  }, [roomId, user.id]);

  // Pomodoro timer ticker
  useEffect(() => {
    const timer = setInterval(() => {
      if (!room || room.pomodoroState === 'IDLE' || !room.timerEndsAt) {
        if (room) setTimeLeftSeconds(room.focusMinutes * 60);
        return;
      }

      const diff = Math.max(0, Math.round((new Date(room.timerEndsAt).getTime() - Date.now()) / 1000));
      setTimeLeftSeconds(diff);

      if (diff === 0) {
        playBellSound();
      }
    }, 1000);

    return () => clearInterval(timer);
  }, [room]);

  // Bật/tắt camera
  const toggleCam = () => {
    const nextState = !isCamOn;
    setIsCamOn(nextState);
    webrtcRef.current?.toggleCamera(nextState);
    realtimeClient.send('media:toggle', { roomId, isCamOn: nextState });
  };

  // Bật/tắt micro
  const toggleMic = () => {
    const nextState = !isMicOn;
    setIsMicOn(nextState);
    webrtcRef.current?.toggleMicrophone(nextState);
    realtimeClient.send('media:toggle', { roomId, isMicOn: nextState });
  };

  // Bật/tắt tiếng mưa nền
  const toggleAmbient = () => {
    const active = ambientSound.toggle();
    setIsAmbientOn(active);
  };

  // Cập nhật task mục tiêu
  const saveTask = (e: React.FormEvent) => {
    e.preventDefault();
    setIsEditingTask(false);
    realtimeClient.send('task:update', { roomId, currentTask });
  };

  // Pomodoro Actions dành cho Host
  const handlePomoAction = (action: 'start_focus' | 'start_break' | 'reset') => {
    realtimeClient.send('pomodoro:action', { roomId, action });
  };

  // Gửi tin nhắn trong phòng
  const handleSendRoomChat = (e?: React.FormEvent, directContent?: string) => {
    if (e) e.preventDefault();
    const content = (directContent || chatInput).trim();
    if (!content) return;

    realtimeClient.send('chat:room_send', { roomId, content });
    if (!directContent) setChatInput('');
  };

  // Rời phòng
  const handleLeaveRoom = () => {
    realtimeClient.send('room:leave', { roomId });
    ambientSound.stop();
    onLeave();
  };

  // Mời sinh viên qua MSSV
  const handleSendInvite = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!inviteStudentId.trim()) return;

    try {
      const res = await fetch(`/api/v1/study-rooms/${roomId}/invites`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ targetStudentId: inviteStudentId.trim() }),
      });

      if (res.ok) {
        setInviteFeedback(t('Đã gửi lời mời thành công!', 'Invite sent successfully!'));
        setInviteStudentId('');
        setTimeout(() => {
          setInviteModalOpen(false);
          setInviteFeedback('');
        }, 1500);
      } else {
        const err = await res.json();
        setInviteFeedback(err.error?.message || t('Lỗi khi gửi lời mời', 'Failed to send invite'));
      }
    } catch {
      setInviteFeedback(t('Không thể kết nối đến máy chủ', 'Server error'));
    }
  };

  const isHost = room?.host.id === user.id;
  const minutes = Math.floor(timeLeftSeconds / 60);
  const seconds = timeLeftSeconds % 60;
  const timeFormatted = `${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}`;

  const peerList = Array.from(peers.values());
  const totalCount = peerList.length + 1; // + local user

  return (
    <div className="focus-space">
      {/* Top Header */}
      <header className="focus-header">
        <div className="focus-header-info">
          <h2>
            <Users size={18} style={{ color: '#38bdf8' }} />
            {room?.title || t('Phòng học trực tuyến', 'Study Room')}
          </h2>
          <p>
            {isHost ? t('Bạn là Chủ phòng (Host)', 'You are the Host') : `${t('Chủ phòng:', 'Host:')} ${room?.host.name}`}
            {room?.description && ` · ${room.description}`}
          </p>
        </div>

        {/* Central Pomodoro Widget */}
        <div className="pomodoro-banner">
          <span
            className={`pomodoro-mode-badge ${
              room?.pomodoroState === 'FOCUS' ? 'focus' : room?.pomodoroState === 'BREAK' ? 'break' : 'idle'
            }`}
          >
            {room?.pomodoroState === 'FOCUS'
              ? t('KÍP TẬP TRUNG', 'FOCUS SESSION')
              : room?.pomodoroState === 'BREAK'
              ? t('GIỜ NGHỈ', 'BREAK')
              : t('SẴN SÀNG', 'READY')}
          </span>
          <span className="pomodoro-timer">{timeFormatted}</span>

          {/* Điều khiển cho Host */}
          {isHost && (
            <div style={{ display: 'flex', gap: '6px' }}>
              {room?.pomodoroState === 'IDLE' ? (
                <button
                  className="icon-button"
                  style={{ color: '#38bdf8' }}
                  onClick={() => handlePomoAction('start_focus')}
                  title={t('Bắt đầu kíp tập trung', 'Start Focus')}
                >
                  <Play size={16} />
                </button>
              ) : (
                <>
                  <button
                    className="icon-button"
                    style={{ color: '#fbbf24' }}
                    onClick={() => handlePomoAction('start_break')}
                    title={t('Bắt đầu giờ nghỉ', 'Start Break')}
                  >
                    <Coffee size={16} />
                  </button>
                  <button
                    className="icon-button"
                    style={{ color: '#94a3b8' }}
                    onClick={() => handlePomoAction('reset')}
                    title={t('Đặt lại Pomodoro', 'Reset Timer')}
                  >
                    <RotateCcw size={16} />
                  </button>
                </>
              )}
            </div>
          )}
        </div>

        {/* Actions bên phải */}
        <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
          <button
            className="button button-quiet"
            style={{ fontSize: '12px', minHeight: '34px', background: 'rgba(255,255,255,0.08)', color: '#f8fafc', borderColor: 'transparent' }}
            onClick={() => setInviteModalOpen(true)}
          >
            <UserPlus size={15} />
            {t('Mời bạn theo MSSV', 'Invite Student')}
          </button>
          <button
            className="dock-btn danger"
            onClick={handleLeaveRoom}
            title={t('Rời phòng học', 'Leave Room')}
          >
            <LogOut size={16} />
            {t('Rời phòng', 'Leave')}
          </button>
        </div>
      </header>

      {/* Main Focus Area (Video Grid + Optional Chat Drawer) */}
      <div className="focus-content">
        <div className={`peers-grid count-${Math.min(totalCount, 8)}`}>
          {/* Card của người dùng hiện tại (Local) */}
          <div className="peer-card">
            <video
              ref={localVideoRef}
              autoPlay
              playsInline
              muted
              className="peer-video"
              style={{ display: isCamOn ? 'block' : 'none' }}
            />
            {!isCamOn && (
              <div className="peer-avatar-fallback">
                <div className="peer-avatar-circle">
                  {user.name.charAt(0).toUpperCase()}
                </div>
              </div>
            )}
            <div className="peer-info-overlay">
              <div>
                <div className="peer-name-tag">
                  {user.name} ({t('Bạn', 'You')})
                  {isMicOn ? <Mic size={14} style={{ color: '#4ade80' }} /> : <MicOff size={14} style={{ color: '#ef4444' }} />}
                </div>
                {isEditingTask ? (
                  <form onSubmit={saveTask} style={{ display: 'flex', gap: '4px', marginTop: '4px' }}>
                    <input
                      type="text"
                      className="room-chat-input"
                      style={{ padding: '2px 6px', fontSize: '11px', height: '24px' }}
                      value={currentTask}
                      onChange={(e) => setCurrentTask(e.target.value)}
                      autoFocus
                    />
                    <button type="submit" className="icon-button" style={{ minWidth: '24px', minHeight: '24px', color: '#4ade80' }}>
                      <Check size={14} />
                    </button>
                  </form>
                ) : (
                  <div
                    className="peer-task-badge"
                    onClick={() => setIsEditingTask(true)}
                    style={{ cursor: 'pointer' }}
                    title={t('Bấm để đổi mục tiêu', 'Click to edit task')}
                  >
                    🎯 {currentTask} <Edit2 size={10} style={{ display: 'inline', marginLeft: '4px' }} />
                  </div>
                )}
              </div>
            </div>
          </div>

          {/* Cards của các bạn sinh viên khác trong phòng */}
          {peerList.map((peer) => (
            <PeerVideoCard key={peer.userId} peer={peer} />
          ))}
        </div>

        {/* Khung chat nội bộ trong phòng (Drawer) */}
        {chatDrawerOpen && (
          <aside className="room-chat-drawer">
            <div className="room-chat-header">
              <span style={{ fontSize: '13px', fontWeight: 650, display: 'flex', alignItems: 'center', gap: '6px' }}>
                <MessageSquare size={16} /> {t('Trò chuyện trong phòng', 'Room Chat')}
              </span>
              <button className="icon-button" style={{ color: '#94a3b8' }} onClick={() => setChatDrawerOpen(false)}>
                <X size={16} />
              </button>
            </div>

            <div className="room-chat-list">
              {messages.length === 0 ? (
                <div style={{ textAlign: 'center', color: '#64748b', fontSize: '12px', margin: 'auto 0' }}>
                  {t('Gửi tin nhắn hoặc động viên bạn học cùng phòng!', 'Send a message or encourage your study mates!')}
                </div>
              ) : (
                messages.map((m) => (
                  <div key={m.id} className="room-chat-msg">
                    <span className="room-chat-sender">{m.senderName}</span>
                    <span className="room-chat-text">{m.content}</span>
                  </div>
                ))
              )}
            </div>

            {/* Quick reaction pills */}
            <div className="room-chat-pills">
              {['💪 Cố lên!', '☕ Nghỉ tí nào!', '🔥 Tập trung cao độ!'].map((pill) => (
                <button
                  key={pill}
                  type="button"
                  className="room-reaction-pill"
                  onClick={() => handleSendRoomChat(undefined, pill)}
                >
                  {pill}
                </button>
              ))}
            </div>

            <form className="room-chat-input-row" onSubmit={handleSendRoomChat}>
              <input
                type="text"
                className="room-chat-input"
                placeholder={t('Nhập tin nhắn…', 'Type message…')}
                value={chatInput}
                onChange={(e) => setChatInput(e.target.value)}
              />
              <button
                type="submit"
                className="icon-button"
                style={{ background: '#2563eb', color: '#fff', borderRadius: '8px' }}
                disabled={!chatInput.trim()}
              >
                <Send size={15} />
              </button>
            </form>
          </aside>
        )}
      </div>

      {/* Floating Bottom Dock */}
      <footer className="focus-dock">
        <div className="dock-controls">
          <button
            className={`dock-btn ${isMicOn ? 'active' : 'off'}`}
            onClick={toggleMic}
            title={isMicOn ? t('Tắt micro', 'Mute') : t('Bật micro', 'Unmute')}
          >
            {isMicOn ? <Mic size={20} /> : <MicOff size={20} />}
          </button>

          <button
            className={`dock-btn ${isCamOn ? 'active' : 'off'}`}
            onClick={toggleCam}
            title={isCamOn ? t('Tắt camera', 'Stop Video') : t('Bật camera', 'Start Video')}
          >
            {isCamOn ? <Video size={20} /> : <VideoOff size={20} />}
          </button>

          <button
            className={`dock-btn ${isAmbientOn ? 'active' : ''}`}
            onClick={toggleAmbient}
            title={isAmbientOn ? t('Tắt tiếng mưa nền', 'Stop Rain Sound') : t('Bật tiếng mưa nhẹ tăng tập trung', 'Gentle Rain Noise')}
          >
            <CloudRain size={20} />
          </button>
        </div>

        {/* Current task preview in dock */}
        <div style={{ display: 'flex', alignItems: 'center', gap: '8px', color: '#94a3b8', fontSize: '12px' }}>
          <Sparkles size={15} style={{ color: '#38bdf8' }} />
          <span>{t('Mục tiêu hiện tại:', 'Target:')} <strong style={{ color: '#f8fafc' }}>{currentTask}</strong></span>
        </div>

        <div className="dock-controls">
          <button
            className={`dock-btn ${chatDrawerOpen ? 'active' : ''}`}
            onClick={() => setChatDrawerOpen(!chatDrawerOpen)}
            title={t('Mở khung trò chuyện', 'Toggle Chat')}
          >
            <MessageSquare size={20} />
          </button>
        </div>
      </footer>

      {/* Modal Mời sinh viên qua MSSV */}
      {inviteModalOpen && (
        <div className="modal-backdrop" onClick={() => setInviteModalOpen(false)}>
          <div className="modal" style={{ maxWidth: '420px' }} onClick={(e) => e.stopPropagation()}>
            <div className="modal-heading">
              <div>
                <h2>{t('Mời sinh viên vào phòng', 'Invite Student')}</h2>
                <p>{t('Nhập mã sinh viên (MSSV) của bạn học để gửi lời mời trực tiếp.', 'Enter student ID to send invite.')}</p>
              </div>
              <button className="icon-button" onClick={() => setInviteModalOpen(false)}><X size={18} /></button>
            </div>
            <form className="form-stack" onSubmit={handleSendInvite}>
              {inviteFeedback && (
                <div className={`callout ${inviteFeedback.includes('thành công') ? 'green' : 'callout-amber'}`}>
                  {inviteFeedback}
                </div>
              )}
              <label className="field">
                <span>{t('Mã sinh viên (MSSV) *', 'Student ID *')}</span>
                <input
                  type="text"
                  placeholder={t('Ví dụ: 3120224099', 'e.g. 3120224099')}
                  value={inviteStudentId}
                  onChange={(e) => setInviteStudentId(e.target.value)}
                  autoFocus
                  required
                />
              </label>
              <div className="form-footer">
                <button type="button" className="button button-quiet" onClick={() => setInviteModalOpen(false)}>
                  {t('Đóng', 'Close')}
                </button>
                <button type="submit" className="button button-primary" disabled={!inviteStudentId.trim()}>
                  <UserPlus size={16} />
                  {t('Gửi lời mời', 'Send Invite')}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}

/**
 * Hiển thị video / avatar của từng bạn học trong phòng
 */
function PeerVideoCard({ peer }: { peer: PeerState }) {
  const videoRef = useRef<HTMLVideoElement>(null);

  useEffect(() => {
    if (videoRef.current && peer.stream) {
      videoRef.current.srcObject = peer.stream;
    }
  }, [peer.stream]);

  return (
    <div className="peer-card">
      <video
        ref={videoRef}
        autoPlay
        playsInline
        className="peer-video"
        style={{ display: peer.isCamOn && peer.stream ? 'block' : 'none' }}
      />
      {(!peer.isCamOn || !peer.stream) && (
        <div className="peer-avatar-fallback">
          <div className="peer-avatar-circle">
            {peer.name.charAt(0).toUpperCase()}
          </div>
        </div>
      )}
      <div className="peer-info-overlay">
        <div>
          <div className="peer-name-tag">
            {peer.name}
            {peer.isMicOn ? <Mic size={14} style={{ color: '#4ade80' }} /> : <MicOff size={14} style={{ color: '#ef4444' }} />}
          </div>
          {peer.currentTask && (
            <div className="peer-task-badge">
              🎯 {peer.currentTask}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
