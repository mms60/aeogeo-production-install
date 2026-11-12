import Stripe from "stripe";
import { json, readBody, userFromEvent, adminClient } from "./avss-shared.mjs";
export default async event => {
  try{
    const user=await userFromEvent(event), {plan}=readBody(event);
    const priceMap={
      studio_monthly:process.env.STRIPE_STUDIO_MONTHLY_PRICE_ID,
      starter_monthly:process.env.STRIPE_STARTER_MONTHLY_PRICE_ID,
      starter_yearly:process.env.STRIPE_STARTER_YEARLY_PRICE_ID,
      pro_monthly:process.env.STRIPE_PRO_MONTHLY_PRICE_ID,
      pro_yearly:process.env.STRIPE_PRO_YEARLY_PRICE_ID,
      agency_monthly:process.env.STRIPE_AGENCY_MONTHLY_PRICE_ID,
      agency_yearly:process.env.STRIPE_AGENCY_YEARLY_PRICE_ID
    };
    const price=priceMap[plan]; if(!price) return json(400,{error:"That subscription price is not configured."});
    const stripe=new Stripe(process.env.STRIPE_SECRET_KEY);
    const db=adminClient();
    const {data:profile}=await db.from("profiles").select("stripe_customer_id").eq("id",user.id).maybeSingle();
    const session=await stripe.checkout.sessions.create({
      mode:"subscription",line_items:[{price,quantity:1}],
      customer:profile?.stripe_customer_id||undefined,
      customer_email:profile?.stripe_customer_id?undefined:user.email,
      client_reference_id:user.id,metadata:{supabase_user_id:user.id},
      subscription_data:{metadata:{supabase_user_id:user.id}},
      success_url:`${process.env.SITE_URL}/ai-visibility-schema-studio/?checkout=success`,
      cancel_url:`${process.env.SITE_URL}/ai-visibility-schema-studio/?checkout=cancelled`
    });
    return json(200,{url:session.url});
  }catch(e){return json(400,{error:e.message});}
};
