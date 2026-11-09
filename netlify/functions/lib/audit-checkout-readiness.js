'use strict';
// Read-only Stripe/database verification inside the deployed Netlify runtime.
// Reuse existing transport/credential handling. Never return or log credentials.
const REVISION='audit-runtime-ready-v3';
const PRICES={starter:{month:4900,year:47040},professional:{month:14900,year:143040},agency:{month:49900,year:479040}};
const CATALOG={starter:{domains:1,per_audit:25,monthly_pages:300},professional:{domains:3,per_audit:25,monthly_pages:75},agency:{domains:10,per_audit:25,monthly_pages:250}};
const EVENTS=['checkout.session.completed','checkout.session.expired','invoice.paid','invoice.payment_failed','customer.subscription.updated','customer.subscription.deleted','charge.refunded','charge.dispute.created','charge.dispute.closed'];
function createReadiness({stripe,db,validatePortalConfiguration,env=process.env,now=()=>Date.now()}={}){
 let cached=null,until=0,pending=null;
 const problem=code=>Object.assign(new Error('Audit checkout configuration requires attention.'),{auditCode:code});
 async function verify(){
  const priceChecks=[];
  try{
   const descriptors=[];for(const [plan,periods]of Object.entries(PRICES))for(const [period,amount]of Object.entries(periods)){
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
   const catalogTask=(async()=>{try{const rows=await db('geo_plan_catalog?select=id,domains,per_audit,monthly_pages,approved');for(const [id,expected]of Object.entries(CATALOG)){const row=rows.find(r=>r.id===id);if(row?.approved!==true||Object.entries(expected).some(([k,v])=>row[k]!==v))throw Error();}}catch{throw problem('AUDIT_CATALOG_REVIEW');}})();
   const providerResults=await Promise.allSettled([priceTask,portalTask,webhookTask,catalogTask]);
   const priceResults=providerResults[0].status==='fulfilled'?providerResults[0].value:[];
   const failures=[...priceResults,...providerResults.slice(1)].filter(r=>r.status==='rejected');
   const allChecks={prices:priceChecks.sort((a,b)=>(a.plan+a.period).localeCompare(b.plan+b.period)),portalVerified:providerResults[1].status==='fulfilled',webhookVerified:providerResults[2].status==='fulfilled',catalogVerified:providerResults[3].status==='fulfilled'};
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
