import { json, readBody, userFromEvent, requirePaid, adminClient, assertPublicHttpUrl } from "./avss-shared.mjs";
export default async event=>{
  try{
    const user=await userFromEvent(event); await requirePaid(user.id);
    const body=readBody(event), target=await assertPublicHttpUrl(body.url);
    const maxPages=Math.min(Math.max(Number(body.maxPages)||10,1),Number(process.env.MAX_PAGES_PER_SCAN)||20);
    const db=adminClient();
    const {data:scan,error}=await db.from("crawler_scans").insert({
      user_id:user.id,target_url:target.href,status:"queued",max_pages:maxPages,scan_type:"crawler"
    }).select("id").single();
    if(error) throw error;
    const backgroundUrl=`${process.env.URL}/.netlify/functions/avss-scan-background`;
    const response=await fetch(backgroundUrl,{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({scanId:scan.id,userId:user.id,url:target.href,maxPages})});
    if(!response.ok) throw new Error("Could not queue the scan. Check the Netlify background function deployment.");
    return json(202,{scanId:scan.id,status:"queued"});
  }catch(e){return json(400,{error:e.message});}
};
