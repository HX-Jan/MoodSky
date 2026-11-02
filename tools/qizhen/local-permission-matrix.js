// Qizhen Cai: real router and candidate adapters, synthetic DB reads only.
const { createRouter, ACTIONS } = require('../../cloudfunctions/moodsky/router');
const { createAdapters } = require('../../cloudfunctions/moodsky/adapters');

function fixture() {
  const accounts = ['A', 'B', 'D', 'O', 'OD'].map((id) => ({
    _id: id,
    openid: `synthetic_${id}`,
    status: id === 'D' ? 'disabled' : 'active',
  }));
  const grants = [
    { accountId: 'O', role: 'data_operator', enabled: true },
    { accountId: 'OD', role: 'data_operator', enabled: false },
  ];
  const reads = [];
  const cloud = {
    database: () => ({
      collection: (name) => ({
        where: (filter) => ({
          limit: (limit) => ({
            async get() {
              reads.push({ name, filter, limit });
              const rows = name === 'accounts' ? accounts : name === 'operator_roles' ? grants : [];
              return {
                data: rows
                  .filter((row) => Object.entries(filter).every(([k, v]) => row[k] === v))
                  .slice(0, limit),
              };
            },
          }),
        }),
      }),
    }),
  };
  return { route: createRouter(createAdapters(cloud)), reads, accounts, grants };
}

const request = (action, payload = {}) => ({
  apiVersion: '1',
  requestId: 'req_qt_local_001',
  action,
  payload,
});
const payloadFor = (action) =>
  action === 'journal.upsert' ? { date: '2026-10-17', weather: 'SUNNY', expectedVersion: 0 } : {};

async function runMatrix() {
  const f = fixture();
  const rows = [];
  for (const [action, definition] of Object.entries(ACTIONS)) {
    if (!['private', 'operator'].includes(definition.access)) {
      continue;
    }
    for (const role of ['G', 'A', 'B', 'D', 'O', 'OD']) {
      const context = role === 'G' ? {} : { OPENID: `synthetic_${role}` };
      const expected =
        role === 'G'
          ? 'UNAUTHENTICATED'
          : role === 'D'
            ? 'ACCOUNT_DISABLED'
            : definition.access === 'operator' && role !== 'O'
              ? 'FORBIDDEN'
              : 'NOT_IMPLEMENTED';
      const result = await f.route(request(action, payloadFor(action)), context);
      rows.push({
        action,
        access: definition.access,
        role,
        expected,
        actual: result.error?.code,
        matched: result.ok === false && result.error?.code === expected,
        scope: expected === 'NOT_IMPLEMENTED' ? '业务阻塞；仅观察门禁后到达桩' : '本地门禁拒绝检查',
      });
    }
  }
  return rows;
}

if (require.main === module) {
  runMatrix()
    .then((rows) => {
      process.stdout.write(JSON.stringify({ environment: 'local-double', rows }, null, 2) + '\n');
      if (rows.some((row) => !row.matched)) {
        process.exitCode = 1;
      }
    })
    .catch((error) => {
      console.error(error);
      process.exitCode = 1;
    });
}
module.exports = { fixture, request, payloadFor, runMatrix };
