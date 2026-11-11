import { createClient } from "@supabase/supabase-js";
import dns from "node:dns/promises";
import net from "node:net";

export const json = (statusCode, body) => ({
  statusCode, headers: {"Content-Type":"application/json","Cache-Control":"no-store"},
  body: JSON.stringify(body)
});
export const readBody = event => {
  try { return JSON.parse(event.body || "{}"); } catch { throw new Error("Request body must be valid JSON."); }
};
export function adminClient() {
  if(!process.env.SUPABASE_URL || !process.env.SUPABASE_SERVICE_ROLE_KEY) throw new Error("Supabase server environment variables are missing.");
  return createClient(process.env.SUPABASE_URL,process.env.SUPABASE_SERVICE_ROLE_KEY,{auth:{persistSession:false,autoRefreshToken:false}});
}
export async function userFromEvent(event) {
  const token=(event.headers.authorization||event.headers.Authorization||"").replace(/^Bearer\s+/i,"");
  if(!token) throw new Error("Sign in is required.");
  const anon=process.env.SUPABASE_ANON_KEY;
  if(!anon) throw new Error("SUPABASE_ANON_KEY is missing.");
  const client=createClient(process.env.SUPABASE_URL,anon,{auth:{persistSession:false}});
  const {data,error}=await client.auth.getUser(token);
  if(error||!data.user) throw new Error("Your session is invalid or expired. Please sign in again.");
  return data.user;
}
export async function requirePaid(userId) {
  const db=adminClient();
  const {data,error}=await db.from("subscriptions").select("status,current_period_end").eq("user_id",userId).in("status",["active","trialing"]).maybeSingle();
  if(error) throw new Error(`Subscription lookup failed: ${error.message}`);
  if(!data) throw new Error("An active paid subscription is required to use this tool.");
  if(data.current_period_end && new Date(data.current_period_end)<new Date()) throw new Error("Your subscription period has expired.");
  return data;
}
export async function assertPublicHttpUrl(raw) {
  let u; try{u=new URL(raw);}catch{throw new Error("Enter a valid website URL.");}
  if(!["http:","https:"].includes(u.protocol)) throw new Error("Only HTTP and HTTPS websites are supported.");
  if(u.username||u.password) throw new Error("URLs containing credentials are not allowed.");
  const host=u.hostname.toLowerCase();
  if(host==="localhost"||host.endsWith(".localhost")||host.endsWith(".local")||host==="metadata.google.internal") throw new Error("Private and local hosts cannot be scanned.");
  const records=await dns.lookup(host,{all:true,verbatim:true}).catch(()=>[]);
  if(!records.length) throw new Error("The hostname could not be resolved.");
  for(const rec of records) if(isPrivateIp(rec.address)) throw new Error("Private, local, or reserved IP addresses cannot be scanned.");
  return u;
}
function isPrivateIp(ip){
  if(net.isIPv4(ip)){
    const [a,b]=ip.split(".").map(Number);
    return a===0||a===10||a===127||a>=224||(a===169&&b===254)||(a===172&&b>=16&&b<=31)||(a===192&&b===168)||(a===100&&b>=64&&b<=127);
  }
  if(net.isIPv6(ip)){
    const x=ip.toLowerCase();
    return x==="::"||x==="::1"||x.startsWith("fc")||x.startsWith("fd")||x.startsWith("fe8")||x.startsWith("fe9")||x.startsWith("fea")||x.startsWith("feb")||x.startsWith("::ffff:127.")||x.startsWith("::ffff:10.");
  }
  return true;
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
