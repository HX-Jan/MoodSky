const { createRouter } = require('./router');
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
  return createRouter()(request, cloud.getWXContext());
};
