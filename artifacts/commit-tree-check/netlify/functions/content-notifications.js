'use strict';
// Only fixed owner notices. Uses the already configured Netlify contact-form channel, never a new paid provider.
const {configuredContentService}=require('./lib/content-service');
exports.handler=async()=>{if(process.env.CONTENT_SERVICE_ENABLED!=='true')return{statusCode:200,body:'Content notices inactive.'};try{await configuredContentService().flush();return{statusCode:200,body:'Owner notice queue checked.'};}catch{return{statusCode:503,body:'Owner notices will retry; no payment or fulfillment state changed.'};}};
