// First-party device sign-in. Tokens stay in main and the OS-encrypted store.
const fs = require('node:fs');
const path = require('node:path');
function accountOrigin(value, allowLocal = false) {
  try {
    const u = new URL(value);
    if (u.username || u.password || u.pathname !== '/' || u.search || u.hash) return null;
    const local = ['127.0.0.1','localhost','[::1]'].includes(u.hostname);
    return u.protocol === 'https:' || (allowLocal && local && u.protocol === 'http:') ? u.origin : null;
  } catch { return null; }
}
/**
 * The account origin of this build. A build that should have accounts is packaged with
 * `-c.extraMetadata.accountOrigin=<https origin>` (written into its own package.json, like filowQa in
 * qa.js); a normal release has none, so it has no accounts. FILOW_ACCOUNT_ORIGIN overrides it only in a
 * development run, never in an installed app.
 */
function buildAccountOrigin({ packaged, pkgOrigin, envOrigin }) {
  return accountOrigin(!packaged && envOrigin ? envOrigin : pkgOrigin, !packaged);
}
function billingUrl(value) {
  try { const u = new URL(value); return u.protocol === 'https:' && !u.username && !u.password && ['checkout.stripe.com','billing.stripe.com'].includes(u.hostname) ? u.href : null; }
  catch { return null; }
}
/**
 * A fetch whose request shows the live "going outside" signal (okfilow-outbound.js, kind `account`)
 * from before it starts until its body has been read. `signal()` gives OK Filow's { begin, end }, or
 * nothing when OK Filow is not running: the request then goes out without a signal.
 */
function signalledFetch(fetchImpl, signal) {
  let n = 0;
  return async (url, opts) => {
    const out = signal();
    const id = `account:${++n}`;
    out?.begin(id, 'account', ['Filow account']);
    try {
      const response = await fetchImpl(url, opts);
      const body = await response.text();
      return new Response(body === '' ? null : body, { status: response.status, statusText: response.statusText, headers: response.headers });
    } finally { out?.end(id); }
  };
}
function createAccount({ origin, userData, safeStorage, openExternal, fetcher = fetch, now = Date.now, offline = () => false }) {
  const file = path.join(userData,'account-session.bin');
  let token = '', pending = null, generation = 0, polling = false;
  const encrypted = () => safeStorage.isEncryptionAvailable() && safeStorage.getSelectedStorageBackend?.() !== 'basic_text';
  if (origin && encrypted()) {
    try { const data = JSON.parse(safeStorage.decryptString(fs.readFileSync(file))); if(data.origin === origin) token = data.token; } catch { /* signed out */ }
  }
  async function request(route, body, authenticated = true) {
    if (!origin || offline()) throw new Error('Account connection unavailable');
    const response = await fetcher(origin + route,{method:body ? 'POST':'GET',redirect:'error',signal:AbortSignal.timeout(15_000),
      headers:{'Content-Type':'application/json',...(authenticated && token ? {Authorization:`Bearer ${token}`} : {})},
      ...(body ? {body:JSON.stringify(body)} : {})});
    const data = await response.json();
    if(!response.ok) { const error = new Error('Account request failed'); error.code = data.error || data.code; error.status = response.status; throw error; }
    return data;
  }
  function forget() { token = ''; try { fs.unlinkSync(file); } catch { /* no saved session */ } }
  async function status() {
    if(!origin) return {configured:false,user:null,plan:'local',billing:false};
    // service: who receives the sign-in (the notice on /account names it)
    const service = new URL(origin).host;
    if(!token) return {configured:true,service,user:null,plan:'local',billing:false};
    try { return {configured:true,service,...await request('/v1/me')}; }
    catch(error) { if(error.status === 401) { forget(); return {configured:true,service,user:null,plan:'local',billing:false}; } throw error; }
  }
  async function begin() {
    const id = ++generation; pending = null;
    if(!encrypted()) throw new Error('Secure account storage is unavailable');
    const result = await request('/api/auth/device/code',{client_id:'filow-desktop'},false);
    if(id !== generation) return null;
    if(!result.device_code || !result.user_code || !Number.isFinite(result.expires_in)) throw new Error('Invalid device response');
    const interval = Math.max(5,Number(result.interval) || 5) * 1000;
    const expires=now()+Math.min(result.expires_in,1800)*1000;
    pending = {code:result.device_code, expires, interval, next:now()+interval};
    try { await openExternal(origin + '/device'); } catch(error) { pending=null; throw error; }
    return {userCode:result.user_code,expiresAt:expires};
  }
  async function poll() {
    const p = pending, id = generation;
    if(!p) return {state:'cancelled'};
    if(now() >= p.expires) { pending=null; return {state:'expired'}; }
    if(polling || now() < p.next) return {state:'pending'};
    polling=true; p.next=now()+p.interval;
    try {
      const data=await request('/api/auth/device/token',{grant_type:'urn:ietf:params:oauth:grant-type:device_code',client_id:'filow-desktop',device_code:p.code},false);
      if(id !== generation || pending !== p) return {state:'cancelled'};
      if(typeof data.access_token !== 'string' || !data.access_token) throw new Error('Invalid session');
      fs.writeFileSync(file,safeStorage.encryptString(JSON.stringify({origin,token:data.access_token})),{mode:0o600});
      token=data.access_token; pending=null;
      return {state:'signed-in'};
    } catch(error) {
      if(id !== generation) return {state:'cancelled'};
      if(error.code === 'authorization_pending') return {state:'pending'};
      if(error.code === 'slow_down') { p.interval+=5000; p.next=now()+p.interval; return {state:'pending'}; }
      if(['expired_token','access_denied'].includes(error.code)) { pending=null; return {state:error.code === 'access_denied' ? 'denied':'expired'}; }
      throw error;
    } finally { polling=false; }
  }
  function cancel() { generation++; pending=null; }
  async function signOut() {
    cancel();
    try { if(token) await request('/api/auth/sign-out',{}); }
    finally { forget(); }
    return status();
  }
  async function billing(action) {
    let result;
    try { result=await request(action === 'portal' ? '/v1/portal':'/v1/checkout',{}); }
    catch (error) {
      // IPC does not preserve custom Error fields. Return the closed state as data.
      if (action !== 'portal' && error.status === 503 && error.code === 'billing_not_open') return { state: 'billing_not_open' };
      throw error;
    }
    const url=billingUrl(result.url); if(!url) throw new Error('Unexpected billing destination');
    await openExternal(url);
  }
  return {status,begin,poll,cancel,signOut,billing};
}
module.exports={createAccount,accountOrigin,billingUrl,signalledFetch,buildAccountOrigin};
