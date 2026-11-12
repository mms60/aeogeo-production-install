import { json, readBody, userFromEvent, adminClient } from "./avss-shared.mjs";

// Someone paid at Stripe with one address and signs in with another. If the
// payment is still unclaimed, let the signed-in account take it over.
export default async event => {
  try {
    const user = await userFromEvent(event);
    const { email } = readBody(event);
    const wanted = String(email || "").trim().toLowerCase();
    if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(wanted)) return json(400, { error: "Enter a valid email address." });

    const db = adminClient();
    const { data: already } = await db.from("subscriptions").select("status").eq("user_id", user.id).in("status", ["active", "trialing"]).maybeSingle();
    if (already) return json(200, { active: true });

    const { data: rows, error } = await db.from("avss_pending_subscriptions")
      .select("id,stripe_customer_id,stripe_subscription_id,status,price_id,current_period_end")
      .ilike("email", wanted).in("status", ["active", "trialing"])
      .order("current_period_end", { ascending: false, nullsFirst: false }).limit(1);
    if (error) return json(500, { error: "The subscription lookup failed. Please try again in a moment." });
    const row = rows?.[0];
    if (!row) return json(404, { error: "We found no paid subscription for that email address. Check the address you used at Stripe, or subscribe above." });

    const { data: taken } = await db.from("subscriptions").select("user_id").eq("stripe_subscription_id", row.stripe_subscription_id).maybeSingle();
    if (taken?.user_id && taken.user_id !== user.id) return json(409, { error: "That subscription is already attached to another account. Contact us if that is not right." });

    const { error: writeError } = await db.from("subscriptions").upsert({
      user_id: user.id,
      stripe_customer_id: row.stripe_customer_id,
      stripe_subscription_id: row.stripe_subscription_id,
      status: row.status,
      price_id: row.price_id,
      current_period_end: row.current_period_end,
      updated_at: new Date().toISOString()
    }, { onConflict: "stripe_subscription_id" });
    if (writeError) return json(500, { error: "The subscription could not be attached to this account. Please try again." });

    if (row.stripe_customer_id) await db.from("profiles").upsert({ id: user.id, stripe_customer_id: row.stripe_customer_id }, { onConflict: "id" });
    await db.from("avss_pending_subscriptions").delete().eq("id", row.id);
    return json(200, { active: true });
  } catch (e) {
    return json(400, { error: e.message });
  }
};
