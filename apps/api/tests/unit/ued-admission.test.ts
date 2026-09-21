import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const fixture = vi.hoisted(() => {
  const state = {
    contexts: [] as Array<{ close: ReturnType<typeof vi.fn> }>,
    failNextContext: false,
    failNextNavigation: false,
    deferNextContext: false,
    releaseContext: undefined as (() => void) | undefined,
    hangNextClose: false,
  };
  const launch = vi.fn(async () => ({
    on: vi.fn(),
    close: vi.fn(async () => undefined),
    newContext: vi.fn(async () => {
      if (state.failNextContext) {
        state.failNextContext = false;
        throw new Error('mock context failure');
      }
      if (state.deferNextContext) {
        state.deferNextContext = false;
        await new Promise<void>(resolve => { state.releaseContext = resolve; });
      }
      const context = {
        close: vi.fn(async () => {
          if (state.hangNextClose) {
            state.hangNextClose = false;
            await new Promise<void>(() => undefined);
          }
        }),
        setDefaultTimeout: vi.fn(),
        setDefaultNavigationTimeout: vi.fn(),
        route: vi.fn(async () => undefined),
        routeWebSocket: vi.fn(async () => undefined),
        on: vi.fn(),
        storageState: vi.fn(async () => ({ cookies: [], origins: [] })),
        newPage: vi.fn(async () => ({
          on: vi.fn(),
          goto: vi.fn(async () => {
            if (state.failNextNavigation) {
              state.failNextNavigation = false;
              throw new Error('mock navigation failure');
            }
            return undefined;
          }),
          locator: vi.fn(() => ({
            waitFor: vi.fn(async () => undefined),
            evaluate: vi.fn(async () => null),
            fill: vi.fn(async () => undefined),
            click: vi.fn(async () => undefined),
          })),
        })),
      };
      state.contexts.push(context);
      return context;
    }),
  }));
  return { state, launch };
});

vi.mock('playwright', () => ({ chromium: { launch: fixture.launch } }));

import { getUedAdapter } from '../../src/modules/integrations/ued/adapter.js';
import { closeChallenge, shutdownUed, startUedLogin, submitUedLogin,
  UED_CHALLENGE_TTL_MS, UED_CONTEXT_CLOSE_TIMEOUT_MS } from '../../src/modules/integrations/ued/browser.js';

describe('global UED login admission', () => {
  beforeEach(async () => {
    await shutdownUed();
    fixture.state.contexts.length = 0;
    fixture.state.failNextContext = false;
    fixture.state.failNextNavigation = false;
    fixture.state.deferNextContext = false;
    fixture.state.releaseContext = undefined;
    fixture.state.hangNextClose = false;
    fixture.launch.mockClear();
  });

  afterEach(async () => { await shutdownUed(); vi.useRealTimers(); vi.restoreAllMocks(); });

  it('reserves half of browser capacity for background sync and re-admits after explicit close', async () => {
    const adapter = getUedAdapter();
    const active = await Promise.all([
      startUedLogin(adapter), startUedLogin(adapter), startUedLogin(adapter),
    ]);
    await expect(startUedLogin(adapter)).rejects.toMatchObject({ status: 429, code: 'UED_CHALLENGE_CAPACITY' });
    expect(fixture.state.contexts).toHaveLength(3);

    await closeChallenge(active[0].browserToken);
    await expect(startUedLogin(adapter)).resolves.toMatchObject({ mappingReady: true });
    expect(fixture.state.contexts).toHaveLength(4);
  });

  it('releases admission when context creation or initial navigation fails', async () => {
    const adapter = getUedAdapter();
    fixture.state.failNextContext = true;
    await expect(startUedLogin(adapter)).rejects.toThrow('mock context failure');
    fixture.state.failNextNavigation = true;
    await expect(startUedLogin(adapter)).rejects.toMatchObject({ code: 'UED_LOGIN_PAGE_UNAVAILABLE' });

    await Promise.all([startUedLogin(adapter), startUedLogin(adapter), startUedLogin(adapter)]);
    await expect(startUedLogin(adapter)).rejects.toMatchObject({ code: 'UED_CHALLENGE_CAPACITY' });
  });

  it('releases every outstanding admission during shutdown', async () => {
    const adapter = getUedAdapter();
    await Promise.all([startUedLogin(adapter), startUedLogin(adapter), startUedLogin(adapter)]);
    await shutdownUed();
    expect(fixture.state.contexts.slice(0, 3).every(context => context.close.mock.calls.length === 1)).toBe(true);

    await Promise.all([startUedLogin(adapter), startUedLogin(adapter), startUedLogin(adapter)]);
    await expect(startUedLogin(adapter)).rejects.toMatchObject({ code: 'UED_CHALLENGE_CAPACITY' });
  });

  it('releases a challenge after a terminal submit error', async () => {
    const adapter = getUedAdapter();
    const challenge = await startUedLogin(adapter);
    await expect(submitUedLogin(challenge.browserToken, {
      challengeId: challenge.challengeId, studentId: 'TEST123', password: 'private-password',
    })).rejects.toMatchObject({ code: 'UED_LOGIN_FORM_CHANGED' });

    await Promise.all([startUedLogin(adapter), startUedLogin(adapter), startUedLogin(adapter)]);
    await expect(startUedLogin(adapter)).rejects.toMatchObject({ code: 'UED_CHALLENGE_CAPACITY' });
  });

  it('releases an abandoned challenge at its TTL', async () => {
    vi.useFakeTimers();
    const adapter = getUedAdapter();
    await Promise.all([startUedLogin(adapter), startUedLogin(adapter), startUedLogin(adapter)]);
    await expect(startUedLogin(adapter)).rejects.toMatchObject({ code: 'UED_CHALLENGE_CAPACITY' });

    await vi.advanceTimersByTimeAsync(UED_CHALLENGE_TTL_MS);
    await vi.advanceTimersByTimeAsync(0);
    await expect(startUedLogin(adapter)).resolves.toMatchObject({ mappingReady: true });
  });

  it('immediately releases a challenge observed as expired before its timer runs', async () => {
    vi.useFakeTimers();
    const adapter = getUedAdapter();
    const challenge = await startUedLogin(adapter);
    vi.setSystemTime(new Date(Date.now() + UED_CHALLENGE_TTL_MS + 1));
    await expect(submitUedLogin(challenge.browserToken, {
      challengeId: challenge.challengeId, studentId: 'TEST123', password: 'private-password',
    })).rejects.toMatchObject({ status: 410, code: 'UED_CHALLENGE_EXPIRED' });

    await Promise.all([startUedLogin(adapter), startUedLogin(adapter), startUedLogin(adapter)]);
    await expect(startUedLogin(adapter)).rejects.toMatchObject({ code: 'UED_CHALLENGE_CAPACITY' });
  });

  it('bounds a stuck context close before returning its admission slot', async () => {
    vi.useFakeTimers();
    const warning = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    const adapter = getUedAdapter();
    const challenge = await startUedLogin(adapter);
    fixture.state.hangNextClose = true;
    const closing = closeChallenge(challenge.browserToken);
    await vi.advanceTimersByTimeAsync(UED_CONTEXT_CLOSE_TIMEOUT_MS);
    await closing;
    expect(warning).toHaveBeenCalledWith('UED browser context close deadline reached.');
    warning.mockRestore();

    await Promise.all([startUedLogin(adapter), startUedLogin(adapter), startUedLogin(adapter)]);
    await expect(startUedLogin(adapter)).rejects.toMatchObject({ code: 'UED_CHALLENGE_CAPACITY' });
  });

  it('cancels and releases a login start racing with shutdown', async () => {
    const adapter = getUedAdapter();
    fixture.state.deferNextContext = true;
    const starting = startUedLogin(adapter);
    const rejected = expect(starting).rejects.toMatchObject({ code: 'UED_BROWSER_SHUTTING_DOWN' });
    await vi.waitFor(() => expect(fixture.state.releaseContext).toBeTypeOf('function'));
    const stopping = shutdownUed();
    fixture.state.releaseContext?.();
    await rejected;
    await stopping;

    await Promise.all([startUedLogin(adapter), startUedLogin(adapter), startUedLogin(adapter)]);
    await expect(startUedLogin(adapter)).rejects.toMatchObject({ code: 'UED_CHALLENGE_CAPACITY' });
  });
});
