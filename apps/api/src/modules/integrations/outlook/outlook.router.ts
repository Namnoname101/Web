import { Router, type Request, type Response } from 'express';
import { rateLimit } from 'express-rate-limit';
import { getPrismaClient, Prisma } from '@personal-schedule/database';
import { config } from '../../../config.js';
import { decrypt, encrypt, hash, token } from '../../../lib/crypto.js';
import { ApiError } from '../../../lib/errors.js';
import { lockUser } from '../../../lib/transaction.js';
import { cookie, cookieOptions, issueSession, requireUser } from '../../auth/session.js';
import { authorizationUrl, graphGet, pkcePair, requestTokens, schoolEmail,
  type MicrosoftProfile, type MicrosoftTokens } from './oauth.js';

const BROWSER_COOKIE = 'ued_microsoft_browser';
const ATTEMPT_MS = 10 * 60_000;
const randomToken = /^[A-Za-z0-9_-]{43}$/;
export const outlookRouter = Router();
const oauthStartLimit = rateLimit({ windowMs: 15 * 60_000, limit: 10, standardHeaders: 'draft-8', legacyHeaders: false,
  message: { error: { code: 'OAUTH_START_RATE_LIMIT' } } });

async function start(req: Request, res: Response, link: boolean) {
  if (link && req.user?.isDemo) throw new ApiError(403, 'DEMO_INTEGRATION_DISABLED');
  const state = token();
  const browser = token();
  const pkce = pkcePair();
  const target = authorizationUrl(state, pkce.challenge);
  const stateHash = hash(state);
  const prisma = getPrismaClient();
  await prisma.oAuthAttempt.deleteMany({ where: { expiresAt: { lte: new Date() } } });
  await prisma.oAuthAttempt.create({ data: { stateHash, browserHash: hash(browser),
    encryptedSecret: encrypt({ verifier: pkce.verifier }, `OAUTH:${stateHash}`),
    userId: link ? req.user!.id : null, expiresAt: new Date(Date.now() + ATTEMPT_MS) } });
  res.cookie(BROWSER_COOKIE, browser, { ...cookieOptions, maxAge: ATTEMPT_MS });
  res.setHeader('Cache-Control', 'no-store');
  res.redirect(target);
}

outlookRouter.get('/auth/microsoft/start', oauthStartLimit, (req, res) => start(req, res, false));
outlookRouter.get('/integrations/outlook/connect', requireUser, oauthStartLimit, (req, res) => start(req, res, true));

/** Resolve identities by the Graph account ID. Email alone never attaches a new identity. */
async function finishIdentity(profile: MicrosoftProfile, tokens: MicrosoftTokens, linkedUserId: string | null,
  claim: { stateHash: string; browserHash: string }) {
  const prisma = getPrismaClient();
  const email = schoolEmail(profile);
  return prisma.$transaction(async tx => {
    // One lock per verified Microsoft identity serializes concurrent callbacks across API replicas.
    await tx.$queryRaw`SELECT pg_advisory_xact_lock(hashtextextended(${`MICROSOFT:${profile.id}`}, 0))::text`;
    const consumeClaim = async () => {
      // Disconnect deletes pending attempts under this same user lock. Keeping the
      // claim until commit also fences callbacks already waiting on Microsoft HTTP.
      const consumed = await tx.oAuthAttempt.deleteMany({ where: { ...claim, expiresAt: { gt: new Date() } } });
      if (consumed.count !== 1) throw new ApiError(409, 'OAUTH_ATTEMPT_CANCELLED');
    };
    let user = await tx.user.findUnique({ where: { microsoftId: profile.id } });
    if (linkedUserId) {
      await lockUser(tx, linkedUserId);
      const current = await tx.user.findUnique({ where: { id: linkedUserId } });
      if (!current || current.isDemo) throw new ApiError(403, 'ACCOUNT_LINK_NOT_ALLOWED');
      if ((user && user.id !== current.id) || (current.microsoftId && current.microsoftId !== profile.id)) {
        throw new ApiError(409, 'MICROSOFT_ACCOUNT_ALREADY_LINKED');
      }
      const emailOwner = await tx.user.findUnique({ where: { email } });
      if (emailOwner && emailOwner.id !== current.id) throw new ApiError(409, 'MICROSOFT_EMAIL_ALREADY_LINKED');
      await consumeClaim();
      // A UED-first account starts with an internal placeholder address. Once
      // Outlook proves the school mailbox, expose that verified address on the
      // same student account instead of leaving two identities in the UI.
      user = await tx.user.update({ where: { id: current.id }, data: { microsoftId: profile.id, email } });
    } else if (!user) {
      if (await tx.user.findUnique({ where: { email } })) throw new ApiError(409, 'ACCOUNT_LINK_REQUIRED');
      user = await tx.user.create({ data: { email, name: (profile.displayName || email.split('@')[0]).slice(0, 120), microsoftId: profile.id } });
    }
    // Sign-in also refreshes an already authorized mailbox connection.
    if (!linkedUserId) {
      await lockUser(tx, user.id);
      await consumeClaim();
    }
    const secret = encrypt({ ...tokens, accountId: profile.id }, `${user.id}:OUTLOOK`);
    await tx.integration.upsert({ where: { userId_provider: { userId: user.id, provider: 'OUTLOOK' } },
      create: { userId: user.id, provider: 'OUTLOOK', status: 'CONNECTED', encryptedSecret: secret },
      update: { status: 'CONNECTED', encryptedSecret: secret, failures: 0, lastError: null,
        lockedUntil: null, leaseToken: null, nextSyncAt: new Date() } });
    return user;
  }, { isolationLevel: Prisma.TransactionIsolationLevel.ReadCommitted, timeout: 15_000 });
}

outlookRouter.get('/auth/microsoft/callback', async (req, res) => {
  res.setHeader('Cache-Control', 'no-store');
  let claim: { stateHash: string; browserHash: string } | undefined;
  try {
    const state = typeof req.query.state === 'string' ? req.query.state : '';
    const browser = cookie(req, BROWSER_COOKIE) || '';
    if (!randomToken.test(state) || !randomToken.test(browser)) throw new ApiError(400, 'OAUTH_STATE_INVALID');
    const prisma = getPrismaClient();
    const stateHash = hash(state);
    const attempt = await prisma.oAuthAttempt.findUnique({ where: { stateHash } });
    if (!attempt || attempt.browserHash !== hash(browser) || +attempt.expiresAt <= Date.now()) {
      throw new ApiError(400, 'OAUTH_STATE_INVALID');
    }
    if (attempt.userId && attempt.userId !== req.user?.id) throw new ApiError(401, 'OAUTH_SESSION_CHANGED');
    // Atomically rotate the browser binding to claim this callback once. Retain the
    // row until finishIdentity so a student's disconnect can cancel in-flight work.
    const browserHash = hash(token());
    const claimed = await prisma.oAuthAttempt.updateMany({ where: { stateHash, browserHash: hash(browser), expiresAt: { gt: new Date() } },
      data: { browserHash } });
    if (claimed.count !== 1) throw new ApiError(400, 'OAUTH_STATE_INVALID');
    claim = { stateHash, browserHash };
    res.clearCookie(BROWSER_COOKIE, cookieOptions);
    if (req.query.error) throw new ApiError(400, 'MICROSOFT_CONSENT_DECLINED');
    const code = typeof req.query.code === 'string' ? req.query.code : '';
    if (!code || code.length > 8192) throw new ApiError(400, 'OAUTH_CODE_MISSING');
    const { verifier } = decrypt<{ verifier: string }>(attempt.encryptedSecret, `OAUTH:${stateHash}`);
    const tokens = await requestTokens({ grant_type: 'authorization_code', code, redirect_uri: config.microsoft.redirectUri, code_verifier: verifier });
    const profile = await graphGet<MicrosoftProfile>('https://graph.microsoft.com/v1.0/me?$select=id,displayName,mail,userPrincipalName,userType', tokens.accessToken);
    const user = await finishIdentity(profile, tokens, attempt.userId, claim);
    await issueSession(user.id, res);
    res.redirect(`${config.webOrigin}/?outlook=connected`);
  } catch (error) {
    // Never reflect upstream OAuth error_description or secrets into a URL/log.
    const code = error instanceof ApiError ? error.code : 'MICROSOFT_SIGNIN_FAILED';
    res.redirect(`${config.webOrigin}/?authError=${encodeURIComponent(code)}`);
  } finally {
    // Failed/declined callbacks cannot be replayed, and the periodic expiry cleanup
    // still handles process exits before this best-effort cleanup executes.
    if (claim) await getPrismaClient().oAuthAttempt.deleteMany({ where: claim }).catch(() => undefined);
  }
});
