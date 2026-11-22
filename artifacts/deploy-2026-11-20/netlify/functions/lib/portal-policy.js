'use strict';
function validatePortalConfiguration(config, live) {
 const reject = message => {throw Object.assign(new Error(message), {status: 503});};
 if (!config?.active || config.livemode !== live) reject('The billing portal configuration is missing or uses the wrong payment mode.');
 const f = config.features;
 if (f?.subscription_cancel?.enabled !== true || f.subscription_cancel.mode !== 'at_period_end' || f.subscription_cancel.proration_behavior !== 'none')
  reject('The billing portal must allow cancellation at the end of the paid period without automatic prorations.');
 if (f?.subscription_update?.enabled !== false)
  reject('Portal plan and quantity changes are disabled until upgrade and proration handling is approved.');
 if (f?.invoice_history?.enabled !== true || f?.payment_method_update?.enabled !== true)
  reject('The billing portal must allow invoice viewing and payment-method updates.');
 return config.id;
}
module.exports = {validatePortalConfiguration};
