'use strict';
const {test} = require('node:test'), assert = require('node:assert/strict'), crypto = require('node:crypto'), fs = require('node:fs'), path = require('node:path');
const {makeBillingSync,disputeHold,refundReview} = require('../netlify/functions/lib/billing-sync');
const {billingReviewHandler} = require('../netlify/functions/lib/billing-review-handler');
const {PLANS,billingReady,billingAdmin,sandboxCheckout} = require('../netlify/functions/lib/plans');
const {UUID,reply} = require('../netlify/functions/lib/db');
const future = () => Math.floor(Date.now()/1000)+86400*20;
function syncFixture(options={}) {
 const uid=crypto.randomUUID(), end=future(), sid='sub_owned', customer='cus_owned';
 const invoice={id:'in_1',status:'paid',paid:true,subscription:sid,charge:{id:'ch_1'},lines:{data:[{type:'subscription',price:{id:'price_month'},period:{end}}]}};
 const sub={id:sid,metadata:{user_id:uid},customer,livemode:false,status:'active',start_date:Math.floor(Date.now()/1000)-86400,items:{data:[{price:{id:'price_month',currency:'usd',unit_amount:4900,recurring:{interval:'month',interval_count:1}}}]},latest_invoice:invoice,cancel_at_period_end:!!options.canceled};
 if(options.unpaid){sub.latest_invoice={...invoice,id:'in_new',paid:false,status:'open'};}
 if(options.badPrice)sub.items.data[0].price.unit_amount=1;
 if(options.wrongMode)sub.livemode=true;
 const charge={id:'ch_1',customer,invoice:'in_1',amount:4900,amount_refunded:options.refund?4900:0,currency:'usd',disputed:!!options.dispute};
 const dp={id:'dp_1',charge:'ch_1',status:options.dispute||'needs_response'};
 let cached=options.noCache?null:{user_id:uid,customer_id:options.unowned?'cus_other':customer,subscription_id:sid,plan:'starter',billing_mode:'test',last_paid_invoice_id:'in_1'};
 const snapshots=[], writes=[], seen=new Set();let lock=null, stripeReads=0, holds=options.knownHold?[{source_id:'dp_1'}]:[];
 const db=async(url,args={})=>{
  if(url.startsWith('geo_subscriptions?'))return cached?[cached]:[];
  if(url.startsWith('geo_checkout_sessions?'))return [{customer_id:options.unowned?'cus_other':customer,stripe_id:'cs_test_one',livemode:false,user_id:uid}];
  if(url.startsWith('geo_billing_holds?'))return holds;
  if(url==='rpc/geo_billing_lock'){if(lock)return false;lock=args.body.p_token;return true;}
  if(url==='rpc/geo_billing_unlock'){if(lock===args.body.p_token)lock=null;return null;}
  if(url==='rpc/geo_billing_apply'){
   const b=args.body;if(lock!==b.p_token)throw Error('Missing lease');if(seen.has(b.p_event))return false;
   seen.add(b.p_event);snapshots.push(b);cached={...cached,customer_id:b.p_customer,subscription_id:b.p_subscription,plan:b.p_plan,billing_mode:b.p_mode,last_paid_invoice_id:b.p_paid_invoice||cached?.last_paid_invoice_id};
   holds=b.p_holds.filter(h=>h.active).map(h=>({source_id:h.source_id}));return true;
  }
  throw Error('Unexpected DB '+url);
 };
 const stripe=async(url,args={})=>{
  if(args.method==='POST'){writes.push({url,args});if(url.startsWith('subscriptions/'))sub.cancel_at_period_end=true;return structuredClone(sub);}
  stripeReads++;
  if(url.startsWith('subscriptions/')){const s=structuredClone(sub);if(options.swapCustomer&&url.includes('?'))s.customer='cus_wrong';return s;}
  if(url==='charges/ch_1')return structuredClone(charge);
  if(url.startsWith('invoices/'))return structuredClone(invoice);
  if(url.startsWith('disputes?'))return {data:[structuredClone(dp)],has_more:false};
  if(url==='disputes/dp_1')return structuredClone(dp);
  if(url==='checkout/sessions/cs_test_one')return {client_reference_id:options.spoofSession?crypto.randomUUID():uid,customer,status:'complete',subscription:sid};
  throw Error('Unexpected Stripe '+url);
 };
 const sync=makeBillingSync({db,stripe,fromPrice:id=>id==='price_month'?{plan:'starter',interval:'month'}:null,PLANS,UUID,mode:()=> 'test'});
 return {sync,sub,charge,dp,invoice,snapshots,writes,uid,end,stripeReads:()=>stripeReads};
}

test('a paid invoice is reconciled from Stripe, not from a success URL',async()=>{
 const f=syncFixture();await f.sync.sync('sub_owned');assert.equal(f.snapshots.length,1);assert.equal(f.snapshots[0].p_paid_through,new Date(f.end*1000).toISOString());assert.equal(f.snapshots[0].p_mode,'test');assert.equal(f.writes.length,0);
});
test('owner manual-refund policy queues a refund without changing access or renewal',async()=>{
 const f=syncFixture({refund:true});await f.sync.event({id:'evt_refund',type:'charge.refunded',data:{object:{id:'ch_1',customer:'cus_owned',invoice:'in_1'}}});
 const s=f.snapshots[0];assert.equal(s.p_reviews.length,1);assert.equal(s.p_reviews[0].full_refund,true);assert.equal(s.p_holds.length,0);assert.equal(s.p_paid_through,new Date(f.end*1000).toISOString());assert.equal(f.writes.length,0);
});
test('open bank dispute pauses paid usage and stops renewal without issuing a refund',async()=>{
 const f=syncFixture({dispute:'needs_response'});await f.sync.event({id:'evt_dispute',type:'charge.dispute.created',data:{object:{id:'dp_1'}}});
 assert.equal(f.snapshots[0].p_holds[0].active,true);assert.equal(f.snapshots[0].p_holds[0].expires_at,null);assert.equal(f.snapshots[0].p_cancel_at_period_end,true);assert.equal(f.writes.length,1);assert.deepEqual(f.writes[0].args.data,{cancel_at_period_end:true});assert.equal(f.snapshots[0].p_reviews.length,0);
});
test('won dispute restores remaining paid time without restarting renewal',async()=>{
 const f=syncFixture({dispute:'won',canceled:true,knownHold:true});await f.sync.event({id:'evt_won',type:'charge.dispute.closed',data:{object:{id:'dp_1'}}});
 assert.equal(f.snapshots[0].p_holds[0].active,false);assert.equal(f.snapshots[0].p_cancel_at_period_end,true);assert.equal(f.writes.length,0);
});
test('lost dispute affects only its paid period; refund helper never creates an automatic access hold',()=>{
 const end=new Date(future()*1000).toISOString();assert.equal(disputeHold({id:'dp_x',status:'lost'},'sub_1',end).expires_at,end);
 assert.equal(disputeHold({id:'dp_x',status:'warning_closed'},'sub_1',end).active,false);
 assert.equal(refundReview({id:'ch_1',amount:4900,amount_refunded:0},'sub_1',end),null);
 assert.equal(refundReview({id:'ch_1',amount:4900,amount_refunded:500,currency:'usd'},'sub_1',end).full_refund,false);
});
test('unpaid renewal cannot extend paid-through time',async()=>{
 const f=syncFixture({unpaid:true});await f.sync.sync('sub_owned');assert.equal(f.snapshots[0].p_paid_through,null);assert.equal(f.snapshots[0].p_plan,'starter');
});
test('current state reconciliation is idempotent and overlapping updates use a fenced lease',async()=>{
 const f=syncFixture();await f.sync.sync('sub_owned',{eventId:'evt_repeat'});await f.sync.sync('sub_owned',{eventId:'evt_repeat'});assert.equal(f.snapshots.length,1);
 const g=syncFixture();const answers=await Promise.allSettled([g.sync.sync('sub_owned'),g.sync.sync('sub_owned')]);assert.equal(answers.filter(a=>a.status==='fulfilled').length,1);assert.equal(g.snapshots.length,1);
});
test('mode, price, and changed customer failures cannot grant access',async()=>{
 for(const options of [{wrongMode:true},{badPrice:true},{swapCustomer:true}]){const f=syncFixture(options);await assert.rejects(f.sync.sync('sub_owned'));assert.equal(f.snapshots.length,0);}
});
test('account recovery uses a persisted owned checkout and refuses spoofed ownership',async()=>{
 const f=syncFixture({noCache:true});await f.sync.account(f.uid);assert.equal(f.snapshots.length,1);
 const g=syncFixture({noCache:true,spoofSession:true});await assert.rejects(g.sync.account(g.uid));assert.equal(g.snapshots.length,0);
});
test('newer invoice event shape routes to current Stripe state and expiry grants nothing',async()=>{
 const f=syncFixture();await f.sync.event({id:'evt_new',type:'invoice.paid',data:{object:{parent:{subscription_details:{subscription:'sub_owned'}}}}});assert.equal(f.snapshots.length,1);
 const g=syncFixture();assert.equal((await g.sync.event({id:'evt_expired',type:'checkout.session.expired',data:{object:{id:'cs_test_one'}}})).ignored,true);assert.equal(g.stripeReads(),0);assert.equal(g.snapshots.length,0);
});

test('sandbox mode cannot charge live money or admit ordinary customers; admin is a separate permission',()=>{
 const keys=['BILLING_TEST_ENABLED','STRIPE_SECRET_KEY','BILLING_TEST_EMAILS','BILLING_ADMIN_EMAILS','BILLING_ENABLED','BILLING_REVIEW_COMPLETE','LIVE_PAYMENTS_ENABLED'];const old=Object.fromEntries(keys.map(k=>[k,process.env[k]]));
 try{
  Object.assign(process.env,{BILLING_TEST_ENABLED:'true',STRIPE_SECRET_KEY:'sk_test_unit_not_real',BILLING_TEST_EMAILS:'tester@example.com',BILLING_ADMIN_EMAILS:'owner@example.com',BILLING_ENABLED:'false',BILLING_REVIEW_COMPLETE:'false',LIVE_PAYMENTS_ENABLED:'false'});
  assert.equal(billingReady('starter','tester@example.com'),null);assert.equal(sandboxCheckout('starter','tester@example.com'),true);assert.match(billingReady('starter','customer@example.com'),/restricted/);assert.match(billingReady('agency','tester@example.com'),/Only Starter/);
  assert.equal(billingAdmin('tester@example.com'),false);assert.equal(billingAdmin('owner@example.com'),true);
  process.env.STRIPE_SECRET_KEY='sk_live_unit_not_real';assert.match(billingReady('starter','tester@example.com'),/Live charges remain blocked/);
 }finally{for(const k of keys){if(old[k]===undefined)delete process.env[k];else process.env[k]=old[k];}}
});

function reviewFixture(options={}){
 const uid=crypto.randomUUID(),admin=crypto.randomUUID(),periodEnd=new Date(future()*1000).toISOString();let locked=null;
 const r={id:'refund:ch_1',user_id:uid,billing_mode:'test',customer_id:'cus_owned',subscription_id:'sub_owned',charge_id:'ch_1',original_amount:4900,amount_refunded:options.partial?500:4900,currency:'usd',full_refund:!options.partial,period_end:periodEnd,state:'open'};
 const writes=[],decisions=[];let calls=0;
 const db=async(url,args={})=>{calls++;
  if(url.startsWith('geo_billing_reviews?'))return [structuredClone(r)];if(url.startsWith('geo_billing_holds?'))return [];
  if(url==='rpc/geo_billing_lock'){locked=args.body.p_token;return true;}if(url==='rpc/geo_billing_unlock'){locked=null;return null;}
  if(url==='rpc/geo_refund_review_decide'){assert.equal(args.body.p_token,locked);decisions.push(args.body);return true;}
  if(url.startsWith('geo_subscriptions?'))return [{subscription_id:options.otherSub?'sub_new':'sub_owned',customer_id:'cus_owned',billing_mode:'test'}];throw Error('Unexpected review DB '+url);
 };
 const stripe=async(url,args={})=>{
  if(args.method==='POST'){writes.push({url,args});return {};}
  if(url==='charges/ch_1')return {id:'ch_1',customer:options.wrongCustomer?'cus_other':'cus_owned',amount:4900,amount_refunded:r.amount_refunded};
  if(url.startsWith('refunds?'))return {data:[{status:options.pending?'pending':'succeeded',amount:r.amount_refunded}],has_more:false};
  if(url==='subscriptions/sub_owned')return {id:'sub_owned',metadata:{user_id:uid},customer:'cus_owned',status:'active',cancel_at_period_end:false};throw Error('Unexpected review Stripe '+url);
 };
 const handler=billingReviewHandler({db,user:async()=>({id:admin,email:'owner@example.com'}),reply,stripe,billingAdmin:()=>!options.unauthorized,billingMode:()=> 'test',invoiceForCharge:async()=>({subscription:'sub_owned',period_end:Date.parse(periodEnd)/1000})});
 return {request:(decision='keep')=>handler({httpMethod:'POST',body:JSON.stringify({id:r.id,decision,confirm:decision==='keep'?'KEEP':'END'})}),get:()=>handler({httpMethod:'GET'}),writes,decisions,calls:()=>calls};
}
test('refund review is server-authorized; testers and customers are not implicitly admins',async()=>{
 const f=reviewFixture({unauthorized:true});assert.equal((await f.get()).statusCode,403);assert.equal(f.calls(),0);
});
test('owner can keep access unchanged without any Stripe write',async()=>{
 const f=reviewFixture();assert.equal((await f.request('keep')).statusCode,200);assert.equal(f.writes.length,0);assert.equal(f.decisions[0].p_decision,'keep');
});
test('explicit settled-current-full-refund decision can stop renewal and end refunded access',async()=>{
 const f=reviewFixture();assert.equal((await f.request('revoke')).statusCode,200);assert.equal(f.writes.length,1);assert.deepEqual(f.writes[0].args.data,{cancel_at_period_end:true});assert.equal(f.decisions[0].p_decision,'revoke');
});
test('partial, pending, wrong-customer and replaced-subscription refunds cannot end current paid access',async()=>{
 for(const options of [{partial:true},{pending:true},{wrongCustomer:true},{otherSub:true}]){const f=reviewFixture(options);assert.notEqual((await f.request('revoke')).statusCode,200);assert.equal(f.decisions.length,0);assert.equal(f.writes.length,0);}
});

let PGlite;try{({PGlite}=require('@electric-sql/pglite'));}catch{}
test('new billing migrations preserve reports/free credits and enforce test/live separation, holds, manual review, fencing and private access',{skip:!PGlite&&'Install PostgreSQL test dependency'},async()=>{
 const db=new PGlite();try{
  await db.exec('create role anon;create role authenticated;create role service_role;create schema auth;create table auth.users(id uuid primary key);create function auth.uid() returns uuid language sql as $$ select null::uuid $$;');
  for(const name of ['01-accounts.sql','02-audit-limit.sql','03-product-and-billing.sql','04-checkout-locks.sql','05-billing-review-and-holds.sql'])await db.exec(fs.readFileSync(path.join(__dirname,'../database',name),'utf8'));
  const uid=crypto.randomUUID(),admin=crypto.randomUUID();await db.query('insert into auth.users(id) values($1),($2)',[uid,admin]);
  await db.query('update public.aeogeo_audit_accounts set free_audit_consumed_at=now() where user_id=$1',[uid]);
  const end=new Date(Date.now()+86400000*20).toISOString(),anchor=new Date(Date.now()-86400000).toISOString();
  const lease=async()=>{const token=crypto.randomUUID();assert.equal((await db.query('select public.geo_billing_lock($1,$2) as r',[uid,token])).rows[0].r,true);return token;};
  const apply=async(event,token,holds=[],reviews=[])=>db.query("select public.geo_billing_apply($1,$2,$3,'cus_owned','sub_owned','starter','active',$4,$5,'test','in_1',$6,$7,false)",[event,uid,token,anchor,end,JSON.stringify(holds),JSON.stringify(reviews)]);
  const unlock=token=>db.query('select public.geo_billing_unlock($1,$2)',[uid,token]);
  const reserve=async mode=>(await db.query("select public.geo_reserve_job($1,$2,'https://example.com/','example.com',75,$3) as r",[uid,crypto.randomUUID(),mode])).rows[0].r;
  let token=await lease();await apply('evt_paid',token);await unlock(token);
  assert.equal((await reserve('live')).reason,'subscription_required');
  const first=await reserve('test');assert.equal(first.allowed,true);assert.equal(first.page_limit,75);
  await db.query("select public.geo_finish_job($1,'{\"pageCount\":3}'::jsonb,null)",[first.id]);
  const hold={id:'dispute:dp_1',kind:'dispute',source_id:'dp_1',subscription_id:'sub_owned',active:true,expires_at:null,reason:'Bank dispute'};
  token=await lease();await apply('evt_hold',token,[hold]);await unlock(token);assert.equal((await reserve('test')).reason,'billing_hold');
  assert.equal((await db.query('select count(*)::int as n from public.geo_jobs where id=$1 and report is not null',[first.id])).rows[0].n,1);
  token=await lease();await apply('evt_won',token,[{...hold,active:false}]);await unlock(token);const second=await reserve('test');assert.equal(second.allowed,true);await db.query("select public.geo_finish_job($1,null,'fixture stop')",[second.id]);
  const review={id:'refund:ch_1',charge_id:'ch_1',subscription_id:'sub_owned',original_amount:4900,amount_refunded:4900,currency:'usd',full_refund:true,period_end:end};
  token=await lease();await apply('evt_refund',token,[],[review]);await unlock(token);const third=await reserve('test');assert.equal(third.allowed,true);await db.query("select public.geo_finish_job($1,null,'fixture stop')",[third.id]);
  assert.equal((await db.query("select count(*)::int as n from public.geo_billing_holds where kind='manual_refund' and active")).rows[0].n,0);
  token=await lease();assert.equal((await db.query("select public.geo_refund_review_decide('refund:ch_1',$1,'revoke',4900,$2) as r",[admin,token])).rows[0].r,true);await unlock(token);assert.equal((await reserve('test')).reason,'billing_hold');
  token=await lease();await apply('evt_repeat_refund',token,[],[review]);await unlock(token);assert.equal((await db.query("select state from public.geo_billing_reviews where id='refund:ch_1'")).rows[0].state,'revoked');
  token=await lease();await db.query("update public.geo_billing_locks set expires_at=now()-interval '1 second' where user_id=$1",[uid]);await assert.rejects(apply('evt_stale',token));await unlock(token);
  assert.ok((await db.query('select approved from public.geo_plan_catalog')).rows.every(r=>r.approved===false));
  assert.ok((await db.query('select free_audit_consumed_at from public.aeogeo_audit_accounts where user_id=$1',[uid])).rows[0].free_audit_consumed_at);
  for(const role of ['anon','authenticated']){
   const row=(await db.query("select has_table_privilege($1,'public.geo_billing_reviews','SELECT') as read,has_table_privilege($1,'public.geo_billing_holds','UPDATE') as write,has_function_privilege($1,'public.geo_refund_review_decide(text,uuid,text,bigint,uuid)','EXECUTE') as execute",[role])).rows[0];assert.deepEqual(row,{read:false,write:false,execute:false});
  }
 }finally{await db.close();}
});

test('new migrations can be reapplied and preserve preexisting report data and legacy five-argument free-audit calls',{skip:!PGlite&&'Install PostgreSQL test dependency'},async()=>{
 const db=new PGlite();try{
  await db.exec('create role anon;create role authenticated;create role service_role;create schema auth;create table auth.users(id uuid primary key);create function auth.uid() returns uuid language sql as $$ select null::uuid $$;');
  for(const n of ['01-accounts.sql','02-audit-limit.sql','03-product-and-billing.sql'])await db.exec(fs.readFileSync(path.join(__dirname,'../database',n),'utf8'));
  const uid=crypto.randomUUID(),free=crypto.randomUUID();await db.query('insert into auth.users(id) values($1),($2)',[uid,free]);
  const j=(await db.query("select public.geo_reserve_job($1,$2,'https://example.com/','example.com',25) as r",[uid,crypto.randomUUID()])).rows[0].r;
  await db.query("select public.geo_finish_job($1,'{\"pageCount\":2,\"sentinel\":\"preserve-this-report\"}',null)",[j.id]);
  const before=(await db.query('select free_audit_consumed_at from public.aeogeo_audit_accounts where user_id=$1',[uid])).rows[0];
  for(let pass=0;pass<2;pass++)for(const n of ['04-checkout-locks.sql','05-billing-review-and-holds.sql'])await db.exec(fs.readFileSync(path.join(__dirname,'../database',n),'utf8'));
  assert.deepEqual((await db.query('select free_audit_consumed_at from public.aeogeo_audit_accounts where user_id=$1',[uid])).rows[0],before);
  assert.equal((await db.query('select report from public.geo_jobs where id=$1',[j.id])).rows[0].report.sentinel,'preserve-this-report');
  const oldClient=(await db.query("select public.geo_reserve_job($1,$2,'https://example.com/','example.com',75) as r",[free,crypto.randomUUID()])).rows[0].r;
  assert.equal(oldClient.allowed,true);assert.equal(oldClient.page_limit,25);
 }finally{await db.close();}
});


test('Stripe metadata alone cannot grant access without a matching owned app customer',async()=>{
 const f=syncFixture({unowned:true});assert.equal((await f.sync.sync('sub_owned')).ignored,true);assert.equal(f.snapshots.length,0);assert.equal(f.writes.length,0);
});

test('a billing reconciliation failure cannot reserve or consume an audit',async()=>{
 const oldFetch=global.fetch,keys=['SUPABASE_URL','SUPABASE_SERVICE_ROLE_KEY','STRIPE_SECRET_KEY','BILLING_TEST_EMAILS'];const old=Object.fromEntries(keys.map(k=>[k,process.env[k]]));
 let reserved=false;const uid=crypto.randomUUID();
 try{
  Object.assign(process.env,{SUPABASE_URL:'https://fixture.supabase.co',SUPABASE_SERVICE_ROLE_KEY:'unit-only-not-a-key',STRIPE_SECRET_KEY:'sk_test_unit_not_real',BILLING_TEST_EMAILS:'owner@example.com'});
  global.fetch=async url=>{
   const s=String(url);if(s.includes('/auth/v1/user'))return Response.json({id:uid,email:'owner@example.com',email_confirmed_at:new Date().toISOString()});
   if(s.includes('rpc/geo_reserve_job')){reserved=true;throw Error('Must not reserve');}
   if(s.includes('/rest/v1/geo_subscriptions'))return Response.json([{subscription_id:'sub_1',billing_mode:'test'}]);
   if(s.startsWith('https://api.stripe.com/'))return Response.json({error:{code:'unit_transient'}},{status:503});
   throw Error('Unexpected request '+s);
  };
  const out=await require('../netlify/functions/start-audit').handler({httpMethod:'POST',headers:{authorization:'Bearer fixture'},body:JSON.stringify({url:'https://example.com/',pages:75,requestId:crypto.randomUUID()})});
  assert.equal(out.statusCode,503);assert.equal(reserved,false);
 }finally{global.fetch=oldFetch;for(const k of keys){if(old[k]===undefined)delete process.env[k];else process.env[k]=old[k];}}
});

test('background worker rejects non-hex signatures safely instead of throwing a length error',()=>{
 const {verifySignature}=require('../netlify/functions/lib/db');assert.equal(verifySignature(crypto.randomUUID(),String(Date.now()),'z'.repeat(64)),false);
});
