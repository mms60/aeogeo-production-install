'use strict';
const {SERVICES}=require('./lib/monthly-service-catalog');
exports.handler=async event=>{
 let service=event.queryStringParameters?.service;
 if(event.httpMethod==='POST'){try{service=JSON.parse(event.body||'{}').service;}catch{}}
 return Object.hasOwn(SERVICES,service||'')
  ?require('./lib/monthly-service-billing').configuredMonthlyServiceBilling().handler(event)
  :require('./lib/service-checkout').configuredServiceCheckout().handler(event);
};
