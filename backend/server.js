
require('dotenv').config();
const express = require('express');
const app = express();
app.use(express.json());
const PORT = process.env.PORT || 1000;
const axios = require('axios');

// Aggressive logging: log to file, stdout, and stderr, and log file write errors
const fs = require('fs');
const LOG_FILE = __dirname + '/error.log';
function logToFile(msg, ...args) {
  try {
    fs.appendFileSync(LOG_FILE, msg + ' ' + args.map(a => (typeof a === 'string' ? a : JSON.stringify(a))).join(' ') + '\n');
  } catch (e) {
    const errMsg = `[${new Date().toISOString()}] [LOG FILE WRITE ERROR] ${e && e.message ? e.message : e}`;
    try { fs.appendFileSync(LOG_FILE, errMsg + '\n'); } catch {} // try again, ignore if fails
    console.error(errMsg);
  }
}
function logAlways(...args) {
  const msg = `[${new Date().toISOString()}]`;
  console.log(msg, ...args);
  logToFile(msg, ...args);
  if (process.stdout && process.stdout.flush) process.stdout.flush();
}
function errorAlways(...args) {
  const msg = `[${new Date().toISOString()}]`;
  console.error(msg, ...args);
  logToFile(msg, ...args);
  if (process.stderr && process.stderr.flush) process.stderr.flush();
}
function warnAlways(...args) {
  const msg = `[${new Date().toISOString()}]`;
  console.warn(msg, ...args);
  logToFile(msg, ...args);
  if (process.stderr && process.stderr.flush) process.stderr.flush();
}

// Log server startup aggressively
logAlways('=== SERVER STARTUP ===');
try {
  fs.appendFileSync(LOG_FILE, `[${new Date().toISOString()}] === SERVER STARTUP ===\n`);
} catch (e) {
  console.error(`[${new Date().toISOString()}] [LOG FILE WRITE ERROR ON STARTUP]`, e && e.message ? e.message : e);
}

// Log every incoming request to file
app.use((req, res, next) => {
  logAlways(`[REQUEST] ${req.method} ${req.originalUrl} from ${req.ip}`);
  next();
});
// Best practice: directly invoke the callback logic
app.post('/api/manual_callback', (req, res) => {
  const { txId, status, msisdn } = req.body;
  if (!txId || !status || !msisdn) {
    return res.status(400).json({ success: false, message: 'txId, status, msisdn required' });
  }
  // Call the same logic as the real callback
	// Normalize status
	let normStatus = String(status).trim().toUpperCase();
	// Expanded list of failure statuses to include common user-cancelled and wrong PIN values
	const failureStatuses = [
		"FAILED", "CANCELLED", "REVERSED", "DECLINED",
		"USER_CANCELLED", "USERCANCELLED", "USER CANCELLED",
		"WRONG_PIN", "WRONGPIN", "WRONG PIN",
		"REQUEST_CANCELLED_BY_USER", "REQUEST CANCELLED BY USER",
		"REQUEST_CANCELLED", "REQUEST CANCELLED",
		"AUTHENTICATION_FAILED", "AUTHENTICATION FAILED"
	];
	if (["SUCCESS", "COMPLETED"].includes(normStatus)) {
		normStatus = 'COMPLETED';
	} else if (failureStatuses.includes(normStatus)) {
		normStatus = 'FAILED';
	} else {
		normStatus = 'PENDING';
	}
  // Idempotency: only update if new or status changed
  const prev = txStore.get(txId);
  if (!prev || prev.status !== normStatus) {
    txStore.set(txId, { status: normStatus, msisdn, updatedAt: Date.now() });
  }
  // Always clear pending tx if completed/failed
  if (stkPendingTx.has(msisdn)) {
    const pending = stkPendingTx.get(msisdn);
    if (pending && pending.txId === txId) {
      stkPendingTx.delete(msisdn);
    }
  }
	logAlways('Manual callback simulated:', { txId, status: normStatus, msisdn });
  return res.json({ success: true, simulated: true });
});

// --- Robust CORS Middleware ---
// Update allowedOrigins to include all valid frontend domains
const allowedOrigins = [
  'http://localhost:1002',
  'https://extrracash.vercel.app',
  'https://instantmkoponow.vercel.app', // <-- ensure this is present
  'https://instantmkoponow.vercel.app/' // (with and without trailing slash for safety)
];
// Robust CORS middleware: always set Vary, only allow whitelisted origins
app.use((req, res, next) => {
  const origin = req.headers.origin;
  res.setHeader('Vary', 'Origin');
  if (origin && allowedOrigins.includes(origin.replace(/\/$/, ''))) {
    res.setHeader('Access-Control-Allow-Origin', origin);
    res.setHeader('Access-Control-Allow-Credentials', 'true');
  }
  res.setHeader('Access-Control-Allow-Methods', 'GET,POST,PUT,DELETE,OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type,Authorization');
  if (req.method === 'OPTIONS') {
    res.status(204).end();
    return;
  }
  next();
});

app.get('/api/health', (req, res) => res.send('ok'));

// Load environment variables
const trimEnv = (v) => typeof v === 'string' ? v.trim() : v;
const HASKBACK_API_KEY = trimEnv(process.env.HASKBACK_API_KEY); // h263185iGVRZY
const HASKBACK_API_URL = trimEnv(process.env.HASKBACK_API_URL);
const HASKBACK_PARTYB = trimEnv(process.env.HASKBACK_PARTYB); // 6165928
const HASKBACK_ACCOUNT_ID = trimEnv(process.env.HASKBACK_ACCOUNT_ID); // HP329627
const HASKBACK_CALLBACK_URL = trimEnv(process.env.HASKBACK_CALLBACK_URL); // https://your-new-frontend-domain.com/api/haskback_callback
const HASKBACK_ACCOUNT_REFERENCE = trimEnv(process.env.HASKBACK_ACCOUNT_REFERENCE); // NewApp
const HASKBACK_TRANSACTION_DESC = trimEnv(process.env.HASKBACK_TRANSACTION_DESC); // NewApp loan processing fee


// --- Simple in-memory rate limiting and pending transaction tracking by msisdn ---
const stkRateLimit = new Map(); // msisdn -> timestamp
const stkPendingTx = new Map(); // msisdn -> { txId, createdAt }
const txStore = new Map(); // txId -> { status, msisdn, amount, partyB, createdAt, updatedAt, ...extra }
const TX_STATUS_EXPIRY = 24 * 60 * 60 * 1000; // 24 hours


app.listen(PORT, () => {
logAlways(`Hashback server running on port ${PORT}`);
});

// Periodically clean up old txStore entries (best practice)
setInterval(() => {
	const now = Date.now();
	for (const [txId, tx] of txStore.entries()) {
		if (tx.updatedAt && now - tx.updatedAt > TX_STATUS_EXPIRY) {
			txStore.delete(txId);
		}
	}
}, 60 * 60 * 1000); // every hour
const STK_RATE_LIMIT_WINDOW = 60 * 1000; // 1 minute
const STK_PENDING_TX_TIMEOUT = 5 * 60 * 1000; // 5 minutes

// Cleanup old pending transactions and rate limit entries every minute
function cleanupStaleTransactions() {
    const now = Date.now();
    // Clean pending transactions (more aggressively: 2.5 min instead of 5 min)
    for (const [msisdn, val] of stkPendingTx.entries()) {
        if (!val || !val.createdAt || now - val.createdAt > (STK_PENDING_TX_TIMEOUT / 2)) {
            stkPendingTx.delete(msisdn);
        }
    }
    // Clean rate limit entries (same window as STK_RATE_LIMIT_WINDOW)
    for (const [msisdn, ts] of stkRateLimit.entries()) {
        if (now - ts > STK_RATE_LIMIT_WINDOW) {
            stkRateLimit.delete(msisdn);
        }
    }
}
setInterval(cleanupStaleTransactions, 30 * 1000); // Run every 30 seconds

// --- Best-practice STK Push Endpoint ---
app.post('/api/haskback_push', async (req, res) => {
  logAlways('==== /api/haskback_push called ====');
  logAlways('Request body:', JSON.stringify(req.body, null, 2));

  // --- Helper: Normalize and validate MSISDN ---
  function normalizeMsisdn(msisdn) {
    let m = String(msisdn || '').replace(/\D/g, '');
    if (m.startsWith('0')) return '254' + m.substring(1);
    if (m.startsWith('7') || m.startsWith('1')) return '254' + m;
    if (m.startsWith('254')) return m;
    return '254' + m;
  }

  // --- Helper: Build Haskback payload ---
  function buildPayload({ msisdn, amount, reference, partyB }) {
    return {
      api_key: HASKBACK_API_KEY,
      account_id: HASKBACK_ACCOUNT_ID,
      amount,
      msisdn,
      reference,
      partyB: partyB || HASKBACK_PARTYB,
      callback_url: HASKBACK_CALLBACK_URL,
      account_reference: HASKBACK_ACCOUNT_REFERENCE,
      transaction_desc: HASKBACK_TRANSACTION_DESC
    };
  }

  try {
    let { msisdn, amount, reference, partyB } = req.body;
    msisdn = normalizeMsisdn(msisdn);
    logAlways('Normalized msisdn:', msisdn);

    // --- Check for pending transaction ---
    if (stkPendingTx.has(msisdn)) {
      warnAlways('Pending transaction exists for msisdn:', msisdn);
      return res.status(429).json({ success: false, message: 'You have a pending transaction. Please complete it before initiating a new one.' });
    }

    // --- Rate limiting ---
    const now = Date.now();
    const last = stkRateLimit.get(msisdn) || 0;
    let lastTxId = null;
    let lastTxStatus = null;
    // Find most recent tx for this msisdn
    for (const [txId, tx] of txStore.entries()) {
      if (tx.msisdn === msisdn && (!lastTxId || (tx.updatedAt && tx.updatedAt > (txStore.get(lastTxId)?.updatedAt || 0)))) {
        lastTxId = txId;
      }
    }
    if (lastTxId && txStore.has(lastTxId)) {
      lastTxStatus = String(txStore.get(lastTxId).status || '').toUpperCase();
    }
    logAlways('Last txId:', lastTxId, 'Last txStatus:', lastTxStatus);
    const retryableStatuses = [
      'FAILED', 'CANCELLED', 'REVERSED', 'DECLINED',
      'USER_CANCELLED', 'USERCANCELLED', 'USER CANCELLED',
      'WRONG_PIN', 'WRONGPIN', 'WRONG PIN',
      'REQUEST_CANCELLED_BY_USER', 'REQUEST CANCELLED BY USER',
      'REQUEST_CANCELLED', 'REQUEST CANCELLED',
      'AUTHENTICATION_FAILED', 'AUTHENTICATION FAILED'
    ];
    if (now - last < STK_RATE_LIMIT_WINDOW && !retryableStatuses.includes(lastTxStatus)) {
      warnAlways('Rate limit hit for msisdn:', msisdn, 'last:', last, 'now:', now);
      return res.status(429).json({ success: false, message: 'Too many STK requests. Please wait a minute before trying again.' });
    }
    stkRateLimit.set(msisdn, now);

    // --- Validate required fields ---
    if (!msisdn || !amount || !reference) {
      errorAlways('Missing required fields:', req.body);
      return res.status(400).json({ success: false, message: 'msisdn, amount, and reference are required.', debug: req.body });
    }
    partyB = partyB || HASKBACK_PARTYB;
    if (!partyB) {
      errorAlways('Missing partyB (till number)');
      return res.status(400).json({ success: false, message: 'partyB (till number) is required.' });
    }

    // --- Build and validate payload ---
    const payload = buildPayload({ msisdn, amount, reference, partyB });
    for (const [k, v] of Object.entries(payload)) {
      if (!v || (typeof v === 'string' && v.trim() === '')) {
        errorAlways(`Missing or empty field: ${k}`, 'Current value:', v);
        return res.status(400).json({ success: false, message: `Missing or empty field: ${k}`, debug: { field: k, value: v, env: process.env } });
      }
    }

    // --- Initiate STK push ---
    logAlways('Sending to Hashback API:', JSON.stringify(payload, null, 2));
    const response = await axios.post(
      `${HASKBACK_API_URL}/initiatestk`,
      payload
    );
    // --- Store transaction for status tracking ---
    const txId = response.data?.checkout_id || response.data?.transaction_id || response.data?.id || `${msisdn}_${Date.now()}`;
    stkPendingTx.set(msisdn, { txId, createdAt: Date.now() });
    txStore.set(txId, { status: 'PENDING', msisdn, amount, partyB, createdAt: Date.now() });
    logAlways('STK push initiated successfully. txId:', txId, 'Response:', response.data);
    return res.json({ success: true, data: response.data, txId });
  } catch (error) {
    errorAlways('Haskback STK Push Error:', error);
    if (error.response && error.response.data) {
      errorAlways('Hashback API error response:', error.response.data);
    }
    // Clean up pending tx if failed to initiate
    if (req.body && req.body.msisdn) {
      const msisdn = normalizeMsisdn(req.body.msisdn);
      stkPendingTx.delete(msisdn);
    }
    return res.status(500).json({ success: false, error: error.response?.data || error.message, stack: error.stack });
  }
});

// Endpoint to clear pending tx when completed/failed (should be called by status polling or callback)
app.post('/api/clear_pending_tx', (req, res) => {
	const { msisdn, txId } = req.body;
	if (!msisdn) return res.status(400).json({ success: false, message: 'msisdn required' });
	const pending = stkPendingTx.get(msisdn);
	if (pending && (pending.txId === txId || !txId)) {
		stkPendingTx.delete(msisdn);
		return res.json({ success: true });
	}
	res.status(400).json({ success: false, message: 'txId does not match pending transaction' });
});


// Endpoint to check payment status for msisdn and txId
// Robust status endpoint (best practice)
app.post('/api/haskback_status', (req, res) => {
	logAlways('Status check:', req.body);
	let { msisdn, txId } = req.body;
	if (!msisdn || !txId) {
		return res.status(400).json({ status: 'FAILED', message: 'msisdn and txId required' });
	}
	msisdn = String(msisdn).replace(/\D/g, '');
	if (msisdn.startsWith('0')) {
		msisdn = '254' + msisdn.substring(1);
	} else if (msisdn.startsWith('7') || msisdn.startsWith('1')) {
		msisdn = '254' + msisdn;
	} else if (!msisdn.startsWith('254')) {
		msisdn = '254' + msisdn;
	}
	const now = Date.now();
	// Check txStore for real status
	if (txStore.has(txId)) {
		const tx = txStore.get(txId);
		if (tx.status === 'COMPLETED') {
			return res.json({ status: 'COMPLETED', message: 'Payment completed.' });
		} else if (tx.status === 'FAILED') {
			return res.json({ status: 'FAILED', message: 'Payment failed or cancelled.' });
		} else {
			// Still pending, but check for expiry
			if (tx.updatedAt && now - tx.updatedAt > STK_PENDING_TX_TIMEOUT) {
				txStore.set(txId, { ...tx, status: 'FAILED', updatedAt: now });
				return res.json({ status: 'FAILED', message: 'Transaction timed out.' });
			}
			return res.json({ status: 'PENDING', message: 'Transaction is still pending.' });
		}
	}
	// Fallback to pending tx logic
	const pending = stkPendingTx.get(msisdn);
	if (!pending || !pending.txId || pending.txId !== txId) {
		return res.json({ status: 'FAILED', message: 'No pending transaction found.' });
	}
	if (now - pending.createdAt > STK_PENDING_TX_TIMEOUT) {
		stkPendingTx.delete(msisdn);
		return res.json({ status: 'FAILED', message: 'Transaction timed out.' });
	}
	return res.json({ status: 'PENDING', message: 'Transaction is still pending.' });
});

// Callback endpoint for Haskback to notify payment result
// Haskback payment result callback endpoint (best practice)
app.post('/api/haskback_callback', (req, res) => {
	// Log all callback events for audit/debug
    // Extra logging for all callback events and headers
    logAlways('==== /api/haskback_callback called ====');
    logAlways('Callback headers:', JSON.stringify(req.headers, null, 2));
    logAlways('Callback body:', JSON.stringify(req.body, null, 2));
    const { txId, status, msisdn, ...extra } = req.body;
    if (!txId || !status || !msisdn) {
        errorAlways('Callback missing required fields:', req.body);
        return res.status(400).json({ success: false, message: 'txId, status, and msisdn required' });
    }
    // Normalize status (best practice)
    let normStatus = String(status).trim().toUpperCase();
    // Expanded list of failure statuses to include common user-cancelled and wrong PIN values
    const failureStatuses = [
        "FAILED", "CANCELLED", "REVERSED", "DECLINED",
        "USER_CANCELLED", "USERCANCELLED", "USER CANCELLED",
        "WRONG_PIN", "WRONGPIN", "WRONG PIN",
        "REQUEST_CANCELLED_BY_USER", "REQUEST CANCELLED BY USER",
        "REQUEST_CANCELLED", "REQUEST CANCELLED",
        "AUTHENTICATION_FAILED", "AUTHENTICATION FAILED"
    ];
    if (["SUCCESS", "COMPLETED"].includes(normStatus)) {
        normStatus = 'COMPLETED';
    } else if (failureStatuses.includes(normStatus)) {
        normStatus = 'FAILED';
    } else {
        normStatus = 'PENDING';
    }
    // Idempotency: only update if new or status changed
    const prev = txStore.get(txId);
    if (!prev || prev.status !== normStatus) {
        txStore.set(txId, { status: normStatus, msisdn, ...extra, updatedAt: Date.now() });
    }
    // Always clear pending tx if completed/failed (best practice)
    if (stkPendingTx.has(msisdn)) {
        const pending = stkPendingTx.get(msisdn);
        if (pending && pending.txId === txId) {
            stkPendingTx.delete(msisdn);
        }
    }
    return res.json({ success: true });
});
app.listen(PORT, () => logAlways('Listening on', PORT));

