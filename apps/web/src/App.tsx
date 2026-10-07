import { lazy, Suspense, useCallback, useEffect, useRef, useState } from 'react';
import { ArrowRight, BookOpen, CalendarCheck2, CheckCheck, GraduationCap, RefreshCw, Sparkles, X } from 'lucide-react';
import { ConfirmDialog, ErrorNotice, Spinner, type Translate } from './components';
import { isPersonalEvent } from './calendar-data';
import { AppShell, PageHeader } from './AppShell';

const EventForm = lazy(() => import('./components').then(m => ({ default: m.EventForm })));
const EventDetails = lazy(() => import('./workspace').then(m => ({ default: m.EventDetails })));
const TaskForm = lazy(() => import('./Tasks').then(m => ({ default: m.TaskForm })));
const TasksPage = lazy(() => import('./Tasks').then(m => ({ default: m.TasksPage })));
const TaskDetails = lazy(() => import('./Tasks').then(m => ({ default: m.TaskDetails })));
const CalendarPage = lazy(() => import('./Calendar').then(m => ({ default: m.CalendarPage })));
const PlanForm = lazy(() => import('./Planner').then(m => ({ default: m.PlanForm })));
const SuggestionDetails = lazy(() => import('./Planner').then(m => ({ default: m.SuggestionDetails })));
const SuggestionsPage = lazy(() => import('./Planner').then(m => ({ default: m.SuggestionsPage })));
const IntegrationsPage = lazy(() => import('./pages').then(m => ({ default: m.IntegrationsPage })));
const NotificationsPage = lazy(() => import('./pages').then(m => ({ default: m.NotificationsPage })));
const SettingsPage = lazy(() => import('./pages').then(m => ({ default: m.SettingsPage })));
const Dashboard = lazy(() => import('./Dashboard').then(m => ({ default: m.Dashboard })));
const UedConnect = lazy(() => import('./UedConnect'));
import { api, ApiError, calendarRollover, dayStart, errorMessage, localDay, monday, shiftDay } from './lib';
import { isSuggestionPending } from './suggestions';
import { ServerClock } from './server-clock';
import { appendUniqueTasks, preserveExpandedHistory } from './task-history';
import type { AgendaItem, AuthConfig, Bootstrap, CalendarEvent, Locale, Suggestion, Task, TaskHistoryResponse, User, View } from './types';

type Dialog = { kind: 'task'; task?: Task } | { kind: 'event'; event?: CalendarEvent } | { kind: 'task-detail'; task: Task } | { kind: 'event-detail'; event: CalendarEvent } | { kind: 'proposal'; suggestion: Suggestion } | { kind: 'plan' } | { kind: 'ued' } | { kind: 'confirm-disconnect'; provider: string } | null;
const validViews: View[] = ['dashboard', 'calendar', 'tasks', 'suggestions', 'notifications', 'integrations', 'settings'];
const readLocale = (): Locale => { try { return localStorage.getItem('schedule-locale') === 'en' ? 'en' : 'vi'; } catch { return 'vi'; } };
const readView = (): View => { const hash = location.hash.slice(1); if (hash === 'calendar/suggestions') return 'suggestions'; const value = hash as View; return validViews.includes(value) ? value : 'dashboard'; };
export { isSuggestionPending as isPending } from './suggestions';

export default function App() {
  const [locale, setLocale] = useState<Locale>(readLocale), [view, setView] = useState<View>(readView);
  const [config, setConfig] = useState<AuthConfig>({ demoEnabled: false, microsoftEnabled: false, uedEnabled: false });
  const [user, setUser] = useState<User | null>(null), [data, setData] = useState<Bootstrap | null>(null);
  const [initializing, setInitializing] = useState(true), [loading, setLoading] = useState(false), [busy, setBusy] = useState(false);
  const [error, setError] = useState(''), [toast, setToast] = useState(''), [menu, setMenu] = useState(false), [dialog, setDialog] = useState<Dialog>(null);
  const [week, setWeek] = useState(monday(localDay('Asia/Ho_Chi_Minh'))), [selectedDay, setSelectedDay] = useState(localDay('Asia/Ho_Chi_Minh'));
  const [now, setNow] = useState(() => Date.now());
  const [loadedWeek, setLoadedWeek] = useState<string | null>(null);
  const [taskHistoryLoading, setTaskHistoryLoading] = useState(false);
  const requestNumber = useRef(0);
  const trackedToday = useRef<{ userId: string; day: string } | null>(null);
  const clock = useRef(new ServerClock());
  const expandedTaskHistory = useRef(false);
  const historyRequest = useRef(0);
  const lastForegroundRefresh = useRef(0);
  const localeRef = useRef(locale); localeRef.current = locale;
  const busyRef = useRef(busy); busyRef.current = busy;
  const dialogRef = useRef(dialog); dialogRef.current = dialog;
  const t: Translate = (vi, en) => locale === 'vi' ? vi : en;
  const chooseLocale = (value: Locale) => { setLocale(value); try { localStorage.setItem('schedule-locale', value); } catch { /* Browser storage is optional. */ } };
  const identify = (value: User) => {
    expandedTaskHistory.current = false; historyRequest.current++; setTaskHistoryLoading(false);
    const instant = clock.current.now();
    const day = localDay(value.timezone, instant);
    trackedToday.current = { userId: value.id, day };
    setNow(instant); setUser(value); chooseLocale(value.locale); setWeek(monday(day)); setSelectedDay(day);
  };
  const bootstrap = useCallback(async () => {
    if (!user) return;
    const request = ++requestNumber.current;
    const requestStartedAt = performance.now();
    const params = new URLSearchParams({ fromDate: dayStart(week, user.timezone), toDate: dayStart(shiftDay(week, 7), user.timezone) });
    try {
      const result = await api<Bootstrap>(`/bootstrap?${params}`);
      if (request !== requestNumber.current) return;
      const responseReceivedAt = performance.now();
      if (clock.current.synchronize(result.agendaOverview.asOf, requestStartedAt, responseReceivedAt)) {
        setNow(clock.current.now());
      }
      setData(current => expandedTaskHistory.current ? preserveExpandedHistory(current, result) : result); setLoadedWeek(week); setUser(previous => previous?.id === result.user.id ? result.user : previous);
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
    } catch (err) { setError(errorMessage(err, localeRef.current)); } finally { setInitializing(false); }
  };
  useEffect(() => { void initialize(); }, []);
  useEffect(() => {
    if (!user) return;
    let mounted = true; setLoading(true); setError('');
    void bootstrap().catch(err => { if (mounted) setError(errorMessage(err, localeRef.current)); }).finally(() => { if (mounted) setLoading(false); });
    return () => { mounted = false; requestNumber.current++; };
  }, [bootstrap]);
  useEffect(() => {
    if (!user) return;
    const interval = setInterval(() => { if (document.visibilityState === 'visible' && !busyRef.current && !dialogRef.current) void bootstrap().catch(() => undefined); }, 30_000);
    return () => clearInterval(interval);
  }, [bootstrap, user?.id]);
  useEffect(() => {
    if (!user) return;
    const refreshForeground = () => {
      if (document.visibilityState !== 'visible') return;
      const deviceNow = performance.now();
      setNow(clock.current.now());
      // Browsers commonly emit focus and visibilitychange together.
      if (deviceNow - lastForegroundRefresh.current < 750) return;
      lastForegroundRefresh.current = deviceNow;
      if (!busy && !dialog) void bootstrap().catch(err => setError(errorMessage(err, locale)));
    };
    document.addEventListener('visibilitychange', refreshForeground);
    window.addEventListener('focus', refreshForeground);
    return () => {
      document.removeEventListener('visibilitychange', refreshForeground);
      window.removeEventListener('focus', refreshForeground);
    };
  }, [bootstrap, busy, dialog, locale, user?.id]);
  useEffect(() => { document.documentElement.lang = locale; }, [locale]);
  useEffect(() => {
    // Update badges at activity boundaries as well as periodically; do not wait
    // for a network refresh to mark a just-ended activity as past.
    const instant = clock.current.now();
    const items = data ? [...data.events, ...data.blocks, ...data.agendaOverview.today.events, ...data.agendaOverview.today.blocks] : [];
    const boundaries = items.flatMap(item => [Date.parse(item.startTime), Date.parse(item.endTime)]);
    if (user) boundaries.push(Date.parse(dayStart(shiftDay(localDay(user.timezone, instant), 1), user.timezone)));
    const next = Math.min(instant + 30_000, ...boundaries.filter(value => value > instant));
    const timer = setTimeout(() => setNow(clock.current.now()), Math.max(1, next - instant + 1));
    return () => clearTimeout(timer);
  }, [data, now, user?.timezone]);
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
  useEffect(() => {
    const changed = () => {
      const next = readView(); setView(next); setMenu(false);
      if (next === 'dashboard' && user) {
        const day = localDay(user.timezone, clock.current.now());
        setWeek(monday(day)); setSelectedDay(day);
      }
    };
    window.addEventListener('hashchange', changed);
    return () => window.removeEventListener('hashchange', changed);
  }, [user?.id, user?.timezone]);
  useEffect(() => { if (!toast) return; const timer = setTimeout(() => setToast(''), 5000); return () => clearTimeout(timer); }, [toast]);
  useEffect(() => {
    const query = new URLSearchParams(location.search);
    if (query.has('authError')) setError(errorMessage(new ApiError('Microsoft sign-in failed', 400, query.get('authError') || ''), locale));
    if (query.get('outlook') === 'connected') setToast(t('Outlook đã được kết nối.', 'Outlook is connected.'));
    if (query.has('authError') || query.has('outlook')) history.replaceState(null, '', `${location.pathname}${location.hash}`);
  }, []);
  const navigate = (next: View) => { location.hash = next === 'suggestions' ? 'calendar/suggestions' : next; setView(next); setMenu(false); if (next === 'dashboard' && user) { const day = localDay(user.timezone, now); setWeek(monday(day)); setSelectedDay(day); } };
  const refresh = async () => { setLoading(true); setError(''); try { await bootstrap(); } catch (err) { setError(errorMessage(err, locale)); } finally { setLoading(false); } };
  const mutate = async (path: string, method: string, body?: unknown, message?: string) => {
    const result = await api(path, method, body);
    await bootstrap(); if (message) setToast(message); return result;
  };
  // A successful write and a failed refresh are different outcomes. Closing a
  // saved event prevents retrying a non-idempotent POST and creating duplicates.
  const calendarMutation = async (path: string, method: string, body: unknown, message: string, afterCommit?: () => void) => {
    await api(path, method, body);
    afterCommit?.();
    try { await bootstrap(); }
    catch (err) { setError(`${t('Thao tác đã được lưu, nhưng chưa tải lại được lịch.', 'Your change was saved, but the calendar could not be refreshed.')} ${errorMessage(err, locale)}`); }
    setToast(message);
  };
  // Keep the committed task even if the follow-up refresh fails. Never invite
  // a second POST just because reading the updated workspace was unavailable.
  const taskMutation = async (path: string, method: string, body: unknown, message: string, previousTask?: Task) => {
    const saved = await api<Task>(path, method, body);
    setData(current => {
      if (!current) return current;
      // A Calendar session may expose an older task outside the loaded history
      // page. Retain its known status so committed changes keep global counts
      // correct even when the follow-up bootstrap is unavailable.
      const previous = current.tasks.find(task => task.id === saved.id)
        || (previousTask?.id === saved.id ? previousTask : undefined);
      const bucket = (status: Task['status']) => status === 'COMPLETED' ? 'completed' : status === 'CANCELLED' ? 'cancelled' : 'active';
      const stats = { ...current.taskStats };
      if (previous) { stats[bucket(previous.status)]--; stats[bucket(saved.status)]++; }
      else if (path === '/tasks') stats[bucket(saved.status)]++;
      return { ...current, tasks: appendUniqueTasks(current.tasks, [saved]), taskStats: stats };
    });
    try { await bootstrap(); setError(''); }
    catch (err) { setError(`${t('Công việc đã được lưu, nhưng chưa tải lại được lịch và các phiên học. Không cần lưu lại.', 'The task was saved, but calendar and sessions could not be refreshed. Do not submit again.')} ${errorMessage(err, locale)}`); }
    setToast(message);
  };
  const loadMoreTaskHistory = async () => {
    const cursor = data?.taskHistoryPage.nextCursor;
    const owner = user?.id;
    if (!cursor || taskHistoryLoading) return;
    const request = ++historyRequest.current;
    setTaskHistoryLoading(true); setError('');
    try {
      const result = await api<TaskHistoryResponse>(`/tasks/history?cursor=${encodeURIComponent(cursor)}`);
      setData(current => {
        if (!current || current.user.id !== owner || historyRequest.current !== request || current.taskHistoryPage.nextCursor !== cursor) return current;
        expandedTaskHistory.current = true;
        return { ...current, tasks: appendUniqueTasks(current.tasks, result.tasks),
          taskHistoryPage: { ...current.taskHistoryPage, ...result.page } };
      });
    } catch (err) { if (request === historyRequest.current) setError(errorMessage(err, locale)); }
    finally { if (request === historyRequest.current) setTaskHistoryLoading(false); }
  };
  const globalAction = async (action: () => Promise<unknown>) => { setBusy(true); setError(''); try { await action(); } catch (err) { setError(errorMessage(err, locale)); } finally { setBusy(false); } };
  const close = useCallback(() => setDialog(null), []);
  const beginDemo = () => globalAction(async () => { identify((await api<{ user: User }>('/auth/demo', 'POST', {})).user); navigate('dashboard'); });
  const logout = () => globalAction(async () => { await api('/auth/logout', 'POST', {}); requestNumber.current++; historyRequest.current++; expandedTaskHistory.current = false; setTaskHistoryLoading(false); setUser(null); setData(null); setDialog(null); setMenu(false); });
  const showTask = (task: Task) => setDialog({ kind: 'task-detail', task });
  const showAgenda = (item: AgendaItem) => item.event ? setDialog({ kind: 'event-detail', event: item.event }) : item.task && showTask(item.task);
  const days = Array.from({ length: 7 }, (_, index) => shiftDay(week, index));
  const waiting = data?.suggestions.filter(suggestion => isSuggestionPending(suggestion, now)) || [], unread = data?.notifications.filter(item => !item.readAt).length || 0;
  if (initializing) return <main className="loading-screen"><Brand /><Spinner /><p>{t('Đang mở không gian học tập của bạn…', 'Opening your study space…')}</p></main>;
  if (!user) return <><main className="welcome"><section className="welcome-story"><Brand /><div className="welcome-copy"><span className="eyebrow">{t('MỘT NHỊP HỌC, THẬT RIÊNG BẠN', 'A STUDY RHYTHM OF YOUR OWN')}</span><h1>{t('Sắp xếp một ngày.', 'Plan your day.')}<br /><em>{t('Dành chỗ cho tương lai.', 'Make room for tomorrow.')}</em></h1><p>{t('Lịch học, công việc và những khoảng nghỉ. Kết nối mọi thứ, để bạn tập trung vào điều quan trọng.', 'Classes, tasks, and a little breathing room. Bring it all together, and focus on what matters.')}</p><div className="welcome-promises"><span><CalendarCheck2 />{t('Lịch học trong một nơi', 'Your studies, in one place')}</span><span><Sparkles />{t('Gợi ý phù hợp với bạn', 'Suggestions that fit your day')}</span><span><CheckCheck />{t('Bạn luôn là người quyết định', 'You always make the call')}</span></div></div><p className="welcome-university"><GraduationCap size={18} />{t('Đại học Sư phạm · Đại học Đà Nẵng', 'University of Education · The University of Danang')}</p><div className="welcome-orbit" aria-hidden="true"><div /><div /><div /><span><BookOpen size={48} /></span></div></section><section className="welcome-login"><button className="language-switch" onClick={() => chooseLocale(locale === 'vi' ? 'en' : 'vi')}>{locale === 'vi' ? 'English' : 'Tiếng Việt'}<span>↗</span></button><div className="login-content"><span className="login-icon"><GraduationCap size={30} /></span><h2>{t('Chào bạn, sinh viên UED.', 'Hello, UED student.')}</h2><p>{t('Một ngày chủ động hơn bắt đầu từ đây.', 'A more intentional day starts here.')}</p>{error && <ErrorNotice>{error}</ErrorNotice>}{config.uedEnabled && <button className="button button-primary login-button" disabled={busy} onClick={() => setDialog({ kind: 'ued' })}><GraduationCap size={19} />{t('Đăng nhập bằng mã sinh viên', 'Sign in with your student ID')}<ArrowRight size={18} /></button>}{!config.uedEnabled && <div className="callout callout-amber">{t('Kết nối tài khoản trường đang được chuẩn bị. Bạn có thể trải nghiệm bản demo nếu khả dụng.', 'School account sign-in is being prepared. You can explore the demo when available.')}</div>}{config.demoEnabled && <><div className="login-divider"><span>{t('hoặc tìm hiểu trước', 'or take a look around')}</span></div><button className="button button-quiet login-button" disabled={busy} onClick={beginDemo}>{busy ? <Spinner /> : <ArrowRight size={18} />}{t('Khám phá bản demo', 'Explore the demo')}</button><small>{t('Không cần tài khoản. Dữ liệu minh họa được ghi nhãn rõ ràng.', 'No account needed. Sample data is clearly labelled.')}</small></>}{error && <button className="text-link" onClick={initialize}>{t('Kiểm tra kết nối lại', 'Check connection again')}<RefreshCw size={14} /></button>}<p className="login-footnote">{t('Đăng nhập bằng mã sinh viên UED. Outlook chỉ là kết nối tùy chọn sau đăng nhập. Mật khẩu UED không được lưu lại.', 'Sign in with your student ID. Outlook is an optional connection after sign-in. Your UED password is never stored.')}</p></div><span className="welcome-footer">Personal Automated Schedule for Students</span></section></main>{dialog?.kind === 'ued' && <Suspense fallback={null}><UedConnect locale={locale} t={t} connected={identify} close={close} /></Suspense>}</>;
  const titles: Record<View, [string, string]> = {
    dashboard: [t('Tổng quan', 'Dashboard'), ''],
    calendar: [t('Lịch của tôi', 'Calendar'), t('Lớp học, lịch cá nhân và các phiên tự học đã xác nhận.', 'Classes, personal events and confirmed study sessions.')],
    tasks: [t('Công việc', 'Tasks'), t('Quản lý deadline, thời lượng và tiến độ công việc.', 'Manage task deadlines, duration and progress.')],
    suggestions: [t('Đề xuất xếp lịch', 'Schedule suggestions'), t('Xem và xác nhận trước khi thay đổi lịch.', 'Review and confirm before changing your calendar.')],
    notifications: [t('Thông báo', 'Notifications'), t('Cập nhật đồng bộ, đề xuất và nhắc việc.', 'Sync updates, suggestions and reminders.')],
    integrations: [t('Kết nối dữ liệu', 'Data connections'), t('UED là nguồn lịch học chính. Outlook là kết nối tùy chọn.', 'UED is the primary timetable source. Outlook is optional.')],
    settings: [t('Cài đặt', 'Settings'), t('Giờ hoạt động, giờ nghỉ và quy tắc xếp lịch.', 'Active hours, breaks and scheduling rules.')],
  };
  return <>
    <AppShell user={user} locale={locale} t={t} view={view} now={now} unread={unread}
      loading={loading} busy={busy} menuOpen={menu} setMenuOpen={setMenu} navigate={navigate}
      refresh={() => void refresh()} logout={() => void logout()} chooseLocale={chooseLocale}>
        {!['dashboard', 'calendar', 'suggestions', 'tasks'].includes(view) && <PageHeader title={titles[view][0]} description={titles[view][1]} />}
        {error && <div className="global-error"><ErrorNotice>{error}</ErrorNotice><button className="icon-button" onClick={() => setError('')} aria-label={t('Ẩn lỗi', 'Dismiss error')}><X size={16} /></button></div>}
        {!data ? <section className="panel loading-panel"><Spinner /><p>{t('Đang tải lịch và công việc của bạn…', 'Loading your calendar and tasks…')}</p>{!loading && <button className="button button-secondary" onClick={refresh}>{t('Thử lại', 'Try again')}</button>}</section> : <Suspense fallback={<section className="panel loading-panel"><Spinner /><p>{t('Đang tải…', 'Loading…')}</p></section>}>
          {view === 'dashboard' && <Dashboard data={data} user={user} locale={locale} t={t} navigate={navigate} showAgenda={showAgenda} showTask={showTask} newTask={() => setDialog({ kind: 'task' })} now={now} week={week} loading={loading} />}
          {view === 'calendar' && <CalendarPage data={data} user={user} locale={locale} t={t} days={days} week={week} setWeek={setWeek} selectedDay={selectedDay} setSelectedDay={setSelectedDay} addEvent={day => { setSelectedDay(day); setDialog({ kind: 'event' }); }} showEvent={event => setDialog({ kind: 'event-detail', event })} showTask={showTask} openSuggestions={() => navigate('suggestions')} pendingCount={waiting.length} loading={loading} rangeReady={loadedWeek === week} error={error} retry={() => void refresh()} historyLoading={taskHistoryLoading} loadMoreHistory={loadMoreTaskHistory} now={now} />}
          {view === 'tasks' && <TasksPage tasks={data.tasks} stats={data.taskStats} historyPage={data.taskHistoryPage} historyLoading={taskHistoryLoading} loadMoreHistory={loadMoreTaskHistory} now={now} user={user} locale={locale} t={t} open={showTask} create={() => setDialog({ kind: 'task' })} planner={() => navigate('suggestions')} loading={loading} error={error} retry={() => void refresh()} />}
          {view === 'suggestions' && <SuggestionsPage suggestions={data.suggestions} tasks={data.tasks} now={now} user={user} locale={locale} t={t} open={suggestion => setDialog({ kind: 'proposal', suggestion })} create={() => setDialog({ kind: 'plan' })} back={() => navigate('calendar')} />}
          {view === 'notifications' && <NotificationsPage notifications={data.notifications} user={user} locale={locale} t={t} busy={busy} read={id => globalAction(() => mutate(id ? `/notifications/${id}/read` : '/notifications/read-all', 'POST', {}, t('Đã đánh dấu đã đọc.', 'Marked as read.')))} />}
          {view === 'integrations' && <IntegrationsPage integrations={data.integrations} records={data.academicRecords} config={config} user={user} locale={locale} t={t} busy={busy} connectUed={() => setDialog({ kind: 'ued' })} saveTerm={async body => { await mutate('/integrations/ued/term', 'PATCH', body, t('Đã đổi học kỳ. Dữ liệu sẽ cập nhật sau khi đồng bộ.', 'Term updated. Records will refresh after syncing.')); }} sync={provider => globalAction(() => mutate(`/integrations/${provider}/sync`, 'POST', {}, t('Đã yêu cầu đồng bộ. Kết quả sẽ tự cập nhật tại đây.', 'Sync requested. Results will update here automatically.')))} disconnect={provider => setDialog({ kind: 'confirm-disconnect', provider })} />}
          {view === 'settings' && <SettingsPage key={user.id} user={user} locale={locale} t={t} save={async body => { const result = await api<{ user: User }>('/settings', 'PATCH', body); setUser(result.user); chooseLocale(result.user.locale); await bootstrap(); }} />}
        </Suspense>}
    </AppShell>
    {toast && <div className="toast" role="status"><CheckCheck size={18} />{toast}<button onClick={() => setToast('')} aria-label={t('Đóng', 'Close')}><X size={15} /></button></div>}
    {dialog?.kind === 'confirm-disconnect' && <ConfirmDialog title={t(`Ngắt kết nối ${dialog.provider}`, `Disconnect ${dialog.provider}`)} message={t(`Ngắt kết nối ${dialog.provider}? Các lịch đã chấp nhận vẫn được giữ lại.`, `Disconnect ${dialog.provider}? Your accepted calendar events will be kept.`)} confirmLabel={t('Ngắt kết nối', 'Disconnect')} cancelLabel={t('Hủy', 'Cancel')} danger busy={busy} onConfirm={async () => { const provider = dialog.provider; close(); await globalAction(() => mutate(`/integrations/${provider}`, 'DELETE', undefined, t('Đã ngắt kết nối.', 'Disconnected.'))); }} onCancel={close} />}
    <Suspense fallback={null}>
      {dialog?.kind === 'ued' && <UedConnect locale={locale} t={t} connected={value => { identify(value); void refresh(); }} close={close} />}
      {dialog?.kind === 'task' && <TaskForm now={now} task={dialog.task} user={user} locale={locale} t={t} close={close} save={async (body, id) => { await taskMutation(id ? `/tasks/${id}` : '/tasks', id ? 'PATCH' : 'POST', body, t('Đã lưu công việc.', 'Task saved.')); }} />}
      {dialog?.kind === 'event' && <EventForm event={dialog.event} day={selectedDay} user={user} locale={locale} t={t} close={close} save={async (body, id) => { if (dialog.event && !isPersonalEvent(dialog.event)) return; await calendarMutation(id ? `/events/${id}` : '/events', id ? 'PATCH' : 'POST', body, t('Đã lưu lịch cá nhân.', 'Personal event saved.')); }} />}
      {dialog?.kind === 'plan' && <PlanForm now={now} user={user} locale={locale} t={t} close={close} propose={async (fromDate, toDate) => { const suggestion = await api<Suggestion>('/scheduling/proposals', 'POST', { fromDate, toDate }); setData(current => current ? { ...current, suggestions: [suggestion, ...current.suggestions.filter(item => item.id !== suggestion.id)] } : current); try { await bootstrap(); } catch (err) { setError(errorMessage(err, locale)); } setDialog({ kind: 'proposal', suggestion }); }} />}
      {dialog?.kind === 'proposal' && <SuggestionDetails now={now} suggestion={data?.suggestions.find(item => item.id === dialog.suggestion.id) || dialog.suggestion} tasks={data?.tasks} user={user} locale={locale} t={t} close={close} decide={async (id, action) => { await calendarMutation(`/suggestions/${id}/${action}`, 'POST', {}, action === 'accept' ? t('Đã cập nhật lịch theo đề xuất bạn chọn.', 'Your calendar has been updated with your choice.') : t('Đã bỏ đề xuất.', 'Proposal dismissed.'), () => setData(current => current ? { ...current, suggestions: current.suggestions.map(item => item.id === id ? { ...item, status: action === 'accept' ? 'ACCEPTED' : 'REJECTED' } : item) } : current)); }} />}
      {dialog?.kind === 'task-detail' && <TaskDetails key={dialog.task.id} now={now} task={data?.tasks.find(task => task.id === dialog.task.id) || dialog.task} user={user} locale={locale} t={t} close={close} edit={task => setDialog({ kind: 'task', task })} planner={() => { close(); navigate('suggestions'); }} status={async (task, status) => { await taskMutation(`/tasks/${task.id}/status`, 'PATCH', { status }, t('Đã cập nhật trạng thái.', 'Status updated.'), task); close(); }} unschedule={async task => { await taskMutation(`/tasks/${task.id}/unschedule`, 'POST', {}, t('Đã bỏ các phiên học chưa bắt đầu. Bạn có thể tạo gợi ý mới.', 'Future sessions removed. You can generate a new plan.'), task); close(); }} />}
      {dialog?.kind === 'event-detail' && <EventDetails event={dialog.event} user={user} locale={locale} t={t} close={close} edit={event => { if (isPersonalEvent(event)) setDialog({ kind: 'event', event }); }} status={async (event, status) => { if (!isPersonalEvent(event)) return; await calendarMutation(`/events/${event.id}/status`, 'PATCH', { status }, t('Đã cập nhật lịch cá nhân.', 'Personal event updated.')); close(); }} />}
    </Suspense>
  </>;
}
function Brand() { return <div className="brand"><span className="brand-icon"><CalendarCheck2 size={24} /></span><span>uni<span className="brand-accent">rhythm</span><small>PLAN A LITTLE. LIVE A LOT.</small></span></div>; }
