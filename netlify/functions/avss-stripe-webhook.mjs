import Stripe from "stripe";
import { json, adminClient } from "./avss-shared.mjs";
export const config = { path: "/.netlify/functions/avss-stripe-webhook" };

async function emailForCustomer(stripe, customerId) {
  if (!customerId) return null;
  try {
    const customer = await stripe.customers.retrieve(String(customerId));
    if (customer && !customer.deleted && customer.email) return customer.email;
  } catch {
    return null;
  }
}

// Subscriptions bought from the public payment link carry no Supabase user id,
// because the buyer has no account yet. Keep the payment against the buyer's
// email so the first sign-in with that email can attach it.
async function rememberWithoutAccount(db, { email, customerId, subscriptionId, status, priceId, periodEnd }) {
  if (!email || !subscriptionId) return;
  await db.from("avss_pending_subscriptions").upsert({
    email: String(email).trim().toLowerCase(),
    stripe_customer_id: customerId ? String(customerId) : null,
    stripe_subscription_id: String(subscriptionId),
    status: status || "incomplete",
    price_id: priceId || null,
    current_period_end: periodEnd || null,
    updated_at: new Date().toISOString()
  }, { onConflict: "stripe_subscription_id" });
}

export default async event => {
  try {
    const stripe = new Stripe(process.env.STRIPE_SECRET_KEY);
    const signature = event.headers["stripe-signature"];
    const raw = event.isBase64Encoded ? Buffer.from(event.body, "base64") : Buffer.from(event.body || "");
    const stripeEvent = stripe.webhooks.constructEvent(raw, signature, process.env.STRIPE_AVSS_WEBHOOK_SECRET);
    const db = adminClient();

    if (["customer.subscription.created", "customer.subscription.updated", "customer.subscription.deleted"].includes(stripeEvent.type)) {
      const sub = stripeEvent.data.object;
      const userId = sub.metadata?.supabase_user_id;
      const priceId = sub.items?.data?.[0]?.price?.id || null;
      const periodEnd = sub.current_period_end ? new Date(sub.current_period_end * 1000).toISOString() : null;
      if (userId) {
        await db.from("subscriptions").upsert({
          user_id: userId, stripe_customer_id: String(sub.customer), stripe_subscription_id: sub.id,
          status: sub.status, price_id: priceId, current_period_end: periodEnd,
          updated_at: new Date().toISOString()
        }, { onConflict: "stripe_subscription_id" });
        await db.from("profiles").upsert({ id: userId, stripe_customer_id: String(sub.customer) }, { onConflict: "id" });
      } else {
        const email = await emailForCustomer(stripe, sub.customer);
        await rememberWithoutAccount(db, {
          email, customerId: sub.customer, subscriptionId: sub.id,
          status: sub.status, priceId, periodEnd
        });
      }
    }

    if (stripeEvent.type === "checkout.session.completed") {
      const s = stripeEvent.data.object;
      const userId = s.metadata?.supabase_user_id || s.client_reference_id;
      const email = s.customer_details?.email || s.customer_email || null;
      if (userId && s.customer) await db.from("profiles").upsert({ id: userId, stripe_customer_id: String(s.customer) }, { onConflict: "id" });
      if (!userId && s.subscription) {
        let sub = null;
        try { sub = await stripe.subscriptions.retrieve(String(s.subscription)); } catch { sub = null; }
        await rememberWithoutAccount(db, {
          email,
          customerId: s.customer,
          subscriptionId: s.subscription,
          status: sub?.status,
          priceId: sub?.items?.data?.[0]?.price?.id || null,
          periodEnd: sub?.current_period_end ? new Date(sub.current_period_end * 1000).toISOString() : null
        });
      }
    }

    return json(200, { received: true });
  } catch (e) { return json(400, { error: `Webhook error: ${e.message}` }); }
};
