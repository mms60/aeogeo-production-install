'use strict';
const {db,user,reply,UUID,signature}=require('./lib/db');const {normalURL}=require('./lib/crawler');
const {billingMode,testBillingAllowed}=require('./lib/plans');
const {configuredBillingSync}=require('./lib/billing-sync');
const {origin}=require('./lib/stripe');
exports.handler=async event=>{if(event.httpMethod!=='POST')return reply(405,{error:'POST required.'});try{
 const u=await user(event);const b=JSON.parse(event.body||'{}');if(!UUID.test(b.requestId||''))return reply(400,{error:'Invalid request identifier.'});let target;try{target=normalURL(b.url);}catch(e){return reply(400,{error:e.message});}
 const [subscription]=await db('geo_subscriptions?user_id=eq.'+u.id+'&select=billing_mode');
 if(subscription?.billing_mode==='test'&&!testBillingAllowed(u.email))return reply(403,{error:'Test paid audits are restricted to the configured website test account.'});
 await configuredBillingSync().account(u.id);
 const job=await db('rpc/geo_reserve_job',{method:'POST',body:{p_user:u.id,p_billing_mode:billingMode()||'live',p_request:b.requestId,p_url:target.href,p_host:target.hostname.replace(/^www\./,''),p_pages:Math.max(1,Math.min(25,Number(b.pages)||25))}});
 if(!job.allowed){const messages={billing_hold:'New paid audits are paused because this account has a billing hold. Saved reports remain available.',subscription_required:'Your free audit is complete. Check your account for available billing options. Your saved reports remain available.',page_limit_reached:'Your page-analysis allowance is used for this period. No overage was charged.',domain_limit_reached:'Your plan’s active domain allowance has been reached.',plan_not_ready:'This plan is not approved for paid audits yet.',audit_running:'An audit is already running. Check your reports.'};return reply(402,{code:job.reason,error:messages[job.reason]||'Audit not available.'});}
 if(job.status==='failed')return reply(409,{code:'audit_failed',error:'That audit did not complete. Its unused reservation was restored. Please try again.'});
 if(job.status==='queued'){
 const time=String(Date.now()),site=origin();
 try{const r=await fetch(site.replace(/\/$/,'')+'/.netlify/functions/run-audit-background',{method:'POST',headers:{'Content-Type':'application/json','X-Audit-Time':time,'X-Audit-Signature':signature(job.id,time)},body:JSON.stringify({id:job.id}),signal:AbortSignal.timeout(15000)});if(!r.ok)throw new Error('Dispatch failed');}catch{
  console.warn('Dispatch not confirmed',job.id);
  // Do not leave a failed dispatch holding credit. A worker that already claimed
  // the job wins: the RPC never cancels a fresh running or completed job.
  const recovered=await db('rpc/geo_recover_audit_jobs',{method:'POST',body:{p_user:u.id,p_undispatched:job.id}});
  if(recovered?.job_status==='failed')return reply(503,{code:'audit_dispatch_failed',error:'The audit could not start. Its unused reservation was restored. Please try again.'});
  if(recovered?.job_status)job.status=recovered.job_status;
 }
 }
 return reply(202,job);
 }catch(e){console.error('start-audit',e.message);return reply(e.status||500,{error:e.status?e.message:'Could not start the audit. Check the product database migration and server settings.'});}};
