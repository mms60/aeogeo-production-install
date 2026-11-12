import Stripe from "stripe";
import { json, readBody, userFromEvent, adminClient } from "./avss-shared.mjs";
import stripeLib from "./lib/stripe.js";
import studioPrice from "./lib/studio-price.js";

const liveMode = () => String(process.env.STRIPE_SECRET_KEY || "").startsWith("sk_live");

export default async event => {
  try{
    const user=await userFromEvent(event), {plan}=readBody(event);
    const stripe=new Stripe(process.env.STRIPE_SECRET_KEY);
    const priceMap={
      studio_monthly:process.env.STRIPE_STUDIO_MONTHLY_PRICE_ID,
      starter_monthly:process.env.STRIPE_STARTER_MONTHLY_PRICE_ID,
      starter_yearly:process.env.STRIPE_STARTER_YEARLY_PRICE_ID,
      pro_monthly:process.env.STRIPE_PRO_MONTHLY_PRICE_ID,
      pro_yearly:process.env.STRIPE_PRO_YEARLY_PRICE_ID,
      agency_monthly:process.env.STRIPE_AGENCY_MONTHLY_PRICE_ID,
      agency_yearly:process.env.STRIPE_AGENCY_YEARLY_PRICE_ID
    };
    const price=plan==="studio_monthly"?await studioPrice.resolveStudioPriceId({stripe: stripeLib.stripe, live: liveMode}):priceMap[plan];
    if(!price) return json(400,{error:"That subscription price is not configured."});
    const db=adminClient();
    const {data:profile}=await db.from("profiles").select("stripe_customer_id").eq("id",user.id).maybeSingle();
    const session=await stripe.checkout.sessions.create({
      mode:"subscription",line_items:[{price,quantity:1}],
      customer:profile?.stripe_customer_id||undefined,
      customer_email:profile?.stripe_customer_id?undefined:user.email,
      client_reference_id:user.id,metadata:{supabase_user_id:user.id},
      subscription_data:{metadata:{supabase_user_id:user.id}},
      success_url:`${process.env.SITE_URL}/ai-visibility-schema-studio/app/?checkout=success`,
      cancel_url:`${process.env.SITE_URL}/ai-visibility-schema-studio/app/?checkout=cancelled`
    });
    return json(200,{url:session.url});
  }catch(e){return json(e.status||400,{error:e.message});}
};
