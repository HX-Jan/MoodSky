// W2 JH02 opt-in assembly for the campus/admin backend.
//
// This module is deliberately NOT imported by cloudfunctions/moodsky/index.js.
// The repository already has two guards that keep the packaged entry unwired
// (`tests/cloud-bundle-defaults.test.js`, `tests/foundation-transport.test.js`),
// and tools/week2-integration/backend.js follows the same rule. Enabling the
// trusted-identity adapters and the campus repositories in production is an
// interface decision for the PR review, not something a feature branch flips.
//
// Usage by the reviewer (one line inside index.js, then delete this comment):
//
//     const { createCampusBackend } = require('./wiring');
//     const router = createCampusBackend(cloud);
//
// Until that happens the campus and admin actions keep answering
// NOT_IMPLEMENTED, which is the honest answer for an environment where
// accounts, operator_roles and places have not been provisioned yet.
const { createRouter } = require('./router');
const { createAdapters } = require('./adapters');
const { createRepositories } = require('./repositories');

/**
 * Builds the wired router: trusted identity from accounts/operator_roles plus
 * the campus data access layer.
 *
 * @param {object} cloud initialised wx-server-sdk instance
 * @returns {(request: object, trustedContext?: object) => Promise<object>}
 */
function createCampusBackend(cloud) {
  if (!cloud || typeof cloud.database !== 'function') {
    throw new TypeError('createCampusBackend requires an initialised wx-server-sdk instance.');
  }
  return createRouter({ ...createAdapters(cloud), repositories: createRepositories(cloud) });
}

module.exports = { createCampusBackend };
