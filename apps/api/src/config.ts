import { config as loadEnv } from 'dotenv';
import { fileURLToPath } from 'node:url';
loadEnv({ path: fileURLToPath(new URL('../../../.env', import.meta.url)), quiet: true });

export const config = {
  production: process.env.NODE_ENV === 'production',
  port: Number(process.env.PORT || 3000),
  webOrigin: process.env.WEB_ORIGIN || 'http://localhost:5173',
  demoEnabled: process.env.DEMO_ENABLED === 'true' && process.env.NODE_ENV !== 'production',
  encryptionKey: process.env.ENCRYPTION_KEY || '',
  microsoft: {
    clientId: process.env.MICROSOFT_CLIENT_ID || '',
    clientSecret: process.env.MICROSOFT_CLIENT_SECRET || '',
    tenant: process.env.MICROSOFT_TENANT_ID || 'organizations',
    redirectUri: process.env.MICROSOFT_REDIRECT_URI || 'http://localhost:3000/api/v1/auth/microsoft/callback',
  },
};

function parsedUrl(value: string, name: string): URL {
  try { return new URL(value); } catch { throw new Error(`${name} must be a valid absolute URL.`); }
}

export function validateEnvironment(environment: NodeJS.ProcessEnv): void {
  const databaseUrl = environment.DATABASE_URL || '';
  const database = parsedUrl(databaseUrl, 'DATABASE_URL');
  if (!['postgres:', 'postgresql:'].includes(database.protocol)) throw new Error('DATABASE_URL must use PostgreSQL.');

  const encryptionKey = environment.ENCRYPTION_KEY || '';
  const decodedKey = Buffer.from(encryptionKey, 'base64');
  if (decodedKey.length !== 32 || decodedKey.toString('base64') !== encryptionKey) {
    throw new Error('ENCRYPTION_KEY must be exactly 32 random bytes encoded as canonical base64.');
  }

  const port = Number(environment.PORT || 3000);
  if (!Number.isInteger(port) || port < 1 || port > 65_535) throw new Error('PORT must be an integer from 1 to 65535.');
  const proxyHops = Number(environment.TRUST_PROXY_HOPS || 0);
  if (!Number.isInteger(proxyHops) || proxyHops < 0 || proxyHops > 10) throw new Error('TRUST_PROXY_HOPS must be an integer from 0 to 10.');

  const production = environment.NODE_ENV === 'production';
  const webOriginValue = environment.WEB_ORIGIN || 'http://localhost:5173';
  const webOrigin = parsedUrl(webOriginValue, 'WEB_ORIGIN');
  if (webOrigin.username || webOrigin.password || webOrigin.pathname !== '/' || webOrigin.search || webOrigin.hash
    || webOriginValue.endsWith('/')) throw new Error('WEB_ORIGIN must contain only the application origin, without credentials, path, query, hash, or trailing slash.');
  if (production && webOrigin.protocol !== 'https:') throw new Error('Production WEB_ORIGIN must use HTTPS.');

  const clientId = environment.MICROSOFT_CLIENT_ID?.trim() || '';
  const clientSecret = environment.MICROSOFT_CLIENT_SECRET || '';
  if (Boolean(clientId) !== Boolean(clientSecret)) throw new Error('Microsoft client ID and client secret must be configured together.');
  if (clientId) {
    const tenant = environment.MICROSOFT_TENANT_ID || 'organizations';
    if (!/^[a-zA-Z0-9.-]+$/.test(tenant) || ['common', 'consumers'].includes(tenant.toLowerCase())) {
      throw new Error('MICROSOFT_TENANT_ID must target an organization tenant.');
    }
    const redirectValue = environment.MICROSOFT_REDIRECT_URI || 'http://localhost:3000/api/v1/auth/microsoft/callback';
    const redirect = parsedUrl(redirectValue, 'MICROSOFT_REDIRECT_URI');
    if (redirect.username || redirect.password || redirect.search || redirect.hash
      || redirect.pathname !== '/api/v1/auth/microsoft/callback') {
      throw new Error('MICROSOFT_REDIRECT_URI must point exactly to /api/v1/auth/microsoft/callback.');
    }
    if (production && (redirect.protocol !== 'https:' || redirect.origin !== webOrigin.origin)) {
      throw new Error('Production Microsoft redirect URI must use the WEB_ORIGIN HTTPS origin.');
    }
    const domains = (environment.MICROSOFT_ALLOWED_EMAIL_DOMAINS || 'ued.udn.vn').split(',').map(value => value.trim().toLowerCase()).filter(Boolean);
    if (!domains.length || domains.some(value => value.length > 253 || !/^(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,63}$/.test(value))) {
      throw new Error('MICROSOFT_ALLOWED_EMAIL_DOMAINS must be a comma-separated list of DNS domains.');
    }
  }
}

export function assertConfig(): void {
  validateEnvironment(process.env);
}
