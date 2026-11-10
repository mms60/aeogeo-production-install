'use strict';
const {db, user, reply} = require('./lib/db');
const {stripe, origin} = require('./lib/stripe');
const {requireStripeCredential}=require('./lib/stripe-credential');
const {stripeID} = require('./lib/billing-objects');
const {testBillingAllowed} = require('./lib/plans');
const {validatePortalConfiguration} = require('./lib/portal-policy');
exports.handler = async event => {
 if (event.httpMethod !== 'POST') return reply(405, {error: 'POST required'});
 try {
  const u = await user(event), {mode} = requireStripeCredential();
  if (mode === 'test' && !testBillingAllowed(u.email)) return reply(403, {error: 'Test billing is restricted to the configured website test account.'});
  const [s] = await db('geo_subscriptions?user_id=eq.' + u.id + '&select=customer_id');
  if (!s?.customer_id) return reply(400, {error: 'No billing customer is connected to this account.'});
  let config;
  if (process.env.STRIPE_PORTAL_CONFIGURATION_ID) config = await stripe('billing_portal/configurations/' + encodeURIComponent(process.env.STRIPE_PORTAL_CONFIGURATION_ID));
  else {
   const list = await stripe('billing_portal/configurations?is_default=true&active=true&limit=10');
   config = list.data?.find(c => c.is_default && c.active);
  }
  const configuration = validatePortalConfiguration(config, mode === 'live');
  const p = await stripe('billing_portal/sessions', {method: 'POST', data: {customer: s.customer_id, configuration, return_url: origin() + '/account/'}});
  const url = new URL(p.url);
  if (stripeID(p.customer) !== s.customer_id || url.protocol !== 'https:' || url.hostname !== 'billing.stripe.com' || url.username || url.password)
   throw Error('Portal ownership or destination could not be verified.');
  return reply(200, {url: url.href});
 } catch (e) {return reply(e.status || 500, {error: e.status ? e.message : 'Billing management could not open.'});}
};
