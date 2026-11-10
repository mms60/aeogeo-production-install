'use strict';
const {configuredReadiness}=require('./lib/audit-checkout-readiness');
const {reply}=require('./lib/db');
exports.handler=async event=>event.httpMethod==='GET'?reply(200,await configuredReadiness().check()):reply(405,{error:'GET required.'});
