# Personal Automated Schedule for Students

A student-first scheduling application for UED: React/Tailwind on the web,
Express/TypeScript for the API and worker, and PostgreSQL through Prisma. It
imports the original UED timetable as fixed calendar events, while later source
changes and automatic task plans remain suggestions the student accepts or
rejects.

## Workspace layout

- `apps/web`: React and TailwindCSS frontend.
- `apps/api`: Express API, integrations, workers, and scheduling service.
- `packages/database`: Prisma schema, migrations, and shared database client.
- `packages/shared`: DTOs, validation schemas, constants, and shared types.
- `tests/e2e`: End-to-end tests.
- `docs`: requirements, integration evidence, progress, and deployment notes.

## Implemented

- Student session authentication and user-scoped CRUD APIs.
- A transactional auto-planner with active hours, breaks, minimum blocks,
  priorities, deadlines, split tasks, travel buffers, and conflict rechecks.
- A timezone-aware daily agenda with the complete day, current/next item and
  recent history, plus calendar, tasks, suggestions, notifications,
  integrations, and settings in Vietnamese/English with a responsive mobile view.
- UED read-only login/session reuse, current or selected term timetable import,
  exact 12-period conversion, fixed class Events, and reviewable later changes.
- Microsoft OAuth PKCE, paginated mailbox scanning, Vietnamese/English change
  parsing, encrypted refresh tokens, and background sync (requires a real app
  registration before external acceptance testing).
- PostgreSQL migrations, background leases/retries, unit tests, integration
  tests, readiness checks, and a production container path.

See [docs/PROGRESS.md](docs/PROGRESS.md) for the distinction between code that
is complete and integrations that still require external credentials/accounts.
The complete route contract is in [docs/API.md](docs/API.md).

## Setup

1. Copy `.env.example` to `.env` and replace its placeholder encryption key.
   Generate one with `node -e "console.log(require('crypto').randomBytes(32).toString('base64'))"`.
2. Start PostgreSQL with `docker compose up -d postgres` (or use
   `npm run db:local` with the project-local Windows PostgreSQL setup).
3. Run `npm run setup`, `npm run db:generate`, and `npm run db:migrate`.
4. Start `npm run dev:api`, `npm run dev:worker`, and `npm run dev:web` in
   separate terminals. Set `WORKER_ENABLED=true` instead if the API process
   should also run background synchronization.
5. Open `http://localhost:5173`.

Useful verification commands are `npm test`, `npm run test:integration`,
`npm run test:e2e`, `npm run typecheck`, and `npm run build`. Browser tests use
only the isolated `_test` database and never a real student's records.

All root npm scripts run through `scripts/run-with-project-env.mjs`, which sets
`TEMP`, `TMP`, `TMPDIR`, and npm's cache to `.tmp`/`.npm-cache` inside this
workspace. It does not modify Windows-wide or user-wide environment variables.

For a database upgraded from the earlier UED proposal policy, preview and then
materialize verified legacy timetable proposals with:

```bash
npm run ued:materialize-legacy
npm run ued:materialize-legacy -- --apply
```

Production setup and Railway/Fly guidance live in
[docs/DEPLOYMENT.md](docs/DEPLOYMENT.md).
