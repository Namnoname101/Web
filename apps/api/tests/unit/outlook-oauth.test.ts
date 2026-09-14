import { createHash } from 'node:crypto';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { graphGet, pkcePair, schoolEmail, trustedGraphUrl, retryAfterMillis, OutlookThrottleError, type MicrosoftProfile } from '../../src/modules/integrations/outlook/oauth.js';

const profile: MicrosoftProfile = { id: 'stable-graph-account-id', displayName: 'A Student', mail: 'student@ued.udn.vn', userPrincipalName: 'student@ued.udn.vn', userType: 'Member' };
afterEach(() => vi.unstubAllGlobals());

describe('Microsoft OAuth and Graph trust boundaries', () => {
  it('generates independent RFC7636 S256 challenges with sufficient random entropy', () => {
    const a = pkcePair();
    const b = pkcePair();
    expect(a.verifier).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(a.verifier).not.toBe(b.verifier);
    expect(a.challenge).toBe(createHash('sha256').update(a.verifier).digest('base64url'));
  });
  it('requires exact approved school domain and a stable /me identity', () => {
    expect(schoolEmail(profile)).toBe('student@ued.udn.vn');
    expect(schoolEmail({ ...profile, mail: null })).toBe('student@ued.udn.vn');
    for (const address of ['student@ued.udn.vn.attacker.test', 'student@attackerued.udn.vn', 'student@outlook.com']) {
      expect(() => schoolEmail({ ...profile, mail: address, userPrincipalName: address })).toThrow('SCHOOL_ACCOUNT_REQUIRED');
    }
    expect(() => schoolEmail({ ...profile, userType: 'Guest' })).toThrow('SCHOOL_ACCOUNT_REQUIRED');
    expect(() => schoolEmail({ ...profile, id: '' })).toThrow('SCHOOL_ACCOUNT_REQUIRED');
  });
  it('only accepts Graph HTTPS me/messages paging links and preserves the skip token', () => {
    const next = 'https://graph.microsoft.com/v1.0/me/messages?$skiptoken=abc%2B123&$top=50';
    expect(trustedGraphUrl(next)).toBe(next);
    for (const value of ['https://graph.microsoft.com.attacker.test/v1.0/me/messages', 'http://graph.microsoft.com/v1.0/me/messages',
      'https://graph.microsoft.com:444/v1.0/me/messages', 'https://graph.microsoft.com/v1.0/users',
      'https://user:secret@graph.microsoft.com/v1.0/me/messages', 'file:///etc/passwd']) {
      expect(() => trustedGraphUrl(value)).toThrow('OUTLOOK_INVALID_PAGE');
    }
  });
  it('honors Retry-After seconds and dates with bounded backoff', () => {
    expect(retryAfterMillis('120')).toBe(120_000);
    expect(retryAfterMillis('Sun, 13 Sep 2026 09:02:00 GMT', Date.parse('2026-09-13T09:00:00Z'))).toBe(120_000);
    expect(retryAfterMillis(null)).toBe(60_000);
    expect(retryAfterMillis('999999999')).toBe(86_400_000);
  });
  it('never sends a bearer token to an untrusted nextLink', async () => {
    const fetch = vi.fn();
    vi.stubGlobal('fetch', fetch);
    await expect(graphGet('https://attacker.test/steal', 'secret-access-token')).rejects.toThrow('OUTLOOK_INVALID_PAGE');
    expect(fetch).not.toHaveBeenCalled();
  });
  it('turns upstream throttling into a resumable retry without retaining the response body', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response('private upstream detail', { status: 429, headers: { 'retry-after': '42' } })));
    await expect(graphGet('https://graph.microsoft.com/v1.0/me/messages', 'token')).rejects.toMatchObject({
      code: 'OUTLOOK_THROTTLED', retryAfterMs: 42_000,
    } satisfies Partial<OutlookThrottleError>);
  });
  it('makes only authenticated read requests with immutable IDs and text bodies', async () => {
    const fetch = vi.fn().mockResolvedValue(new Response('{"value":[]}'));
    vi.stubGlobal('fetch', fetch);
    await graphGet('https://graph.microsoft.com/v1.0/me/messages', 'opaque-token');
    expect(fetch).toHaveBeenCalledWith(expect.any(String), expect.objectContaining({ redirect: 'error',
      headers: { Authorization: 'Bearer opaque-token', Prefer: 'outlook.body-content-type="text", IdType="ImmutableId"' } }));
  });
});
