'use strict';
// Private error-log metadata only. Never return keys, claims, messages, details or hashes.
const EXPECTED_URL='https://ftwohoenimegsmtliqgz.supabase.co';
function classifyResponse(text,status){
 let body;try{body=JSON.parse(String(text).slice(0,16384));}catch{return{reason:'non_json_upstream_error',upstreamCode:'not_available'};}
 const rawCode=typeof body?.code==='string'?body.code:'';
 const upstreamCode=/^PGRST\d{3}$/.test(rawCode)||['42501','42P01','42703','3F000','28000','28P01','22023'].includes(rawCode)?rawCode:'not_available';
 const description=[body?.message,body?.msg,body?.error,body?.details].filter(v=>typeof v==='string').join(' ');
 let reason='unclassified_upstream_error';
 if(rawCode==='42501')reason='database_permission_denied';
 else if(/secret.*(?:browser|browsers)/i.test(description))reason='secret_key_browser_restriction';
 else if(/invalid api[ _-]?key/i.test(description))reason='invalid_api_key';
 else if(/no api[ _-]?key|missing api[ _-]?key/i.test(description))reason='missing_api_key';
 else if(/(?:jwt|token).{0,30}expired|expired.{0,30}(?:jwt|token)/i.test(description))reason='expired_token';
 else if(rawCode==='PGRST301'||rawCode==='PGRST303')reason='token_validation_failed';
 else if(rawCode==='PGRST302')reason='anonymous_access_disallowed';
 else if(/invalid.{0,20}(?:jwt|token)|(?:jwt|token).{0,20}invalid/i.test(description))reason='invalid_token';
 else if(/permission denied/i.test(description))reason='permission_denied';
 else if(['42P01','42703','3F000','PGRST204','PGRST205'].includes(rawCode))reason='schema_error';
 return{reason,upstreamCode};
}
function credentialMetadata(key){
 const text=typeof key==='string'?key.trim():'';
 const result={credentialType:'unrecognized',secretFormatValid:false,legacyRole:'not_applicable',legacyProject:'not_applicable',legacyExpired:'not_applicable'};
 if(!text){result.credentialType='missing';return result;}
 if(/\*{3,}|\.{3}|\u2026/.test(text)||/^(?:\[?redacted\]?|\[?secret\]?|<[^>]+>)$/i.test(text)){result.credentialType='masked_or_placeholder';return result;}
 if(text.startsWith('sb_secret_')){result.credentialType='modern_secret';result.secretFormatValid=/^sb_secret_[A-Za-z0-9_-]+$/.test(text);return result;}
 if(text.startsWith('sb_publishable_')){result.credentialType='publishable_not_server_secret';return result;}
 if(text.startsWith('eyJ')&&text.length<=16384){
  result.credentialType='legacy_jwt';result.legacyRole='not_readable';result.legacyProject='not_available';result.legacyExpired='not_available';
  try{
   const claim=JSON.parse(Buffer.from(text.split('.')[1]||'','base64url').toString('utf8'));
   result.legacyRole=['service_role','anon','authenticated'].includes(claim.role)?claim.role:'other';
   if(typeof claim.ref==='string')result.legacyProject=claim.ref==='ftwohoenimegsmtliqgz'?'matches':'differs';
   if(typeof claim.exp==='number')result.legacyExpired=claim.exp*1000<=Date.now()?'yes':'no';
  }catch{}
 }
 return result;
}
function databaseDiagnostic({key,url,text,status,context,headers={}}){
 try{
  const override=Object.keys(headers).some(k=>['authorization','apikey'].includes(k.toLowerCase()));
  return{revision:'db-diagnostic-v1',...classifyResponse(text,status),...credentialMetadata(key),databaseProjectMatches:String(url).replace(/\/$/,'')===EXPECTED_URL,
   authorizationHeaderMode:override?'caller_override':String(key).startsWith('sb_secret_')?'apikey_only':'apikey_and_bearer',
   deploymentContext:['production','deploy-preview','branch-deploy','dev'].includes(context)?context:'not_provided'};
 }catch{return{revision:'db-diagnostic-v1',reason:'diagnostic_unavailable'};}
}
module.exports={databaseDiagnostic,classifyResponse,credentialMetadata};
