import { formatInTimeZone, fromZonedTime } from 'date-fns-tz';
import { enUS, vi } from 'date-fns/locale';
import type { Locale } from './types';

export class ApiError extends Error {
  constructor(message: string, public status: number, public code?: string) { super(message); }
}
export async function api<T>(path: string, method = 'GET', body?: unknown): Promise<T> {
  const response = await fetch(`/api/v1${path}`, {
    method, credentials: 'include',
    headers: method === 'GET' ? { Accept: 'application/json' } : { 'Content-Type': 'application/json', Accept: 'application/json' },
    ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
  });
  const result = await response.json().catch(() => ({}));
  if (!response.ok) throw new ApiError(result.error?.message || result.message || `HTTP ${response.status}`, response.status, result.error?.code);
  return result as T;
}
export function errorMessage(error: unknown, locale: Locale): string {
  const t = (a: string, b: string) => locale === 'vi' ? a : b;
  if (error instanceof ApiError) {
    const known: Record<string, [string, string]> = {
      DEADLINE_PASSED: ['Deadline đã qua. Hãy chọn một thời điểm trong tương lai.', 'The deadline has passed. Choose a future time.'],
      UNSCHEDULE_FIRST: ['Hãy bỏ các phiên học tương lai trước khi đổi thời lượng, deadline hoặc địa điểm.', 'Remove future study sessions before changing duration, deadline, or location.'],
      TASK_NOT_PENDING: ['Chỉ công việc ở trạng thái Cần làm mới có thể chỉnh sửa.', 'Only a to-do task can be edited.'],
      TIME_CONFLICT: ['Khoảng thời gian này trùng lịch hoặc không đủ thời gian di chuyển.', 'This time overlaps your calendar or does not leave enough travel time.'],
      SCHEDULE_CHANGED: ['Lịch đã thay đổi từ lúc tạo đề xuất. Hãy tải lại và tạo đề xuất mới.', 'Your calendar changed after this proposal was created. Refresh and generate a new one.'],
      PLAN_NO_LONGER_VALID: ['Kế hoạch này không còn phù hợp với công việc hiện tại. Hãy tạo đề xuất mới.', 'This plan no longer matches your tasks. Generate a new proposal.'],
      SUGGESTION_EXPIRED: ['Đề xuất đã hết hiệu lực. Hãy tạo hoặc chờ một đề xuất mới.', 'This proposal has expired. Generate or wait for a new one.'],
      EMPTY_PLAN: ['Chưa có phiên học phù hợp để chấp nhận.', 'There are no suitable study sessions to accept.'],
      MANUAL_REVIEW_REQUIRED: ['Thông tin này cần bạn đối chiếu thủ công và không thể tự áp dụng.', 'This information needs manual review and cannot be applied automatically.'],
      EVENT_IN_PAST: ['Không thể áp dụng thay đổi tự động cho một buổi đã qua.', 'An automatic change cannot be applied to an event in the past.'],
      INTEGRATION_NOT_CONNECTED: ['Nguồn dữ liệu chưa được kết nối. Hãy kết nối lại rồi thử tiếp.', 'This data source is not connected. Reconnect it and try again.'],
      MICROSOFT_CONSENT_DECLINED: ['Bạn chưa cấp quyền đọc Outlook; lịch vẫn được giữ nguyên.', 'Outlook read access was not granted; your calendar is unchanged.'],
      OAUTH_STATE_INVALID: ['Phiên đăng nhập Microsoft không còn hợp lệ. Hãy bắt đầu kết nối lại.', 'The Microsoft sign-in session is no longer valid. Start the connection again.'],
      OAUTH_SESSION_CHANGED: ['Tài khoản ứng dụng đã thay đổi trong lúc kết nối Outlook. Hãy thử lại từ đúng tài khoản.', 'The app account changed during Outlook setup. Retry from the intended account.'],
      OAUTH_ATTEMPT_CANCELLED: ['Yêu cầu kết nối Outlook đã bị hủy. Hãy bắt đầu lại nếu bạn vẫn muốn kết nối.', 'The Outlook connection attempt was cancelled. Start again if you still want to connect.'],
      ACCOUNT_LINK_REQUIRED: ['Email trường này đã có tài khoản. Hãy đăng nhập tài khoản đó rồi kết nối Outlook trong mục Kết nối.', 'This school email already has an account. Sign in to it, then connect Outlook from Connections.'],
      MICROSOFT_ACCOUNT_ALREADY_LINKED: ['Tài khoản Microsoft này đã gắn với một không gian sinh viên khác.', 'This Microsoft account is already linked to another student workspace.'],
      MICROSOFT_EMAIL_ALREADY_LINKED: ['Email trường này đang thuộc một không gian sinh viên khác.', 'This school email belongs to another student workspace.'],
      SCHOOL_ACCOUNT_REQUIRED: ['Hãy dùng tài khoản Microsoft do trường UED cấp.', 'Use a Microsoft account issued by UED.'],
      OUTLOOK_READ_CONSENT_REQUIRED: ['Outlook chưa có quyền chỉ đọc email. Hãy kết nối lại và cấp quyền đọc.', 'Outlook does not have read-only mail permission. Reconnect and grant read access.'],
      OUTLOOK_REAUTH_REQUIRED: ['Phiên Outlook đã hết hạn. Hãy kết nối lại trong mục Kết nối.', 'Your Outlook session expired. Reconnect it from Connections.'],
      MICROSOFT_NOT_CONFIGURED: ['Máy chủ chưa được cấu hình Microsoft Outlook.', 'Microsoft Outlook is not configured on this server.'],
      MICROSOFT_ORGANIZATION_TENANT_REQUIRED: ['Cấu hình Microsoft phải dùng tenant của tổ chức.', 'Microsoft must be configured with an organization tenant.'],
      MICROSOFT_UNAVAILABLE: ['Microsoft tạm thời không phản hồi. Vui lòng thử lại sau.', 'Microsoft is temporarily unavailable. Please try again later.'],
    };
    if (error.code && known[error.code]) return t(...known[error.code]);
    if (error.status === 401) return t('Phiên đăng nhập đã hết hạn. Vui lòng đăng nhập lại.', 'Your session has expired. Please sign in again.');
    if (error.status === 409) return t('Lịch đã thay đổi hoặc có xung đột. Hãy tải lại và tạo đề xuất mới.', 'The schedule changed or contains a conflict. Refresh and create a new proposal.');
    if (error.status === 429) return t('Bạn thao tác quá nhanh. Vui lòng thử lại sau một lát.', 'Too many requests. Please try again shortly.');
    if (error.status >= 500) return t('Máy chủ chưa xử lý được yêu cầu. Vui lòng thử lại.', 'The server could not process this request. Please try again.');
    return error.message;
  }
  if (error instanceof TypeError) return t('Không thể kết nối máy chủ. Kiểm tra kết nối rồi thử lại.', 'Could not reach the server. Check your connection and try again.');
  return error instanceof Error ? error.message : t('Có lỗi xảy ra. Vui lòng thử lại.', 'Something went wrong. Please try again.');
}
export const formatDate = (value: string | Date, timezone: string, pattern: string, locale: Locale = 'vi') =>
  formatInTimeZone(value, timezone, pattern, { locale: locale === 'vi' ? vi : enUS });
export const localDay = (timezone: string, at: Date | number = new Date()) => formatInTimeZone(at, timezone, 'yyyy-MM-dd');
/** Calendar-day arithmetic uses UTC only as a calendar representation, never as the student's timezone. */
export function shiftDay(day: string, delta: number): string {
  const date = new Date(`${day}T12:00:00Z`);
  date.setUTCDate(date.getUTCDate() + delta);
  return date.toISOString().slice(0, 10);
}
export function monday(day: string): string {
  const weekday = new Date(`${day}T12:00:00Z`).getUTCDay();
  return shiftDay(day, -(weekday === 0 ? 6 : weekday - 1));
}
export function calendarRollover(previousDay: string, currentDay: string, week: string, selectedDay: string) {
  if (previousDay === currentDay || selectedDay !== previousDay || week !== monday(previousDay)) return null;
  return { week: monday(currentDay), selectedDay: currentDay };
}
/** All datetime-local values are interpreted in the account timezone, not the browser timezone. */
export function toInstant(wallTime: string, timezone: string): string {
  const date = fromZonedTime(wallTime, timezone);
  if (Number.isNaN(date.getTime()) || formatInTimeZone(date, timezone, "yyyy-MM-dd'T'HH:mm") !== wallTime.slice(0, 16)) {
    throw new Error('Invalid local time / Giờ địa phương không hợp lệ.');
  }
  return date.toISOString();
}
export const toInput = (instant: string, timezone: string) => formatInTimeZone(instant, timezone, "yyyy-MM-dd'T'HH:mm");
export const dayStart = (day: string, timezone: string) => fromZonedTime(`${day}T00:00:00`, timezone).toISOString();
export const timeSetting = (value: string) => value.includes('T') ? value.slice(11, 16) : value.slice(0, 5);
export const minutes = (value: number, locale: Locale) => value < 60 ? `${value} ${locale === 'vi' ? 'phút' : 'min'}` : `${Math.floor(value / 60)}${locale === 'vi' ? 'g' : 'h'}${value % 60 ? ` ${value % 60}${locale === 'vi' ? 'p' : 'm'}` : ''}`;
