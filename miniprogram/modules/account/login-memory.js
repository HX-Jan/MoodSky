// This flag restores the sign-in flow. The server still verifies WeChat identity on every call.
const LOGIN_KEY = 'moodsky-wechat-login-v1';
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
  try {
    platform?.removeStorageSync(LOGIN_KEY);
  } catch {
    /* Current in-memory identity is cleared separately. */
  }
}
module.exports = { LOGIN_KEY, hasRememberedLogin, rememberLogin, forgetLogin };
