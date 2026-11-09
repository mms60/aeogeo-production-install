'use strict';
const crypto = require('node:crypto');
const {databaseDiagnostic} = require('./db-diagnostics');
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
function config() {
 const url = process.env.SUPABASE_URL?.trim();
 const key = process.env.SUPABASE_SERVICE_ROLE_KEY?.trim();
 if (!url || !key) throw Object.assign(new Error('The audit service connection is not configured. Contact the website owner. Reference: BACKEND_CONNECTION.'),{status:503,code:'backend_configuration'});
 try{const u=new URL(url);if(u.protocol!=='https:'||u.username||u.password||u.search||u.hash)throw Error();}catch{throw Object.assign(new Error('The audit service connection URL is invalid. Contact the website owner. Reference: BACKEND_URL.'),{status:503,code:'backend_configuration'});}
 return {url: url.replace(/\/$/, ''), key};
}
async function db(path, {method='GET', body, headers={}}={}) {
 const {url,key} = config();
 const response = await fetch(url+'/rest/v1/'+path, {method, headers: {apikey:key, ...(key.startsWith('sb_secret_')?{}:{Authorization:'Bearer '+key}), 'Content-Type':'application/json', ...headers}, body:body===undefined?undefined:JSON.stringify(body), signal:AbortSignal.timeout(15000)});
 const text = await response.text();
 if (!response.ok) { console.error('Database request failed',response.status,path.split('?')[0],JSON.stringify(databaseDiagnostic({key,url,text,status:response.status,headers,context:process.env.CONTEXT}))); throw Object.assign(new Error(response.status===401||response.status===403?'Your website sign-in is separate from the audit database connection. The website owner needs to check the server database key. Reference: BACKEND_DATABASE.':'The audit database could not complete this request. Please retry or contact the website owner. Your saved reports have not been removed.'),{status:503,code:'backend_database'}); }
 return text ? JSON.parse(text) : null;
}
// The browser and server verify website sessions against the same PUBLIC key.
// This is not the private key used for database administration.
const AUTH_PUBLIC_KEY='sb_publishable_0T08Pe4A0ZvoHD5CXrd1iA_BvUyVxAO';
const serviceError=(code,message)=>Object.assign(new Error(message),{status:503,code});
async function user(event) {
 const {url}=config();
 const token=(event.headers?.authorization||event.headers?.Authorization||'').match(/^Bearer (.+)$/i)?.[1];
 if (!token) throw Object.assign(new Error('Please sign in.'), {status:401,code:'sign_in_required'});
 let r;
 try{r=await fetch(url+'/auth/v1/user',{headers:{apikey:AUTH_PUBLIC_KEY,Authorization:'Bearer '+token},signal:AbortSignal.timeout(10000)});}
 catch{throw serviceError('auth_connection_unavailable','The website sign-in service could not be reached. Please retry. This does not mean your session has ended.');}
 if(!r.ok){
  let details={};try{details=await r.json();}catch{}
  const description=String(details.message||details.msg||details.error_description||details.error||'');
  if(/(?:invalid|missing|no|not found|incorrect).{0,24}api[ _-]?key|api[ _-]?key.{0,24}(?:invalid|missing|not found|incorrect)/i.test(description))
   throw serviceError('auth_configuration','The website sign-in service is not connected correctly. Please contact the website owner. Reference: AUTH_CONNECTION.');
  if(r.status===401)throw Object.assign(new Error('Your session has ended. Please sign in again.'),{status:401,code:'session_expired'});
  if(r.status===403)throw Object.assign(new Error('This account cannot access the audit service. Please confirm your email or contact support.'),{status:403,code:'account_access_denied'});
  throw serviceError('auth_connection_unavailable','The website sign-in service is temporarily unavailable. Please retry. Your saved reports have not been removed.');
 }
 let u;try{u=await r.json();}catch{throw serviceError('auth_response_invalid','The sign-in service returned an unreadable response. Please retry.');}
 if(!UUID.test(u?.id||''))throw serviceError('auth_response_invalid','The sign-in service returned an invalid account response. Please contact support.');
 if(!u.email_confirmed_at)throw Object.assign(new Error('Please confirm your email first.'),{status:403,code:'email_confirmation_required'});
 return u;
}
function reply(status,body){return{statusCode:status,headers:{'Content-Type':'application/json','Cache-Control':'no-store','X-Content-Type-Options':'nosniff'},body:JSON.stringify(body)};}
function signature(id,time){return crypto.createHmac('sha256',config().key).update(id+':'+time).digest('hex');}
function verifySignature(id,time,sig){if(!UUID.test(id||'')||!/^\d+$/.test(time||'')||Math.abs(Date.now()-Number(time))>300000||!/^[0-9a-f]{64}$/i.test(sig||''))return false; return crypto.timingSafeEqual(Buffer.from(signature(id,time),'hex'),Buffer.from(sig,'hex'));}
module.exports={db,user,reply,signature,verifySignature,UUID};
