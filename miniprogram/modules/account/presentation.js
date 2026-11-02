const { DEFAULT_PREFERENCES } = require('../../shared/constants');

// The UI is a transient preview. Never treat a switch change as a server-side save.
function preferencesFromSwitches(current, key, enabled) {
  if (!Object.prototype.hasOwnProperty.call(DEFAULT_PREFERENCES, key)) {
    return current;
  }
  return { ...current, [key]: Boolean(enabled) };
}

module.exports = { preferencesFromSwitches };
