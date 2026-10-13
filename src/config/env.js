/**
 * @file env.js
 * @description Loads and validates environment configurations with sensible fallbacks.
 */

const fs = require('fs');
const path = require('path');

// Helper to parse .env file without external dependencies
function loadDotenv() {
  const envPath = path.resolve(process.cwd(), '.env');
  if (!fs.existsSync(envPath)) return;

  try {
    const content = fs.readFileSync(envPath, 'utf8');
    const lines = content.split(/\r?\n/);
    for (const line of lines) {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith('#')) continue;
      const eqIdx = trimmed.indexOf('=');
      if (eqIdx !== -1) {
        const key = trimmed.slice(0, eqIdx).trim();
        const val = trimmed.slice(eqIdx + 1).trim().replace(/^["']|["']$/g, '');
        if (key && process.env[key] === undefined) {
          process.env[key] = val;
        }
      }
    }
  } catch (err) {
    console.warn('[Config] Notice: Could not read .env file:', err.message);
  }
}

loadDotenv();

const env = {
  PORT: parseInt(process.env.PORT, 10) || 3000,
  HOST: process.env.HOST || '0.0.0.0',
  NODE_ENV: process.env.NODE_ENV || 'development',
  DB_FILE_PATH: process.env.DB_FILE_PATH || path.join(__dirname, '../../data/database.json'),
  SPLIT_MAX_AMOUNT: parseFloat(process.env.SPLIT_MAX_AMOUNT) || 1999,
  COUNTDOWN_TIMER_SECONDS: parseInt(process.env.COUNTDOWN_TIMER_SECONDS, 10) || 120,
  MAX_TERMINAL_SLOTS: parseInt(process.env.MAX_TERMINAL_SLOTS, 10) || 2,
  ADMIN_USERNAME: process.env.ADMIN_USERNAME || 'shubhg9401',
  ADMIN_PASSWORD: process.env.ADMIN_PASSWORD || 'admin123',
  DEMO_MERCHANT_PASSWORD: process.env.DEMO_MERCHANT_PASSWORD || 'demo123',
  isDev: (process.env.NODE_ENV || 'development') === 'development'
};

module.exports = env;
