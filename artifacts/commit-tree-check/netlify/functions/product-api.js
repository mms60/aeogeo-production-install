'use strict';
const {db,user,reply,UUID} = require('./lib/db');
const {billingReady,publicPlans,billingMode,billingAdmin,sandboxCheckout} = require('./lib/plans');
const {configuredBillingSync} = require('./lib/billing-sync');
const {configuredReadiness}=require('./lib/audit-checkout-readiness');
exports.handler = async event => {try {
 const action = event.queryStringParameters?.action || 'account';
 if (action === 'config'){const configuration=await configuredReadiness().check();return reply(200, {billingRevision:'payments-test-v2',accessRevision:'audit-purchase-v2',authProjectMatchesSite:(process.env.SUPABASE_URL||'').trim().replace(/\/$/,'')==='https://ftwohoenimegsmtliqgz.supabase.co',billingReady:configuration.ready&&!billingReady(),billingNotice:configuration.ready?billingReady():configuration.message,auditCheckoutConfiguration:configuration,advancedReady:process.env.ADVANCED_PLANS_READY==='true',limitsApproved:process.env.PLAN_LIMITS_APPROVED==='true',plans:publicPlans()});}
 const u = await user(event);
 // Recover interrupted reservations before eligibility is shown or a job is polled.
 // The service-only RPC uses the same 20-minute cutoff as geo_reserve_job.
 if(['account','report'].includes(action))await db('rpc/geo_recover_audit_jobs',{method:'POST',body:{p_user:u.id}});
 if (action === 'account') {
  await configuredBillingSync().account(u.id);
  const checkoutConfiguration=await configuredReadiness().check();
  const [accounts,subs,jobs,legacy,domains,holds] = await Promise.all([
   db('aeogeo_audit_accounts?user_id=eq.'+u.id+'&select=free_audit_consumed_at'),
   db('geo_subscriptions?user_id=eq.'+u.id+'&select=plan,status,paid_through,billing_mode,subscription_id,cancel_at_period_end'),
   db('geo_jobs?user_id=eq.'+u.id+'&select=id,target_url,status,created_at,page_count,credit_source,error_message,progress&order=created_at.desc&limit=40'),
   db('aeogeo_audit_jobs?user_id=eq.'+u.id+'&select=id,target_url,status,reserved_at,error_message&order=reserved_at.desc&limit=10'),
   db('geo_domains?user_id=eq.'+u.id+'&select=hostname'),
   db('geo_billing_holds?user_id=eq.'+u.id+'&billing_mode=eq.'+(billingMode()||'live')+'&active=eq.true&select=kind,subscription_id,expires_at,reason')]);
  const sub = subs[0] || null;
  const blocked = holds.find(h => (!h.expires_at || Date.parse(h.expires_at)>Date.now()) && (h.kind==='dispute' || h.subscription_id===sub?.subscription_id));
  const active = !!sub && sub.billing_mode===billingMode() && ['active','past_due','canceled'].includes(sub.status) && Date.parse(sub.paid_through)>Date.now() && !blocked;
  const periods = await db('geo_usage_periods?user_id=eq.'+u.id+'&period_start=lte.'+encodeURIComponent(new Date().toISOString())+'&period_end=gt.'+encodeURIComponent(new Date().toISOString())+'&select=period_start,period_end,used_pages,reserved_pages&order=period_start.desc&limit=1');
  return reply(200, {email:u.email,verified:!!u.email_confirmed_at,freeUsed:!!accounts[0]?.free_audit_consumed_at,subscription:sub,paidActive:active,
   billingHold:blocked?.reason||null,billingMode:billingMode(),sandboxCheckout:sandboxCheckout('starter',u.email),billingAdmin:billingAdmin(u.email),
   period:periods[0]||null,jobs,legacy,domains,plans:publicPlans(),checkoutPlans:checkoutConfiguration.ready?Object.keys(publicPlans()).filter(id=>!billingReady(id,u.email)):[],billingNotice:checkoutConfiguration.ready?billingReady('starter',u.email):checkoutConfiguration.message,billingReady:checkoutConfiguration.ready&&!billingReady('starter',u.email)});
 }
 if (action === 'report') {
  const id=event.queryStringParameters.id;if(!UUID.test(id||''))return reply(400,{error:'Invalid report ID.'});
  const legacy=event.queryStringParameters.legacy==='1';const rows=await db((legacy?'aeogeo_audit_jobs':'geo_jobs')+'?id=eq.'+id+'&user_id=eq.'+u.id+'&select=id,target_url,status,report,error_message'+(legacy?'':',progress'));
  if(!rows.length)return reply(404,{error:'Report not found.'});return reply(200,rows[0]);
 }
 return reply(404,{error:'Unknown request.'});
} catch(e) {console.error('product-api',e.status||'internal',e.code||'request_failed');return reply(e.status||500,{error:e.status?e.message:'Account data could not load. Please retry or contact support.',code:e.code||undefined});}};
