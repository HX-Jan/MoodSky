// Post-test/default state: configuration alone cannot unlock this entry.
const { createPilotEntry } = require('./index');
const { readInvocationIdentity } = require('./invocation');
let cloud;
exports.main = async (event, platformContext) => {
  if (!cloud) {
    cloud = require('wx-server-sdk');
    cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV });
  }
  const identity = readInvocationIdentity(platformContext);
  return createPilotEntry({
    readContext: () => identity,
    readConfig: () => null,
    openDatabase() {
      throw new Error('Closed pilot has no database access.');
    },
  })(event);
};
