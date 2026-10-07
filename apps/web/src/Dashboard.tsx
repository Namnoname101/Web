import { useMemo, useState, type ReactNode } from 'react';
import { ArrowRight, CalendarCheck2, CalendarDays, CheckCheck, ChevronRight, Clock3, GraduationCap, Link2, ListTodo, LockKeyhole, Mail, MapPin, Moon, Plus, Settings2, Sparkles, Sun, Sunrise } from 'lucide-react';
import { PageHeader, Panel } from './AppShell';
import { Empty, PriorityBadge, type Translate } from './components';
import { buildAgendaView, temporalState } from './agenda';
import { dashboardMetrics, groupTodayByDaypart } from './dashboard-data';
import { formatDate, minutes, timeSetting } from './lib';
import type { AgendaItem, Bootstrap, Locale, Suggestion, Task, User, View } from './types';
import { isSuggestionPending } from './suggestions';
import './dashboard.css';

type Context = { user: User; locale: Locale; t: Translate; now: number };
type Props = Context & { data: Bootstrap; week: string; loading: boolean; navigate: (view: View) => void; showAgenda: (item: AgendaItem) => void; showTask: (task: Task) => void; newTask: () => void };
type Scope = 'TODAY' | 'UPCOMING' | 'PAST';

function StatCard({ icon, label, value, note }: { icon: ReactNode; label: string; value: string; note: string }) {
  return <article className="dash-stat"><span className="dash-stat-icon" aria-hidden="true">{icon}</span><h2>{label}</h2><strong>{value}</strong><p>{note}</p></article>;
}

function itemKind(item: AgendaItem, t: Translate) {
  if (item.event?.source === 'SCHOOL_PORTAL') return t('Lớp UED · Chỉ xem', 'UED class · Read-only');
  if (item.kind === 'TASK') return t('Phiên tự học', 'Study session');
  // Keep legacy event types readable without creating new deadline events.
  if (item.kind === 'CLASS') return t('Lớp học', 'Class');
  if (item.kind === 'DEADLINE') return t('Mốc lịch cũ', 'Legacy calendar item');
  return t('Lịch cá nhân', 'Personal event');
}

function DashboardAgendaItem({ item, user, locale, t, now, showDate, open }: Context & { item: AgendaItem; showDate: boolean; open: () => void }) {
  const state = temporalState(item, now);
  const sameDay = formatDate(item.startTime, user.timezone, 'yyyy-MM-dd') === formatDate(item.endTime, user.timezone, 'yyyy-MM-dd');
  return <button className={`dash-agenda-item event-${item.kind.toLowerCase()} is-${state.toLowerCase()}`} onClick={open}>
    <span className="dash-agenda-marker" aria-hidden="true" />
    <span className="dash-agenda-copy"><strong>{item.title}</strong>
      <span>{showDate && `${formatDate(item.startTime, user.timezone, 'EEE, dd/MM · ', locale)}`}{formatDate(item.startTime, user.timezone, 'HH:mm', locale)}–{formatDate(item.endTime, user.timezone, sameDay ? 'HH:mm' : 'dd/MM HH:mm', locale)}{item.location && <> · {item.location}</>}</span>
      <span className="dash-source">{item.event?.source === 'SCHOOL_PORTAL' && <LockKeyhole size={11} />}{itemKind(item, t)}</span>
    </span>
    <span className={`dash-temporal state-${state.toLowerCase()}`}>{state === 'PAST' ? t('Đã qua', 'Past') : state === 'CURRENT' ? t('Đang diễn ra', 'In progress') : t('Sắp tới', 'Upcoming')}</span>
  </button>;
}

function TodaySchedule({ data, user, locale, t, now, navigate, showAgenda, agenda }: Pick<Props, 'data' | 'user' | 'locale' | 't' | 'now' | 'navigate' | 'showAgenda'> & { agenda: ReturnType<typeof buildAgendaView> }) {
  const [scope, setScope] = useState<Scope>('TODAY');
  const scopes = [['TODAY', t('Hôm nay', 'Today'), agenda.today.length], ['UPCOMING', t('Sắp tới', 'Upcoming'), agenda.upcoming.length], ['PAST', t('Đã qua', 'Past'), agenda.past.length]] as const;
  const rows = scope === 'TODAY' ? agenda.today : scope === 'UPCOMING' ? agenda.upcoming : agenda.past;
  const card = (item: AgendaItem) => <DashboardAgendaItem key={item.id} item={item} user={user} locale={locale} t={t} now={now} showDate={scope !== 'TODAY'} open={() => showAgenda(item)} />;
  const dayparts = {
    morning: { label: t('Buổi sáng', 'Morning'), range: '05:00–11:59', icon: Sunrise },
    afternoon: { label: t('Trưa & chiều', 'Afternoon'), range: '12:00–17:59', icon: Sun },
    evening: { label: t('Buổi tối', 'Evening'), range: '18:00–23:00', icon: Moon },
    outside: { label: t('Ngoài các khung giờ trên', 'Outside these hours'), range: '', icon: Clock3 },
  };
  return <Panel className="dash-today" title={t('Lịch hôm nay', "Today's schedule")} description={t(`${agenda.today.length} hoạt động · ${agenda.pastToday.length} đã qua`, `${agenda.today.length} activities · ${agenda.pastToday.length} past`)} action={<button className="button button-quiet small-button" onClick={() => navigate('calendar')}>{t('Xem lịch tuần', 'Open week')}</button>}>
    <div className="dash-scope-tabs" role="tablist" aria-label={t('Phạm vi lịch trình', 'Schedule range')}>
      {scopes.map(([value, label, count], index) => <button id={`dash-tab-${value}`} key={value} role="tab" aria-selected={scope === value} aria-controls="dash-agenda-panel" tabIndex={scope === value ? 0 : -1} onClick={() => setScope(value)} onKeyDown={event => {
        const next = event.key === 'ArrowRight' ? (index + 1) % 3 : event.key === 'ArrowLeft' ? (index + 2) % 3 : event.key === 'Home' ? 0 : event.key === 'End' ? 2 : null;
        if (next === null) return;
        event.preventDefault(); setScope(scopes[next][0]); document.getElementById(`dash-tab-${scopes[next][0]}`)?.focus();
      }}>{label} <span>{count}</span></button>)}
    </div>
    <div id="dash-agenda-panel" role="tabpanel" aria-labelledby={`dash-tab-${scope}`} tabIndex={0} className="dash-agenda-list">
      {scope === 'TODAY' ? groupTodayByDaypart(agenda.today, user.timezone, data.agendaOverview.dayStart).map(group => {
        const { label, range, icon: Icon } = dayparts[group.id];
        return <section className={`dash-daypart daypart-${group.id}`} key={group.id} aria-label={label}>
          <h3><span className="dash-daypart-icon"><Icon size={13} /></span>{label}<small>{range}</small></h3>
          {group.items.length ? group.items.map(card) : <p className="dash-daypart-empty">{t('Chưa có lịch', 'No scheduled activities')}</p>}
        </section>;
      }) : rows.length ? rows.map(card) : <Empty icon={<CalendarDays size={22} />} title={scope === 'PAST' ? t('Chưa có lịch đã qua', 'No past activities') : t('Chưa có lịch sắp tới', 'No upcoming activities')} description={t('Lịch đã xác nhận sẽ xuất hiện tại đây.', 'Confirmed activities appear here.')} />}
    </div>
    {scope !== 'TODAY' && rows.length === data.agendaOverview.limit && <p className="dash-list-note">{t(`Hiển thị ${data.agendaOverview.limit} hoạt động ${scope === 'PAST' ? 'gần nhất' : 'tiếp theo'}. Mở lịch tuần để xem thêm.`, `Showing ${data.agendaOverview.limit} ${scope === 'PAST' ? 'recent' : 'next'} activities. Open the calendar for more.`)}</p>}
  </Panel>;
}

function DeadlineRow({ task, user, locale, t, now, open }: Context & { task: Task; open: () => void }) {
  return <button className="dash-task-row" onClick={open}><span className="dash-task-check" aria-hidden="true" /><span className="dash-task-copy"><strong>{task.title}</strong><span className={Date.parse(task.deadline) < now ? 'dash-overdue' : ''}>Deadline {formatDate(task.deadline, user.timezone, 'dd/MM · HH:mm', locale)} · {minutes(task.durationMinutes, locale)}{Date.parse(task.deadline) < now && ` · ${t('Quá hạn', 'Overdue')}`}</span><small><CalendarCheck2 size={12} />{task.isScheduled ? t('Đã xếp lịch', 'Scheduled') : t('Chưa xếp đủ lịch', 'Not fully scheduled')}</small></span><PriorityBadge priority={task.priority} t={t} /></button>;
}

export function Dashboard({ data, user, locale, t, now, week, loading, navigate, showAgenda, showTask, newTask }: Props) {
  const agenda = useMemo(() => buildAgendaView(data.agendaOverview, data.tasks, now, t('Phiên tự học', 'Study session')), [data.agendaOverview, data.tasks, now, locale]);
  const metrics = useMemo(() => dashboardMetrics(data, now, week, user.timezone), [data, now, week, user.timezone]);
  const pending = useMemo(() => data.suggestions.filter((item: Suggestion) => isSuggestionPending(item, now)), [data.suggestions, now]);
  const plans = useMemo(() => pending.filter((item: Suggestion) => item.kind === 'TASK_PLAN'), [pending]);
  const unread = useMemo(() => data.notifications.filter((item: { readAt: string | null }) => !item.readAt).length, [data.notifications]);
  const focus = agenda.current[0] || agenda.next;
  const focusCurrent = focus && temporalState(focus, now) === 'CURRENT';
  const deltaMinutes = focus ? Math.max(0, Math.ceil((Date.parse(focus.startTime) - now) / 60_000)) : 0;
  const hours = Number(formatDate(new Date(now), user.timezone, 'H'));
  const title = hours < 12 ? t('Buổi sáng của bạn', 'Your morning') : hours < 18 ? t('Trưa & chiều của bạn', 'Your afternoon') : t('Buổi tối của bạn', 'Your evening');
  const openPlanner = () => navigate('suggestions');
  const integrationLabel = (status: string) => ({ CONNECTED: t('Đã kết nối', 'Connected'), REAUTH_REQUIRED: t('Cần xác thực lại', 'Sign in again'), ERROR: t('Cần kiểm tra', 'Needs attention'), DISCONNECTED: t('Chưa kết nối', 'Not connected') })[status] || t('Chưa kết nối', 'Not connected');

  return <div className="dashboard-pilot">
    <PageHeader eyebrow={t('TỔNG QUAN HÔM NAY', 'TODAY AT A GLANCE')} title={title}
      description={`${formatDate(data.agendaOverview.dayStart, user.timezone, 'EEEE, dd/MM/yyyy', locale)} · ${t(`${agenda.today.length} hoạt động, ${data.taskStats.active} việc cần làm.`, `${agenda.today.length} activities, ${data.taskStats.active} active tasks.`)}`}
      actions={<button className="button button-primary" onClick={openPlanner}><Sparkles size={17} />{t('Gợi ý xếp lịch', 'Plan my time')}</button>} />
    <div className="dash-priority-grid">
      <Panel className="dash-next">
        <span className="dash-next-time" aria-hidden="true">{focus ? <><strong>{formatDate(focus.startTime, user.timezone, 'HH:mm', locale)}</strong><small>{formatDate(focus.startTime, user.timezone, 'dd/MM', locale)}</small></> : <CalendarDays size={24} />}</span>
        <div className="dash-next-copy"><span className="app-eyebrow">{focusCurrent ? t('ĐANG DIỄN RA', 'IN PROGRESS') : t('LỊCH TIẾP THEO', 'NEXT ACTIVITY')}</span>
          <h2>{focus ? <button onClick={() => showAgenda(focus)}>{focus.title}<ChevronRight size={15} /></button> : t('Chưa có lịch sắp tới', 'No upcoming activities')}</h2>
          {focus ? <><p>{formatDate(focus.startTime, user.timezone, 'EEE, dd/MM · HH:mm', locale)}–{formatDate(focus.endTime, user.timezone, 'dd/MM HH:mm', locale)}{!focusCurrent && ` · ${t('còn', 'in')} ${minutes(deltaMinutes, locale)}`}</p>{focus.location && <p><MapPin size={12} />{focus.location}</p>}<small>{itemKind(focus, t)}</small></> : <p>{t('Mở lịch để xem hoặc thêm lịch cá nhân.', 'Open the calendar to view or add a personal event.')}</p>}
        </div><button className="button button-quiet small-button" onClick={() => navigate('calendar')}>{t('Mở lịch', 'Open calendar')}</button>
      </Panel>
      <Panel className="dash-attention" title={t('Cần chú ý', 'Needs attention')}>
        <button onClick={() => navigate('tasks')}><span>{t('Deadline trong 48 giờ', 'Deadlines within 48 hours')}</span><strong>{metrics.nearDeadlineCount}</strong><ChevronRight size={13} /></button>
        {metrics.overdueCount > 0 && <button onClick={() => navigate('tasks')}><span>{t('Việc đã quá hạn', 'Overdue tasks')}</span><strong className="dash-overdue">{metrics.overdueCount}</strong><ChevronRight size={13} /></button>}
        <button onClick={openPlanner}><span>{t('Đề xuất tự học chờ xác nhận', 'Pending study plans')}</span><strong>{plans.length}</strong><ChevronRight size={13} /></button>
        <button onClick={() => navigate('notifications')}><span>{t('Thông báo chưa đọc', 'Unread notifications')}</span><strong>{unread}</strong><ChevronRight size={13} /></button>
        <p className="dash-list-note">{t('Đề xuất và thông báo: trong danh sách đã tải.', 'Suggestions and notifications: in the loaded list.')}</p>
      </Panel>
    </div>
    <div className="dash-stats">
      <StatCard icon={<CalendarDays size={18} />} label={t('Lịch hôm nay', "Today's activities")} value={String(agenda.today.length)} note={t(`${agenda.pastToday.length} hoạt động đã qua`, `${agenda.pastToday.length} past activities`)} />
      <StatCard icon={<ListTodo size={18} />} label={t('Việc cần làm', 'Active tasks')} value={String(data.taskStats.active)} note={t(`${metrics.scheduledTaskCount} đã xếp lịch · ${data.taskStats.completed} đã hoàn thành`, `${metrics.scheduledTaskCount} scheduled · ${data.taskStats.completed} completed`)} />
      <StatCard icon={<Clock3 size={18} />} label={t('Tự học tuần này', 'Study time this week')} value={loading ? '…' : minutes(Math.round(metrics.focusMinutes), locale)} note={t('Phiên đã xác nhận trên lịch', 'Confirmed sessions on calendar')} />
      <StatCard icon={<CalendarCheck2 size={18} />} label={t('Deadline gần', 'Near deadlines')} value={String(metrics.nearDeadlineCount)} note={t('Trong 48 giờ tới', 'Within the next 48 hours')} />
    </div>
    <div className="dash-main-grid"><div className="dash-stack">
      <TodaySchedule data={data} user={user} locale={locale} t={t} now={now} navigate={navigate} showAgenda={showAgenda} agenda={agenda} />
      <Panel title={t('Deadline gần', 'Near deadlines')} description={t('Các việc chưa hoàn thành, theo deadline gần nhất.', 'Unfinished tasks ordered by nearest deadline.')} action={<button className="icon-button" onClick={newTask} aria-label={t('Thêm công việc', 'Add task')}><Plus size={18} /></button>}>
        {metrics.activeTasks.length ? <div className="dash-task-list">{metrics.activeTasks.slice(0, 4).map((task: Task) => <DeadlineRow key={task.id} task={task} user={user} locale={locale} t={t} now={now} open={() => showTask(task)} />)}<button className="text-link" onClick={() => navigate('tasks')}>{t('Xem công việc', 'View tasks')}<ArrowRight size={14} /></button></div> : <Empty icon={<CheckCheck size={22} />} title={t('Chưa có việc cần làm', 'No active tasks')} description={t('Thêm công việc với deadline và thời lượng để nhận đề xuất.', 'Add a task with a deadline and duration to receive a plan.')} action={<button className="button button-secondary" onClick={newTask}><Plus size={16} />{t('Thêm công việc', 'Add task')}</button>} />}
      </Panel>
    </div><div className="dash-stack">
      <Panel className="dash-planner"><span className="dash-planner-icon"><Sparkles size={23} /></span><span className="app-eyebrow">{t('ĐỀ XUẤT LỊCH', 'SCHEDULE SUGGESTIONS')}</span><h2>{t(`${plans.length} đề xuất tự học đang chờ xác nhận`, `${plans.length} study plans awaiting confirmation`)}</h2><p>{t('Các phiên đề xuất chưa được thêm vào lịch. Bạn xem lại và xác nhận trước khi áp dụng.', 'Proposed sessions are not on your calendar. Review and confirm before applying.')}</p>{pending.length > plans.length && <p>{t(`${pending.length - plans.length} đề xuất thay đổi lịch khác cần xem.`, `${pending.length - plans.length} other calendar changes to review.`)}</p>}<button className="button button-primary" onClick={openPlanner}>{t('Xem đề xuất', 'Review suggestions')}<ArrowRight size={15} /></button></Panel>
      <Panel title={t('Quy tắc xếp lịch', 'Scheduling rules')} className="dash-rules">
        <dl><div><dt>{t('Có thể xếp tự học', 'Active hours')}</dt><dd>{timeSetting(user.activeStartTime)}–{timeSetting(user.activeEndTime)}</dd></div><div><dt>{t('Giờ nghỉ', 'Break')}</dt><dd>{timeSetting(user.breakStartTime)}–{timeSetting(user.breakEndTime)}</dd></div><div><dt>{t('Di chuyển', 'Travel buffer')}</dt><dd>{user.travelMinutes} {t('phút', 'min')}</dd></div><div><dt>{t('Phiên tối thiểu', 'Minimum session')}</dt><dd>{user.minBlockMinutes} {t('phút', 'min')}</dd></div></dl><p>{user.timezone}</p><button className="button button-quiet" onClick={() => navigate('settings')}><Settings2 size={15} />{t('Mở cài đặt', 'Open settings')}</button>
      </Panel>
      <Panel title={t('Kết nối dữ liệu', 'Data connections')} className="dash-connections">
        {(['UED', 'OUTLOOK'] as const).map(provider => { const status = data.integrations.find(item => item.provider === provider)?.status || 'DISCONNECTED'; return <button key={provider} onClick={() => navigate('integrations')}><span className={`dash-provider provider-${provider.toLowerCase()}`}>{provider === 'UED' ? <GraduationCap size={20} /> : <Mail size={20} />}</span><span><strong>{provider === 'UED' ? t('Cổng sinh viên UED', 'UED student portal') : 'Microsoft Outlook'}</strong><small>{provider === 'UED' ? t('Nguồn lịch học chính', 'Primary timetable source') : t('Tùy chọn · Theo dõi email', 'Optional · Email updates')}</small><span className={`dash-connection-state connection-${status.toLowerCase()}`}><i />{integrationLabel(status)}</span></span><Link2 size={14} /></button>; })}
      </Panel>
    </div></div>
  </div>;
}
