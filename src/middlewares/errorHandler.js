/**
 * @file errorHandler.js
 * @description Centralized Express error handler returning structured JSON responses.
 */

const logger = require('../utils/logger');
const env = require('../config/env');

function errorHandler(err, req, res, next) {
  const statusCode = err.status || err.statusCode || (res.statusCode >= 400 ? res.statusCode : 500);

  if (statusCode >= 500) {
    logger.error(`[Unhandled Error] ${req.method} ${req.originalUrl}:`, err.stack || err.message);
  } else {
    logger.warn(`[Client Error ${statusCode}] ${req.method} ${req.originalUrl}:`, err.message);
  }

  res.status(statusCode).json({
    success: false,
    error: err.message || 'An internal server error occurred',
    status: statusCode,
    terminal3Blocked: !!err.terminal3Blocked,
    ...(env.isDev && { stack: err.stack })
  });
}

module.exports = errorHandler;
