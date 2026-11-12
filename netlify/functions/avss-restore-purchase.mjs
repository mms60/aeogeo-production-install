import { json, readBody, userFromEvent, adminClient } from "./avss-shared.mjs";

const HOUR = 60 * 60 * 1000;
const MAX_ATTEMPTS = 3;
const CLAIM_WINDOW_DAYS = 30;

// Someone paid at Stripe with one address and signs in with another. If the
// payment is still unclaimed, the signed-in account may take it over, but only
// with a confirmed account email, three attempts an hour, an audit trail and a
// thirty day window.
export default async event => {
  let user;
  try {
    user = await userFromEvent(event);
  } catch (e) {
    return json(400, { error: e.message });
  }

  const db = adminClient();
  let email = null;
  const log = async outcome => {
    try {
      await db.from("avss_restore_attempts").insert({
        user_id: user.id,
        email: email || null,
        ip: event.headers?.["x-nf-client-connection-ip"] || event.headers?.["x-forwarded-for"] || null,
        outcome
      });
    } catch {}
  };

  try {
    const { email: rawEmail } = readBody(event);
    email = String(rawEmail || "").trim().toLowerCase();

    if (!user.email_confirmed_at) {
      return json(403, { error: "Confirm your email address before restoring a purchase. Open the confirmation link we emailed you, then try again." });
    }
    if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) return json(400, { error: "Enter a valid email address." });

    const since = new Date(Date.now() - HOUR).toISOString();
    const { data: recent, error: countError } = await db.from("avss_restore_attempts")
      .select("id").eq("user_id", user.id).gte("created_at", since).neq("outcome", "rate_limited");
    if (countError) return json(500, { error: "The restore service is unavailable. Please try again in a moment." });
    if ((recent?.length || 0) >= MAX_ATTEMPTS) {
      await log("rate_limited");
      return json(429, { error: "Too many restore attempts. Wait an hour, or contact us and we will attach the subscription for you." });
    }

    const { data: already } = await db.from("subscriptions").select("status").eq("user_id", user.id).in("status", ["active", "trialing"]).maybeSingle();
    if (already) {
      await log("already_active");
      return json(200, { active: true });
    }

    const { data: rows, error } = await db.from("avss_pending_subscriptions")
      .select("id,stripe_customer_id,stripe_subscription_id,status,price_id,current_period_end,created_at")
      .ilike("email", email).in("status", ["active", "trialing"])
      .order("current_period_end", { ascending: false, nullsFirst: false }).limit(1);
    if (error) {
      await log("lookup_failed");
      return json(500, { error: "The subscription lookup failed. Please try again in a moment." });
    }
    const row = rows?.[0];
    if (!row) {
      await log("not_found");
      return json(404, { error: "We found no paid subscription for that email address. Check the address you used at Stripe, or subscribe above." });
    }

    const age = Date.now() - new Date(row.created_at || 0).getTime();
    if (!row.created_at || age > CLAIM_WINDOW_DAYS * 24 * HOUR) {
      await log("too_old");
      return json(403, { error: "That payment is more than 30 days old, so it needs a manual check. Contact us with the email and the date you paid and we will attach it." });
    }

    const { data: taken } = await db.from("subscriptions").select("user_id").eq("stripe_subscription_id", row.stripe_subscription_id).maybeSingle();
    if (taken?.user_id && taken.user_id !== user.id) {
      await log("taken");
      return json(409, { error: "That subscription is already attached to another account. Contact us if that is not right." });
    }

    const { error: writeError } = await db.from("subscriptions").upsert({
      user_id: user.id,
      stripe_customer_id: row.stripe_customer_id,
      stripe_subscription_id: row.stripe_subscription_id,
      status: row.status,
      price_id: row.price_id,
      current_period_end: row.current_period_end,
      updated_at: new Date().toISOString()
    }, { onConflict: "stripe_subscription_id" });
    if (writeError) {
      await log("attach_failed");
      return json(500, { error: "The subscription could not be attached to this account. Please try again." });
    }

    if (row.stripe_customer_id) await db.from("profiles").upsert({ id: user.id, stripe_customer_id: row.stripe_customer_id }, { onConflict: "id" });
    await db.from("avss_pending_subscriptions").delete().eq("id", row.id);
    await log("attached");
    return json(200, { active: true });
  } catch (e) {
    return json(400, { error: e.message });
  }
};
