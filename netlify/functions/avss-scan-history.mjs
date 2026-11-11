import { json, userFromEvent, requirePaid, adminClient } from "./avss-shared.mjs";
export default async event=>{
  try{
    const user=await userFromEvent(event);await requirePaid(user.id);const db=adminClient();
    const {data,error}=await db.from("crawler_scans").select("id,scan_type,target_url,status,score,pages_tested,created_at").eq("user_id",user.id).order("created_at",{ascending:false}).limit(30);
    if(error)throw error;return json(200,{scans:data||[]});
  }catch(e){return json(400,{error:e.message});}
};
