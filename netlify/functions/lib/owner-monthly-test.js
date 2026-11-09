'use strict';
// Owner-only Stripe TEST adapter. Never reads STRIPE_SECRET_KEY or LIVE webhook secrets.
const crypto=require('node:crypto');
const {SERVICES}=require('./monthly-service-catalog');
const {validatePortalConfiguration}=require('./portal-policy');
const OWNER='michellesilerschmidt@gmail.com';
const SITE='https://aeogeosearch.com';
const BASE=SITE+'/owner-monthly-test';
const AUTH='https://ftwohoenimegsmtliqgz.supabase.co';
const UUID=/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const EVENTS=new Set(['checkout.session.completed','checkout.session.expired','invoice.paid','invoice.payment_failed','customer.subscription.updated','customer.subscription.deleted','charge.refunded','charge.dispute.created','charge.dispute.closed']);
const SAFE_CODES=new Set(['TEST_AUTH','TEST_OWNER_ONLY','TEST_CONFIGURATION','TEST_ORIGIN','TEST_METHOD','TEST_REQUEST','TEST_MODE','TEST_SCOPE','TEST_STRIPE_AUTH','TEST_STRIPE_PERMISSION','TEST_STRIPE_NOT_FOUND','TEST_STRIPE_BUSY','TEST_STRIPE_REQUEST','TEST_STRIPE_RESPONSE','TEST_STRIPE_NETWORK','TEST_DATABASE','TEST_CONFLICT','TEST_SIGNATURE','TEST_UNAVAILABLE']);
function fault(code,status=503){return Object.assign(new Error(code),{code,status});}
function reply(statusCode,body){return {statusCode,headers:{'Content-Type':'application/json','Cache-Control':'no-store, private','Netlify-CDN-Cache-Control':'no-store','CDN-Cache-Control':'no-store','X-Content-Type-Options':'nosniff','Referrer-Policy':'no-referrer'},body:JSON.stringify({...body,testMode:true})};}
function failure(e){const code=SAFE_CODES.has(e?.code)?e.code:e?.status===401?'TEST_AUTH':e?.status===403?'TEST_OWNER_ONLY':'TEST_UNAVAILABLE';const status=[400,401,403,405,409,429,503].includes(e?.status)?e.status:503;return reply(status,{code,error:'Owner-only TEST billing stopped. Reference: '+code+'. No LIVE checkout was created.'});}
function confirmedOwner(u){return UUID.test(u?.id||'')&&u?.email_confirmed_at&&u.is_anonymous!==true&&String(u.email||'').toLowerCase()===OWNER;}
function configuration(env){
 const key=env.STRIPE_MONTHLY_TEST_SECRET_KEY;
 const checks=[{id:'test_enabled',ok:env.OWNER_MONTHLY_TEST_ENABLED==='true'},
  {id:'live_gates_closed',ok:['LIVE_PAYMENTS_ENABLED','MONTHLY_SERVICE_CHECKOUT_ENABLED','MONTHLY_SERVICE_REVIEW_COMPLETE'].every(k=>env[k]!=='true')},
  {id:'test_key',ok:typeof key==='string'&&/^sk_test_[A-Za-z0-9_]{12,}$/.test(key)},
  {id:'test_webhook_secret',ok:typeof env.STRIPE_MONTHLY_TEST_WEBHOOK_SECRET==='string'&&/^whsec_[A-Za-z0-9_]{12,}$/.test(env.STRIPE_MONTHLY_TEST_WEBHOOK_SECRET)},
  {id:'test_portal',ok:/^bpc_[A-Za-z0-9_]+$/.test(env.STRIPE_MONTHLY_TEST_PORTAL_CONFIGURATION_ID||'')}];
 const live=new Set(Object.values(SERVICES).map(s=>s.livePrice)),seen=new Set();
 for(const [slug,s] of Object.entries(SERVICES)){const id=env[s.testEnv],ok=typeof id==='string'&&/^price_[A-Za-z0-9_]+$/.test(id)&&!live.has(id)&&!seen.has(id);checks.push({id:slug,ok});if(id)seen.add(id);}
 return checks;
}
function requireConfig(env){if(!configuration(env).every(c=>c.ok))throw fault('TEST_CONFIGURATION');}
function containsLive(value){if(!value||typeof value!=='object')return false;if(value.livemode===true)return true;return Object.values(value).some(containsLive);}
function makeStripe(env,fetcher){
 const key=env.STRIPE_MONTHLY_TEST_SECRET_KEY;
 if(typeof key!=='string'||!/^sk_test_[A-Za-z0-9_]{12,}$/.test(key))throw fault('TEST_CONFIGURATION');
 return async(resource,{method='GET',data={},idempotency}={})=>{
  if(typeof resource!=='string'||resource.startsWith('/')||/[\\#]/.test(resource)||resource.includes('..'))throw fault('TEST_SCOPE');
  const url=new URL('https://api.stripe.com/v1/'+resource),p=url.pathname.slice(4);
  const read=/^(?:prices\/price_[A-Za-z0-9_]+|customers\/cus_[A-Za-z0-9_]+|checkout\/sessions\/cs_test_[A-Za-z0-9_]+(?:\/line_items)?|subscriptions(?:\/sub_[A-Za-z0-9_]+)?|invoices\/in_[A-Za-z0-9_]+|payment_intents\/pi_[A-Za-z0-9_]+|charges\/ch_[A-Za-z0-9_]+|disputes(?:\/dp_[A-Za-z0-9_]+)?|billing_portal\/configurations\/bpc_[A-Za-z0-9_]+)$/.test(p);
  const write=/^(?:customers|checkout\/sessions|checkout\/sessions\/cs_test_[A-Za-z0-9_]+\/expire|billing_portal\/sessions|subscriptions\/sub_[A-Za-z0-9_]+)$/.test(p);
  if(url.origin!=='https://api.stripe.com'||method==='GET'&&!read||method==='POST'&&!write||!['GET','POST'].includes(method))throw fault('TEST_SCOPE');
  if(p.startsWith('prices/')&&!Object.values(SERVICES).some(s=>env[s.testEnv]===p.slice(7)))throw fault('TEST_SCOPE');
  if(p.startsWith('billing_portal/configurations/')&&p.slice('billing_portal/configurations/'.length)!==env.STRIPE_MONTHLY_TEST_PORTAL_CONFIGURATION_ID)throw fault('TEST_SCOPE');
  if(method==='POST'){
   if(p==='checkout/sessions'&&(data.mode!=='subscription'||!Object.values(SERVICES).some(s=>env[s.testEnv]===data['line_items[0][price]'])||!String(data.success_url).startsWith(BASE+'/service-checkout/?')||!String(data.cancel_url).startsWith(BASE+'/service-checkout/?')))throw fault('TEST_SCOPE');
   if(p==='billing_portal/sessions'&&(data.configuration!==env.STRIPE_MONTHLY_TEST_PORTAL_CONFIGURATION_ID||!String(data.return_url).startsWith(BASE+'/service-checkout/?')))throw fault('TEST_SCOPE');
   if(p.startsWith('subscriptions/')&&(Object.keys(data).length!==1||data.cancel_at_period_end!==true))throw fault('TEST_SCOPE');
  }
  const form=new URLSearchParams();for(const [k,v]of Object.entries(data))if(v!==undefined&&v!==null)form.set(k,String(v));
  let r,body;
  try{r=await fetcher(url.href,{method,redirect:'error',headers:{Authorization:'Bearer '+key,'Stripe-Version':'2025-02-24.acacia',...(method==='POST'?{'Content-Type':'application/x-www-form-urlencoded'}:{}),...(idempotency?{'Idempotency-Key':idempotency}:{})},body:method==='POST'?form.toString():undefined,signal:AbortSignal.timeout(15000)});}catch{throw fault('TEST_STRIPE_NETWORK');}
  if(!r.ok)throw fault(({401:'TEST_STRIPE_AUTH',403:'TEST_STRIPE_PERMISSION',404:'TEST_STRIPE_NOT_FOUND',429:'TEST_STRIPE_BUSY'})[r.status]||'TEST_STRIPE_REQUEST');
  try{body=await r.json();}catch{throw fault('TEST_STRIPE_RESPONSE');}
  if(!body||typeof body!=='object'||Array.isArray(body)||body.error)throw fault('TEST_STRIPE_RESPONSE');
  if(containsLive(body))throw fault('TEST_MODE');
  if(p==='checkout/sessions'&&method==='POST'&&(!/^cs_test_[A-Za-z0-9_]+$/.test(body.id||'')||body.livemode!==false))throw fault('TEST_MODE');
  return body;
 };
}
function makeScopedDb({db,env,fetcher,actor}){
 let uid=actor?.id;
 async function owner(candidate){
  if(!UUID.test(candidate||''))throw fault('TEST_SCOPE');
  if(uid){if(candidate!==uid)throw fault('TEST_SCOPE');return;}
  // Webhooks have no browser bearer token: independently verify the metadata user.
  if(env.SUPABASE_URL?.trim().replace(/\/$/,'')!==AUTH)throw fault('TEST_CONFIGURATION');
  const key=env.SUPABASE_SERVICE_ROLE_KEY?.trim();if(typeof key!=='string'||!key)throw fault('TEST_CONFIGURATION');
  let u;
  try{const r=await fetcher(AUTH+'/auth/v1/admin/users/'+candidate,{method:'GET',redirect:'error',headers:{apikey:key,...(key.startsWith('sb_secret_')?{}:{Authorization:'Bearer '+key})},signal:AbortSignal.timeout(8000)});if(!r.ok)throw Error();u=await r.json();}catch{throw fault('TEST_AUTH');}
  if(!confirmedOwner(u)||u.id!==candidate)throw fault('TEST_OWNER_ONLY',403);uid=candidate;
 }
 return async(resource,args={})=>{
  const method=args.method||'GET';
  if(method==='POST'){
   const b=args.body;
   if(!['rpc/geo_monthly_service_checkout','rpc/geo_monthly_service_apply'].includes(resource)||!b||b.p_mode!=='test'||!Object.hasOwn(SERVICES,b.p_service))throw fault('TEST_SCOPE');
   await owner(b.p_user);
   if(resource.endsWith('_checkout')&&!['claim','lock','customer','bind','reset','release'].includes(b.p_action))throw fault('TEST_SCOPE');
   if(b.p_session&&!/^cs_test_[A-Za-z0-9_]+$/.test(b.p_session))throw fault('TEST_SCOPE');
   try{return await db(resource,args);}catch{throw fault('TEST_DATABASE');}
  }
  if(method!=='GET'||typeof resource!=='string')throw fault('TEST_SCOPE');
  const at=resource.indexOf('?'),table=at<0?resource:resource.slice(0,at),query=new URLSearchParams(at<0?'':resource.slice(at+1));
  if(!['geo_monthly_service_checkouts','geo_monthly_service_subscriptions'].includes(table))throw fault('TEST_SCOPE');
  const filter=query.get('user_id');if(filter&&!/^eq\.[0-9a-f-]+$/i.test(filter))throw fault('TEST_SCOPE');
  await owner(filter?filter.slice(3):uid);
  if(query.getAll('user_id').length>1||query.getAll('billing_mode').length>1||query.has('billing_mode')&&query.get('billing_mode')!=='eq.test')throw fault('TEST_SCOPE');
  query.set('user_id','eq.'+uid);query.set('billing_mode','eq.test');
  let result;try{result=await db(table+'?'+query.toString(),args);}catch{throw fault('TEST_DATABASE');}
  if(!Array.isArray(result))throw fault('TEST_DATABASE');
  if(result.some(row=>row?.user_id&&row.user_id!==uid||row?.billing_mode&&row.billing_mode!=='test'))throw fault('TEST_SCOPE');
  return result;
 };
}
function verifySignature(raw,header,secret,now){
 if(typeof header!=='string'||header.length>4096||typeof secret!=='string'||!/^whsec_[A-Za-z0-9_]{12,}$/.test(secret))return false;
 const parts=header.split(',').map(s=>s.split('=')),timestamps=parts.filter(p=>p[0]==='t');
 if(timestamps.length!==1||!/^\d+$/.test(timestamps[0][1]||''))return false;
 const t=timestamps[0][1];if(Math.abs(now/1000-Number(t))>300)return false;
 const expected=crypto.createHmac('sha256',secret).update(t+'.').update(raw).digest();
 return parts.filter(p=>p[0]==='v1'&&/^[0-9a-f]{64}$/i.test(p[1]||'')).some(p=>crypto.timingSafeEqual(Buffer.from(p[1],'hex'),expected));
}
function cleanResult(data){
 const out={};for(const k of ['paid','hasBillingCustomer','checkoutOpen','cancel_at_period_end','existingPurchase'])if(typeof data[k]==='boolean')out[k]=data[k];
 if(Object.hasOwn(SERVICES,data.service||''))out.service=data.service;
 if(['active','past_due','canceled','incomplete','incomplete_expired','trialing','unpaid','paused','pending','expired','open'].includes(data.status))out.status=data.status;
 if(data.paid_through===null||typeof data.paid_through==='string'&&/^\d{4}-\d\d-\d\dT[0-9:.]+Z$/.test(data.paid_through)&&data.paid_through.length<40)out.paid_through=data.paid_through;
 if([null,'refund_review','dispute_open','dispute_lost'].includes(data.financial_review))out.financial_review=data.financial_review;
 if(data.contactUrl)out.contactUrl='/pricing#pricing-contact-form';
 if(Array.isArray(data.subscriptions))out.subscriptions=data.subscriptions.slice(0,10).map(cleanResult);
 if(data.url){let u;try{u=new URL(data.url);}catch{throw fault('TEST_STRIPE_RESPONSE');}if(u.protocol!=='https:'||u.username||u.password||!['checkout.stripe.com','billing.stripe.com'].includes(u.hostname))throw fault('TEST_SCOPE');out.url=u.href;}
 return out;
}
function makeRuntime({env=process.env,db,user,makeBilling,fetcher=globalThis.fetch,now=Date.now}){
 function billing(actor){
  requireConfig(env);const testEnv={STRIPE_SECRET_KEY:env.STRIPE_MONTHLY_TEST_SECRET_KEY,LIVE_PAYMENTS_ENABLED:'false',MONTHLY_SERVICE_CHECKOUT_ENABLED:'true',MONTHLY_SERVICE_REVIEW_COMPLETE:'true',BILLING_TEST_EMAILS:OWNER,STRIPE_SERVICE_PORTAL_CONFIGURATION_ID:env.STRIPE_MONTHLY_TEST_PORTAL_CONFIGURATION_ID};
  for(const s of Object.values(SERVICES))testEnv[s.testEnv]=env[s.testEnv];
  const stripe=makeStripe(env,fetcher),scopedDb=makeScopedDb({db,env,fetcher,actor});
  const core=makeBilling({db:scopedDb,user:async()=>{if(!confirmedOwner(actor))throw fault('TEST_OWNER_ONLY',403);return actor;},reply:(statusCode,body)=>({statusCode,body:JSON.stringify(body)}),stripe,origin:()=>BASE,UUID,env:testEnv,now});
  return {core,stripe};
 }
 async function handler(event){try{
  if(!['GET','POST'].includes(event.httpMethod))throw fault('TEST_METHOD',405);
  const origin=Object.entries(event.headers||{}).find(([k])=>k.toLowerCase()==='origin')?.[1];if(origin&&origin!==SITE)throw fault('TEST_ORIGIN',403);
  let actor;try{actor=await user(event);}catch(e){throw fault(e?.status===401?'TEST_AUTH':'TEST_UNAVAILABLE',e?.status===401?401:503);}
  if(!confirmedOwner(actor))throw fault('TEST_OWNER_ONLY',403);
  const query=event.queryStringParameters||{};
  if(event.httpMethod==='GET'&&query.preflight==='1'){
   const config=configuration(env),checks=[];
   if(config.every(c=>c.ok)){
    const {core,stripe}=billing(actor);
    await Promise.all(Object.keys(SERVICES).map(async service=>{try{await core.validatePrice(service);checks.push({id:service,ok:true});}catch{checks.push({id:service,ok:false});}}));
    try{validatePortalConfiguration(await stripe('billing_portal/configurations/'+env.STRIPE_MONTHLY_TEST_PORTAL_CONFIGURATION_ID),false);checks.push({id:'portal_policy',ok:true});}catch{checks.push({id:'portal_policy',ok:false});}
    // Verify the webhook's independent owner lookup and scoped storage reads before a test purchase.
    try{const probe=makeScopedDb({db,env,fetcher});await probe('geo_monthly_service_checkouts?user_id=eq.'+actor.id+'&select=user_id,billing_mode');await probe('geo_monthly_service_subscriptions?user_id=eq.'+actor.id+'&select=user_id,billing_mode');checks.push({id:'owner_test_storage',ok:true});}catch{checks.push({id:'owner_test_storage',ok:false});}
   }
   return reply(200,{configuration:config,checks,ready:config.every(c=>c.ok)&&checks.length===5&&checks.every(c=>c.ok)});
  }
  const {core}=billing(actor);let requested;
  try{requested=event.httpMethod==='POST'?JSON.parse(event.body||'{}'):query;}catch{throw fault('TEST_REQUEST',400);}
  if(!Object.hasOwn(SERVICES,requested.service||'')||requested.action&&!['portal'].includes(requested.action)||requested.session_id&&!/^cs_test_[A-Za-z0-9_]{1,230}$/.test(requested.session_id))throw fault('TEST_REQUEST',400);
  const result=await core.handler(event);
  if(result.statusCode!==200)throw fault(result.statusCode===409?'TEST_CONFLICT':result.statusCode===401?'TEST_AUTH':result.statusCode===403?'TEST_OWNER_ONLY':'TEST_UNAVAILABLE',[400,401,403,409,503].includes(result.statusCode)?result.statusCode:503);
  return reply(200,cleanResult(JSON.parse(result.body)));
 }catch(e){return failure(e);}}
 async function webhook(event){try{
  if(event.httpMethod!=='POST')throw fault('TEST_METHOD',405);
  if(typeof event.body!=='string'||event.body.length>2097152)throw fault('TEST_REQUEST',400);
  const raw=Buffer.from(event.body,event.isBase64Encoded?'base64':'utf8');
  const signature=Object.entries(event.headers||{}).find(([k])=>k.toLowerCase()==='stripe-signature')?.[1];
  if(!verifySignature(raw,signature,env.STRIPE_MONTHLY_TEST_WEBHOOK_SECRET,now()))throw fault('TEST_SIGNATURE',400);
  let e;try{e=JSON.parse(raw.toString('utf8'));}catch{throw fault('TEST_REQUEST',400);}
  if(e.livemode!==false)throw fault('TEST_MODE',400);
  if(typeof e.id!=='string'||!/^evt_[A-Za-z0-9_]+$/.test(e.id)||!e.data?.object)throw fault('TEST_REQUEST',400);
  requireConfig(env);
  if(!EVENTS.has(e.type))return reply(200,{received:true,ignored:true});
  const result=await billing(null).core.webhook(e);
  return reply(200,{received:true,ignored:!result});
 }catch(e){const r=failure(e);if(r.statusCode===503)r.statusCode=500;return r;}}
 return {handler,webhook};
}
function configured(){return require('./owner-monthly-test-setup').configuredRuntime();}
module.exports={makeRuntime,configured,configuration,makeStripe,makeScopedDb,verifySignature,cleanResult};
