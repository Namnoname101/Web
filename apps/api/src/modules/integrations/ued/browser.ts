import { chromium, type Browser, type BrowserContext, type Page } from 'playwright';
import { hash, token } from '../../../lib/crypto.js';
import { ApiError } from '../../../lib/errors.js';
import { AdmissionGate } from '../../../lib/admission-gate.js';
import { UED_LOGIN_PATH, UED_ORIGIN, trustedUedUrl, type UedAdapter, type UedRecord, mapUedRows,
  type UedTerm, type UedTermChoices, type UedTermOption, type UedWeekRange, mapUedWeekRanges, mapUedCurrentTerm } from './adapter.js';

export type UedStorageState = Awaited<ReturnType<BrowserContext['storageState']>>;
export const UED_CHALLENGE_TTL_MS = 5 * 60_000;
export const UED_CONTEXT_CLOSE_TIMEOUT_MS = 3_000;
const MAX_CONTEXTS = 6;
const MAX_LOGIN_CHALLENGES = 3;
let browserPromise: Promise<Browser> | undefined;
let contextCount = 0;
const loginChallengeAdmission = new AdmissionGate(MAX_LOGIN_CHALLENGES);
const startingLoginAdmissions = new Set<() => void>();
let lifecycleGeneration = 0;
let shutdownPending: Promise<void> | undefined;

interface PortalContext {
  context: BrowserContext; page: Page;
  allowLoginPost: boolean;
  allowTimetableFilter?: UedTerm;
  allowPageEntry?: { path: string };
  close(): Promise<void>;
}
interface LoginChallenge {
  id: string; browserHash: string; userId?: string; expiresAt: number;
  adapter: UedAdapter; portal: PortalContext; busy: boolean; attempts: number;
  timer: ReturnType<typeof setTimeout>;
  releaseAdmission: () => void;
}
const challenges = new Map<string, LoginChallenge>();

async function closeBrowserContext(context: BrowserContext): Promise<void> {
  let reachedDeadline = false;
  let timer: ReturnType<typeof setTimeout> | undefined;
  const closing = Promise.resolve().then(() => context.close()).catch(() => undefined);
  const deadline = new Promise<void>(resolve => {
    timer = setTimeout(() => { reachedDeadline = true; resolve(); }, UED_CONTEXT_CLOSE_TIMEOUT_MS);
    timer.unref();
  });
  await Promise.race([closing, deadline]);
  if (timer) clearTimeout(timer);
  if (reachedDeadline) console.warn('UED browser context close deadline reached.');
}

async function browser(): Promise<Browser> {
  browserPromise ??= chromium.launch({ headless: true }).then(instance => {
    instance.on('disconnected', () => { browserPromise = undefined; });
    return instance;
  }).catch(() => {
    browserPromise = undefined;
    throw new ApiError(503, 'UED_BROWSER_UNAVAILABLE', 'Install the Playwright Chromium runtime on the configured browser path.');
  });
  return browserPromise;
}

export function allowedPortalRequest(urlString: string, method: string, resourceType: string, loginAllowed: boolean, readPaths: string[],
  timetableFilter?: UedTerm, postData?: string | null, pageEntry?: { path: string }): boolean {
  let url: URL;
  try { url = new URL(urlString); } catch { return false; }
  if (url.origin !== UED_ORIGIN || url.username || url.password) return false;
  if (method === 'POST') {
    if (loginAllowed && url.pathname === UED_LOGIN_PATH && !url.search) return true;
    if (pageEntry && resourceType === 'document' && url.pathname === pageEntry.path && !url.search
      && isPageEntryBody(postData)) return true;
    return !!timetableFilter && resourceType === 'document' && url.pathname === '/sinhvien/thoikhoabieu/index'
      && !url.search && isTimetableFilterBody(postData, timetableFilter);
  }
  if (!['GET', 'HEAD'].includes(method)) return false;
  try { trustedUedUrl(`${url.pathname}${url.search}`); } catch { return false; }
  // Navigation, XHR and fetch are limited to observed, operator-reviewed URLs.
  // Other same-origin GETs serve visual/static resources, not arbitrary actions.
  if (['document', 'xhr', 'fetch'].includes(resourceType)) {
    return readPaths.includes(`${url.pathname}${url.search}`);
  }
  return ['image', 'stylesheet', 'script', 'font'].includes(resourceType);
}

/** The home menu opens a read-only page with a one-use POST containing only
 * its reviewed page-unit ID and the portal's existing session token. */
export function isPageEntryBody(body: string | null | undefined): boolean {
  if (!body || body.length > 2_000) return false;
  const fields = new URLSearchParams(body);
  if ([...fields.keys()].some(key => !['pu', 'sskey'].includes(key))) return false;
  if (fields.getAll('pu').length !== 1 || fields.getAll('sskey').length !== 1) return false;
  const sessionKey = fields.get('sskey') || '';
  // pu is a per-session opaque page-unit ID. It is never accepted from our API:
  // only the verified portal click can produce it during this one-use window.
  return /^[a-f0-9]{32}\|[a-f0-9]{32}$/.test(fields.get('pu') || '') && sessionKey.length >= 8 && sessionKey.length <= 512;
}

/** The portal uses a POST for its read-only search. Keep this exception confined
 * to the observed filter controls and one expected semester; no save/print or
 * arbitrary hidden action may be submitted through it. Values such as sskey
 * remain in browser memory and are never logged or persisted by this check. */
export function isTimetableFilterBody(body: string | null | undefined, term: UedTerm): boolean {
  if (!body || body.length > 200_000) return false;
  const fields = new URLSearchParams(body);
  const permitted = new Set(['h_monhoc', 'cmb_order_adv_com_sr', 'cmb_order_adv_type_sr', 'cmb_sr',
    'cmb_sr_ds_nam_hoc', 'cmb_sr_ds_hoc_ky', 'cmbkieuin', 'cmbtuan', 'btnSearch',
    'h_app_action', 'h_ds_app_action', 'h_first_indexindex', 'h_index[]', 'h_tuychon', 'h_tuan', 'sskey']);
  if ([...fields.keys()].some(key => !permitted.has(key))) return false;
  for (const key of ['cmb_sr_ds_nam_hoc', 'cmb_sr_ds_hoc_ky', 'h_app_action', 'h_ds_app_action']) {
    if (fields.getAll(key).length !== 1) return false;
  }
  if (fields.get('cmb_sr_ds_nam_hoc') !== term.academicYear || fields.get('cmb_sr_ds_hoc_ky') !== term.semester) return false;
  return !fields.get('h_app_action') && !fields.get('h_ds_app_action') && !fields.get('h_tuychon') && !fields.get('h_tuan');
}

async function openPortal(adapter: UedAdapter, storageState?: UedStorageState): Promise<PortalContext> {
  if (contextCount >= MAX_CONTEXTS) throw new ApiError(429, 'UED_BROWSER_BUSY');
  contextCount++;
  let context: BrowserContext | undefined;
  try {
    context = await (await browser()).newContext({
      storageState, viewport: { width: 1280, height: 850 },
      locale: 'vi-VN', timezoneId: adapter.timezone, serviceWorkers: 'block',
      acceptDownloads: false,
    });
    context.setDefaultTimeout(12_000);
    context.setDefaultNavigationTimeout(25_000);
    const page = await context.newPage();
    const paths = ['/', UED_LOGIN_PATH, ...[adapter.auth.identityPath, ...adapter.auth.landingPaths,
      ...adapter.pages.flatMap(mapping => mapping.termFilter ? [mapping.path, '/sinhvien/thoikhoabieu/index', ...(mapping.entry ? [mapping.entry.path] : [])] : [mapping.path, ...(mapping.entry ? [mapping.entry.path] : [])])].map(path => {
      const url = new URL(trustedUedUrl(path)); return `${url.pathname}${url.search}`;
    })];
    let closed = false;
    const portal: PortalContext = {
      context, page, allowLoginPost: false,
      async close() {
        if (closed) return;
        closed = true;
        try { await closeBrowserContext(context!); }
        finally { contextCount--; }
      },
    };
    await context.route('**/*', async route => {
      const request = route.request();
      const allowed = allowedPortalRequest(request.url(), request.method(), request.resourceType(), portal.allowLoginPost, paths,
        portal.allowTimetableFilter, request.method() === 'POST' ? request.postData() : undefined, portal.allowPageEntry);
      if (!allowed && ['document', 'xhr', 'fetch'].includes(request.resourceType())) {
        let path = '[external-or-invalid]';
        try { const url = new URL(request.url()); if (url.origin === UED_ORIGIN) path = url.pathname; } catch { /* keep redacted */ }
        console.warn('UED request blocked by read-only policy', { method: request.method(), resourceType: request.resourceType(), path });
      }
      if (allowed && request.method() === 'POST') {
        portal.allowLoginPost = false; portal.allowTimetableFilter = undefined; portal.allowPageEntry = undefined;
      }
      if (allowed) await route.continue();
      else await route.abort('blockedbyclient');
    });
    // WebSockets cannot be used by scripts to escape the read-only HTTP policy.
    await context.routeWebSocket('**/*', socket => socket.close());
    context.on('page', extra => { if (extra !== page) void extra.close(); });
    page.on('dialog', dialog => { void dialog.dismiss(); });
    return portal;
  } catch (error) {
    try { if (context) await closeBrowserContext(context); }
    finally { contextCount--; }
    throw error;
  }
}

export async function verifiedIdentity(page: Page, adapter: UedAdapter): Promise<{ studentId: string; name?: string } | null> {
  if (new URL(page.url()).origin !== UED_ORIGIN) return null;
  if (await page.locator('#txt_Login_ten_dang_nhap').isVisible().catch(() => false)) return null;
  const marker = page.locator(adapter.auth.authenticatedSelector);
  const identity = page.locator(adapter.auth.studentIdSelector);
  if (await marker.count() !== 1 || !await marker.isVisible() || await identity.count() !== 1 || !await identity.isVisible()) return null;
  const studentId = (adapter.auth.studentIdAttribute
    ? await identity.getAttribute(adapter.auth.studentIdAttribute) : await identity.innerText())?.trim();
  if (!studentId || !/^[a-zA-Z0-9._-]{3,64}$/.test(studentId)) return null;
  let name: string | undefined;
  if (adapter.auth.nameSelector) {
    const nameElement = page.locator(adapter.auth.nameSelector);
    if (await nameElement.count() === 1) name = ((adapter.auth.nameAttribute
      ? await nameElement.getAttribute(adapter.auth.nameAttribute) : await nameElement.innerText()) || '').trim().slice(0, 120) || undefined;
  }
  return { studentId, name };
}

async function captcha(challenge: LoginChallenge): Promise<{ required: boolean; imageDataUrl?: string }> {
  const { adapter, portal } = challenge;
  if (!adapter.auth.captchaInputSelector) return { required: false };
  const field = portal.page.locator(adapter.auth.captchaInputSelector);
  if (await field.count() !== 1 || !await field.isVisible()) return { required: false };
  const picture = portal.page.locator(adapter.auth.captchaImageSelector!);
  if (await picture.count() !== 1 || !await picture.isVisible()) throw new ApiError(502, 'UED_CAPTCHA_MAPPING_FAILED');
  const size = await picture.boundingBox();
  // Only the CAPTCHA element is sent to the browser, never the portal page or cookies.
  if (!size || size.width > 1200 || size.height > 700) throw new ApiError(502, 'UED_CAPTCHA_MAPPING_FAILED');
  const png = await picture.screenshot({ type: 'png', timeout: 5_000 });
  return { required: true, imageDataUrl: `data:image/png;base64,${png.toString('base64')}` };
}

async function description(challenge: LoginChallenge) {
  return { challengeId: challenge.id, expiresAt: new Date(challenge.expiresAt).toISOString(),
    captcha: await captcha(challenge), mappingReady: true };
}

export async function closeChallenge(browserToken?: string): Promise<void> {
  if (!browserToken) return;
  const challenge = challenges.get(hash(browserToken));
  if (!challenge) return;
  challenges.delete(challenge.browserHash);
  clearTimeout(challenge.timer);
  try { await challenge.portal.close(); }
  finally { challenge.releaseAdmission(); }
}

export async function startUedLogin(adapter: UedAdapter, userId?: string) {
  if (shutdownPending) throw new ApiError(503, 'UED_BROWSER_SHUTTING_DOWN');
  // Public login starts must never consume all browser contexts needed by
  // connected students' background timetable syncs.
  const releaseAdmission = loginChallengeAdmission.tryAcquire();
  if (!releaseAdmission) throw new ApiError(429, 'UED_CHALLENGE_CAPACITY');
  const generation = lifecycleGeneration;
  startingLoginAdmissions.add(releaseAdmission);
  const browserToken = token();
  const browserHash = hash(browserToken);
  let portal: PortalContext;
  try {
    portal = await openPortal(adapter);
    if (generation !== lifecycleGeneration) {
      await portal.close();
      throw new ApiError(503, 'UED_BROWSER_SHUTTING_DOWN');
    }
  } catch (error) {
    releaseAdmission();
    throw error;
  } finally {
    startingLoginAdmissions.delete(releaseAdmission);
  }
  const challenge: LoginChallenge = { id: token(), browserHash, userId, adapter, portal,
    expiresAt: Date.now() + UED_CHALLENGE_TTL_MS, attempts: 0, busy: false, releaseAdmission,
    timer: setTimeout(() => { void closeChallenge(browserToken); }, UED_CHALLENGE_TTL_MS) };
  challenge.timer.unref();
  challenges.set(browserHash, challenge);
  try {
    await portal.page.goto(`${UED_ORIGIN}/`, { waitUntil: 'domcontentloaded' });
    await portal.page.locator('#txt_Login_ten_dang_nhap').waitFor({ state: 'visible' });
    return { browserToken, ...(await description(challenge)) };
  } catch {
    await closeChallenge(browserToken);
    throw new ApiError(502, 'UED_LOGIN_PAGE_UNAVAILABLE');
  }
}

export async function submitUedLogin(browserToken: string | undefined, input: {
  challengeId: string; studentId: string; password: string; captcha?: string;
}, userId?: string) {
  const challenge = browserToken ? challenges.get(hash(browserToken)) : undefined;
  if (!challenge || challenge.id !== input.challengeId || challenge.userId !== userId) {
    throw new ApiError(410, 'UED_CHALLENGE_EXPIRED');
  }
  if (challenge.expiresAt <= Date.now()) {
    await closeChallenge(browserToken);
    throw new ApiError(410, 'UED_CHALLENGE_EXPIRED');
  }
  if (challenge.busy) throw new ApiError(409, 'UED_LOGIN_IN_PROGRESS');
  if (++challenge.attempts > 5) {
    await closeChallenge(browserToken);
    throw new ApiError(429, 'UED_LOGIN_ATTEMPTS_EXCEEDED');
  }
  challenge.busy = true;
  const { page } = challenge.portal;
  try {
    const captchaState = await captcha(challenge);
    if (captchaState.required && !input.captcha) return { status: 'CHALLENGE_REQUIRED' as const, ...(await description(challenge)) };
    // Check the actual public form action before handing credentials to it.
    const submit = page.locator('[name="bt_Login_submit"]');
    const form = await submit.evaluate(element => {
      const owner = (element as HTMLInputElement).form;
      return owner ? { action: owner.action, method: owner.method.toUpperCase() } : null;
    });
    if (!form || form.action !== `${UED_ORIGIN}${UED_LOGIN_PATH}` || form.method !== 'POST') throw new ApiError(502, 'UED_LOGIN_FORM_CHANGED');
    await page.locator('#txt_Login_ten_dang_nhap').fill(input.studentId);
    await page.locator('#pw_Login_mat_khau').fill(input.password);
    if (captchaState.required) await page.locator(challenge.adapter.auth.captchaInputSelector!).fill(input.captcha!);
    challenge.portal.allowLoginPost = true;
    await Promise.all([page.waitForNavigation({ waitUntil: 'domcontentloaded' }), submit.click()]);
    // The verified identity lives on a read-only profile GET, not in submitted
    // login fields. Never trust the caller's supplied student ID on its own.
    if (!await page.locator('#txt_Login_ten_dang_nhap').isVisible()) {
      await page.goto(trustedUedUrl(challenge.adapter.auth.identityPath), { waitUntil: 'domcontentloaded' });
    }
    // Do not treat a 200 response or a disappeared password field as successful authentication.
    await page.locator(challenge.adapter.auth.authenticatedSelector).waitFor({ state: 'visible', timeout: 8_000 }).catch(() => undefined);
    const identity = await verifiedIdentity(page, challenge.adapter);
    if (!identity) return { status: 'CHALLENGE_REQUIRED' as const, error: 'UED_LOGIN_NOT_VERIFIED', ...(await description(challenge)) };
    if (identity.studentId !== input.studentId) throw new ApiError(409, 'UED_IDENTITY_MISMATCH');
    const storageState = await challenge.portal.context.storageState({ indexedDB: true });
    const result = { status: 'VERIFIED' as const, identity, storageState };
    await closeChallenge(browserToken);
    return result;
  } catch (error) {
    // Missing CAPTCHA and an ordinary rejected credential return above and
    // remain retryable. Exceptions indicate a changed/unknown portal state;
    // discard that context so it cannot retain scarce global capacity.
    await closeChallenge(browserToken);
    throw error;
  } finally {
    challenge.busy = false;
    challenge.portal.allowLoginPost = false;
    // Clear form credentials after failed submissions; never persist or log them.
    await page.locator('#pw_Login_mat_khau').fill('', { timeout: 500 }).catch(() => undefined);
  }
}

async function selectChoices(page: Page, selector: string, errorCode = 'UED_TERM_OPTIONS_MAPPING_FAILED'): Promise<UedTermOption[]> {
  // Some portal responses finish parsing before the dependent select is
  // rendered/populated. Wait for the actual control instead of interpreting
  // a transient empty collection as academic data.
  const control = page.locator(selector);
  const fail = async () => {
    // Selector names and current path are safe operational metadata. Never log
    // option values, page text, query strings, cookies or hidden form tokens.
    console.warn('UED mapping control unavailable', { errorCode, path: new URL(page.url()).pathname });
    throw new ApiError(502, errorCode);
  };
  await control.waitFor({ state: 'visible' }).catch(fail);
  if (await control.count() !== 1) await fail();
  const options = await page.locator(`${selector} option`).evaluateAll(elements => elements.map(element => ({
    value: (element as HTMLOptionElement).value, label: (element.textContent || '').replace(/\s+/g, ' ').trim(),
  })));
  if (!options.length || options.length > 200 || options.some(option => option.value.length > 100 || option.label.length > 255)) {
    throw new ApiError(502, errorCode);
  }
  return options;
}

async function timetableTerm(portal: PortalContext, requested?: UedTerm): Promise<UedTermChoices> {
  const { page } = portal;
  const academicYears = await selectChoices(page, '#cmb_sr_ds_nam_hoc', 'UED_ACADEMIC_YEAR_OPTIONS_FAILED');
  const semesters = await selectChoices(page, '#cmb_sr_ds_hoc_ky', 'UED_SEMESTER_OPTIONS_FAILED');
  const current = mapUedCurrentTerm(await page.locator('td').evaluateAll(elements => elements.map(el => (el as HTMLElement).innerText || '')));
  const displayed = {
    academicYear: await page.locator('#cmb_sr_ds_nam_hoc').inputValue(),
    semester: await page.locator('#cmb_sr_ds_hoc_ky').inputValue(),
  };
  const selected = requested || current;
  if (!academicYears.some(option => option.value === selected.academicYear)
    || !semesters.some(option => option.value === selected.semester)) throw new ApiError(400, 'UED_TERM_NOT_AVAILABLE');
  if (displayed.academicYear !== selected.academicYear || displayed.semester !== selected.semester) {
    const form = await page.locator('#frmMain').evaluate(element => ({
      action: (element as HTMLFormElement).action, method: (element as HTMLFormElement).method.toUpperCase(),
    }));
    if (form.action !== `${UED_ORIGIN}/sinhvien/thoikhoabieu/index` || form.method !== 'POST') throw new ApiError(502, 'UED_FILTER_FORM_CHANGED');
    await page.locator('#cmb_sr_ds_nam_hoc').selectOption(selected.academicYear);
    await page.locator('#cmb_sr_ds_hoc_ky').selectOption(selected.semester);
    portal.allowTimetableFilter = selected;
    try {
      await Promise.all([
        page.waitForNavigation({ waitUntil: 'domcontentloaded' }),
        page.locator('#cmb_s_sr').click(),
      ]);
    } finally { portal.allowTimetableFilter = undefined; }
    if (await page.locator('#txt_Login_ten_dang_nhap').isVisible()) throw new ApiError(401, 'UED_REAUTH_REQUIRED');
    if (await page.locator('#cmb_sr_ds_nam_hoc').inputValue() !== selected.academicYear
      || await page.locator('#cmb_sr_ds_hoc_ky').inputValue() !== selected.semester) throw new ApiError(502, 'UED_TERM_SELECTION_FAILED');
  }
  // Both views are local display controls on the verified timetable page.
  if (await page.locator('#cmbkieuin').count()) await page.locator('#cmbkieuin').selectOption('1');
  return { academicYears, semesters, selected, current };
}

export async function readUedPortal(adapter: UedAdapter, storageState: UedStorageState, expectedStudentId: string,
  requestedTerm?: UedTerm): Promise<{ records: UedRecord[]; storageState: UedStorageState; termChoices?: UedTermChoices; weekRanges?: UedWeekRange[] }> {
  const portal = await openPortal(adapter, storageState);
  try {
    await portal.page.goto(trustedUedUrl(adapter.auth.identityPath), { waitUntil: 'domcontentloaded' });
    const identity = await verifiedIdentity(portal.page, adapter);
    if (!identity) throw new ApiError(401, 'UED_REAUTH_REQUIRED');
    if (identity.studentId !== expectedStudentId) throw new ApiError(409, 'UED_IDENTITY_MISMATCH');
    const records: UedRecord[] = [];
    let termChoices: UedTermChoices | undefined;
    let weekRanges: UedWeekRange[] | undefined;
    for (const mapping of adapter.pages) {
      if (mapping.entry) {
        const entryResponse = await portal.page.goto(trustedUedUrl(mapping.entry.path), { waitUntil: 'domcontentloaded' });
        if (!entryResponse?.ok()) throw new ApiError(502, 'UED_PAGE_UNAVAILABLE');
        const trigger = portal.page.locator(mapping.entry.selector);
        if (await trigger.count() !== 1 || !await trigger.isVisible()) throw new ApiError(502, 'UED_PAGE_ENTRY_FAILED');
        portal.allowPageEntry = { path: mapping.path };
        try { await Promise.all([portal.page.waitForNavigation({ waitUntil: 'domcontentloaded' }), trigger.click()]); }
        finally { portal.allowPageEntry = undefined; }
        const current = new URL(portal.page.url());
        if (current.origin !== UED_ORIGIN || current.pathname !== mapping.path || current.search) throw new ApiError(502, 'UED_PAGE_ENTRY_FAILED');
      } else {
        const response = await portal.page.goto(trustedUedUrl(mapping.path), { waitUntil: 'domcontentloaded' });
        if (!response?.ok()) throw new ApiError(502, 'UED_PAGE_UNAVAILABLE');
      }
      if (await portal.page.locator('#txt_Login_ten_dang_nhap').isVisible()) throw new ApiError(401, 'UED_REAUTH_REQUIRED');
      if (mapping.termFilter) termChoices = await timetableTerm(portal, requestedTerm);
      if (mapping.termFilter && await portal.page.getByText('Không có dữ liệu.', { exact: true }).isVisible().catch(() => false)) continue;
      await portal.page.locator(mapping.readySelector).waitFor({ state: 'visible' });
      const rows = portal.page.locator(mapping.rowSelector);
      const count = await rows.count();
      if (count > 5000) throw new ApiError(502, 'UED_PAGE_TOO_LARGE');
      const raw: Record<string, string>[] = [];
      for (let index = 0; index < count; index++) {
        const row = rows.nth(index);
        const fields: Record<string, string> = {};
        for (const [key, field] of Object.entries(mapping.fields)) {
          const element = row.locator(field.selector);
          if (await element.count() !== 1) throw new ApiError(502, 'UED_FIELD_MAPPING_FAILED');
          const value = field.attribute ? await element.getAttribute(field.attribute) : await element.innerText();
          if ((value?.length || 0) > 10_000) throw new ApiError(502, 'UED_FIELD_TOO_LARGE');
          fields[key] = value || '';
        }
        raw.push(fields);
      }
      records.push(...mapUedRows(raw, mapping, adapter.timezone, mapping.termFilter ? termChoices?.selected : undefined));
      if (mapping.termFilter) {
        await portal.page.locator('#cmbkieuin').selectOption('2');
        weekRanges = mapUedWeekRanges((await selectChoices(portal.page, '#cmbtuan', 'UED_WEEK_OPTIONS_FAILED')).filter(option => option.value));
      }
    }
    return { records, storageState: await portal.context.storageState({ indexedDB: true }), termChoices, weekRanges };
  } finally { await portal.close(); }
}

export async function shutdownUed(): Promise<void> {
  if (shutdownPending) return shutdownPending;
  lifecycleGeneration++;
  const pendingAdmissions = [...startingLoginAdmissions];
  startingLoginAdmissions.clear();
  pendingAdmissions.forEach(release => release());
  const work = (async () => {
    const openChallenges = [...challenges.values()];
    challenges.clear();
    await Promise.all(openChallenges.map(async challenge => {
      clearTimeout(challenge.timer);
      try { await challenge.portal.close(); }
      finally { challenge.releaseAdmission(); }
    }));
    const running = browserPromise;
    browserPromise = undefined;
    await running?.then(instance => instance.close()).catch(() => undefined);
  })();
  shutdownPending = work.finally(() => { shutdownPending = undefined; });
  return shutdownPending;
}
