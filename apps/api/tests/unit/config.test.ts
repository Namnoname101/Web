import { describe, expect, it } from 'vitest';
import { validateEnvironment } from '../../src/config.js';

const valid = (overrides: NodeJS.ProcessEnv = {}): NodeJS.ProcessEnv => ({
  DATABASE_URL: 'postgresql://student:test@127.0.0.1:5432/schedule',
  ENCRYPTION_KEY: Buffer.alloc(32, 7).toString('base64'),
  WEB_ORIGIN: 'http://localhost:5173',
  PORT: '3000',
  TRUST_PROXY_HOPS: '0',
  NODE_ENV: 'development',
  ...overrides,
});

describe('startup configuration', () => {
  it('accepts a valid local configuration', () => {
    expect(() => validateEnvironment(valid())).not.toThrow();
  });

  it('rejects malformed encryption keys and network settings', () => {
    expect(() => validateEnvironment(valid({ ENCRYPTION_KEY: 'not-a-key' }))).toThrow(/ENCRYPTION_KEY/);
    expect(() => validateEnvironment(valid({ PORT: 'NaN' }))).toThrow(/PORT/);
    expect(() => validateEnvironment(valid({ TRUST_PROXY_HOPS: '-1' }))).toThrow(/TRUST_PROXY_HOPS/);
    expect(() => validateEnvironment(valid({ WEB_ORIGIN: 'http://localhost:5173/path' }))).toThrow(/WEB_ORIGIN/);
  });

  it('requires a clean HTTPS origin in production', () => {
    expect(() => validateEnvironment(valid({ NODE_ENV: 'production' }))).toThrow(/HTTPS/);
    expect(() => validateEnvironment(valid({ NODE_ENV: 'production', WEB_ORIGIN: 'https://planner.example/' }))).toThrow(/WEB_ORIGIN/);
    expect(() => validateEnvironment(valid({ NODE_ENV: 'production', WEB_ORIGIN: 'https://planner.example' }))).not.toThrow();
  });

  it('fails closed for partial or consumer Microsoft OAuth configuration', () => {
    expect(() => validateEnvironment(valid({ MICROSOFT_CLIENT_ID: 'client-only' }))).toThrow(/configured together/);
    expect(() => validateEnvironment(valid({ MICROSOFT_CLIENT_ID: 'client', MICROSOFT_CLIENT_SECRET: 'secret', MICROSOFT_TENANT_ID: 'common' }))).toThrow(/organization tenant/);
  });

  it('accepts a same-origin production Microsoft callback and valid school domain', () => {
    expect(() => validateEnvironment(valid({
      NODE_ENV: 'production', WEB_ORIGIN: 'https://planner.example',
      MICROSOFT_CLIENT_ID: 'client', MICROSOFT_CLIENT_SECRET: 'secret', MICROSOFT_TENANT_ID: 'organizations',
      MICROSOFT_REDIRECT_URI: 'https://planner.example/api/v1/auth/microsoft/callback',
      MICROSOFT_ALLOWED_EMAIL_DOMAINS: 'ued.udn.vn,students.ued.udn.vn',
    }))).not.toThrow();
  });
});
