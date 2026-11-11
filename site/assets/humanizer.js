/* AEOGEO AI Content Humanizer — server-side rewrite.
   Sends the passage to the site's serverless endpoint (/.netlify/functions/humanize),
   which holds the AI provider key. No model is downloaded; no text leaves except to that endpoint. */
(function(){
'use strict';
const $ = id => document.getElementById(id);
const input = $('hz-input'), output = $('hz-output'), runBtn = $('hz-run'), cancelBtn = $('hz-cancel');
const copyBtn = $('hz-copy'), regenBtn = $('hz-regenerate'), clearBtn = $('hz-clear');
const status = $('hz-status'), count = $('hz-count'), outCount = $('hz-out-count');
const MAX = 1500, ENDPOINT = 'https://ftwohoenimegsmtliqgz.supabase.co/functions/v1/humanize';
const words = v => (String(v || '').trim().match(/[\p{L}\p{N}]+(?:['’.-][\p{L}\p{N}]+)*/gu) || []).length;
const clock = () => Math.floor((Date.now() - startTime) / 1000);
let controller = null, timer = null, startTime = 0, busy = false;

function setStatus(message, isError) {
  if (!status) return;
  status.textContent = message || '';
  status.setAttribute('role', isError ? 'alert' : 'status');
  status.classList.toggle('hz-error', Boolean(isError));
}
function refreshClearCopy() {
  if (clearBtn) clearBtn.disabled = !input.value && !output.value;
  if (copyBtn) copyBtn.disabled = !output.value;
  if (regenBtn) regenBtn.disabled = !output.value || busy;
}
function updateCount() {
  const n = input.value.length;
  if (count) count.textContent = n.toLocaleString('en-US') + ' / 1,500 characters';
  input.setAttribute('aria-invalid', String(n > MAX));
  refreshClearCopy();
}
function setBusy(next) {
  busy = next;
  if (runBtn) { runBtn.disabled = next; runBtn.textContent = next ? 'Humanizing…' : 'Humanize text'; }
  if (cancelBtn) cancelBtn.hidden = !next;
  if (input) input.readOnly = next;
  if (copyBtn) copyBtn.disabled = next || !output.value;
  if (regenBtn) regenBtn.disabled = next || !output.value;
  if (clearBtn) clearBtn.disabled = next || (!input.value && !output.value);
}
async function humanize() {
  if (busy) return;
  const text = input.value.trim();
  if (!text) { setStatus('Paste your text first — then select Humanize text.', true); input.focus(); return; }
  if (text.length > MAX) { setStatus('That is ' + text.length.toLocaleString('en-US') + ' characters. Shorten it to ' + MAX.toLocaleString('en-US') + ' or fewer, then try again.', true); input.focus(); return; }
  startTime = Date.now();
  controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 28000);
  setBusy(true);
  output.value = '';
  if (outCount) outCount.textContent = '0 words';
  setStatus('Working on your server… 0s');
  clearInterval(timer);
  timer = setInterval(() => setStatus('Working on your server… ' + clock() + 's — usually a few seconds. Stop anytime.'), 500);
  try {
    const response = await fetch(ENDPOINT, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ text }),
      signal: controller.signal
    });
    let data = null;
    try { data = await response.json(); } catch (_) { /* handled below */ }
    if (!response.ok) {
      const detail = data && data.error ? data.error : 'Please try again in a moment.';
      if (response.status === 429) throw new Error('The service is busy right now (too many requests). Wait a minute and try again.');
      if (response.status === 400) throw new Error(detail);
      if (response.status === 503 || response.status === 502 || response.status === 504) throw new Error('The rewrite service is temporarily unavailable. ' + detail);
      throw new Error(detail);
    }
    const out = (data && typeof data.text === 'string') ? data.text.trim() : '';
    if (!out) throw new Error('The rewrite came back empty. Please try again.');
    output.value = out;
    if (outCount) outCount.textContent = words(out).toLocaleString('en-US') + ' words';
    setStatus('Draft ready in ' + clock() + 's. Check names, numbers, claims and tone against your original before publishing.');
  } catch (error) {
    if (error.name === 'AbortError') setStatus('Stopped. Your original is unchanged.');
    else if (error instanceof TypeError) setStatus('You appear to be offline. Reconnect and try again — your original is unchanged.', true);
    else setStatus(error.message || 'The rewrite could not be completed. Please try again.', true);
  } finally {
    clearTimeout(timeout);
    clearInterval(timer);
    setBusy(false);
    updateCount();
  }
}
input && input.addEventListener('input', updateCount);
runBtn && runBtn.addEventListener('click', humanize);
regenBtn && regenBtn.addEventListener('click', humanize);
cancelBtn && cancelBtn.addEventListener('click', () => { if (controller) controller.abort(); });
clearBtn && clearBtn.addEventListener('click', () => {
  input.value = '';
  output.value = '';
  if (outCount) outCount.textContent = '0 words';
  setStatus('Cleared. Paste your text to begin.');
  updateCount();
  input.focus();
});
copyBtn && copyBtn.addEventListener('click', async () => {
  const text = output.value;
  if (!text) return;
  try { await navigator.clipboard.writeText(text); setStatus('Draft copied to your clipboard.'); }
  catch (_) {
    output.select();
    const ok = document.execCommand && document.execCommand('copy');
    setStatus(ok ? 'Draft copied to your clipboard.' : 'Copy is unavailable. Your draft is selected — use your browser copy command.');
  }
});
updateCount();
setStatus('Paste your text to begin. Select Humanize text and your draft usually appears within a few seconds.');
window.AEOGEOHumanizerReady = true;
})();

/* AEOGEO Humanizer dual-dropdown nav v2 */(()=>{const Y=document.querySelector("header");if(!Y)return;const N=Y.querySelector("nav"),h=Y.querySelector('button[aria-label="Open navigation menu"]');if(!N)return;const MENUS={"About":[["About","/about"],["What is AEOM?","/what-is-aeom"]],"DIY Tools":[["GEO Audit","/geo-audit/"],["Competitor Intelligence","/competitor-intelligence"],["Directory Listing Kit","/directory-listing-kit/"]],"Free Audit Tools":[["Resources Hub","/resources"],["Knowledge Library","/learn"],["Robots Text Generator","https://aeogeosearch.com/tools#robots-txt-generator"],["GEO Content Checker","/tools/geo-content-checker/"],["Free AI Visibility Snapshot","/visibility-tool"],["AI Content Humanizer","/ai-content-humanizer"]]};const groups=[];let seq=0;for(const btn of N.querySelectorAll("button")){const label=btn.textContent.trim(),items=MENUS[label];if(!items)continue;const c=document.createElement("div");c.id="hz-nav-menu-"+(++seq);c.className="hz-diy-menu";c.hidden=!0;for(const[txt,href]of items){const a=document.createElement("a");a.textContent=txt;a.href=href;if(href==="/ai-content-humanizer")a.setAttribute("aria-current","page");c.append(a);}btn.parentNode.append(c);btn.setAttribute("aria-controls",c.id);const g={btn,c};groups.push(g);btn.addEventListener("click",()=>{const next=c.hidden;for(const o of groups){o.c.hidden=!0;o.btn.setAttribute("aria-expanded","false");}c.hidden=!next;btn.setAttribute("aria-expanded",String(next));});}const closeAll=()=>{for(const o of groups){o.c.hidden=!0;o.btn.setAttribute("aria-expanded","false");}};document.addEventListener("click",e=>{for(const o of groups)if(!o.btn.parentNode.contains(e.target)){o.c.hidden=!0;o.btn.setAttribute("aria-expanded","false");}});document.addEventListener("keydown",e=>{if(e.key!=="Escape")return;const openG=groups.find(o=>!o.c.hidden);if(openG){closeAll();openG.btn.focus();}else if(h?.getAttribute("aria-expanded")==="true"){h.click();h.focus();}});h?.addEventListener("click",()=>{const e=h.getAttribute("aria-expanded")!=="true";h.setAttribute("aria-expanded",String(e));h.setAttribute("aria-label",e?"Close navigation menu":"Open navigation menu");if(!e)closeAll();N.classList.toggle("hz-mobile-open",e);});})();
