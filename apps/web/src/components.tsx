import { useEffect, useId, useRef, useState, type FormEvent, type ReactNode } from 'react';
import { AlertCircle, ArrowRight, CalendarDays, Check, Clock3, LoaderCircle, MapPin, Plus, Sparkles, X } from 'lucide-react';
import { errorMessage, formatDate, localDay, minutes, shiftDay, timeSetting, toInput, toInstant } from './lib';
import { canAcceptSuggestion, isSuggestionPending, requiresManualReview } from './suggestions';
import type { AgendaTemporalState } from './agenda';
import type { AgendaItem, CalendarEvent, Locale, Suggestion, Task, User } from './types';

export type Translate = (vi: string, en: string) => string;
export function Spinner() { return <LoaderCircle className="spin" size={17} aria-hidden="true" />; }
export function Empty({ icon, title, description, action }: { icon?: ReactNode; title: string; description: string; action?: ReactNode }) {
  return <div className="empty-state"><span className="empty-icon">{icon || <CalendarDays size={24} />}</span><h3>{title}</h3><p>{description}</p>{action}</div>;
}
export function ErrorNotice({ children }: { children: ReactNode }) { return <div className="error-notice" role="alert"><AlertCircle size={18} /><span>{children}</span></div>; }
export function Modal({ title, subtitle, onClose, children, wide = false, busy = false }: { title: string; subtitle?: string; onClose: () => void; children: ReactNode; wide?: boolean; busy?: boolean }) {
  const id = useId(); const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const previous = document.activeElement as HTMLElement;
    const bodyOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    ref.current?.focus();
    const keydown = (event: KeyboardEvent) => {
      if (event.key === 'Escape' && !busy) onClose();
      if (event.key !== 'Tab') return;
      const items = Array.from(ref.current?.querySelectorAll<HTMLElement>('button:not(:disabled), input:not(:disabled), select:not(:disabled), textarea:not(:disabled), a[href], [tabindex="0"]') || []);
      const first = items[0], last = items[items.length - 1];
      if (!first) { event.preventDefault(); return; }
      if (event.shiftKey && (document.activeElement === first || document.activeElement === ref.current)) { event.preventDefault(); last.focus(); }
      else if (!event.shiftKey && (document.activeElement === last || document.activeElement === ref.current)) { event.preventDefault(); first.focus(); }
    };
    document.addEventListener('keydown', keydown);
    return () => { document.body.style.overflow = bodyOverflow; document.removeEventListener('keydown', keydown); previous?.focus(); };
  }, [busy, onClose]);
  return <div className="modal-backdrop" onMouseDown={event => { if (event.target === event.currentTarget && !busy) onClose(); }}><div className={`modal ${wide ? 'modal-wide' : ''}`} role="dialog" aria-modal="true" aria-labelledby={id} ref={ref} tabIndex={-1}><div className="modal-heading"><div><h2 id={id}>{title}</h2>{subtitle && <p>{subtitle}</p>}</div><button className="icon-button" onClick={onClose} disabled={busy} aria-label="Đóng / Close"><X size={20} /></button></div>{children}</div></div>;
}
export function Field({ label, children, hint }: { label: string; children: ReactNode; hint?: string }) { return <label className="field"><span>{label}</span>{children}{hint && <small>{hint}</small>}</label>; }
export function PriorityBadge({ priority, t }: { priority: Task['priority']; t: Translate }) {
  return <span className={`badge priority-${priority.toLowerCase()}`}><span className="badge-dot" />{priority === 'HIGH' ? t('Cao', 'High') : priority === 'MEDIUM' ? t('Vừa', 'Medium') : t('Thấp', 'Low')}</span>;
}
export function AgendaCard({ item, timezone, locale, t, onClick, compact = false, temporal, temporalLabel, showDate = false }: { item: AgendaItem; timezone: string; locale: Locale; t: Translate; onClick: () => void; compact?: boolean; temporal?: AgendaTemporalState; temporalLabel?: string; showDate?: boolean }) {
  const startDay = formatDate(item.startTime, timezone, 'yyyy-MM-dd', locale);
  const endDay = formatDate(item.endTime, timezone, 'yyyy-MM-dd', locale);
  const endLabel = startDay === endDay ? formatDate(item.endTime, timezone, 'HH:mm', locale) : formatDate(item.endTime, timezone, 'dd/MM HH:mm', locale);
  return <button className={`agenda-card event-${item.kind.toLowerCase()} ${compact ? 'compact' : ''} ${temporal ? `is-${temporal.toLowerCase()}` : ''}`} onClick={onClick}>
    <span className="agenda-marker" /><span className="agenda-copy"><span className="agenda-title">{item.title}</span>{showDate && <span className="agenda-meta"><CalendarDays size={12} />{formatDate(item.startTime, timezone, 'EEE, dd/MM', locale)}</span>}<span className="agenda-meta"><Clock3 size={12} />{formatDate(item.startTime, timezone, 'HH:mm', locale)}–{endLabel}</span>{!compact && <span className="agenda-meta"><MapPin size={12} />{item.location || t('Chưa có địa điểm', 'No location')}</span>}</span>{compact && temporalLabel && <span className={`agenda-compact-state state-${temporal?.toLowerCase() || 'neutral'}`}>{temporalLabel}</span>}{!compact && <span className="agenda-card-side">{temporalLabel && <span className={`agenda-state state-${temporal?.toLowerCase() || 'neutral'}`}>{temporalLabel}</span>}<span className="agenda-type">{item.kind === 'CLASS' ? t('Lớp học', 'Class') : item.kind === 'TASK' ? t('Tự học', 'Focus') : item.kind === 'DEADLINE' ? 'Deadline' : t('Cá nhân', 'Personal')}</span></span>}
  </button>;
}
export function TaskForm({ task, user, locale, t, save, close }: { task?: Task; user: User; locale: Locale; t: Translate; save: (body: Record<string, unknown>, id?: string) => Promise<void>; close: () => void }) {
  const [error, setError] = useState(''); const [busy, setBusy] = useState(false);
  const submit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault(); const f = new FormData(event.currentTarget); setBusy(true); setError('');
    try { await save({ title: String(f.get('title')).trim(), notes: String(f.get('notes')).trim(), location: String(f.get('location')).trim() || null, durationMinutes: Number(f.get('durationMinutes')), deadline: toInstant(String(f.get('deadline')), user.timezone), priority: f.get('priority'), isSplittable: f.get('isSplittable') === 'on' }, task?.id); close(); }
    catch (err) { setError(errorMessage(err, locale)); } finally { setBusy(false); }
  };
  return <Modal title={task ? t('Chỉnh sửa công việc', 'Edit task') : t('Thêm việc cần làm', 'Create a task')} subtitle={t('Nói bạn cần làm gì. Chúng mình sẽ gợi ý lúc phù hợp.', "Tell us what you need to do. We'll help find the time.")} onClose={close} busy={busy}>
    <form onSubmit={submit} className="form-stack">{error && <ErrorNotice>{error}</ErrorNotice>}
      <Field label={t('Tên công việc', 'Task name')}><input name="title" required maxLength={255} defaultValue={task?.title} placeholder={t('Ví dụ: Ôn tập chương 3 môn Tâm lý học', 'e.g. Review chapter 3 for Psychology')} /></Field>
      <div className="form-grid"><Field label={t('Thời lượng (phút)', 'Duration (minutes)')}><input type="number" name="durationMinutes" min={user.minBlockMinutes} max={10080} step={1} required defaultValue={task?.durationMinutes || 60} /></Field><Field label={t('Độ ưu tiên', 'Priority')}><select name="priority" defaultValue={task?.priority || 'MEDIUM'}><option value="HIGH">{t('Cao', 'High')}</option><option value="MEDIUM">{t('Vừa', 'Medium')}</option><option value="LOW">{t('Thấp', 'Low')}</option></select></Field></div>
      <Field label={t('Hoàn thành trước', 'Finish before')} hint={user.timezone}><input type="datetime-local" name="deadline" required defaultValue={task ? toInput(task.deadline, user.timezone) : `${shiftDay(localDay(user.timezone), 2)}T22:00`} /></Field>
      <Field label={t('Địa điểm học', 'Study location')}><input name="location" maxLength={255} defaultValue={task?.location || user.studyLocation || ''} placeholder={t('Ví dụ: Thư viện UED', 'e.g. UED Library')} /></Field>
      <Field label={t('Ghi chú (không bắt buộc)', 'Notes (optional)')}><textarea name="notes" rows={3} maxLength={5000} defaultValue={task?.notes} placeholder={t('Tài liệu, mục tiêu hoặc điều cần nhớ…', 'Materials, goals, or anything to remember…')} /></Field>
      <label className="checkbox-row"><input type="checkbox" name="isSplittable" defaultChecked={task?.isSplittable ?? true} /><span><strong>{t('Cho phép chia nhỏ thời gian', 'Allow split study sessions')}</strong><small>{t(`Mỗi phiên ít nhất ${user.minBlockMinutes} phút, hoàn thành toàn bộ trước deadline.`, `Each session is at least ${user.minBlockMinutes} minutes; all sessions must finish before the deadline.`)}</small></span></label>
      <div className="form-footer"><button type="button" className="button button-quiet" onClick={close} disabled={busy}>{t('Hủy', 'Cancel')}</button><button type="submit" className="button button-primary" disabled={busy}>{busy ? <Spinner /> : <Check size={16} />}{task ? t('Lưu thay đổi', 'Save changes') : t('Tạo công việc', 'Create task')}</button></div>
    </form>
  </Modal>;
}
export function EventForm({ event: existing, user, locale, t, day, save, close }: { event?: CalendarEvent; user: User; locale: Locale; t: Translate; day: string; save: (body: Record<string, unknown>, id?: string) => Promise<void>; close: () => void }) {
  const [error, setError] = useState(''); const [busy, setBusy] = useState(false);
  const submit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault(); const f = new FormData(event.currentTarget); setBusy(true); setError('');
    try { const startTime = toInstant(String(f.get('startTime')), user.timezone), endTime = toInstant(String(f.get('endTime')), user.timezone); if (endTime <= startTime) throw new Error(t('Giờ kết thúc phải sau giờ bắt đầu.', 'End time must be after start time.')); await save({ title: String(f.get('title')).trim(), location: String(f.get('location')).trim() || null, eventType: f.get('eventType'), startTime, endTime }, existing?.id); close(); }
    catch (err) { setError(errorMessage(err, locale)); } finally { setBusy(false); }
  };
  return <Modal title={existing ? t('Chỉnh sửa sự kiện', 'Edit event') : t('Thêm vào lịch', 'Add to your calendar')} subtitle={t('Lịch của bạn luôn là ưu tiên khi xếp thời gian học.', 'Your existing plans always come first.')} onClose={close} busy={busy}>
    <form onSubmit={submit} className="form-stack">{error && <ErrorNotice>{error}</ErrorNotice>}
      <Field label={t('Tên sự kiện', 'Event name')}><input name="title" required maxLength={255} defaultValue={existing?.title} placeholder={t('Ví dụ: Học nhóm tại thư viện', 'e.g. Study group at the library')} /></Field>
      <Field label={t('Loại sự kiện', 'Event type')}><select name="eventType" defaultValue={existing?.eventType || 'PERSONAL'}><option value="PERSONAL">{t('Cá nhân', 'Personal')}</option><option value="CLASS">{t('Lớp học', 'Class')}</option><option value="DEADLINE">Deadline</option></select></Field>
      <div className="form-grid"><Field label={t('Bắt đầu', 'Starts')}><input name="startTime" type="datetime-local" required defaultValue={existing ? toInput(existing.startTime, user.timezone) : `${day}T09:00`} /></Field><Field label={t('Kết thúc', 'Ends')}><input name="endTime" type="datetime-local" required defaultValue={existing ? toInput(existing.endTime, user.timezone) : `${day}T10:00`} /></Field></div>
      <p className="muted small">{t('Múi giờ', 'Timezone')}: {user.timezone}</p>
      <Field label={t('Địa điểm', 'Location')}><input name="location" maxLength={255} defaultValue={existing?.location || ''} placeholder={t('Phòng học, thư viện hoặc địa chỉ', 'Classroom, library, or address')} /></Field>
      <div className="form-footer"><button type="button" className="button button-quiet" onClick={close} disabled={busy}>{t('Hủy', 'Cancel')}</button><button type="submit" className="button button-primary" disabled={busy}>{busy ? <Spinner /> : <Plus size={16} />}{t('Lưu sự kiện', 'Save event')}</button></div>
    </form>
  </Modal>;
}
const reasonText = (reason: string, t: Translate) => ({ INSUFFICIENT_TIME: t('Không đủ thời gian trống trước deadline.', 'Not enough free time before the deadline.'), DEADLINE_PASSED: t('Đã qua deadline.', 'The deadline has passed.'), BELOW_MINIMUM: t('Thời lượng dưới mức tối thiểu của một phiên.', 'Duration is shorter than your minimum session.'), PARTIAL_UNSPLITTABLE: t('Công việc cần một phiên liên tục nhưng đã có một phần lịch được giữ lại.', 'This task needs one continuous session, but part of its schedule is already retained.'), NO_SLOT: t('Chưa tìm được khoảng trống phù hợp.', 'No suitable free slot available.') })[reason] || reason;
function ReadableValue({ value, timezone, locale, t }: { value: unknown; timezone: string; locale: Locale; t: Translate }) {
  if (value === null || value === undefined) return <span className="muted">—</span>;
  if (typeof value === 'boolean') return <span>{value ? t('Có', 'Yes') : t('Không', 'No')}</span>;
  if (typeof value === 'string' && /^\d{4}-\d{2}-\d{2}T/.test(value) && !Number.isNaN(Date.parse(value))) return <span>{formatDate(value, timezone, 'dd/MM/yyyy HH:mm', locale)}</span>;
  if (typeof value !== 'object') return <span>{String(value)}</span>;
  if (Array.isArray(value)) return <ul className="evidence-list">{value.map((item, i) => <li key={i}><ReadableValue value={item} timezone={timezone} locale={locale} t={t} /></li>)}</ul>;
  const labels: Record<string, string> = { title: t('Tiêu đề', 'Title'), startTime: t('Bắt đầu', 'Start'), endTime: t('Kết thúc', 'End'), location: t('Địa điểm', 'Location'), status: t('Trạng thái', 'Status'), subject: t('Tiêu đề thư', 'Email subject'), sender: t('Người gửi', 'Sender'), receivedAt: t('Nhận lúc', 'Received at'), snippet: t('Nội dung trích dẫn', 'Excerpt'), body: t('Nội dung', 'Content'), reason: t('Lý do', 'Reason') };
  return <dl className="evidence-fields">{Object.entries(value).filter(([key]) => !/token|secret|userId|externalId/i.test(key)).map(([key, item]) => <div key={key}><dt>{labels[key] || key}</dt><dd><ReadableValue value={item} timezone={timezone} locale={locale} t={t} /></dd></div>)}</dl>;
}
export function SuggestionDetails({ suggestion, user, locale, t, decide, close }: { suggestion: Suggestion; user: User; locale: Locale; t: Translate; decide: (id: string, action: 'accept' | 'reject') => Promise<void>; close: () => void }) {
  const [busy, setBusy] = useState(''); const [error, setError] = useState('');
  const now = Date.now();
  const pending = isSuggestionPending(suggestion, now);
  const manualReview = requiresManualReview(suggestion);
  const canAccept = canAcceptSuggestion(suggestion, now);
  const action = async (decision: 'accept' | 'reject') => {
    // REVIEW is evidence for the student, never an executable calendar action.
    if (decision === 'accept' && !canAccept) return;
    setBusy(decision); setError('');
    try { await decide(suggestion.id, decision); close(); }
    catch (err) { setError(errorMessage(err, locale)); }
    finally { setBusy(''); }
  };
  const blocks = suggestion.payload.blocks || [];
  return <Modal title={locale === 'vi' ? suggestion.titleVi : suggestion.titleEn} subtitle={t('Xem kỹ trước khi chấp nhận. Đề xuất chưa thay đổi lịch của bạn.', 'Review before accepting. This proposal has not changed your calendar.')} onClose={close} wide busy={!!busy}>
    <div className="form-stack">{error && <ErrorNotice>{error}</ErrorNotice>}
      {suggestion.kind === 'TASK_PLAN' ? <>
        <div className="proposal-summary"><Sparkles size={22} /><span><strong>{blocks.length} {t('phiên học được đề xuất', 'suggested sessions')}</strong><small>{t('Theo giờ sinh hoạt, nghỉ trưa và thời gian di chuyển của bạn.', 'Based on your active hours, break, and travel time.')}</small></span></div>
        <div className="proposed-blocks">{blocks.map((block, i) => <div className="proposed-block" key={`${block.taskId}-${i}`}><span className="step-number">{i + 1}</span><div><strong>{block.taskTitle || block.title || t('Công việc', 'Task')}</strong><p>{formatDate(block.startTime, user.timezone, 'EEE, dd/MM · HH:mm', locale)}–{formatDate(block.endTime, user.timezone, 'HH:mm', locale)}</p><small>{block.location || user.studyLocation || t('Chưa có địa điểm', 'No location')} · {minutes(Math.round((Date.parse(block.endTime) - Date.parse(block.startTime)) / 60000), locale)}</small></div></div>)}</div>
        {blocks.length === 0 && <p className="muted">{t('Chưa có phiên học phù hợp trong khoảng thời gian đã chọn.', 'No suitable study sessions in the selected period.')}</p>}
        {!!suggestion.payload.unscheduled?.length && <div className="callout callout-amber"><strong>{t('Những việc cần bạn xem lại', 'Tasks that need your attention')}</strong>{suggestion.payload.unscheduled.map((task, i) => <p key={i}><b>{task.title || task.taskTitle || t('Công việc', 'Task')}</b> — {reasonText(task.reason, t)}</p>)}</div>}
      </> : <div className="event-change-details">
        {suggestion.payload.reason && <p>{suggestion.payload.reason}</p>}
        {(suggestion.payload.before || suggestion.payload.after || suggestion.payload.changes) && <div className="change-comparison">{suggestion.payload.before && <section><h3>{t('Hiện tại', 'Current')}</h3><ReadableValue value={suggestion.payload.before} timezone={user.timezone} locale={locale} t={t} /></section>}<section><h3>{t('Thay đổi được đề xuất', 'Proposed change')}</h3><ReadableValue value={suggestion.payload.after || suggestion.payload.changes} timezone={user.timezone} locale={locale} t={t} /></section></div>}
        {manualReview && <div className="callout callout-amber"><strong>{t('Cần bạn đối chiếu thủ công', 'Manual review needed')}</strong><p>{t('Hệ thống không thể áp dụng an toàn thay đổi này. Bạn có thể từ chối hoặc giữ lại để kiểm tra.', 'The system cannot safely apply this change. You can decline it or keep it for review.')}</p></div>}
        {suggestion.payload.evidence !== undefined && <div className="callout"><strong>{t('Thông tin đối chiếu', 'Supporting information')}</strong><ReadableValue value={suggestion.payload.evidence} timezone={user.timezone} locale={locale} t={t} /></div>}
        {!suggestion.payload.before && !suggestion.payload.after && !suggestion.payload.changes && <ReadableValue value={suggestion.payload} timezone={user.timezone} locale={locale} t={t} />}
      </div>}
      <p className="muted small">{t('Múi giờ', 'Timezone')}: {user.timezone} · {t('Có hiệu lực đến', 'Valid until')} {formatDate(suggestion.expiresAt, user.timezone, 'dd/MM HH:mm', locale)}</p>
      <div className="form-footer">{pending ? <><button className="button button-quiet" onClick={() => action('reject')} disabled={!!busy}>{busy === 'reject' && <Spinner />}{t('Từ chối', 'Decline')}</button>{manualReview ? <button className="button button-secondary" onClick={close}>{t('Để lại và kiểm tra sau', 'Keep for later review')}</button> : <button className="button button-primary" onClick={() => action('accept')} disabled={!!busy || !canAccept}>{busy === 'accept' ? <Spinner /> : <Check size={16} />}{t('Chấp nhận đề xuất', 'Accept proposal')}</button>}</> : <button className="button button-secondary" onClick={close}>{t('Đóng', 'Close')}</button>}</div>
    </div>
  </Modal>;
}
export function PlanForm({ user, locale, t, propose, close }: { user: User; locale: Locale; t: Translate; propose: (fromDate: string, toDate: string) => Promise<void>; close: () => void }) {
  const [busy, setBusy] = useState(false); const [error, setError] = useState('');
  const submit = async (event: FormEvent<HTMLFormElement>) => { event.preventDefault(); const f = new FormData(event.currentTarget); setBusy(true); setError(''); try { const from = toInstant(String(f.get('fromDate')), user.timezone), to = toInstant(String(f.get('toDate')), user.timezone); if (to <= from) throw new Error(t('Ngày kết thúc phải sau ngày bắt đầu.', 'End must be after start.')); if (Date.parse(to) <= Date.now()) throw new Error(t('Hãy chọn thời gian trong tương lai.', 'Choose a future time period.')); await propose(from, to); } catch (err) { setError(errorMessage(err, locale)); } finally { setBusy(false); } };
  return <Modal title={t('Tìm thời gian cho điều quan trọng', 'Make time for what matters')} subtitle={t('Chọn khoảng thời gian. Bạn sẽ xem và quyết định kế hoạch.', 'Choose a period. You review and decide on the plan.')} onClose={close} busy={busy}><form className="form-stack" onSubmit={submit}>{error && <ErrorNotice>{error}</ErrorNotice>}
    <div className="form-grid"><Field label={t('Từ', 'From')}><input type="datetime-local" name="fromDate" required defaultValue={toInput(new Date(Date.now() + 60000).toISOString(), user.timezone)} /></Field><Field label={t('Đến', 'Until')}><input type="datetime-local" name="toDate" required defaultValue={`${shiftDay(localDay(user.timezone), 7)}T22:00`} /></Field></div>
    <div className="callout"><h3>{t('Theo nhịp sinh hoạt của bạn', 'Built around your routine')}</h3><p>{timeSetting(user.activeStartTime)}–{timeSetting(user.activeEndTime)} · {t('Nghỉ', 'Break')} {timeSetting(user.breakStartTime)}–{timeSetting(user.breakEndTime)}</p><p>{t('Phiên học tối thiểu', 'Minimum session')}: {user.minBlockMinutes} {t('phút', 'minutes')} · {t('Di chuyển', 'Travel')}: {user.travelMinutes} {t('phút', 'minutes')}</p><small>{user.timezone}</small></div>
    <p className="muted small">{t('Giữ nguyên lịch đã xác nhận. Chỉ xếp những việc có thể hoàn thành toàn bộ trước deadline, theo thứ tự Cao → Vừa → Thấp.', 'Confirmed sessions stay in place. Only tasks that can fully finish before their deadline are planned, ordered High → Medium → Low.')}</p>
    <div className="form-footer"><button type="button" className="button button-quiet" onClick={close} disabled={busy}>{t('Để sau', 'Not now')}</button><button className="button button-primary" disabled={busy}>{busy ? <Spinner /> : <Sparkles size={16} />}{t('Tạo đề xuất', 'Generate proposal')}<ArrowRight size={15} /></button></div>
  </form></Modal>;
}
