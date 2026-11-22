'use strict';
// Additive owner-only diagnostic. All upstream requests are GET.
// No application/database imports, billing writes, activation, or secret output.
const OWNER='michellesilerschmidt@gmail.com';
const AUTH_ORIGIN='https://ftwohoenimegsmtliqgz.supabase.co';
const AUTH_KEY='sb_publishable_0T08Pe4A0ZvoHD5CXrd1iA_BvUyVxAO';
const SITE_ORIGIN='https://aeogeosearch.com';
const API_VERSION='2025-02-24.acacia';
const UUID=/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const PRICES=[['starter','price_1Ub0dcBIJX5f6WmhHrZin7Ah',34900],['growth','price_1Ub0egBIJX5f6WmhUficfDCI',64900],['authority','price_1UVwwcBIJX5f6WmhWshWzm8O',99900]];
const response=(statusCode,body,extra={})=>({statusCode,headers:{'Content-Type':'application/json','Cache-Control':'no-store, private','Netlify-CDN-Cache-Control':'no-store','CDN-Cache-Control':'no-store','X-Content-Type-Options':'nosniff','Referrer-Policy':'no-referrer',...extra},body:JSON.stringify(body)});
const header=(e,name)=>Object.entries(e.headers||{}).find(([k])=>k.toLowerCase()===name)?.[1];
function priceIssues(p,entry){const issues=[];
 if(p?.id!==entry[1])issues.push('PRICE_ID');
 if(p?.active!==true)issues.push('PRICE_INACTIVE');
 if(p?.livemode!==true)issues.push('NOT_LIVE');
 if(p?.type!=='recurring')issues.push('NOT_RECURRING');
 if(p?.currency!=='usd')issues.push('CURRENCY');
 if(p?.unit_amount!==entry[2])issues.push('AMOUNT');
 if(p?.recurring?.interval!=='month'||p?.recurring?.interval_count!==1)issues.push('INTERVAL');
 return issues;
}
function portalIssues(c,override){const issues=[];
 if(!c||!/^bpc_[A-Za-z0-9]+$/.test(c.id||'')||(override&&c.id!==override))issues.push('PORTAL_ID');
 if(c?.active!==true)issues.push('PORTAL_INACTIVE');
 if(c?.livemode!==true)issues.push('NOT_LIVE');
 const f=c?.features;
 if(f?.subscription_cancel?.enabled!==true)issues.push('CANCEL_DISABLED');
 if(f?.subscription_cancel?.mode!=='at_period_end')issues.push('CANCEL_TIMING');
 if(f?.subscription_cancel?.proration_behavior!=='none')issues.push('CANCEL_PRORATION');
 if(f?.subscription_update?.enabled!==false)issues.push('UPDATES_ENABLED');
 if(f?.invoice_history?.enabled!==true)issues.push('INVOICES_DISABLED');
 if(f?.payment_method_update?.enabled!==true)issues.push('PAYMENT_METHOD_DISABLED');
 return issues;
}
function makeHandler({env=process.env,fetcher=globalThis.fetch,now=Date.now}={}){
 let busy=false,cooldownUntil=0;
 return async event=>{
  try{
   if(event.httpMethod!=='GET')return response(405,{code:'GET_REQUIRED'},{Allow:'GET'});
   if(event.queryStringParameters&&Object.keys(event.queryStringParameters).length||event.body)return response(400,{code:'NO_PARAMETERS'});
   const origin=header(event,'origin'),fetchSite=header(event,'sec-fetch-site');
   if(origin&&origin!==SITE_ORIGIN||fetchSite==='cross-site')return response(403,{code:'ORIGIN_DENIED'});
   const authorization=header(event,'authorization');
   if(typeof authorization!=='string'||authorization.length>8200||!/^Bearer [A-Za-z0-9._~-]{20,8192}$/.test(authorization))return response(401,{code:'SIGN_IN_REQUIRED'});
   if(env.SUPABASE_URL?.trim().replace(/\/$/,'')!==AUTH_ORIGIN)return response(503,{code:'AUTH_CONFIGURATION'});
   let auth;
   try{
    const r=await fetcher(AUTH_ORIGIN+'/auth/v1/user',{method:'GET',redirect:'error',headers:{apikey:AUTH_KEY,Authorization:authorization},signal:AbortSignal.timeout(3000)});
    if(r.status===401||r.status===403)return response(401,{code:'SIGN_IN_REQUIRED'});
    if(!r.ok)return response(503,{code:'AUTH_UNAVAILABLE'});
    auth=await r.json();
   }catch{return response(503,{code:'AUTH_UNAVAILABLE'});}
   if(!UUID.test(auth?.id||'')||!auth?.email_confirmed_at||auth?.is_anonymous===true||String(auth?.email||'').toLowerCase()!==OWNER)return response(403,{code:'OWNER_ONLY'});
   if(busy||now()<cooldownUntil)return response(429,{code:'WAIT_BEFORE_RECHECK'},{'Retry-After':'30'});
   busy=true;
   try{
    const gates={livePaymentsEnabled:env.LIVE_PAYMENTS_ENABLED==='true',monthlyCheckoutEnabled:env.MONTHLY_SERVICE_CHECKOUT_ENABLED==='true',monthlyReviewComplete:env.MONTHLY_SERVICE_REVIEW_COMPLETE==='true'};
    const key=env.STRIPE_SECRET_KEY;
    // Match the installed account-secret workflow. No trimming/repair or key disclosure.
    if(typeof key!=='string'||!/^sk_live_[A-Za-z0-9]{20,}$/.test(key))return response(503,{code:'KEY_CONFIGURATION'});
    const override=env.STRIPE_SERVICE_PORTAL_CONFIGURATION_ID;
    if(override&& !/^bpc_[A-Za-z0-9]+$/.test(override))return response(503,{code:'PORTAL_CONFIGURATION'});
    async function stripeGet(resource){
     const allowed=PRICES.some(p=>resource==='prices/'+p[1])||resource==='billing_portal/configurations?is_default=true&active=true&limit=10'||(/^bpc_[A-Za-z0-9]+$/.test(override||'')&&resource==='billing_portal/configurations/'+override);
     if(!allowed)return {error:'READ_BLOCKED'};
     try{
      const r=await fetcher('https://api.stripe.com/v1/'+resource,{method:'GET',redirect:'error',headers:{Authorization:'Bearer '+key,'Stripe-Version':API_VERSION},signal:AbortSignal.timeout(4500)});
      if(!r.ok)return {error:({401:'STRIPE_AUTH',403:'STRIPE_PERMISSION',404:'STRIPE_NOT_FOUND',429:'STRIPE_RATE_LIMIT'})[r.status]||'STRIPE_HTTP'};
      const data=await r.json();
      if(!data||typeof data!=='object'||Array.isArray(data)||data.error)return {error:'STRIPE_RESPONSE'};
      return {data};
     }catch{return {error:'STRIPE_UNAVAILABLE'};}
    }
    // Four independent reads in parallel keep the diagnostic within function limits.
    const results=await Promise.all([...PRICES.map(p=>stripeGet('prices/'+p[1])),stripeGet(override?'billing_portal/configurations/'+override:'billing_portal/configurations?is_default=true&active=true&limit=10')]);
    const checks=PRICES.map((p,i)=>{const result=results[i];const issues=result.error?[result.error]:priceIssues(result.data,p);return {id:p[0],status:issues.length?'fail':'pass',issues};});
    const result=results[3];let portal,issues=[];
    if(result.error)issues=[result.error];
    else if(override)portal=result.data;
    else if(!Array.isArray(result.data.data)||result.data.has_more!==false)issues=['STRIPE_RESPONSE'];
    else portal=result.data.data.find(c=>c?.is_default===true&&c.active===true);
    if(!issues.length)issues=portalIssues(portal,override);
    checks.push({id:'portal',status:issues.length?'fail':'pass',issues});
    const gatesClosed=!gates.livePaymentsEnabled&&!gates.monthlyCheckoutEnabled&&!gates.monthlyReviewComplete;
    checks.push({id:'gates',status:gatesClosed?'pass':'fail',issues:gatesClosed?[]:['GATES_REQUIRE_REVIEW']});
    return response(200,{version:1,readOnly:true,outcome:checks.every(c=>c.status==='pass')?'read_checks_pass':'needs_review',gates,checks});
   }finally{busy=false;cooldownUntil=now()+30000;}
  }catch{return response(503,{code:'CHECK_UNAVAILABLE'});}
 };
}
exports.handler=makeHandler();
exports.makeHandler=makeHandler;
exports.priceIssues=priceIssues;
exports.portalIssues=portalIssues;
