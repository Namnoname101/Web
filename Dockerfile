FROM node:22-bookworm-slim

WORKDIR /app

# Keep Playwright's browser in a predictable image path shared by the API and
# its in-process worker.
ENV PLAYWRIGHT_BROWSERS_PATH=/ms-playwright

COPY package.json package-lock.json .npmrc ./
COPY apps/api/package.json apps/api/package.json
COPY apps/web/package.json apps/web/package.json
COPY packages/database/package.json packages/database/package.json
COPY packages/shared/package.json packages/shared/package.json
RUN npm ci

COPY tsconfig.base.json ./
COPY apps ./apps
COPY packages ./packages
COPY scripts ./scripts
# Prisma validates that a datasource URL exists while generating its client;
# generation does not connect to this build-only address. The platform-provided
# DATABASE_URL replaces it when the container starts.
RUN DATABASE_URL=postgresql://build:build@127.0.0.1:5432/build npm run build
RUN npx playwright install --with-deps chromium && npm cache clean --force
# The npm wrapper uses project-local scratch space, including during migrations.
RUN mkdir -p /app/.tmp /app/.npm-cache && chown -R node:node /app/.tmp /app/.npm-cache

ENV NODE_ENV=production \
    PORT=3000 \
    WORKER_ENABLED=true \
    TRUST_PROXY_HOPS=1

EXPOSE 3000

# The API launches a browser against an external portal. Keep both Express and
# Chromium outside the container's root account even if the host runtime adds
# another isolation layer.
USER node

# Migrations are idempotent. Express serves apps/web/dist after the build, so
# the deployed service has one public port and one origin.
CMD ["sh", "-c", "npm run db:deploy && exec node apps/api/dist/server.js"]
