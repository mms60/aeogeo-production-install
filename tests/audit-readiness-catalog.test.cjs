'use strict';
const {test}=require('node:test'),assert=require('node:assert/strict');
const {PLANS}=require('../netlify/functions/lib/plans'),{createReadiness}=require('../netlify/functions/lib/audit-checkout-readiness');
const planAmounts=()=>Object.fromEntries(Object.entries(PLANS).map(([id,p])=>[id,{month:p.monthly,year:p.annual}]));

function fixture(rows,{stripeAmounts=planAmounts(),dbError=false}={}){
 const amounts=planAmounts();
 const env={STRIPE_WEBHOOK_SECRET:'whsec_fixture',STRIPE_PORTAL_CONFIGURATION_ID:'bpc_fixture'};
 for(const plan of Object.keys(amounts))for(const period of ['month','year'])env['STRIPE_PRICE_'+plan.toUpperCase()+'_'+period.toUpperCase()]='price_'+plan+period;
 const stripe=async path=>{
  if(path.startsWith('prices/')){
   const id=path.slice('prices/'.length),match=Object.entries(stripeAmounts).flatMap(([plan,periods])=>Object.entries(periods).map(([period,amount])=>({plan,period,amount,id:'price_'+plan+period}))).find(p=>p.id===id);
   if(!match)throw Error('unexpected price '+id);
   return {id,active:true,livemode:true,currency:'usd',unit_amount:match.amount,type:'recurring',billing_scheme:'per_unit',recurring:{interval:match.period,interval_count:1,usage_type:'licensed'}};
  }
  if(path.startsWith('webhook_endpoints'))return {data:[{status:'enabled',livemode:true,url:'https://aeogeosearch.com/.netlify/functions/stripe-webhook',enabled_events:['*']}]};
  if(path.startsWith('billing_portal/configurations/'))return {active:true,is_default:true,default_return_url:'https://aeogeosearch.com/account/'};
  throw Error('unexpected Stripe path '+path);
 };
 const db=async path=>{assert.match(path,/^geo_plan_catalog\?/);assert.match(path,/select=.*scans_per_month/);if(dbError)throw Error('catalog read failed');return rows;};
 return createReadiness({stripe,db,validatePortalConfiguration:()=>true,env});
}

const catalog=()=>Object.entries(PLANS).map(([id,p])=>({id,domains:p.domains,per_audit:p.pagesPerAudit,monthly_pages:p.monthlyPages,scans_per_month:p.scansPerMonth,approved:true}));

test('readiness accepts a catalog that matches plans.js',async()=>{
 const result=await fixture(catalog()).check({fresh:true});
 assert.equal(result.ready,true);
 assert.equal(result.code,'AUDIT_CONFIGURATION_VERIFIED');
 assert.equal(result.catalogVerified,true);
});

test('readiness reports approval as the failing catalog expectation',async()=>{
 const rows=catalog().map(row=>row.id==='professional'?{...row,approved:false}:row);
 const result=await fixture(rows).check({fresh:true});
 assert.equal(result.ready,false);
 assert.equal(result.code,'AUDIT_CATALOG_REVIEW');
 assert.equal(result.checks.catalogVerified,false);
 const check=result.checks.catalog.find(row=>row.plan==='professional');
 assert.deepEqual(check.issues,['APPROVAL']);
 assert.equal(check.expected.approved,true);
 assert.equal(check.observed.approved,false);
 assert.equal(check.expected.monthlyPages,PLANS.professional.monthlyPages);
 assert.equal(check.observed.monthlyPages,PLANS.professional.monthlyPages);
 assert.ok(result.checks.catalog.filter(row=>row.plan!=='professional').every(row=>row.verified));
 assert.equal(JSON.stringify(result).includes('whsec_fixture'),false);
});

test('readiness reports the exact allowance field that differs',async()=>{
 const rows=catalog().map(row=>row.id==='agency'?{...row,monthly_pages:250}:row);
 const result=await fixture(rows).check({fresh:true});
 assert.equal(result.ready,false);
 assert.equal(result.code,'AUDIT_CATALOG_REVIEW');
 assert.equal(result.checks.catalogVerified,false);
 const check=result.checks.catalog.find(row=>row.plan==='agency');
 assert.deepEqual(check.issues,['MONTHLY_PAGES']);
 assert.equal(check.expected.approved,true);
 assert.equal(check.observed.approved,true);
 assert.equal(check.expected.monthlyPages,PLANS.agency.monthlyPages);
 assert.equal(check.observed.monthlyPages,250);
 assert.equal(JSON.stringify(result).includes('whsec_fixture'),false);
});

test('readiness reports a missing catalog row',async()=>{
 const rows=catalog().filter(row=>row.id!=='agency');
 const result=await fixture(rows).check({fresh:true});
 assert.equal(result.ready,false);
 assert.equal(result.code,'AUDIT_CATALOG_REVIEW');
 assert.equal(result.checks.catalogVerified,false);
 assert.equal(result.checks.catalogUnavailable,false);
 const check=result.checks.catalog.find(row=>row.plan==='agency');
 assert.deepEqual(check.issues,['MISSING']);
 assert.equal(check.expected.monthlyPages,PLANS.agency.monthlyPages);
 assert.equal(check.observed,null);
 assert.ok(result.checks.catalog.filter(row=>row.plan!=='agency').every(row=>row.verified));
});

test('readiness marks a catalog read as unavailable',async()=>{
 const result=await fixture([],{dbError:true}).check({fresh:true});
 assert.equal(result.ready,false);
 assert.equal(result.code,'AUDIT_CATALOG_REVIEW');
 assert.equal(result.checks.catalogVerified,false);
 assert.equal(result.checks.catalogUnavailable,true);
 assert.deepEqual(result.checks.catalog,[]);
 assert.equal(JSON.stringify(result).includes('catalog read failed'),false);
});

test('readiness follows the six price amounts in plans.js',async()=>{
 const original=Object.fromEntries(Object.entries(PLANS).map(([id,p])=>[id,{monthly:p.monthly,annual:p.annual}]));
 try{
  const changed={starter:{monthly:5100,annual:48960},professional:{monthly:15100,annual:144960},agency:{monthly:50100,annual:480960}};
  for(const [id,amounts] of Object.entries(changed)){PLANS[id].monthly=amounts.monthly;PLANS[id].annual=amounts.annual;}
  const result=await fixture(catalog()).check({fresh:true});
  assert.equal(result.ready,true);
  assert.equal(result.pricesVerified,6);

  const staleAmounts=planAmounts();
  staleAmounts.professional.month=original.professional.monthly;
  const stale=await fixture(catalog(),{stripeAmounts:staleAmounts}).check({fresh:true});
  assert.equal(stale.ready,false);
  assert.equal(stale.code,'AUDIT_PRICE_MISMATCH_PROFESSIONAL_MONTH');
  const stalePrice=stale.checks.prices.find(price=>price.plan==='professional'&&price.period==='month');
  assert.ok(stalePrice.issues.includes('AMOUNT'));
  assert.equal(stalePrice.expected.amountCents,changed.professional.monthly);
  assert.equal(stalePrice.observed.amountCents,original.professional.monthly);
 }finally{
  for(const [id,amounts] of Object.entries(original)){PLANS[id].monthly=amounts.monthly;PLANS[id].annual=amounts.annual;}
 }
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
  assert.deepEqual(result.checks.catalog.find(row=>row.plan===plan).issues,['SCANS_PER_MONTH'],plan);
  assert.equal(result.checks.catalogVerified,false,plan);
  assert.equal(result.checks.portalVerified,true,plan);
  assert.equal(result.checks.webhookVerified,true,plan);
  assert.equal(result.checks.prices.length,6,plan);
  assert.ok(result.checks.prices.every(price=>price.verified),plan);
 }
});
