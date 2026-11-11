import Stripe from "stripe";
import { json, userFromEvent, adminClient } from "./avss-shared.mjs";
export default async event=>{
  try{
    const user=await userFromEvent(event), db=adminClient(), stripe=new Stripe(process.env.STRIPE_SECRET_KEY);
    const {data}=await db.from("profiles").select("stripe_customer_id").eq("id",user.id).maybeSingle();
    if(!data?.stripe_customer_id) return json(400,{error:"No Stripe customer is linked to this account yet."});
    const s=await stripe.billingPortal.sessions.create({customer:data.stripe_customer_id,return_url:process.env.SITE_URL});
    return json(200,{url:s.url});
  }catch(e){return json(400,{error:e.message});}
};
