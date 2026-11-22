import Stripe from "stripe";
import { json, userFromEvent, adminClient } from "./avss-shared.mjs";
export default async event => {
  try {
    const user = await userFromEvent(event), db = adminClient(), stripe = new Stripe(process.env.STRIPE_SECRET_KEY);
    const { data: profile } = await db.from("profiles").select("stripe_customer_id").eq("id", user.id).maybeSingle();
    let customer = profile?.stripe_customer_id || null;
    if (!customer) {
      const { data: sub } = await db.from("subscriptions")
        .select("stripe_customer_id").eq("user_id", user.id)
        .not("stripe_customer_id", "is", null)
        .order("updated_at", { ascending: false }).limit(1).maybeSingle();
      customer = sub?.stripe_customer_id || null;
    }
    if (!customer) return json(400, { error: "No Stripe customer is linked to this account yet. Subscribe first, or use Restore access if you already paid." });
    const base = (process.env.SITE_URL || process.env.URL || "https://aeogeosearch.com").replace(/\/$/, "");
    const session = await stripe.billingPortal.sessions.create({
      customer,
      return_url: `${base}/ai-visibility-schema-studio/app/`
    });
    return json(200, { url: session.url });
  } catch (e) { return json(400, { error: e.message }); }
};
