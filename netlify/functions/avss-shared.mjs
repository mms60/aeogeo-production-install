import { createClient } from "@supabase/supabase-js";
import dns from "node:dns/promises";
import net from "node:net";

// These are Netlify Functions 2.0 handlers (ESM default export), so every response
// must be a real Response object. Returning {statusCode, headers, body} makes the
// platform reject the value with a 502 before the client ever sees the JSON.
export const json = (statusCode, body) => new Response(JSON.stringify(body), {
  status: statusCode,
  headers: {"Content-Type":"application/json; charset=utf-8","Cache-Control":"no-store"}
});
export function headerValue(headers, name) {
  if (!headers) return "";
  if (typeof headers.get === "function") return headers.get(name) || "";
  return headers[name] || headers[name.toLowerCase()] || headers[name.toUpperCase()] || "";
}
export const requestMethod = event => String(event?.method || event?.httpMethod || "GET").toUpperCase();
export const readBody = async event => {
  const raw = typeof event?.text === "function" && typeof event?.headers?.get === "function"
    ? await event.text()
    : event?.body || "";
  try { return JSON.parse(raw || "{}"); } catch { throw new Error("Request body must be valid JSON."); }
};
export function adminClient() {
  if(!process.env.SUPABASE_URL || !process.env.SUPABASE_SERVICE_ROLE_KEY) throw new Error("Supabase server environment variables are missing.");
  return createClient(process.env.SUPABASE_URL,process.env.SUPABASE_SERVICE_ROLE_KEY,{auth:{persistSession:false,autoRefreshToken:false}});
}
export async function userFromEvent(event) {
  const token=headerValue(event?.headers,"authorization").replace(/^Bearer\s+/i,"");
  if(!token) throw Object.assign(new Error("Sign in is required."),{status:401,code:"SIGN_IN_REQUIRED"});
  const anon=process.env.SUPABASE_ANON_KEY||process.env.SUPABASE_PUBLISHABLE_KEY;
  if(!anon) throw Object.assign(new Error("The Supabase public key is missing."),{status:503,code:"AUTH_CONFIGURATION"});
  let client;
  try{
    client=createClient(process.env.SUPABASE_URL,anon,{auth:{persistSession:false}});
  }catch{
    throw Object.assign(new Error("The sign-in service is not configured."),{status:503,code:"AUTH_CONFIGURATION"});
  }
  let data,error;
  try{
    ({data,error}=await client.auth.getUser(token));
  }catch{
    throw Object.assign(new Error("The sign-in service could not be reached. Please retry."),{status:503,code:"AUTH_UNAVAILABLE"});
  }
  if(error&&(error.name==="AuthRetryableFetchError"||error.status===0||error.status>=500)){
    throw Object.assign(new Error("The sign-in service could not be reached. Please retry."),{status:503,code:"AUTH_UNAVAILABLE"});
  }
  if(error||!data?.user) throw Object.assign(new Error("Your session is invalid or expired. Please sign in again."),{status:401,code:"SESSION_INVALID"});
  return data.user;
}
async function paidRow(userId) {
  const db=adminClient();
  const {data,error}=await db.from("subscriptions").select("status,current_period_end").eq("user_id",userId).in("status",["active","trialing"]).maybeSingle();
  if(error) throw new Error(`Subscription lookup failed: ${error.message}`);
  return data||null;
}
// A subscription bought before the account existed is stored with the buyer's email.
// The first time that email signs in, the row is attached to the account.
async function claimPendingSubscription(user) {
  if(!user?.email) return false;
  const db=adminClient();
  const {data:rows,error}=await db.from("avss_pending_subscriptions")
    .select("id,stripe_customer_id,stripe_subscription_id,status,price_id,current_period_end")
    .ilike("email",user.email).in("status",["active","trialing"]).limit(1);
  if(error||!rows||!rows.length) return false;
  const row=rows[0];
  const {error:writeError}=await db.from("subscriptions").upsert({
    user_id:user.id,stripe_customer_id:row.stripe_customer_id,stripe_subscription_id:row.stripe_subscription_id,
    status:row.status,price_id:row.price_id,current_period_end:row.current_period_end,updated_at:new Date().toISOString()
  },{onConflict:"stripe_subscription_id"});
  if(writeError) return false;
  if(row.stripe_customer_id) await db.from("profiles").upsert({id:user.id,stripe_customer_id:row.stripe_customer_id},{onConflict:"id"});
  await db.from("avss_pending_subscriptions").delete().eq("id",row.id);
  return true;
}
export async function requirePaid(userOrId) {
  const user = typeof userOrId === "string" ? { id: userOrId } : userOrId;
  let data = await paidRow(user.id);
  if(!data && user.email && await claimPendingSubscription(user)) data = await paidRow(user.id);
  if(!data) throw new Error("An active paid subscription is required to use this tool.");
  if(data.current_period_end && new Date(data.current_period_end)<new Date()) throw new Error("Your subscription period has expired.");
  return data;
}
export async function assertPublicHttpUrl(raw) {
  let u; try{u=new URL(raw);}catch{throw new Error("Enter a valid website URL.");}
  if(!["http:","https:"].includes(u.protocol)) throw new Error("Only HTTP and HTTPS websites are supported.");
  if(u.username||u.password) throw new Error("URLs containing credentials are not allowed.");
  const host=u.hostname.toLowerCase().replace(/\.$/,"");
  if(!host) throw new Error("Enter a valid website URL.");
  if(host==="localhost"||host.endsWith(".localhost")||host.endsWith(".local")||host.endsWith(".internal")||host==="metadata.google.internal"||host==="metadata") throw new Error("Private and local hosts cannot be scanned.");
  const records=await dns.lookup(host,{all:true,verbatim:true}).catch(()=>[]);
  if(!records.length) throw new Error("The hostname could not be resolved.");
  for(const rec of records) if(isPrivateIp(rec.address)) throw new Error("Private, local, or reserved IP addresses cannot be scanned.");
  u.hostname=host;
  return u;
}
function isPrivateIpv4(ip){
  const parts=ip.split(".").map(Number);
  if(parts.length!==4||parts.some(n=>!Number.isInteger(n)||n<0||n>255)) return true;
  const [a,b,c]=parts;
  return a===0||a===10||a===127||a>=224
    ||(a===169&&b===254)
    ||(a===172&&b>=16&&b<=31)
    ||(a===192&&b===168)
    ||(a===100&&b>=64&&b<=127)
    ||(a===192&&b===0&&(c===0||c===2))
    ||(a===198&&(b===18||b===19))
    ||(a===198&&b===51&&c===100)
    ||(a===203&&b===0&&c===113)
    ||(a===192&&b===88&&c===99);
}
function isPrivateIpv6(ip){
  const x=ip.toLowerCase();
  if(x==="::"||x==="::1") return true;
  if(x.startsWith("fc")||x.startsWith("fd")) return true;
  if(/^fe[89ab]/.test(x)) return true;
  if(x.startsWith("2001:db8")||x.startsWith("2002:")||x.startsWith("64:ff9b:")||x.startsWith("100:")||x.startsWith("2001:0:")) return true;
  const mapped=x.match(/^::ffff:(\d+\.\d+\.\d+\.\d+)$/);
  if(mapped) return isPrivateIpv4(mapped[1]);
  const hexMapped=x.match(/^::ffff:([0-9a-f]{1,4}):([0-9a-f]{1,4})$/);
  if(hexMapped){
    const hi=parseInt(hexMapped[1],16),lo=parseInt(hexMapped[2],16);
    return isPrivateIpv4([hi>>8,hi&255,lo>>8,lo&255].join("."));
  }
  return false;
}
function isPrivateIp(ip){
  if(net.isIPv4(ip)) return isPrivateIpv4(ip);
  if(net.isIPv6(ip)) return isPrivateIpv6(ip);
  return true;
}
export async function readLimitedText(response, limit) {
  const declared = Number(response.headers.get("content-length") || 0);
  if (declared && declared > limit) throw Object.assign(new Error("The page is too large to audit."), { status: 413 });
  if (!response.body) {
    const text = await response.text();
    if (Buffer.byteLength(text, "utf8") > limit) throw Object.assign(new Error("The page is too large to audit."), { status: 413 });
    return text;
  }
  const reader = response.body.getReader();
  const chunks = [];
  let total = 0;
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.byteLength;
    if (total > limit) {
      try { await reader.cancel(); } catch {}
      throw Object.assign(new Error("The page is too large to audit."), { status: 413 });
    }
    chunks.push(value);
  }
  const merged = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    merged.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return new TextDecoder("utf-8", { fatal: false }).decode(merged);
}
export async function safeFetch(url, options={}) {
  let current=await assertPublicHttpUrl(url);
  for(let i=0;i<4;i++){
    const controller=new AbortController(), timer=setTimeout(()=>controller.abort(),options.timeout||12000);
    let res;
    try{
      res=await fetch(current.href,{method:"GET",redirect:"manual",signal:controller.signal,headers:{
        "User-Agent":options.userAgent||"AEOGEO-Accessibility-Audit/1.0 (+https://aeogeosearch.com)",
        "Accept":"text/html,application/xhtml+xml,application/xml,text/plain;q=0.9,*/*;q=0.5"
      }});
    }finally{clearTimeout(timer);}
    if([301,302,303,307,308].includes(res.status)){
      const loc=res.headers.get("location"); if(!loc) return res;
      current=await assertPublicHttpUrl(new URL(loc,current).href); continue;
    }
    return res;
  }
  throw new Error("Too many redirects.");
}
export async function saveFailure(db,scanId,message){
  await db.from("crawler_scans").update({status:"failed",error_message:String(message).slice(0,1000),completed_at:new Date().toISOString()}).eq("id",scanId);
}
