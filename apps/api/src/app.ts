import cors from 'cors';
import express from 'express';
import helmet from 'helmet';
import { rateLimit } from 'express-rate-limit';
import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { config } from './config.js';
import { router } from './routes.js';
import { attachSession, protectMutations } from './modules/auth/session.js';
import { errorHandler } from './lib/errors.js';
import { getPrismaClient } from '@personal-schedule/database';
import { outlookRouter } from './modules/integrations/outlook/outlook.router.js';
import { uedRouter } from './modules/integrations/ued/ued.routes.js';

export const app = express();

app.disable('x-powered-by');
app.set('trust proxy', Number(process.env.TRUST_PROXY_HOPS || 0));
app.use(helmet());
app.use(
  cors({
    origin: config.webOrigin,
    credentials: true,
  }),
);
app.use(express.json({ limit: '1mb' }));

app.get('/api/v1/health', (_request, response) => {
  response.status(200).json({ status: 'ok' });
});
app.get('/api/v1/ready', async (_req, res) => {
  await getPrismaClient().$queryRaw`SELECT 1`;
  res.json({ status: 'ready' });
});
app.use('/api/v1', rateLimit({ windowMs: 60_000, limit: 240, standardHeaders: 'draft-8', legacyHeaders: false }));
app.use('/api/v1', protectMutations, attachSession);
app.use('/api/v1', outlookRouter, uedRouter);
app.use('/api/v1', router);
app.use('/api', (_req, res) => res.status(404).json({ error: { code: 'NOT_FOUND' } }));
const webDist = fileURLToPath(new URL('../../web/dist/', import.meta.url));
if (existsSync(webDist)) {
  app.use(express.static(webDist));
  app.get('/{*path}', (_req, res) => res.sendFile(`${webDist}/index.html`));
}
app.use(errorHandler);
