// Offline type check against the exact installed Web SDK. No initialization/network.
import cloudbase from '../../admin/node_modules/@cloudbase/js-sdk';
const app = cloudbase.init({
  env: 'synthetic-not-used',
  region: 'ap-shanghai',
  auth: { detectSessionInUrl: false },
});
const auth = app.auth;
async function contract() {
  const session = await auth.getSession();
  const user = session.data?.user;
  const login = await auth.signInWithOAuth({
    provider: 'wechat',
    options: { redirectTo: 'https://example.test/admin/catalogue.html' },
  });
  const callback = await auth.verifyOAuth();
  const logout = await auth.signOut();
  const subscription = auth.onAuthStateChange(() => {});
  return { user, login, callback, logout, subscription };
}
void contract;
