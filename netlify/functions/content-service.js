'use strict';
const {configuredContentService}=require('./lib/content-service');
exports.handler=event=>configuredContentService().handler(event);
