'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),vm=require('node:vm'),crypto=require('node:crypto');
const {checkoutDiagnostic}=require('../netlify/functions/lib/checkout-diagnostics');
const {checkoutHandler}=require('../netlify/functions/lib/checkout');
const {UUID,reply}=require('../netlify/functions/lib/db');
const {PLANS}=require('../netlify/functions/lib/plans');
const source=fs.readFileSync(path.join(__dirname,'../site/assets/geo.js'),'utf8');
const start=source.indexOf('function checkoutAvailability('),end=source.indexOf('function checkoutFeedback(',start);
const availability=vm.runInNewContext('('+source.slice(start,end).trim()+')');
const SECRET='sk_test_REDACTION_SENTINEL_NOT_A_REAL_KEY';
test('server checkout diagnostics expose only finite labels and safe source coordinates',()=>{
 const e=new TypeError('Cannot read properties of null '+SECRET);e.code=SECRET;e.cause={code:SECRET};e.stack='TypeError '+SECRET+'\n at fn (/var/task/create-checkout.js:123:45)';
 const out=checkoutDiagnostic(e,'claim_checkout');assert.equal(out.reason,'missing_expected_data');assert.equal(out.code,'not_available');assert.deepEqual(out.frame,{file:'create-checkout.js',line:123,column:45});
 assert.ok(!JSON.stringify(out).includes(SECRET));assert.equal(out.reference,'CHECKOUT_CLAIM_CHECKOUT');
});
test('transport, invalid URL and parse errors are distinguishable without raw text',()=>{
 assert.equal(checkoutDiagnostic(Object.assign(new TypeError(SECRET),{cause:{code:'ENOTFOUND'}}),'validate_price').code,'ENOTFOUND');
 assert.equal(checkoutDiagnostic(Object.assign(new TypeError(SECRET),{code:'ERR_INVALID_URL'}),'resolve_return_origin').reason,'invalid_url');
 assert.equal(checkoutDiagnostic(new SyntaxError(SECRET),'validate_price').reason,'response_or_data_parse_error');
 assert.equal(checkoutDiagnostic(new Error(SECRET),SECRET).stage,'unknown');
});
test('diagnostic failure never throws or leaks its own error',()=>{
 const e=new Proxy({},{get(){throw Error(SECRET);}});const out=checkoutDiagnostic(e,'validate_price');assert.equal(out.reason,'diagnostic_unavailable');assert.ok(!JSON.stringify(out).includes(SECRET));
});
test('Starter is clickable only when the server includes it in checkoutPlans',()=>{
 const a={checkoutPlans:['starter'],billingMode:'test',sandboxCheckout:true};
 assert.equal(availability(a,'starter').allowed,true);assert.match(availability(a,'starter').label,/TEST/);
 assert.equal(availability({...a,checkoutPlans:[]},'starter').allowed,false);
});
test('unavailable Professional and Agency are not mislabeled as TEST checkout',()=>{
 for(const plan of ['professional','agency']){
  const s=availability({checkoutPlans:['starter'],billingMode:'test',sandboxCheckout:true},plan);
  assert.equal(s.allowed,false);assert.equal(s.label,'Checkout unavailable');assert.match(s.reason,/Only Starter/);
 }
});
test('non-owner billing notice remains visible and cannot enable checkout',()=>{
 const s=availability({checkoutPlans:[],billingMode:'test',sandboxCheckout:false,billingNotice:'Restricted to the configured website test account.'},'starter');
 assert.equal(s.allowed,false);assert.match(s.reason,/Restricted/);
});
test('checkout handler logs safe failing stage and returns a reference without granting access',async()=>{
 const logs=[],original=console.error;console.error=(...v)=>logs.push(v);
 try{
  const error=Object.assign(new TypeError('fetch failed '+SECRET),{cause:{code:'ENOTFOUND'}});
  const h=checkoutHandler({db:async q=>q.startsWith('geo_plan_catalog')?[{approved:true}]:[],user:async()=>({id:crypto.randomUUID(),email:'fixture@example.com'}),reply,UUID,PLANS,priceID:()=> 'price_fixture',billingReady:()=>null,stripe:async()=>{throw error;},origin:()=> 'https://aeogeosearch.com'});
  const response=await h({httpMethod:'POST',body:JSON.stringify({plan:'starter',interval:'month',requestId:crypto.randomUUID()})});
  assert.equal(response.statusCode,500);const body=JSON.parse(response.body);assert.equal(body.reference,'CHECKOUT_VALIDATE_PRICE');assert.ok(!body.url);assert.ok(!JSON.stringify(body).includes(SECRET));
  const diagnostic=JSON.parse(logs[0][2]);assert.equal(diagnostic.stage,'validate_price');assert.equal(diagnostic.code,'ENOTFOUND');assert.ok(!JSON.stringify(logs).includes(SECRET));
 }finally{console.error=original;}
});
test('readonly POST method validation and readiness failures remain enforced',async()=>{
 let writes=0;const h=checkoutHandler({db:async()=>{writes++;},user:async()=>({id:crypto.randomUUID(),email:'fixture@example.com'}),reply,UUID,PLANS,priceID:()=> 'unused',billingReady:()=> 'Checkout is not activated.',stripe:async()=>{writes++;},origin:()=> 'https://aeogeosearch.com'});
 assert.equal((await h({httpMethod:'GET'})).statusCode,405);
 const response=await h({httpMethod:'POST',body:JSON.stringify({plan:'starter',interval:'month',requestId:crypto.randomUUID()})});assert.equal(response.statusCode,503);assert.equal(writes,0);
});
