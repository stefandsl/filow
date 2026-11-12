import { t, langFromLocale } from '../../../packages/core/src/i18n/index.ts';
const lang = langFromLocale(navigator.language);
document.documentElement.lang = lang;
const tr = (key, vars) => t(key, lang, vars);
document.querySelectorAll('[data-i18n]').forEach(el => { el.textContent = tr(el.dataset.i18n); });
const $ = id => document.getElementById(id);
let email = '', userCode = '';
const status = text => { $('status').textContent = text; };
async function call(path,body) {
  const response = await fetch(`/api/auth${path}`,{method:body ? 'POST':'GET',credentials:'same-origin',
    headers:body ? {'Content-Type':'application/json'} : {},...(body ? {body:JSON.stringify(body)} : {})});
  const data = await response.json();
  if(!response.ok) throw new Error(data.message || data.error_description || 'Please try again.');
  return data;
}
function action(id,fn) {
  const el = $(id);
  if (!el) return;
  el.addEventListener(el.tagName === 'FORM' ? 'submit':'click',async e => {
    e.preventDefault(); const buttons = [...document.querySelectorAll('button')]; buttons.forEach(b=>b.disabled=true);
    status(''); try { await fn(); } catch(error) { status(error.message); }
    finally { buttons.forEach(b=>b.disabled=false); }
  });
}
async function refresh() {
  const session = await call('/get-session');
  const signed = Boolean(session?.user);
  $('email-form').hidden = signed; $('otp-form').hidden = true;
  $('device-form').hidden = !signed; $('signout').hidden = !signed;
  $('signed-in').textContent = signed ? tr('cloud.signedIn', { email: session.user.email }) : '';
}
action('email-form',async()=>{ email=$('email').value.trim(); await call('/email-otp/send-verification-otp',{email,type:'sign-in'}); $('otp-form').hidden=false; status(tr('cloud.checkEmail')); $('otp').focus(); });
action('otp-form',async()=>{ await call('/sign-in/email-otp',{email,otp:$('otp').value.trim()}); await refresh(); $('code').focus(); });
action('device-form',async()=>{
  userCode=$('code').value.trim().toUpperCase();
  const device=await call(`/device?user_code=${encodeURIComponent(userCode)}`);
  if(device.client_id !== 'filow-desktop' || device.scope) throw new Error(tr('cloud.unsupported'));
  $('device-details').textContent=`Filo desktop · ${userCode}`; $('approval').hidden=false; $('approve').focus();
});
for(const choice of ['approve','deny']) action(choice,async()=>{
  await call(`/device/${choice}`,{userCode}); $('approval').hidden=true; $('device-form').hidden=true;
  status(tr(choice === 'approve' ? 'cloud.connected' : 'cloud.denied'));
});
action('signout',async()=>{ await call('/sign-out',{}); $('approval').hidden=true; await refresh(); });
if ($('email-form')) refresh().catch(()=>status(tr('account.error')));
