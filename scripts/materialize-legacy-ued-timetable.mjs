import 'dotenv/config';
import { getPrismaClient } from '../packages/database/dist/index.js';
import { materializeLegacyUedTimetable } from '../apps/api/dist/modules/integrations/ued/ued.service.js';

const unknownArguments = process.argv.slice(2).filter(argument => argument !== '--apply');
if (unknownArguments.length) {
  console.error('Usage: npm run ued:materialize-legacy [-- --apply]');
  process.exit(2);
}

const apply = process.argv.includes('--apply');
const database = getPrismaClient();

try {
  const pending = await database.suggestion.findMany({
    where: {
      kind: 'EVENT_CHANGE',
      status: 'PENDING',
      AND: [
        { payload: { path: ['action'], equals: 'CREATE' } },
        { payload: { path: ['evidence', 'source'], equals: 'UED' } },
      ],
    },
    select: { userId: true },
  });
  const userIds = [...new Set(pending.map(item => item.userId))];

  if (!apply) {
    console.log(JSON.stringify({ mode: 'dry-run', accounts: userIds.length, candidates: pending.length }));
    console.log('No data changed. Re-run with -- --apply to materialize these verified legacy UED proposals.');
  } else {
    const results = [];
    for (const userId of userIds) results.push(await materializeLegacyUedTimetable(userId));
    console.log(JSON.stringify({ mode: 'apply', accounts: userIds.length,
      candidates: results.reduce((total, result) => total + result.candidates, 0),
      imported: results.reduce((total, result) => total + result.imported, 0),
      retired: results.reduce((total, result) => total + result.retired, 0) }));
  }
} finally {
  await database.$disconnect();
}
