/* Owner-only TEST provisioning. This script cannot purchase a subscription. */
(()=>{'use strict';
const $=id=>document.getElementById(id),button=$('setup-start'),message=$('setup-message'),login=$('setup-sign-in'),progress=$('setup-progress'),ready=$('setup-ready');
let token=null,pending=false,blocked=true;
const ENDPOINT='/.netlify/functions/owner-monthly-test-setup',services=['ai-visibility-starter','ai-search-growth','ai-search-authority'];
const labels={'ai-visibility-starter':'Starter TEST price','ai-search-growth':'Growth TEST price','ai-search-authority':'Authority TEST price'};
function signIn(){blocked=true;button.disabled=true;login.href='/account/?'+new URLSearchParams({next:'/owner-monthly-test/setup/'});login.hidden=false;message.textContent='Sign in with the confirmed website owner account to continue.';}
function record(text){const li=document.createElement('li');li.textContent=text;progress.append(li);}
async function request(body,preflight=false){
 const r=await fetch(preflight?'/.netlify/functions/owner-monthly-test?preflight=1':ENDPOINT,{method:body?'POST':'GET',headers:{Authorization:'Bearer '+token,...(body?{'Content-Type':'application/json'}:{})},cache:'no-store',...(body?{body:JSON.stringify(body)}:{})});
 if(r.status===401){signIn();throw Error('Please sign in again with the website owner account.');}
 if(r.status===403){blocked=true;throw Error('Automatic TEST setup is restricted to the confirmed website owner account.');}
 let data;try{data=await r.json();}catch{throw Error('The TEST setup response could not be read. No purchase started.');}
 if(!r.ok||data.testMode!==true){const code=/^SETUP_[A-Z_]{1,40}$/.test(data.code||'')?data.code:'SETUP_FAILED';throw Error('Automatic TEST setup stopped. Reference: '+code+'. LIVE settings were not changed.');}
 return data;
}
async function validate(){message.textContent='Validating the saved TEST prices, billing policy, owner access, and TEST storage...';const result=await request(null,true);if(result.ready!==true)throw Error('TEST preflight did not pass. Checkout remains disabled. Leave settings unchanged and report this result.');ready.hidden=false;button.hidden=true;record('TEST preflight passed. No purchase was made.');message.textContent='TEST setup validated. LIVE checkout remains locked. Inspect each plan before completing one test payment.';}
button.addEventListener('click',async()=>{
 if(pending||blocked||!token)return;pending=true;button.disabled=true;progress.replaceChildren();ready.hidden=true;
 try{
  message.textContent='Preparing TEST-only setup. No payment is being made...';let state=await request({step:'begin'});
  if(!state.ready){
   record('Separate TEST key accepted. LIVE payment locks remain closed.');
   for(const service of services){state=await request({step:'price',service,lock:state.lock});record(labels[service]+' ready.');}
   state=await request({step:'portal',lock:state.lock});record('Separate TEST billing portal ready. Period-end cancellation enabled; plan changes disabled.');
   state=await request({step:'webhook',lock:state.lock});if(state.ready!==true)throw Error('TEST setup did not complete. Checkout remains disabled.');record('Separate TEST webhook ready. Signing secret saved encrypted on the server.');
  }
  await validate();
 }catch(e){message.textContent=e.message;}finally{pending=false;button.disabled=blocked||!token;}
});
(async()=>{try{
 if(!window.supabase)throw Error('Website sign-in could not load. Please refresh and try again.');
 const client=window.supabase.createClient('https://ftwohoenimegsmtliqgz.supabase.co','sb_publishable_0T08Pe4A0ZvoHD5CXrd1iA_BvUyVxAO',{auth:{flowType:'pkce',detectSessionInUrl:false,persistSession:true,autoRefreshToken:true}});
 const result=await client.auth.getSession();if(result.error||!result.data?.session){signIn();return;}token=result.data.session.access_token;
 const state=await request();blocked=false;
 if(state.configured===true)await validate();else{message.textContent='Ready for automatic TEST setup. Click once to create or reuse the TEST fixtures and validate the connection. No purchase starts here.';button.disabled=false;}
 }catch(e){message.textContent=e.message;button.disabled=true;}})();
})();
