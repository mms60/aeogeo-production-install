'use strict';
const {db,user,reply} = require('./lib/db');
const {stripe} = require('./lib/stripe');
const {billingAdmin,billingMode} = require('./lib/plans');
const {configuredBillingSync} = require('./lib/billing-sync');
const {billingReviewHandler} = require('./lib/billing-review-handler');
exports.handler = billingReviewHandler({db,user,reply,stripe,billingAdmin,billingMode,invoiceForCharge:configuredBillingSync().invoiceForCharge});
