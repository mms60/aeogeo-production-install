/* AEOGEO cookie preferences. Essential site features do not depend on this choice. */
(()=>{
 'use strict';
 if(window.AEOGEOCookieConsent)return;
 const KEY='aeogeo-cookie-visit-v1',VISIT_MS=30*60*1000,DISABLED='ga-disable-G-RTYB910TMQ';
 window[DISABLED]=true;
 let choice='unknown',lastActivity=Date.now(),expiryTimer,storageWorks=true,banner,trigger,previousFocus,resizeObserver,lastWrite=0;
 function read(){try{const raw=sessionStorage.getItem(KEY);if(!raw)return;const saved=JSON.parse(raw),now=Date.now();if(saved.version===1&&['allowed','rejected'].includes(saved.choice)&&Number.isFinite(saved.lastActivity)&&saved.lastActivity<=now&&now-saved.lastActivity<VISIT_MS){choice=saved.choice;lastActivity=saved.lastActivity;}}catch{try{sessionStorage.removeItem(KEY);}catch{storageWorks=false;}}}
 function save(){if(!storageWorks)return;try{sessionStorage.setItem(KEY,JSON.stringify({version:1,choice,lastActivity}));lastWrite=Date.now();}catch{storageWorks=false;}}
 function clearAnalyticsCookies(){
  try{
   const names=document.cookie.split(';').map(s=>s.trim().split('=')[0]).filter(n=>/^_ga(?:_|$)/.test(n)||n==='_gid'||/^_gat(?:_|$)/.test(n));
   const host=location.hostname,domains=['',host,'.'+host];if(host==='aeogeosearch.com'||host.endsWith('.aeogeosearch.com'))domains.push('aeogeosearch.com','.aeogeosearch.com');
   const paths=new Set(['/']);let prefix='';for(const part of location.pathname.split('/').filter(Boolean)){prefix+='/'+part;paths.add(prefix);paths.add(prefix+'/');}
   for(const name of names)for(const domain of new Set(domains))for(const path of paths)document.cookie=name+'=; Max-Age=0; Expires=Thu, 01 Jan 1970 00:00:00 GMT; Path='+path+(domain?'; Domain='+domain:'')+'; SameSite=Lax'+(location.protocol==='https:'?'; Secure':'');
  }catch{/* Never clear essential cookies, storage or account sessions. */}
 }
 function notify(){if(choice!=='allowed'){window[DISABLED]=true;clearAnalyticsCookies();}dispatchEvent(new CustomEvent('aeogeo:consent-change',{detail:{analytics:choice==='allowed'}}));}
 function measure(){if(!banner)return;const height=banner.hidden?(trigger.hidden?0:trigger.getBoundingClientRect().height+20):banner.getBoundingClientRect().height+12;document.body.style.setProperty('--aeogeo-cookie-clearance',Math.ceil(height)+'px');}
 function show(focus=false){if(!banner)return;previousFocus=document.activeElement;banner.hidden=false;trigger.hidden=true;measure();if(focus)banner.querySelector('[data-cookie-action="reject"]').focus({preventScroll:true});}
 function hide(){if(!banner)return;const focusWasInside=banner.contains(document.activeElement);banner.hidden=true;trigger.hidden=false;measure();if(focusWasInside){const target=previousFocus&&previousFocus!==document.body&&previousFocus.isConnected&&!banner.contains(previousFocus)?previousFocus:trigger;target.focus({preventScroll:true});}}
 function arm(){clearTimeout(expiryTimer);expiryTimer=setTimeout(expire,Math.max(1,VISIT_MS-(Date.now()-lastActivity)));}
 function expire(){if(Date.now()-lastActivity<VISIT_MS){arm();return;}choice='unknown';lastActivity=Date.now();save();notify();show(false);arm();}
 function touch(){const now=Date.now();if(now-lastActivity>=VISIT_MS)expire();lastActivity=now;if(now-lastWrite>=5000)save();arm();}
 function decide(next){choice=next;lastActivity=Date.now();save();notify();hide();arm();}
 read();if(choice!=='allowed')clearAnalyticsCookies();
 window.AEOGEOCookieConsent=Object.freeze({allowsAnalytics:()=>choice==='allowed'&&Date.now()-lastActivity<VISIT_MS,getChoice:()=>Date.now()-lastActivity<VISIT_MS?choice:'unknown',open:()=>show(true)});
 function mount(){
  if(!document.body||document.getElementById('aeogeo-cookie-banner'))return;
  const basePadding=getComputedStyle(document.body).paddingBottom;document.body.style.setProperty('--aeogeo-cookie-base-padding',basePadding);document.body.setAttribute('data-aeogeo-cookie-ui','');
  banner=document.createElement('section');banner.id='aeogeo-cookie-banner';banner.setAttribute('role','region');banner.setAttribute('aria-labelledby','aeogeo-cookie-title');banner.hidden=choice!=='unknown';
  banner.innerHTML='<div class="aeogeo-cookie-inner"><div class="aeogeo-cookie-copy"><h2 id="aeogeo-cookie-title">Your cookie choices</h2><p>Essential cookies keep the site working. Google Analytics is optional and only runs with your permission. Reject or close to keep it off. You can change your choice anytime. We ask again on your next visit. <a href="/privacy-policy">Privacy Policy</a></p></div><div class="aeogeo-cookie-actions"><button type="button" data-cookie-action="reject">Reject Analytics</button><button type="button" data-cookie-action="allow">Allow Analytics</button></div></div><button type="button" class="aeogeo-cookie-close" data-cookie-action="close" aria-label="Close cookie banner and reject analytics"><span aria-hidden="true">\u00d7</span></button>';
  trigger=document.createElement('button');trigger.type='button';trigger.id='aeogeo-cookie-preferences';trigger.textContent='Cookie Preferences';trigger.setAttribute('aria-controls',banner.id);trigger.hidden=!banner.hidden;
  document.body.append(banner,trigger);banner.addEventListener('click',event=>{const button=event.target.closest('button[data-cookie-action]');if(button)decide(button.dataset.cookieAction==='allow'?'allowed':'rejected');});
  banner.addEventListener('keydown',event=>{if(event.key==='Escape'){event.preventDefault();decide('rejected');}});trigger.addEventListener('click',()=>show(true));
  if('ResizeObserver'in window){resizeObserver=new ResizeObserver(measure);resizeObserver.observe(banner);resizeObserver.observe(trigger);}addEventListener('resize',measure);measure();
 }
 if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',mount,{once:true});else mount();
 for(const event of ['pointerdown','keydown','scroll'])addEventListener(event,touch,{passive:true});
 document.addEventListener('visibilitychange',()=>{if(document.visibilityState==='visible')touch();});addEventListener('pageshow',()=>{if(Date.now()-lastActivity>=VISIT_MS)expire();else notify();measure();});
 arm();notify();
})();
