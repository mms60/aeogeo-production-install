'use strict';
const crypto=require('node:crypto');
const {requireStripeCredential}=require('./stripe-credential');
async function stripe(path,{method='GET',data,idempotency}={}){
 const {key}=requireStripeCredential();
 const form=new URLSearchParams();for(const [k,v] of Object.entries(data||{}))if(v!==undefined&&v!==null)form.set(k,String(v));
 let r;try{r=await fetch('https://api.stripe.com/v1/'+path,{method,headers:{Authorization:'Bearer '+key,'Stripe-Version':'2025-02-24.acacia',...(method==='POST'?{'Content-Type':'application/x-www-form-urlencoded'}:{}),...(idempotency?{'Idempotency-Key':idempotency}:{})},body:method==='POST'?form.toString():undefined,signal:AbortSignal.timeout(20000)});}catch{throw Object.assign(new Error('Stripe could not be reached. Reference: PAYMENT_STRIPE_NETWORK.'),{status:503,code:'PAYMENT_STRIPE_NETWORK'});}
 let body;try{body=await r.json();}catch{throw Object.assign(new Error('Stripe returned an unreadable response. Reference: PAYMENT_STRIPE_RESPONSE.'),{status:503,code:'PAYMENT_STRIPE_RESPONSE'});}
 if(!r.ok){const code=r.status===401?'PAYMENT_STRIPE_AUTH':r.status===403?'PAYMENT_STRIPE_PERMISSIONS':r.status===429?'PAYMENT_STRIPE_BUSY':'PAYMENT_STRIPE_REQUEST';const message=r.status===401?'Stripe rejected the server credential.':r.status===403?'Stripe denied this API operation.':r.status===429?'Stripe is temporarily limiting requests.':'Stripe could not complete this operation.';console.error('Stripe request failed',r.status,code);throw Object.assign(new Error(message+' Reference: '+code+'.'),{status:503,code});}return body;
}
function verifyWebhook(raw,header,secret,now=Date.now()){
 if(!secret||!header)return false;const parts=header.split(',').map(x=>x.split('='));const t=parts.find(x=>x[0]==='t')?.[1];if(!/^\d+$/.test(t||'')||Math.abs(now/1000-Number(t))>300)return false;
 const expected=crypto.createHmac('sha256',secret).update(t+'.').update(raw).digest();return parts.filter(x=>x[0]==='v1').some(x=>{try{const b=Buffer.from(x[1],'hex');return b.length===expected.length&&crypto.timingSafeEqual(b,expected);}catch{return false;}});
}
function origin(){const u=new URL(process.env.PUBLIC_SITE_URL||process.env.URL||'');if(u.protocol!=='https:'||u.username||u.password)throw new Error('Canonical HTTPS site URL is missing.');return u.origin;}
module.exports={stripe,verifyWebhook,origin};
