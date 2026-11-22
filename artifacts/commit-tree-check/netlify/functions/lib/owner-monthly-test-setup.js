'use strict';
// Fixed-scope TEST fixture provisioning. No checkout, payment, LIVE key, or LIVE webhook operations.
const crypto=require('node:crypto');
const {SERVICES}=require('./monthly-service-catalog');
const {validatePortalConfiguration}=require('./portal-policy');
const OWNER='michellesilerschmidt@gmail.com',SITE='https://aeogeosearch.com',RETURN=SITE+'/owner-monthly-test/service-checkout/',HOOK=SITE+'/.netlify/functions/owner-monthly-test-webhook';
const VERSION='2025-02-24.acacia',KIND='aeogeo_monthly_test_setup_v1';
const UUID=/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const EVENTS=['checkout.session.completed','checkout.session.expired','invoice.paid','invoice.payment_failed','customer.subscription.updated','customer.subscription.deleted','charge.refunded','charge.dispute.created','charge.dispute.closed'];
const TABLE='geo_owner_monthly_test_configuration?id=eq.1&select=id,user_id,billing_mode,generation,enabled,configuration,lock_id,lock_until';
const CODES=new Set(['SETUP_AUTH','SETUP_OWNER','SETUP_METHOD','SETUP_ORIGIN','SETUP_REQUEST','SETUP_TEST_KEY','SETUP_TEST_KEY_MISSING','SETUP_TEST_KEY_MASKED','SETUP_TEST_KEY_MODE','SETUP_TEST_KEY_FORMAT','SETUP_LIVE_LOCKS','SETUP_ROLE_KEY','SETUP_STORAGE','SETUP_BUSY','SETUP_LOCK','SETUP_STATE','SETUP_SCOPE','SETUP_STRIPE_AUTH','SETUP_STRIPE_PERMISSION','SETUP_STRIPE_BUSY','SETUP_STRIPE_REQUEST','SETUP_NETWORK','SETUP_RESPONSE','SETUP_MODE','SETUP_ACCOUNT_CHANGED','SETUP_PAGINATION','SETUP_PORTAL_POLICY','SETUP_WEBHOOK_RECOVERY','SETUP_CRYPTO','SETUP_FAILED']);
class SetupError extends Error{constructor(code,status=503){super(code);this.code=code;this.status=status;}}
const fail=(code,status)=>{throw new SetupError(code,status);};
function response(statusCode,body){return {statusCode,headers:{'Content-Type':'application/json','Cache-Control':'no-store, private','Netlify-CDN-Cache-Control':'no-store','CDN-Cache-Control':'no-store','X-Content-Type-Options':'nosniff','Referrer-Policy':'no-referrer'},body:JSON.stringify({...body,testMode:true})};}
function errorResponse(e){const code=e instanceof SetupError&&CODES.has(e.code)?e.code:'SETUP_FAILED';return response(e instanceof SetupError?e.status:503,{code,error:'Automatic TEST setup stopped. Reference: '+code+'. LIVE settings were not changed.'});}
function isOwner(u){return UUID.test(u?.id||'')&&u?.email_confirmed_at&&u.is_anonymous!==true&&String(u.email||'').toLowerCase()===OWNER;}
function normalizedTestKey(value){
 if(typeof value!=='string')return value;
 let key=value.trim();
 if(key.length>=2&&((key[0]==='"'&&key.at(-1)==='"')||(key[0]==="'"&&key.at(-1)==="'")))key=key.slice(1,-1).trim();
 return key;
}
function baseEnv(source){const env={};for(const name of ['SUPABASE_URL','SUPABASE_SERVICE_ROLE_KEY','STRIPE_MONTHLY_TEST_SECRET_KEY','LIVE_PAYMENTS_ENABLED','MONTHLY_SERVICE_CHECKOUT_ENABLED','MONTHLY_SERVICE_REVIEW_COMPLETE'])env[name]=source[name];env.STRIPE_MONTHLY_TEST_SECRET_KEY=normalizedTestKey(env.STRIPE_MONTHLY_TEST_SECRET_KEY);return env;}
function prerequisites(env){
 if(['LIVE_PAYMENTS_ENABLED','MONTHLY_SERVICE_CHECKOUT_ENABLED','MONTHLY_SERVICE_REVIEW_COMPLETE'].some(k=>env[k]==='true'))fail('SETUP_LIVE_LOCKS');
 const key=env.STRIPE_MONTHLY_TEST_SECRET_KEY;
 if(typeof key!=='string'||key==='')fail('SETUP_TEST_KEY_MISSING');
 if(key.includes('*')||key.includes('•'))fail('SETUP_TEST_KEY_MASKED');
 if(/^(?:sk|rk|pk)_live_/.test(key))fail('SETUP_TEST_KEY_MODE');
 if(!/^sk_test_[A-Za-z0-9_]{12,}$/.test(key))fail('SETUP_TEST_KEY_FORMAT');
 if(typeof env.SUPABASE_SERVICE_ROLE_KEY!=='string'||!env.SUPABASE_SERVICE_ROLE_KEY.trim())fail('SETUP_ROLE_KEY');
}
function ownerRow(row,expected){
 if(!row||row.id!==1||row.billing_mode!=='test'||!UUID.test(row.user_id||'')||!UUID.test(row.generation||'')||typeof row.enabled!=='boolean'||!row.configuration||typeof row.configuration!=='object'||Array.isArray(row.configuration))fail('SETUP_STATE');
 if(expected&&row.user_id!==expected)fail('SETUP_OWNER',403);
 return row;
}
function cipherKey(env,row){prerequisites(env);const salt=Buffer.from(row.user_id+':'+row.generation);return Buffer.from(crypto.hkdfSync('sha256',env.SUPABASE_SERVICE_ROLE_KEY.trim(),salt,'aeogeo-owner-monthly-test-signing-secret-v1',32));}
function encryptSecret(secret,env,row){
 if(typeof secret!=='string'||!/^whsec_[A-Za-z0-9_]{12,}$/.test(secret))fail('SETUP_RESPONSE');
 const iv=crypto.randomBytes(12),cipher=crypto.createCipheriv('aes-256-gcm',cipherKey(env,row),iv);cipher.setAAD(Buffer.from(HOOK+':'+row.user_id+':'+row.generation));
 const data=Buffer.concat([cipher.update(secret,'utf8'),cipher.final()]);return {v:1,iv:iv.toString('base64'),data:data.toString('base64'),tag:cipher.getAuthTag().toString('base64')};
}
function decryptSecret(encrypted,env,row){try{
 if(encrypted?.v!==1||!['iv','data','tag'].every(k=>typeof encrypted[k]==='string'&&/^[A-Za-z0-9+/]+={0,2}$/.test(encrypted[k])&&encrypted[k].length<2048))throw Error();
 const iv=Buffer.from(encrypted.iv,'base64'),tag=Buffer.from(encrypted.tag,'base64');if(iv.length!==12||tag.length!==16)throw Error();
 const decipher=crypto.createDecipheriv('aes-256-gcm',cipherKey(env,row),iv);decipher.setAAD(Buffer.from(HOOK+':'+row.user_id+':'+row.generation));decipher.setAuthTag(tag);
 const value=Buffer.concat([decipher.update(Buffer.from(encrypted.data,'base64')),decipher.final()]).toString('utf8');if(!/^whsec_[A-Za-z0-9_]{12,}$/.test(value))throw Error();return value;
 }catch{fail('SETUP_CRYPTO');}}
function completeConfig(row){const c=row.configuration;return row.enabled===true&&/^acct_[A-Za-z0-9_]+$/.test(c.account_id||'')&&/^bpc_[A-Za-z0-9_]+$/.test(c.portal_id||'')&&/^we_[A-Za-z0-9_]+$/.test(c.webhook_id||'')&&Object.keys(SERVICES).every(s=>/^price_[A-Za-z0-9_]+$/.test(c.prices?.[s]||''))&&new Set(Object.values(c.prices||{})).size===3&&c.encrypted_secret;}
function hydratedEnv(source,row){ownerRow(row);const env=baseEnv(source);prerequisites(env);if(!completeConfig(row))fail('SETUP_STATE');
 env.OWNER_MONTHLY_TEST_ENABLED='true';env.STRIPE_MONTHLY_TEST_PORTAL_CONFIGURATION_ID=row.configuration.portal_id;env.STRIPE_MONTHLY_TEST_WEBHOOK_SECRET=decryptSecret(row.configuration.encrypted_secret,env,row);
 for(const [slug,s]of Object.entries(SERVICES)){if(row.configuration.prices[slug]===s.livePrice)fail('SETUP_MODE');env[s.testEnv]=row.configuration.prices[slug];}return env;
}
function safeProgress(row){return {configured:!!completeConfig(row),prices:Object.fromEntries(Object.keys(SERVICES).filter(s=>/^price_[A-Za-z0-9_]+$/.test(row.configuration.prices?.[s]||'')).map(s=>[s,row.configuration.prices[s]])),portalConfigured:/^bpc_[A-Za-z0-9_]+$/.test(row.configuration.portal_id||''),webhookConfigured:/^we_[A-Za-z0-9_]+$/.test(row.configuration.webhook_id||'')};}
function makeStore(db){return {
 async read(uid){let rows;try{rows=await db(TABLE);}catch{fail('SETUP_STORAGE');}if(!Array.isArray(rows)||rows.length>1)fail('SETUP_STORAGE');return rows[0]?ownerRow(rows[0],uid):null;},
 async action(action,uid,lock,config){let row;try{row=await db('rpc/geo_owner_monthly_test_setup',{method:'POST',body:{p_action:action,p_user:uid,p_lock:lock,p_config:config||null}});}catch{fail('SETUP_STORAGE');}if(row?.allowed!==true)fail(action==='claim'?'SETUP_BUSY':'SETUP_LOCK',409);return action==='release'?null:ownerRow(row,uid);}
};}
function liveIn(value){return value&&typeof value==='object'&&(value.livemode===true||Object.values(value).some(liveIn));}
function provisioningStripe(env,fetcher){prerequisites(env);let requests=0;return async(resource,{method='GET',data={},idempotency}={})=>{
 if(++requests>24)fail('SETUP_PAGINATION');
 if(typeof resource!=='string'||resource.startsWith('/')||resource.includes('..')||/[\\#]/.test(resource))fail('SETUP_SCOPE');
 const url=new URL('https://api.stripe.com/v1/'+resource),p=url.pathname.slice(4);
 const allowedGet=/^(?:account|products(?:\/prod_[A-Za-z0-9_]+)?|prices(?:\/price_[A-Za-z0-9_]+)?|billing_portal\/configurations(?:\/bpc_[A-Za-z0-9_]+)?|webhook_endpoints(?:\/we_[A-Za-z0-9_]+)?)$/.test(p);
 const allowedPost=['products','prices','billing_portal/configurations','webhook_endpoints'].includes(p);
 if(url.origin!=='https://api.stripe.com'||method==='GET'&&!allowedGet||method==='POST'&&!allowedPost||!['GET','POST'].includes(method))fail('SETUP_SCOPE');
 if(method==='POST'){
  if(!/^aeogeo-test-setup-v1-[A-Za-z0-9_-]+$/.test(idempotency||''))fail('SETUP_SCOPE');
  if(p==='products'&&!Object.values(SERVICES).some(s=>s.name===data.name))fail('SETUP_SCOPE');
  if(p==='prices'&&(!Object.values(SERVICES).some(s=>s.amount===data.unit_amount)||data.currency!=='usd'||data['recurring[interval]']!=='month'||data['recurring[interval_count]']!==1))fail('SETUP_SCOPE');
  if(p==='billing_portal/configurations'&&(data.default_return_url!==RETURN||data['features[subscription_cancel][mode]']!=='at_period_end'||data['features[subscription_cancel][proration_behavior]']!=='none'||data['features[subscription_update][enabled]']!==false))fail('SETUP_SCOPE');
  if(p==='webhook_endpoints'&&(data.url!==HOOK||data.api_version!==VERSION||!EVENTS.every((type,i)=>data['enabled_events['+i+']']===type)||Object.keys(data).filter(k=>k.startsWith('enabled_events[')).length!==EVENTS.length))fail('SETUP_SCOPE');
 }
 const form=new URLSearchParams();for(const [k,v]of Object.entries(data))if(v!==undefined&&v!==null)form.set(k,String(v));
 let r,body;try{r=await fetcher(url.href,{method,redirect:'error',headers:{Authorization:'Bearer '+env.STRIPE_MONTHLY_TEST_SECRET_KEY,'Stripe-Version':VERSION,...(method==='POST'?{'Content-Type':'application/x-www-form-urlencoded','Idempotency-Key':idempotency}:{})},body:method==='POST'?form.toString():undefined,signal:AbortSignal.timeout(12000)});}catch{fail('SETUP_NETWORK');}
 if(!r.ok)fail(({401:'SETUP_STRIPE_AUTH',403:'SETUP_STRIPE_PERMISSION',429:'SETUP_STRIPE_BUSY'})[r.status]||'SETUP_STRIPE_REQUEST');
 try{body=await r.json();}catch{fail('SETUP_RESPONSE');}if(!body||typeof body!=='object'||Array.isArray(body)||body.error)fail('SETUP_RESPONSE');if(liveIn(body))fail('SETUP_MODE');return body;
};}
async function listAll(stripe,resource,query={}){let after,items=[];for(let page=0;page<10;page++){
 const q=new URLSearchParams({...query,limit:'100',...(after?{starting_after:after}:{})}),result=await stripe(resource+'?'+q.toString());
 if(!Array.isArray(result.data)||typeof result.has_more!=='boolean')fail('SETUP_RESPONSE');items.push(...result.data);
 if(!result.has_more)return items;const id=result.data.at(-1)?.id;if(typeof id!=='string'||!/^[A-Za-z0-9_]+$/.test(id)||id===after)fail('SETUP_PAGINATION');after=id;
 }fail('SETUP_PAGINATION');}
function priceOK(p,service){return p?.livemode===false&&p.active===true&&p.type==='recurring'&&p.currency==='usd'&&p.unit_amount===service.amount&&p.recurring?.interval==='month'&&p.recurring.interval_count===1&&/^price_[A-Za-z0-9_]+$/.test(p.id||'');}
const own=(obj,row)=>obj?.metadata?.setup_kind===KIND&&obj.metadata.user_id===row.user_id&&obj.metadata.generation===row.generation;
function metadata(row,service){return {'metadata[setup_kind]':KIND,'metadata[user_id]':row.user_id,'metadata[generation]':row.generation,...(service?{'metadata[service]':service}:{})};}
const idem=(row,part)=>'aeogeo-test-setup-v1-'+row.user_id+'-'+row.generation+'-'+part;
async function ensurePrice(stripe,row,slug){const s=SERVICES[slug],cfg=row.configuration;
 if(cfg.prices?.[slug]){const p=await stripe('prices/'+cfg.prices[slug]);if(!priceOK(p,s))fail('SETUP_STATE');return p.id;}
 const products=(await listAll(stripe,'products',{active:'true'})).filter(p=>p.livemode===false&&p.active===true&&p.name===s.name&&/^prod_[A-Za-z0-9_]+$/.test(p.id||''));
 let product;
 for(const p of products){const match=(await listAll(stripe,'prices',{product:p.id,active:'true'})).find(price=>priceOK(price,s));if(match)return match.id;if(!product)product=p;}
 if(!product)product=await stripe('products',{method:'POST',idempotency:idem(row,'product-'+slug),data:{name:s.name,...metadata(row,slug)}});
 if(product.livemode!==false||product.active!==true||!/^prod_[A-Za-z0-9_]+$/.test(product.id||''))fail('SETUP_MODE');
 const price=await stripe('prices',{method:'POST',idempotency:idem(row,'price-'+slug),data:{product:product.id,unit_amount:s.amount,currency:'usd','recurring[interval]':'month','recurring[interval_count]':1,...metadata(row,slug)}});
 if(!priceOK(price,s))fail('SETUP_RESPONSE');return price.id;
}
async function ensurePortal(stripe,row){let c;
 if(row.configuration.portal_id)c=await stripe('billing_portal/configurations/'+row.configuration.portal_id);
 else c=(await listAll(stripe,'billing_portal/configurations',{active:'true'})).find(p=>own(p,row));
 if(!c)c=await stripe('billing_portal/configurations',{method:'POST',idempotency:idem(row,'portal'),data:{default_return_url:RETURN,'business_profile[headline]':'AEOGEO TEST monthly service billing','business_profile[privacy_policy_url]':SITE+'/privacy-policy','business_profile[terms_of_service_url]':SITE+'/terms-of-service','features[invoice_history][enabled]':true,'features[payment_method_update][enabled]':true,'features[subscription_cancel][enabled]':true,'features[subscription_cancel][mode]':'at_period_end','features[subscription_cancel][proration_behavior]':'none','features[subscription_update][enabled]':false,...metadata(row)}});
 if(!/^bpc_[A-Za-z0-9_]+$/.test(c.id||'')||!own(c,row))fail('SETUP_RESPONSE');try{validatePortalConfiguration(c,false);}catch{fail('SETUP_PORTAL_POLICY');}return c.id;
}
function webhookOK(e,row){return e?.livemode===false&&/^we_[A-Za-z0-9_]+$/.test(e.id||'')&&e.url===HOOK&&e.api_version===VERSION&&e.status==='enabled'&&Array.isArray(e.enabled_events)&&e.enabled_events.length===EVENTS.length&&EVENTS.every(t=>e.enabled_events.includes(t))&&own(e,row);}
async function ensureWebhook(stripe,row,env,store,lock,now){
 if(row.configuration.encrypted_secret){const e=await stripe('webhook_endpoints/'+row.configuration.webhook_id);if(!webhookOK(e,row))fail('SETUP_STATE');decryptSecret(row.configuration.encrypted_secret,env,row);return row;}
 const existing=(await listAll(stripe,'webhook_endpoints')).filter(e=>own(e,row));if(existing.length>1)fail('SETUP_WEBHOOK_RECOVERY');
 const attempt=row.configuration.webhook_attempt;
 if(existing.length&&!attempt)fail('SETUP_WEBHOOK_RECOVERY');
 if(attempt&&(!Number.isSafeInteger(attempt.started)||now()/1000-attempt.started>23*3600))fail('SETUP_WEBHOOK_RECOVERY');
 if(!attempt){row.configuration.webhook_attempt={started:Math.floor(now()/1000)};row=await store.action('save',row.user_id,lock,row.configuration);}
 if(existing.length&&(!webhookOK(existing[0],row)||existing[0].created<row.configuration.webhook_attempt.started-5))fail('SETUP_WEBHOOK_RECOVERY');
 const events=Object.fromEntries(EVENTS.map((t,i)=>['enabled_events['+i+']',t]));
 const hook=await stripe('webhook_endpoints',{method:'POST',idempotency:idem(row,'webhook'),data:{url:HOOK,api_version:VERSION,description:'Owner-only AEOGEO monthly service TEST events',...events,...metadata(row)}});
 if(!webhookOK(hook,row))fail('SETUP_RESPONSE');if(existing[0]&&existing[0].id!==hook.id)fail('SETUP_WEBHOOK_RECOVERY');
 row.configuration.webhook_id=hook.id;row.configuration.encrypted_secret=encryptSecret(hook.secret,env,row);delete row.configuration.webhook_attempt;
 return row;
}
function makeSetup({env=process.env,db,user,fetcher=globalThis.fetch,now=Date.now}){const store=makeStore(db);
 return async event=>{let actor,lock,releaseOnFailure=false;try{
  if(!['GET','POST'].includes(event.httpMethod))fail('SETUP_METHOD',405);
  const origin=Object.entries(event.headers||{}).find(([k])=>k.toLowerCase()==='origin')?.[1];if(origin&&origin!==SITE)fail('SETUP_ORIGIN',403);
  try{actor=await user(event);}catch{fail('SETUP_AUTH',401);}if(!isOwner(actor))fail('SETUP_OWNER',403);
  const base=baseEnv(env);prerequisites(base);
  if(event.httpMethod==='GET'){const row=await store.read(actor.id);return response(200,{storageReady:true,...(row?safeProgress(row):{configured:false,prices:{},portalConfigured:false,webhookConfigured:false})});}
  if(typeof event.body!=='string'||event.body.length>8192)fail('SETUP_REQUEST',400);let body;try{body=JSON.parse(event.body);}catch{fail('SETUP_REQUEST',400);}
  if(!body||typeof body!=='object'||Array.isArray(body)||Object.keys(body).some(k=>!['step','lock','service'].includes(k))||!['begin','price','portal','webhook'].includes(body.step))fail('SETUP_REQUEST',400);
  const stripe=provisioningStripe(base,fetcher);let row;
  if(body.step==='begin'){
   lock=crypto.randomUUID();row=await store.action('claim',actor.id,lock);releaseOnFailure=true;
   const account=await stripe('account');if(!/^acct_[A-Za-z0-9_]+$/.test(account.id||''))fail('SETUP_RESPONSE');if(row.configuration.account_id&&row.configuration.account_id!==account.id)fail('SETUP_ACCOUNT_CHANGED');
   if(completeConfig(row)){hydratedEnv(base,row);await store.action('release',actor.id,lock);releaseOnFailure=false;return response(200,{ready:true,...safeProgress(row)});}
   row.configuration.account_id=account.id;row.configuration.prices=row.configuration.prices||{};row=await store.action('save',actor.id,lock,row.configuration);
  }else{
   if(!UUID.test(body.lock||''))fail('SETUP_REQUEST',400);lock=body.lock;row=await store.read(actor.id);
   if(!row||row.lock_id!==lock||Date.parse(row.lock_until||'')<=now())fail('SETUP_LOCK',409);releaseOnFailure=true;
   if(!/^acct_[A-Za-z0-9_]+$/.test(row.configuration.account_id||''))fail('SETUP_STATE');
   if(body.step==='price'){
    if(!Object.hasOwn(SERVICES,body.service||''))fail('SETUP_REQUEST',400);
    row.configuration.prices={...(row.configuration.prices||{}),[body.service]:await ensurePrice(stripe,row,body.service)};
   }else if(body.step==='portal'){
    if(!Object.keys(SERVICES).every(s=>/^price_[A-Za-z0-9_]+$/.test(row.configuration.prices?.[s]||'')))fail('SETUP_STATE');row.configuration.portal_id=await ensurePortal(stripe,row);
   }else{
    if(!row.configuration.portal_id||!Object.keys(SERVICES).every(s=>row.configuration.prices?.[s]))fail('SETUP_STATE');
    row=await ensureWebhook(stripe,row,base,store,lock,now);
   }
   row=await store.action(body.step==='webhook'?'complete':'save',actor.id,lock,row.configuration);
  }
  releaseOnFailure=false;return response(200,{ready:!!completeConfig(row),...(row.enabled?{}:{lock}),...safeProgress(row)});
 }catch(e){if(releaseOnFailure&&actor?.id&&UUID.test(lock||''))try{await store.action('release',actor.id,lock);}catch{}return errorResponse(e);}};
}
function automaticRuntime({env=process.env,db,user,makeBilling,fetcher=globalThis.fetch,now=Date.now}){const store=makeStore(db);return {
 async handler(event){try{
  let actor;try{actor=await user(event);}catch{fail('SETUP_AUTH',401);}if(!isOwner(actor))fail('SETUP_OWNER',403);
  const row=await store.read(actor.id);
  if(!row||!completeConfig(row)){
   if(event.httpMethod==='GET'&&event.queryStringParameters?.preflight==='1')return response(200,{ready:false,setupNeeded:true,configuration:[{id:'automatic_setup',ok:false}],checks:[]});fail('SETUP_STATE');
  }
  const {makeRuntime}=require('./owner-monthly-test');return makeRuntime({env:hydratedEnv(env,row),db,user:async()=>actor,makeBilling,fetcher,now}).handler(event);
 }catch(e){return errorResponse(e);}},
 async webhook(event){try{
  if(event.httpMethod!=='POST')fail('SETUP_METHOD',405);if(typeof event.body!=='string'||event.body.length>2097152)fail('SETUP_REQUEST',400);
  // One fixed service-role configuration read is required to obtain the encrypted TEST signing secret.
  // No Stripe call or billing-ledger access occurs before the delegated signature and mode checks.
  const row=await store.read();if(!row||!completeConfig(row))fail('SETUP_STATE');
  const {makeRuntime}=require('./owner-monthly-test');return makeRuntime({env:hydratedEnv(env,row),db,user,makeBilling,fetcher,now}).webhook(event);
 }catch(e){const result=errorResponse(e);if(result.statusCode===503)result.statusCode=500;return result;}}
};}
function configuredSetup(){const {db,user}=require('./db');return makeSetup({db,user});}
function configuredRuntime(){const {db,user}=require('./db');const {makeMonthlyServiceBilling}=require('./monthly-service-billing');return automaticRuntime({db,user,makeBilling:makeMonthlyServiceBilling});}
module.exports={makeSetup,automaticRuntime,configuredSetup,configuredRuntime,baseEnv,hydratedEnv,encryptSecret,decryptSecret,provisioningStripe,completeConfig,EVENTS,HOOK,RETURN};
