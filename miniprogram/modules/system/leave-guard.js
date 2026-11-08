// Share the existing record editor's native return warning and cleanup rules.
// Page-local sequence markers prevent delayed callbacks from reviving a guard.
function syncLeaveGuard(page, platform, message) {
  if (message === page._leaveGuardMessage && !page._leaveGuardNeedsSync) {
    return;
  }
  const hadWarning = !!page._leaveGuardMessage;
  page._leaveGuardMessage = message;
  page._leaveGuardNeedsSync = false;
  if (!message && !hadWarning && !page._leaveGuardCleanupNeeded) {
    return;
  }
  const sequence = (page._leaveGuardSequence || 0) + 1;
  page._leaveGuardSequence = sequence;
  const method = message ? 'enableAlertBeforeUnload' : 'disableAlertBeforeUnload';
  page._leaveGuardReady = false;
  if (typeof platform[method] !== 'function') {
    return; // Editors retain an inline warning on unsupported clients.
  }
  if (message) {
    page._leaveGuardCleanupNeeded = true;
  }
  try {
    platform[method]({
      ...(message ? { message } : {}),
      success: () => {
        if (page._leaveGuardSequence === sequence) {
          page._leaveGuardReady = !!message;
          page._leaveGuardCleanupNeeded = !!message;
        }
      },
      fail: () => {
        if (page._leaveGuardSequence === sequence) {
          page._leaveGuardReady = false;
        }
      },
    });
  } catch (_error) {
    page._leaveGuardReady = false;
  }
}
module.exports = { syncLeaveGuard };
