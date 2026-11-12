'use strict';
// Guest services only. Stripe is the financial record; no auth.users or audit writes.
const crypto = require('node:crypto');
const {requireStripeCredential} = require('./stripe-credential');
const {validatePortalConfiguration} = require('./portal-policy');
const KIND = 'aeogeo_guest_service_v1';
const COOKIE = '__Host-aeogeo-service-v1';
// Extra per-instance abuse throttle. Not a claim of distributed platform rate limiting.
const attempts = new Map();
const UUID = /^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/i;
const SERVICES = Object.freeze({
 'knowledge-base': {amount:150000, price:'price_1UVxlCBIJX5f6Wmhv8rYJG3w', test:'STRIPE_PRICE_KNOWLEDGE_BASE_TEST', monthly:false},
 'ai-visibility-starter': {amount:34900, price:'price_1Ub0dcBIJX5f6WmhHrZin7Ah', test:'STRIPE_PRICE_AI_VISIBILITY_STARTER_TEST', monthly:true},
 'ai-search-growth': {amount:64900, price:'price_1Ub0egBIJX5f6WmhUficfDCI', test:'STRIPE_PRICE_AI_SEARCH_GROWTH_TEST', monthly:true},
 'ai-search-authority': {amount:99900, price:'price_1UVwwcBIJX5f6WmhWshWzm8O', test:'STRIPE_PRICE_AI_SEARCH_AUTHORITY_TEST', monthly:true}
});
const fail = (status,message) => Object.assign(new Error(message),{status});
const id = x => typeof x === 'string' ? x : x?.id;
const encoded = x => encodeURIComponent(x);
const identifier = (x,prefix) => typeof x === 'string' && new RegExp('^'+prefix+'[A-Za-z0-9_]{1,200}$').test(x);
function destination(value,host) {
 let u; try {u=new URL(value);} catch {throw fail(503,'The secure billing destination is unavailable. Please contact us.');}
 if(u.protocol!=='https:'||u.hostname!==host||u.username||u.password||u.port)throw fail(503,'The secure billing destination is unavailable. Please contact us.');
 return u.href;
}
function createGuestServiceCheckout({stripe,env=process.env,now=()=>Date.now(),uuid=()=>crypto.randomUUID()}={}) {
 const credential=()=>requireStripeCredential(env);
 const live=()=>credential().mode==='live';
 const site=()=>{let u;try{u=new URL(env.PUBLIC_SITE_URL||env.URL||'');}catch{throw fail(503,'The service checkout address is unavailable.');}if(u.protocol!=='https:'||u.hostname!=='aeogeosearch.com'||u.username||u.password||u.port)throw fail(503,'The service checkout address requires review.');return u.origin;};
 const selected=name=>{if(!Object.hasOwn(SERVICES,name||''))throw fail(400,'Choose a service from the pricing page.');return SERVICES[name];};
 const priceFor=name=>{const s=selected(name),price=live()?s.price:env[s.test];if(!identifier(price,'price_'))throw fail(503,'This service price is not configured for the current payment mode.');return price;};
 const saleOpen=()=>env.GUEST_SERVICE_CHECKOUT_ENABLED==='true'&&(!live()||env.LIVE_PAYMENTS_ENABLED==='true');
 const secret=()=>crypto.createHmac('sha256',credential().key).update('AEOGEO guest-service cookie v1').digest();
 const sign=text=>crypto.createHmac('sha256',secret()).update(text).digest('base64url');
 function pack(state){const p=Buffer.from(JSON.stringify(state)).toString('base64url');return p+'.'+sign(p);}
 function unpack(value){try{if(typeof value!=='string'||value.length>3800)return null;const [p,s,extra]=value.split('.');if(extra||!p||!s)return null;const a=Buffer.from(s,'base64url'),b=Buffer.from(sign(p),'base64url');if(a.length!==b.length||!crypto.timingSafeEqual(a,b))return null;const state=JSON.parse(Buffer.from(p,'base64url'));if(state.v!==1||state.mode!==credential().mode||state.exp<now()/1000||!UUID.test(state.guest)||!UUID.test(state.csrf)||!state.slots||typeof state.slots!=='object')return null;return state;}catch{return null;}}
 function read(event){const h=event.headers||{},cookie=h.cookie||h.Cookie||'';return unpack(cookie.split(';').map(x=>x.trim()).find(x=>x.startsWith(COOKIE+'='))?.slice(COOKIE.length+1));}
 const fresh=()=>({v:1,mode:credential().mode,exp:Math.floor(now()/1000)+31536000,guest:uuid(),csrf:uuid(),slots:{}});
 const group=name=>selected(name).monthly?'monthly':'knowledge-base';
 function slot(state,name){const key=group(name);if(!state.slots[key])state.slots[key]={attempt:uuid(),service:name,expires:Math.floor(now()/1000)+1800};return state.slots[key];}
 function reply(status,body,state){return {statusCode:status,headers:{'Content-Type':'application/json','Cache-Control':'no-store, private','Referrer-Policy':'no-referrer','X-Content-Type-Options':'nosniff',...(state?{'Set-Cookie':COOKIE+'='+pack(state)+'; Path=/; Secure; HttpOnly; SameSite=Lax; Max-Age=31536000'}:{})},body:JSON.stringify(body)};}
 function csrf(event,body,state){const headers=event.headers||{};if((headers.origin||headers.Origin)!==site()||!String(headers['content-type']||headers['Content-Type']||'').toLowerCase().startsWith('application/json'))throw fail(403,'Refresh this checkout page before continuing.');if(!state||typeof body.csrf!=='string'||body.csrf!==state.csrf)throw fail(403,'This checkout browser session has expired. Refresh the page. No AEOGEO account is required.');}
 function meta(state,s,name){return {purchase_kind:KIND,service_id:name,guest_id:state.guest,attempt_id:s.attempt,site:'aeogeosearch.com'};}
 function metadata(object,expected){const m=object?.metadata||{};return Object.entries(expected).every(([k,v])=>m[k]===v);}
 async function price(name){const p=await stripe('prices/'+encoded(priceFor(name))),s=selected(name);if(p.id!==priceFor(name)||p.active!==true||p.livemode!==live()||p.type!==(s.monthly?'recurring':'one_time')||p.currency!=='usd'||p.unit_amount!==s.amount||p.billing_scheme!=='per_unit'||(s.monthly&&(p.recurring?.interval!=='month'||p.recurring?.interval_count!==1||p.recurring?.usage_type!=='licensed')))throw fail(503,'The service price requires review. No checkout was opened.');return p;}
 async function portalConfiguration(){let c;if(env.STRIPE_SERVICE_PORTAL_CONFIGURATION_ID)c=await stripe('billing_portal/configurations/'+encoded(env.STRIPE_SERVICE_PORTAL_CONFIGURATION_ID));else{const list=await stripe('billing_portal/configurations?is_default=true&active=true&limit=10');if(list.has_more)throw fail(503,'The service billing configuration requires review.');c=list.data?.find(x=>x.active&&x.is_default);}const configuration=validatePortalConfiguration(c,live());const defaultReturn=c.default_return_url||c.business_profile?.default_return_url;if(defaultReturn&&new URL(defaultReturn).origin!==site())throw fail(503,'The service billing configuration is for a different website.');return {configuration,loginUrl:c.login_page?.enabled===true?destination(c.login_page.url,'billing.stripe.com'):null};}
 async function session(state,name,sessionId){
  if(!identifier(sessionId,'cs_'))throw fail(400,'The checkout reference is invalid.');
  const s=slot(state,name),c=await stripe('checkout/sessions/'+encoded(sessionId)),service=selected(name);
  if(!metadata(c,meta(state,s,name))||c.livemode!==live()||c.mode!==(service.monthly?'subscription':'payment'))throw fail(403,'This payment reference does not belong to this checkout browser. Use the original browser or contact us with your Stripe receipt. No AEOGEO account is required.');
  if(c.currency!=='usd'||c.amount_total!==service.amount)throw fail(409,'The checkout amount requires review. Please contact us.');
  const lines=await stripe('checkout/sessions/'+encoded(sessionId)+'/line_items?limit=2');
  if(lines.has_more||lines.data?.length!==1||lines.data[0].quantity!==1||id(lines.data[0].price)!==priceFor(name))throw fail(409,'The checkout items require review. Please contact us.');
  return c;
 }
 async function subscription(c,state,name){
  const subId=id(c.subscription);if(!identifier(subId,'sub_'))throw fail(409,'The monthly service billing record is not ready.');
  const sub=await stripe('subscriptions/'+encoded(subId)),items=sub.items;
  if(sub.livemode!==live()||id(sub.customer)!==id(c.customer)||!metadata(sub,meta(state,slot(state,name),name))||items?.has_more||items?.data?.length!==1||items.data[0].quantity!==1||id(items.data[0].price)!==priceFor(name))throw fail(409,'The monthly service billing record requires review. Please contact us.');
  return sub;
 }
 async function paymentStatus(piId,customer,amount,expectedMetadata){
  if(!identifier(piId,'pi_'))return 'pending';
  const pi=await stripe('payment_intents/'+encoded(piId)+'?expand%5B%5D=latest_charge');
  if(pi.id!==piId||pi.livemode!==live()||pi.status!=='succeeded'||pi.currency!=='usd'||pi.amount!==amount||pi.amount_received!==amount||id(pi.customer)!==customer||(expectedMetadata&&!metadata(pi,expectedMetadata)))return 'needs_attention';
  const charge=typeof pi.latest_charge==='object'?pi.latest_charge:identifier(pi.latest_charge,'ch_')?await stripe('charges/'+encoded(pi.latest_charge)):null;
  if(!charge||!identifier(charge.id,'ch_')||charge.livemode!==live()||!charge.paid||charge.status!=='succeeded'||charge.amount!==amount||charge.currency!=='usd'||id(charge.customer)!==customer||id(charge.payment_intent)!==pi.id)return 'needs_attention';
  if(charge.disputed||charge.dispute){
   const history=await stripe('disputes?charge='+encoded(charge.id)+'&limit=100');
   if(history.has_more||!history.data?.length||history.data.some(d=>id(d.charge)!==charge.id||d.livemode!==live()||!['won','warning_closed'].includes(d.status)))return 'disputed';
  }
  if(charge.refunded||charge.amount_refunded>0)return 'refund_review';
  return 'paid';
 }
 async function paid(c,state,name){
  const s=selected(name),out={paid:false,status:c.status==='expired'?'expired':c.payment_status==='paid'?'checking':'pending',hasBillingCustomer:s.monthly&&identifier(id(c.customer),'cus_')&&c.status==='complete'};
  if(c.status!=='complete'||c.payment_status!=='paid')return out;
  const customer=id(c.customer);if(!identifier(customer,'cus_'))throw fail(409,'The payment customer requires review.');
  let piId=id(c.payment_intent),sub;
  if(s.monthly){
   sub=await subscription(c,state,name);out.subscriptionStatus=sub.status;out.cancelAtPeriodEnd=sub.cancel_at_period_end===true;out.paidThrough=Number.isFinite(sub.current_period_end)?new Date(sub.current_period_end*1000).toISOString():null;
   if(!['active','trialing'].includes(sub.status)||sub.status==='trialing'||!sub.current_period_end||sub.current_period_end<=now()/1000)return {...out,status:'needs_attention'};
   // Verify the initial checkout invoice, not an unrelated later invoice.
   const invoiceId=id(c.invoice);if(!identifier(invoiceId,'in_'))return {...out,status:'pending'};
   const inv=await stripe('invoices/'+encoded(invoiceId));
   if(inv.livemode!==live()||inv.status!=='paid'||inv.paid!==true||inv.paid_out_of_band===true||inv.amount_paid!==s.amount||inv.currency!=='usd'||id(inv.customer)!==customer||id(inv.subscription)!==sub.id)return {...out,status:'needs_attention'};
   piId=id(inv.payment_intent);
  }
  const initialStatus=await paymentStatus(piId,customer,s.amount,s.monthly?null:meta(state,slot(state,name),name));
  if(initialStatus!=='paid')return {...out,status:initialStatus};
  if(s.monthly&&id(sub.latest_invoice)&&id(sub.latest_invoice)!==id(c.invoice)){
   const latestId=id(sub.latest_invoice);if(!identifier(latestId,'in_'))return {...out,status:'needs_attention'};
   const latest=await stripe('invoices/'+encoded(latestId));
   if(latest.livemode!==live()||latest.status!=='paid'||latest.paid!==true||latest.paid_out_of_band===true||latest.amount_paid!==s.amount||latest.currency!=='usd'||id(latest.customer)!==customer||id(latest.subscription)!==sub.id)return {...out,status:'needs_attention'};
   const currentStatus=await paymentStatus(id(latest.payment_intent),customer,s.amount,null);if(currentStatus!=='paid')return {...out,status:currentStatus};
  }
  return {...out,paid:true,status:'paid'};
 }
 const switchable=c=>c.status==='open'&&c.payment_status==='unpaid'&&!id(c.subscription)&&!id(c.payment_intent);
 async function existing(state,name){const s=slot(state,name);if(!s.session)return null;const actual=s.service,c=await session(state,actual,s.session);if(c.status==='expired'){state.slots[group(name)]={attempt:uuid(),service:name,expires:Math.floor(now()/1000)+1800};return null;}return {c,service:actual,result:await paid(c,state,actual)};}
 async function handler(event){
  try {
   if(!['GET','POST'].includes(event.httpMethod))return reply(405,{error:'GET or POST required.'});
   const query=event.queryStringParameters||{};let body={};
   if(event.httpMethod==='POST'){if(event.isBase64Encoded||typeof event.body!=='string'||event.body.length>4096)throw fail(400,'Invalid checkout request.');try{body=JSON.parse(event.body);}catch{throw fail(400,'Invalid checkout request.');}if(!body||typeof body!=='object'||Array.isArray(body))throw fail(400,'Invalid checkout request.');}
   const name=event.httpMethod==='GET'?query.service:body.service;selected(name);
   // A closed public page does not need a key, a user account, or an external request.
   if(event.httpMethod==='GET'&&env.GUEST_SERVICE_CHECKOUT_ENABLED!=='true'&&!env.STRIPE_SECRET_KEY&&!query.session_id&&!read(event))return reply(200,{checkoutOpen:false,paid:false,status:'closed',message:'Guest service checkout is being prepared. Please contact us for help. No payment has been taken.'});
   credential();site();let state=read(event);
   if(event.httpMethod==='GET'){
    if(query.session_id&&!state)throw fail(403,'Use the browser where you opened Stripe Checkout, or contact us with your Stripe receipt. No AEOGEO account is required.');
    state=state||fresh();slot(state,name);let result;
    if(query.session_id){const c=await session(state,name,query.session_id);slot(state,name).session=c.id;slot(state,name).service=name;result=await paid(c,state,name);}
    else{const prior=await existing(state,name);if(prior)result={...prior.result,existingService:prior.service,canSwitchPlan:selected(name).monthly&&prior.service!==name&&switchable(prior.c),sessionId:prior.c.id,checkoutUrl:prior.c.status==='open'?destination(prior.c.url,'checkout.stripe.com'):null};}
    const billing=selected(name).monthly?await portalConfiguration():null;
    return reply(200,{checkoutOpen:saleOpen(),planSwitchSupported:true,mode:credential().mode,csrf:state.csrf,paid:false,status:'ready',...result,billingLoginUrl:billing?.loginUrl||null},state);
   }
   csrf(event,body,state);const action=body.action||'checkout';if(!['checkout','portal','switch'].includes(action))throw fail(400,'Invalid checkout action.');
   if(action==='portal'){
    if(!selected(name).monthly)throw fail(400,'This one-time purchase has no monthly subscription.');
    const s=state.slots.monthly;if(!s?.session)throw fail(409,'Use your Stripe billing link or contact us for monthly billing help.');
    const c=await session(state,s.service,s.session);await subscription(c,state,s.service);
    if(!identifier(id(c.customer),'cus_')||c.status!=='complete')throw fail(409,'There is no completed monthly checkout to manage in this browser.');
    const {configuration}=await portalConfiguration();const portal=await stripe('billing_portal/sessions',{method:'POST',data:{customer:id(c.customer),configuration,return_url:site()+'/service-checkout/?service='+encoded(s.service)+'&manage=1'}});
    return reply(200,{url:destination(portal.url,'billing.stripe.com')},state);
   }
   if(!saleOpen())throw fail(503,'Guest service checkout is not open yet. Please contact us for help. No payment has been taken.');
   if(!live()){const email=String(body.testEmail||'').trim().toLowerCase(),allowed=(env.BILLING_TEST_EMAILS||'').split(',').map(x=>x.trim().toLowerCase()).filter(Boolean);if(!email||!allowed.includes(email))throw fail(403,'Test checkout is restricted to the approved test email.');}
   const ip=event.headers?.['x-nf-client-connection-ip'];
   if(ip){const key=crypto.createHash('sha256').update(ip).digest('hex'),window=Math.floor(now()/60000),entry=attempts.get(key);if(entry?.window===window&&entry.count>=20)throw fail(429,'Too many checkout attempts. Please wait one minute, then try again.');if(!entry||entry.window!==window){if(attempts.size>=2000)attempts.delete(attempts.keys().next().value);attempts.set(key,{window,count:1});}else entry.count++;}
   const prior=await existing(state,name);
   if(action==='switch'){
    if(!selected(name).monthly)throw fail(400,'Only unfinished monthly service checkouts can be switched.');
    if(prior){
     if(prior.service===name)throw fail(409,'This package is already selected. Continue to Stripe Checkout.');
     if(!switchable(prior.c))throw fail(409,'This checkout is no longer unpaid and open. Refresh to check its payment status or use billing management. No subscription was changed.');
     // Validate the requested price and portal before closing the old unpaid session.
     await price(name);await portalConfiguration();
     const closed=await stripe('checkout/sessions/'+encoded(prior.c.id)+'/expire',{method:'POST',idempotency:'guest-service-switch:'+prior.c.id});
     if(closed.id!==prior.c.id||!metadata(closed,meta(state,slot(state,name),prior.service))||closed.livemode!==live()||closed.status!=='expired'||closed.payment_status!=='unpaid'||id(closed.subscription)||id(closed.payment_intent))throw fail(409,'The previous checkout could not be confirmed closed. Refresh before continuing. No subscription was changed.');
    }
    state.slots.monthly={attempt:uuid(),service:name,expires:Math.floor(now()/1000)+1800};
    return reply(200,{checkoutOpen:saleOpen(),planSwitchSupported:true,mode:credential().mode,csrf:state.csrf,paid:false,status:'ready',message:'Your package selection is updated. Continue to Stripe Checkout to review the selected monthly price before paying.'},state);
   }
   if(prior){if(prior.service!==name)throw fail(409,'There is already a monthly service checkout in this browser. Finish or manage it before choosing another plan. Contact us if you need a different plan.');if(prior.c.status==='open')return reply(200,{url:destination(prior.c.url,'checkout.stripe.com')},state);return reply(200,{...prior.result,existingPurchase:true},state);}
   await price(name);const service=selected(name);if(service.monthly)await portalConfiguration();
   let s=slot(state,name);if(!s.session&&s.expires<=now()/1000+60){state.slots[group(name)]={attempt:uuid(),service:name,expires:Math.floor(now()/1000)+1800};s=slot(state,name);}
   const metadataFields=meta(state,s,name),data={mode:service.monthly?'subscription':'payment','line_items[0][price]':priceFor(name),'line_items[0][quantity]':1,success_url:site()+'/service-checkout/?service='+encoded(name)+'&session_id={CHECKOUT_SESSION_ID}',cancel_url:site()+'/service-checkout/?service='+encoded(name)+'&canceled=1',billing_address_collection:'auto','payment_method_types[0]':'card',expires_at:s.expires};
   if(!service.monthly)data.customer_creation='always';
   if(!live())data.customer_email=String(body.testEmail).trim().toLowerCase();
   for(const [k,v]of Object.entries(metadataFields)){data['metadata['+k+']']=v;data[(service.monthly?'subscription_data':'payment_intent_data')+'[metadata]['+k+']']=v;}
   const c=await stripe('checkout/sessions',{method:'POST',data,idempotency:'guest-services-v1:'+credential().mode+':'+state.guest+':'+group(name)+':'+s.attempt});
   if(!identifier(c.id,'cs_')||!metadata(c,metadataFields)||c.livemode!==live()||c.mode!==data.mode||!['open','complete','expired'].includes(c.status)||c.amount_total!==service.amount||c.currency!=='usd')throw fail(503,'The checkout response requires review. No payment has been authorized by this website.');
   s.service=name;s.session=c.id;
   if(c.status!=='open'){const checked=await session(state,name,c.id);return reply(200,{...(await paid(checked,state,name)),existingPurchase:true},state);}
   return reply(200,{url:destination(c.url,'checkout.stripe.com')},state);
  } catch(err){return reply(Number.isInteger(err.status)?err.status:503,{error:Number.isInteger(err.status)?err.message:'Service billing is temporarily unavailable. Please retry or contact us. No project has started automatically.'});}
 }
 async function webhook(event){
  const object=event.data?.object;if(!object)return null;
  const modeLive=live();
  let record=object,sub=null;
  if(event.type.startsWith('invoice.')){const subId=id(object.subscription);if(!identifier(subId,'sub_'))return null;record=sub=await stripe('subscriptions/'+encoded(subId));}
  else if(event.type.startsWith('customer.subscription.'))sub=record;
  else if(event.type==='charge.refunded'||event.type.startsWith('charge.dispute.')){
   const charge=event.type==='charge.refunded'?object:await stripe('charges/'+encoded(id(object.charge)));
   const piId=id(charge.payment_intent);if(!identifier(piId,'pi_'))return null;
   record=await stripe('payment_intents/'+encoded(piId));
   if(record.metadata?.purchase_kind!==KIND||SERVICES[record.metadata?.service_id]?.monthly){const invoiceId=id(charge.invoice)||id(record.invoice);if(!identifier(invoiceId,'in_'))return null;const invoice=await stripe('invoices/'+encoded(invoiceId)),subId=id(invoice.subscription);if(!identifier(subId,'sub_'))return null;record=sub=await stripe('subscriptions/'+encoded(subId));}
  }
  if(record.metadata?.purchase_kind!==KIND)return null;
  if(event.livemode!==modeLive)throw fail(400,'Webhook payment mode mismatch.');
  const m=record.metadata;
  if(!Object.hasOwn(SERVICES,m.service_id||'')||!UUID.test(m.guest_id||'')||!UUID.test(m.attempt_id||'')||m.site!=='aeogeosearch.com'||record.livemode!==modeLive)throw fail(400,'Invalid guest service billing metadata.');
  // A dispute stops future renewal, never triggers a refund or automatic reinstatement.
  if((event.type==='charge.dispute.created'||(event.type==='charge.dispute.closed'&&!['won','warning_closed'].includes(object.status)))&&sub&&['active','trialing','past_due','unpaid','paused'].includes(sub.status)&&!sub.cancel_at_period_end)await stripe('subscriptions/'+encoded(sub.id),{method:'POST',data:{cancel_at_period_end:true},idempotency:'guest-service-dispute:'+event.id});
  // Guest events never enter legacy service auth or audit entitlement synchronization.
  // Fulfillment and refunds remain manual; Stripe retains orders, invoices and payment history.
  return {guestService:true,received:true};
 }
 return {handler,webhook};
}
function configuredGuestServiceCheckout(){const {stripe}=require('./stripe');return createGuestServiceCheckout({stripe});}
module.exports={createGuestServiceCheckout,configuredGuestServiceCheckout,SERVICES,KIND,COOKIE,destination};
