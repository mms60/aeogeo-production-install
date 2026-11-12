'use strict';
// Links AI Visibility Schema Studio subscriptions to app accounts.
// Purchases made from the public payment link carry no app user id, so the
// payment is held against the buyer's email until that email signs in.
const {stripe} = require('./stripe');
const {db} = require('./db');

const studioPrice = () => (process.env.STRIPE_STUDIO_MONTHLY_PRICE_ID || 'price_1Uah2rBIJX5f6WmhZs6Uq5iG').trim();
const priceOf = sub => sub?.items?.data?.[0]?.price?.id || null;
const iso = seconds => (seconds ? new Date(seconds * 1000).toISOString() : null);
const upsert = (path, body, conflict) => db(`${path}?on_conflict=${conflict}`, {
  method: 'POST',
  headers: {Prefer: 'resolution=merge-duplicates,return=minimal'},
  body
});

async function retrieveSubscription(id) {
  try { return await stripe('subscriptions/' + encodeURIComponent(id)); } catch { return null; }
}

async function emailForCustomer(customerId) {
  if (!customerId) return null;
  try {
    const customer = await stripe('customers/' + encodeURIComponent(String(customerId)));
    return customer && !customer.deleted ? (customer.email || null) : null;
  } catch { return null; }
}

async function record(sub) {
  const priceId = priceOf(sub);
  if (!priceId || priceId !== studioPrice()) return false;
  const userId = sub.metadata?.supabase_user_id || null;
  const periodEnd = iso(sub.current_period_end);
  if (userId) {
    await upsert('subscriptions', {
      user_id: userId,
      stripe_customer_id: String(sub.customer),
      stripe_subscription_id: sub.id,
      status: sub.status,
      price_id: priceId,
      current_period_end: periodEnd,
      updated_at: new Date().toISOString()
    }, 'stripe_subscription_id');
    await upsert('profiles', {id: userId, stripe_customer_id: String(sub.customer)}, 'id');
    return true;
  }
  const email = await emailForCustomer(sub.customer);
  if (!email) return true;
  await upsert('avss_pending_subscriptions', {
    email: email.trim().toLowerCase(),
    stripe_customer_id: String(sub.customer),
    stripe_subscription_id: sub.id,
    status: sub.status,
    price_id: priceId,
    current_period_end: periodEnd,
    updated_at: new Date().toISOString()
  }, 'stripe_subscription_id');
  return true;
}

async function handleStudioWebhook(event) {
  try {
    const type = event?.type;
    if (type === 'checkout.session.completed') {
      const session = event.data?.object || {};
      if (session.mode !== 'subscription' || !session.subscription) return false;
      const sub = await retrieveSubscription(session.subscription);
      if (!sub || priceOf(sub) !== studioPrice()) return false;
      const userId = sub.metadata?.supabase_user_id || session.metadata?.supabase_user_id || session.client_reference_id;
      if (userId && !sub.metadata?.supabase_user_id) sub.metadata = {...(sub.metadata || {}), supabase_user_id: userId};
      return await record(sub);
    }
    if (type === 'customer.subscription.updated' || type === 'customer.subscription.deleted') {
      const sub = event.data?.object || {};
      if (priceOf(sub) !== studioPrice()) return false;
      return await record(sub);
    }
  } catch (err) {
    console.error('Studio subscription link failed', event?.id || '', err?.code || 'internal');
  }
  return false;
}

module.exports = {handleStudioWebhook};
