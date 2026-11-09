/* AEOGEO product UI. Customer access and quota checks remain server-side. */
(()=>{'use strict';
const $=id=>document.getElementById(id),esc=v=>String(v??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c])),mode=document.body.dataset.page;
const API='/.netlify/functions/',supabaseURL='https://ftwohoenimegsmtliqgz.supabase.co',publicKey='sb_publishable_0T08Pe4A0ZvoHD5CXrd1iA_BvUyVxAO';
let client,report,sample=false,pollTimer,checkoutRequest;
const getClient=()=>client||(client=window.supabase.createClient(supabaseURL,publicKey,{auth:{flowType:['login','callback'].includes(mode)?'implicit':'pkce',detectSessionInUrl:false,persistSession:true,autoRefreshToken:true}}));
// Session recovery revision: session-recovery-v1. Audit access revision: audit-access-v2.
// Authentication state is not inferred from a cached token alone.
let authRecovery=null;
let signOutPending=false;
async function signOutAndReturn(button){
 if(signOutPending)return;signOutPending=true;const original=button.textContent;button.disabled=true;button.textContent='Signing out...';
 const messageID=mode==='login'?'auth-message':mode==='account'?'account-message':'tool-message';
 try{
  rememberAuditDraft();const {error}=await getClient().auth.signOut({scope:'local'});if(error)throw error;
  authRecovery=null;const destination=mode==='login'?nextPath():safeNextPath(location.pathname+location.search);
  const target=new URL('/login/',location.origin);target.searchParams.set('mode','signin');target.searchParams.set('next',destination);target.searchParams.set('signed_out','1');
  location.replace(target.pathname+target.search);
 }catch(error){signOutPending=false;button.disabled=false;button.textContent=original;msg(messageID,'Sign out could not be completed. Check your connection and try again.',true);const notice=$(messageID);if(notice){notice.tabIndex=-1;notice.focus({preventScroll:true});notice.scrollIntoView({block:'nearest',behavior:'auto'});}}
}

function safeNextPath(value,fallback='/account/'){
 if(typeof value!=='string'||!value.startsWith('/')||value.startsWith('//')||/[\\\u0000-\u0020\u007f]/.test(value))return fallback;
 try{const decoded=decodeURIComponent(value);if(decoded.startsWith('//')||/[\\\u0000-\u0020\u007f]/.test(decoded))return fallback;const u=new URL(value,location.origin);if(u.origin!==location.origin||/^\/(?:login|auth\/callback)\/?$/.test(new URL(decoded,location.origin).pathname))return fallback;return u.pathname+u.search;}catch{return fallback;}
}
const nextPath=()=>safeNextPath(new URLSearchParams(location.search).get('next'));
function signInHref(){const next=safeNextPath(location.pathname+location.search);return '/login/?next='+encodeURIComponent(next)+(authRecovery==='expired'?'&reason=session-expired':'');}
function setSignInStatus(signedIn,label){
 const target=$('engine-status-text');if(!target)return;
 target.textContent=label||(signedIn?'Signed in':'Sign-in required');
 const host=target.closest('.live-status');if(!host)return;
 let a=$('engine-sign-in');if(signedIn){a?.remove();return;}
 if(!a){a=document.createElement('a');a.id='engine-sign-in';a.addEventListener('click',rememberAuditDraft);a.style.cssText='display:block;margin-top:.4rem;font-size:12px;text-decoration:underline;';host.append(a);}
 a.href=signInHref();a.textContent=authRecovery==='expired'?'Sign in again':'Sign in';
}
function rememberAuditDraft(){try{if(!$('domain-input'))return;sessionStorage.setItem('aeogeo-audit-draft',JSON.stringify({url:$('domain-input').value,scope:document.querySelector('[name="audit-scope"]:checked')?.value||'25'}));}catch{}}
function restoreAuditDraft(){try{if(!$('domain-input'))return;const raw=sessionStorage.getItem('aeogeo-audit-draft');if(!raw)return;const draft=JSON.parse(raw);sessionStorage.removeItem('aeogeo-audit-draft');if(typeof draft.url==='string')$('domain-input').value=draft.url;const scope=['25','75'].includes(draft.scope)?draft.scope:'25';const radio=document.querySelector('[name="audit-scope"][value="'+scope+'"]');if(radio)radio.checked=true;if($('permission'))$('permission').checked=false;/* Permission is deliberately not restored or submitted automatically. */}catch{}}
function msg(id,text,error=false){
 const el=$(id);if(!el)return;el.replaceChildren(document.createTextNode(String(text||'')));el.hidden=!text;el.classList.toggle('error',error);
 if(text&&authRecovery&&id!=='auth-message'){
  const a=document.createElement('a');a.className='session-sign-in';a.addEventListener('click',rememberAuditDraft);a.href=signInHref();a.textContent=authRecovery==='expired'?'Sign in again':'Sign in';
  a.style.cssText='display:inline-flex;align-items:center;justify-content:center;max-width:100%;box-sizing:border-box;margin-top:.75rem;padding:.65rem 1.2rem;border-radius:999px;background:#4f7df9;color:#fff;font-family:inherit;font-size:14px;font-weight:600;line-height:1.5;text-decoration:none;outline-offset:4px;';
  el.append(document.createElement('br'),a);
 }
}
function authenticationFailed(error){return !!error&&(error.status===400||error.status===401||error.name==='AuthSessionMissingError');}
function requireSignIn(expired=true){
 authRecovery=expired?'expired':'missing';rememberAuditDraft();setSignInStatus(false);
 const message=expired?'Your session has ended. Sign in again to continue. Your saved reports are still available.':'Sign in to continue. Your saved reports are kept in your account.';
 const id=$('tool-message')?'tool-message':$('account-message')?'account-message':null;if(id)msg(id,message,expired);
 return Object.assign(Error(message),{status:401,authRequired:true});
}
async function api(name,{query='',body,anonymous=false}={}){
 const headers={};
 if(!anonymous){
  if(authRecovery)throw requireSignIn(authRecovery==='expired');
  const result=await getClient().auth.getSession();const session=result.data?.session;
  if(result.error){if(authenticationFailed(result.error))throw requireSignIn(true);throw Error('Your sign-in could not be checked. Check your connection and try again.');}
  if(!session)throw requireSignIn(false);
  headers.Authorization='Bearer '+session.access_token;
 }
 if(body)headers['Content-Type']='application/json';
 const r=await fetch(API+name+query,{method:body?'POST':'GET',headers,body:body?JSON.stringify(body):undefined,cache:'no-store'});
 if(r.status===401&&!anonymous)throw requireSignIn(true); // Never replay a payment/audit POST automatically.
 let data;try{data=await r.json();}catch{throw Error('The server response could not be read. Please retry.');}
 if(!r.ok)throw Object.assign(Error(data.error||'Request failed.'),{code:data.code,status:r.status});
 if(!anonymous){authRecovery=null;setSignInStatus(true);}return data;
}
function scoreText(n){return n===null||n===undefined?'N/A':Math.round(n);}
const color=n=>n===null||n===undefined?'#94a3b8':n>=70?'#22c55e':n>=40?'#f59e0b':'#f87171';
function safeURL(v){try{const u=new URL(v);return u.protocol==='https:'?u.href:'#';}catch{return '#';}}
function link(url,label){return `<a href="${esc(safeURL(url))}" target="_blank" rel="noopener noreferrer">${esc(label||url)}</a>`;}
function download(name,text,type='text/plain'){const blob=new Blob([text],{type}),a=document.createElement('a');a.href=URL.createObjectURL(blob);a.download=name;a.click();setTimeout(()=>URL.revokeObjectURL(a.href),1000);}
function reportName(){return 'aeogeo-'+(sample?'sample-':'')+new Date(report.createdAt||Date.now()).toISOString().slice(0,10);}
function template(id){const host=(()=>{try{return new URL(report.target).origin;}catch{return 'https://example.com';}})();const all={schema_validator:JSON.stringify({'@context':'https://schema.org','@type':'Organization',name:'REPLACE_WITH_REAL_ORGANIZATION',url:host},null,2),structure:'<h1>Your page’s clear main topic</h1>\n<section>\n  <h2>A genuine customer question</h2>\n  <p>A specific, self-contained answer supported by your evidence.</p>\n</section>',image_alt:'<!-- Meaningful image: describe its relevant information. -->\n<img src="/your-image.jpg" alt="Describe the real image in context">\n<!-- Decorative image: empty alt is appropriate. -->\n<img src="/decoration.svg" alt="">',ai_bot_access:'# Review your own publishing policy before applying.\n# Do not copy this over existing robots rules blindly.\nUser-agent: OAI-SearchBot\nAllow: /\n\nUser-agent: PerplexityBot\nAllow: /',sitemap_depth:'<!-- Add canonical, indexable public pages to your real sitemap. -->\n<url>\n  <loc>'+host+'/replace-with-real-page</loc>\n</url>',freshness:'<!-- Use a truthful date only when appropriate. -->\n<time datetime="YYYY-MM-DD">Updated: actual revision date</time>',knowledge_graph:'"sameAs": [\n  "REPLACE_WITH_YOUR_GENUINE_OFFICIAL_PROFILE_URL"\n]',eeat_signals:'<p>Written by <a rel="author" href="/real-author-page">Real author name</a></p>\n<!-- Provide genuine qualifications and editorial responsibilities. -->',citations:'<p>Your evidence-backed claim.\n  <a href="https://replace-with-primary-source.example">Primary source and relevant date</a>\n</p>',ai_optimization:'<section>\n  <h2>What does your customer actually need to know?</h2>\n  <p>Answer directly using accurate facts from your business.</p>\n</section>'};return all[id]||'Editorial review checklist:\n1. Inspect the exact page evidence.\n2. Confirm that the recommendation suits the page’s purpose.\n3. Make accurate, useful changes - not score-driven padding.\n4. Review accessibility and factual correctness.\n5. Recrawl to confirm the implemented change.';}
function aggregate(metricsPages){const weights={cq:35,ai:30,tech:15,auth:20};const pillars=Object.keys(weights).map(id=>{const vals=metricsPages.map(p=>{const ms=p.metrics.filter(m=>m.pillar===id&&m.score!==null);return ms.length?Math.round(ms.reduce((a,m)=>a+m.score*m.weight,0)/ms.reduce((a,m)=>a+m.weight,0)):null;}).filter(x=>x!==null);return {id,score:vals.length?Math.round(vals.reduce((a,b)=>a+b,0)/vals.length):null,weight:weights[id]};});const valid=pillars.filter(p=>p.score!==null);return valid.length?Math.round(valid.reduce((n,p)=>n+p.score*p.weight,0)/valid.reduce((n,p)=>n+p.weight,0)):null;}
function renderReport(r,isSample=false){if(!Array.isArray(r.pages)||!r.pages[0]?.metrics)throw Error('This is a legacy report. Open it from your account to download the original JSON.');report=r;sample=isSample;$('tool-input').hidden=true;$('tool-progress').hidden=true;$('results-panel').hidden=false;$('report-preview-banner').hidden=!sample;$('overall-score').textContent=scoreText(r.score);$('score-ring').style.setProperty('--score',r.score||0);$('score-ring').style.background=`conic-gradient(${color(r.score)} ${(r.score||0)*3.6}deg,#172b48 0deg)`;$('report-domain').textContent=(()=>{try{return new URL(r.target).hostname;}catch{return r.target;}})();$('report-meta').textContent=`${r.pageCount||r.pages.length} pages · ${new Date(r.createdAt).toLocaleString()} · ${sample?'Labeled sample data':'Fetched initial HTML'}${r.partial?' · Scope/discovery limit reached':''}`;
const avg=r.pages.reduce((n,p)=>n+p.metrics.filter(m=>m.score!==null).length,0)/r.pages.length;$('report-coverage').textContent=`${avg.toFixed(1)} of 22 checks scored per page (average)`;
$('pillars').innerHTML=r.pillars.map(p=>`<article class="card pillar-card"><div class="pillar-title"><h3>${esc(p.name)}</h3><span class="small">${p.weight}% weight</span></div><strong style="color:${color(p.score)}">${scoreText(p.score)}</strong><div class="track"><span style="width:${p.score||0}%;background:${color(p.score)}"></span></div></article>`).join('');
$('report-limitations').textContent=(r.limitations||[]).join(' ');
$('roadmap-list').innerHTML=r.fixes.length?r.fixes.map((f,i)=>`<article class="card fix-card"><div class="fix-top"><div class="fix-title"><span class="fix-number">${i+1}</span><div><h3>${esc(f.title)}</h3><p class="small">${f.affected.length} affected page(s) · ${esc(f.pillar)}</p></div></div><span class="status-pill ${f.priority==='High'?'bad':'warn'}">${esc(f.priority)} priority</span></div><p class="small">${esc(f.fix)}</p><details class="affected"><summary>View affected pages & editable implementation template</summary><ul>${f.affected.map(u=>'<li>'+link(u)+'</li>').join('')}</ul><p class="small">Template only. Replace placeholders, verify facts, and adapt to your site before use.</p><pre class="code-block">${esc(template(f.id))}</pre><button class="plain-button copy-template" data-template="${esc(f.id)}">Copy template</button></details></article>`).join(''):'<div class="card">No checklist findings below the review threshold. This does not establish AI visibility, factual accuracy or full site quality.</div>';
renderPages();renderMetrics();renderSimulator();$('results-panel').scrollIntoView({behavior:'smooth',block:'start'});}
function renderPages(){const q=($('page-search').value||'').toLowerCase();$('pages-body').innerHTML=report.pages.map((p,i)=>({p,i})).filter(({p})=>(p.title+' '+p.url).toLowerCase().includes(q)).map(({p,i})=>`<tr><td><div class="page-title">${esc(p.title)}</div><div class="page-url">${link(p.url)}</div></td><td class="score-num" style="color:${color(p.score)}">${scoreText(p.score)}</td><td>${p.pillars.map(x=>scoreText(x.score)).join(' / ')}</td><td><span class="small">${p.metrics.filter(m=>m.score!==null).length}/22 scored</span></td><td><button class="plain-button page-open" data-index="${i}">Inspect →</button></td></tr>`).join('');}
function metricAverages(){return report.pages[0].metrics.map(m=>{const v=report.pages.flatMap(p=>{const x=p.metrics.find(x=>x.id===m.id);return x?.score!==null&&x?.score!==undefined?[x.score]:[];});return {...m,average:v.length?Math.round(v.reduce((a,b)=>a+b,0)/v.length):null,available:v.length};});}
function renderMetrics(){ $('metric-grid').innerHTML=metricAverages().map(m=>`<article class="card metric-card"><div class="metric-top"><span class="method ${esc(m.method)}">${esc(m.method)}</span><strong style="color:${color(m.average)}">${scoreText(m.average)}</strong></div><h3>${esc(m.name)}</h3><p class="small">${esc(m.pillar.toUpperCase())} · ${m.available}/${report.pages.length} pages scored. ${m.average===null?'Not evaluated; excluded from score.':'Open a page to inspect exact evidence.'}</p></article>`).join('');}
function renderSimulator(){const ms=metricAverages().filter(m=>m.average!==null&&m.average<100);$('sim-current').textContent=scoreText(report.score);$('sim-options').innerHTML=ms.map(m=>`<label class="sim-option"><input type="checkbox" value="${esc(m.id)}"><span><strong>${esc(m.name)}</strong><br><small>Current average ${m.average} → assume 100 on all scored pages</small></span></label>`).join('');updateSimulator();}
function updateSimulator(){const ids=new Set([...document.querySelectorAll('#sim-options input:checked')].map(e=>e.value));const pages=report.pages.map(p=>({...p,metrics:p.metrics.map(m=>({...m,score:m.score!==null&&ids.has(m.id)?100:m.score}))}));$('sim-projected').textContent=scoreText(aggregate(pages));}
function openPage(index){const p=report.pages[index];if(!p)return;$('drawer-title').textContent=p.title;$('drawer-body').innerHTML=`<p>${link(p.url)}</p><p class="small">${p.words} approximate English words · Score ${scoreText(p.score)} · ${p.metrics.filter(m=>m.score!==null).length}/22 scored</p>`+p.metrics.map(m=>`<article class="metric-card"><div class="status-line"><h3>${esc(m.name)}</h3><span class="status-pill ${m.status==='pass'?'good':m.status==='fail'?'bad':'warn'}">${m.score===null?'Not scored':scoreText(m.score)+'/100'}</span></div><span class="method ${esc(m.method)}">${esc(m.method)}</span><p class="small">${esc(m.evidence)}</p><p class="small"><strong>Review / fix:</strong> ${esc(m.fix)}</p></article>`).join('');$('page-drawer').hidden=false;document.body.style.overflow='hidden';$('drawer-close').focus();}
let prePrintClosed=[];window.addEventListener('beforeprint',()=>{prePrintClosed=[...document.querySelectorAll('details.affected:not([open])')];prePrintClosed.forEach(e=>e.open=true);});window.addEventListener('afterprint',()=>prePrintClosed.forEach(e=>e.open=false));
function closeDrawer(){$('page-drawer').hidden=true;document.body.style.overflow='';}
function showComparison(other){const row=(label,left,right)=>`<tr><th>${esc(label)}</th><td>${esc(left)}</td><td>${esc(right)}</td></tr>`;$('comparison-output').innerHTML=`<table><thead><tr><th>Readiness checklist</th><th>${esc(report.target)}</th><th>${esc(other.target)}</th></tr></thead><tbody>${row('Scanned pages',report.pages.length,other.pages.length)}${row('Checklist score',scoreText(report.score),scoreText(other.score))}${report.pillars.map(p=>row(p.name,scoreText(p.score),scoreText(other.pillars.find(x=>x.id===p.id)?.score))).join('')}</tbody></table>`;}
async function loadComparison(){try{if(sample){const r=await fetch('/assets/sample-comparison.json');showComparison(await r.json());$('comparison-message').textContent='Two explicitly fictional HTML fixtures. Their checklist scores were computed by the actual analyzer; these are not live competitor measurements.';return;}const a=await api('product-api'),jobs=a.jobs.filter(j=>j.status==='completed'),select=$('comparison-select');select.innerHTML='<option value="">Choose another completed report…</option>'+jobs.map(j=>`<option value="${esc(j.id)}">${esc(j.target_url)} · ${esc(new Date(j.created_at).toLocaleDateString())}</option>`).join('');select.hidden=false;$('comparison-message').textContent=jobs.length?'Choose a report from your own account. Auditing another website uses your normal page/domain allowance.':'No other completed reports yet.';select.onchange=async()=>{if(!select.value)return;try{const j=await api('product-api',{query:'?action=report&id='+encodeURIComponent(select.value)});showComparison(j.report);}catch(e){$('comparison-message').textContent=e.message;}};}catch(e){$('comparison-message').textContent=e.message;}}
async function loadSample(){const r=await fetch('/assets/sample-report.json',{cache:'no-store'});if(!r.ok)throw Error('Sample unavailable.');renderReport(await r.json(),true);}
async function poll(id){try{const job=await api('product-api',{query:'?action=report&id='+encodeURIComponent(id)});if(job.status==='complete'||job.status==='completed'){renderReport(job.report);return;}if(job.status==='failed')throw Error(job.error_message||'The audit could not complete. Your unused reservation is released.');$('progress-title').textContent=job.status==='queued'?'Waiting for crawler pickup':'Crawling your public pages';const progress=job.progress||{};$('progress-count').textContent='Job '+id+' · '+job.status+(progress.analyzed?' · '+progress.analyzed+' pages analyzed':'');$('progress-bar').style.width=progress.limit?Math.min(95,progress.analyzed/progress.limit*100)+'%':'3%';$('crawler-terminal').textContent='Fetching public pages safely. Detailed findings appear when the saved report completes.';pollTimer=setTimeout(()=>poll(id),5000);}catch(e){msg('tool-message',e.message,true);$('tool-progress').hidden=true;$('tool-input').hidden=false;}}
async function beginAudit(e){e.preventDefault();const btn=$('submit-btn');btn.disabled=true;msg('tool-message','');try{const pages=Number(document.querySelector('[name="scope"]:checked').value),r=await api('start-audit',{body:{url:$('domain-input').value.trim(),pages,requestId:crypto.randomUUID()}});$('tool-input').hidden=true;$('tool-progress').hidden=false;history.replaceState(null,'','?job='+encodeURIComponent(r.id));poll(r.id);}catch(e){msg('tool-message',e.message,true);if(e.code==='subscription_required'){const a=document.createElement('a');a.href='/geo-audit/#plans';a.className='btn section-spacer';a.textContent='View plans & upgrade →';$('tool-message').append(document.createElement('br'),a);}}finally{btn.disabled=false;}}
async function checkout(plan,interval){checkoutRequest||=crypto.randomUUID();const r=await api('create-checkout',{body:{plan,interval,requestId:checkoutRequest}});const u=new URL(r.url);if(u.protocol!=='https:'||u.hostname!=='checkout.stripe.com')throw Error('Unexpected checkout destination.');location.assign(u.href);}

async function loadBillingReviews(){try{msg('billing-admin-message','');const data=await api('billing-review');const money=(n,c)=>'$'+(Number(n)/100).toFixed(2)+' '+esc(String(c).toUpperCase());$('billing-review-list').innerHTML=data.reviews.length?data.reviews.map(r=>`<article class="job-row"><div class="job-main"><h3>${r.full_refund?'Full refund':'Partial refund'}: ${money(r.amount_refunded,r.currency)}</h3><p class="small">${esc(data.mode)} mode · Charge <code>${esc(r.charge_id)}</code><br>Subscription <code>${esc(r.subscription_id)}</code><br>Period ends: ${esc(r.period_end?new Date(r.period_end).toLocaleString():'Requires verification in Stripe')}</p><p class="small">Search this charge ID in your Stripe dashboard. Access and renewal have not been changed automatically by this refund.</p><div class="button-row"><button type="button" class="btn secondary small" data-review="${esc(r.id)}" data-decision="keep">Close review: keep access unchanged</button>${r.full_refund&&r.period_end&&Date.parse(r.period_end)>Date.now()?`<button type="button" class="btn secondary small" data-review="${esc(r.id)}" data-decision="revoke">End refunded access and stop renewal</button>`:''}</div></div></article>`).join(''):'<p class="small">No refunds awaiting your decision.</p>';$('billing-hold-list').innerHTML=data.holds.length?data.holds.map(h=>`<div class="notice"><strong>${esc(h.kind)}</strong><p>${esc(h.reason)}</p><p class="small">Source <code>${esc(h.source_id)}</code> · Subscription <code>${esc(h.subscription_id)}</code>${h.expires_at?' · Affected period ends '+esc(new Date(h.expires_at).toLocaleString()):' · Awaiting resolution'}</p></div>`).join(''):'<p class="small">No active billing holds.</p>';if(data.moreReviews)msg('billing-admin-message','More than 100 reviews are pending. Resolve these, then refresh to see the next group.');}catch(e){msg('billing-admin-message',e.message,true);}}
async function decideBillingReview(e){const b=e.target.closest('[data-review]');if(!b)return;const keep=b.dataset.decision==='keep',text=keep?'Close this refund review while keeping access and renewal unchanged?':'End paid access for this verified refunded period and stop the next renewal? This does not issue a refund or delete saved reports.';if(!window.confirm(text))return;b.disabled=true;try{await api('billing-review',{body:{id:b.dataset.review,decision:b.dataset.decision,confirm:keep?'KEEP':'END'}});await loadAccount();}catch(error){msg('billing-admin-message',error.message,true);}finally{b.disabled=false;}}

// Checkout feedback revision: checkout-feedback-v1. Eligibility remains server-authoritative.
function checkoutAvailability(a,plan){
 const allowed=Array.isArray(a.checkoutPlans)?a.checkoutPlans.includes(plan):a.billingReady===true;
 const test=a.billingMode==='test'||(a.billingMode===undefined&&a.sandboxCheckout===true);
 let reason='';
 if(!allowed)reason=a.sandboxCheckout&&plan!=='starter'?'Only Starter is available for owner-only TEST checkout. This plan is not available for purchase.':a.billingNotice||'Checkout is not available for this plan. No payment has been started.';
 return {allowed,test,reason,label:allowed?(test?'Continue to Stripe TEST checkout →':'Continue to secure checkout →'):'Checkout unavailable'};
}
function checkoutFeedback(text,error=false){
 let el=$('checkout-message');
 if(!el){el=document.createElement('p');el.id='checkout-message';el.className='message section-spacer';el.setAttribute('aria-live','polite');el.setAttribute('role','status');el.tabIndex=-1;$('account-checkout').insertAdjacentElement('afterend',el);$('account-checkout').setAttribute('aria-describedby',el.id);}
 el.setAttribute('role',error?'alert':'status');msg(el.id,text,error);
 return el;
}
function prepareAccountCheckout(a,plan,interval){
 const button=$('account-checkout'),section=$('selected-plan'),state=checkoutAvailability(a,plan);
 button.type='button';button.disabled=!state.allowed;button.textContent=state.label;
 checkoutFeedback(state.reason||(state.test?'Owner-only Stripe TEST checkout. No real payment will be collected.':'Review the recurring amount in secure checkout before authorizing payment.'));
 let link=$('checkout-plans-link');
 if(!link){link=document.createElement('a');link.id='checkout-plans-link';link.className='text-link';button.parentNode.append(link);}
 const starterOnly=!state.allowed&&a.sandboxCheckout&&plan!=='starter';
 link.hidden=state.allowed;link.href=starterOnly?'/account/?plan=starter&interval='+interval:'/contact';link.textContent=starterOnly?'Select Starter for TEST checkout →':'Contact us about checkout';
 let pending=false;
 button.onclick=async()=>{
  if(pending)return;
  if(!state.allowed){checkoutFeedback(state.reason,true);return;}
  pending=true;let redirecting=false;
  button.disabled=true;button.textContent=state.test?'Opening Stripe TEST checkout…':'Opening secure checkout…';section.setAttribute('aria-busy','true');
  checkoutFeedback('Contacting the checkout server. Please wait; do not click again.');
  try{await checkout(plan,interval);redirecting=true;}
  catch(e){
   const reference=typeof e.reference==='string'&&/^CHECKOUT_[A-Z_]{1,70}$/.test(e.reference)?' Reference: '+e.reference+'.':'';
   const text=e.message+reference;msg('account-message',text,true);
   const feedback=checkoutFeedback(text,true);feedback.focus({preventScroll:true});feedback.scrollIntoView({block:'nearest',behavior:'smooth'});
  }finally{
   if(!redirecting){pending=false;button.disabled=!state.allowed;button.textContent=state.label;section.removeAttribute('aria-busy');}
  }
 };
}

async function loadAccount(){msg('account-message','');try{const a=await api('product-api');$('account-email').textContent=a.email;const sub=a.subscription,active=a.paidActive??!!(sub&&Date.parse(sub.paid_through)>Date.now());$('account-plan').textContent=active?(a.plans[sub.plan]?.name||sub.plan)+' · '+(sub.cancel_at_period_end?'renewal canceled':sub.status)+(sub.billing_mode==='test'?' · TEST':''):(a.billingHold?'Paid audit access paused':'Free account');const freeInProgress=(a.jobs||[]).some(j=>j.credit_source==='free'&&['queued','running'].includes(j.status));$('account-free').textContent=a.freeUsed?(freeInProgress?'Reserved for the audit in progress':'Used · saved report retained'):'One audit available · up to 25 pages';$('account-upgrade').hidden=!a.freeUsed||active||!!a.billingHold||freeInProgress;const used=a.period?.used_pages||0,reserved=a.period?.reserved_pages||0,limit=active?a.plans[sub.plan]?.monthlyPages:25;$('account-usage').textContent=a.period?`${used} analyzed + ${reserved} reserved / ${limit} this period`:'No active paid usage period';$('usage-fill').style.width=Math.min(100,(used+reserved)/limit*100)+'%';$('billing-status').textContent=a.billingHold||(a.billingMode==='test'&&a.sandboxCheckout?'Stripe test mode only. No real payment is collected.':a.billingNotice)||'Billing controls available for customers with a Stripe subscription.';$('billing-portal').disabled=!sub;
if($('sandbox-billing'))$('sandbox-billing').hidden=!a.sandboxCheckout;if($('billing-review-panel')){$('billing-review-panel').hidden=!a.billingAdmin;if(a.billingAdmin)await loadBillingReviews();}
const jobs=[...(a.jobs||[]).map(j=>({...j,legacy:false})),...(a.legacy||[]).map(j=>({...j,created_at:j.reserved_at,legacy:true}))].sort((x,y)=>Date.parse(y.created_at)-Date.parse(x.created_at));$('account-jobs').innerHTML=jobs.length?jobs.map(j=>`<article class="job-row"><div class="job-main"><h3>${esc(j.target_url)}</h3><p class="small">${esc(new Date(j.created_at).toLocaleString())} · ${esc(j.status)}${j.page_count?' · '+j.page_count+' pages':''}${j.legacy?' · earlier test tool':''}</p>${j.error_message?'<p class="small">'+esc(j.error_message)+'</p>':''}</div>${['completed','complete'].includes(j.status)?j.legacy?`<button class="plain-button legacy-download" data-id="${esc(j.id)}">Original report JSON ↓</button>`:`<a class="btn secondary small" href="/geo-audit/run/?report=${esc(j.id)}">Open report →</a>`:!j.legacy&&['queued','running'].includes(j.status)?`<a class="text-link" href="/geo-audit/run/?job=${esc(j.id)}">Check progress →</a>`:''}</article>`).join(''):'<div class="empty-state">No saved audits yet. Start with your free website audit.</div>';
const q=new URLSearchParams(location.search),plan=q.get('plan'),interval=q.get('interval')==='year'?'year':'month';if(a.plans[plan]){$('selected-plan').hidden=false;const p=a.plans[plan],amount=(interval==='year'?p.annual:p.monthly)/100;$('selected-plan-copy').textContent=`${p.name} · $${amount.toFixed(2)} USD billed ${interval==='year'?'once per year':'monthly'} · recurring until canceled.`;prepareAccountCheckout(a,plan,interval);}if(q.get('checkout')==='success')msg('account-message','Stripe returned you to your account. Access is granted only after the server verifies the paid Stripe invoice, not merely from this return page. Use Refresh if confirmation is pending.');if(q.get('checkout')==='canceled')msg('account-message','Checkout canceled. No paid access was granted.');
}catch(e){msg('account-message',e.message,true);$('account-jobs').textContent='Your account data could not load. Please retry. Existing saved reports are not deleted by this error.';}}
function initPasswordVisibility(){
 document.querySelectorAll('[data-password-toggle]').forEach(button=>{
  const input=$(button.dataset.passwordToggle);if(!input)return;
  button.addEventListener('click',()=>{const visible=input.type==='password';input.type=visible?'text':'password';button.setAttribute('aria-pressed',String(visible));button.setAttribute('aria-label',visible?'Hide password':'Show password');button.title=visible?'Hide password':'Show password';button.querySelector('[data-password-label]').textContent=visible?'Hide':'Show';});
 });
}
function concealPassword(input){
 input.type='password';const button=document.querySelector('[data-password-toggle="'+input.id+'"]');if(button){button.setAttribute('aria-pressed','false');button.setAttribute('aria-label','Show password');button.title='Show password';button.querySelector('[data-password-label]').textContent='Show';}
}
function initAuth(){
 const form=$('login-form'),passwordInput=$('password'),passwordLabel=form.querySelector('label[for="password"]'),email=()=>$('email').value.trim(),password=()=>passwordInput.value,callback=location.origin+'/auth/callback/',destination=nextPath(),auditDestination=/^\/geo-audit\/run\/?(?:\?|$)/.test(destination);
 const signupButton=$('sign-up'),signinButton=$('sign-in'),resendButton=$('resend-email'),resetButton=$('forgot-password'),existing=$('auth-existing-account'),existingReset=$('existing-reset-link'),signedIn=$('auth-signed-in'),continueLink=$('signed-in-continue');let busy=false,intent=new URLSearchParams(location.search).get('mode')==='signup'?'signup':'signin';
 const signinLabel=auditDestination?'Sign in to run the audit':'Sign in';
 function signupLabel(){return auditDestination?'Sign Up to Run an Audit':'Create account';}
 function chooseAuthMode(kind){
  intent=kind;const signup=kind==='signup';form.dataset.authMode=kind;concealPassword(passwordInput);
  passwordLabel.textContent=signup?'Create a password':'Password';passwordInput.autocomplete=signup?'new-password':'current-password';
  signupButton.type=signup?'submit':'button';signinButton.type=signup?'button':'submit';signupButton.className=signup?'btn':'btn secondary';signinButton.className=signup?'btn secondary':'btn';
  signupButton.textContent=signup?signupLabel():'Create account';signinButton.textContent=signup?'Already registered? Sign in':signinLabel;
  const primary=signup?signupButton:signinButton;primary.parentElement.insertBefore(primary,primary.parentElement.firstChild);
  if($('auth-title'))$('auth-title').textContent=signup?(auditDestination?'Sign Up to Run an Audit':'Create your account'):(auditDestination?'Sign in to run the audit':'Sign in to your account');
  if($('auth-intro'))$('auth-intro').textContent=signup?'New account: enter your email address, create a password, then choose '+signupLabel()+'. Already have an account? Choose Sign in.':'Returning account: enter your email and password, then choose Sign in. New here? Choose Create account.';
  if($('auth-password-help'))$('auth-password-help').textContent=signup?'Create a unique password for AEOGEO Search. Do not use your email or hosting password.':'Enter the password you created for AEOGEO Search, not your email or hosting password.';
 }
 chooseAuthMode(intent);continueLink.href=destination;continueLink.textContent=auditDestination?'Continue to the audit':'Continue to your account';
 function announce(message,error=false){msg('auth-message',message,error);const notice=$('auth-message');if(message&&notice){notice.focus({preventScroll:true});notice.scrollIntoView({block:'nearest',behavior:'auto'});}}
 function showExisting(){chooseAuthMode('signin');announce('');passwordLabel.textContent='Password';passwordInput.autocomplete='current-password';passwordInput.value='';existing.hidden=false;existing.focus({preventScroll:true});existing.scrollIntoView({block:'nearest',behavior:'auto'});}
 function saveReturnPath(){try{sessionStorage.setItem('aeogeo-next',destination);}catch{/* Optional storage must not block account access. */}}
 function callbackURL(recovery=false){const url=new URL(callback);url.searchParams.set('next',destination);if(recovery)url.searchParams.set('recovery','1');return url.href;}
 function setBusy(value,kind){busy=value;form.setAttribute('aria-busy',String(value));for(const button of [signupButton,signinButton,resendButton,resetButton,existingReset])if(button)button.disabled=value;signupButton.textContent=value&&kind==='signup'?'Creating account...':intent==='signup'?signupLabel():'Create account';signinButton.textContent=value&&kind==='signin'?'Signing in...':intent==='signup'?'Already registered? Sign in':signinLabel;}
 function duplicate(error){return ['user_already_exists','email_exists'].includes(error?.code)||/already registered|already been registered/i.test(String(error?.message||''));}
 function describeError(error){const message=String(error?.message||'The request could not be completed. Please try again.');if(error?.status===429||/rate.limit|too many requests/i.test(message))return 'Too many requests. Please wait before trying again. '+message;if(error?.code==='email_not_confirmed')return 'Your email is not confirmed yet. Choose Resend confirmation email, then open its link before signing in.';if(/error sending.*email|email.*could not be sent/i.test(message))return 'The email service could not send the message. '+message+' Please wait before retrying. Already registered? Use Sign in or the password-reset link.';return message;}
 async function action(kind){
  if(busy)return;existing.hidden=true;passwordLabel.textContent=kind==='signup'?'Create a password':'Password';passwordInput.autocomplete=kind==='signup'?'new-password':'current-password';
  if(!form.reportValidity())return;
  setBusy(true,kind);announce(kind==='signup'?'Submitting your signup request...':'Signing in...');
  try{
   if(kind==='signup'){
    saveReturnPath();const {data,error}=await getClient().auth.signUp({email:email(),password:password(),options:{emailRedirectTo:callbackURL()}});if(error)throw error;
    if(data?.session){location.assign(destination);return;}
    if(!data?.user?.id)throw Error('The signup service did not return an account. Try Sign in if you have an existing account.');
    if((Array.isArray(data.user.identities)&&data.user.identities.length===0)||data.user.email_confirmed_at){showExisting();return;}
    passwordInput.value='';concealPassword(passwordInput);form.hidden=true;
    if($('auth-title'))$('auth-title').textContent='Please validate your email';
    if($('auth-intro'))$('auth-intro').textContent=auditDestination?'Your account request was accepted. One more step is needed before your free audit.':'Your account request was accepted. Validate your email to continue.';
    $('auth-confirmation-actions').hidden=false;$('auth-confirmation-signin').href='/login/?mode=signin&next='+encodeURIComponent(destination);
    announce('Please check your email inbox and spam folder, then click the link to validate your account. The link will return you to the audit if you are securely signed in. Otherwise, sign in with the email and password you just created. If the email does not arrive, choose Resend confirmation email below.');
   }else{
    const {data,error}=await getClient().auth.signInWithPassword({email:email(),password:password()});if(error)throw error;if(!data?.session)throw Error('A sign-in session could not be established. Please try again.');location.assign(destination);
   }
  }catch(error){if(kind==='signup'&&duplicate(error))showExisting();else announce(describeError(error),true);}finally{setBusy(false,kind);}
 }
 async function requestEmail(kind){
  if(busy||!$('email').reportValidity())return;setBusy(true,kind);saveReturnPath();announce(kind==='resend'?'Requesting a confirmation link...':'Requesting a password reset link...');
  try{
   const {error}=kind==='resend'?await getClient().auth.resend({type:'signup',email:email(),options:{emailRedirectTo:callbackURL()}}):await getClient().auth.resetPasswordForEmail(email(),{redirectTo:callbackURL(true)});if(error)throw error;
   announce(kind==='resend'?'If this account still needs email confirmation, a new link has been requested. Check your inbox and Spam. Already confirmed? Use Sign in or the password-reset link instead.':'If this email address has an account, check your inbox and Spam for a password reset link. Open it to create a new password. Your password is not changed until you finish that step.');
  }catch(error){announce(describeError(error),true);}finally{setBusy(false,kind);}
 }
 async function checkExistingSession(){
  try{const client=getClient(),cached=await client.auth.getSession();if(cached.error||!cached.data?.session)return;if($('auth-sign-out'))$('auth-sign-out').hidden=false;const verified=await client.auth.getUser();if(verified.error||!verified.data?.user){if(!busy)announce('Your session could not be verified. Please sign in to continue.',true);return;}if(!verified.data.user.email_confirmed_at){if(!busy)announce('Confirm your email before continuing. Use Resend confirmation email if needed.');return;}signedIn.hidden=false;if($('auth-signed-in-email'))$('auth-signed-in-email').textContent=verified.data.user.email||'';if(!busy&&!email()&&!password()){if(verified.data.user.email)$('email').value=verified.data.user.email;form.hidden=true;resendButton.hidden=true;resetButton.hidden=false;} }
  catch{/* Keep the normal sign-in form available if a saved session cannot be checked. */}
 }
 form.onsubmit=event=>{event.preventDefault();action(intent);};signupButton.onclick=event=>{event.preventDefault();if(busy)return;chooseAuthMode('signup');action('signup');};signinButton.onclick=event=>{event.preventDefault();if(busy)return;chooseAuthMode('signin');action('signin');};resendButton.onclick=()=>requestEmail('resend');resetButton.onclick=()=>requestEmail('reset');existingReset.onclick=()=>requestEmail('reset');
 $('auth-sign-out')?.addEventListener('click',event=>signOutAndReturn(event.currentTarget));
 if(new URLSearchParams(location.search).get('signed_out')==='1')announce('You are signed out. Sign in below to continue.');
 if(new URLSearchParams(location.search).get('reason')==='session-expired')announce('Your session has ended. Sign in below to return to where you left off.');
 checkExistingSession();
}
async function initCallback(){
 const url=new URL(location.href),hash=new URLSearchParams(location.hash.slice(1)),message=$('callback-message'),form=$('reset-form'),continuation=$('callback-continue'),recovery=url.searchParams.get('recovery')==='1'||hash.get('type')==='recovery';let stored=null;
 try{stored=sessionStorage.getItem('aeogeo-next');}catch{}
 const destination=safeNextPath(url.searchParams.get('next')||stored),auditDestination=/^\/geo-audit\/run\/?(?:\?|$)/.test(destination),login='/login/?next='+encodeURIComponent(destination);
 const back=$('callback-return');if(back)back.href=login;continuation.href=destination;continuation.textContent=auditDestination?'Continue to the audit':'Continue to your account';
 function status(text){message.textContent=text;}
 function heading(text){const title=document.querySelector('.auth-main h1');if(title)title.textContent=text;}
 try{
  // Capture credentials in memory, then remove them from browser history before any network work.
  if(url.searchParams.has('code')||hash.has('access_token')||hash.has('refresh_token'))history.replaceState(null,'','/auth/callback/');
  if(url.searchParams.get('error_description')||hash.get('error_description'))throw Error(url.searchParams.get('error_description')||hash.get('error_description'));
  const client=getClient();let data,error;
  if(url.searchParams.get('code'))({data,error}=await client.auth.exchangeCodeForSession(url.searchParams.get('code')));
  else if(hash.get('access_token')&&hash.get('refresh_token'))({data,error}=await client.auth.setSession({access_token:hash.get('access_token'),refresh_token:hash.get('refresh_token')}));
  else({data,error}=await client.auth.getSession());
  if(error)throw error;if(!data?.session)throw Error('This link has expired or could not establish a secure session. Request a new link and open it in the same browser where you requested it.');
  const verified=await client.auth.getUser();if(verified.error||!verified.data?.user)throw verified.error||Error('Your session could not be verified. Return to sign in or request a new link.');
  if(!recovery&&!verified.data.user.email_confirmed_at)throw Error('Your email is not validated yet. Return to sign in and request a fresh confirmation email.');
  if(recovery){
   heading('Reset your password');status('Create a new password for your AEOGEO Search account.');form.hidden=false;let saving=false;
   form.onsubmit=async event=>{
    event.preventDefault();if(saving||!form.reportValidity())return;saving=true;const button=form.querySelector('button[type="submit"]');button.disabled=true;button.textContent='Saving password...';
    try{const result=await client.auth.updateUser({password:$('new-password').value});if(result.error)throw result.error;if(!result.data?.user)throw Error('The password update could not be verified. Please try again.');$('new-password').value='';concealPassword($('new-password'));form.hidden=true;continuation.hidden=false;heading('Password updated');status(auditDestination?'Your password has been updated. Continue to the audit.':'Your password has been updated. Continue to your account.');try{sessionStorage.removeItem('aeogeo-next');}catch{}}
    catch(error){status(String(error?.message||'The password could not be saved. Please try again.'));}
    finally{saving=false;button.disabled=false;button.textContent='Save new password';}
   };
  }else{heading('Email validated. You are signed in.');status(auditDestination?'Your account is verified. Returning you to your audit...':'Your account is verified. Returning you to your account...');continuation.hidden=false;try{sessionStorage.removeItem('aeogeo-next');}catch{}location.replace(destination);}
 }catch(error){
  form.hidden=true;continuation.hidden=true;const detail=String(error?.message||'The link could not be verified.');
  if(/code challenge|code verifier|flow state/i.test(detail)){heading('Finish signing in');status('This older email link could not finish signing in in this browser. Your email may already be confirmed. Return to sign in with your email and password. If sign-in says your email is not confirmed, request a fresh confirmation email.');}
  else{heading('Account link needs attention');status(detail+(recovery?' Return to sign in and request a new password reset link.':' Return to sign in. If your email is not confirmed, request a fresh confirmation email.'));}
 }
}
$('menu-toggle')?.addEventListener('click',()=>{const open=$('nav-links').classList.toggle('open');$('menu-toggle').setAttribute('aria-expanded',String(open));});
if(mode==='landing'){let interval='month';document.querySelectorAll('[data-billing]').forEach(b=>b.onclick=()=>{interval=b.dataset.billing;document.querySelectorAll('[data-billing]').forEach(x=>x.setAttribute('aria-pressed',String(x===b)));document.querySelectorAll('[data-price]').forEach(x=>x.textContent='$'+(Number(x.dataset.price)*(interval==='year'?.8:1)).toLocaleString('en-US',{minimumFractionDigits:interval==='year'?2:0,maximumFractionDigits:2}));document.querySelectorAll('[data-total]').forEach(x=>x.textContent=interval==='year'?'$'+Number(x.dataset.total).toLocaleString('en-US',{minimumFractionDigits:2})+' billed yearly in USD':'Billed monthly in USD');});document.querySelectorAll('.choose-plan').forEach(b=>b.onclick=async()=>{
 if(b.disabled)return;const selected='/account/?plan='+encodeURIComponent(b.dataset.plan)+'&interval='+interval,label=b.textContent;let redirecting=false;
 b.disabled=true;b.textContent='Opening secure checkout...';msg('plan-message','');
 try{const current=await getClient().auth.getSession();if(current.error)throw current.error;if(!current.data?.session){location.assign('/login/?next='+encodeURIComponent(selected));redirecting=true;return;}await checkout(b.dataset.plan,interval);redirecting=true;}
 catch(error){if(error.authRequired){location.assign('/login/?next='+encodeURIComponent(selected));redirecting=true;}else{msg('plan-message',error.message||'Checkout could not open. No payment was taken. Please retry or contact support.',true);$('plan-message')?.scrollIntoView({block:'nearest'});}}
 finally{if(!redirecting){b.disabled=false;b.textContent=label;}}
});}
if(mode==='tool'){$('comparison-load').onclick=loadComparison;$('audit-form').onsubmit=beginAudit;$('open-preview').onclick=()=>loadSample().catch(e=>msg('tool-message',e.message,true));$('page-search').oninput=()=>report&&renderPages();document.querySelectorAll('[data-tab]').forEach(b=>b.onclick=()=>{document.querySelectorAll('[data-tab]').forEach(x=>x.setAttribute('aria-selected',String(x===b)));document.querySelectorAll('.tab-pane').forEach(x=>x.hidden=x.id!=='pane-'+b.dataset.tab);});$('results-panel').onclick=async e=>{const p=e.target.closest('.page-open'),c=e.target.closest('.copy-template');if(p)openPage(Number(p.dataset.index));if(c){try{await navigator.clipboard.writeText(template(c.dataset.template));c.textContent='Copied';}catch{c.textContent='Select and copy the template above';}}};$('drawer-close').onclick=closeDrawer;$('page-drawer').onclick=e=>{if(e.target===$('page-drawer'))closeDrawer();};document.addEventListener('keydown',e=>{if(e.key==='Escape')closeDrawer();});$('sim-options').onchange=updateSimulator;$('sim-all').onclick=()=>{document.querySelectorAll('#sim-options input').forEach(x=>x.checked=true);updateSimulator();};$('sim-reset').onclick=()=>{document.querySelectorAll('#sim-options input').forEach(x=>x.checked=false);updateSimulator();};$('export-pdf').onclick=()=>window.print();$('export-md').onclick=()=>{const md=`# AEOGEO Website Readiness Audit${sample?'  -  SAMPLE':''}\n\nSite: ${report.target}\nDate: ${report.createdAt}\nScore: ${scoreText(report.score)}/100\n\n## Method and limitations\n${report.framework}\n\n${report.limitations.map(s=>'- '+s).join('\n')}\n\n## Prioritized review roadmap\n${report.fixes.map((f,i)=>`### ${i+1}. ${f.title}\n${f.fix}\n\nAffected pages:\n${f.affected.map(u=>'- '+u).join('\n')}\n\nTemplate only  -  review before implementation:\n\`\`\`\n${template(f.id)}\n\`\`\``).join('\n\n')}\n\n## Page evidence\n${report.pages.map(p=>`### ${p.title}\nURL: ${p.url}\nScore: ${scoreText(p.score)}\n${p.metrics.map(m=>`- ${m.name} (${m.method}, ${scoreText(m.score)}): ${m.evidence}`).join('\n')}`).join('\n\n')}\n`;download(reportName()+'.md',md,'text/markdown');};$('export-csv').onclick=()=>{const cell=v=>'"'+String(v??'').replace(/"/g,'""').replace(/^(?=\s*[=+\-@]|[\t\r\n])/,"'")+'"',rows=[['sample','url','title','page_score','metric','method','metric_score','status','evidence','recommendation'],...report.pages.flatMap(p=>p.metrics.map(m=>[sample,p.url,p.title,p.score,m.name,m.method,m.score,m.status,m.evidence,m.fix]))];download(reportName()+'.csv','\uFEFF'+rows.map(r=>r.map(cell).join(',')).join('\r\n'),'text/csv;charset=utf-8');};const q=new URLSearchParams(location.search);if(q.has('sample'))loadSample().catch(e=>msg('tool-message',e.message,true));else if(q.has('report'))api('product-api',{query:'?action=report&id='+encodeURIComponent(q.get('report'))}).then(j=>renderReport(j.report)).catch(e=>msg('tool-message',e.message,true));else if(q.has('job')){$('tool-input').hidden=true;$('tool-progress').hidden=false;poll(q.get('job'));}}
if(mode==='account'){$('billing-review-refresh')?.addEventListener('click',loadBillingReviews);$('billing-review-list')?.addEventListener('click',decideBillingReview);$('sign-out').onclick=event=>signOutAndReturn(event.currentTarget);$('refresh-account').onclick=loadAccount;$('billing-portal').onclick=async()=>{try{const r=await api('billing-portal',{body:{}});const u=new URL(r.url);if(u.protocol!=='https:'||u.hostname!=='billing.stripe.com')throw Error('Unexpected billing destination.');location.assign(u.href);}catch(e){msg('account-message',e.message,true);}};$('account-jobs').onclick=async e=>{const b=e.target.closest('.legacy-download');if(!b)return;try{const j=await api('product-api',{query:'?action=report&legacy=1&id='+encodeURIComponent(b.dataset.id)});download('aeogeo-legacy-report.json',JSON.stringify(j.report,null,2),'application/json');}catch(e){msg('account-message',e.message,true);}};loadAccount();}
initPasswordVisibility();if(mode==='login')initAuth();if(mode==='callback')initCallback();
})();
