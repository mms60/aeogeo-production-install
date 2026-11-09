'use strict';
const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),vm=require('node:vm');
const {user,db}=require('../netlify/functions/lib/db');
const root=path.resolve(__dirname,'..'),adapter=fs.readFileSync(path.join(root,'scripts/audit-adapter.jsfrag'),'utf8');
const source=adapter.slice(adapter.indexOf('function auditAccessState('),adapter.indexOf('function syncAuditButton('));
const state=a=>vm.runInNewContext(source+';auditAccessState(a)',{a});
const uid='11111111-1111-4111-8111-111111111111',confirmed={id:uid,email:'fixture@example.com',email_confirmed_at:'2026-10-29'};
const event={headers:{authorization:'Bearer fixture-user-token'}};
async function fixture(fetcher,run,key='private-test-key-not-real'){
 const oldFetch=global.fetch,oldURL=process.env.SUPABASE_URL,oldKey=process.env.SUPABASE_SERVICE_ROLE_KEY;
 process.env.SUPABASE_URL='https://example.com';process.env.SUPABASE_SERVICE_ROLE_KEY=key;global.fetch=fetcher;
 try{await run();}finally{global.fetch=oldFetch;for(const [k,v] of [['SUPABASE_URL',oldURL],['SUPABASE_SERVICE_ROLE_KEY',oldKey]]){if(v===undefined)delete process.env[k];else process.env[k]=v;}}
}
test('a used free audit requires upgrade, not logout',()=>assert.equal(state({freeUsed:true,paidActive:false}),'upgrade'));
test('an unused free audit remains available without a subscription',()=>assert.equal(state({freeUsed:false,paidActive:false}),'free'));
test('server-confirmed paid time permits audits even when the free audit was used',()=>assert.equal(state({freeUsed:true,paidActive:true}),'paid'));
test('subscription records alone never imply payment or active audit access',()=>assert.equal(state({freeUsed:true,paidActive:false,subscription:{paid_through:'2099-01-01'}}),'upgrade'));
test('billing holds override paid access and never direct customers to repurchase',()=>assert.equal(state({freeUsed:true,paidActive:true,billingHold:'Review needed'}),'hold'));
test('missing allowance data fails closed rather than granting a free audit',()=>assert.equal(state({}),'unavailable'));
test('test subscriptions cannot be used by a non-allowlisted account',()=>assert.equal(state({freeUsed:true,paidActive:true,billingMode:'test',subscription:{billing_mode:'test'},sandboxCheckout:false}),'hold'));
test('website identity verification uses the site public key, not the database administration key',()=>fixture(async(url,options)=>{assert.equal(options.headers.Authorization,'Bearer fixture-user-token');assert.match(options.headers.apikey,/^sb_publishable_/);assert.notEqual(options.headers.apikey,process.env.SUPABASE_SERVICE_ROLE_KEY);return Response.json(confirmed);},async()=>assert.equal((await user(event)).id,uid)));
test('a confirmed account can sign in independently of any audit usage',()=>fixture(async()=>Response.json(confirmed),async()=>{assert.equal((await user(event)).email,'fixture@example.com');assert.ok(!fs.readFileSync(path.join(root,'netlify/functions/lib/db.js'),'utf8').includes('freeUsed'));}));
test('invalid upstream API key is a configuration failure, not an expired session',()=>fixture(async()=>Response.json({message:'Invalid API key'},{status:401}),async()=>assert.rejects(user(event),e=>e.status===503&&e.code==='auth_configuration'&&!e.message.includes('session has ended'))));
test('a genuinely expired user token still requires sign-in',()=>fixture(async()=>Response.json({msg:'JWT expired'},{status:401}),async()=>assert.rejects(user(event),e=>e.status===401&&e.code==='session_expired')));
test('auth outages, bad responses and connection failures are never expired sessions',async()=>{for(const fetcher of [async()=>Response.json({message:'Unavailable'},{status:503}),async()=>{throw Error('network');},async()=>new Response('<html>invalid</html>'),async()=>Response.json({id:'invalid'})])await fixture(fetcher,async()=>assert.rejects(user(event),e=>e.status===503));});
test('unconfirmed or denied accounts remain forbidden, not expired',async()=>{await fixture(async()=>Response.json({...confirmed,email_confirmed_at:null}),async()=>assert.rejects(user(event),e=>e.status===403));await fixture(async()=>Response.json({msg:'Denied'},{status:403}),async()=>assert.rejects(user(event),e=>e.status===403));});
test('database key rejection is reported as backend failure and never ends website sign-in',()=>fixture(async()=>Response.json({message:'Invalid key'},{status:401}),async()=>assert.rejects(db('geo_jobs?select=id'),e=>e.status===503&&e.code==='backend_database'&&!e.message.includes('session has ended'))));
test('new server secret keys are not sent as JWTs, while legacy server keys retain their bearer header',async()=>{for(const key of ['sb_secret_fixture_not_real','legacy-fixture-not-real'])await fixture(async(url,options)=>{assert.equal(options.headers.apikey,key);assert.equal(options.headers.Authorization,key.startsWith('sb_secret_')?undefined:'Bearer '+key);return Response.json([]);},async()=>assert.deepEqual(await db('geo_jobs?select=id'),[]),key);});
test('missing token is refused before any authentication network call',()=>fixture(async()=>{throw Error('must not be called');},async()=>assert.rejects(user({headers:{}}),e=>e.status===401)));

test('only the standard 25-page scope is offered in template and generated tool',()=>{for(const name of ['templates/audit-tool.html','site/geo-audit/run/index.html']){const html=fs.readFileSync(path.join(root,name),'utf8');assert.equal((html.match(/name="audit-scope"/g)||[]).length,1);assert.ok(html.includes('name="audit-scope" value="25"'));assert.ok(!html.includes('scope-card-75'));assert.ok(!html.includes('Deep Audit'));}});
test('the tool submits the standard scope explicitly, not a hidden or tampered form value',()=>{const start=adapter.slice(adapter.indexOf('async function handleStartAudit('),adapter.indexOf('function appendLog('));assert.ok(start.includes('const scope=25,account='));assert.ok(!start.includes("querySelector('[name=\"audit-scope\"]:checked')"));assert.ok(!start.includes('deeper audit'));});
