const pino = require('pino');
const env = require('../config/env');

const logger = pino({ level: env.logLevel });

module.exports = logger;
