import { afterEach, describe, expect, it, vi } from 'vitest';
import Stripe from 'stripe';
import Database from 'better-sqlite3';
import { getMigrations } from 'better-auth/db/migration';
import { createCloud, paidSubscription } from './service.mjs';
const dbs: Array<ReturnType<typeof Database>> = [];
afterEach(()=>{ for(const db of dbs.splice(0)) db.close(); });
async function setup(billing = false) {
  const database = new Database(':memory:'); dbs.push(database);
  let otp = '';
  const origin = 'http://localhost:4780';
  const stripe = new Stripe('sk_test_local_integration_only');
  vi.spyOn(stripe.customers,'search').mockResolvedValue({ data: [] } as any);
  vi.spyOn(stripe.customers,'list').mockResolvedValue({ data: [] } as any);
  vi.spyOn(stripe.customers,'create').mockResolvedValue({ id: 'cus_test' } as any);
  vi.spyOn(stripe.subscriptions,'list').mockResolvedValue({ data: [] } as any);
  vi.spyOn(stripe.prices,'retrieve').mockResolvedValue({ id: 'price_pro_test', type:'recurring', recurring:{ usage_type:'licensed', interval:'month' } } as any);
  const checkout = vi.spyOn(stripe.checkout.sessions,'create').mockResolvedValue({id:'cs_test',url:'https://checkout.stripe.com/c/pay/test'} as any);
  vi.spyOn(stripe.billingPortal.sessions,'create').mockResolvedValue({id:'bps_test',url:'https://billing.stripe.com/p/session/test'} as any);
  const cloud = createCloud({database,origin,secret:'test-only-secret-32-characters-long-12345678', sendOTP: async (message: {otp:string})=>{otp=message.otp;},
    ...(billing ? {stripe,webhookSecret:'whsec_test_only',priceId:'price_pro_test'} : {}) });
  const migrations = await getMigrations(cloud.auth.options); await migrations.runMigrations();
  const call = (route:string,body?:unknown,headers:Record<string,string>={})=>cloud.handle(new Request(origin+route,{method:body?'POST':'GET',headers:{Origin:origin,'Content-Type':'application/json','x-filow-client-ip':'127.0.0.1',...headers},...(body?{body:JSON.stringify(body)}:{})}));
  async function signin(email='filo@example.test') {
    expect((await call('/api/auth/email-otp/send-verification-otp',{email,type:'sign-in'})).status).toBe(200);
    const response = await call('/api/auth/sign-in/email-otp',{email,otp});
    expect(response.status).toBe(200);
    const data=await response.json(); return {Authorization:`Bearer ${data.token}`};
  }
  return {cloud,call,signin,database,stripe,checkout,origin};
}
describe('hosted account flow',()=>{
  it('requires authentication and never enables paid access from a redirect',async()=>{
    const {call,signin}=await setup();
    expect((await call('/v1/me')).status).toBe(401);
    const headers=await signin();
    const me=await (await call('/v1/me',undefined,headers)).json();
    expect(me).toMatchObject({plan:'local',billing:false,user:{email:'filo@example.test'}});
    expect((await call('/v1/checkout',{},headers)).status).toBe(503);
    expect((await call('/v1/me',undefined,{...headers,Origin:'https://evil.example'})).status).toBe(403);
  });
  it('requires code review and approval before a desktop can retrieve its session',async()=>{
    const {call,signin,database}=await setup();
    const code = await (await call('/api/auth/device/code',{client_id:'filow-desktop'})).json();
    const tokenBody={client_id:'filow-desktop',device_code:code.device_code,grant_type:'urn:ietf:params:oauth:grant-type:device_code'};
    expect((await (await call('/api/auth/device/token',tokenBody)).json()).error).toBe('authorization_pending');
    const headers=await signin();
    const verify=await call('/api/auth/device?user_code='+code.user_code,undefined,headers);
    expect((await verify.json()).client_id).toBe('filow-desktop');
    expect((await call('/api/auth/device/approve',{userCode:code.user_code},headers)).status).toBe(200);
    // Time belongs to the protocol, not the test runner. Move the stored last poll beyond its interval.
    database.prepare('UPDATE deviceCode SET lastPolledAt = ?').run(Date.now()-60_000);
    const response=await call('/api/auth/device/token',tokenBody);
    expect(response.status).toBe(200);
    const data=await response.json(); expect(data.access_token).toBeTypeOf('string');
    expect((await call('/v1/me',undefined,{Authorization:`Bearer ${data.access_token}`})).status).toBe(200);
    expect((await call('/api/auth/device/token',tokenBody)).status).not.toBe(200);
  });
  it('rejects unknown client IDs',async()=>{
    const {call}=await setup();
    expect((await call('/api/auth/device/code',{client_id:'unknown'})).status).not.toBe(200);
  });
  it('creates checkout with the server price and refuses unsigned billing events',async()=>{
    const {call,signin,checkout,cloud,origin,stripe}=await setup(true);
    const headers=await signin();
    const response=await call('/v1/checkout',{priceId:'price_attacker',referenceId:'someone-else'},headers);
    expect(response.status).toBe(200);
    expect((await response.json()).url).toBe('https://checkout.stripe.com/c/pay/test');
    expect(checkout.mock.calls[0][0]?.line_items).toContainEqual({price:'price_pro_test',quantity:1});
    expect((await (await call('/v1/me',undefined,headers)).json()).plan).toBe('local');
    const event=await cloud.handle(new Request(origin+'/api/auth/stripe/webhook',{method:'POST',headers:{'Content-Type':'application/json','stripe-signature':'invalid'},body:'{}'}));
    expect(event.status).not.toBe(200);
    expect((await call('/v1/portal',{},headers)).status).toBe(200);
    const created = checkout.mock.calls[0][0];
    const subscription = { id:'sub_test',customer:'cus_test',status:'active',metadata:created?.subscription_data?.metadata,
      items:{data:[{id:'si_test',quantity:1,price:{id:'price_pro_test',recurring:{interval:'month'}},
        current_period_start:Math.floor(Date.now()/1000),current_period_end:Math.floor(Date.now()/1000)+86400}]},cancel_at_period_end:false };
    const deliver = async (status:string) => {
      const payload=JSON.stringify({id:'evt_'+status,type:'customer.subscription.updated',data:{object:{...subscription,status}}});
      const signature=stripe.webhooks.generateTestHeaderString({payload,secret:'whsec_test_only'});
      return cloud.handle(new Request(origin+'/api/auth/stripe/webhook',{method:'POST',headers:{'Content-Type':'application/json','stripe-signature':signature},body:payload}));
    };
    expect((await deliver('active')).status).toBe(200);
    expect((await (await call('/v1/me',undefined,headers)).json()).plan).toBe('pro');
    // Repeated delivery is harmless; a subsequent unpaid state removes the entitlement.
    expect((await deliver('active')).status).toBe(200);
    expect((await deliver('past_due')).status).toBe(200);
    expect((await (await call('/v1/me',undefined,headers)).json()).plan).toBe('local');
  });
});
// Stripe retries events and does not promise their order: an older "active" that arrives (again) after
// the subscription went unpaid must not hand the access back.
it('ignores a billing event that is older than the one already applied, or was applied before',async()=>{
  const {call,signin,checkout,cloud,origin,stripe}=await setup(true);
  const headers=await signin();
  expect((await call('/v1/checkout',{},headers)).status).toBe(200);
  const now=Math.floor(Date.now()/1000);
  const subscription = { id:'sub_order',object:'subscription',customer:'cus_test',metadata:checkout.mock.calls[0][0]?.subscription_data?.metadata,
    items:{data:[{id:'si_test',quantity:1,price:{id:'price_pro_test',recurring:{interval:'month'}},current_period_start:now,current_period_end:now+86400}]},cancel_at_period_end:false };
  const deliver = async (id:string,status:string,created:number) => {
    const payload=JSON.stringify({id,created,type:'customer.subscription.updated',data:{object:{...subscription,status}}});
    const signature=stripe.webhooks.generateTestHeaderString({payload,secret:'whsec_test_only'});
    return cloud.handle(new Request(origin+'/api/auth/stripe/webhook',{method:'POST',headers:{'Content-Type':'application/json','stripe-signature':signature},body:payload}));
  };
  const plan = async () => (await (await call('/v1/me',undefined,headers)).json()).plan;
  expect((await deliver('evt_1','active',now-20)).status).toBe(200);
  expect(await plan()).toBe('pro');
  expect((await deliver('evt_3','past_due',now-5)).status).toBe(200);
  expect(await plan()).toBe('local');
  // the same event once more, and a different one from before the unpaid state: both answered, neither applied
  expect((await deliver('evt_1','active',now-20)).status).toBe(200);
  expect(await plan()).toBe('local');
  expect((await deliver('evt_2','active',now-10)).status).toBe(200);
  expect(await plan()).toBe('local');
  // a newer event still applies
  expect((await deliver('evt_4','active',now)).status).toBe(200);
  expect(await plan()).toBe('pro');
  // two events in the same second: the repeat of the first is recognised by its id, not its time
  expect((await deliver('evt_5','past_due',now)).status).toBe(200);
  expect((await deliver('evt_4','active',now)).status).toBe(200);
  expect(await plan()).toBe('local');
});
it('accepts only current, active Pro subscriptions',()=>{
  const paid={plan:'pro',status:'active',periodEnd:new Date(Date.now()+60_000).toISOString()};
  expect(paidSubscription([paid])).toEqual(paid);
  for(const status of ['incomplete','past_due','unpaid','canceled']) expect(paidSubscription([{...paid,status}])).toBeNull();
  expect(paidSubscription([{...paid,periodEnd:'2000-01-01'}])).toBeNull();
});
