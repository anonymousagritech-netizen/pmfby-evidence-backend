const { createApp } = require('./app');
const env = require('./config/env');
const logger = require('./lib/logger');

const app = createApp();
app.listen(env.port, () => {
  logger.info(`pmfby-evidence backend listening on port ${env.port}`);
});
