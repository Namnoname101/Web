import { useEffect, useMemo, useRef, useState } from 'react';
import {
  Calendar as CalendarIcon,
  CalendarDays,
  CalendarRange,
  ChevronLeft,
  ChevronRight,
  Clock,
  Clock3,
  Coffee,
  Flag,
  ListFilter,
  LockKeyhole,
  MapPin,
  Moon,
  Plus,
  Sparkles,
  Sun,
  Sunrise,
  CheckCircle2,
  CalendarCheck2
} from 'lucide-react';
import { PageHeader } from './AppShell';
import { Spinner, type Translate } from './components';
import { temporalState } from './agenda';
import {
  buildCalendarItems,
  buildMiniCalendar,
  CALENDAR_HOURS,
  GRID_START_HOUR,
  GRID_END_HOUR,
  TOTAL_GRID_MINUTES,
  layoutTimedItemsForDay,
  partitionCalendarItems,
  type CalendarItem,
  type TimedGridItem
} from './calendar-data';
import { dayStart, formatDate, localDay, monday, shiftDay, timeSetting } from './lib';
import type { Bootstrap, CalendarEvent, Locale, Task, User } from './types';
import './calendar.css';

type Context = { user: User; locale: Locale; t: Translate };
type Props = Context & {
  data: Bootstrap; days: string[]; week: string; selectedDay: string; now: number;
  setWeek: (day: string) => void; setSelectedDay: (day: string) => void;
  addEvent: (day: string) => void; showEvent: (event: CalendarEvent) => void;
  showTask: (task: Task) => void; openSuggestions: () => void; pendingCount: number;
  loading: boolean; rangeReady: boolean; error: string; retry: () => void;
  historyLoading: boolean; loadMoreHistory: () => Promise<void>;
};

type ViewMode = 'week' | 'day' | 'agenda';

function TimedGridCard({
  gridItem,
  user,
  locale,
  t,
  now,
  open
}: Context & { gridItem: TimedGridItem; now: number; open: () => void }) {
  const { item, topPercent, heightPercent, leftPercent, widthPercent, startTimeFormatted, endTimeFormatted, periodBadge } = gridItem;
  const state = temporalState(item, now);
  const sameDay = localDay(user.timezone, Date.parse(item.startTime)) === localDay(user.timezone, Date.parse(item.endTime));
  const isPast = state === 'PAST';
  const isCurrent = state === 'CURRENT';

  return (
    <button
      className={`cal-grid-chip cal-kind-${item.calendarKind} ${isPast ? 'is-past' : ''} ${isCurrent ? 'is-current' : ''}`}
      style={{
        top: `${topPercent}%`,
        height: `${heightPercent}%`,
        left: `${leftPercent}%`,
        width: `calc(${widthPercent}% - 3px)`
      }}
      onClick={open}
      title={`${item.title} (${startTimeFormatted}–${endTimeFormatted}${item.location ? ` · ${item.location}` : ''})`}
    >
      <div className="cal-chip-header">
        <span className="cal-chip-time">
          {startTimeFormatted}–{endTimeFormatted}
        </span>
        {periodBadge && <span className="cal-chip-period">{periodBadge}</span>}
      </div>

      <div className="cal-chip-title" title={item.title}>
        {item.calendarKind === 'ued' && <LockKeyhole size={11} className="cal-chip-icon" />}
        {item.calendarKind === 'study' && <Sparkles size={11} className="cal-chip-icon" />}
        <strong>{item.title}</strong>
      </div>

      {item.location && (
        <div className="cal-chip-location">
          <MapPin size={10} />
          <span>{item.location}</span>
        </div>
      )}

      {isCurrent && (
        <span className="cal-chip-live-badge">
          {t('Đang diễn ra', 'Live')}
        </span>
      )}
    </button>
  );
}

function AllDayOrDeadlineChip({
  item,
  user,
  locale,
  t,
  now,
  open
}: Context & { item: CalendarItem; now: number; open: () => void }) {
  const isDeadline = item.calendarKind === 'deadline';
  const isCompleted = item.task?.status === 'COMPLETED';
  const isOverdue = isDeadline && !isCompleted && Date.parse(item.startTime) < now;

  return (
    <button
      className={`cal-allday-chip cal-kind-${item.calendarKind} ${isCompleted ? 'is-completed' : ''} ${isOverdue ? 'is-overdue' : ''}`}
      onClick={open}
      title={`${item.title}${isDeadline ? ` (${t('Hạn chót', 'Deadline')})` : ''}`}
    >
      {isDeadline ? (
        <Flag size={11} className="cal-allday-icon" />
      ) : item.calendarKind === 'ued' ? (
        <LockKeyhole size={11} className="cal-allday-icon" />
      ) : (
        <CalendarDays size={11} className="cal-allday-icon" />
      )}
      <span className="cal-allday-title">{item.title}</span>
      {isDeadline && (
        <span className="cal-allday-time">
          {formatDate(item.startTime, user.timezone, 'HH:mm', locale)}
        </span>
      )}
    </button>
  );
}

export function CalendarPage({
  data,
  user,
  locale,
  t,
  days,
  week,
  setWeek,
  selectedDay,
  setSelectedDay,
  addEvent,
  showEvent,
  showTask,
  openSuggestions,
  pendingCount,
  loading,
  rangeReady,
  error,
  retry,
  historyLoading,
  loadMoreHistory,
  now
}: Props) {
  const viewport = useRef<HTMLDivElement>(null);
  const [viewMode, setViewMode] = useState<ViewMode>('week');
  const [sourceFilters, setSourceFilters] = useState<Record<string, boolean>>({
    ued: true,
    study: true,
    personal: true,
    deadline: true
  });

  const today = localDay(user.timezone, now);
  const [miniMonth, setMiniMonth] = useState<string>(() => selectedDay.slice(0, 7) + '-01');

  useEffect(() => {
    setMiniMonth(selectedDay.slice(0, 7) + '-01');
  }, [selectedDay]);

  const allItems = useMemo(() => buildCalendarItems(data), [data]);

  const filteredItems = useMemo(() => {
    return allItems.filter(item => {
      const kind = item.calendarKind === 'legacy' ? 'personal' : item.calendarKind;
      return sourceFilters[kind] !== false;
    });
  }, [allItems, sourceFilters]);

  const eventDaysSet = useMemo(() => {
    const set = new Set<string>();
    allItems.forEach(item => {
      const d = localDay(user.timezone, Date.parse(item.startTime));
      set.add(d);
    });
    return set;
  }, [allItems, user.timezone]);

  const miniCalendarDays = useMemo(() => {
    return buildMiniCalendar(miniMonth, selectedDay, today, eventDaysSet);
  }, [miniMonth, selectedDay, today, eventDaysSet]);

  const shiftMiniMonth = (delta: number) => {
    const y = Number(miniMonth.slice(0, 4));
    const m = Number(miniMonth.slice(5, 7)) + delta;
    const date = new Date(Date.UTC(y, m - 1, 1));
    setMiniMonth(date.toISOString().slice(0, 10));
  };

  const selectDate = (day: string) => {
    setSelectedDay(day);
    setWeek(monday(day));
  };

  const nowMinutes = useMemo(() => {
    const dayStartMs = Date.parse(dayStart(today, user.timezone));
    return (now - dayStartMs) / 60_000;
  }, [now, today, user.timezone]);

  const nowLinePercent = useMemo(() => {
    const minFromGridStart = nowMinutes - GRID_START_HOUR * 60;
    if (minFromGridStart < 0 || minFromGridStart > TOTAL_GRID_MINUTES) return null;
    return (minFromGridStart / TOTAL_GRID_MINUTES) * 100;
  }, [nowMinutes]);

  const displayedDays = useMemo(() => {
    if (viewMode === 'day') return [selectedDay];
    return days;
  }, [viewMode, selectedDay, days]);

  const upcomingDeadlines = useMemo(() => {
    return allItems
      .filter(item => item.calendarKind === 'deadline' && item.task && item.task.status !== 'COMPLETED')
      .slice(0, 5);
  }, [allItems]);

  const currentWeekTitle = useMemo(() => {
    if (viewMode === 'day') {
      return formatDate(dayStart(selectedDay, user.timezone), user.timezone, 'EEEE, dd/MM/yyyy', locale);
    }
    const startStr = formatDate(dayStart(week, user.timezone), user.timezone, 'dd/MM', locale);
    const endStr = formatDate(dayStart(shiftDay(week, 6), user.timezone), user.timezone, 'dd/MM/yyyy', locale);
    return `${startStr} – ${endStr}`;
  }, [viewMode, selectedDay, week, user.timezone, locale]);

  return (
    <div className="cal-gg-workspace">
      {/* Top Header */}
      <PageHeader
        eyebrow={t('LỊCH & THỜI KHÓA BIỂU', 'CALENDAR & TIMETABLE')}
        title={t('Thời khóa biểu & Lịch trình', 'Schedule & Calendar')}
        description={t(
          'Theo dõi lịch học trường, các buổi tự học AI và deadline công việc trong tuần.',
          'Track university classes, AI study sessions and task deadlines in real-time.'
        )}
        actions={
          <>
            <button className="button button-secondary" onClick={openSuggestions}>
              <Sparkles size={16} />
              {t('Đề xuất xếp lịch', 'Schedule suggestions')}
              {pendingCount > 0 && (
                <span className="cal-count" aria-label={t(`${pendingCount} đề xuất`, `${pendingCount} suggestions`)}>
                  {pendingCount}
                </span>
              )}
            </button>
            <button className="button button-primary" onClick={() => addEvent(selectedDay)}>
              <Plus size={17} />
              {t('Thêm sự kiện', 'Add event')}
            </button>
          </>
        }
      />

      {/* Main Split-View Layout */}
      <div className="cal-split-layout">
        {/* Left Sidebar */}
        <aside className="cal-sidebar app-panel">
          {/* Create Event Quick Button */}
          <button className="cal-create-pill" onClick={() => addEvent(selectedDay)}>
            <Plus size={20} className="cal-create-icon" />
            <span>{t('Tạo mới', 'Create')}</span>
          </button>

          {/* Mini Calendar Widget */}
          <div className="cal-mini-calendar">
            <div className="cal-mini-header">
              <h3>
                {formatDate(dayStart(miniMonth, user.timezone), user.timezone, 'MMMM yyyy', locale)}
              </h3>
              <div className="cal-mini-nav">
                <button
                  className="cal-mini-arrow"
                  aria-label={t('Tháng trước', 'Previous month')}
                  onClick={() => shiftMiniMonth(-1)}
                >
                  <ChevronLeft size={16} />
                </button>
                <button
                  className="cal-mini-arrow"
                  aria-label={t('Tháng sau', 'Next month')}
                  onClick={() => shiftMiniMonth(1)}
                >
                  <ChevronRight size={16} />
                </button>
              </div>
            </div>

            <div className="cal-mini-weekdays">
              <span>{t('T2', 'M')}</span>
              <span>{t('T3', 'T')}</span>
              <span>{t('T4', 'W')}</span>
              <span>{t('T5', 'T')}</span>
              <span>{t('T6', 'F')}</span>
              <span>{t('T7', 'S')}</span>
              <span>{t('CN', 'S')}</span>
            </div>

            <div className="cal-mini-grid">
              {miniCalendarDays.map(cell => (
                <button
                  key={cell.dateString}
                  className={`cal-mini-cell ${!cell.isCurrentMonth ? 'is-other-month' : ''} ${cell.isToday ? 'is-today' : ''} ${cell.isSelected ? 'is-selected' : ''}`}
                  onClick={() => selectDate(cell.dateString)}
                >
                  <span className="cal-mini-num">{cell.dayNumber}</span>
                  {cell.hasItems && <span className="cal-mini-dot" />}
                </button>
              ))}
            </div>
          </div>

          {/* Sources Filter Checklist */}
          <div className="cal-filters-section">
            <h4 className="cal-section-label">
              <ListFilter size={13} />
              {t('Bộ lọc lịch', 'My calendars')}
            </h4>
            <div className="cal-filter-list">
              <label className="cal-filter-item">
                <input
                  type="checkbox"
                  checked={sourceFilters.ued}
                  onChange={e => setSourceFilters(f => ({ ...f, ued: e.target.checked }))}
                />
                <span className="cal-filter-indicator cal-indicator-ued" />
                <span>{t('Lớp học trường UED', 'UED University classes')}</span>
              </label>

              <label className="cal-filter-item">
                <input
                  type="checkbox"
                  checked={sourceFilters.study}
                  onChange={e => setSourceFilters(f => ({ ...f, study: e.target.checked }))}
                />
                <span className="cal-filter-indicator cal-indicator-study" />
                <span>{t('Phiên tự học (AI)', 'Study sessions')}</span>
              </label>

              <label className="cal-filter-item">
                <input
                  type="checkbox"
                  checked={sourceFilters.personal}
                  onChange={e => setSourceFilters(f => ({ ...f, personal: e.target.checked }))}
                />
                <span className="cal-filter-indicator cal-indicator-personal" />
                <span>{t('Lịch cá nhân', 'Personal events')}</span>
              </label>

              <label className="cal-filter-item">
                <input
                  type="checkbox"
                  checked={sourceFilters.deadline}
                  onChange={e => setSourceFilters(f => ({ ...f, deadline: e.target.checked }))}
                />
                <span className="cal-filter-indicator cal-indicator-deadline" />
                <span>{t('Deadline công việc', 'Task deadlines')}</span>
              </label>
            </div>
          </div>

          {/* Focus Deadlines Card */}
          {upcomingDeadlines.length > 0 && (
            <div className="cal-deadlines-section">
              <h4 className="cal-section-label">
                <Flag size={13} />
                {t('Hạn chót sắp tới', 'Upcoming deadlines')}
              </h4>
              <div className="cal-deadlines-list">
                {upcomingDeadlines.map(item => (
                  <button
                    key={item.id}
                    className="cal-deadline-card"
                    onClick={() => {
                      if (item.task) showTask(item.task);
                    }}
                  >
                    <div className="cal-deadline-info">
                      <strong>{item.title}</strong>
                      <small>
                        {formatDate(item.startTime, user.timezone, 'dd/MM HH:mm', locale)}
                      </small>
                    </div>
                  </button>
                ))}
              </div>
            </div>
          )}

          {/* Student Boundaries Info */}
          <div className="cal-sidebar-info">
            <Coffee size={14} />
            <p>
              {t('Khung tự học:', 'Study:')} {timeSetting(user.activeStartTime)}–{timeSetting(user.activeEndTime)} ·{' '}
              {t('Nghỉ:', 'Break:')} {timeSetting(user.breakStartTime)}–{timeSetting(user.breakEndTime)}
            </p>
          </div>
        </aside>

        {/* Right Main Calendar Board */}
        <main className="cal-main-board app-panel">
          {/* Top Control Toolbar */}
          <div className="cal-main-toolbar">
            <div className="cal-nav-group">
              <button className="button button-secondary small-button" onClick={() => selectDate(today)}>
                {t('Hôm nay', 'Today')}
              </button>
              <div className="cal-nav-arrows">
                <button
                  className="icon-button"
                  aria-label={t('Trước', 'Previous')}
                  onClick={() => selectDate(shiftDay(selectedDay, viewMode === 'day' ? -1 : -7))}
                >
                  <ChevronLeft size={18} />
                </button>
                <button
                  className="icon-button"
                  aria-label={t('Sau', 'Next')}
                  onClick={() => selectDate(shiftDay(selectedDay, viewMode === 'day' ? 1 : 7))}
                >
                  <ChevronRight size={18} />
                </button>
              </div>
              <h2 className="cal-title-range">{currentWeekTitle}</h2>
            </div>

            <div className="cal-view-modes">
              <button
                className={`cal-mode-btn ${viewMode === 'week' ? 'is-active' : ''}`}
                onClick={() => setViewMode('week')}
              >
                {t('Tuần', 'Week')}
              </button>
              <button
                className={`cal-mode-btn ${viewMode === 'day' ? 'is-active' : ''}`}
                onClick={() => setViewMode('day')}
              >
                {t('Ngày', 'Day')}
              </button>
              <button
                className={`cal-mode-btn ${viewMode === 'agenda' ? 'is-active' : ''}`}
                onClick={() => setViewMode('agenda')}
              >
                {t('Lịch biểu', 'Agenda')}
              </button>
            </div>
          </div>

          {/* Feedback messages / errors */}
          {error && (
            <div className="cal-load-error" role="status">
              <span>{t('Chưa cập nhật được lịch. Hiển thị dữ liệu đã tải.', 'Calendar refresh failed.')}</span>
              <button className="button button-secondary small-button" onClick={retry} disabled={loading}>
                {t('Thử lại', 'Retry')}
              </button>
            </div>
          )}
          {loading && (
            <div className="cal-load-status">
              <Spinner />
              <span>{t('Đang cập nhật thời khóa biểu…', 'Updating schedule…')}</span>
            </div>
          )}

          {/* Agenda View */}
          {viewMode === 'agenda' ? (
            <div className="cal-agenda-view">
              {days.map(day => {
                const dayItems = filteredItems.filter(item => {
                  const d = localDay(user.timezone, Date.parse(item.startTime));
                  return d === day;
                });
                return (
                  <div key={day} className="cal-agenda-day-group">
                    <div className="cal-agenda-day-header">
                      <h3>{formatDate(dayStart(day, user.timezone), user.timezone, 'EEEE, dd/MM/yyyy', locale)}</h3>
                      {day === today && <span className="cal-today-tag">{t('Hôm nay', 'Today')}</span>}
                    </div>
                    {dayItems.length === 0 ? (
                      <p className="cal-agenda-empty">{t('Không có lịch trong ngày', 'No events scheduled')}</p>
                    ) : (
                      <div className="cal-agenda-items">
                        {dayItems.map(item => (
                          <div
                            key={item.id}
                            className={`cal-agenda-card cal-kind-${item.calendarKind}`}
                            onClick={() => {
                              if (item.event) showEvent(item.event);
                              else if (item.task) showTask(item.task);
                            }}
                          >
                            <span className="cal-agenda-time">
                              {formatDate(item.startTime, user.timezone, 'HH:mm', locale)}
                              {item.calendarKind !== 'deadline' &&
                                ` – ${formatDate(item.endTime, user.timezone, 'HH:mm', locale)}`}
                            </span>
                            <div className="cal-agenda-content">
                              <strong>{item.title}</strong>
                              {item.location && (
                                <span className="cal-agenda-location">
                                  <MapPin size={11} />
                                  {item.location}
                                </span>
                              )}
                            </div>
                            <span className="cal-agenda-badge">{item.calendarKind.toUpperCase()}</span>
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          ) : (
            /* Time-Grid View (Week & Day) */
            <div className="cal-grid-viewport" ref={viewport}>
              {/* Day Headers Row */}
              <div
                className="cal-grid-header-row"
                style={{ gridTemplateColumns: `56px repeat(${displayedDays.length}, minmax(0, 1fr))` }}
              >
                <div className="cal-timezone-corner">
                  <small>GMT+7</small>
                </div>

                {displayedDays.map(day => {
                  const isCurrentDay = day === today;
                  const isChosen = day === selectedDay;
                  return (
                    <button
                      key={day}
                      className={`cal-header-cell ${isCurrentDay ? 'is-today' : ''} ${isChosen ? 'is-selected' : ''}`}
                      onClick={() => selectDate(day)}
                    >
                      <span className="cal-header-weekday">
                        {formatDate(dayStart(day, user.timezone), user.timezone, 'EEE', locale)}
                      </span>
                      <span className="cal-header-daynum">{day.slice(-2)}</span>
                    </button>
                  );
                })}
              </div>

              {/* All-Day / Deadlines Row */}
              <div
                className="cal-allday-row"
                style={{ gridTemplateColumns: `56px repeat(${displayedDays.length}, minmax(0, 1fr))` }}
              >
                <div className="cal-allday-label">
                  <small>{t('Hạn chót', 'Deadlines')}</small>
                </div>
                {displayedDays.map(day => {
                  const dayItems = filteredItems.filter(
                    item => localDay(user.timezone, Date.parse(item.startTime)) === day
                  );
                  const { allDayOrDeadlines } = partitionCalendarItems(dayItems);
                  return (
                    <div key={day} className="cal-allday-cell">
                      {allDayOrDeadlines.map(item => (
                        <AllDayOrDeadlineChip
                          key={item.id}
                          item={item}
                          user={user}
                          locale={locale}
                          t={t}
                          now={now}
                          open={() => {
                            if (item.event) showEvent(item.event);
                            else if (item.task) showTask(item.task);
                          }}
                        />
                      ))}
                    </div>
                  );
                })}
              </div>

              {/* Main Hourly Grid Canvas */}
              <div
                className="cal-grid-body"
                style={{ gridTemplateColumns: `56px repeat(${displayedDays.length}, minmax(0, 1fr))` }}
              >
                {/* Time Gutter Column */}
                <div className="cal-time-gutter">
                  {CALENDAR_HOURS.map(hour => (
                    <div key={hour} className="cal-gutter-hour">
                      <span>{String(hour).padStart(2, '0')}:00</span>
                    </div>
                  ))}
                </div>

                {/* Day Columns with Proportional Events */}
                {displayedDays.map(day => {
                  const isCurrentDay = day === today;
                  const dayItems = filteredItems.filter(
                    item => localDay(user.timezone, Date.parse(item.startTime)) === day
                  );
                  const timedLayout = layoutTimedItemsForDay(dayItems, day, user.timezone);

                  return (
                    <div key={day} className={`cal-grid-day-col ${isCurrentDay ? 'is-today-col' : ''}`}>
                      {/* Background horizontal hour divider lines */}
                      {CALENDAR_HOURS.map(hour => (
                        <div key={hour} className="cal-hour-slot" />
                      ))}

                      {/* Current Time Red Line */}
                      {isCurrentDay && nowLinePercent !== null && (
                        <div className="cal-now-indicator" style={{ top: `${nowLinePercent}%` }}>
                          <span className="cal-now-dot" />
                          <span className="cal-now-line" />
                        </div>
                      )}

                      {/* Timed Event Chips */}
                      {timedLayout.map(gridItem => (
                        <TimedGridCard
                          key={gridItem.item.id}
                          gridItem={gridItem}
                          user={user}
                          locale={locale}
                          t={t}
                          now={now}
                          open={() => {
                            if (gridItem.item.event) showEvent(gridItem.item.event);
                            else if (gridItem.item.task) showTask(gridItem.item.task);
                          }}
                        />
                      ))}
                    </div>
                  );
                })}
              </div>
            </div>
          )}

          {/* Footer note & Cancelled events */}
          {data.events.some(event => event.status === 'CANCELLED') && (
            <details className="cal-cancelled-section">
              <summary>
                {t('Lịch đã hủy trong tuần', 'Cancelled events this week')} (
                {data.events.filter(event => event.status === 'CANCELLED').length})
              </summary>
              <div className="cal-cancelled-list">
                {data.events
                  .filter(event => event.status === 'CANCELLED')
                  .map(event => (
                    <button key={event.id} onClick={() => showEvent(event)}>
                      {event.title} · {formatDate(event.startTime, user.timezone, 'dd/MM HH:mm', locale)}
                    </button>
                  ))}
              </div>
            </details>
          )}
        </main>
      </div>
    </div>
  );
}
