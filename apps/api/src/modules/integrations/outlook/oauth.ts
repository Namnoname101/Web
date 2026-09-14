import { createHash, randomBytes } from 'node:crypto';
import { config } from '../../../config.js';
import { ApiError } from '../../../lib/errors.js';

export const MICROSOFT_SCOPES = ['offline_access', 'https://graph.microsoft.com/User.Read', 'https://graph.microsoft.com/Mail.Read'];
export interface MicrosoftTokens { accessToken: string; refreshToken: string; expiresAt: number; accountId?: string }
export interface MicrosoftProfile { id: string; displayName: string; mail: string | null; userPrincipalName: string; userType?: string }

export function pkcePair(): { verifier: string; challenge: string } {
  const verifier = randomBytes(32).toString('base64url');
  return { verifier, challenge: createHash('sha256').update(verifier).digest('base64url') };
}

export function allowedEmailDomains(): string[] {
  // Official UED ICT student guide: https://ict.ued.udn.vn/uploads/help-ict/help-ict-01.pdf
  return (process.env.MICROSOFT_ALLOWED_EMAIL_DOMAINS || 'ued.udn.vn').split(',').map(x => x.trim().toLowerCase()).filter(Boolean);
}

export function schoolEmail(profile: MicrosoftProfile, domains = allowedEmailDomains()): string {
  if (typeof profile?.id !== 'string' || !profile.id || profile.id.length > 255
    || (typeof profile.userType === 'string' && profile.userType.toLowerCase() === 'guest')) throw new ApiError(403, 'SCHOOL_ACCOUNT_REQUIRED');
  for (const value of [profile.mail, profile.userPrincipalName]) {
    if (typeof value !== 'string' || !value || value.length > 320) continue;
    const email = value.trim().toLowerCase();
    if (/^[^\s@]+@[^\s@]+$/.test(email) && domains.includes(email.split('@')[1])) return email;
  }
  throw new ApiError(403, 'SCHOOL_ACCOUNT_REQUIRED');
}

export function microsoftEndpoint(kind: 'authorize' | 'token'): string {
  const tenant = config.microsoft.tenant;
  if (!/^[a-zA-Z0-9.-]+$/.test(tenant) || ['common', 'consumers'].includes(tenant.toLowerCase())) {
    throw new ApiError(503, 'MICROSOFT_ORGANIZATION_TENANT_REQUIRED');
  }
  return `https://login.microsoftonline.com/${tenant}/oauth2/v2.0/${kind}`;
}

export function assertMicrosoftConfigured(): void {
  if (!config.microsoft.clientId || !config.microsoft.clientSecret) throw new ApiError(503, 'MICROSOFT_NOT_CONFIGURED');
  microsoftEndpoint('authorize');
}

export function authorizationUrl(state: string, challenge: string): string {
  assertMicrosoftConfigured();
  const url = new URL(microsoftEndpoint('authorize'));
  url.search = new URLSearchParams({ client_id: config.microsoft.clientId, response_type: 'code',
    redirect_uri: config.microsoft.redirectUri, response_mode: 'query', scope: MICROSOFT_SCOPES.join(' '),
    state, code_challenge: challenge, code_challenge_method: 'S256', prompt: 'select_account' }).toString();
  return url.toString();
}

/** Graph tokens are opaque. Identity comes from authenticated /me, never unverified JWT claims. */
export async function requestTokens(values: Record<string, string>, previousRefreshToken?: string): Promise<MicrosoftTokens> {
  assertMicrosoftConfigured();
  let response: Response;
  try {
    response = await fetch(microsoftEndpoint('token'), { method: 'POST', redirect: 'error', signal: AbortSignal.timeout(20_000),
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({ client_id: config.microsoft.clientId, client_secret: config.microsoft.clientSecret,
        scope: MICROSOFT_SCOPES.join(' '), ...values }) });
  } catch { throw new ApiError(502, 'MICROSOFT_UNAVAILABLE'); }
  const body = await response.json().catch(() => ({})) as Record<string, unknown>;
  if (!response.ok) {
    if (response.status === 429 || response.status === 503) throw new OutlookThrottleError(retryAfterMillis(response.headers.get('retry-after')));
    if (body.error === 'invalid_grant' || body.error === 'interaction_required') throw new ApiError(401, 'OUTLOOK_REAUTH_REQUIRED');
    throw new ApiError(502, 'MICROSOFT_TOKEN_FAILED');
  }
  const refreshToken = typeof body.refresh_token === 'string' ? body.refresh_token : previousRefreshToken;
  if (typeof body.access_token !== 'string' || !body.access_token || !refreshToken || typeof body.expires_in !== 'number'
    || !Number.isFinite(body.expires_in) || body.expires_in <= 0 || body.expires_in > 7 * 86_400) {
    throw new ApiError(502, 'MICROSOFT_INVALID_TOKEN_RESPONSE');
  }
  const scopes = typeof body.scope === 'string' ? body.scope.toLowerCase().split(' ').map(value => value.split('/').at(-1)) : [];
  if (!scopes.includes('mail.read') || !scopes.includes('user.read')) throw new ApiError(403, 'OUTLOOK_READ_CONSENT_REQUIRED');
  return { accessToken: body.access_token, refreshToken, expiresAt: Date.now() + body.expires_in * 1000 };
}

/** Never forward a bearer token to a URL supplied by an arbitrary email/cursor. */
export function trustedGraphUrl(value: string): string {
  let url: URL;
  try { url = new URL(value); } catch { throw new ApiError(502, 'OUTLOOK_INVALID_PAGE'); }
  if (url.origin !== 'https://graph.microsoft.com' || url.username || url.password || url.hash
    || !['/v1.0/me', '/v1.0/me/messages'].includes(url.pathname)) throw new ApiError(502, 'OUTLOOK_INVALID_PAGE');
  return url.toString();
}

export class OutlookThrottleError extends ApiError {
  constructor(public retryAfterMs: number) { super(429, 'OUTLOOK_THROTTLED'); }
}

export function retryAfterMillis(value: string | null, now = Date.now()): number {
  const seconds = value && /^\d+$/.test(value.trim()) ? Number(value) * 1000 : Date.parse(value || '') - now;
  return Number.isFinite(seconds) ? Math.max(1000, Math.min(seconds, 24 * 60 * 60 * 1000)) : 60_000;
}

export async function graphGet<T>(url: string, accessToken: string): Promise<T> {
  let response: Response;
  try {
    response = await fetch(trustedGraphUrl(url), { signal: AbortSignal.timeout(30_000), redirect: 'error',
      headers: { Authorization: `Bearer ${accessToken}`, Prefer: 'outlook.body-content-type="text", IdType="ImmutableId"' } });
  } catch (error) {
    if (error instanceof ApiError) throw error;
    throw new ApiError(502, 'OUTLOOK_UNAVAILABLE');
  }
  if (response.status === 429 || response.status === 503) throw new OutlookThrottleError(retryAfterMillis(response.headers.get('retry-after')));
  if (response.status === 401) throw new ApiError(401, 'OUTLOOK_REAUTH_REQUIRED');
  if (response.status === 403) throw new ApiError(403, 'OUTLOOK_READ_CONSENT_REQUIRED');
  if (!response.ok) throw new ApiError(502, 'OUTLOOK_REQUEST_FAILED');
  try { return await response.json() as T; } catch { throw new ApiError(502, 'OUTLOOK_INVALID_RESPONSE'); }
}
