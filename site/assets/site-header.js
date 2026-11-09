/* site-header-v2: multi-dropdown shared navigation (`AI Audit Tools` + `Free Audit Tools`). No authentication, audit or billing requests. */
(()=>{'use strict';
 const header=document.querySelector('.website-header');if(!header)return;
 const toggle=document.getElementById('site-navigation-toggle'),nav=document.getElementById('site-navigation'),wide=matchMedia('(min-width:1024px)');
 const groups=[...header.querySelectorAll('.website-resources')].map(el=>({
  el,
  btn:el.querySelector('.website-resources-toggle'),
  panel:el.querySelector('.website-resource-links'),
  timer:null
 })).filter(g=>g.btn&&g.panel);

 function setGroup(g,open,focus=false){
  clearTimeout(g.timer);
  if(open)for(const other of groups)if(other!==g)setGroup(other,false,false);
  g.btn.setAttribute('aria-expanded',String(open));
  g.panel.hidden=!open;
  if(focus){if(open)g.panel.querySelector('a')?.focus();else g.btn.focus();}
 }
 function closeAllGroups(){for(const g of groups)setGroup(g,false,false);}
 function mainMenu(open,focus=false){
  header.classList.toggle('is-open',open);
  toggle?.setAttribute('aria-expanded',String(open));
  toggle?.setAttribute('aria-label',open?'Close navigation menu':'Open navigation menu');
  if(!open)closeAllGroups();
  if(focus)toggle?.focus();
 }

 toggle?.addEventListener('click',()=>mainMenu(toggle.getAttribute('aria-expanded')!=='true'));

 for(const g of groups){
  g.btn.addEventListener('click',()=>setGroup(g,g.btn.getAttribute('aria-expanded')!=='true'));
  g.el.addEventListener('mouseenter',()=>{if(wide.matches)setGroup(g,true);});
  g.el.addEventListener('mouseleave',()=>{if(wide.matches)g.timer=setTimeout(()=>setGroup(g,false),160);});
  g.el.addEventListener('focusout',e=>{if(!g.el.contains(e.relatedTarget))setGroup(g,false);});
  g.btn.addEventListener('keydown',e=>{
   if(e.key==='ArrowDown'||e.key==='ArrowUp'){
    e.preventDefault();setGroup(g,true);
    const a=[...g.panel.querySelectorAll('a')];
    (e.key==='ArrowDown'?a[0]:a.at(-1))?.focus();
   }
  });
  g.panel.addEventListener('keydown',e=>{
   const a=[...g.panel.querySelectorAll('a')],i=a.indexOf(document.activeElement);
   if(['ArrowDown','ArrowUp','Home','End'].includes(e.key)){
    e.preventDefault();
    const n=e.key==='Home'?0:e.key==='End'?a.length-1:e.key==='ArrowDown'?(i+1)%a.length:(i+a.length-1)%a.length;
    a[n]?.focus();
   }
  });
 }

 document.addEventListener('keydown',e=>{
  if(e.key!=='Escape')return;
  const openGroup=groups.find(g=>!g.panel.hidden);
  if(openGroup){e.preventDefault();setGroup(openGroup,false,true);}
  else if(toggle?.getAttribute('aria-expanded')==='true'){e.preventDefault();mainMenu(false,true);}
 });

 document.addEventListener('pointerdown',e=>{
  if(!header.contains(e.target))mainMenu(false);
  else for(const g of groups)if(!g.el.contains(e.target))setGroup(g,false);
 });

 nav?.querySelectorAll('a').forEach(a=>a.addEventListener('click',()=>mainMenu(false)));
 wide.addEventListener('change',()=>mainMenu(false));
 const scroll=()=>header.classList.toggle('is-scrolled',scrollY>24);scroll();addEventListener('scroll',scroll,{passive:true});
 const path=location.pathname.replace(/\/$/,'')||'/';
 nav?.querySelectorAll('a').forEach(a=>{
  const target=(a.getAttribute('href')||'').replace(/\/$/,'')||'/';
  if(target===path&&!a.classList.contains('website-mobile-consultation')){
   a.setAttribute('aria-current','page');
   const parentGroup=a.closest('.website-resources');
   if(parentGroup)parentGroup.querySelector('.website-resources-toggle')?.style.setProperty('color','#fff');
  }
 });
})();
