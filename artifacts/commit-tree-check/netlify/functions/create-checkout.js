'use strict';
const {checkoutHandler} = require('./lib/checkout');
const {requireReady}=require('./lib/audit-checkout-readiness');
const {db, user, reply, UUID} = require('./lib/db');
const {PLANS, priceID, billingReady} = require('./lib/plans');
const {stripe, origin} = require('./lib/stripe');
exports.handler = checkoutHandler({db, user:async event=>{const verified=await user(event);await requireReady();return verified;}, reply, UUID, PLANS, priceID, billingReady, stripe, origin});
