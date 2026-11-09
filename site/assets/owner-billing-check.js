/* Owner diagnostic only. No checkout or billing mutations. */
(()=>{'use strict';
const button=document.getElementById('owner-check-run'),status=document.getElementById('owner-check-status'),login=document.getElementById('owner-check-login'),output=document.getElementById('owner-check-results');
const labels={starter:'Starter: active LIVE USD 349 every month',growth:'Growth: active LIVE USD 649 every month',authority:'Authority: active LIVE USD 999 every month',portal:'Portal: paid-period-end cancellation, no cancellation prorations, no plan/quantity changes, invoices and payment-method updates',gates:'All three LIVE/monthly payment gates remain closed'};
const issues=new Set(['PRICE_ID','PRICE_INACTIVE','NOT_LIVE','NOT_RECURRING','CURRENCY','AMOUNT','INTERVAL','PORTAL_ID','PORTAL_INACTIVE','CANCEL_DISABLED','CANCEL_TIMING','CANCEL_PRORATION','UPDATES_ENABLED','INVOICES_DISABLED','PAYMENT_METHOD_DISABLED','READ_BLOCKED','STRIPE_AUTH','STRIPE_PERMISSION','STRIPE_NOT_FOUND','STRIPE_RATE_LIMIT','STRIPE_HTTP','STRIPE_RESPONSE','STRIPE_UNAVAILABLE','GATES_REQUIRE_REVIEW']);
const errors={GET_REQUIRED:'This diagnostic accepts only read-only requests.',NO_PARAMETERS:'The diagnostic does not accept request parameters.',ORIGIN_DENIED:'Open this page directly on aeogeosearch.com.',SIGN_IN_REQUIRED:'Please sign in to the website again.',AUTH_CONFIGURATION:'The runtime website authentication configuration needs review.',AUTH_UNAVAILABLE:'Website sign-in verification could not complete.',OWNER_ONLY:'This diagnostic is restricted to the confirmed website owner account.',WAIT_BEFORE_RECHECK:'Please wait at least 30 seconds before another check.',KEY_CONFIGURATION:'The runtime LIVE credential configuration needs review. Do not reveal or replace the key.',PORTAL_CONFIGURATION:'The runtime service portal configuration ID needs review.',CHECK_UNAVAILABLE:'The diagnostic could not complete. Private error details were suppressed.'};
let client=null,pending=false,nextAllowed=0;
function signIn(){button.hidden=true;button.disabled=true;login.hidden=false;status.textContent='Please sign in to the website to access the owner-only diagnostic.';}
function safeLines(data){
 if(data?.version!==1||data.readOnly!==true||!Array.isArray(data.checks)||data.checks.length!==5||!data.gates)throw Error();
 const ids=Object.keys(labels);
 for(let i=0;i<ids.length;i++){
  const c=data.checks[i];
  if(c?.id!==ids[i]||!['pass','fail'].includes(c.status)||!Array.isArray(c.issues)||c.issues.length>12||!c.issues.every(v=>issues.has(v))||(c.status==='pass'&&c.issues.length)||(c.status==='fail'&&!c.issues.length))throw Error();
 }
 for(const key of ['livePaymentsEnabled','monthlyCheckoutEnabled','monthlyReviewComplete'])if(typeof data.gates[key]!=='boolean')throw Error();
 const pass=data.checks.every(c=>c.status==='pass');
 if(data.outcome!==(pass?'read_checks_pass':'needs_review'))throw Error();
 return ['AEOGEO owner LIVE billing READ-ONLY check',...data.checks.map(c=>(c.status==='pass'?'PASS: ':'FAIL: ')+labels[c.id]+(c.issues.length?' ['+c.issues.join(', ')+']':'')),
  'LIVE_PAYMENTS_ENABLED: '+data.gates.livePaymentsEnabled,
  'MONTHLY_SERVICE_CHECKOUT_ENABLED: '+data.gates.monthlyCheckoutEnabled,
  'MONTHLY_SERVICE_REVIEW_COMPLETE: '+data.gates.monthlyReviewComplete,
  pass?'RESULT: Read-only checks pass. Keep payments locked until end-to-end testing is complete.':'RESULT: Needs review. Do not enable payments.',
  'Not tested: checkout, payment, signed webhook delivery, renewal, cancellation execution, payment return.'];
}
button.addEventListener('click',async()=>{
 if(pending||Date.now()<nextAllowed||!client)return;
 pending=true;button.disabled=true;output.hidden=true;output.textContent='';status.textContent='Running read-only checks. No payment or settings changes...';
 try{
  const session=await client.auth.getSession();
  if(session.error||!session.data?.session?.access_token){signIn();return;}
  const r=await fetch('/.netlify/functions/owner-billing-check',{method:'GET',headers:{Authorization:'Bearer '+session.data.session.access_token},cache:'no-store',redirect:'error'});
  let data;try{data=await r.json();}catch{status.textContent='The diagnostic returned an unreadable response. Stop and report this message.';return;}
  if(!r.ok){
   if(r.status===401){signIn();return;}
   const message=Object.hasOwn(errors,data?.code)?errors[data.code]:'The diagnostic could not complete. Raw response details were suppressed.';
   status.textContent=message;output.hidden=false;output.textContent='STOP: '+message+'\nNo payment or settings change was made. Keep payments locked.';
   if(r.status===403){button.hidden=true;login.hidden=false;}
   return;
  }
  let lines;try{lines=safeLines(data);}catch{status.textContent='The diagnostic returned an unexpected response. Stop and report this message.';return;}
  output.textContent=lines.join('\n');output.hidden=false;
  status.textContent='Check finished. Share the result lines below. Do not deploy again or change payment flags.';
 }catch{status.textContent='The read-only check could not complete. Stop and report this message. Private error details were suppressed.';}
 finally{pending=false;nextAllowed=Date.now()+30000;setTimeout(()=>{if(!button.hidden)button.disabled=false;},30000);}
});
(async()=>{try{
 if(!window.supabase){status.textContent='Website sign-in could not load. Stop and report this message.';return;}
 client=window.supabase.createClient('https://ftwohoenimegsmtliqgz.supabase.co','sb_publishable_0T08Pe4A0ZvoHD5CXrd1iA_BvUyVxAO',{auth:{flowType:'pkce',detectSessionInUrl:false,persistSession:true,autoRefreshToken:false}});
 const session=await client.auth.getSession();
 if(session.error||!session.data?.session){signIn();return;}
 login.hidden=true;button.hidden=false;button.disabled=false;status.textContent='Ready. Click Run read-only check once. Nothing runs automatically.';
}catch{status.textContent='Website sign-in could not be checked. Stop and report this message.';}})();
})();
