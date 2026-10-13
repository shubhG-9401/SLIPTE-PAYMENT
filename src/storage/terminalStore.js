/**
 * @file terminalStore.js
 * @description Manages connected user terminal heartbeats, slot allocation, and Terminal 3 blocking.
 */

const { readDb, writeDb } = require('./jsonDb');
const constants = require('../config/constants');
const env = require('../config/env');

const TerminalStore = {
  /**
   * Registers a heartbeat or connection for a user terminal.
   * Enforces max 2 terminals per merchant; blocks Terminal 3.
   * @param {string} code 6-digit merchant code
   * @param {string} sessionId
   * @returns {Object} Terminal status object
   */
  registerHeartbeat(code, sessionId) {
    const db = readDb();
    const cleanCode = (code || '').trim().toUpperCase();
    const cleanSession = (sessionId || 'sess_default').trim();
    const now = Date.now();

    // Remove heartbeats older than 60 seconds
    db.terminals = db.terminals.filter(t => (now - (t.lastSeen || 0)) < 60000);

    const activeForCode = db.terminals.filter(t => t.code === cleanCode);
    let existing = activeForCode.find(t => t.sessionId === cleanSession);

    if (existing) {
      existing.lastSeen = now;
      writeDb(db);
      return existing;
    }

    // If already 2 distinct sessions are connected, block any 3rd session!
    if (activeForCode.length >= env.MAX_TERMINAL_SLOTS) {
      return {
        code: cleanCode,
        sessionId: cleanSession,
        slotNumber: 3,
        slot: 3,
        blocked: true,
        terminal3Blocked: true,
        error: 'Access Blocked: Maximum 2 terminals (Terminal 1 & Terminal 2) allowed. Terminal 3 is blocked.',
        message: constants.SLOT_CONFIG.BLOCK_MESSAGE
      };
    }

    // Determine slot number (1 or 2)
    const usedSlots = new Set(activeForCode.map(t => t.slotNumber));
    const assignedSlot = !usedSlots.has(1) ? 1 : 2;

    const newTerminal = {
      code: cleanCode,
      sessionId: cleanSession,
      slotNumber: assignedSlot,
      slot: assignedSlot,
      blocked: false,
      connectedAt: now,
      lastSeen: now
    };

    db.terminals.push(newTerminal);
    writeDb(db);
    return newTerminal;
  },

  /**
   * Gets slot occupancy information for a merchant.
   * @param {Object} merchant
   * @returns {Object} Slot status with indicators
   */
  getSlotStatus(merchant) {
    const db = readDb();
    const now = Date.now();
    db.terminals = db.terminals.filter(t => (now - (t.lastSeen || 0)) < 60000);

    const code = (merchant.merchant_code || (merchant.user_codes && merchant.user_codes[0]) || '999999').toUpperCase();
    const active = db.terminals.filter(t => t.code === code);
    const count = Math.min(env.MAX_TERMINAL_SLOTS, active.length);

    const slot1Occupied = active.some(t => t.slotNumber === 1);
    const slot2Occupied = active.some(t => t.slotNumber === 2);

    return {
      code,
      connectedCount: count,
      maxSlots: env.MAX_TERMINAL_SLOTS,
      slotText: `${count}/${env.MAX_TERMINAL_SLOTS}`,
      slots: [
        {
          code,
          slotNumber: 1,
          name: 'User Terminal 1',
          connected: slot1Occupied,
          activeUsers: count,
          status: slot1Occupied ? 'connected' : 'available'
        },
        {
          code,
          slotNumber: 2,
          name: 'User Terminal 2',
          connected: slot2Occupied,
          activeUsers: count,
          status: slot2Occupied ? 'connected' : 'available'
        },
        {
          code,
          slotNumber: 3,
          name: constants.SLOT_CONFIG.TERMINAL_3_NAME,
          connected: false,
          blocked: true,
          status: 'blocked',
          message: constants.SLOT_CONFIG.BLOCK_MESSAGE
        }
      ],
      terminal3Blocked: true
    };
  },

  clearOld() {
    const db = readDb();
    const now = Date.now();
    const before = db.terminals.length;
    db.terminals = db.terminals.filter(t => (now - (t.lastSeen || 0)) < 60000);
    if (db.terminals.length !== before) {
      writeDb(db);
    }
  }
};

module.exports = TerminalStore;
