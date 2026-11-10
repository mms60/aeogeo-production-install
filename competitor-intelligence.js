'use strict';
const { configuredCompetitorIntelligence } = require('./lib/competitor-intelligence');
exports.handler = event => configuredCompetitorIntelligence().handler(event);
