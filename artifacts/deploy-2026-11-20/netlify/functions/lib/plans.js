'use strict';
const {stripeKeyMode}=require('./stripe-credential');
const PLANS={starter:{name:'Starter',monthly:4900,annual:47040,domains:1,pagesPerAudit:25,monthlyPages:300},professional:{name:'Professional',monthly:14900,annual:143040,domains:3,pagesPerAudit:25,monthlyPages:75},agency:{name:'Agency',monthly:49900,annual:479040,domains:10,pagesPerAudit:25,monthlyPages:250}};
const PRICE_KEYS={starter:{month:'aeogeo-starter-month',year:'aeogeo-starter-year'},professional:{month:'aeogeo-professional-month',year:'aeogeo-professional-year'},agency:{month:'aeogeo-agency-month',year:'aeogeo-agency-year'}};
function priceID(plan,interval){return process.env['STRIPE_PRICE_'+plan.toUpperCase()+'_'+(interval==='year'?'YEAR':'MONTH')];}
// The lookup key names the price that belongs to the current product, so a
// stale environment variable cannot point checkout at an archived product.
function priceLookupKey(plan,interval){return PRICE_KEYS[plan]?.[interval==='year'?'year':'month']||null;}
function fromLookupKey(key){if(!key)return null;for(const plan of Object.keys(PRICE_KEYS))for(const interval of ['month','year'])if(PRICE_KEYS[plan][interval]===key)return{plan,interval};return null;}
function fromPrice(id){if(!id)return null;for(const plan of Object.keys(PLANS))for(const interval of ['month','year'])if(priceID(plan,interval)===id)return{plan,interval};return null;}
function emailIn(name,email=''){return (process.env[name]||'').split(',').map(v=>v.trim().toLowerCase()).filter(Boolean).includes(email.trim().toLowerCase());}
function testBillingAllowed(email=''){return emailIn('BILLING_TEST_EMAILS',email);}
function billingAdmin(email=''){return emailIn('BILLING_ADMIN_EMAILS',email);}
function billingMode(){return stripeKeyMode();}
function sandboxCheckout(plan,email){return process.env.BILLING_TEST_ENABLED==='true'&&billingMode()==='test'&&plan==='starter'&&testBillingAllowed(email);}
function billingReady(plan='starter',email=''){
 // Controlled sandbox testing is separate from approval to collect real money.
 if(process.env.BILLING_TEST_ENABLED==='true'){
  if(billingMode()!=='test')return 'Sandbox checkout requires a Stripe test secret key. Live charges remain blocked.';
  if(plan!=='starter')return 'Only Starter is available for owner-only sandbox testing.';
  if(!testBillingAllowed(email))return 'Test checkout is restricted to the configured website test account.';
  return null;
 }
 if(process.env.BILLING_ENABLED!=='true')return 'Paid checkout is not activated.';
 if(process.env.BILLING_REVIEW_COMPLETE!=='true')return 'Billing is locked pending subscription concurrency, refund/dispute handling and staging end-to-end review.';
 if(process.env.PLAN_LIMITS_APPROVED!=='true')return 'Plan allowances must be approved before checkout opens.';
 if(plan!=='starter'&&process.env.ADVANCED_PLANS_READY!=='true')return 'This plan’s advanced features are not ready for purchase.';
 if(!billingMode())return 'A supported Stripe secret key is not configured.';
 if(billingMode()==='test'&&!testBillingAllowed(email))return 'Test checkout is restricted to the configured website test account.';
 if(billingMode()==='live'&&process.env.LIVE_PAYMENTS_ENABLED!=='true')return 'Live payments are disabled. Use Stripe test credentials first.';
 return null;
}
function publicPlans(){return Object.fromEntries(Object.entries(PLANS).map(([id,p])=>[id,{...p,...(p.provisional?{monthlyPages:null,pagesPerAudit:null,limitsPending:true}:{limitsPending:false})}]));}
module.exports={PLANS,PRICE_KEYS,priceID,priceLookupKey,fromPrice,fromLookupKey,billingReady,publicPlans,testBillingAllowed,billingAdmin,billingMode,sandboxCheckout};
