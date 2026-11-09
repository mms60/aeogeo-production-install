/* Google tag G-RTYB910TMQ. Opt-in only, public pages only; no customer/account/audit events. */
(()=>{
 'use strict';
 const id='G-RTYB910TMQ',key='__aeogeoPublicAnalytics',disabled='ga-disable-'+id;
 if(window[key])return;window[key]=true;window[disabled]=true;
 function privateURL(value){
  try{
   const u=new URL(value,location.href),path=decodeURIComponent(u.pathname).replace(/\/index\.html$/i,'/').replace(/\.html$/i,'').replace(/\/+$/,'').toLowerCase()||'/';
   if(/^\/(?:login|auth|account|checkout|service-checkout|content-order|content-review|admin|dashboard|content-portal|owner-billing-check|owner-monthly-test)(?:\/|$)/.test(path)||/^\/geo-audit\/run(?:\/|$)/.test(path))return true;
   for(const name of [...u.searchParams.keys(),...new URLSearchParams(u.hash.slice(1)).keys()])if(/^(?:access_token|refresh_token|token|code|job|report|order|order_id|session_id|customer|customer_id|email)$/i.test(name))return true;
   return false;
  }catch{return true;}
 }
 function clean(value){if(!value)return '';try{const u=new URL(value,location.origin);return u.origin+u.pathname;}catch{return '';}}
 function allowed(){try{return window.AEOGEOCookieConsent?.allowsAnalytics()===true;}catch{return false;}}
 const consentOptions=granted=>({analytics_storage:granted?'granted':'denied',ad_storage:'denied',ad_user_data:'denied',ad_personalization:'denied'});
 let started=false,consentGranted=false,last='',initial=true;
 function consent(granted){if(!started||consentGranted===granted)return;window.gtag('consent','update',consentOptions(granted));consentGranted=granted;}
 function sync(){
  try{
   const blocked=!allowed()||privateURL(location.href);window[disabled]=blocked;
   if(blocked){consent(false);last='';return;}
   if(!started){
    started=true;window.dataLayer=window.dataLayer||[];window.gtag=window.gtag||function(){window.dataLayer.push(arguments);};
    window.gtag('consent','default',consentOptions(false));window.gtag('set',{ads_data_redaction:true,url_passthrough:false});consent(true);window.gtag('js',new Date());
   }else consent(true);
   const page=clean(location.href);if(page!==last){last=page;const options={page_location:page,page_referrer:document.referrer&&!privateURL(document.referrer)?clean(document.referrer):'',allow_google_signals:false,allow_ad_personalization_signals:false};if(!initial)options.send_page_view=false;window.gtag('config',id,options);initial=false;}
   if(!document.querySelector('script[data-aeogeo-google-tag="'+id+'"]')){const script=document.createElement('script');script.async=true;script.src='https://www.googletagmanager.com/gtag/js?id='+id;script.referrerPolicy='origin';script.setAttribute('data-aeogeo-google-tag',id);document.head.append(script);}
  }catch{window[disabled]=true;/* Optional Analytics must never block customer tools. */}
 }
 // These guards run before the router can publish a private destination to Google.
 for(const method of ['pushState','replaceState']){const original=history[method];history[method]=function(...args){try{window[disabled]=!allowed()||privateURL(args[2]===undefined?location.href:new URL(args[2],location.href).href);}catch{window[disabled]=true;}try{return Reflect.apply(original,this,args);}finally{sync();}};}
 addEventListener('popstate',sync);addEventListener('aeogeo:consent-change',sync);addEventListener('pageshow',sync);sync();
})();
