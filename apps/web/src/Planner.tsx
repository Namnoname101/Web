import { useMemo, useState, type FormEvent } from 'react';
import { ArrowLeft, ArrowRight, CalendarDays, Check, CheckCheck, Clock3, MapPin, Search, Sparkles } from 'lucide-react';
import { Empty, ErrorNotice, Field, Modal, Spinner, type Translate } from './components';
import { PageHeader, Panel } from './AppShell';
import { errorMessage, formatDate, localDay, minutes, shiftDay, timeSetting, toInput, toInstant } from './lib';
import { canAcceptSuggestion, filterSuggestions, isSuggestionPending, requiresManualReview, suggestionTermKey, suggestionTiming, type SuggestionScope } from './suggestions';
import type { Locale, Suggestion, Task, User } from './types';
import './planner.css';

type PlannerContext = { user: User; locale: Locale; t: Translate };
function statusText(suggestion: Suggestion, now: number, t: Translate) {
  return isSuggestionPending(suggestion, now) ? t('Chờ xác nhận', 'Awaiting confirmation') : suggestion.status === 'ACCEPTED'
    ? t('Đã thêm vào lịch', 'Applied to calendar') : suggestion.status === 'REJECTED' ? t('Đã bỏ đề xuất', 'Rejected') : t('Đã hết hạn', 'Expired');
}

export function SuggestionsPage({ suggestions, tasks = [], now, user, locale, t, open, create, back }: PlannerContext & { suggestions: Suggestion[]; tasks?: Task[]; now: number; open: (suggestion: Suggestion) => void; create: () => void; back: () => void }) {
  const [history, setHistory] = useState(false), [scope, setScope] = useState<SuggestionScope>('all'), [search, setSearch] = useState(''), [termFilter, setTermFilter] = useState('all');
  const terms = useMemo(() => [...new Set(suggestions.map(suggestionTermKey).filter(term => term !== 'unknown'))].sort().reverse(), [suggestions]);
  const filtered = useMemo(() => filterSuggestions(suggestions, { now, includeHistory: history, scope, search, term: termFilter }), [suggestions, now, history, scope, search, termFilter]);
  const pendingCount = useMemo(() => suggestions.filter((item: Suggestion) => isSuggestionPending(item, now)).length, [suggestions, now]);
  const actions = { CREATE: t('Thêm lịch', 'Create event'), UPDATE: t('Cập nhật lịch', 'Update event'), CANCEL: t('Hủy buổi học', 'Cancel class'), REVIEW: t('Cần đối chiếu', 'Manual review') };
  return <div className="planner-workspace">
    <PageHeader eyebrow={t('LỊCH · ĐỀ XUẤT', 'CALENDAR · SUGGESTIONS')} title={t('Đề xuất xếp lịch', 'Schedule suggestions')}
      description={t('Planner dùng công việc chưa hoàn thành và deadline để đề xuất phiên tự học. Bạn xem lại trước khi thêm vào lịch.', 'The planner uses unfinished tasks and deadlines to propose study sessions. Review before adding them to your calendar.')}
      actions={<button className="button button-primary" onClick={create}><Sparkles size={16} />{t('Tạo đề xuất mới', 'Create a new proposal')}</button>} />
    <button className="text-link planner-back" onClick={back}><ArrowLeft size={15} />{t('Quay lại lịch', 'Back to calendar')}</button>
    <p className="planner-notice"><CheckCheck size={17} />{t('Đề xuất chưa xác nhận không chiếm chỗ trong lịch. Khi xác nhận, máy chủ kiểm tra lại xung đột, công việc và deadline.', 'Unconfirmed proposals do not reserve calendar time. Confirmation rechecks conflicts, tasks and deadlines on the server.')}</p>
    <Panel title={t('Danh sách đề xuất', 'Suggestions')} description={t(`${pendingCount} chờ xác nhận · ${filtered.length} phù hợp bộ lọc · Trong danh sách đã tải`, `${pendingCount} pending · ${filtered.length} matching · In the loaded list`)} action={<label className="planner-history"><input type="checkbox" checked={history} onChange={event => setHistory(event.target.checked)} />{t('Hiện lịch sử', 'Show history')}</label>}>
      <div className="planner-toolbar"><div className="planner-filters" role="group" aria-label={t('Phạm vi đề xuất', 'Suggestion range')}>{([['all', t('Tất cả', 'All')], ['upcoming', t('Sắp tới', 'Upcoming')], ['past', t('Đã qua', 'Past')]] as const).map(([value, label]) => <button key={value} aria-pressed={scope === value} onClick={() => setScope(value)}>{label}</button>)}</div>
        <label className="planner-search"><Search size={15} /><input value={search} onChange={event => setSearch(event.target.value)} placeholder={t('Tìm công việc, môn hoặc phòng…', 'Search task, course or room…')} aria-label={t('Tìm đề xuất', 'Search suggestions')} /></label>
        {terms.length > 1 && <select value={termFilter} onChange={event => setTermFilter(event.target.value)} aria-label={t('Lọc học kỳ', 'Filter term')}><option value="all">{t('Mọi học kỳ', 'All terms')}</option>{terms.map(term => { const [year, semester] = term.split(':'); return <option key={term} value={term}>{t('HK', 'Term')} {semester} · {year}–{Number(year) + 1}</option>; })}</select>}
      </div>
      {filtered.length ? <div className="planner-list">{filtered.map(suggestion => {
        const timing = suggestionTiming(suggestion), term = suggestion.payload.term;
        const visualStatus = isSuggestionPending(suggestion, now) ? 'pending' : suggestion.status === 'PENDING' ? 'expired' : suggestion.status.toLowerCase();
        return <button className="planner-list-item" key={suggestion.id} onClick={() => open(suggestion)}>
          <span className={`planner-list-icon ${suggestion.kind === 'EVENT_CHANGE' ? 'planner-source-ued' : ''}`}>{suggestion.kind === 'TASK_PLAN' ? <Sparkles size={20} /> : <CalendarDays size={20} />}</span>
          <span className="planner-list-copy"><span className="planner-tags"><span>{suggestion.kind === 'TASK_PLAN' ? t('Kế hoạch tự học', 'Study plan') : t('Thay đổi từ nguồn dữ liệu', 'Source calendar change')}</span>{suggestion.payload.action && <span>{actions[suggestion.payload.action]}</span>}{term && <span>{t('HK', 'Term')} {term.semester} · {term.academicYear}</span>}</span>
            <strong>{locale === 'vi' ? suggestion.titleVi : suggestion.titleEn}</strong>
            {suggestion.kind === 'TASK_PLAN' ? <span className="planner-list-sessions">{suggestion.payload.blocks?.length ? suggestion.payload.blocks.map((block, index) => <span key={`${block.taskId}-${index}`}><b>{block.taskTitle || block.title || tasks.find(task => task.id === block.taskId)?.title || t('Công việc', 'Task')}</b><span>{formatDate(block.startTime, user.timezone, 'dd/MM/yyyy · HH:mm', locale)}–{formatDate(block.endTime, user.timezone, localDay(user.timezone, Date.parse(block.startTime)) === localDay(user.timezone, Date.parse(block.endTime)) ? 'HH:mm' : 'dd/MM HH:mm', locale)} · {minutes(Math.round((Date.parse(block.endTime) - Date.parse(block.startTime)) / 60_000), locale)}</span>{block.location && <span><MapPin size={11} />{block.location}</span>}</span>) : <span>{t('Không tìm được phiên phù hợp. Mở để xem lý do.', 'No suitable sessions. Open to review the reasons.')}</span>}</span> : <small>{timing ? <>{formatDate(timing.startTime, user.timezone, 'EEE, dd/MM/yyyy · HH:mm', locale)}{timing.endTime && `–${formatDate(timing.endTime, user.timezone, 'dd/MM HH:mm', locale)}`}{timing.location && ` · ${timing.location}`}</> : t('Cần mở thông tin đối chiếu.', 'Open to inspect the supporting evidence.')}</small>}
          </span><span className={`planner-status planner-${visualStatus}`}>{statusText(suggestion, now, t)}</span><ArrowRight size={16} />
        </button>;
      })}</div> : <Empty icon={<Sparkles size={25} />} title={t('Chưa có đề xuất phù hợp', 'No matching suggestions')} description={search || scope !== 'all' || termFilter !== 'all' ? t('Thử từ khóa hoặc bộ lọc khác.', 'Try another search or filter.') : t('Tạo đề xuất từ công việc của bạn, hoặc chờ thay đổi từ nguồn đồng bộ.', 'Generate a proposal from your tasks or wait for an update from a connected source.')} />}
    </Panel>
  </div>;
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
export function SuggestionDetails({ now, suggestion, tasks = [], user, locale, t, decide, close }: { now: number; suggestion: Suggestion; tasks?: Task[]; user: User; locale: Locale; t: Translate; decide: (id: string, action: 'accept' | 'reject') => Promise<void>; close: () => void }) {
  const [busy, setBusy] = useState(''); const [error, setError] = useState('');
  const pending = isSuggestionPending(suggestion, now);
  const manualReview = requiresManualReview(suggestion);
  const canAccept = canAcceptSuggestion(suggestion, now);
  const action = async (decision: 'accept' | 'reject') => {
    // REVIEW is evidence for the student, never an executable calendar action.
    if (busy || (decision === 'accept' && !canAccept)) return;
    setBusy(decision); setError('');
    try { await decide(suggestion.id, decision); close(); }
    catch (err) { setError(errorMessage(err, locale)); }
    finally { setBusy(''); }
  };
  const blocks = suggestion.payload.blocks || [];
  return <Modal className="planner-review" title={locale === 'vi' ? suggestion.titleVi : suggestion.titleEn} subtitle={suggestion.status === 'ACCEPTED' ? t('Đề xuất đã được xác nhận. Các lịch đã lưu có thể đã thay đổi sau đó.', 'This proposal was accepted. Saved calendar items may have changed since then.') : suggestion.kind === 'TASK_PLAN' ? t('Các phiên này được tạo từ công việc và deadline của bạn. Chưa có phiên nào được thêm vào lịch cho đến khi bạn xác nhận.', 'These sessions come from your tasks and deadlines. No session is added until you confirm.') : t('Đối chiếu thay đổi từ nguồn dữ liệu trước khi áp dụng vào lịch.', 'Review source changes before applying them to the calendar.')} onClose={close} wide busy={!!busy}>
    <div className="form-stack"><span className="planner-status">{statusText(suggestion, now, t)}</span>{error && <ErrorNotice>{error}</ErrorNotice>}
      {suggestion.kind === 'TASK_PLAN' ? <>
        <div className="proposal-summary"><Sparkles size={22} /><span><strong>{blocks.length} {t('phiên học được đề xuất', 'suggested sessions')}</strong><small>{t('Theo giờ sinh hoạt, nghỉ trưa và thời gian di chuyển của bạn.', 'Based on your active hours, break, and travel time.')}</small></span></div>
        <div className="proposed-blocks">{blocks.map((block, i) => <div className="proposed-block" key={`${block.taskId}-${i}`}><span className="step-number">{i + 1}</span><div><strong>{block.taskTitle || block.title || tasks.find(task => task.id === block.taskId)?.title || t('Công việc', 'Task')}</strong><p>{formatDate(block.startTime, user.timezone, 'EEE, dd/MM · HH:mm', locale)}–{formatDate(block.endTime, user.timezone, localDay(user.timezone, Date.parse(block.startTime)) === localDay(user.timezone, Date.parse(block.endTime)) ? 'HH:mm' : 'dd/MM HH:mm', locale)}</p><small>{block.location || t('Chưa có địa điểm', 'No location')} · {minutes(Math.round((Date.parse(block.endTime) - Date.parse(block.startTime)) / 60000), locale)}</small></div></div>)}</div>
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
      <div className="form-footer">{pending ? <><button className="button button-quiet" onClick={() => action('reject')} disabled={!!busy}>{busy === 'reject' && <Spinner />}{t('Bỏ đề xuất', 'Dismiss proposal')}</button>{manualReview ? <button className="button button-secondary" onClick={close} disabled={!!busy}>{t('Để lại và kiểm tra sau', 'Keep for later review')}</button> : <button className="button button-primary" onClick={() => action('accept')} disabled={!!busy || !canAccept}>{busy === 'accept' ? <Spinner /> : <Check size={16} />}{suggestion.kind === 'TASK_PLAN' ? t('Thêm vào lịch', 'Add to calendar') : t('Áp dụng thay đổi', 'Apply change')}</button>}</> : <button className="button button-secondary" onClick={close}>{t('Đóng', 'Close')}</button>}</div>
    </div>
  </Modal>;
}
export function PlanForm({ now, user, locale, t, propose, close }: { now: number; user: User; locale: Locale; t: Translate; propose: (fromDate: string, toDate: string) => Promise<void>; close: () => void }) {
  const [busy, setBusy] = useState(false); const [error, setError] = useState('');
  const submit = async (event: FormEvent<HTMLFormElement>) => { event.preventDefault(); const f = new FormData(event.currentTarget); setBusy(true); setError(''); try { const from = toInstant(String(f.get('fromDate')), user.timezone), to = toInstant(String(f.get('toDate')), user.timezone); if (to <= from) throw new Error(t('Ngày kết thúc phải sau ngày bắt đầu.', 'End must be after start.')); if (Date.parse(to) <= now) throw new Error(t('Hãy chọn thời gian trong tương lai.', 'Choose a future time period.')); await propose(from, to); } catch (err) { setError(errorMessage(err, locale)); } finally { setBusy(false); } };
  return <Modal className="planner-create" title={t('Tạo đề xuất lịch', 'Create schedule proposal')} subtitle={t('Chọn khoảng thời gian. Bạn sẽ xem và quyết định kế hoạch.', 'Choose a period. You review and decide on the plan.')} onClose={close} busy={busy}><form className="form-stack" onSubmit={submit}>{error && <ErrorNotice>{error}</ErrorNotice>}
    <div className="form-grid"><Field label={t('Từ', 'From')}><input type="datetime-local" name="fromDate" required defaultValue={toInput(new Date(now + 60000).toISOString(), user.timezone)} /></Field><Field label={t('Đến', 'Until')}><input type="datetime-local" name="toDate" required defaultValue={`${shiftDay(localDay(user.timezone, now), 7)}T22:00`} /></Field></div>
    <div className="callout"><h3>{t('Quy tắc đang áp dụng', 'Current scheduling rules')}</h3><p>{timeSetting(user.activeStartTime)}–{timeSetting(user.activeEndTime)} · {t('Nghỉ', 'Break')} {timeSetting(user.breakStartTime)}–{timeSetting(user.breakEndTime)}</p><p>{t('Phiên học tối thiểu', 'Minimum session')}: {user.minBlockMinutes} {t('phút', 'minutes')} · {t('Di chuyển', 'Travel')}: {user.travelMinutes} {t('phút', 'minutes')}</p><small>{user.timezone}</small></div>
    <p className="muted small">{t('Giữ nguyên lịch đã xác nhận. Chỉ xếp những việc có thể hoàn thành toàn bộ trước deadline, theo thứ tự Cao → Vừa → Thấp.', 'Confirmed sessions stay in place. Only tasks that can fully finish before their deadline are planned, ordered High → Medium → Low.')}</p>
    <div className="form-footer"><button type="button" className="button button-quiet" onClick={close} disabled={busy}>{t('Để sau', 'Not now')}</button><button className="button button-primary" disabled={busy}>{busy ? <Spinner /> : <Sparkles size={16} />}{t('Tạo đề xuất', 'Generate proposal')}<ArrowRight size={15} /></button></div>
  </form></Modal>;
}
