import Stripe from "stripe";
import { json, adminClient } from "./avss-shared.mjs";
export const config = { path: "/.netlify/functions/avss-stripe-webhook" };
export default async event => {
  try{
    const stripe=new Stripe(process.env.STRIPE_SECRET_KEY);
    const signature=event.headers["stripe-signature"];
    const raw=event.isBase64Encoded?Buffer.from(event.body,"base64"):Buffer.from(event.body||"");
    const stripeEvent=stripe.webhooks.constructEvent(raw,signature,process.env.STRIPE_WEBHOOK_SECRET);
    const db=adminClient();
    if(["customer.subscription.created","customer.subscription.updated","customer.subscription.deleted"].includes(stripeEvent.type)){
      const sub=stripeEvent.data.object, userId=sub.metadata?.supabase_user_id;
      if(userId){
        await db.from("subscriptions").upsert({
          user_id:userId,stripe_customer_id:String(sub.customer),stripe_subscription_id:sub.id,
          status:sub.status,price_id:sub.items?.data?.[0]?.price?.id||null,
          current_period_end:sub.current_period_end?new Date(sub.current_period_end*1000).toISOString():null,
          updated_at:new Date().toISOString()
        },{onConflict:"stripe_subscription_id"});
        await db.from("profiles").upsert({id:userId,stripe_customer_id:String(sub.customer)},{onConflict:"id"});
      }
    }
    if(stripeEvent.type==="checkout.session.completed"){
      const s=stripeEvent.data.object, userId=s.metadata?.supabase_user_id||s.client_reference_id;
      if(userId&&s.customer) await db.from("profiles").upsert({id:userId,stripe_customer_id:String(s.customer)},{onConflict:"id"});
    }
    return json(200,{received:true});
  }catch(e){return json(400,{error:`Webhook error: ${e.message}`});}
};
