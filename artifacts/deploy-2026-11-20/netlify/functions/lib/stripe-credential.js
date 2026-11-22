'use strict';
// Never log or serialize a credential. Diagnostics below contain fixed codes only.
function normalizedStripeKey(env=process.env){
 const raw=env.STRIPE_SECRET_KEY;if(typeof raw!=='string')return '';
 let key=raw.trim();
 if(key.length>=2&&((key[0]==='"'&&key.at(-1)==='"')||(key[0]==="'"&&key.at(-1)==="'")))key=key.slice(1,-1).trim();
 return key;
}
function stripeKeyInfo(env=process.env){
 const key=normalizedStripeKey(env);
 if(!key)return {mode:null,kind:null,code:'PAYMENT_KEY_MISSING'};
 if(key.includes('*'))return {mode:null,kind:null,code:'PAYMENT_KEY_MASKED'};
 if(key.startsWith('sk_org_'))return {mode:null,kind:'organization',code:'PAYMENT_KEY_ORGANIZATION'};
 if(/^pk_(live|test)_/.test(key))return {mode:null,kind:'publishable',code:'PAYMENT_KEY_PUBLISHABLE'};
 const m=/^(sk|rk)_(live|test)_[A-Za-z0-9_]+$/.exec(key);
 if(!m)return {mode:null,kind:null,code:'PAYMENT_KEY_FORMAT'};
 return {mode:m[2],kind:m[1]==='rk'?'restricted':'secret',code:null};
}
function stripeKeyMode(env=process.env){return stripeKeyInfo(env).mode;}
function requireStripeCredential(env=process.env){
 const info=stripeKeyInfo(env);
 if(info.code){
  const messages={
   PAYMENT_KEY_MISSING:'The running payment function has no Stripe server key. Reference: PAYMENT_KEY_MISSING.',
   PAYMENT_KEY_MASKED:'The running payment function received a masked placeholder instead of a Stripe server key. Reference: PAYMENT_KEY_MASKED.',
   PAYMENT_KEY_ORGANIZATION:'This integration requires an account-level Stripe server key, not an organization key. Reference: PAYMENT_KEY_ORGANIZATION.',
   PAYMENT_KEY_PUBLISHABLE:'The payment function received a publishable key instead of a server key. Reference: PAYMENT_KEY_PUBLISHABLE.',
   PAYMENT_KEY_FORMAT:'The running payment function received an unrecognized Stripe server-key format. Reference: PAYMENT_KEY_FORMAT.'
  };
  throw Object.assign(new Error(messages[info.code]),{status:503,code:info.code});
 }
 return {key:normalizedStripeKey(env),mode:info.mode,kind:info.kind};
}
module.exports={normalizedStripeKey,stripeKeyInfo,stripeKeyMode,requireStripeCredential};
