const { createRouter } = require('./router');
// Server-owned release marker only. It cannot enable private services or attest
// to a completed filing; activation requires a separately reviewed integration.
const deploymentInfo = Object.freeze({
  buildId: 'prelaunch-20261025-1',
  phase: 'pre-filing',
  publicReleaseEnabled: false,
  privateBusinessEnabled: false,
});
let cloud;
exports.main = async (event) => {
  if (!cloud) {
    cloud = require('wx-server-sdk');
    cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV });
  }
  let request = event;
  if (event !== null && typeof event === 'object' && !Array.isArray(event)) {
    request = { ...event };
    // Transport metadata never supplies identity, controls or business input.
    delete request.userInfo;
    delete request.tcbContext;
  }
  // Never get identity from event/payload. Do not log this context.
  return createRouter({ deploymentInfo })(request, cloud.getWXContext());
};
