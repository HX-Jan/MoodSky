// This flag restores the sign-in flow. The server still verifies WeChat identity on every call.
const LOGIN_KEY = 'moodsky-wechat-login-v1';
const PHONE_KEY = 'moodsky-phone-session-v1';
function readPhoneSession(platform) {
  try {
    const value = platform?.getStorageSync(PHONE_KEY);
    return typeof value === 'string' ? value : undefined;
  } catch {
    return undefined;
  }
}
function savePhoneSession(platform, value) {
  try {
    if (value) {
      platform?.setStorageSync(PHONE_KEY, value);
    } else {
      platform?.removeStorageSync(PHONE_KEY);
    }
  } catch {
    /* A storage failure leaves only the in-memory session. */
  }
}
function hasRememberedLogin(platform) {
  try {
    return platform?.getStorageSync(LOGIN_KEY) === true;
  } catch {
    return false;
  }
}
function rememberLogin(platform) {
  try {
    platform.setStorageSync(LOGIN_KEY, true);
    return true;
  } catch {
    return false;
  }
}
function forgetLogin(platform) {
  savePhoneSession(platform);
  try {
    platform?.removeStorageSync(LOGIN_KEY);
  } catch {
    /* Current in-memory identity is cleared separately. */
  }
}
module.exports = {
  LOGIN_KEY,
  hasRememberedLogin,
  rememberLogin,
  forgetLogin,
  readPhoneSession,
  savePhoneSession,
};
