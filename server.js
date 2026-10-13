/**
 * @file server.js
 * @description Main application entry point for Localhost UPI Merchant Platform.
 */

const fs = require('fs');
const http = require('http');
const path = require('path');
const express = require('express');
const cors = require('cors');

const env = require('./src/config/env');
const logger = require('./src/utils/logger');
const requestLogger = require('./src/middlewares/requestLogger');
const errorHandler = require('./src/middlewares/errorHandler');
const apiRouter = require('./src/routes/api');
const socketManager = require('./src/websocket/socketManager');
const networkService = require('./src/services/networkService');

const app = express();
const server = http.createServer(app);

// If running in Vercel Serverless environment, serve the localhost notice page
if (process.env.VERCEL) {
  const noticePath = path.join(__dirname, 'localhost-notice.html');
  let noticeHtml = '<!DOCTYPE html><html><body><h1>Localhost Required</h1><p>Please run this application locally on localhost:3000</p></body></html>';
  try {
    if (fs.existsSync(noticePath)) {
      noticeHtml = fs.readFileSync(noticePath, 'utf8');
    }
  } catch (err) {
    // fallback
  }

  app.all('*', (req, res) => {
    res.status(200).setHeader('Content-Type', 'text/html; charset=utf-8').send(noticeHtml);
  });
}

// Initialize WebSocket Subsystem (Persistent local environment only)
if (!process.env.VERCEL) {
  socketManager.init(server);
}

// Global Middlewares
app.use(cors());
app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(requestLogger);

// Static Assets Hosting (Single authoritative directory)
const publicDir = path.join(__dirname, 'public');
app.use(express.static(publicDir));

// Clean URL Route Aliases
app.get('/', (req, res) => res.sendFile(path.join(publicDir, 'index.html')));
app.get('/merchant', (req, res) => res.sendFile(path.join(publicDir, 'merchant.html')));
app.get('/user', (req, res) => res.sendFile(path.join(publicDir, 'user.html')));
app.get('/admin', (req, res) => res.sendFile(path.join(publicDir, 'admin.html')));

// API Subsystem
app.use('/api', apiRouter);

// Catch-all 404 for unhandled API endpoints
app.use('/api/*', (req, res) => {
  res.status(404).json({ success: false, error: `Endpoint not found: ${req.method} ${req.originalUrl}` });
});

// Centralized Error Handling Middleware
app.use(errorHandler);

// Start HTTP Server (Persistent local environment only)
if (!process.env.VERCEL) {
  server.listen(env.PORT, env.HOST, () => {
    const netInfo = networkService.getLocalIpInfo(env.PORT);

    logger.info('===========================================================');
    logger.info('  UPI MULTI-PORTAL MERCHANT SYSTEM (LOCALHOST ONLY)        ');
    logger.info('===========================================================');
    logger.info(`  Environment : ${env.NODE_ENV}`);
    logger.info(`  Localhost   : http://localhost:${env.PORT}`);
    logger.info(`  Phone/LAN   : ${netInfo.lanUrl}`);
    logger.info('-----------------------------------------------------------');
    logger.info(`  Merchant Hub: http://localhost:${env.PORT}/merchant`);
    logger.info(`  Customer App: http://localhost:${env.PORT}/user`);
    logger.info(`  Admin Panel : http://localhost:${env.PORT}/admin`);
    logger.info('===========================================================');
  });

  // Graceful Shutdown
  function handleShutdown(signal) {
    logger.info(`Received ${signal}. Shutting down server gracefully...`);
    server.close(() => {
      logger.info('HTTP & WebSocket server terminated.');
      process.exit(0);
    });
  }

  process.on('SIGTERM', () => handleShutdown('SIGTERM'));
  process.on('SIGINT', () => handleShutdown('SIGINT'));
}

app.server = server;
module.exports = app;
