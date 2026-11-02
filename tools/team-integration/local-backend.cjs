// Development only: real handlers, synthetic identities and in-memory stores.
// Never imported by a cloud entry or exposed as a network service.
const { createCandidateRouter } = require('../../cloudfunctions/moodsky/candidate-router');
const { createMemoryJournalRepository } = require('../../tests/helpers/memory-journal-repository');
const { createSyntheticReceiptPolicy } = require('../../tests/helpers/receipt-fixture');
const { createMemoryRepositories } = require('../../tests/support/campus-repository');
const SIMULATED_NOW = '2026-10-29T04:00:00.000Z';
function createLocalTeamBackend() {
  const campus = createMemoryRepositories({
    places: [
      {
        placeId: 'synthetic_team_place',
        name: '合成联调地点',
        campus: '合成校区',
        tags: ['安静'],
        openState: 'OPEN',
        source: 'SYNTHETIC fixture, not a real verified place',
        verifiedAt: '2026-10-01T00:00:00.000Z',
        validUntil: '2026-12-01T00:00:00.000Z',
        enabled: true,
        isSynthetic: false,
        updatedAt: '2026-10-01T00:00:00.000Z',
      },
    ],
  });
  // isSynthetic:false above exercises the public projection branch in an isolated
  // fixture. It is never published or evidence of a real campus verification.
  const accounts = {
    a: { id: 'synthetic_team_a', status: 'active' },
    b: { id: 'synthetic_team_b', status: 'active' },
    operator: { id: 'synthetic_team_operator', status: 'active' },
    disabled: { id: 'synthetic_team_disabled', status: 'disabled' },
  };
  const router = createCandidateRouter({
    now: () => new Date(SIMULATED_NOW),
    journalRepository: createMemoryJournalRepository(),
    journalReceiptPolicy: createSyntheticReceiptPolicy(),
    repositories: campus,
    resolveAccount: async (id) => accounts[id] || null,
    resolveOperatorRoles: async (id) => (id === accounts.operator.id ? ['data_operator'] : []),
    taskCatalogueRepository: {
      listEnabled: async () => [
        {
          _id: 'synthetic_team_task',
          enabled: true,
          title: '合成联调任务',
          steps: ['仅供本地验证'],
          durationMin: 1,
          tags: [],
        },
      ],
    },
  });
  let serial = 0;
  return {
    call(action, payload = {}, { actor = 'guest', requestId = 'req_team_' + ++serial } = {}) {
      if (actor !== 'guest' && !Object.hasOwn(accounts, actor)) {
        throw new TypeError('Use guest, a, b, operator or disabled synthetic actor.');
      }
      return router(
        { apiVersion: '1', requestId, action, payload },
        actor === 'guest' ? {} : { OPENID: actor },
      );
    },
  };
}
module.exports = { createLocalTeamBackend, SIMULATED_NOW };
