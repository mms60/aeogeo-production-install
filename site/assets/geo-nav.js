(()=>{window.addEventListener('click',e=>{if(e.defaultPrevented||e.button!==0||e.metaKey||e.ctrlKey||e.shiftKey||e.altKey)return;const a=e.target.closest?.('a[href]');if(!a)return;const u=new URL(a.href,location.href);if(u.origin===location.origin&&u.pathname.replace(/\/$/,'')==='/geo-audit'){e.preventDefault();e.stopImmediatePropagation();location.assign(u.href);}},true);})();
/* Services consultation anchor. Retains all existing navigation and form handlers. */
(()=>{
 'use strict';
 const id='services-consultation-form',hash='#'+id,seen=new WeakSet();
 const onServices=()=>location.pathname.replace(/\/+$/,'')==='/services';
 let queued=false;
 function parts(){
  if(!onServices())return {};
  const heading=document.querySelector('main h1'),hero=heading?.closest('section');
  const link=hero&&[...hero.querySelectorAll('a')].find(a=>a.textContent.trim()==='Request a Consultation');
  const form=document.querySelector('main form[name="contact"]');
  return {hero,link,form};
 }
 function jump(focus=false){
  const {form}=parts();if(!form)return;
  form.scrollIntoView({block:'start',behavior:matchMedia('(prefers-reduced-motion: reduce)').matches?'auto':'smooth'});
  if(focus)form.focus({preventScroll:true});
 }
 function sync(){
  queued=false;const {link,form}=parts();if(!link||!form)return;
  link.setAttribute('href',hash);
  form.id=id;form.tabIndex=-1;form.style.scrollMarginTop='100px';
  if(!seen.has(form)){seen.add(form);if(location.hash===hash)requestAnimationFrame(()=>jump());}
 }
 function schedule(){if(!queued&&onServices()){queued=true;requestAnimationFrame(sync);}}
 window.addEventListener('click',e=>{
  if(e.defaultPrevented||e.button!==0||e.metaKey||e.ctrlKey||e.shiftKey||e.altKey||!onServices())return;
  const a=e.target.closest?.('a');if(!a)return;
  const {link,form}=parts();if(a!==link||!form)return;
  sync();e.preventDefault();e.stopImmediatePropagation();
  if(location.hash!==hash)location.hash=hash;
  requestAnimationFrame(()=>jump(true));
 },true);
 window.addEventListener('hashchange',()=>{if(onServices()&&location.hash===hash)requestAnimationFrame(()=>jump());});
 window.addEventListener('popstate',schedule);
 if(document.body)new MutationObserver(schedule).observe(document.body,{childList:true,subtree:true});
 sync();
})();

/* Humanizer standalone navigation v1 */
(()=>{addEventListener('click',e=>{if(e.defaultPrevented||e.button!==0||e.metaKey||e.ctrlKey||e.shiftKey||e.altKey)return;const a=e.target.closest?.('a[href]');if(!a)return;const u=new URL(a.href,location.href);if(u.origin===location.origin&&u.pathname.replace(/\/$/,'')==='/ai-content-humanizer'){e.preventDefault();e.stopImmediatePropagation();location.assign(u.href);}},true);})();

/* AEOGEO standalone tool nav v1 */
(()=>{window.addEventListener("click",e=>{if(e.defaultPrevented||e.button!==0||e.metaKey||e.ctrlKey||e.shiftKey||e.altKey)return;const a=e.target.closest?.("a[href]");if(!a)return;let u;try{u=new URL(a.href,location.href);}catch{return;}if(u.origin!==location.origin)return;const p=u.pathname.replace(/\/+$/,"");if(p==="/geo-audit"||p==="/competitor-intelligence"||p==="/ai-content-humanizer"){e.preventDefault();e.stopImmediatePropagation();location.assign(u.href);}},true);})();
