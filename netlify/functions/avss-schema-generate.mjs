import * as cheerio from "cheerio";
import { json, readBody, userFromEvent, requirePaid, adminClient, assertPublicHttpUrl, safeFetch } from "./avss-shared.mjs";
const allowedTypes=new Set(["Organization","LocalBusiness","Service","Article","Product","WebPage","FAQPage"]);
function validateSchema(obj,type){
  const issues=[];
  if(!obj||typeof obj!=="object"||Array.isArray(obj))issues.push("Output must be a JSON object.");
  if(obj?.["@context"]!=="https://schema.org")issues.push("Missing or incorrect @context.");
  if(obj?.["@type"]!==type)issues.push("The generated @type does not match the requested type.");
  if(!obj?.name&&!["WebPage","FAQPage"].includes(type))issues.push("A name field is recommended/required for this schema type.");
  if(obj?.url&&!/^https?:\/\//i.test(obj.url))issues.push("The url field should be an absolute HTTP(S) URL.");
  return issues;
}
export default async event=>{
  try{
    const user=await userFromEvent(event);await requirePaid(user);
    const {url,type,details,auditExisting=true}=readBody(event);
    if(!allowedTypes.has(type))return json(400,{error:"Unsupported schema type."});
    if(typeof details!=="string"||details.trim().length<10||details.length>12000)return json(400,{error:"Provide at least 10 characters of verified details (maximum 12,000)."});
    const target=await assertPublicHttpUrl(url);
    let audit={summary:"Existing schema audit was skipped.",jsonLdCount:0,types:[]};
    if(auditExisting){
      const response=await safeFetch(target.href,{timeout:12000}),html=(await response.text()).slice(0,2_000_000),$=cheerio.load(html);
      const blocks=[];$('script[type="application/ld+json"]').each((_,el)=>{try{blocks.push(JSON.parse($(el).contents().text()));}catch{blocks.push({invalidJson:true});}});
      const types=new Set();const walk=x=>{if(!x||typeof x!=="object")return;if(x["@type"])for(const t of (Array.isArray(x["@type"])?x["@type"]:[x["@type"]]))types.add(t);if(Array.isArray(x))x.forEach(walk);else Object.values(x).forEach(walk);};blocks.forEach(walk);
      audit={summary:`Fetched page returned HTTP ${response.status}. Found ${blocks.length} JSON-LD script block(s). Types are detected from parseable JSON-LD. This is a lightweight syntax/type audit, not Google's rich-result eligibility test.`,jsonLdCount:blocks.length,types:[...types]};
    }
    const prompt=`Create one accurate Schema.org JSON-LD object of type ${type} for this page: ${target.href}.
Use ONLY facts explicitly present in the supplied details. Do not invent names, addresses, phone numbers, prices, ratings, reviews, opening hours, social profiles, authors, images, or FAQ answers. Omit unknown properties. Use absolute URLs only when supplied or directly established by the page URL. Return JSON only, no markdown.
Verified details:
${details}`;
    if(!process.env.GROQ_API_KEY)throw new Error("GROQ_API_KEY is not configured on the server.");
    const response=await fetch("https://api.groq.com/openai/v1/chat/completions",{method:"POST",headers:{"Authorization":`Bearer ${process.env.GROQ_API_KEY}`,"Content-Type":"application/json"},body:JSON.stringify({model:process.env.GROQ_MODEL||"llama-3.3-70b-versatile",temperature:0.1,messages:[{role:"system",content:"You produce conservative Schema.org JSON-LD. Never invent facts. Output a single valid JSON object only."},{role:"user",content:prompt}]})});
    const result=await response.json();if(!response.ok)throw new Error(result.error?.message||"Groq request failed.");
    let content=result.choices?.[0]?.message?.content||"";content=content.replace(/^```(?:json)?\s*/i,"").replace(/\s*```$/,"").trim();
    const jsonLd=JSON.parse(content),validation=validateSchema(jsonLd,type);
    const db=adminClient();
    const {error}=await db.from("schema_generations").insert({user_id:user.id,page_url:target.href,schema_type:type,generated_jsonld:jsonLd,existing_audit:audit,validation_issues:validation});
    if(error)throw error;
    return json(200,{schemaType:type,jsonLd,audit,validation});
  }catch(e){return json(400,{error:e.message});}
};
