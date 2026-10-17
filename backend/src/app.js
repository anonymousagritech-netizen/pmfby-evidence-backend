const express = require('express');
const cors = require('cors');
const pinoHttp = require('pino-http');
const logger = require('./lib/logger');

const authRoutes = require('./routes/auth');
const userRoutes = require('./routes/users');
const importRoutes = require('./routes/importRoutes');
const farmerRoutes = require('./routes/farmers');
const caseRoutes = require('./routes/cases');
const assignmentRoutes = require('./routes/assignments');
const callEventRoutes = require('./routes/callEvents');
const callRecordingRoutes = require('./routes/callRecordings');
const templateRoutes = require('./routes/templates');
const messageEventRoutes = require('./routes/messageEvents');
const evidenceRoutes = require('./routes/evidence');
const emergencyIncidentRoutes = require('./routes/emergencyIncidents');
const zipArchiveRoutes = require('./routes/zipArchives');
const auditLogRoutes = require('./routes/auditLogs');
const integrityConcernRoutes = require('./routes/integrityConcerns');
const reportRoutes = require('./routes/reports');
const autoAssignRoutes = require('./routes/autoAssign');
const villageDataRoutes = require('./routes/villageData');
const boundaryRoutes = require('./routes/boundaries');

function createApp() {
  const app = express();
  app.use(cors());
  app.use(express.json({ limit: '2mb' }));
  app.use(pinoHttp({ logger, autoLogging: process.env.NODE_ENV !== 'test' }));

  app.get('/health', (req, res) => res.json({ status: 'ok' }));

  app.use('/api/auth', authRoutes);
  app.use('/api/users', userRoutes);
  app.use('/api/import', importRoutes);
  app.use('/api/farmers', farmerRoutes);
  app.use('/api/cases', caseRoutes);
  app.use('/api/assignments', assignmentRoutes);
  app.use('/api/call-events', callEventRoutes);
  app.use('/api/call-recordings', callRecordingRoutes);
  app.use('/api/templates', templateRoutes);
  app.use('/api/message-events', messageEventRoutes);
  app.use('/api/evidence', evidenceRoutes);
  app.use('/api/emergency-incidents', emergencyIncidentRoutes);
  app.use('/api/zip-archives', zipArchiveRoutes);
  app.use('/api/audit-logs', auditLogRoutes);
  app.use('/api/integrity-concerns', integrityConcernRoutes);
  app.use('/api/reports', reportRoutes);
  app.use('/api/auto-assign', autoAssignRoutes);
  app.use('/api/village-data', villageDataRoutes);
  app.use('/api/boundaries', boundaryRoutes);

  app.use((req, res) => res.status(404).json({ error: 'Not found' }));

  // eslint-disable-next-line no-unused-vars
  app.use((err, req, res, next) => {
    logger.error({ err }, 'Unhandled error');
    if (res.headersSent) return;
    res.status(500).json({ error: 'Internal server error' });
  });

  return app;
}

module.exports = { createApp };
