'use strict';
const {test}=require('node:test'),assert=require('node:assert/strict');
const {PLANS}=require('../netlify/functions/lib/plans'),{createReadiness}=require('../netlify/functions/lib/audit-checkout-readiness');
const AMOUNTS={starter:{month:4900,year:47040},professional:{month:14900,year:143040},agency:{month:49900,year:479040}};

function fixture(rows){
 const env={STRIPE_WEBHOOK_SECRET:'whsec_fixture',STRIPE_PORTAL_CONFIGURATION_ID:'bpc_fixture'};
 for(const plan of Object.keys(AMOUNTS))for(const period of ['month','year'])env['STRIPE_PRICE_'+plan.toUpperCase()+'_'+period.toUpperCase()]='price_'+plan+period;
 const stripe=async path=>{
  if(path.startsWith('prices/')){
   const id=path.slice('prices/'.length),match=Object.entries(AMOUNTS).flatMap(([plan,periods])=>Object.entries(periods).map(([period,amount])=>({plan,period,amount,id:'price_'+plan+period}))).find(p=>p.id===id);
   if(!match)throw Error('unexpected price '+id);
   return {id,active:true,livemode:true,currency:'usd',unit_amount:match.amount,type:'recurring',billing_scheme:'per_unit',recurring:{interval:match.period,interval_count:1,usage_type:'licensed'}};
  }
  if(path.startsWith('webhook_endpoints'))return {data:[{status:'enabled',livemode:true,url:'https://aeogeosearch.com/.netlify/functions/stripe-webhook',enabled_events:['*']}]};
  if(path.startsWith('billing_portal/configurations/'))return {active:true,is_default:true,default_return_url:'https://aeogeosearch.com/account/'};
  throw Error('unexpected Stripe path '+path);
 };
 const db=async path=>{assert.match(path,/^geo_plan_catalog\?/);assert.match(path,/select=.*scans_per_month/);return rows;};
 return createReadiness({stripe,db,validatePortalConfiguration:()=>true,env});
}

const catalog=()=>Object.entries(PLANS).map(([id,p])=>({id,domains:p.domains,per_audit:p.pagesPerAudit,monthly_pages:p.monthlyPages,scans_per_month:p.scansPerMonth,approved:true}));

test('readiness accepts a catalog that matches plans.js',async()=>{
 const result=await fixture(catalog()).check({fresh:true});
 assert.equal(result.ready,true);
 assert.equal(result.code,'AUDIT_CONFIGURATION_VERIFIED');
 assert.equal(result.catalogVerified,true);
});

test('readiness rejects the old 4,500 or 15,000 monthly budgets',async()=>{
 for(const [plan,monthlyPages] of [['professional',4500],['agency',15000]]){
  const rows=catalog().map(row=>row.id===plan?{...row,monthly_pages:monthlyPages}:row);
  const result=await fixture(rows).check({fresh:true});
  assert.equal(result.ready,false,plan);
  assert.equal(result.code,'AUDIT_CATALOG_REVIEW',plan);
 }
});

test('readiness rejects a wrong scan allowance even when all rows are approved',async()=>{
 for(const [plan,wrongScans] of [['starter',3],['professional',5],['agency',21]]){
  const rows=catalog().map(row=>row.id===plan?{...row,scans_per_month:wrongScans}:row);
  const result=await fixture(rows).check({fresh:true});
  assert.equal(result.ready,false,plan);
  assert.equal(result.code,'AUDIT_CATALOG_REVIEW',plan);
  assert.deepEqual(result.codes,['AUDIT_CATALOG_REVIEW'],plan);
  assert.equal(result.checks.catalogVerified,false,plan);
  assert.equal(result.checks.portalVerified,true,plan);
  assert.equal(result.checks.webhookVerified,true,plan);
  assert.equal(result.checks.prices.length,6,plan);
  assert.ok(result.checks.prices.every(price=>price.verified),plan);
 }
});
