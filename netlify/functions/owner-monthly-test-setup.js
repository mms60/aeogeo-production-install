'use strict';
// Owner authenticated, TEST-only fixture setup. Does not purchase or deploy anything.
exports.handler=event=>require('./lib/owner-monthly-test-setup').configuredSetup()(event);
