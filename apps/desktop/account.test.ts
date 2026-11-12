import { afterEach, describe, expect, it, vi } from 'vitest';
import { createRequire } from 'node:module';
import fs from 'node:fs';
import path from 'node:path';
const { createAccount, accountOrigin, billingUrl } = createRequire(import.meta.url)('./account.js');
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
