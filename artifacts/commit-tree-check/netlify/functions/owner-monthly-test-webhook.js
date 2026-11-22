'use strict';
// Only accepts separately signed Stripe TEST events. Never uses the LIVE signing secret.
exports.handler=event=>require('./lib/owner-monthly-test').configured().webhook(event);
