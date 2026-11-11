/* Supabase browser client. Only the public anon key belongs here. */
const CONFIG = {
  supabaseUrl: window.SUPABASE_URL || "",
  supabaseAnonKey: window.SUPABASE_ANON_KEY || ""
};
let supabaseClient, currentSession;
const $ = id => document.getElementById(id);
const show = (id, yes=true) => $(id).classList.toggle("hidden", !yes);
const msg = (id, value) => $(id).textContent = value;
const esc = s => String(s ?? "").replace(/[&<>"']/g, c => ({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c]));
async function api(path, body={}) {
  const token = currentSession?.access_token;
  const response = await fetch(`/.netlify/functions/avss-${path}`, {
    method:"POST", headers:{"Content-Type":"application/json", ...(token?{Authorization:`Bearer ${token}`}:{})},
    body:JSON.stringify(body)
  });
  const data = await response.json().catch(()=>({error:"Invalid server response"}));
  if(!response.ok) throw new Error(data.error || `Request failed (${response.status})`);
  return data;
}
function activateTab(name){
  document.querySelectorAll(".tab").forEach(b=>b.classList.toggle("active",b.dataset.tab===name));
  document.querySelectorAll(".tab-content").forEach(s=>s.classList.toggle("hidden",s.id!==`tab-${name}`));
}
document.querySelectorAll(".tab").forEach(b=>b.addEventListener("click",()=>activateTab(b.dataset.tab)));
async function updateSession(session){
  currentSession=session;
  const signedIn=!!session;
  show("auth-panel",!signedIn); show("signout",signedIn);
  $("account-label").textContent=signedIn?(session.user.email||"Signed in"):"Not signed in";
  if(!signedIn){show("app-panel",false);show("paywall",false);return;}
  try{
    const status=await api("subscription-status");
    show("app-panel",!!status.active); show("paywall",!status.active);
    if(status.active) loadHistory();
  }catch(e){show("app-panel",false);show("paywall",true);msg("auth-message",e.message);}
}
async function init(){
  if(!CONFIG.supabaseUrl || !CONFIG.supabaseAnonKey){
    msg("auth-message","Setup required: add SUPABASE_URL and SUPABASE_ANON_KEY to config.js in this folder.");
    return;
  }
  supabaseClient=window.supabase.createClient(CONFIG.supabaseUrl,CONFIG.supabaseAnonKey);
  const {data:{session}}=await supabaseClient.auth.getSession(); await updateSession(session);
  supabaseClient.auth.onAuthStateChange((_event,session)=>updateSession(session));
}
const APP_PATH="/ai-visibility-schema-studio/app/";
function authBusy(busy){
  ["signin-button","signup-button","forgot-password","magic-link"].forEach(id=>$(id).disabled=busy);
}
function authError(error){
  const text=String(error?.message||"");
  if(/invalid login credentials/i.test(text))return "That email and password don’t match an account. Check them, or use Create account / Forgot password?.";
  if(/email not confirmed/i.test(text))return "Confirm your email address first — open the link we emailed you, then sign in here.";
  if(/already registered/i.test(text))return "That email already has an AEOGEO Search account. Sign in with your existing password.";
  if(/password should be at least/i.test(text))return text;
  if(/rate limit|too many/i.test(text))return "Too many attempts. Wait a minute and try again.";
  if(/failed to fetch|networkerror/i.test(text))return "Could not reach the sign-in service. Check your connection and try again.";
  return text||"Something went wrong. Try again.";
}
const entry=()=>({email:$("email").value.trim(),password:$("password").value});
$("login-form").addEventListener("submit",async e=>{
  e.preventDefault();
  const {email,password}=entry();
  if(!email||!password){msg("auth-message","Enter your email address and password.");return;}
  authBusy(true);msg("auth-message","Signing in…");
  try{
    const {error}=await supabaseClient.auth.signInWithPassword({email,password});
    msg("auth-message",error?authError(error):"Signed in.");
  }catch(err){msg("auth-message",authError(err));}finally{authBusy(false);}
});
$("signup-button").addEventListener("click",async()=>{
  const {email,password}=entry();
  if(!email){msg("auth-message","Enter your email address, then choose a password and press Create account.");$("email").focus();return;}
  if(password.length<8){msg("auth-message","Choose a password of at least 8 characters.");$("password").focus();return;}
  authBusy(true);msg("auth-message","Creating your account…");
  try{
    const {data,error}=await supabaseClient.auth.signUp({email,password,options:{emailRedirectTo:location.origin+APP_PATH}});
    if(error){msg("auth-message",authError(error));return;}
    if(data?.user&&Array.isArray(data.user.identities)&&data.user.identities.length===0){
      msg("auth-message","That email already has an AEOGEO Search account. Sign in with your existing password, or use Forgot password?.");return;
    }
    msg("auth-message",data?.session
      ?"Account created and signed in."
      :`Account created. Open the confirmation link we emailed to ${email}, then sign in here with the password you just chose.`);
  }catch(err){msg("auth-message",authError(err));}finally{authBusy(false);}
});
$("forgot-password").addEventListener("click",async()=>{
  const email=$("email").value.trim();
  if(!email){msg("auth-message","Enter your email address, then press Forgot password?.");$("email").focus();return;}
  authBusy(true);msg("auth-message","Sending a password reset link…");
  try{
    const {error}=await supabaseClient.auth.resetPasswordForEmail(email,{redirectTo:location.origin+"/auth/callback/"});
    msg("auth-message",error?authError(error):`If ${email} has an account, a password reset link is on its way.`);
  }catch(err){msg("auth-message",authError(err));}finally{authBusy(false);}
});
$("magic-link").addEventListener("click",async()=>{
  const email=$("email").value.trim();
  if(!email){msg("auth-message","Enter your email address, then press Email me a sign-in link.");$("email").focus();return;}
  authBusy(true);msg("auth-message","Sending a sign-in link…");
  try{
    const {error}=await supabaseClient.auth.signInWithOtp({email,options:{emailRedirectTo:location.origin+APP_PATH}});
    msg("auth-message",error?authError(error):"Check your email for the secure sign-in link.");
  }catch(err){msg("auth-message",authError(err));}finally{authBusy(false);}
});
$("signout").addEventListener("click",async()=>{await supabaseClient.auth.signOut();});
document.querySelectorAll("[data-plan]").forEach(b=>b.addEventListener("click",async()=>{
  b.disabled=true;try{const r=await api("stripe-checkout",{plan:b.dataset.plan});location.href=r.url;}catch(e){alert(e.message);}finally{b.disabled=false;}
}));
$("crawler-form").addEventListener("submit",async e=>{
  e.preventDefault();msg("crawler-status","Submitting scan…");$("crawler-results").innerHTML="";
  try{
    const r=await api("start-scan",{url:$("crawl-url").value,maxPages:Number($("page-limit").value)});
    msg("crawler-status",`Scan queued. Scan ID: ${r.scanId}. Refresh history in a moment for status and results.`);
    pollScan(r.scanId);
  }catch(err){msg("crawler-status",err.message);}
});
async function pollScan(id){
  for(let i=0;i<24;i++){
    await new Promise(r=>setTimeout(r,5000));
    try{
      const r=await api("scan-status",{scanId:id});
      if(r.scan?.status==="completed"||r.scan?.status==="failed"){renderCrawler(r);loadHistory();return;}
    }catch(e){msg("crawler-status",e.message);return;}
  }
  msg("crawler-status","The scan is still processing. Check Scan history for its latest status.");
}
function renderCrawler(r){
  const s=r.scan, findings=r.findings||[];
  msg("crawler-status",`Scan ${s.status}. ${s.score==null?"":`Score: ${s.score}/100`}`);
  $("crawler-results").innerHTML=`<div class="grid"><div class="metric"><strong>${s.score??"—"}</strong>Accessibility score</div><div class="metric"><strong>${s.pages_tested??0}</strong>Pages tested</div><div class="metric"><strong>${findings.length}</strong>Findings</div></div>`+
    findings.map(f=>`<div class="finding ${esc(f.severity)}"><strong>${esc(f.severity)} · ${esc(f.title)}</strong><p>${esc(f.evidence||f.recommendation||"")}</p><small>${esc(f.url||"")}</small></div>`).join("");
}
$("schema-form").addEventListener("submit",async e=>{
  e.preventDefault();msg("schema-status","Auditing page and generating schema…");$("schema-results").innerHTML="";
  try{
    const r=await api("schema-generate",{url:$("schema-url").value,type:$("schema-type").value,details:$("schema-details").value,auditExisting:$("schema-audit").checked});
    msg("schema-status","Schema draft generated. Review all values before publishing.");
    const audit=r.audit||{};
    $("schema-results").innerHTML=`<div class="result-card"><h3>Existing schema audit</h3><p>${esc(audit.summary||"No audit summary available.")}</p><div class="grid"><div class="metric"><strong>${audit.jsonLdCount??0}</strong>JSON-LD blocks</div><div class="metric"><strong>${audit.types?.length??0}</strong>Detected types</div></div></div><div class="result-card"><h3>Generated JSON-LD · ${esc(r.schemaType)}</h3><p>Draft only. Verify the business facts, URLs, addresses, prices, and relationships.</p><pre id="schema-code">${esc(JSON.stringify(r.jsonLd,null,2))}</pre><button id="copy-schema">Copy JSON-LD</button><p class="muted">${esc(r.validation?.join(" · ")||"Basic JSON validation passed.")}</p></div>`;
    $("copy-schema").addEventListener("click",()=>navigator.clipboard.writeText(JSON.stringify(r.jsonLd,null,2)));
  }catch(err){msg("schema-status",err.message);}
});
$("refresh-history").addEventListener("click",loadHistory);
async function loadHistory(){
  try{
    const r=await api("scan-history");
    $("history-results").innerHTML=(r.scans||[]).map(s=>`<div class="result-card"><strong>${esc(s.scan_type)} · ${esc(s.target_url)}</strong><p>${esc(s.status)} · ${s.score==null?"Score pending":`${s.score}/100`} · ${esc(new Date(s.created_at).toLocaleString())}</p></div>`).join("")||"<p>No scans yet.</p>";
  }catch(e){$("history-results").textContent=e.message;}
}
init();
