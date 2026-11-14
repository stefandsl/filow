import { afterEach, describe, expect, it, vi } from 'vitest';
import { createRequire } from 'node:module';
import fs from 'node:fs';
import path from 'node:path';
const { createAccount, accountOrigin, billingUrl, signalledFetch, buildAccountOrigin } = createRequire(import.meta.url)('./account.js');
const dirs:string[]=[];
afterEach(()=>{ for(const dir of dirs.splice(0)) fs.rmSync(dir,{recursive:true,force:true}); });
function setup(fetcher: ReturnType<typeof vi.fn>) {
  const parent=path.resolve('tmp/account-tests'); fs.mkdirSync(parent,{recursive:true});
  const userData=fs.mkdtempSync(path.join(parent,'session-')); dirs.push(userData);
  let clock=0;
  const openExternal=vi.fn(async()=>{});
  const account=createAccount({origin:'https://accounts.example.test',userData,fetcher,openExternal,now:()=>clock,
    safeStorage:{isEncryptionAvailable:()=>true, encryptString:(s:string)=>Buffer.from('encrypted:'+s),decryptString:(b:Buffer)=>b.toString().slice(10)}});
  return {account,userData,openExternal,advance:()=>{clock+=6000;}};
}
describe('desktop accounts',()=>{
  it('only opens configured HTTPS account and exact Stripe destinations',()=>{
    expect(accountOrigin('https://accounts.example.test')).toBe('https://accounts.example.test');
    expect(accountOrigin('http://127.0.0.1:4780')).toBeNull();
    expect(accountOrigin('http://127.0.0.1:4780',true)).toBe('http://127.0.0.1:4780');
    for(const url of ['javascript:alert(1)','https://checkout.stripe.com.evil.test','https://user@checkout.stripe.com','http://checkout.stripe.com']) expect(billingUrl(url)).toBeNull();
    expect(billingUrl('https://checkout.stripe.com/c/pay/test')).toContain('checkout.stripe.com');
  });
  it('does not expose tokens and stores a session only after approval',async()=>{
    const fetcher=vi.fn().mockResolvedValueOnce(Response.json({device_code:'secret-device',user_code:'ABCD-EFGH',expires_in:600,interval:5}))
      .mockResolvedValueOnce(Response.json({access_token:'secret-session'}))
      .mockResolvedValueOnce(Response.json({user:{email:'person@example.test'},plan:'local',billing:true}));
    const {account,advance,userData,openExternal}=setup(fetcher);
    expect(await account.begin()).toEqual({userCode:'ABCD-EFGH',expiresAt:600000});
    expect(openExternal).toHaveBeenCalledWith('https://accounts.example.test/device');
    expect(await account.poll()).toEqual({state:'pending'});
    advance(); expect(await account.poll()).toEqual({state:'signed-in'});
    expect(fs.readFileSync(path.join(userData,'account-session.bin'),'utf8')).toMatch(/^encrypted:/);
    expect(JSON.stringify(await account.status())).not.toContain('secret-session');
    expect(fetcher.mock.calls[2][1].headers.Authorization).toBe('Bearer secret-session');
  });
  it('cannot save a late session after cancellation',async()=>{
    let resolve!: (r:Response)=>void;
    const fetcher=vi.fn().mockResolvedValueOnce(Response.json({device_code:'secret',user_code:'CODE',expires_in:600}))
      .mockImplementationOnce(()=>new Promise<Response>(r=>{resolve=r;}));
    const {account,advance,userData}=setup(fetcher);
    await account.begin(); advance(); const polling=account.poll();
    account.cancel(); resolve(Response.json({access_token:'late'}));
    expect(await polling).toEqual({state:'cancelled'});
    expect(fs.existsSync(path.join(userData,'account-session.bin'))).toBe(false);
  });
  it('honors a server slow-down and device expiry',async()=>{
    const fetcher=vi.fn().mockResolvedValueOnce(Response.json({device_code:'secret',user_code:'CODE',expires_in:14,interval:5}))
      .mockResolvedValueOnce(Response.json({error:'slow_down'},{status:400}));
    const {account,advance}=setup(fetcher);
    await account.begin(); advance(); expect(await account.poll()).toEqual({state:'pending'});
    advance(); expect(await account.poll()).toEqual({state:'pending'}); expect(fetcher).toHaveBeenCalledTimes(2);
    advance(); expect(await account.poll()).toEqual({state:'expired'});
  });
});

describe('account requests and the going-outside signal',()=>{
  it('the signal is on from before the request until its body was read, also when it fails',async()=>{
    const log:string[]=[];
    const out={begin:vi.fn((id:string,kind:string,names:string[])=>{log.push(`begin ${id} ${kind} ${names.join()}`);}),end:vi.fn((id:string)=>{log.push(`end ${id}`);})};
    const body={async text(){ log.push('body read'); return '{"ok":true}'; }};
    const ok=vi.fn(async()=>{ log.push('request'); return {status:200,statusText:'OK',headers:new Headers({'content-type':'application/json'}),...body}; });
    const fetcher=signalledFetch(ok,()=>out);
    const res=await fetcher('https://accounts.example.test/v1/me',{method:'GET'});
    expect(await res.json()).toEqual({ok:true});
    expect(log).toEqual(['begin account:1 account Filow account','request','body read','end account:1']);
    const failing=signalledFetch(vi.fn(async()=>{ throw new Error('offline'); }),()=>out);
    await expect(failing('https://accounts.example.test/v1/me',{})).rejects.toThrow('offline');
    expect(out.end).toHaveBeenLastCalledWith('account:1');
    expect(out.begin).toHaveBeenCalledTimes(2);
  });
  it('without OK Filow the request still goes out, with no signal',async()=>{
    const fetcher=signalledFetch(vi.fn(async()=>Response.json({x:1},{status:401})),()=>undefined);
    const res=await fetcher('https://accounts.example.test/v1/me',{});
    expect(res.status).toBe(401);
    expect(await res.json()).toEqual({x:1});
  });
  it('the account sign-in talks through the signalled fetch, and status names who receives it',async()=>{
    const out={begin:vi.fn(),end:vi.fn()};
    const {account}=setup(signalledFetch(vi.fn(async()=>Response.json({device_code:'d',user_code:'U',expires_in:600})),()=>out));
    await account.begin();
    expect(out.begin).toHaveBeenCalledWith('account:1','account',['Filow account']);
    expect(out.end).toHaveBeenCalledWith('account:1');
    expect((await account.status()).service).toBe('accounts.example.test');
  });
});

describe('the shell wires the account signal',()=>{
  it('main gives the account a fetch that shows OK Filow\'s signal, and OK Filow hands out its own state',()=>{
    const src=(f:string)=>fs.readFileSync(path.join(path.dirname(new URL(import.meta.url).pathname.replace(/^\/([A-Za-z]:)/,'$1')),f),'utf8');
    expect(src('main.js')).toContain('fetcher: signalledFetch(fetch, () => okFilow?.outboundSignal()),');
    expect(src('okfilow.js')).toContain('const outboundSignal = () => ({ begin: outbound.begin, end: outbound.end });');
    expect(src('okfilow.js')).toMatch(/return \{[^}]*\boutboundSignal \};/);
  });
});
describe('the account origin is set when the app is built',()=>{
  it('an installed app uses only its own package.json; the environment overrides only a development run',()=>{
    expect(buildAccountOrigin({packaged:true,pkgOrigin:undefined,envOrigin:'https://evil.example.test'})).toBeNull();
    expect(buildAccountOrigin({packaged:true,pkgOrigin:'https://accounts.example.test',envOrigin:'https://evil.example.test'})).toBe('https://accounts.example.test');
    expect(buildAccountOrigin({packaged:true,pkgOrigin:'http://127.0.0.1:4780'})).toBeNull();
    expect(buildAccountOrigin({packaged:false,pkgOrigin:'https://accounts.example.test',envOrigin:'http://127.0.0.1:4780'})).toBe('http://127.0.0.1:4780');
    expect(buildAccountOrigin({packaged:false,pkgOrigin:'https://accounts.example.test'})).toBe('https://accounts.example.test');
  });
  it('the shell reads the build-time origin, answers account:configured from three pages without a request, and preload exposes it',()=>{
    const main=fs.readFileSync(new URL('./main.js',import.meta.url),'utf8'), preload=fs.readFileSync(new URL('./preload.js',import.meta.url),'utf8');
    expect(main).toContain('buildAccountOrigin({ packaged: app.isPackaged, pkgOrigin: require("./package.json").accountOrigin, envOrigin: process.env.FILOW_ACCOUNT_ORIGIN })');
    expect(main).toContain('const ACCOUNT_LINK_PAGES = ["/tour", "/settings/local", "/account"];');
    expect(main).toMatch(/appHandle\("account:configured", event => \{\s*if \(event\.sender !== mainWin\?\.webContents \|\| !ACCOUNT_LINK_PAGES\.includes\([^\n]*\s*return Boolean\(accountOriginNow\);\s*\}\);/);
    expect(preload).toContain('configured: () => ipcRenderer.invoke("account:configured"),');
    expect(fs.readFileSync(new URL('./package.json',import.meta.url),'utf8')).not.toContain('accountOrigin');
  });
  it('the tour and Settings show the /account link only when the build has accounts',()=>{
    const tour=fs.readFileSync(new URL('../web/app/tour/page.tsx',import.meta.url),'utf8'), settings=fs.readFileSync(new URL('../web/app/settings/local/page.tsx',import.meta.url),'utf8');
    const hook=fs.readFileSync(new URL('../web/lib/accountLink.ts',import.meta.url),'utf8');
    for(const page of [tour,settings]) { expect(page).toMatch(/\{accountLink && <Link className="btn" href="\/account">/); expect(page.match(/href="\/account"/g)).toHaveLength(1); }
    expect(hook).toContain('const [shown, setShown] = useState(false);');
    expect(hook).toContain('if (live) setShown(on === true);');
  });
});

it('returns a typed checkout closure across IPC without opening a billing URL', async () => {
  const fetcher = vi.fn().mockResolvedValue(Response.json({ error: 'billing_not_open' }, { status: 503 }));
  const { account, openExternal } = setup(fetcher);
  expect(await account.billing('checkout')).toEqual({ state: 'billing_not_open' });
  expect(openExternal).not.toHaveBeenCalled();
});
