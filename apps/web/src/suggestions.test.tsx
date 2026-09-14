import { describe, expect, it } from 'vitest';
import {
  canAcceptSuggestion,
  compareSuggestions,
  filterSuggestions,
  isSuggestionPending,
  requiresManualReview,
  suggestionTiming,
} from './suggestions';
import type { Suggestion } from './types';

const NOW = Date.parse('2026-09-14T05:00:00.000Z');

function proposal(id: string, payload: Suggestion['payload'] = {}, overrides: Partial<Suggestion> = {}): Suggestion {
  return {
    id,
    kind: 'EVENT_CHANGE',
    status: 'PENDING',
    titleVi: `Đề xuất ${id}`,
    titleEn: `Suggestion ${id}`,
    createdAt: '2026-09-14T00:00:00.000Z',
    expiresAt: '2026-09-21T00:00:00.000Z',
    payload,
    ...overrides,
  };
}

describe('suggestionTiming', () => {
  it('prefers the explicit occurrence in current payloads', () => {
    const item = proposal('new', {
      occurrence: { startTime: '2026-09-16T01:00:00.000Z', endTime: '2026-09-16T03:00:00.000Z', location: 'B3-401' },
      after: { startTime: '2026-09-17T01:00:00.000Z', endTime: '2026-09-17T03:00:00.000Z', location: 'wrong fallback' },
      changes: { startTime: '2026-09-18T01:00:00.000Z' },
    });

    expect(suggestionTiming(item)).toEqual({
      startTime: '2026-09-16T01:00:00.000Z',
      endTime: '2026-09-16T03:00:00.000Z',
      location: 'B3-401',
    });
  });

  it('supports complete legacy changes and very old root-level occurrences', () => {
    expect(suggestionTiming(proposal('changes', {
      changes: { startTime: '2026-09-17T06:00:00.000Z', endTime: '2026-09-17T08:35:00.000Z', location: 'B3-501' },
    }))).toEqual({
      startTime: '2026-09-17T06:00:00.000Z',
      endTime: '2026-09-17T08:35:00.000Z',
      location: 'B3-501',
    });
    expect(suggestionTiming(proposal('root', {
      startTime: '2026-09-18T02:40:00.000Z',
      endTime: '2026-09-18T05:15:00.000Z',
      location: 'A5-204',
    }))).toEqual({
      startTime: '2026-09-18T02:40:00.000Z',
      endTime: '2026-09-18T05:15:00.000Z',
      location: 'A5-204',
    });
  });

  it('falls back to after for new proposals and before for cancellations', () => {
    expect(suggestionTiming(proposal('after', {
      action: 'UPDATE',
      after: { startTime: '2026-09-18T06:00:00.000Z', endTime: '2026-09-18T08:35:00.000Z', location: 'B3-501' },
    }))).toEqual({
      startTime: '2026-09-18T06:00:00.000Z',
      endTime: '2026-09-18T08:35:00.000Z',
      location: 'B3-501',
    });
    expect(suggestionTiming(proposal('cancel', {
      action: 'CANCEL',
      after: null,
      before: { startTime: '2026-09-19T01:00:00.000Z', endTime: '2026-09-19T03:00:00.000Z', location: 'A2-101' },
    }))).toEqual({
      startTime: '2026-09-19T01:00:00.000Z',
      endTime: '2026-09-19T03:00:00.000Z',
      location: 'A2-101',
    });
  });

  it('merges a partial change over before without mutating either snapshot', () => {
    const before = { startTime: '2026-09-19T01:00:00.000Z', endTime: '2026-09-19T03:00:00.000Z', location: 'B3-201' };
    const changes = { location: 'B3-202' };
    const item = proposal('partial', { before, changes });

    expect(suggestionTiming(item)).toEqual({ ...before, location: 'B3-202' });
    expect(item.payload.before).toEqual(before);
    expect(item.payload.changes).toEqual(changes);
  });

  it('uses the earliest valid task block, preserves input order, and hides an invalid end', () => {
    const blocks = [
      { taskId: 'task', startTime: '2026-09-20T04:00:00.000Z', endTime: '2026-09-20T05:00:00.000Z' },
      { taskId: 'task', startTime: 'invalid', endTime: '2026-09-20T02:00:00.000Z' },
      { taskId: 'task', startTime: '2026-09-20T01:00:00.000Z', endTime: '2026-09-20T00:30:00.000Z', location: 'Library' },
    ];
    const item = proposal('blocks', { blocks }, { kind: 'TASK_PLAN' });

    expect(suggestionTiming(item)).toEqual({ startTime: '2026-09-20T01:00:00.000Z', location: 'Library' });
    expect(item.payload.blocks).toEqual(blocks);
  });
});

describe('stable sorting and filtering', () => {
  it('uses one fixed clock: pending first, then upcoming ascending and past descending', () => {
    const futureFar = proposal('future-far', { changes: { startTime: '2026-09-16T05:00:00.000Z' } });
    const futureNear = proposal('future-near', { changes: { startTime: '2026-09-14T06:00:00.000Z' } });
    const pastOld = proposal('past-old', { changes: { startTime: '2026-09-12T05:00:00.000Z' } });
    const pastRecent = proposal('past-recent', { changes: { startTime: '2026-09-14T04:59:59.000Z' } });
    const history = proposal('accepted', { changes: { startTime: '2026-09-14T05:30:00.000Z' } }, { status: 'ACCEPTED' });

    const result = [pastOld, history, futureFar, pastRecent, futureNear]
      .sort((a, b) => compareSuggestions(a, b, NOW));
    expect(result.map(item => item.id)).toEqual(['future-near', 'future-far', 'past-recent', 'past-old', 'accepted']);
  });

  it('breaks equal-time ties deterministically and does not mutate the source array', () => {
    const b = proposal('b', { action: 'CREATE', changes: { startTime: '2026-09-15T05:00:00.000Z' } }, { titleVi: 'Cùng tên' });
    const a = proposal('a', { action: 'CREATE', changes: { startTime: '2026-09-15T05:00:00.000Z' } }, { titleVi: 'Cùng tên' });
    const input = [b, a];

    const result = filterSuggestions(input, { now: NOW, includeHistory: false, scope: 'all', search: '', term: 'all' });
    expect(result.map(item => item.id)).toEqual(['a', 'b']);
    expect(input.map(item => item.id)).toEqual(['b', 'a']);
  });

  it('applies history, occurrence scope, search, and semester filters together', () => {
    const upcoming = proposal('upcoming', {
      action: 'CREATE',
      changes: { startTime: '2026-09-15T05:00:00.000Z', location: 'B3-401' },
      term: { academicYear: 2026, semester: 1 },
    }, { titleVi: 'UED: Tâm lý học' });
    const past = proposal('past', {
      changes: { startTime: '2026-09-13T05:00:00.000Z', location: 'B3-402' },
      term: { academicYear: '2025', semester: '2' },
    });
    const accepted = proposal('accepted', {
      changes: { startTime: '2026-09-15T06:00:00.000Z', location: 'B3-401' },
      term: { academicYear: 2026, semester: 1 },
    }, { status: 'ACCEPTED', titleEn: 'Psychology' });

    expect(filterSuggestions([past, accepted, upcoming], {
      now: NOW, includeHistory: false, scope: 'upcoming', search: 'b3-401', term: '2026:1',
    }).map(item => item.id)).toEqual(['upcoming']);
    expect(filterSuggestions([past, accepted, upcoming], {
      now: NOW, includeHistory: true, scope: 'upcoming', search: 'psychology', term: '2026:1',
    }).map(item => item.id)).toEqual(['accepted']);
    expect(filterSuggestions([past, accepted, upcoming], {
      now: NOW, includeHistory: true, scope: 'past', search: '', term: '2025:2',
    }).map(item => item.id)).toEqual(['past']);
  });
});

describe('acceptance guard', () => {
  it('treats an expiry exactly at now as expired', () => {
    const item = proposal('boundary', {}, { expiresAt: new Date(NOW).toISOString() });
    expect(isSuggestionPending(item, NOW)).toBe(false);
    expect(canAcceptSuggestion(item, NOW)).toBe(false);
  });

  it('never classifies a REVIEW proposal as acceptable', () => {
    const review = proposal('review', { action: 'REVIEW', reason: 'Ambiguous message' }, { expiresAt: '2099-01-01T00:00:00.000Z' });
    expect(requiresManualReview(review)).toBe(true);
    expect(canAcceptSuggestion(review, NOW)).toBe(false);
  });

  it('accepts only actionable proposals and non-empty task plans', () => {
    expect(canAcceptSuggestion(proposal('create', { action: 'CREATE' }), NOW)).toBe(true);
    expect(canAcceptSuggestion(proposal('empty-plan', { blocks: [] }, { kind: 'TASK_PLAN' }), NOW)).toBe(false);
    expect(canAcceptSuggestion(proposal('plan', { blocks: [{
      taskId: 'task', startTime: '2026-09-15T05:00:00.000Z', endTime: '2026-09-15T06:00:00.000Z',
    }] }, { kind: 'TASK_PLAN' }), NOW)).toBe(true);
  });
});
