/**
 * @file requestLogger.js
 * @description HTTP request logging middleware.
 */

const logger = require('../utils/logger');

function requestLogger(req, res, next) {
  const start = Date.now();
  res.on('finish', () => {
    const duration = Date.now() - start;
    if (req.originalUrl.startsWith('/api') && !req.originalUrl.includes('/poll/')) {
      logger.debug(`${req.method} ${req.originalUrl} - ${res.statusCode} (${duration}ms)`);
    }
  });
  next();
}

module.exports = requestLogger;
