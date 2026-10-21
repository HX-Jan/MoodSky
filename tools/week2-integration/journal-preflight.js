// Offline input inspection only. No SDK, database connection, migration or service enabling.
const { createCloudJournalRepository, dayId } = require('../journal-storage/cloudbase-candidate');
const { isBusinessDate } = require('../../cloudfunctions/moodsky/shared/date');
const idValid = (value) => typeof value === 'string' && /^[A-Za-z0-9_-]{1,128}$/.test(value);
const object = (value) => value && typeof value === 'object' && !Array.isArray(value);

async function inspectJournalSnapshot(input, { maxRows = 1000 } = {}) {
  const findings = [];
  const summary = { rows: 0, checkedRows: 0, active: 0, deleted: 0 };
  const report = () => ({
    status: findings.length ? 'blocked' : 'eligible_for_review',
    scope: 'offline_snapshot_only',
    mayOpenPrivateServices: false,
    migrationExecuted: false,
    completenessIndependentlyVerified: false,
    summary,
    findings,
  });
  const issue = (code, rowIndex) => {
    findings.push({ code, ...(rowIndex === undefined ? {} : { rowIndex }) });
  };
  if (
    !object(input) ||
    !Array.isArray(input.journals) ||
    !Number.isSafeInteger(maxRows) ||
    maxRows < 1 ||
    maxRows > 10000
  ) {
    issue('INPUT_INVALID');
    return report();
  }
  summary.rows = input.journals.length;
  if (summary.rows > maxRows) {
    issue('ROW_LIMIT_EXCEEDED');
    return report();
  }
  if (input.complete !== true) {
    issue('COMPLETE_SNAPSHOT_REQUIRED');
    return report();
  }
  let snapshot;
  try {
    snapshot = globalThis.structuredClone(input);
  } catch (_error) {
    issue('INPUT_INVALID');
    return report();
  }
  const { accountId, account, journals } = snapshot;
  if (!idValid(accountId) || !object(account)) {
    issue('ACCOUNT_MATERIAL_INVALID');
    return report();
  }
  // Expose only get. The actual candidate reader enforces its account/row contract;
  // an unexpected future write fails here rather than touching caller storage.
  let currentRow;
  const repository = createCloudJournalRepository({
    config: { throwOnNotFound: false },
    runTransaction: async (work) =>
      work({
        collection(name) {
          return {
            doc(id) {
              return {
                async get() {
                  if (name === 'accounts' && id === accountId) {
                    return { data: account };
                  }
                  if (name === 'journals' && currentRow && id === currentRow._id) {
                    return { data: currentRow };
                  }
                  throw new Error('Unexpected offline reader lookup');
                },
              };
            },
          };
        },
      }),
  });
  try {
    // The callback performs no writes; this also checks an empty account snapshot.
    await repository.transact(accountId, async () => undefined);
  } catch (error) {
    issue(
      error.code === 'NOT_IMPLEMENTED'
        ? 'LAYOUT_NOT_ENABLED'
        : error.code === 'ACCOUNT_DISABLED'
          ? 'ACCOUNT_NOT_ACTIVE'
          : 'ACCOUNT_MATERIAL_INVALID',
    );
    return report();
  }
  if (
    ['journalRevision', 'operationFence', 'exportEpoch'].some(
      (key) => account[key] === Number.MAX_SAFE_INTEGER,
    )
  ) {
    issue('ACCOUNT_COUNTER_EXHAUSTED');
  }
  const dates = new Set(),
    entries = new Set();
  for (const [rowIndex, row] of journals.entries()) {
    if (!object(row) || row.ownerId !== accountId || !isBusinessDate(row.date)) {
      issue('ROW_SCOPE_INVALID', rowIndex);
      continue;
    }
    if (row._id !== dayId(accountId, row.date)) {
      issue('ROW_KEY_MISMATCH', rowIndex);
      continue;
    }
    if (dates.has(row.date)) {
      issue('DUPLICATE_DAY', rowIndex);
      continue;
    }
    dates.add(row.date);
    currentRow = row;
    try {
      const day = await repository.readDay(accountId, row.date);
      summary.checkedRows++;
      if (day.version === Number.MAX_SAFE_INTEGER) {
        issue('DAY_VERSION_EXHAUSTED', rowIndex);
      }
      if (day.entry) {
        if (entries.has(day.entry.id)) {
          issue('DUPLICATE_ENTRY_ID', rowIndex);
        }
        entries.add(day.entry.id);
        summary.active++;
      } else {
        summary.deleted++;
      }
    } catch (_error) {
      issue('STORED_ROW_INVALID', rowIndex);
    }
  }
  return report();
}

async function main(args) {
  const fail = (code) => ({
    status: 'blocked',
    findings: [{ code }],
    mayOpenPrivateServices: false,
  });
  if (
    (args.length !== 2 && args.length !== 4) ||
    args[0] !== '--input' ||
    (args.length === 4 && args[2] !== '--max-rows')
  ) {
    return fail('INPUT_ARGUMENTS_INVALID');
  }
  const fs = require('node:fs');
  let content;
  try {
    const metadata = fs.statSync(args[1]);
    if (!metadata.isFile() || metadata.size > 8 * 1024 * 1024) {
      return fail('INPUT_FILE_LIMIT');
    }
    content = fs.readFileSync(args[1]);
    if (content.length > 8 * 1024 * 1024) {
      return fail('INPUT_FILE_LIMIT');
    }
  } catch (_error) {
    return fail('INPUT_FILE_UNREADABLE');
  }
  let input;
  try {
    input = JSON.parse(content.toString('utf8').replace(/^\uFEFF/, ''));
  } catch (_error) {
    return fail('INPUT_JSON_INVALID');
  }
  return inspectJournalSnapshot(input, { maxRows: args.length === 4 ? Number(args[3]) : 1000 });
}
if (require.main === module) {
  main(process.argv.slice(2))
    .then((report) => {
      process.stdout.write(JSON.stringify(report, null, 2) + '\n');
      process.exitCode = report.status === 'blocked' ? 2 : 0;
    })
    .catch(() => {
      process.stdout.write(
        JSON.stringify({
          status: 'blocked',
          findings: [{ code: 'PREFLIGHT_FAILED' }],
          mayOpenPrivateServices: false,
        }) + '\n',
      );
      process.exitCode = 1;
    });
}
module.exports = { inspectJournalSnapshot };
