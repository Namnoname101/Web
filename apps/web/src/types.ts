export type Locale = 'vi' | 'en';
export type View = 'dashboard' | 'calendar' | 'tasks' | 'suggestions' | 'notifications' | 'integrations' | 'settings' | 'chat' | 'study-rooms';
export interface User {
  id: string; name: string; email: string; studentId?: string | null;
  locale: Locale; timezone: string; isDemo: boolean;
  activeStartTime: string; activeEndTime: string; breakStartTime: string; breakEndTime: string;
  minBlockMinutes: number; travelMinutes: number; studyLocation: string | null; notificationsEnabled: boolean;
}
export interface CalendarEvent {
  id: string; title: string; startTime: string; endTime: string; location: string | null;
  eventType: 'CLASS' | 'PERSONAL' | 'DEADLINE'; status: 'SCHEDULED' | 'CANCELLED' | 'COMPLETED'; source: string;
}
export interface Task {
  id: string; title: string; notes: string; location: string | null; durationMinutes: number; deadline: string;
  priority: 'HIGH' | 'MEDIUM' | 'LOW'; status: 'PENDING' | 'IN_PROGRESS' | 'COMPLETED' | 'CANCELLED';
  isSplittable: boolean; isScheduled: boolean; scheduleBlocks?: ScheduleBlock[];
}
export interface TaskHistoryPage { hasMore: boolean; nextCursor: string | null }
export interface TaskStats { active: number; completed: number; cancelled: number }
export interface ScheduleBlock {
  id: string; taskId: string; startTime: string; endTime: string; location: string | null;
  status: 'SCHEDULED' | 'COMPLETED' | 'CANCELLED'; task?: Task;
}
export interface AgendaCollection { events: CalendarEvent[]; blocks: ScheduleBlock[] }
export interface AgendaOverview {
  asOf: string; localDate: string; dayStart: string; dayEnd: string; limit: number;
  today: AgendaCollection; upcoming: AgendaCollection; past: AgendaCollection;
}
export interface ProposedBlock { taskId: string; taskTitle?: string; title?: string; startTime: string; endTime: string; location?: string | null }
export interface Suggestion {
  id: string; kind: 'TASK_PLAN' | 'EVENT_CHANGE'; status: 'PENDING' | 'ACCEPTED' | 'EXPIRED' | 'REJECTED';
  titleVi: string; titleEn: string; createdAt: string; expiresAt: string;
  payload: {
    blocks?: ProposedBlock[]; unscheduled?: { title?: string; taskTitle?: string; taskId?: string; reason: string }[];
    eventId?: string; eventTitle?: string; reason?: string; evidence?: unknown; source?: string;
    changes?: Record<string, unknown>; before?: Record<string, unknown>; after?: Record<string, unknown> | null;
    occurrence?: Record<string, unknown>;
    action?: 'CREATE' | 'UPDATE' | 'CANCEL' | 'REVIEW';
    term?: { academicYear: number | string; semester: number | string };
    [key: string]: unknown;
  };
}
export interface Notification { id: string; titleVi: string; titleEn: string; bodyVi: string; bodyEn: string; readAt: string | null; createdAt: string }
export interface Integration { id?: string; provider: 'UED' | 'OUTLOOK'; status: 'CONNECTED' | 'REAUTH_REQUIRED' | 'ERROR' | 'DISCONNECTED'; lastSyncAt: string | null; lastError?: string | null; cursor?: { uedTerm?: { academicYear: number; semester: number }; uedTermMode?: 'CURRENT' | 'SELECTED'; uedTermChoices?: { academicYears: { value: number | string; label: string }[]; semesters: { value: number | string; label: string }[]; selected: { academicYear: number; semester: number } }; [key: string]: unknown } }
export interface AcademicRecord { id: string; category: string; title: string; data: Record<string, unknown>; syncedAt: string }
export interface Bootstrap { user: User; events: CalendarEvent[]; blocks: ScheduleBlock[]; tasks: Task[]; taskHistoryPage: TaskHistoryPage; taskStats: TaskStats; suggestions: Suggestion[]; notifications: Notification[]; integrations: Integration[]; academicRecords: AcademicRecord[]; agendaOverview: AgendaOverview }
export interface TaskBlocksResponse { blocks: ScheduleBlock[]; hasFutureBlocks: boolean; page: TaskHistoryPage }
export interface TaskHistoryResponse { tasks: Task[]; page: Pick<TaskHistoryPage, 'hasMore' | 'nextCursor'> }
export interface AuthConfig { demoEnabled: boolean; microsoftEnabled: boolean; uedEnabled: boolean }
export interface AgendaItem { id: string; title: string; startTime: string; endTime: string; location: string | null; kind: 'CLASS' | 'PERSONAL' | 'DEADLINE' | 'TASK'; event?: CalendarEvent; task?: Task; block?: ScheduleBlock }

export interface StudentPublicProfile {
  id: string;
  name: string;
  email: string;
  studentId: string | null;
}

export interface DirectChatMessage {
  id: string;
  conversationId: string;
  senderId: string;
  content: string;
  isRead: boolean;
  createdAt: string;
  sender?: {
    id: string;
    name: string;
    studentId: string | null;
  };
}

export interface ConversationSummary {
  id: string;
  createdAt: string;
  updatedAt: string;
  otherUser: StudentPublicProfile;
  lastMessage: {
    id: string;
    content: string;
    senderId: string;
    createdAt: string;
    isRead: boolean;
  } | null;
}

export interface StudyRoomSummary {
  id: string;
  title: string;
  description: string | null;
  hasPasscode: boolean;
  maxParticipants: number;
  participantCount: number;
  host: {
    id: string;
    name: string;
    studentId: string | null;
  };
  pomodoroState: 'IDLE' | 'FOCUS' | 'BREAK';
  focusMinutes: number;
  breakMinutes: number;
  timerEndsAt: string | null;
  participants: {
    userId: string;
    name: string;
    studentId: string | null;
    currentTask: string | null;
    isCamOn: boolean;
    isMicOn: boolean;
  }[];
}

export interface StudyRoomInvite {
  id: string;
  roomId: string;
  targetStudentId: string;
  status: 'PENDING' | 'ACCEPTED' | 'DECLINED';
  createdAt: string;
  room: {
    id: string;
    title: string;
    description: string | null;
  };
  inviter: {
    id: string;
    name: string;
    studentId: string | null;
  };
}
