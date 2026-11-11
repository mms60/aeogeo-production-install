import * as cheerio from "cheerio";
import { adminClient, safeFetch, assertPublicHttpUrl, saveFailure } from "./avss-shared.mjs";
export const config = { type:"background" };
const BOTS=[
  {name:"OAI-SearchBot",ua:"OAI-SearchBot"},
  {name:"PerplexityBot",ua:"PerplexityBot"},
  {name:"Googlebot",ua:"Googlebot"},
  {name:"ClaudeBot",ua:"ClaudeBot"},
  {name:"GPTBot",ua:"GPTBot"}
];
function parseRobots(text,token){
  const groups=[];let group=null;
  for(const raw of text.split(/\r?\n/)){
    const line=raw.split("#")[0].trim();if(!line)continue;
    const idx=line.indexOf(":");if(idx<0)continue;
    const key=line.slice(0,idx).trim().toLowerCase(),value=line.slice(idx+1).trim();
    if(key==="user-agent"){if(!group||group.rules.length){group={agents:[],rules:[]};groups.push(group);}group.agents.push(value.toLowerCase());}
    else if(["allow","disallow"].includes(key)&&group)group.rules.push({key,path:value});
  }
  const matching=groups.filter(g=>g.agents.includes("*")||g.agents.includes(token.toLowerCase()));
  const rules=matching.flatMap(g=>g.rules).filter(r=>r.path);
  rules.sort((a,b)=>b.path.length-a.path.length);
  const hit=rules.find(r=>"/".startsWith(r.path)||r.path==="/");
  return hit ? hit.key==="allow" : true;
}
async function fetchText(url,ua){
  const r=await safeFetch(url,{userAgent:ua,timeout:12000});
  const ct=r.headers.get("content-type")||"";
  const body=(await r.text()).slice(0,2_000_000);
  return {status:r.status,headers:r.headers,body,contentType:ct};
}
function scoreFindings(findings){let score=100;for(const f of findings){score-=({critical:20,high:12,medium:6,low:2}[f.severity]||0);}return Math.max(0,Math.min(100,score));}
export default async event=>{
  const db=adminClient();let input;
  try{
    input=JSON.parse(event.body||"{}");
    await db.from("crawler_scans").update({status:"running",started_at:new Date().toISOString()}).eq("id",input.scanId);
    const root=await assertPublicHttpUrl(input.url), origin=root.origin, findings=[], pageQueue=[root.href], visited=new Set(), pageRows=[];
    let robotsText="", sitemapUrls=[];
    try{const r=await fetchText(new URL("/robots.txt",origin).href);robotsText=r.body;if(r.status>=400)findings.push({severity:"medium",title:"robots.txt not available",url:new URL("/robots.txt",origin).href,evidence:`HTTP ${r.status}`,recommendation:"Publish a valid robots.txt file. Your separate free robots.txt tool can help create and check it."});}
    catch(e){findings.push({severity:"medium",title:"Could not retrieve robots.txt",url:new URL("/robots.txt",origin).href,evidence:e.message,recommendation:"Check hosting, firewall and robots.txt availability."});}
    for(const sm of robotsText.match(/Sitemap:\s*(\S+)/gi)||[]) sitemapUrls.push(sm.replace(/^Sitemap:\s*/i,""));
    if(!sitemapUrls.length)sitemapUrls.push(new URL("/sitemap.xml",origin).href);
    for(const sm of [...new Set(sitemapUrls)].slice(0,3)){
      try{const r=await fetchText(sm);if(r.status===200){const $=cheerio.load(r.body,{xmlMode:true});$("loc").each((_,el)=>{const u=$(el).text().trim();if(u.startsWith(origin))pageQueue.push(u);});}}
      catch{}
    }
    const limit=Math.min(input.maxPages||10,20);
    while(pageQueue.length&&visited.size<limit){
      const url=pageQueue.shift();if(visited.has(url))continue;visited.add(url);
      try{
        const r=await fetchText(url);
        if(r.status>=400){findings.push({severity:r.status>=500?"high":"medium",title:"Page returned an HTTP error",url,evidence:`HTTP ${r.status}`,recommendation:"Ensure the page is publicly accessible and returns HTTP 200."});continue;}
        const $=cheerio.load(r.body),title=$("title").first().text().trim(),text=$("body").text().replace(/\s+/g," ").trim();
        const robotsMeta=$('meta[name="robots"],meta[name="googlebot"]').attr("content")||"";
        const canonical=$('link[rel="canonical"]').attr("href")||"";
        const jsonld=$('script[type="application/ld+json"]').length;
        if(!text||text.length<150)findings.push({severity:"high",title:"Very little readable HTML content",url,evidence:`Extracted ${text.length} characters before client-side rendering.`,recommendation:"Make important page copy available in server-rendered HTML; do not rely entirely on JavaScript."});
        if(/noindex/i.test(robotsMeta)||/noindex/i.test(r.headers.get("x-robots-tag")||""))findings.push({severity:"high",title:"Page has a noindex directive",url,evidence:`meta robots: ${robotsMeta||"none"}; X-Robots-Tag: ${r.headers.get("x-robots-tag")||"none"}`,recommendation:"Remove noindex only if this page is intended to be discoverable."});
        if(!title)findings.push({severity:"low",title:"Missing page title",url,evidence:"No title element was found in the returned HTML.",recommendation:"Add a unique, descriptive title element."});
        if(!jsonld)findings.push({severity:"low",title:"No JSON-LD detected",url,evidence:"No application/ld+json block was found.",recommendation:"Use the Schema audit & creation tab to review and generate relevant structured data."});
        pageRows.push({url,http_status:r.status,title,html_text_length:text.length,robots_meta:robotsMeta,canonical,jsonld_count:jsonld});
        $("a[href]").each((_,el)=>{try{const next=new URL($(el).attr("href"),url);if(next.origin===origin&&!visited.has(next.href)&&pageQueue.length<limit*4)pageQueue.push(next.href);}catch{}});
      }catch(e){findings.push({severity:"high",title:"Page fetch failed",url,evidence:e.message,recommendation:"Check server response, firewall, TLS and redirects."});}
    }
    for(const bot of BOTS){
      const allowed=parseRobots(robotsText,bot.name);
      if(!allowed)findings.push({severity:"high",title:`${bot.name} appears disallowed by robots.txt`,url:new URL("/robots.txt",origin).href,evidence:`The parsed robots.txt rules disallow the site root for ${bot.name}.`,recommendation:`Review the ${bot.name} rule. Only allow this crawler if that matches your content-use and visibility policy.`});
      try{
        const probe=await safeFetch(root.href,{userAgent:bot.ua,timeout:10000});
        if(probe.status>=400)findings.push({severity:probe.status>=500?"high":"medium",title:`${bot.name} user-agent simulation received HTTP ${probe.status}`,url:root.href,evidence:"This is a representative user-agent request from the audit service, not a verified request from the provider's real crawler infrastructure.",recommendation:"Review CDN/WAF rules and server logs. Confirm actual crawler IP ranges separately before concluding that the provider is blocked."});
      }catch(e){
        findings.push({severity:"medium",title:`${bot.name} user-agent simulation failed`,url:root.href,evidence:e.message,recommendation:"Check network access and security rules. This simulation does not verify the provider's real crawler IP ranges."});
      }
    }
    let aiSummary = "";
    if(process.env.GROQ_API_KEY && findings.length){
      try{
        const ai=await fetch("https://api.groq.com/openai/v1/chat/completions",{method:"POST",headers:{"Authorization":`Bearer ${process.env.GROQ_API_KEY}`,"Content-Type":"application/json"},body:JSON.stringify({model:process.env.GROQ_MODEL||"llama-3.3-70b-versatile",temperature:0.2,messages:[{role:"system",content:"Explain website crawler audit findings using only the evidence supplied. Do not claim real crawler IP verification. Return a concise executive summary and top three priorities."},{role:"user",content:JSON.stringify({url:root.href,pagesTested:pageRows.length,findings})}]})});
        const payload=await ai.json(); if(ai.ok) aiSummary=payload.choices?.[0]?.message?.content||"";
      }catch{}
    }
    const score=scoreFindings(findings);
    const {error:pageError}=await db.from("crawler_scan_pages").insert(pageRows.map(p=>({...p,scan_id:input.scanId,user_id:input.userId})));
    if(pageError) throw pageError;
    if(findings.length){
      const {error}=await db.from("crawler_findings").insert(findings.map(f=>({...f,scan_id:input.scanId,user_id:input.userId,scan_type:"crawler"})));
      if(error)throw error;
    }
    await db.from("crawler_scans").update({status:"completed",score,pages_tested:pageRows.length,completed_at:new Date().toISOString(),summary:aiSummary || `${findings.length} findings across ${pageRows.length} pages.`}).eq("id",input.scanId);
  }catch(e){if(input?.scanId)await saveFailure(db,input.scanId,e.message);}
};
