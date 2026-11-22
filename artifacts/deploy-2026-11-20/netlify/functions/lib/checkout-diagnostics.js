'use strict';
// Finite private diagnostic labels only. Never log raw errors, keys, URLs or IDs.
const STAGES=new Set(['authenticate','parse_request','check_readiness','read_plan_catalog','read_existing_subscription','validate_price','claim_checkout','create_customer','record_customer','list_subscriptions','load_existing_session','validate_claim_plan','validate_claim_price','resolve_return_origin','create_session','validate_session','bind_session','expire_old_session','reset_checkout']);
const CODES=new Set(['ERR_INVALID_URL','ERR_INVALID_ARG_TYPE','ERR_INVALID_CHAR','UND_ERR_INVALID_ARG','UND_ERR_CONNECT_TIMEOUT','UND_ERR_HEADERS_TIMEOUT','UND_ERR_BODY_TIMEOUT','ECONNRESET','ECONNREFUSED','ENOTFOUND','ETIMEDOUT','EAI_AGAIN','CERT_HAS_EXPIRED','DEPTH_ZERO_SELF_SIGNED_CERT']);
function checkoutDiagnostic(error,stage){
 try{
  const safeStage=STAGES.has(stage)?stage:'unknown';
  const name=['Error','TypeError','ReferenceError','SyntaxError','RangeError','AbortError','TimeoutError'].includes(error?.name)?error.name:'OtherError';
  const candidate=CODES.has(error?.code)?error.code:CODES.has(error?.cause?.code)?error.cause.code:'not_available';
  const message=typeof error?.message==='string'?error.message:'';
  let reason='unclassified_exception';
  if(Number.isInteger(error?.status)&&error.status>=400&&error.status<=599)reason='handled_request_error';
  else if(candidate==='ERR_INVALID_URL')reason='invalid_url';
  else if(['ERR_INVALID_CHAR','UND_ERR_INVALID_ARG'].includes(candidate)||/invalid.*header|header.*invalid/i.test(message))reason='invalid_request_header';
  else if(candidate!=='not_available'||message==='fetch failed')reason='network_or_transport_error';
  else if(name==='TimeoutError'||name==='AbortError')reason='request_timeout_or_abort';
  else if(name==='SyntaxError')reason='response_or_data_parse_error';
  else if(message==='Stripe is not configured.')reason='stripe_configuration_missing';
  else if(message==='The payment service could not complete the request.')reason='stripe_request_rejected';
  else if(/is not a function/.test(message))reason='dependency_not_callable';
  else if(/Cannot read properties of (?:undefined|null)/.test(message))reason='missing_expected_data';
  else if(name==='ReferenceError')reason='undefined_identifier';
  const rawStack=typeof error?.stack==='string'?error.stack:'';
  const match=rawStack.match(/[/\\]((?:create-checkout|checkout|stripe|db|billing-objects)\.js):(\d{1,7}):(\d{1,7})/);
  return {revision:'checkout-diagnostic-v1',stage:safeStage,reference:'CHECKOUT_'+safeStage.toUpperCase(),exception:name,code:candidate,reason,
   frame:match?{file:match[1],line:Number(match[2]),column:Number(match[3])}:null};
 }catch{return {revision:'checkout-diagnostic-v1',stage:'unknown',reference:'CHECKOUT_UNKNOWN',exception:'OtherError',code:'not_available',reason:'diagnostic_unavailable',frame:null};}
}
module.exports={checkoutDiagnostic};
