import { json, readBody, userFromEvent, requirePaid, adminClient } from "./avss-shared.mjs";
export default async event=>{
  try{
    const user=await userFromEvent(event);await requirePaid(user.id);const {scanId}=readBody(event),db=adminClient();
    const {data:scan,error}=await db.from("crawler_scans").select("*").eq("id",scanId).eq("user_id",user.id).single();
    if(error)throw new Error("Scan not found.");
    const {data:findings}=await db.from("crawler_findings").select("*").eq("scan_id",scanId).eq("user_id",user.id);
    return json(200,{scan,findings:findings||[]});
  }catch(e){return json(400,{error:e.message});}
};
