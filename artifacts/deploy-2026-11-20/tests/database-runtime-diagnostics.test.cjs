'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const {databaseDiagnostic,credentialMetadata,classifyResponse}=require('../netlify/functions/lib/db-diagnostics');
const SECRET='sb_secret_PRIVATE_TEST_SENTINEL_NEVER_PRINT_123';
const PROJECT='https://ftwohoenimegsmtliqgz.supabase.co';
const payload={key:SECRET,url:PROJECT,text:JSON.stringify({message:'Invalid API key '+SECRET}),status:401,context:'production'};
function legacy(claims){return 'eyJhbGciOiJIUzI1NiJ9.'+Buffer.from(JSON.stringify(claims)).toString('base64url')+'.testSignature';}
test('runtime diagnosis classifies gateway rejection without returning the key or raw message',()=>{
 const record=databaseDiagnostic(payload),out=JSON.stringify(record);
 assert.equal(record.reason,'invalid_api_key');assert.equal(record.credentialType,'modern_secret');
 assert.equal(record.secretFormatValid,true);assert.equal(record.databaseProjectMatches,true);assert.equal(record.authorizationHeaderMode,'apikey_only');
 assert.ok(!out.includes(SECRET));assert.ok(!out.includes('Invalid API key'));assert.equal(record.revision,'db-diagnostic-v1');
});
test('runtime permission and JWT errors are distinguished without exposing response details',()=>{
 assert.deepEqual(classifyResponse(JSON.stringify({code:'42501',message:SECRET}),401),{reason:'database_permission_denied',upstreamCode:'42501'});
 assert.equal(classifyResponse(JSON.stringify({code:'PGRST301',details:SECRET}),401).reason,'token_validation_failed');
 assert.equal(classifyResponse(JSON.stringify({code:'PGRST302'}),401).reason,'anonymous_access_disallowed');
});
test('unrecognized gateway codes and arbitrary body content never become log fields',()=>{
 const record=databaseDiagnostic({...payload,text:JSON.stringify({code:SECRET,message:SECRET,details:SECRET,hint:SECRET})});
 assert.equal(record.upstreamCode,'not_available');assert.equal(record.reason,'unclassified_upstream_error');assert.ok(!JSON.stringify(record).includes(SECRET));
});
test('non-JSON response is classified without printing content',()=>{
 const r=databaseDiagnostic({...payload,text:'<html>'+SECRET+'</html>'});
 assert.equal(r.reason,'non_json_upstream_error');assert.ok(!JSON.stringify(r).includes(SECRET));
});
test('runtime key categories distinguish masked, malformed and browser credentials',()=>{
 assert.equal(credentialMetadata('********').credentialType,'masked_or_placeholder');
 assert.equal(credentialMetadata('sb_publishable_example').credentialType,'publishable_not_server_secret');
 assert.equal(credentialMetadata('sb_secret_bad value').secretFormatValid,false);
 assert.equal(credentialMetadata('').credentialType,'missing');
});
test('legacy role, project and expiry are only categorical, never raw claims or token',()=>{
 const token=legacy({role:'anon',ref:'wrong-private-project',exp:1,custom:SECRET});
 const meta=credentialMetadata(token),out=JSON.stringify(meta);
 assert.equal(meta.legacyRole,'anon');assert.equal(meta.legacyProject,'differs');assert.equal(meta.legacyExpired,'yes');
 for(const raw of [token,SECRET,'wrong-private-project'])assert.ok(!out.includes(raw));
});
test('valid legacy service-role metadata is recognized without logging JWT',()=>{
 const token=legacy({role:'service_role',ref:'ftwohoenimegsmtliqgz',exp:Math.floor(Date.now()/1000)+3600});
 const r=databaseDiagnostic({...payload,key:token});
 assert.equal(r.legacyRole,'service_role');assert.equal(r.legacyProject,'matches');assert.equal(r.legacyExpired,'no');assert.equal(r.authorizationHeaderMode,'apikey_and_bearer');
 assert.ok(!JSON.stringify(r).includes(token));
});
test('header overrides and deployment context never expose their values',()=>{
 const r=databaseDiagnostic({...payload,context:SECRET,headers:{Authorization:SECRET}});
 assert.equal(r.authorizationHeaderMode,'caller_override');assert.equal(r.deploymentContext,'not_provided');assert.ok(!JSON.stringify(r).includes(SECRET));
});
test('diagnostic failure safely falls back without exposing a thrown error',()=>{
 const headers=new Proxy({},{ownKeys(){throw Error(SECRET);}});
 assert.deepEqual(databaseDiagnostic({...payload,headers}),{revision:'db-diagnostic-v1',reason:'diagnostic_unavailable'});
});
async function withFakeDatabase(key,response,run){
 const old={url:process.env.SUPABASE_URL,key:process.env.SUPABASE_SERVICE_ROLE_KEY,context:process.env.CONTEXT,fetch:global.fetch,error:console.error};
 const calls=[],logs=[];
 try{
  process.env.SUPABASE_URL=PROJECT;process.env.SUPABASE_SERVICE_ROLE_KEY=key;process.env.CONTEXT='production';
  global.fetch=async(url,options)=>{calls.push({url,options});return response;};
  console.error=(...args)=>logs.push(args);
  await run({db:require('../netlify/functions/lib/db').db,calls,logs});
 }finally{
  global.fetch=old.fetch;console.error=old.error;
  for(const [name,val] of [['SUPABASE_URL',old.url],['SUPABASE_SERVICE_ROLE_KEY',old.key],['CONTEXT',old.context]]){if(val===undefined)delete process.env[name];else process.env[name]=val;}
 }
}
test('actual db helper preserves modern headers and UI503 while privately logging a safe diagnosis',async()=>{
 await withFakeDatabase(SECRET,{ok:false,status:401,text:async()=>JSON.stringify({message:'Invalid API key '+SECRET})},async({db,calls,logs})=>{
  await assert.rejects(()=>db('geo_subscriptions?user_id=eq.private-account-id&select=status'),e=>e.status===503&&e.code==='backend_database'&&e.message.includes('BACKEND_DATABASE'));
  assert.equal(calls.length,1);assert.equal(calls[0].options.headers.apikey,SECRET);assert.equal(calls[0].options.headers.Authorization,undefined);assert.equal(calls[0].options.method,'GET');
  assert.equal(logs.length,1);assert.deepEqual(logs[0].slice(0,3),['Database request failed',401,'geo_subscriptions']);
  const record=JSON.parse(logs[0][3]);assert.equal(record.reason,'invalid_api_key');assert.equal(record.revision,'db-diagnostic-v1');
  const printed=JSON.stringify(logs);assert.ok(!printed.includes(SECRET));assert.ok(!printed.includes('private-account-id'));
 });
});
test('actual db helper preserves legacy service-role authentication and permission diagnosis',async()=>{
 const token=legacy({role:'service_role',ref:'ftwohoenimegsmtliqgz',exp:Math.floor(Date.now()/1000)+3600});
 await withFakeDatabase(token,{ok:false,status:403,text:async()=>JSON.stringify({code:'42501',message:'permission denied '+SECRET})},async({db,calls,logs})=>{
  await assert.rejects(()=>db('geo_jobs?select=id'),e=>e.status===503&&e.code==='backend_database');
  assert.equal(calls[0].options.headers.Authorization,'Bearer '+token);
  const r=JSON.parse(logs[0][3]);assert.equal(r.reason,'database_permission_denied');assert.equal(r.legacyRole,'service_role');assert.ok(!JSON.stringify(logs).includes(token));
 });
});
test('successful database reads are unchanged and produce no extra log',async()=>{
 await withFakeDatabase(SECRET,{ok:true,status:200,text:async()=>'[]'},async({db,calls,logs})=>{
  assert.deepEqual(await db('geo_subscriptions?select=user_id&limit=0'),[]);assert.equal(calls.length,1);assert.equal(logs.length,0);
 });
});
