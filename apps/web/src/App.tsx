// Verified frontend application flow with live backend API and PostgreSQL
import { useCallback, useEffect, useRef, useState } from 'react';
import { ArrowRight, Bell, BookOpen, CalendarCheck2, CalendarDays, CheckCheck, ChevronRight, Coffee, GraduationCap, LayoutDashboard, Link2, ListTodo, LogOut, Mail, Menu, RefreshCw, Settings2, Sparkles, X } from 'lucide-react';
import { ErrorNotice, EventForm, PlanForm, Spinner, SuggestionDetails, TaskForm, type Translate } from './components';
import { Dashboard, CalendarPage, TasksPage, SuggestionsPage, TaskDetails, EventDetails } from './workspace';
import { IntegrationsPage, NotificationsPage, SettingsPage } from './pages';
import UedConnect from './UedConnect';
import { api, ApiError, calendarRollover, dayStart, errorMessage, formatDate, localDay, monday, shiftDay } from './lib';
import { isSuggestionPending } from './suggestions';
import { agendaItems } from './agenda';
import type { AgendaItem, AuthConfig, Bootstrap, CalendarEvent, Locale, Suggestion, Task, User, View } from './types';

type Dialog = { kind: 'task'; task?: Task } | { kind: 'event'; event?: CalendarEvent } | { kind: 'task-detail'; task: Task } | { kind: 'event-detail'; event: CalendarEvent } | { kind: 'proposal'; suggestion: Suggestion } | { kind: 'plan' } | { kind: 'ued' } | null;
const validViews: View[] = ['dashboard', 'calendar', 'tasks', 'suggestions', 'notifications', 'integrations', 'settings'];
const readLocale = (): Locale => { try { return localStorage.getItem('schedule-locale') === 'en' ? 'en' : 'vi'; } catch { return 'vi'; } };
const readView = (): View => { const value = location.hash.slice(1) as View; return validViews.includes(value) ? value : 'dashboard'; };
export { isSuggestionPending as isPending } from './suggestions';

export default function App() {
  const [locale, setLocale] = useState<Locale>(readLocale), [view, setView] = useState<View>(readView);
  const [config, setConfig] = useState<AuthConfig>({ demoEnabled: false, microsoftEnabled: false, uedEnabled: false });
  const [user, setUser] = useState<User | null>(null), [data, setData] = useState<Bootstrap | null>(null);
  const [initializing, setInitializing] = useState(true), [loading, setLoading] = useState(false), [busy, setBusy] = useState(false);
  const [error, setError] = useState(''), [toast, setToast] = useState(''), [menu, setMenu] = useState(false), [dialog, setDialog] = useState<Dialog>(null);
  const [week, setWeek] = useState(monday(localDay('Asia/Ho_Chi_Minh'))), [selectedDay, setSelectedDay] = useState(localDay('Asia/Ho_Chi_Minh'));
  const [now, setNow] = useState(() => Date.now());
  const requestNumber = useRef(0);
  const trackedToday = useRef<{ userId: string; day: string } | null>(null);
  const t: Translate = (vi, en) => locale === 'vi' ? vi : en;
  const chooseLocale = (value: Locale) => { setLocale(value); try { localStorage.setItem('schedule-locale', value); } catch { /* Browser storage is optional. */ } };
  const identify = (value: User) => { setUser(value); chooseLocale(value.locale); const day = localDay(value.timezone); setWeek(monday(day)); setSelectedDay(day); };
  const bootstrap = useCallback(async () => {
    if (!user) return;
    const request = ++requestNumber.current;
    const params = new URLSearchParams({ fromDate: dayStart(week, user.timezone), toDate: dayStart(shiftDay(week, 7), user.timezone) });
    try {
      const result = await api<Bootstrap>(`/bootstrap?${params}`);
      if (request !== requestNumber.current) return;
      setData(result); setUser(previous => previous?.id === result.user.id ? result.user : previous);
    } catch (err) {
      if (request !== requestNumber.current) return;
      if (err instanceof ApiError && err.status === 401) { setUser(null); setData(null); setDialog(null); }
      throw err;
    }
  }, [user?.id, user?.timezone, week]);
  const initialize = async () => {
    setInitializing(true); setError('');
    try {
      setConfig(await api<AuthConfig>('/auth/config'));
      try { identify((await api<{ user: User }>('/auth/me')).user); } catch (err) { if (!(err instanceof ApiError && err.status === 401)) throw err; }
    } catch (err) { setError(errorMessage(err, locale)); } finally { setInitializing(false); }
  };
  useEffect(() => { void initialize(); }, []);
  useEffect(() => {
    if (!user) return;
    let mounted = true; setLoading(true);
    void bootstrap().catch(err => { if (mounted) setError(errorMessage(err, locale)); }).finally(() => { if (mounted) setLoading(false); });
    return () => { mounted = false; requestNumber.current++; };
  }, [bootstrap]);
  useEffect(() => {
    if (!user) return;
    const interval = setInterval(() => { if (document.visibilityState === 'visible' && !busy && !dialog) void bootstrap().catch(() => undefined); }, 30_000);
    return () => clearInterval(interval);
  }, [bootstrap, user?.id, busy, dialog]);
  useEffect(() => { document.documentElement.lang = locale; }, [locale]);
  useEffect(() => { const interval = setInterval(() => setNow(Date.now()), 30_000); return () => clearInterval(interval); }, []);
  useEffect(() => {
    if (!user) { trackedToday.current = null; return; }

    const currentDay = localDay(user.timezone, now);
    const previous = trackedToday.current;
    if (previous?.userId === user.id && previous.day !== currentDay) {
      // Follow midnight only while the student is still looking at "today".
      // A deliberately browsed historical/future week must never be pulled away.
      const rollover = calendarRollover(previous.day, currentDay, week, selectedDay);
      if (rollover) {
        setSelectedDay(rollover.selectedDay);
        setWeek(rollover.week);
      }
      // The dashboard's Today/Past/Upcoming overview is independent of the
      // browsed week, so refresh it even when the student keeps that week open.
      void bootstrap().catch(err => setError(errorMessage(err, locale)));
    }
    trackedToday.current = { userId: user.id, day: currentDay };
  }, [bootstrap, locale, now, selectedDay, user?.id, user?.timezone, week]);
  useEffect(() => { const changed = () => { setView(readView()); setMenu(false); }; window.addEventListener('hashchange', changed); return () => window.removeEventListener('hashchange', changed); }, []);
  useEffect(() => { if (!toast) return; const timer = setTimeout(() => setToast(''), 5000); return () => clearTimeout(timer); }, [toast]);
  useEffect(() => {
    const query = new URLSearchParams(location.search);
    if (query.has('authError')) setError(errorMessage(new ApiError('Microsoft sign-in failed', 400, query.get('authError') || ''), locale));
    if (query.get('outlook') === 'connected') setToast(t('Outlook đã được kết nối.', 'Outlook is connected.'));
    if (query.has('authError') || query.has('outlook')) history.replaceState(null, '', `${location.pathname}${location.hash}`);
  }, []);
  const navigate = (next: View) => { location.hash = next; setView(next); setMenu(false); if (next === 'dashboard' && user) { const day = localDay(user.timezone); setWeek(monday(day)); setSelectedDay(day); } };
  const refresh = async () => { setLoading(true); setError(''); try { await bootstrap(); } catch (err) { setError(errorMessage(err, locale)); } finally { setLoading(false); } };
  const mutate = async (path: string, method: string, body?: unknown, message?: string) => {
    const result = await api(path, method, body);
    await bootstrap(); if (message) setToast(message); return result;
  };
  const globalAction = async (action: () => Promise<unknown>) => { setBusy(true); setError(''); try { await action(); } catch (err) { setError(errorMessage(err, locale)); } finally { setBusy(false); } };
  const close = useCallback(() => setDialog(null), []);
  const beginDemo = () => globalAction(async () => { identify((await api<{ user: User }>('/auth/demo', 'POST', {})).user); navigate('dashboard'); });
  const logout = () => globalAction(async () => { await api('/auth/logout', 'POST', {}); requestNumber.current++; setUser(null); setData(null); setDialog(null); setMenu(false); });
  const showTask = (task: Task) => setDialog({ kind: 'task-detail', task });
  const showAgenda = (item: AgendaItem) => item.event ? setDialog({ kind: 'event-detail', event: item.event }) : item.task && showTask(item.task);
  const days = Array.from({ length: 7 }, (_, index) => shiftDay(week, index));
  const agenda: AgendaItem[] = data ? agendaItems(data.events, data.blocks, data.tasks, t('Phiên tự học', 'Study session')) : [];
  const forDay = (day: string) => agenda.filter(item => Date.parse(item.startTime) < Date.parse(dayStart(shiftDay(day, 1), user!.timezone)) && Date.parse(item.endTime) > Date.parse(dayStart(day, user!.timezone)));
  const suggestionsNow = Date.now();
  const waiting = data?.suggestions.filter(suggestion => isSuggestionPending(suggestion, suggestionsNow)) || [], unread = data?.notifications.filter(item => !item.readAt).length || 0;
  const nav = [
    { id: 'dashboard' as View, icon: LayoutDashboard, label: t('Tổng quan', 'Overview') },
    { id: 'calendar' as View, icon: CalendarDays, label: t('Lịch của tôi', 'My calendar') },
    { id: 'tasks' as View, icon: ListTodo, label: t('Công việc', 'Tasks') },
    { id: 'suggestions' as View, icon: Sparkles, label: t('Đề xuất cho bạn', 'Suggestions'), count: waiting.length },
    { id: 'notifications' as View, icon: Bell, label: t('Thông báo', 'Notifications'), count: unread },
    { id: 'integrations' as View, icon: Link2, label: t('Kết nối & học tập', 'Connections & study') },
    { id: 'settings' as View, icon: Settings2, label: t('Tùy chỉnh', 'Preferences') },
  ];
  if (initializing) return <main className="loading-screen"><Brand /><Spinner /><p>{t('Đang mở không gian học tập của bạn…', 'Opening your study space…')}</p></main>;
  if (!user) return <><main className="welcome"><section className="welcome-story"><Brand /><div className="welcome-copy"><span className="eyebrow">{t('MỘT NHỊP HỌC, THẬT RIÊNG BẠN', 'A STUDY RHYTHM OF YOUR OWN')}</span><h1>{t('Sắp xếp một ngày.', 'Plan your day.')}<br /><em>{t('Dành chỗ cho tương lai.', 'Make room for tomorrow.')}</em></h1><p>{t('Lịch học, công việc và những khoảng nghỉ. Kết nối mọi thứ, để bạn tập trung vào điều quan trọng.', 'Classes, tasks, and a little breathing room. Bring it all together, and focus on what matters.')}</p><div className="welcome-promises"><span><CalendarCheck2 />{t('Lịch học trong một nơi', 'Your studies, in one place')}</span><span><Sparkles />{t('Gợi ý phù hợp với bạn', 'Suggestions that fit your day')}</span><span><CheckCheck />{t('Bạn luôn là người quyết định', 'You always make the call')}</span></div></div><p className="welcome-university"><GraduationCap size={18} />{t('Đại học Sư phạm · Đại học Đà Nẵng', 'University of Education · The University of Danang')}</p><div className="welcome-orbit" aria-hidden="true"><div /><div /><div /><span><BookOpen size={48} /></span></div></section><section className="welcome-login"><button className="language-switch" onClick={() => chooseLocale(locale === 'vi' ? 'en' : 'vi')}>{locale === 'vi' ? 'English' : 'Tiếng Việt'}<span>↗</span></button><div className="login-content"><span className="login-icon"><GraduationCap size={30} /></span><h2>{t('Chào bạn, sinh viên UED.', 'Hello, UED student.')}</h2><p>{t('Một ngày chủ động hơn bắt đầu từ đây.', 'A more intentional day starts here.')}</p>{error && <ErrorNotice>{error}</ErrorNotice>}{config.uedEnabled && <button className="button button-primary login-button" disabled={busy} onClick={() => setDialog({ kind: 'ued' })}><GraduationCap size={19} />{t('Đăng nhập bằng mã sinh viên', 'Sign in with your student ID')}<ArrowRight size={18} /></button>}{config.microsoftEnabled && <a className="button button-secondary login-button" href="/api/v1/auth/microsoft/start"><Mail size={19} />{t('Tiếp tục với email trường', 'Continue with school email')}</a>}{!config.uedEnabled && !config.microsoftEnabled && <div className="callout callout-amber">{t('Kết nối tài khoản trường đang được chuẩn bị. Bạn có thể trải nghiệm bản demo nếu khả dụng.', 'School account sign-in is being prepared. You can explore the demo when available.')}</div>}{config.demoEnabled && <><div className="login-divider"><span>{t('hoặc tìm hiểu trước', 'or take a look around')}</span></div><button className="button button-quiet login-button" disabled={busy} onClick={beginDemo}>{busy ? <Spinner /> : <ArrowRight size={18} />}{t('Khám phá bản demo', 'Explore the demo')}</button><small>{t('Không cần tài khoản. Dữ liệu minh họa được ghi nhãn rõ ràng.', 'No account needed. Sample data is clearly labelled.')}</small></>}{error && <button className="text-link" onClick={initialize}>{t('Kiểm tra kết nối lại', 'Check connection again')}<RefreshCw size={14} /></button>}<p className="login-footnote">{t('Tài khoản UED dùng mã sinh viên. Outlook dùng email trường. Mật khẩu UED không được lưu lại.', 'Use your student ID for UED and school email for Outlook. Your UED password is never stored.')}</p></div><span className="welcome-footer">Personal Automated Schedule for Students</span></section></main>{dialog?.kind === 'ued' && <UedConnect locale={locale} t={t} connected={identify} close={close} />}</>;
  const titles: Record<View, [string, string]> = {
    dashboard: [t('Một ngày có nhịp điệu.', 'Find your daily rhythm.'), t('Việc quan trọng có thời gian riêng. Bạn cũng vậy.', 'Make time for the important things. And for yourself.')],
    calendar: [t('Lịch của tôi', 'My calendar'), t('Một cái nhìn rõ ràng cho những ngày phía trước.', 'A clear view of the days ahead.')],
    tasks: [t('Từng việc, từng bước.', 'One task, one step at a time.'), t('Ghi lại điều cần làm. Dành năng lượng để thực hiện.', 'Capture what needs doing. Save your energy for doing it.')],
    suggestions: [t('Một chút sắp xếp thông minh.', 'A little thoughtful planning.'), t('Hệ thống gợi ý. Bạn xem lại và quyết định.', 'We suggest. You review and decide.')],
    notifications: [t('Không bỏ lỡ điều cần biết.', 'Stay in the loop.'), t('Những cập nhật dành riêng cho bạn.', 'The latest updates, just for you.')],
    integrations: [t('Kết nối với hành trình học tập.', 'Connect your academic journey.'), t('Nguồn dữ liệu quen thuộc, một nơi theo dõi.', 'Your familiar sources, all in one place.')],
    settings: [t('Lịch học theo cách của bạn.', 'A schedule that feels like you.'), t('Điều chỉnh nhịp sinh hoạt để gợi ý phù hợp hơn.', 'Set your routine for suggestions that fit better.')],
  };
  return <div className="app-shell">
    <a className="skip-link" href="#main-content">{t('Đến nội dung chính', 'Skip to content')}</a>
    {menu && <button className="sidebar-overlay" aria-label={t('Đóng menu', 'Close menu')} onClick={() => setMenu(false)} />}
    <aside className={`sidebar ${menu ? 'is-open' : ''}`}><Brand /><button className="icon-button sidebar-close" onClick={() => setMenu(false)} aria-label={t('Đóng menu', 'Close menu')}><X size={20} /></button><div className="workspace-label"><span className="workspace-mark"><GraduationCap size={19} /></span><span><strong>UED Workspace</strong><small>{t('Không gian sinh viên', 'Your student space')}</small></span></div><span className="nav-section-label">{t('KHÔNG GIAN CỦA BẠN', 'YOUR WORKSPACE')}</span><nav aria-label={t('Điều hướng chính', 'Main navigation')}>{nav.map(item => <button key={item.id} className={`nav-item ${view === item.id ? 'active' : ''}`} onClick={() => navigate(item.id)} aria-current={view === item.id ? 'page' : undefined}><item.icon size={19} /><span>{item.label}</span>{!!item.count && <span className="nav-count">{item.count > 99 ? '99+' : item.count}</span>}</button>)}</nav><div className="sidebar-bottom"><div className="routine-note"><Coffee size={22} /><strong>{t('Cả nghỉ ngơi cũng quan trọng.', 'Rest is part of the plan.')}</strong><p>{t('Chúng mình luôn giữ khoảng nghỉ trong lịch gợi ý của bạn.', 'Your breaks stay protected in every suggested plan.')}</p><button className="text-link" onClick={() => navigate('settings')}>{t('Nhịp sinh hoạt của tôi', 'My daily routine')}<ArrowRight size={13} /></button></div><div className="profile"><span className="avatar">{user.name.trim().split(/\s+/).slice(-1)[0]?.slice(0, 1).toUpperCase() || 'S'}</span><span><strong>{user.name}</strong><small>{user.isDemo ? t('Tài khoản demo', 'Demo account') : t('Sinh viên UED', 'UED student')}</small></span><button className="icon-button" onClick={logout} disabled={busy} aria-label={t('Đăng xuất', 'Sign out')} title={t('Đăng xuất', 'Sign out')}><LogOut size={17} /></button></div></div></aside>
    <div className="main-layout"><header className="topbar"><div className="breadcrumb"><button className="icon-button menu-button" aria-label={t('Mở menu', 'Open menu')} onClick={() => setMenu(true)}><Menu size={21} /></button><span className="breadcrumb-home">{t('Không gian của tôi', 'My workspace')}</span><span className="breadcrumb-divider">/</span><strong>{nav.find(item => item.id === view)?.label}</strong></div><div className="topbar-actions"><span className="topbar-date">{formatDate(new Date(), user.timezone, 'EEE, dd MMM', locale)}</span><button className="language-switch" onClick={() => chooseLocale(locale === 'vi' ? 'en' : 'vi')}>{locale === 'vi' ? 'VI' : 'EN'}<ChevronRight size={12} /></button><button className="icon-button notification-button" onClick={() => navigate('notifications')} aria-label={t(`${unread} thông báo chưa đọc`, `${unread} unread notifications`)}><Bell size={19} />{unread > 0 && <span />}</button><span className="mini-avatar">{user.name.trim().slice(0, 1).toUpperCase()}</span></div></header>
      <main id="main-content" className="main-content" tabIndex={-1}>
        {user.isDemo && <div className="demo-banner"><span className="badge">DEMO</span><span>{t('Bạn đang trải nghiệm dữ liệu minh họa, chưa đồng bộ với tài khoản trường.', 'You are exploring sample data, not data synced from a school account.')}</span></div>}
        <div className="page-heading"><div><span className="eyebrow">{view === 'dashboard' ? t(`CHÀO ${user.name.trim().split(/\s+/).slice(-1)[0].toUpperCase()}, NGÀY MỚI TỐT LÀNH`, `HELLO ${user.name.trim().split(/\s+/).slice(-1)[0].toUpperCase()}, MAKE TODAY YOURS`) : 'PERSONAL AUTOMATED SCHEDULE'}</span><h1>{titles[view][0]}</h1><p>{titles[view][1]}</p></div><div className="page-heading-actions"><button className="icon-button" onClick={refresh} disabled={loading || busy} aria-label={t('Tải lại dữ liệu', 'Refresh data')} title={t('Tải lại dữ liệu', 'Refresh data')}><RefreshCw size={18} className={loading ? 'spin' : ''} /></button>{['dashboard', 'calendar', 'tasks', 'suggestions'].includes(view) && <button className="button button-primary" onClick={() => setDialog({ kind: 'plan' })} disabled={!data}><Sparkles size={17} />{t('Gợi ý xếp lịch', 'Plan my time')}</button>}</div></div>
        {error && <div className="global-error"><ErrorNotice>{error}</ErrorNotice><button className="icon-button" onClick={() => setError('')} aria-label={t('Ẩn lỗi', 'Dismiss error')}><X size={16} /></button></div>}
        {!data ? <section className="panel loading-panel"><Spinner /><p>{t('Đang tải lịch và công việc của bạn…', 'Loading your calendar and tasks…')}</p>{!loading && <button className="button button-secondary" onClick={refresh}>{t('Thử lại', 'Try again')}</button>}</section> : <>
          {view === 'dashboard' && <Dashboard data={data} user={user} locale={locale} t={t} days={days} forDay={forDay} selectedDay={selectedDay} selectDay={setSelectedDay} waiting={waiting} navigate={navigate} showAgenda={showAgenda} showTask={showTask} newTask={() => setDialog({ kind: 'task' })} showSuggestion={suggestion => setDialog({ kind: 'proposal', suggestion })} now={now} />}
          {view === 'calendar' && <CalendarPage data={data} user={user} locale={locale} t={t} days={days} week={week} setWeek={setWeek} selectedDay={selectedDay} setSelectedDay={setSelectedDay} forDay={forDay} showAgenda={showAgenda} addEvent={day => { setSelectedDay(day); setDialog({ kind: 'event' }); }} showEvent={event => setDialog({ kind: 'event-detail', event })} loading={loading} now={now} />}
          {view === 'tasks' && <TasksPage tasks={data.tasks} user={user} locale={locale} t={t} open={showTask} create={() => setDialog({ kind: 'task' })} />}
          {view === 'suggestions' && <SuggestionsPage suggestions={data.suggestions} user={user} locale={locale} t={t} open={suggestion => setDialog({ kind: 'proposal', suggestion })} create={() => setDialog({ kind: 'plan' })} />}
          {view === 'notifications' && <NotificationsPage notifications={data.notifications} user={user} locale={locale} t={t} busy={busy} read={id => globalAction(() => mutate(id ? `/notifications/${id}/read` : '/notifications/read-all', 'POST', {}, t('Đã đánh dấu đã đọc.', 'Marked as read.')))} />}
          {view === 'integrations' && <IntegrationsPage integrations={data.integrations} records={data.academicRecords} config={config} user={user} locale={locale} t={t} busy={busy} connectUed={() => setDialog({ kind: 'ued' })} saveTerm={async body => { await mutate('/integrations/ued/term', 'PATCH', body, t('Đã đổi học kỳ. Dữ liệu sẽ cập nhật sau khi đồng bộ.', 'Term updated. Records will refresh after syncing.')); }} sync={provider => globalAction(() => mutate(`/integrations/${provider}/sync`, 'POST', {}, t('Đã yêu cầu đồng bộ. Kết quả sẽ tự cập nhật tại đây.', 'Sync requested. Results will update here automatically.')))} disconnect={provider => { if (window.confirm(t(`Ngắt kết nối ${provider}? Các lịch đã chấp nhận vẫn được giữ lại.`, `Disconnect ${provider}? Your accepted calendar events will be kept.`))) void globalAction(() => mutate(`/integrations/${provider}`, 'DELETE', undefined, t('Đã ngắt kết nối.', 'Disconnected.'))); }} />}
          {view === 'settings' && <SettingsPage key={user.id} user={user} locale={locale} t={t} save={async body => { const result = await api<{ user: User }>('/settings', 'PATCH', body); setUser(result.user); chooseLocale(result.user.locale); await bootstrap(); }} />}
        </>}
        <footer className="page-footer"><span>UED · Personal Automated Schedule</span><span>{t('Từng bước nhỏ. Một hành trình dài.', 'Small steps. A meaningful journey.')}</span></footer>
      </main>
    </div>
    {toast && <div className="toast" role="status"><CheckCheck size={18} />{toast}<button onClick={() => setToast('')} aria-label={t('Đóng', 'Close')}><X size={15} /></button></div>}
    {dialog?.kind === 'ued' && <UedConnect locale={locale} t={t} connected={value => { identify(value); void refresh(); }} close={close} />}
    {dialog?.kind === 'task' && <TaskForm task={dialog.task} user={user} locale={locale} t={t} close={close} save={async (body, id) => { await mutate(id ? `/tasks/${id}` : '/tasks', id ? 'PATCH' : 'POST', body, t('Đã lưu công việc.', 'Task saved.')); }} />}
    {dialog?.kind === 'event' && <EventForm event={dialog.event} day={selectedDay} user={user} locale={locale} t={t} close={close} save={async (body, id) => { await mutate(id ? `/events/${id}` : '/events', id ? 'PATCH' : 'POST', body, t('Đã lưu sự kiện.', 'Event saved.')); }} />}
    {dialog?.kind === 'plan' && <PlanForm user={user} locale={locale} t={t} close={close} propose={async (fromDate, toDate) => { const suggestion = await api<Suggestion>('/scheduling/proposals', 'POST', { fromDate, toDate }); await bootstrap(); setDialog({ kind: 'proposal', suggestion }); }} />}
    {dialog?.kind === 'proposal' && <SuggestionDetails suggestion={dialog.suggestion} user={user} locale={locale} t={t} close={close} decide={async (id, action) => { await mutate(`/suggestions/${id}/${action}`, 'POST', {}, action === 'accept' ? t('Đã cập nhật lịch theo đề xuất bạn chọn.', 'Your calendar has been updated with your choice.') : t('Đã từ chối đề xuất.', 'Proposal declined.')); }} />}
    {dialog?.kind === 'task-detail' && <TaskDetails task={data?.tasks.find(task => task.id === dialog.task.id) || dialog.task} user={user} locale={locale} t={t} close={close} edit={task => setDialog({ kind: 'task', task })} status={async (task, status) => { await mutate(`/tasks/${task.id}/status`, 'PATCH', { status }, t('Đã cập nhật trạng thái.', 'Status updated.')); close(); }} unschedule={async task => { await mutate(`/tasks/${task.id}/unschedule`, 'POST', {}, t('Đã bỏ các phiên học chưa bắt đầu. Bạn có thể tạo gợi ý mới.', 'Future sessions removed. You can generate a new plan.')); close(); }} />}
    {dialog?.kind === 'event-detail' && <EventDetails event={dialog.event} user={user} locale={locale} t={t} close={close} edit={event => setDialog({ kind: 'event', event })} status={async (event, status) => { await mutate(`/events/${event.id}/status`, 'PATCH', { status }, t('Đã cập nhật sự kiện.', 'Event updated.')); close(); }} />}
  </div>;
}
function Brand() { return <div className="brand"><span className="brand-icon"><CalendarCheck2 size={24} /></span><span>uni<span className="brand-accent">rhythm</span><small>PLAN A LITTLE. LIVE A LOT.</small></span></div>; }
