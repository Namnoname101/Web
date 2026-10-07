import { useEffect, useId, useRef, useState, type FormEvent, type ReactNode } from 'react';
import { AlertCircle, CalendarDays, Check, Clock3, LoaderCircle, MapPin, X } from 'lucide-react';
import { errorMessage, formatDate, toInput, toInstant } from './lib';
import { isPersonalEvent } from './calendar-data';
import type { AgendaTemporalState } from './agenda';
import type { AgendaItem, CalendarEvent, Locale, Task, User } from './types';

export type Translate = (vi: string, en: string) => string;
export function Spinner() { return <LoaderCircle className="spin" size={17} aria-hidden="true" />; }
export function Empty({ icon, title, description, action }: { icon?: ReactNode; title: string; description: string; action?: ReactNode }) {
  return <div className="empty-state"><span className="empty-icon">{icon || <CalendarDays size={24} />}</span><h3>{title}</h3><p>{description}</p>{action}</div>;
}
export function ErrorNotice({ children }: { children: ReactNode }) { return <div className="error-notice" role="alert"><AlertCircle size={18} /><span>{children}</span></div>; }
export function Modal({ title, subtitle, onClose, children, wide = false, busy = false, className = '', drawer = false }: { title: string; subtitle?: string; onClose: () => void; children: ReactNode; wide?: boolean; busy?: boolean; className?: string; drawer?: boolean }) {
  const id = useId(); const ref = useRef<HTMLDivElement>(null);
  const controls = useRef({ busy, onClose });
  controls.current = { busy, onClose };
  useEffect(() => {
    const previous = document.activeElement as HTMLElement;
    const bodyOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    ref.current?.focus();
    const keydown = (event: KeyboardEvent) => {
      if (event.key === 'Escape' && !controls.current.busy) { event.preventDefault(); controls.current.onClose(); }
      if (event.key !== 'Tab') return;
      const items = Array.from(ref.current?.querySelectorAll<HTMLElement>('button:not(:disabled), input:not(:disabled), select:not(:disabled), textarea:not(:disabled), a[href], [tabindex="0"]') || []);
      const first = items[0], last = items[items.length - 1];
      if (!first) { event.preventDefault(); return; }
      if (event.shiftKey && (document.activeElement === first || document.activeElement === ref.current)) { event.preventDefault(); last.focus(); }
      else if (!event.shiftKey && (document.activeElement === last || document.activeElement === ref.current)) { event.preventDefault(); first.focus(); }
    };
    document.addEventListener('keydown', keydown);
    return () => {
      document.body.style.overflow = bodyOverflow; document.removeEventListener('keydown', keydown);
      // Completing a task may remove its row from the active filter. Keep
      // keyboard users in the workspace even when the opener no longer exists.
      if (previous?.isConnected) previous.focus();
      else document.getElementById('main-content')?.focus();
    };
  }, []);
  return <div className={`modal-backdrop ${drawer ? 'is-drawer' : ''}`} onMouseDown={event => { if (event.target === event.currentTarget && !busy) onClose(); }}><div className={`modal ${wide ? 'modal-wide' : ''} ${className}`} role="dialog" aria-modal="true" aria-labelledby={id} aria-busy={busy} ref={ref} tabIndex={-1}><div className="modal-heading"><div><h2 id={id}>{title}</h2>{subtitle && <p>{subtitle}</p>}</div><button className="icon-button" onClick={onClose} disabled={busy} aria-label="Đóng / Close"><X size={20} /></button></div>{children}</div></div>;
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
export function EventForm({ event: existing, user, locale, t, day, save, close }: { event?: CalendarEvent; user: User; locale: Locale; t: Translate; day: string; save: (body: Record<string, unknown>, id?: string) => Promise<void>; close: () => void }) {
  const [error, setError] = useState(''), [busy, setBusy] = useState(false);
  const [start, setStart] = useState(existing ? toInput(existing.startTime, user.timezone) : `${day}T09:00`);
  const [end, setEnd] = useState(existing ? toInput(existing.endTime, user.timezone) : `${day}T10:00`);
  const editable = !existing || isPersonalEvent(existing);
  const submit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (busy || !editable) return;
    const fields = new FormData(event.currentTarget); setBusy(true); setError('');
    try {
      const startTime = toInstant(start, user.timezone), endTime = toInstant(end, user.timezone);
      if (endTime <= startTime) throw new Error(t('Giờ kết thúc phải sau giờ bắt đầu.', 'End time must be after start time.'));
      await save({ title: String(fields.get('title')).trim(), location: String(fields.get('location')).trim() || null, eventType: 'PERSONAL', startTime, endTime }, existing?.id);
      close();
    } catch (err) { setError(errorMessage(err, locale)); } finally { setBusy(false); }
  };
  return <Modal drawer className="calendar-event-drawer" title={existing ? t('Chỉnh sửa lịch cá nhân', 'Edit personal event') : t('Thêm lịch cá nhân', 'Add personal event')}
    subtitle={t('Lịch cá nhân có giờ bắt đầu và kết thúc. Deadline được quản lý trong Công việc.', 'Personal events have start and end times. Deadlines belong to Tasks.')} onClose={close} busy={busy}>
    <form onSubmit={submit} className="event-drawer-form">
      <div className="event-drawer-body">
        {error && <ErrorNotice>{error}</ErrorNotice>}
        {!editable ? <ErrorNotice>{t('Lịch này chỉ được xem, không thể sửa thành lịch cá nhân.', 'This event is read-only and cannot be edited as a personal event.')}</ErrorNotice> :
        <fieldset disabled={busy} className="event-drawer-fields">
          <Field label={t('Tên sự kiện', 'Event name')}><input name="title" required maxLength={255} defaultValue={existing?.title} placeholder={t('Ví dụ: Ca làm, học nhóm, đi khám', 'e.g. Work shift, study group, appointment')} /></Field>
          <div className="event-once"><strong><CalendarDays size={15} />{t('Một lần', 'One-time event')}</strong>{t('Lịch lặp hàng tuần chưa được hỗ trợ. Lần lưu này chỉ tạo một sự kiện.', 'Weekly recurrence is not supported yet. Saving creates a single event only.')}</div>
          <div className="form-grid"><Field label={t('Bắt đầu', 'Starts')}><input name="startTime" type="datetime-local" required value={start} onChange={event => setStart(event.target.value)} /></Field><Field label={t('Kết thúc', 'Ends')}><input name="endTime" type="datetime-local" required value={end} onChange={event => setEnd(event.target.value)} /></Field></div>
          <div><p className="muted small">{t('Chọn nhanh giờ trong ngày bắt đầu', 'Quick times on the start date')}</p><div className="event-presets">{[['06:00', '12:00', t('Sáng 06–12', 'Morning 06–12')], ['12:00', '18:00', t('Chiều 12–18', 'Afternoon 12–18')], ['18:00', '23:00', t('Tối 18–23', 'Evening 18–23')]].map(([from, to, label]) => <button type="button" key={from} onClick={() => { const date = start.slice(0, 10) || day; setStart(`${date}T${from}`); setEnd(`${date}T${to}`); }}>{label}</button>)}</div></div>
          <Field label={t('Địa điểm', 'Location')}><input name="location" maxLength={255} defaultValue={existing?.location || ''} placeholder={t('Phòng học, thư viện hoặc địa chỉ', 'Classroom, library, or address')} /></Field>
          <p className="muted small">{user.timezone} · {t('Planner giữ nguyên các lịch đã lưu khi đề xuất phiên tự học.', 'The planner preserves saved events when proposing study sessions.')}</p>
        </fieldset>}
      </div>
      <div className="event-drawer-footer"><button type="button" className="button button-quiet" onClick={close} disabled={busy}>{t('Hủy', 'Cancel')}</button><button type="submit" className="button button-primary" disabled={busy || !editable}>{busy ? <Spinner /> : <Check size={16} />}{existing ? t('Lưu thay đổi', 'Save changes') : t('Lưu vào lịch', 'Save to calendar')}</button></div>
    </form>
  </Modal>;
}

export function ConfirmDialog({ title, message, confirmLabel, cancelLabel, danger = false, busy = false, onConfirm, onCancel }: {
  title: string; message: string; confirmLabel: string; cancelLabel: string; danger?: boolean; busy?: boolean; onConfirm: () => void; onCancel: () => void;
}) {
  return <Modal title={title} onClose={onCancel} busy={busy}>
    <div className="form-stack">
      <p style={{ fontSize: '13px', lineHeight: 1.6, color: 'var(--ink)' }}>{message}</p>
      <div className="form-footer">
        <button type="button" className="button button-secondary" onClick={onCancel} disabled={busy}>{cancelLabel}</button>
        <button type="button" className={`button ${danger ? 'button-danger' : 'button-primary'}`} onClick={onConfirm} disabled={busy}>{confirmLabel}</button>
      </div>
    </div>
  </Modal>;
}

