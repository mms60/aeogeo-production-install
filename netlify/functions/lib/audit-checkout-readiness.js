'use strict';
// Read-only Stripe/database verification inside the deployed Netlify runtime.
// Reuse existing transport/credential handling. Never return or log credentials.
const {PLANS}=require('./plans');
const REVISION='audit-runtime-ready-v4';
// Derive the database expectations from the single plan definition, so an
// allowance change cannot leave readiness checking the previous numbers.
const CATALOG=Object.fromEntries(Object.entries(PLANS).map(([id,p])=>[id,{domains:p.domains,per_audit:p.pagesPerAudit,monthly_pages:p.monthlyPages,scans_per_month:p.scansPerMonth}]));
const EVENTS=['checkout.session.completed','checkout.session.expired','invoice.paid','invoice.payment_failed','customer.subscription.updated','customer.subscription.deleted','charge.refunded','charge.dispute.created','charge.dispute.closed'];
function createReadiness({stripe,db,validatePortalConfiguration,env=process.env,now=()=>Date.now()}={}){
 let cached=null,until=0,pending=null;
 const problem=code=>Object.assign(new Error('Audit checkout configuration requires attention.'),{auditCode:code});
 async function verify(){
  const priceChecks=[];
  const catalogChecks=[];
  try{
   const descriptors=[];for(const [plan,p]of Object.entries(PLANS))for(const [period,amount]of Object.entries({month:p.monthly,year:p.annual})){
    const name='STRIPE_PRICE_'+plan.toUpperCase()+'_'+period.toUpperCase(),id=env[name];
    if(!/^price_[A-Za-z0-9]+$/.test(id||''))throw problem('AUDIT_PRICE_MISSING_'+plan.toUpperCase()+'_'+period.toUpperCase());
    descriptors.push({plan,period,amount,id});
   }
   if(typeof env.STRIPE_WEBHOOK_SECRET!=='string'||!env.STRIPE_WEBHOOK_SECRET.trim())throw problem('AUDIT_WEBHOOK_NOT_CONFIGURED');
   const priceTask=Promise.allSettled(descriptors.map(async d=>{
    let p;try{p=await stripe('prices/'+encodeURIComponent(d.id));}catch{throw problem('AUDIT_PRICE_READ_'+d.plan.toUpperCase()+'_'+d.period.toUpperCase());}
    const issues=[];
    if(p?.id!==d.id)issues.push('PRICE_ID');
    if(p?.active!==true)issues.push('INACTIVE');
    if(p?.livemode!==true)issues.push('NOT_LIVE');
    if(p?.currency!=='usd')issues.push('CURRENCY');
    if(p?.unit_amount!==d.amount)issues.push('AMOUNT');
    if(p?.recurring?.interval!==d.period||p?.recurring?.interval_count!==1)issues.push('INTERVAL');
    if(p?.type!=='recurring')issues.push('TYPE');
    if(p?.recurring?.usage_type&&p.recurring.usage_type!=='licensed')issues.push('USAGE');
    if(p?.billing_scheme&&p.billing_scheme!=='per_unit')issues.push('BILLING_SCHEME');
    const finite=value=>typeof value==='number'&&Number.isSafeInteger(value)?value:null;
    const choice=(value,allowed)=>allowed.includes(value)?value:null;
    priceChecks.push({plan:d.plan,period:d.period,verified:!issues.length,issues,
     expected:{amountCents:d.amount,currency:'usd',interval:d.period,intervalCount:1,active:true,live:true,type:'recurring'},
     observed:{amountCents:finite(p?.unit_amount),currency:choice(p?.currency,['usd','eur','gbp','cad','aud']),interval:choice(p?.recurring?.interval,['month','year','week','day']),intervalCount:finite(p?.recurring?.interval_count),active:p?.active===true,live:p?.livemode===true,type:choice(p?.type,['recurring','one_time']),usage:choice(p?.recurring?.usage_type,['licensed','metered']),billingScheme:choice(p?.billing_scheme,['per_unit','tiered'])}});
    if(issues.length)throw problem('AUDIT_PRICE_MISMATCH_'+d.plan.toUpperCase()+'_'+d.period.toUpperCase());
   }));
   const portalTask=(async()=>{try{
    let p;if(env.STRIPE_PORTAL_CONFIGURATION_ID)p=await stripe('billing_portal/configurations/'+encodeURIComponent(env.STRIPE_PORTAL_CONFIGURATION_ID));
    else p=(await stripe('billing_portal/configurations?is_default=true&active=true&limit=10')).data?.find(c=>c.active&&c.is_default);
    const ret=p?.default_return_url||p?.business_profile?.default_return_url;if(ret&&new URL(ret).origin!=='https://aeogeosearch.com')throw Error();
    validatePortalConfiguration(p,true);
   }catch{throw problem('AUDIT_PORTAL_REVIEW');}})();
   const webhookTask=(async()=>{try{
    const list=await stripe('webhook_endpoints?limit=100'),urls=['https://aeogeosearch.com/.netlify/functions/stripe-webhook','https://geoaeosearch.netlify.app/.netlify/functions/stripe-webhook'];
    if(!list.data?.some(h=>h.status==='enabled'&&h.livemode===true&&urls.includes(h.url)&&(h.enabled_events?.includes('*')||EVENTS.every(e=>h.enabled_events?.includes(e)))))throw Error();
   }catch{throw problem('AUDIT_WEBHOOK_REVIEW');}})();
   const catalogTask=(async()=>{
    let rows;
    try{rows=await db('geo_plan_catalog?select=id,domains,per_audit,monthly_pages,scans_per_month,approved');}
    catch{throw Object.assign(problem('AUDIT_CATALOG_REVIEW'),{safeCatalogDiagnostics:{checks:[],unavailable:true}});}
    if(!Array.isArray(rows))throw Object.assign(problem('AUDIT_CATALOG_REVIEW'),{safeCatalogDiagnostics:{checks:[],unavailable:true}});
    const finite=value=>typeof value==='number'&&Number.isSafeInteger(value)?value:null;
    for(const [plan,expected]of Object.entries(CATALOG)){
     const expectedView={approved:true,domains:expected.domains,perAudit:expected.per_audit,monthlyPages:expected.monthly_pages,scansPerMonth:expected.scans_per_month};
     const row=rows.find(r=>r?.id===plan);
     if(!row){catalogChecks.push({plan,verified:false,issues:['MISSING'],expected:expectedView,observed:null});continue;}
     const issues=[];
     if(row.approved!==true)issues.push('APPROVAL');
     if(row.domains!==expected.domains)issues.push('DOMAINS');
     if(row.per_audit!==expected.per_audit)issues.push('PER_AUDIT');
     if(row.monthly_pages!==expected.monthly_pages)issues.push('MONTHLY_PAGES');
     if(row.scans_per_month!==expected.scans_per_month)issues.push('SCANS_PER_MONTH');
     catalogChecks.push({plan,verified:!issues.length,issues,expected:expectedView,observed:{approved:row.approved===true,domains:finite(row.domains),perAudit:finite(row.per_audit),monthlyPages:finite(row.monthly_pages),scansPerMonth:finite(row.scans_per_month)}});
    }
    if(catalogChecks.some(check=>!check.verified))throw Object.assign(problem('AUDIT_CATALOG_REVIEW'),{safeCatalogDiagnostics:{checks:catalogChecks,unavailable:false}});
    return {checks:catalogChecks,unavailable:false};
   })();
   const providerResults=await Promise.allSettled([priceTask,portalTask,webhookTask,catalogTask]);
   const priceResults=providerResults[0].status==='fulfilled'?providerResults[0].value:[];
   const catalogDiagnostics=providerResults[3].status==='fulfilled'?providerResults[3].value:providerResults[3].reason?.safeCatalogDiagnostics||{checks:[],unavailable:true};
   const failures=[...priceResults,...providerResults.slice(1)].filter(r=>r.status==='rejected');
   const allChecks={prices:priceChecks.sort((a,b)=>(a.plan+a.period).localeCompare(b.plan+b.period)),catalog:[...catalogDiagnostics.checks].sort((a,b)=>a.plan.localeCompare(b.plan)),catalogUnavailable:catalogDiagnostics.unavailable===true,portalVerified:providerResults[1].status==='fulfilled',webhookVerified:providerResults[2].status==='fulfilled',catalogVerified:providerResults[3].status==='fulfilled'};
   if(failures.length){const error=failures[0].reason;const codes=[...new Set(failures.map(f=>/^AUDIT_[A-Z_]+$/.test(f.reason?.auditCode||'')?f.reason.auditCode:'AUDIT_CONFIGURATION_UNAVAILABLE'))];throw Object.assign(error,{safePriceDiagnostics:allChecks,safeCodes:codes});}
   return{revision:REVISION,ready:true,code:'AUDIT_CONFIGURATION_VERIFIED',pricesVerified:6,portalVerified:true,webhookVerified:true,catalogVerified:true,message:'Audit checkout configuration verified.'};
  }catch(e){const code=/^AUDIT_[A-Z_]+$/.test(e.auditCode||'')?e.auditCode:'AUDIT_CONFIGURATION_UNAVAILABLE';return{revision:REVISION,ready:false,code,...(e.safePriceDiagnostics?{checks:e.safePriceDiagnostics,codes:e.safeCodes}:{}),message:'Audit checkout cannot open yet. Please contact us. Reference: '+code+'.'};}
 }
 async function check({fresh=false}={}){if(!fresh&&cached&&until>now())return cached;if(pending)return pending;pending=verify().then(r=>{cached=r;until=now()+(r.ready?60000:10000);return r;}).finally(()=>{pending=null;});return pending;}
 return{check};
}
let configured;
function configuredReadiness(){if(!configured){const {stripe}=require('./stripe'),{db}=require('./db'),{validatePortalConfiguration}=require('./portal-policy');configured=createReadiness({stripe,db,validatePortalConfiguration});}return configured;}
async function requireReady(){const r=await configuredReadiness().check();if(!r.ready)throw Object.assign(new Error(r.message),{status:503,code:r.code});}
module.exports={createReadiness,configuredReadiness,requireReady,REVISION};
