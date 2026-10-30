import { useState, useEffect, useRef, useCallback } from 'react';
import { Search, Send, MessageSquare, User as UserIcon, CheckCheck } from 'lucide-react';
import { Spinner, type Translate } from './components';
import { realtimeClient } from './lib/ws-client';
import type { User, Locale, ConversationSummary, DirectChatMessage, StudentPublicProfile } from './types';
import './chat.css';

interface ChatHubProps {
  user: User;
  locale: Locale;
  t: Translate;
}

export function ChatHub({ user, t }: ChatHubProps) {
  const [conversations, setConversations] = useState<ConversationSummary[]>([]);
  const [activeConvId, setActiveConvId] = useState<string | null>(null);
  const [messages, setMessages] = useState<DirectChatMessage[]>([]);
  const [loadingConvs, setLoadingConvs] = useState(true);
  const [loadingMessages, setLoadingMessages] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  const [searchResults, setSearchResults] = useState<StudentPublicProfile[]>([]);
  const [searching, setSearching] = useState(false);
  const [inputContent, setInputContent] = useState('');
  const [sending, setSending] = useState(false);

  const messagesEndRef = useRef<HTMLDivElement>(null);
  const searchTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const scrollToBottom = () => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  };

  // Load danh sách hội thoại
  const loadConversations = useCallback(async () => {
    try {
      const res = await fetch('/api/v1/chat/conversations');
      if (res.ok) {
        const data: ConversationSummary[] = await res.json();
        setConversations(data);
        if (data.length > 0 && !activeConvId) {
          setActiveConvId(data[0].id);
        }
      }
    } catch (err) {
      console.error('Lỗi tải danh sách hội thoại', err);
    } finally {
      setLoadingConvs(false);
    }
  }, [activeConvId]);

  // Load tin nhắn của hội thoại hiện tại
  const loadMessages = useCallback(async (convId: string) => {
    setLoadingMessages(true);
    try {
      const res = await fetch(`/api/v1/chat/conversations/${convId}/messages`);
      if (res.ok) {
        const data: DirectChatMessage[] = await res.json();
        setMessages(data);
        setTimeout(scrollToBottom, 50);
      }
    } catch (err) {
      console.error('Lỗi tải tin nhắn', err);
    } finally {
      setLoadingMessages(false);
    }
  }, []);

  // Khởi động kết nối WebSocket và lắng nghe tin nhắn đến
  useEffect(() => {
    realtimeClient.connect();

    const unsubDirect = realtimeClient.on('chat:direct_received', (payload: { conversationId: string; message: DirectChatMessage }) => {
      if (payload.conversationId === activeConvId) {
        setMessages((prev) => [...prev, payload.message]);
        setTimeout(scrollToBottom, 50);
      }
      // Cập nhật danh sách hội thoại
      loadConversations();
    });

    const unsubSent = realtimeClient.on('chat:direct_sent', (payload: { message: DirectChatMessage }) => {
      setMessages((prev) => {
        if (prev.some((m) => m.id === payload.message.id)) return prev;
        return [...prev, payload.message];
      });
      setTimeout(scrollToBottom, 50);
      loadConversations();
    });

    loadConversations();

    return () => {
      unsubDirect();
      unsubSent();
    };
  }, [activeConvId, loadConversations]);

  // Khi activeConvId thay đổi -> load tin nhắn
  useEffect(() => {
    if (activeConvId) {
      loadMessages(activeConvId);
    } else {
      setMessages([]);
    }
  }, [activeConvId, loadMessages]);

  // Xử lý tìm kiếm sinh viên với debounce
  const handleSearchChange = (value: string) => {
    setSearchQuery(value);
    if (searchTimeoutRef.current) clearTimeout(searchTimeoutRef.current);

    const q = value.trim();
    if (q.length < 2) {
      setSearchResults([]);
      setSearching(false);
      return;
    }

    setSearching(true);
    searchTimeoutRef.current = setTimeout(async () => {
      try {
        const res = await fetch(`/api/v1/chat/students/search?q=${encodeURIComponent(q)}`);
        if (res.ok) {
          const list: StudentPublicProfile[] = await res.json();
          setSearchResults(list);
        }
      } catch (err) {
        console.error('Lỗi tìm kiếm sinh viên', err);
      } finally {
        setSearching(false);
      }
    }, 300);
  };

  // Chọn một sinh viên để bắt đầu trò chuyện
  const startConversationWith = async (targetUserId: string) => {
    setSearchQuery('');
    setSearchResults([]);
    try {
      const res = await fetch('/api/v1/chat/conversations', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ targetUserId }),
      });
      if (res.ok) {
        const conv = await res.json();
        await loadConversations();
        setActiveConvId(conv.id);
      }
    } catch (err) {
      console.error('Lỗi tạo hội thoại', err);
    }
  };

  // Gửi tin nhắn
  const handleSendMessage = async (e?: React.FormEvent) => {
    if (e) e.preventDefault();
    const content = inputContent.trim();
    if (!content || !activeConvId || sending) return;

    setSending(true);
    try {
      // Ưu tiên gửi qua WebSocket để tức thì
      realtimeClient.send('chat:direct_send', {
        conversationId: activeConvId,
        content,
      });

      setInputContent('');
    } catch (err) {
      console.error('Lỗi gửi tin nhắn', err);
    } finally {
      setSending(false);
    }
  };

  const activeConversation = conversations.find((c) => c.id === activeConvId);

  return (
    <div className="page-stack">
      <div className="chat-container">
        {/* Sidebar danh sách hội thoại */}
        <aside className="chat-sidebar">
          <div className="chat-sidebar-header">
            <div className="chat-search-box">
              <Search size={16} />
              <input
                type="text"
                className="chat-search-input"
                placeholder={t('Tìm theo MSSV hoặc họ tên…', 'Search student ID or name…')}
                value={searchQuery}
                onChange={(e) => handleSearchChange(e.target.value)}
              />
              {searching && <Spinner />}

              {/* Kết quả tìm kiếm */}
              {searchResults.length > 0 && (
                <div className="chat-search-results">
                  {searchResults.map((st) => (
                    <div
                      key={st.id}
                      className="chat-search-item"
                      onClick={() => startConversationWith(st.id)}
                    >
                      <div className="chat-search-avatar">
                        {st.name.charAt(0).toUpperCase()}
                      </div>
                      <div className="chat-search-meta">
                        <div className="chat-search-name">{st.name}</div>
                        <div className="chat-search-sub">
                          {st.studentId ? `MSSV: ${st.studentId}` : st.email}
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>

          <div className="chat-conv-list">
            {loadingConvs ? (
              <div style={{ display: 'grid', placeItems: 'center', height: '100px' }}>
                <Spinner />
              </div>
            ) : conversations.length === 0 ? (
              <div style={{ padding: '30px 16px', textAlign: 'center', color: '#64748b' }}>
                <p style={{ fontSize: '13px', margin: 0 }}>
                  {t('Chưa có cuộc trò chuyện nào.', 'No conversations yet.')}
                </p>
                <small style={{ color: '#94a3b8' }}>
                  {t('Dùng ô tìm kiếm để kết nối cùng các bạn sinh viên UED.', 'Use the search bar to connect with fellow UED students.')}
                </small>
              </div>
            ) : (
              conversations.map((c) => {
                const isActive = c.id === activeConvId;
                const isUnread = c.lastMessage && !c.lastMessage.isRead && c.lastMessage.senderId !== user.id;

                return (
                  <div
                    key={c.id}
                    className={`chat-conv-item ${isActive ? 'active' : ''}`}
                    onClick={() => setActiveConvId(c.id)}
                  >
                    <div className="chat-conv-avatar">
                      {c.otherUser.name.charAt(0).toUpperCase()}
                    </div>
                    <div className="chat-conv-content">
                      <div className="chat-conv-row">
                        <span className="chat-conv-name">{c.otherUser.name}</span>
                        {c.lastMessage && (
                          <span className="chat-conv-time">
                            {new Date(c.lastMessage.createdAt).toLocaleTimeString([], {
                              hour: '2-digit',
                              minute: '2-digit',
                            })}
                          </span>
                        )}
                      </div>
                      <div className="chat-conv-row">
                        <span className={`chat-conv-snippet ${isUnread ? 'unread' : ''}`}>
                          {c.lastMessage
                            ? `${c.lastMessage.senderId === user.id ? 'Bạn: ' : ''}${c.lastMessage.content}`
                            : c.otherUser.studentId ? `MSSV: ${c.otherUser.studentId}` : t('Bắt đầu trò chuyện', 'Start chatting')}
                        </span>
                        {isUnread && <span className="chat-unread-dot" />}
                      </div>
                    </div>
                  </div>
                );
              })
            )}
          </div>
        </aside>

        {/* Khung chat chính */}
        <section className="chat-main">
          {activeConversation ? (
            <>
              {/* Header người đang chat */}
              <header className="chat-main-header">
                <div className="chat-header-user">
                  <div className="chat-header-avatar">
                    <UserIcon size={18} />
                  </div>
                  <div className="chat-header-info">
                    <h3>{activeConversation.otherUser.name}</h3>
                    <p>
                      {activeConversation.otherUser.studentId
                        ? `MSSV: ${activeConversation.otherUser.studentId} · ${activeConversation.otherUser.email}`
                        : activeConversation.otherUser.email}
                    </p>
                  </div>
                </div>
              </header>

              {/* Danh sách tin nhắn */}
              <div className="chat-messages-area">
                {loadingMessages ? (
                  <div style={{ margin: 'auto' }}>
                    <Spinner />
                  </div>
                ) : messages.length === 0 ? (
                  <div className="chat-empty-view">
                    <div className="chat-empty-icon">
                      <MessageSquare size={28} />
                    </div>
                    <h3>{t('Bắt đầu cuộc trò chuyện', 'Start the conversation')}</h3>
                    <p>
                      {t(
                        'Hãy gửi lời chào đến bạn sinh viên này để cùng trao đổi việc học và bài tập.',
                        'Send a greeting to start collaborating on study and assignments.'
                      )}
                    </p>
                  </div>
                ) : (
                  messages.map((m) => {
                    const isMine = m.senderId === user.id;
                    const timeStr = new Date(m.createdAt).toLocaleTimeString([], {
                      hour: '2-digit',
                      minute: '2-digit',
                    });

                    return (
                      <div
                        key={m.id}
                        className={`chat-bubble-wrapper ${isMine ? 'mine' : 'theirs'}`}
                      >
                        <div className={`chat-bubble ${isMine ? 'mine' : 'theirs'}`}>
                          {m.content}
                        </div>
                        <span className="chat-bubble-time">
                          {timeStr} {isMine && <CheckCheck size={12} style={{ display: 'inline', verticalAlign: 'middle', marginLeft: '3px' }} />}
                        </span>
                      </div>
                    );
                  })
                )}
                <div ref={messagesEndRef} />
              </div>

              {/* Khung nhập tin nhắn */}
              <form className="chat-input-area" onSubmit={handleSendMessage}>
                <input
                  type="text"
                  className="chat-input-field"
                  placeholder={t('Nhập tin nhắn… (nhấn Enter để gửi)', 'Type a message… (Enter to send)')}
                  value={inputContent}
                  onChange={(e) => setInputContent(e.target.value)}
                  disabled={sending}
                  autoFocus
                />
                <button
                  type="submit"
                  className="chat-send-btn"
                  disabled={!inputContent.trim() || sending}
                  aria-label={t('Gửi tin nhắn', 'Send message')}
                >
                  <Send size={16} />
                </button>
              </form>
            </>
          ) : (
            <div className="chat-empty-view">
              <div className="chat-empty-icon">
                <MessageSquare size={32} />
              </div>
              <h3>{t('Kênh trò chuyện sinh viên', 'Student Direct Chat')}</h3>
              <p>
                {t(
                  'Chọn một cuộc trò chuyện ở cột bên trái hoặc tìm kiếm MSSV để kết nối cùng bạn học.',
                  'Select a conversation on the left or search a student ID to connect with classmates.'
                )}
              </p>
            </div>
          )}
        </section>
      </div>
    </div>
  );
}
