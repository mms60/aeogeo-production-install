'use strict';
// Separate owner-only TEST endpoint. Public pricing/production checkout stay unchanged.
exports.handler=event=>require('./lib/owner-monthly-test').configured().handler(event);
