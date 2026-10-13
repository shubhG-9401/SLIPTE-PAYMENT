# UPI Merchant Payment & Gateway Platform (Localhost)

A modular, scalable, full-stack UPI Payment Gateway and Terminal Management system designed for local deployment. Features real-time dynamic QR code generation, automated $\le ₹1999$ payment chunk splitting, multi-account UPI destination routing, concurrent terminal slot pairing (with strict 2-terminal enforcement and Terminal 3 blocking), and centralized platform administration.

---

## 📑 Table of Contents
1. [Architecture Overview](#architecture-overview)
2. [Folder Structure](#folder-structure)
3. [Configuration & Environment Variables](#configuration--environment-variables)
4. [Running on Localhost](#running-on-localhost)
5. [Core Business Logic & Rules](#core-business-logic--rules)
6. [API Specification](#api-specification)
7. [WebSocket Event Protocol](#websocket-event-protocol)
8. [Frontend State Management](#frontend-state-management)
9. [Testing Suite](#testing-suite)

---

## 1. Architecture Overview

The system is organized around clean separation of concerns, decoupling business logic, state management, and transport layers:

```
[ Customer Phone / Browser ]          [ Merchant Dashboard ]          [ Admin Console ]
             │                                   │                           │
             ▼                                   ▼                           ▼
      /user.html (UI)                    /merchant.html (UI)         /admin.html (UI)
             │                                   │                           │
  [ userState.js / userApp.js ]        [ merchantState / App ]       [ adminState / App ]
             │                                   │                           │
             └──────────────────┬────────────────┘                           │
                                ▼                                            ▼
                    [ apiClient & soundManager ] (Shared Reusable Modules)
                                │
                 HTTP REST & WebSocket (ws://)
                                │
                                ▼
                       Express HTTP Server (server.js)
                                │
        ┌───────────────────────┼────────────────────────┐
        ▼                       ▼                        ▼
  [ Middlewares ]         [ API Router ]          [ Socket Manager ]
  - requestLogger         - /api/merchant         - merchantSockets
  - validator             - /api/user             - userSockets
  - errorHandler          - /api/admin            - room broadcasts
                          - /api (system)
                                │
        ┌───────────────────────┴────────────────────────┐
        ▼                                                ▼
  [ Business Services ]                            [ Storage Layer ]
  - upiService (splits <= 1999, URIs)              - jsonDb (sync disk writer)
  - qrService (styled QR rendering)                - merchantStore
  - networkService (LAN/Wi-Fi discovery)           - transactionStore
                                                   - terminalStore (slots & heartbeats)
```

---

## 2. Folder Structure

```
SLIPTE-PAYMENT/
├── .env                          # Local environment configuration
├── .env.example                  # Environment configuration template
├── LICENSE                       # MIT License
├── package.json                  # Scripts and dependencies (express, ws, qrcode, bcryptjs, cors)
├── README.md                     # Comprehensive documentation
├── server.js                     # Server entry point & startup banner
├── db.js                         # Root façade for backward compatibility
├── data/
│   └── database.json             # Persistent local JSON data store
├── src/
│   ├── config/
│   │   ├── env.js                # Environment loader with fallbacks
│   │   └── constants.js          # Platform constants, statuses, event names
│   ├── utils/
│   │   ├── logger.js             # Formatted ISO logger
│   │   └── helpers.js            # Normalization, 6-digit code generators
│   ├── services/
│   │   ├── upiService.js         # Split logic (<= 1999), URI builder, payload routing
│   │   ├── qrService.js          # Base64 QR code generation
│   │   └── networkService.js     # LAN / Wi-Fi IP resolver for phone testing
│   ├── storage/
│   │   ├── jsonDb.js             # Disk synchronization and cache adapter
│   │   ├── merchantStore.js      # Merchant CRUD & credential verification
│   │   ├── transactionStore.js   # Transactions, sequential chunks, stats
│   │   └── terminalStore.js      # Heartbeat registry, 2-slot limit, Terminal 3 blocking
│   ├── middlewares/
│   │   ├── requestLogger.js      # HTTP request logging
│   │   ├── validator.js          # Parameter & body validation
│   │   └── errorHandler.js       # Centralized error handler returning structured JSON
│   ├── controllers/
│   │   ├── merchantController.js # Merchant API operations
│   │   ├── userController.js     # Terminal pairing & heartbeat polling
│   │   ├── adminController.js    # Platform governance & metrics
│   │   └── systemController.js   # QR generator, network info, terminal block
│   ├── routes/
│   │   ├── api.js                # Master scalable API router
│   │   ├── merchantRoutes.js     # /api/merchant/*
│   │   ├── userRoutes.js         # /api/user/*
│   │   ├── adminRoutes.js        # /api/admin/*
│   │   └── systemRoutes.js       # /api/qr, /api/network-info, /api/terminal/3
│   └── websocket/
│       └── socketManager.js      # Real-time WebSocket connection manager
├── public/                       # Single authoritative client web assets root
│   ├── index.html                # Unified Portal Switcher (Home)
│   ├── merchant.html             # Merchant Portal view
│   ├── user.html                 # Customer Terminal view
│   ├── admin.html                # Admin Console view
│   ├── css/
│   │   ├── common.css            # Reusable design tokens, buttons, alerts, badges, modals
│   │   ├── merchant.css          # Merchant-specific styles
│   │   ├── user.css              # Customer terminal styles
│   │   ├── admin.css             # Admin dashboard styles
│   │   └── index.css             # Home switcher styles
│   └── js/
│       ├── shared/
│       │   ├── store.js          # Reactive Pub/Sub state management store
│       │   ├── api.js            # Standardized fetch client
│       │   ├── sound.js          # Web Audio synthesized auditory feedback
│       │   └── utils.js          # Currency formatting, split calculations, clipboard
│       ├── merchant/
│       │   ├── merchantState.js  # Merchant reactive state definition
│       │   └── merchantApp.js    # Merchant UI bindings, socket listener, preview
│       ├── user/
│       │   ├── userState.js      # User terminal state definition
│       │   └── userApp.js        # Terminal QR viewer, timer, poll sync
│       └── admin/
│           ├── adminState.js     # Admin state definition
│           └── adminApp.js       # Directory audits, KPI metrics, security controls
└── tests/
    ├── unit/
    │   ├── splitAndUpi.test.js   # Unit tests for splitAmount and URI formatting
    │   └── multiUpi.test.js      # Unit tests for multi-UPI round-robin routing
    └── integration/
        ├── api.test.js           # API route tests
        ├── terminal3.test.js     # Terminal 3 blocking & 6-digit code tests
        └── e2e.test.js           # Full end-to-end lifecycle verification suite
```

---

## 3. Configuration & Environment Variables

All settings are configured via `.env` (a template is provided in `.env.example`):

| Variable | Default | Description |
|---|---|---|
| `PORT` | `3000` | Local HTTP and WebSocket server port |
| `HOST` | `0.0.0.0` | Bind host (`0.0.0.0` allows phones on the same Wi-Fi to connect) |
| `NODE_ENV` | `development` | Runtime environment (`development` / `production`) |
| `DB_FILE_PATH` | `./data/database.json` | Path to the local JSON database file |
| `SPLIT_MAX_AMOUNT` | `1999` | Maximum payment amount per chunk (₹ INR) |
| `COUNTDOWN_TIMER_SECONDS` | `120` | Payment window timer duration in seconds |
| `MAX_TERMINAL_SLOTS` | `2` | Maximum concurrent terminals allowed per merchant |
| `ADMIN_USERNAME` | `shubhg9401` | Platform administrator username |
| `ADMIN_PASSWORD` | `admin123` | Platform administrator password |
| `DEMO_MERCHANT_PASSWORD` | `demo123` | Password for instant sandbox demo merchant |

---

## 4. Running on Localhost

### Prerequisites
- Node.js (version 18 or higher recommended)
- npm

### Installation & Launch
```bash
# 1. Clone the repository and enter directory
git clone https://github.com/<your-username>/SLIPTE-PAYMENT.git
cd SLIPTE-PAYMENT

# 2. Install dependencies (express, ws, qrcode, bcryptjs, cors - native express.json used)
npm install

# 3. Launch the local server
npm start
```

Once running, navigate to:
- **Portal Switcher**: [http://localhost:3000/](http://localhost:3000/)
- **Merchant Portal**: [http://localhost:3000/merchant](http://localhost:3000/merchant)
- **User Payment Terminal**: [http://localhost:3000/user](http://localhost:3000/user)
- **Admin Console**: [http://localhost:3000/admin](http://localhost:3000/admin)

### Testing on a Mobile Phone (Same Wi-Fi)
1. Ensure your phone and PC are connected to the same Wi-Fi network.
2. In the Merchant Portal, click **"📱 Open on Phone"** to display a QR code with your LAN IP address (e.g. `http://192.168.1.3:3000/user.html?code=999999`).
3. Scan the QR code with your phone camera to open the Customer Terminal directly on your mobile device.

---

## 5. Core Business Logic & Rules

### 1. Payment Auto-Splitting ($\le ₹1999$)
- **Condition A (Amount $\le ₹1999$)**:
  Generates a single payment payload.
- **Condition B (Amount $> ₹1999$)**:
  Automatically split into sequential chunks of at most ₹1999.
  - E.g. $₹3000 \rightarrow [₹1999, ₹1001]$
  - E.g. $₹4500 \rightarrow [₹1999, ₹1999, ₹502]$

### 2. Multi-Account UPI Destination Routing
- Merchants can configure between 1 and 5 destination UPI IDs using the dropdown in the **Transaction Amount Entry & Auto-Splitting** section.
- Split chunks cycle sequentially across the configured accounts (Payload 1 $\rightarrow$ UPI #1, Payload 2 $\rightarrow$ UPI #2, Payload 3 $\rightarrow$ UPI #1).
- Each generated dynamic QR code targets that specific chunk's receiving UPI address.

### 3. Assigned Unique Code (6 Digits)
- Every merchant is assigned a unique 6-digit numeric pairing code (e.g. `999999` for Demo).
- Customers enter this 6-digit code on their terminal to establish a direct link with the merchant.

### 4. Terminal Slots & Terminal 3 Blocking
- Each merchant code supports at most **2 concurrent user terminals** (Terminal 1 and Terminal 2).
- Attempting to connect a 3rd concurrent terminal triggers a **403 Forbidden** error with `terminal3Blocked: true`, rendering a warning card and blocking access.

### 5. Sequential Chunk Progression & 120s Expiry
- When a payment request is initiated, Payload 1 is pushed to the customer's terminal with a live 2-minute countdown timer.
- When the customer pays and the merchant clicks **"Approve"**, Payload 1 is marked as approved and Payload 2 is immediately pushed with a fresh 2-minute countdown timer.
- Once all chunks are approved, the customer screen shows the success celebration receipt.

---

## 6. API Specification

All API endpoints return standard JSON responses:

### Merchant Endpoints (`/api/merchant`)
- `POST /api/merchant/register`: Free merchant registration.
- `POST /api/merchant/login`: Merchant login.
- `GET /api/merchant/me/:id`: Fetch merchant profile and slot indicators.
- `GET /api/merchant/demo`: Instant demo sandbox merchant session.
- `POST /api/merchant/regenerate-codes`: Generates a new 6-digit assigned unique code.
- `POST /api/merchant/update-upi`: Update destination UPI ID(s).
- `POST /api/merchant/payment-request`: Create and dispatch payment request.
- `POST /api/merchant/payment-action`: Approve or deny active chunk (`{ action: 'approve' | 'deny' }`).
- `GET /api/merchant/sync/:id`: Poll dashboard state (slots, stats, transactions, active payment).
- `GET /api/merchant/stats/:id`: Retrieve revenue statistics and transaction counts.
- `GET /api/merchant/transactions/:id`: Retrieve transaction history.

### User Terminal Endpoints (`/api/user`)
- `GET /api/user/validate-code/:code`: Validates 6-digit merchant code.
- `GET /api/user/terminal/:code`: Heartbeat & synchronization endpoint.
- `POST /api/user/submit-payment`: Customer submits payment verification / UTR.
- `GET /api/user/payment-status/:txnId`: Poll status of a transaction.

### Admin Endpoints (`/api/admin`)
- `POST /api/admin/login`: Administrator login.
- `GET /api/admin/stats`: Platform-wide GMV, merchant, and terminal metrics.
- `GET /api/admin/merchants`: Directory of registered merchants.
- `POST /api/admin/merchant-status`: Suspend or reactivate merchant account.
- `POST /api/admin/reset-password`: Reset merchant credentials.
- `POST /api/admin/clear-data`: Purge non-demo test data.
- `GET /api/admin/transactions`: Global audit log of all transactions.

### System Utilities (`/api`)
- `GET /api/qr?text=...`: Generate dynamic QR data URL.
- `GET /api/network-info`: Discover local Wi-Fi / LAN IP.
- `ALL /api/terminal/3`: Dedicated blocked endpoint returning 403 Forbidden.

---

## 7. WebSocket Event Protocol

WebSockets (`ws://localhost:3000`) provide zero-latency real-time state synchronization with automatic reconnection and live status badges across all portals:

> **Transport Architecture**: Real-time communication relies primarily on WebSockets (`ws://` / `wss://`). All events (connection, pairing, payments, chunk progression, approvals, and denials) push instantaneously through room channels. Client terminals also maintain background HTTP synchronization via `GET /api/user/terminal/:code` as a local heartbeat fallback. (Native `express.json()` is used without external `body-parser`).

| Event Name | Direction | Payload Description |
|---|---|---|
| `merchant_init` | Client $\rightarrow$ Server | Merchant registers socket connection (`merchantId`) |
| `merchant_ready` | Server $\rightarrow$ Client | Server returns initial slot occupancy |
| `user_init` | Client $\rightarrow$ Server | User terminal pairs via 6-digit unique code |
| `user_ready` | Server $\rightarrow$ Client | Pairing confirmed; terminal slot assigned |
| `slot_updated` | Server $\rightarrow$ Merchant | Broadcasts updated terminal slot count (`0/2`, `1/2`, `2/2`) |
| `payment_incoming` | Server $\rightarrow$ User | Dispatches active QR payload to user terminal |
| `payment_pending` | Server $\rightarrow$ Merchant | Updates merchant UI to waiting state |
| `user_payment_submitted` | Server $\rightarrow$ Merchant | Customer submitted payment / UTR |
| `chunk_approved_next` | Server $\rightarrow$ User & Merchant | Previous chunk approved; next sequential chunk active |
| `payment_decision` | Server $\rightarrow$ User | Final approval or denial decision |
| `user_error` | Server $\rightarrow$ User | Returned if code is invalid or Terminal 3 is blocked |

---

## 8. Frontend State Management

Frontend applications are built with modular separation:
- **`createStore(initialState)` (`public/js/shared/store.js`)**:
  Reactive Pub/Sub state store. State changes notify registered listeners.
- **`apiClient` (`public/js/shared/api.js`)**:
  Standardized HTTP fetch wrapper handling serialization, parsing, and structured error throwing.
- **`soundManager` (`public/js/shared/sound.js`)**:
  Web Audio API synthesizer producing `chime`, `beep`, and `alert` tones without external assets.
- **`appUtils` (`public/js/shared/utils.js`)**:
  Indian Rupee currency formatter, split calculator, date formatting, and clipboard utilities.

---

## 9. Testing Suite

The codebase includes comprehensive unit, integration, and end-to-end tests:

```bash
# Run unit tests (split logic & multi-UPI routing)
npm test

# Run integration tests (terminal 3 blocking & HTTP APIs)
npm run test:integration

# Run full end-to-end specification test
npm run test:e2e

# Run the complete test suite
npm run test:all
```

---

## 10. License

MIT License. Built for local development and private testing. See `LICENSE` file for details.
