'use strict';
// Separate endpoint: never calls Supabase authentication or audit entitlements.
const {configuredGuestServiceCheckout}=require('./lib/guest-service-checkout');
exports.handler=event=>configuredGuestServiceCheckout().handler(event);
