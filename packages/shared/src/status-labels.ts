export type Locale = 'vi' | 'en';

export const TASK_STATUS_LABELS = {
  PENDING: { vi: 'Chờ xử lý', en: 'Pending' },
  IN_PROGRESS: { vi: 'Đang thực hiện', en: 'In progress' },
  COMPLETED: { vi: 'Hoàn thành', en: 'Completed' },
  CANCELLED: { vi: 'Đã hủy', en: 'Cancelled' },
} as const;

export const TASK_PRIORITY_LABELS = {
  HIGH: { vi: 'Cao', en: 'High' },
  MEDIUM: { vi: 'Trung bình', en: 'Medium' },
  LOW: { vi: 'Thấp', en: 'Low' },
} as const;

export const EVENT_STATUS_LABELS = {
  SCHEDULED: { vi: 'Đã lên lịch', en: 'Scheduled' },
  COMPLETED: { vi: 'Hoàn thành', en: 'Completed' },
  CANCELLED: { vi: 'Đã hủy', en: 'Cancelled' },
} as const;

export const SUGGESTION_STATUS_LABELS = {
  PENDING: { vi: 'Đang chờ duyệt', en: 'Pending' },
  ACCEPTED: { vi: 'Đã áp dụng', en: 'Accepted' },
  REJECTED: { vi: 'Đã từ chối', en: 'Rejected' },
  EXPIRED: { vi: 'Đã hết hạn', en: 'Expired' },
} as const;

export function getTaskStatusLabel(status: keyof typeof TASK_STATUS_LABELS | string, locale: Locale = 'vi'): string {
  return (TASK_STATUS_LABELS as Record<string, Record<Locale, string>>)[status]?.[locale] ?? status;
}

export function getTaskPriorityLabel(priority: keyof typeof TASK_PRIORITY_LABELS | string, locale: Locale = 'vi'): string {
  return (TASK_PRIORITY_LABELS as Record<string, Record<Locale, string>>)[priority]?.[locale] ?? priority;
}

export function getEventStatusLabel(status: keyof typeof EVENT_STATUS_LABELS | string, locale: Locale = 'vi'): string {
  return (EVENT_STATUS_LABELS as Record<string, Record<Locale, string>>)[status]?.[locale] ?? status;
}

export function getSuggestionStatusLabel(status: keyof typeof SUGGESTION_STATUS_LABELS | string, locale: Locale = 'vi'): string {
  return (SUGGESTION_STATUS_LABELS as Record<string, Record<Locale, string>>)[status]?.[locale] ?? status;
}
