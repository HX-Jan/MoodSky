// This is the only action registry. Shared changes require an interface review.
function action(domain, access, requirements, mutates = false) {
  return Object.freeze({ domain, access, requirements: Object.freeze(requirements), mutates });
}
const ACTIONS = Object.freeze({
  'system.health': action('system', 'public', []),
  'journal.upsert': action('journal', 'private', ['UW3-F01', 'UW3-F02', 'UW3-F03'], true),
  'journal.get': action('journal', 'private', ['UW3-F01']),
  'journal.delete': action('journal', 'private', ['UW3-F04'], true),
  'review.calendar': action('review', 'private', ['UW3-F05']),
  'review.distribution': action('review', 'private', ['UW3-F06']),
  'review.timeline': action('review', 'private', ['UW3-F07']),
  'review.monthArchive': action('review', 'private', ['UW3-F08', 'UW3-F09']),
  'review.decorations': action('review', 'private', ['UW3-F10'], true),
  'campus.listPlaces': action('campus', 'public', ['UW3-F11', 'UW3-F12']),
  'campus.getPlace': action('campus', 'public', ['UW3-F13']),
  'campus.favorites': action('campus', 'private', ['UW3-F14'], true),
  'campus.correctPlace': action('campus', 'private', ['UW3-F15'], true),
  'campus.supportResources': action('campus', 'public', ['UW3-F16']),
  'campus.weatherPreview': action('campus', 'public', ['UW3-F24']),
  'tasks.suggestions': action('tasks', 'public', ['UW3-F17']),
  'tasks.mine': action('tasks', 'private', ['UW3-F17', 'UW3-F19']),
  'tasks.transition': action('tasks', 'private', ['UW3-F17', 'UW3-F18'], true),
  'tasks.history': action('tasks', 'private', ['UW3-F19']),
  'tasks.quickChoice': action('tasks', 'public', ['UW3-F20']),
  'account.preferences': action('account', 'private', ['UW3-F21'], true),
  'account.session': action('account', 'private', []),
  'account.requestExport': action('account', 'private', ['UW3-F22'], true),
  'account.exportStatus': action('account', 'private', ['UW3-F22']),
  'account.downloadExport': action('account', 'private', ['UW3-F22']),
  'account.close': action('account', 'private', ['UW3-F23'], true),
  'account.cleanupStatus': action('account', 'receipt', ['UW3-F23']),
  // Operator reads. Added in W2 JH03: client access to every collection is denied
  // (database/client-access-policy.json), so the backend console cannot list or
  // re-read a record it just saved without these. Registry change pending review
  // by Xiang Hong; additive only, no existing action changed.
  'admin.listPlaces': action('admin', 'operator', []),
  'admin.getPlace': action('admin', 'operator', []),
  'admin.listCorrections': action('admin', 'operator', []),
  'admin.listTaskTemplates': action('admin', 'operator', []),
  'admin.listSupportResources': action('admin', 'operator', []),
  'admin.updatePlace': action('admin', 'operator', [], true),
  'admin.reviewCorrection': action('admin', 'operator', [], true),
  'admin.updateTaskTemplate': action('admin', 'operator', [], true),
  'admin.updateSupportResource': action('admin', 'operator', [], true),
});
const ERROR_CODES = Object.freeze({
  INVALID_REQUEST: 'INVALID_REQUEST',
  INVALID_INPUT: 'INVALID_INPUT',
  API_VERSION_UNSUPPORTED: 'API_VERSION_UNSUPPORTED',
  ACTION_NOT_FOUND: 'ACTION_NOT_FOUND',
  UNAUTHENTICATED: 'UNAUTHENTICATED',
  ACCOUNT_DISABLED: 'ACCOUNT_DISABLED',
  FORBIDDEN: 'FORBIDDEN',
  // Added in W2 JH01: campus.getPlace must distinguish "no such place" from a
  // malformed request. Week-one review flagged this gap; adding a code is
  // backward compatible for existing consumers.
  NOT_FOUND: 'NOT_FOUND',
  CONFLICT: 'CONFLICT',
  NOT_IMPLEMENTED: 'NOT_IMPLEMENTED',
  CLOUD_NOT_CONFIGURED: 'CLOUD_NOT_CONFIGURED',
  NETWORK_ERROR: 'NETWORK_ERROR',
  INVALID_RESPONSE: 'INVALID_RESPONSE',
  INTERNAL_ERROR: 'INTERNAL_ERROR',
});
module.exports = { ACTIONS, ERROR_CODES };
