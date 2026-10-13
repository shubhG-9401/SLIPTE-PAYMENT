/**
 * @file socketManager.js
 * @description Manages WebSocket connections, room routing, terminal pairing, and real-time event broadcasting.
 */

const { WebSocketServer } = require('ws');
const MerchantStore = require('../storage/merchantStore');
const TransactionStore = require('../storage/transactionStore');
const TerminalStore = require('../storage/terminalStore');
const constants = require('../config/constants');
const env = require('../config/env');
const logger = require('../utils/logger');

class SocketManager {
  constructor() {
    this.wss = null;
    this.merchantSockets = new Map(); // merchantId -> Set<WebSocket>
    this.userSockets = new Map();     // merchantCode -> Set<WebSocket>
  }

  init(server) {
    this.wss = new WebSocketServer({ server });

    this.wss.on('connection', (ws) => {
      let boundRole = null;
      let boundMerchantId = null;
      let boundUserCode = null;

      ws.on('message', (messageRaw) => {
        try {
          const data = JSON.parse(messageRaw);

          if (data.type === constants.WS_EVENTS.MERCHANT_INIT) {
            boundRole = 'merchant';
            boundMerchantId = data.merchantId;

            if (!this.merchantSockets.has(boundMerchantId)) {
              this.merchantSockets.set(boundMerchantId, new Set());
            }
            this.merchantSockets.get(boundMerchantId).add(ws);

            const merchant = MerchantStore.findById(boundMerchantId);
            if (merchant) {
              const slotInfo = TerminalStore.getSlotStatus(merchant);
              this.sendToWs(ws, {
                type: constants.WS_EVENTS.MERCHANT_READY,
                slotInfo,
                slots: slotInfo.slots
              });
            }
          } else if (data.type === constants.WS_EVENTS.USER_INIT) {
            const code = (data.userCode || '').trim().toUpperCase();
            const merchant = MerchantStore.findByMerchantCode(code);

            if (!merchant) {
              this.sendToWs(ws, {
                type: constants.WS_EVENTS.USER_ERROR,
                message: 'Invalid unique code. No merchant associated with this code.'
              });
              return;
            }

            if (merchant.status === constants.MERCHANT_STATUS.BLOCKED) {
              this.sendToWs(ws, {
                type: constants.WS_EVENTS.USER_ERROR,
                message: 'Merchant account is currently blocked by Admin.'
              });
              return;
            }

            const merchantCode = (merchant.merchant_code || (merchant.user_codes && merchant.user_codes[0]) || code).toUpperCase();
            const existingSockets = this.userSockets.get(merchantCode) || new Set();

            // Enforce maximum 2 distinct user sockets per merchant code - Block Terminal 3
            if (existingSockets.size >= env.MAX_TERMINAL_SLOTS && !existingSockets.has(ws)) {
              this.sendToWs(ws, {
                type: constants.WS_EVENTS.USER_ERROR,
                terminal3Blocked: true,
                slotLimitExceeded: true,
                error: 'Access Blocked: Maximum 2 terminals (Terminal 1 & Terminal 2) allowed. Terminal 3 is blocked.',
                message: constants.SLOT_CONFIG.BLOCK_MESSAGE
              });
              return;
            }

            boundRole = 'user';
            boundUserCode = merchantCode;
            boundMerchantId = merchant.id;

            if (!this.userSockets.has(merchantCode)) {
              this.userSockets.set(merchantCode, new Set());
            }
            this.userSockets.get(merchantCode).add(ws);

            const slotInfo = TerminalStore.getSlotStatus(merchant);

            // Notify user of successful pairing
            this.sendToWs(ws, {
              type: constants.WS_EVENTS.USER_READY,
              merchantPhone: merchant.phone.replace(/(\d{2})\d{4}(\d{4})/, '$1****$2'),
              merchantUpi: merchant.upi_id,
              code: merchantCode,
              slotText: slotInfo.slotText
            });

            // Notify merchant of updated slot count
            this.broadcastToMerchant(merchant.id, {
              type: constants.WS_EVENTS.SLOT_UPDATED,
              slotInfo,
              slots: slotInfo.slots
            });

            // Check if active pending payment exists for this merchant code
            const latestTxn = TransactionStore.getLatestForCode(merchantCode);
            if (latestTxn && (latestTxn.status === constants.TRANSACTION_STATUS.PENDING || latestTxn.status === constants.TRANSACTION_STATUS.SUBMITTED)) {
              const now = Date.now();
              const exp = new Date(latestTxn.expires_at).getTime();
              if (exp > now) {
                const currentIdx = (latestTxn.current_part_index || 1) - 1;
                const currentChunk = (latestTxn.chunks && latestTxn.chunks[currentIdx]) || null;
                this.sendToWs(ws, {
                  type: constants.WS_EVENTS.ACTIVE_PAYMENT,
                  transaction: latestTxn,
                  chunk: currentChunk,
                  currentPart: latestTxn.current_part_index || 1,
                  totalParts: latestTxn.split_count || 1,
                  remainingSeconds: Math.max(0, Math.floor((exp - now) / 1000))
                });
              }
            }
          }
        } catch (err) {
          logger.error('WebSocket message parsing error:', err.message);
        }
      });

      ws.on('close', () => {
        if (boundRole === 'merchant' && boundMerchantId) {
          const set = this.merchantSockets.get(boundMerchantId);
          if (set) {
            set.delete(ws);
            if (set.size === 0) this.merchantSockets.delete(boundMerchantId);
          }
        } else if (boundRole === 'user' && boundUserCode) {
          const set = this.userSockets.get(boundUserCode);
          if (set) {
            set.delete(ws);
            if (set.size === 0) this.userSockets.delete(boundUserCode);
          }

          if (boundMerchantId) {
            const merchant = MerchantStore.findById(boundMerchantId);
            if (merchant) {
              const slotInfo = TerminalStore.getSlotStatus(merchant);
              this.broadcastToMerchant(boundMerchantId, {
                type: constants.WS_EVENTS.SLOT_UPDATED,
                slotInfo,
                slots: slotInfo.slots
              });
            }
          }
        }
      });

      ws.on('error', (err) => {
        logger.warn('WebSocket error:', err.message);
      });
    });

    logger.info('WebSocket server initialized.');
  }

  sendToWs(ws, data) {
    if (ws && ws.readyState === 1) { // 1 = OPEN
      ws.send(JSON.stringify(data));
    }
  }

  broadcastToMerchant(merchantId, data) {
    const sockets = this.merchantSockets.get(merchantId);
    if (!sockets) return;
    const msg = JSON.stringify(data);
    for (const ws of sockets) {
      if (ws.readyState === 1) ws.send(msg);
    }
  }

  broadcastToUserCode(code, data) {
    const cleanCode = (code || '').trim().toUpperCase();
    const sockets = this.userSockets.get(cleanCode);
    if (!sockets) return;
    const msg = JSON.stringify(data);
    for (const ws of sockets) {
      if (ws.readyState === 1) ws.send(msg);
    }
  }
}

const socketManager = new SocketManager();
module.exports = socketManager;
