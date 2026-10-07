import { useEffect, useMemo, useRef, useState, type FormEvent } from 'react';
import { ArrowDownToLine, CalendarCheck2, Check, ChevronRight, Clock3, ListTodo, MapPin, Pencil, Plus, RefreshCw, Search, Sparkles } from 'lucide-react';
import { PageHeader, Panel } from './AppShell';
import { ConfirmDialog, Empty, ErrorNotice, Field, Modal, PriorityBadge, Spinner, type Translate } from './components';
import { ApiError, errorMessage, formatDate, localDay, minutes, shiftDay, toInput } from './lib';
import { temporalState } from './agenda';
import { useTaskSessions } from './use-task-sessions';
import { blockMinutes, filterTasks, isActiveTask, sessionDurationLabel, taskDeadlineInput, taskMetrics, taskSessionSummary, type TaskFilter } from './task-data';
import type { Locale, Task, TaskHistoryPage, TaskStats, User } from './types';
import './tasks.css';

type Context = { now: number; user: User; locale: Locale; t: Translate };
const statusLabel = (task: Task, t: Translate) => ({ PENDING: t('Cần làm', 'To do'), IN_PROGRESS: t('Đang thực hiện', 'In progress'), COMPLETED: t('Đã hoàn thành', 'Completed'), CANCELLED: t('Đã hủy', 'Cancelled') })[task.status];

export function TasksPage({ now, tasks, stats, historyPage, historyLoading, loadMoreHistory, user, locale, t, open, create, planner, loading, error, retry }: Context & {
  tasks: Task[]; stats: TaskStats; historyPage: TaskHistoryPage; historyLoading: boolean; loadMoreHistory: () => Promise<void>;
  open: (task: Task) => void; create: () => void; planner: () => void; loading: boolean; error: string; retry: () => void;
}) {
  const [filter, setFilter] = useState<TaskFilter>('active'), [search, setSearch] = useState(''), [priority, setPriority] = useState('all');
  const filtered = useMemo(() => filterTasks(tasks, filter, search, priority), [tasks, filter, search, priority]);
  const metrics = useMemo(() => taskMetrics(tasks, now), [tasks, now]);
  const narrowed = Boolean(search.trim()) || priority !== 'all';
  return <div className="tasks-workspace">
    <PageHeader eyebrow={t('CÔNG VIỆC', 'TASKS')} title={t('Việc cần làm', 'Tasks to do')}
      description={t('Quản lý deadline, thời lượng và độ ưu tiên. Planner đề xuất các phiên tự học trước hạn để bạn xem và xác nhận.', 'Manage deadlines, duration and priority. Review and confirm study sessions proposed by the planner.')}
      actions={<button className="button button-primary" onClick={create}><Plus size={17} />{t('Thêm công việc', 'Add a task')}</button>} />
    <div className="tasks-summary">
      <article><h2>{t('Cần làm', 'To do')}</h2><strong>{stats.active}</strong><p>{t(`${metrics.scheduled} việc đã xếp đủ lịch`, `${metrics.scheduled} tasks fully scheduled`)}</p></article>
      <article><h2>{t('Deadline gần', 'Near deadlines')}</h2><strong>{metrics.near}</strong><p>{t('Trong 48 giờ tới', 'Within the next 48 hours')}{metrics.overdue > 0 && <span className="tasks-overdue"> · {metrics.overdue} {t('việc quá hạn', 'overdue tasks')}</span>}</p></article>
      <article><h2>{t('Đã hoàn thành', 'Completed')}</h2><strong>{stats.completed}</strong><p>{t('Tổng toàn bộ lịch sử', 'Across all history')}</p></article>
    </div>
    <div className="tasks-planner-link"><p><Sparkles size={16} />{t('Công việc chưa tự chiếm chỗ trên lịch. Chỉ phiên tự học đã xác nhận mới được thêm.', 'A task does not reserve calendar time. Only confirmed study sessions are added.')}</p><button className="button button-secondary small-button" onClick={planner}>{t('Đề xuất xếp lịch', 'Schedule suggestions')}<ChevronRight size={14} /></button></div>
    <Panel title={t('Deadline sớm trước', 'Earliest deadlines first')} description={t('Cùng deadline: ưu tiên Cao → Vừa → Thấp.', 'Same deadline: High → Medium → Low priority.')}>
      <div className="tasks-toolbar"><div className="tasks-filters" role="group" aria-label={t('Lọc trạng thái công việc', 'Filter task status')}>
        {([['active', t('Cần làm', 'To do')], ['scheduled', t('Đã xếp lịch', 'Scheduled')], ['COMPLETED', t('Hoàn thành', 'Completed')], ['all', t('Tất cả', 'All')]] as const).map(([value, label]) => <button key={value} aria-pressed={filter === value} onClick={() => setFilter(value)}>{label}</button>)}
      </div><div className="tasks-search-controls"><label className="tasks-search"><Search size={15} /><input aria-label={t('Tìm công việc', 'Search tasks')} placeholder={t('Tìm công việc…', 'Search tasks…')} value={search} onChange={event => setSearch(event.target.value)} /></label><select aria-label={t('Lọc độ ưu tiên', 'Filter priority')} value={priority} onChange={event => setPriority(event.target.value)}><option value="all">{t('Mọi ưu tiên', 'All priorities')}</option><option value="HIGH">{t('Cao', 'High')}</option><option value="MEDIUM">{t('Vừa', 'Medium')}</option><option value="LOW">{t('Thấp', 'Low')}</option></select></div></div>
      {error && <div className="tasks-load-error" role="status"><p>{t('Chưa cập nhật được dữ liệu. Đang hiển thị danh sách đã tải.', 'Refresh failed. Showing previously loaded tasks.')}</p><button className="button button-secondary small-button" disabled={loading} onClick={retry}>{t('Thử lại', 'Retry')}</button></div>}
      {loading && <p className="tasks-loading" role="status"><Spinner />{t('Đang tải công việc…', 'Loading tasks…')}</p>}
      <div aria-busy={loading}>{filtered.length ? <div className="tasks-list">{filtered.map(task => {
        const overdue = isActiveTask(task) && Date.parse(task.deadline) < now;
        return <button key={task.id} className={`tasks-row tasks-${task.status.toLowerCase()}`} onClick={() => open(task)}>
          <span className="tasks-check" aria-hidden="true">{task.status === 'COMPLETED' ? <Check size={14} /> : task.status === 'CANCELLED' ? '−' : null}</span>
          <span className="tasks-copy"><strong>{task.title}</strong><span className={`tasks-deadline ${overdue ? 'tasks-overdue' : ''}`}>Deadline {formatDate(task.deadline, user.timezone, 'dd/MM/yyyy · HH:mm', locale)}{overdue && ` · ${t('Quá hạn', 'Overdue')}`}</span>
            <span className="tasks-row-meta"><span><Clock3 size={12} />{minutes(task.durationMinutes, locale)}</span><span>{statusLabel(task, t)}</span></span>
            <span className={`tasks-plan-state ${task.isScheduled ? 'scheduled' : ''}`}><CalendarCheck2 size={12} />{isActiveTask(task) ? task.isScheduled ? t('Đã xếp lịch · Xem chi tiết các phiên', 'Scheduled · View session details') : t('Chưa xếp đủ lịch', 'Not fully scheduled') : t('Xem lịch sử phiên học', 'View session history')}</span>
          </span><PriorityBadge priority={task.priority} t={t} /><ChevronRight size={16} />
        </button>;
      })}</div> : !loading && <Empty icon={<ListTodo size={24} />} title={narrowed ? t('Không có công việc phù hợp với bộ lọc.', 'No tasks match these filters.') : filter === 'COMPLETED' ? t('Chưa có công việc hoàn thành trong danh sách đã tải.', 'No completed tasks in the loaded list.') : filter === 'scheduled' ? t('Chưa có công việc được xếp đủ lịch.', 'No fully scheduled tasks.') : t('Chưa có công việc nào.', 'No tasks yet.')}
        description={narrowed ? t('Thử từ khóa hoặc độ ưu tiên khác.', 'Try another search or priority.') : filter === 'COMPLETED' ? t('Công việc hoàn thành được giữ lại trong lịch sử.', 'Completed tasks stay in history.') : t('Thêm công việc có deadline và thời lượng dự kiến.', 'Add a task with a deadline and estimated duration.')} />}</div>
      {historyPage.hasMore && (filter === 'COMPLETED' || filter === 'all') && <div className="tasks-history"><p>{t('Bộ lọc và tìm kiếm chỉ áp dụng cho lịch sử đã tải. Tải thêm để xem các công việc cũ hơn.', 'Search and filters cover loaded history only. Load more for older tasks.')}</p><button className="button button-quiet" disabled={historyLoading || loading} onClick={() => void loadMoreHistory()}>{historyLoading ? <Spinner /> : <ArrowDownToLine size={16} />}{t('Tải thêm lịch sử công việc', 'Load more task history')}</button></div>}
    </Panel>
  </div>;
}

export function TaskForm({ now, task, user, locale, t, save, close }: Context & { task?: Task; save: (body: Record<string, unknown>, id?: string) => Promise<void>; close: () => void }) {
  const [error, setError] = useState(''), [busy, setBusy] = useState(false), [duration, setDuration] = useState(String(task?.durationMinutes ?? 60));
  const submitting = useRef(false), errorBox = useRef<HTMLDivElement>(null);
  useEffect(() => { if (error) errorBox.current?.scrollIntoView({ block: 'nearest' }); }, [error]);
  const submit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault(); if (submitting.current) return;
    const fields = new FormData(event.currentTarget); submitting.current = true; setBusy(true); setError('');
    try {
      const title = String(fields.get('title')).trim(), durationMinutes = Number(duration);
      if (!title) throw new Error(t('Nhập tên công việc.', 'Enter a task name.'));
      if (!Number.isInteger(durationMinutes) || durationMinutes < 15 || durationMinutes > 43200) throw new Error(t('Thời lượng phải là số nguyên từ 15 đến 43.200 phút.', 'Duration must be a whole number from 15 to 43,200 minutes.'));
      const deadline = taskDeadlineInput(String(fields.get('deadline')), user.timezone, task);
      if (Date.parse(deadline) <= now) throw new Error(t('Deadline đã qua. Hãy chọn một thời điểm trong tương lai.', 'The deadline has passed. Choose a future time.'));
      await save({ title, deadline, durationMinutes, priority: fields.get('priority'), location: String(fields.get('location')).trim() || null, notes: String(fields.get('notes')), isSplittable: fields.get('isSplittable') === 'on' }, task?.id);
      close();
    } catch (err) { setError(err instanceof ApiError && err.code === 'UNSCHEDULE_FIRST'
      ? t('Còn phiên học ở trạng thái Đã lên lịch, kể cả phiên đã qua. Máy chủ chưa cho đổi deadline, thời lượng, địa điểm hoặc cách chia phiên. Bạn vẫn có thể sửa tên, ghi chú và ưu tiên.', 'Scheduled sessions remain, including past sessions. The server blocks changes to deadline, duration, location or splitting. Title, notes and priority can still be edited.') : errorMessage(err, locale));
    } finally { submitting.current = false; setBusy(false); }
  };
  return <Modal drawer className="task-drawer" title={task ? t('Chỉnh sửa công việc', 'Edit task') : t('Thêm công việc', 'Add a task')} subtitle={t('Deadline là hạn hoàn thành; thời lượng là tổng thời gian cần làm.', 'The deadline is the due time; duration is the total estimated work.')} onClose={close} busy={busy}>
    <form className="task-drawer-form" onSubmit={submit}><div className="task-drawer-body">
      {error && <div ref={errorBox}><ErrorNotice>{error}</ErrorNotice></div>}
      <fieldset disabled={busy} className="task-drawer-fields">
        <Field label={t('Tên công việc', 'Task name')}><input name="title" required maxLength={255} defaultValue={task?.title || ''} placeholder={t('Ví dụ: Hoàn thiện báo cáo học phần', 'e.g. Finish the course report')} /></Field>
        <Field label="Deadline" hint={user.timezone}><input name="deadline" type="datetime-local" required defaultValue={task ? toInput(task.deadline, user.timezone) : `${shiftDay(localDay(user.timezone, now), 2)}T22:00`} /></Field>
        <div><Field label={t('Thời lượng dự kiến', 'Estimated duration')} hint={t('Tổng số phút cần để hoàn thành công việc.', 'Total minutes needed to finish the task.')}><input name="durationMinutes" type="number" min={15} max={43200} step={1} required value={duration} onChange={event => setDuration(event.target.value)} /></Field>
          <div className="task-duration-presets" role="group" aria-label={t('Chọn nhanh thời lượng', 'Duration presets')}>{[[30, t('30 phút', '30 min')], [60, t('1 giờ', '1 hour')], [90, t('1,5 giờ', '1.5 hours')], [120, t('2 giờ', '2 hours')]].map(([value, label]) => <button type="button" key={value} aria-pressed={Number(duration) === value} onClick={() => setDuration(String(value))}>{label}</button>)}</div>
        </div>
        <Field label={t('Độ ưu tiên', 'Priority')}><select name="priority" defaultValue={task?.priority || 'MEDIUM'}><option value="HIGH">{t('Cao', 'High')}</option><option value="MEDIUM">{t('Vừa', 'Medium')}</option><option value="LOW">{t('Thấp', 'Low')}</option></select></Field>
        <Field label={t('Địa điểm học', 'Study location')} hint={t('Không bắt buộc.', 'Optional.')}><input name="location" maxLength={255} defaultValue={task ? task.location ?? '' : user.studyLocation ?? ''} placeholder={t('Ví dụ: Thư viện UED', 'e.g. UED Library')} /></Field>
        <Field label={t('Ghi chú', 'Notes')} hint={t('Không bắt buộc.', 'Optional.')}><textarea name="notes" rows={3} maxLength={5000} defaultValue={task?.notes || ''} /></Field>
        <label className="task-split"><input type="checkbox" name="isSplittable" defaultChecked={task?.isSplittable ?? true} /><span><strong>{t('Cho phép chia thành nhiều phiên', 'Allow multiple sessions')}</strong><small>{t('Nếu bật, planner có thể chia tổng thời lượng thành nhiều phiên trước deadline.', 'When enabled, the planner can split the total duration into sessions before the deadline.')}</small></span></label>
        <p className="task-explanation">{t(`Phiên học tối thiểu theo cài đặt: ${user.minBlockMinutes} phút.`, `Minimum study session from settings: ${user.minBlockMinutes} minutes.`)}</p>
        {task?.isScheduled && <p className="task-explanation">{t('Công việc đã có lịch. Thay đổi các trường ảnh hưởng phiên học có thể bị máy chủ từ chối; tên, ghi chú và ưu tiên vẫn sửa được.', 'This task has a schedule. The server may reject changes affecting sessions; title, notes and priority can still be edited.')}</p>}
        <p className="task-explanation">{t('Sau khi tạo công việc, bạn có thể dùng Đề xuất xếp lịch để tìm các phiên tự học phù hợp. Công việc chưa tự chiếm chỗ trên lịch.', 'After creating a task, use Schedule suggestions to find suitable study sessions. The task itself does not reserve calendar time.')}</p>
      </fieldset>
    </div><div className="task-drawer-footer"><button type="button" className="button button-quiet" disabled={busy} onClick={close}>{t('Hủy', 'Cancel')}</button><button type="submit" className="button button-primary" disabled={busy}>{busy ? <Spinner /> : <Check size={16} />}{task ? t('Lưu thay đổi', 'Save changes') : t('Tạo công việc', 'Create task')}</button></div></form>
  </Modal>;
}

export function TaskDetails({ task, now, user, locale, t, close, edit, status, unschedule, planner }: Context & { task: Task; close: () => void; edit: (task: Task) => void; status: (task: Task, status: Task['status']) => Promise<void>; unschedule: (task: Task) => Promise<void>; planner: () => void }) {
  const [busy, setBusy] = useState(false), [error, setError] = useState('');
  const [confirmAction, setConfirmAction] = useState<'unschedule' | 'cancel' | null>(null);
  const submitting = useRef(false), errorBox = useRef<HTMLDivElement>(null);
  const sessions = useTaskSessions(task, locale);
  const summary = sessions.result ? taskSessionSummary(task.id, sessions.result) : null;
  const active = isActiveTask(task), overdue = active && Date.parse(task.deadline) < now;
  useEffect(() => { if (error) errorBox.current?.scrollIntoView({ block: 'nearest' }); }, [error]);
  const act = async (fn: () => Promise<void>) => { if (submitting.current) return; submitting.current = true; setBusy(true); setError(''); try { await fn(); } catch (err) { setError(errorMessage(err, locale)); } finally { submitting.current = false; setBusy(false); } };
  return <>
    <Modal drawer className="task-drawer" title={task.title} subtitle={t('Thông tin công việc và các phiên tự học đã xác nhận.', 'Task details and confirmed study sessions.')} onClose={close} busy={busy}>
      <div className="task-drawer-body task-detail-body">
        {error && <div ref={errorBox}><ErrorNotice>{error}</ErrorNotice></div>}
        <dl className="task-detail-grid"><div><dt>Deadline:</dt><dd className={overdue ? 'tasks-overdue' : ''}>{formatDate(task.deadline, user.timezone, 'dd/MM/yyyy · HH:mm', locale)}{overdue && <small>{t('Quá hạn', 'Overdue')}</small>}</dd></div><div><dt>{t('Thời lượng dự kiến', 'Estimated duration')}</dt><dd>{minutes(task.durationMinutes, locale)}</dd></div><div><dt>{t('Độ ưu tiên', 'Priority')}</dt><dd><PriorityBadge priority={task.priority} t={t} /></dd></div><div><dt>{t('Trạng thái công việc', 'Task status')}</dt><dd>{statusLabel(task, t)}</dd></div></dl>
        <p className="task-detail-context">{user.timezone} · {task.isSplittable ? t('Cho phép chia thành nhiều phiên', 'Multiple sessions allowed') : t('Cần một phiên liên tục', 'One continuous session required')}</p>
        <section className="task-sessions" aria-label={t('Các phiên học đã lưu', 'Saved study sessions')}><h3>{t('Tiến độ xếp lịch', 'Scheduling progress')}</h3>
          {summary && <div className="task-explanation">
            {summary.complete ? <><strong>{active ? t(`Đã xếp ${summary.scheduledMinutes === task.durationMinutes ? 'đủ ' : ''}${Math.round(summary.scheduledMinutes * 10) / 10}/${task.durationMinutes} phút`, `Scheduled ${Math.round(summary.scheduledMinutes * 10) / 10}/${task.durationMinutes} minutes`) : t(`${summary.blocks.length} phiên học được giữ trong lịch sử`, `${summary.blocks.length} sessions kept in history`)}</strong><p>{t(`${summary.blocks.length} phiên tự học đã xác nhận`, `${summary.blocks.length} confirmed study sessions`)}</p></> : <><strong>{t(`Đã tải ${summary.blocks.length} phiên · Chưa phải tổng đầy đủ`, `${summary.blocks.length} sessions loaded · Not a complete total`)}</strong><p>{t(`${Math.round(summary.scheduledMinutes * 10) / 10} phút ở trạng thái Đã lên lịch trong phần đã tải.`, `${Math.round(summary.scheduledMinutes * 10) / 10} scheduled minutes in the loaded portion.`)}</p></>}
            {summary.completedMinutes > 0 && <p>{t(`${Math.round(summary.completedMinutes * 10) / 10} phút phiên đã hoàn thành${summary.complete ? '' : ' trong phần đã tải'}.`, `${Math.round(summary.completedMinutes * 10) / 10} completed session minutes${summary.complete ? '' : ' in the loaded portion'}.`)}</p>}
            <small>{t('Đây là thời lượng trên lịch, không phải phần trăm công việc đã làm. Đề xuất chưa xác nhận không được tính.', 'This is calendar time, not task completion progress. Pending proposals are not counted.')}</small>
          </div>}
          {summary?.blocks.length === 0 && !sessions.loading && !sessions.error && <p className="task-detail-context">{t('Chưa có phiên học được lưu.', 'No saved study sessions.')}</p>}
          <div className="task-session-list">{summary?.blocks.map(block => {
            const state = temporalState(block, now);
            return <article className="task-session-row" key={block.id}><span className="task-session-icon"><CalendarCheck2 size={17} /></span><div><strong>{formatDate(block.startTime, user.timezone, 'dd/MM/yyyy · HH:mm', locale)}–{formatDate(block.endTime, user.timezone, localDay(user.timezone, Date.parse(block.startTime)) === localDay(user.timezone, Date.parse(block.endTime)) ? 'HH:mm' : 'dd/MM/yyyy HH:mm', locale)}</strong><p>{sessionDurationLabel(blockMinutes(block), locale)} · {block.location || t('Chưa có địa điểm', 'No location')}</p><span className="task-session-state">{block.status === 'COMPLETED' ? t('Đã hoàn thành', 'Completed') : state === 'PAST' ? t('Đã qua', 'Past') : state === 'CURRENT' ? t('Đang diễn ra', 'In progress') : t('Đã lên lịch', 'Scheduled')}</span></div></article>;
          })}</div>
          {sessions.loading && <p className="tasks-loading" role="status"><Spinner />{t('Đang tải phiên học…', 'Loading sessions…')}</p>}
          {sessions.error && <><ErrorNotice>{sessions.error}</ErrorNotice><button className="button button-quiet" disabled={sessions.loading} onClick={() => void sessions.retry()}>{t('Thử lại', 'Retry')}</button></>}
          {sessions.result?.page.hasMore && !sessions.error && <button className="button button-quiet" disabled={sessions.loading} onClick={() => void sessions.loadMore()}>{t('Tải thêm phiên học', 'Load more sessions')}</button>}
        </section>
        <section className="task-detail-section"><h3><MapPin size={15} />{t('Địa điểm học', 'Study location')}</h3><p>{task.location || t('Chưa có địa điểm', 'No location')}</p></section>
        <section className="task-detail-section"><h3>{t('Ghi chú', 'Notes')}</h3><p>{task.notes || t('Chưa có ghi chú.', 'No notes.')}</p></section>
        {active && <><p className="task-explanation">{t('Hoàn thành hoặc hủy công việc sẽ giữ phần phiên đã diễn ra và giải phóng thời gian còn lại. Công việc vẫn được giữ trong lịch sử.', 'Completing or cancelling keeps elapsed session time and releases the remaining time. The task stays in history.')}</p><div className="task-detail-actions">
          <button className="button button-secondary" disabled={busy} onClick={planner}><Sparkles size={15} />{t('Đề xuất xếp lịch', 'Schedule suggestions')}</button>
          <p className="task-detail-context">{t('Mở Planner chung; không tự xóa lịch cũ hay chỉ xếp riêng công việc này.', 'Opens the shared planner; it does not remove existing sessions or plan only this task.')}</p>
          <button className="button button-quiet" disabled={busy} onClick={() => act(() => status(task, task.status === 'PENDING' ? 'IN_PROGRESS' : 'PENDING'))}>{task.status === 'PENDING' ? t('Bắt đầu làm', 'Start task') : t('Chuyển về cần làm', 'Move back to to-do')}</button>
          {sessions.result?.hasFutureBlocks && <button className="button button-quiet" disabled={busy || sessions.loading} onClick={() => setConfirmAction('unschedule')}><ArrowDownToLine size={15} />{t('Bỏ lịch tương lai', 'Remove future sessions')}</button>}
          <button className="button button-danger" disabled={busy} onClick={() => setConfirmAction('cancel')}>{t('Hủy công việc', 'Cancel task')}</button>
        </div></>}
      </div>
      <div className="task-drawer-footer"><button className="button button-quiet" disabled={busy} onClick={close}>{t('Đóng', 'Close')}</button>{task.status === 'PENDING' && <button className="button button-secondary" disabled={busy} onClick={() => edit(task)}><Pencil size={15} />{t('Sửa công việc', 'Edit task')}</button>}{active ? <button className="button button-primary" disabled={busy} onClick={() => act(() => status(task, 'COMPLETED'))}>{busy ? <Spinner /> : <Check size={16} />}{t('Hoàn thành', 'Complete')}</button> : <button className="button button-primary" disabled={busy} onClick={() => act(() => status(task, 'PENDING'))}>{busy ? <Spinner /> : <RefreshCw size={16} />}{t('Mở lại công việc', 'Reopen task')}</button>}</div>
    </Modal>
    {confirmAction === 'unschedule' && <ConfirmDialog title={t('Bỏ lịch tương lai', 'Remove future sessions')} message={t('Bỏ các phiên học chưa bắt đầu của công việc này? Các phiên đã bắt đầu vẫn giữ nguyên.', 'Remove future sessions for this task? Sessions already started stay unchanged.')} confirmLabel={t('Bỏ lịch', 'Remove sessions')} cancelLabel={t('Giữ lại', 'Keep')} busy={busy} onConfirm={async () => { setConfirmAction(null); await act(() => unschedule(task)); }} onCancel={() => setConfirmAction(null)} />}
    {confirmAction === 'cancel' && <ConfirmDialog title={t('Hủy công việc', 'Cancel task')} message={t('Hủy công việc và giải phóng thời gian học còn lại?', 'Cancel this task and release its remaining study time?')} confirmLabel={t('Hủy việc', 'Cancel task')} cancelLabel={t('Giữ lại', 'Keep')} danger busy={busy} onConfirm={async () => { setConfirmAction(null); await act(() => status(task, 'CANCELLED')); }} onCancel={() => setConfirmAction(null)} />}
  </>;
}
