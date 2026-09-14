import type { Suggestion } from './types';

export type SuggestionScope = 'all' | 'upcoming' | 'past';
export type SuggestionTiming = { startTime: string; endTime?: string; location?: string };

export interface SuggestionFilters {
  now: number;
  includeHistory: boolean;
  scope: SuggestionScope;
  search: string;
  term: string;
}

const asObject = (value: unknown): Record<string, unknown> | undefined =>
  value !== null && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : undefined;

const validInstant = (value: unknown): string | undefined =>
  typeof value === 'string' && Number.isFinite(Date.parse(value)) ? value : undefined;

const location = (value: unknown): string | undefined =>
  typeof value === 'string' && value.trim() ? value : undefined;

function timingFrom(value: unknown): SuggestionTiming | undefined {
  const candidate = asObject(value);
  const startTime = validInstant(candidate?.startTime);
  if (!startTime) return;
  const endTime = validInstant(candidate?.endTime);
  return {
    startTime,
    // Bad legacy data must not render a negative time range.
    ...(endTime && Date.parse(endTime) > Date.parse(startTime) ? { endTime } : {}),
    ...(location(candidate?.location) ? { location: location(candidate?.location) } : {}),
  };
}

/**
 * Read the occurrence shown in a proposal without depending on one backend
 * payload generation. New UED payloads contain `occurrence`/`after`; older
 * payloads may contain only `changes`, and partial updates can be reconstructed
 * from `before + changes`. Very old payloads stored the occurrence at the root.
 */
export function suggestionTiming(suggestion: Suggestion): SuggestionTiming | undefined {
  const payload = suggestion.payload;
  const before = asObject(payload.before);
  const changes = asObject(payload.changes);
  const mergedChange = before || changes ? { ...before, ...changes } : undefined;

  for (const candidate of [payload.occurrence, payload.after, mergedChange, payload.changes, payload.before, payload]) {
    const timing = timingFrom(candidate);
    if (timing) return timing;
  }

  const firstBlock = payload.blocks
    ?.map((block, index) => ({ block, index, start: validInstant(block.startTime) }))
    .filter((entry): entry is { block: NonNullable<Suggestion['payload']['blocks']>[number]; index: number; start: string } => Boolean(entry.start))
    .sort((a, b) => Date.parse(a.start) - Date.parse(b.start) || a.index - b.index)[0]?.block;
  return firstBlock ? timingFrom(firstBlock) : undefined;
}

export function isSuggestionPending(suggestion: Suggestion, now = Date.now()): boolean {
  const expiresAt = Date.parse(suggestion.expiresAt);
  return suggestion.status === 'PENDING' && Number.isFinite(expiresAt) && expiresAt > now;
}

export function requiresManualReview(suggestion: Suggestion): boolean {
  return suggestion.kind === 'EVENT_CHANGE' && suggestion.payload.action === 'REVIEW';
}

/** The UI and the API both fail closed for REVIEW proposals. */
export function canAcceptSuggestion(suggestion: Suggestion, now = Date.now()): boolean {
  if (!isSuggestionPending(suggestion, now) || requiresManualReview(suggestion)) return false;
  return suggestion.kind !== 'TASK_PLAN' || Boolean(suggestion.payload.blocks?.length);
}

export function suggestionTermKey(suggestion: Suggestion): string {
  const term = suggestion.payload.term;
  if (!term) return 'unknown';
  const academicYear = String(term.academicYear).trim();
  const semester = String(term.semester).trim();
  return academicYear && semester ? `${academicYear}:${semester}` : 'unknown';
}

export function compareSuggestions(a: Suggestion, b: Suggestion, now = Date.now()): number {
  const pendingDifference = Number(isSuggestionPending(b, now)) - Number(isSuggestionPending(a, now));
  if (pendingDifference) return pendingDifference;

  const aTime = suggestionTiming(a)?.startTime;
  const bTime = suggestionTiming(b)?.startTime;
  if (aTime && bTime) {
    const aValue = Date.parse(aTime);
    const bValue = Date.parse(bTime);
    const aUpcoming = aValue >= now;
    const bUpcoming = bValue >= now;
    if (aUpcoming !== bUpcoming) return aUpcoming ? -1 : 1;
    // Nearest upcoming first; most recent historical occurrence first.
    const timeDifference = aUpcoming ? aValue - bValue : bValue - aValue;
    if (timeDifference) return timeDifference;
  }
  if (aTime || bTime) return aTime ? -1 : 1;

  const actionRank: Record<NonNullable<Suggestion['payload']['action']>, number> = {
    CANCEL: 0,
    UPDATE: 1,
    REVIEW: 2,
    CREATE: 3,
  };
  const rankDifference = (a.payload.action ? actionRank[a.payload.action] : 4)
    - (b.payload.action ? actionRank[b.payload.action] : 4);
  if (rankDifference) return rankDifference;

  const titleDifference = a.titleVi.localeCompare(b.titleVi, 'vi');
  return titleDifference || a.id.localeCompare(b.id);
}

export function filterSuggestions(suggestions: Suggestion[], filters: SuggestionFilters): Suggestion[] {
  const query = filters.search.trim().toLocaleLowerCase();
  return suggestions.filter(suggestion => {
    if (!filters.includeHistory && !isSuggestionPending(suggestion, filters.now)) return false;

    const timing = suggestionTiming(suggestion);
    const occurrence = timing ? Date.parse(timing.startTime) : undefined;
    if (filters.scope === 'upcoming' && (occurrence === undefined || occurrence < filters.now)) return false;
    if (filters.scope === 'past' && (occurrence === undefined || occurrence >= filters.now)) return false;
    if (filters.term !== 'all' && suggestionTermKey(suggestion) !== filters.term) return false;

    if (!query) return true;
    const term = suggestion.payload.term;
    const searchable = [
      suggestion.titleVi,
      suggestion.titleEn,
      suggestion.payload.eventTitle,
      timing?.location,
      term?.academicYear,
      term?.semester,
    ].filter(value => value !== undefined && value !== null).join(' ').toLocaleLowerCase();
    return searchable.includes(query);
  }).sort((a, b) => compareSuggestions(a, b, filters.now));
}
