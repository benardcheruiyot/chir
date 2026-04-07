require('dotenv').config();
const express = require('express');
const app = express();
const fs = require('fs');
const axios = require('axios');

// --- Robust CORS Middleware (MUST be before any routes) ---
const allowedOrigins = [
  'https://extrracash.vercel.app',
  'https://www.extrracash.vercel.app',
  'http://localhost:5500',
  'http://127.0.0.1:5500'
];
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

app.use(express.json());
const PORT = process.env.PORT || 1000;
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

logAlways('=== SERVER STARTUP ===');
try {
  fs.appendFileSync(LOG_FILE, `[${new Date().toISOString()}] === SERVER STARTUP ===\n`);
} catch (e) {
  console.error(`[${new Date().toISOString()}] [LOG FILE WRITE ERROR ON STARTUP]`, e && e.message ? e.message : e);
}

app.use((req, res, next) => {
  logAlways(`[REQUEST] ${req.method} ${req.originalUrl} from ${req.ip}`);
  next();
});

// --- In-memory transaction store (best practice: only txStore, robust cleanup) ---
const txStore = new Map(); // txId -> { status, msisdn, amount, partyB, createdAt, updatedAt, ...extra }
const TX_STATUS_EXPIRY = 24 * 60 * 60 * 1000; // 24 hours

// Periodically clean up old txStore entries (best practice)
setInterval(() => {
  const now = Date.now();
  for (const [txId, tx] of txStore.entries()) {
    if (tx.updatedAt && now - tx.updatedAt > TX_STATUS_EXPIRY) {
      txStore.delete(txId);
    }
  }
}, 60 * 60 * 1000); // every hour

// Load environment variables
const trimEnv = (v) => typeof v === 'string' ? v.trim() : v;
const readFallbackBody = () => {
  try {
    const raw = fs.readFileSync(__dirname + '/body.json', 'utf8');
    return JSON.parse(raw);
  } catch (err) {
    warnAlways('Could not read fallback body.json:', err && err.message ? err.message : err);
    return {};
  }
};
const fallbackBody = readFallbackBody();

const pickEnv = (...keys) => {
  for (const key of keys) {
    const value = trimEnv(process.env[key]);
    if (value) return value;
  }
  return '';
};
const HASKBACK_API_KEY = pickEnv('HASKBACK_API_KEY', 'HASHBACK_API_KEY', 'HASKBACK_APIKEY', 'HASHBACK_APIKEY') || trimEnv(fallbackBody.api_key);
const HASKBACK_API_URL = pickEnv('HASKBACK_API_URL', 'HASHBACK_API_URL') || 'https://api.hashback.co.ke';
const DEFAULT_HASKBACK_PARTYB = '8267646';
const HASKBACK_PARTYB = pickEnv('HASKBACK_PARTYB', 'HASHBACK_PARTYB') || DEFAULT_HASKBACK_PARTYB;
const HASKBACK_ACCOUNT_ID = pickEnv('HASKBACK_ACCOUNT_ID', 'HASHBACK_ACCOUNT_ID') || trimEnv(fallbackBody.account_id);
const HASKBACK_CALLBACK_URL = pickEnv('HASKBACK_CALLBACK_URL', 'HASHBACK_CALLBACK_URL') || 'https://extrracash.vercel.app/api/haskback_callback';
const HASKBACK_ACCOUNT_REFERENCE = pickEnv('HASKBACK_ACCOUNT_REFERENCE', 'HASHBACK_ACCOUNT_REFERENCE') || trimEnv(fallbackBody.reference) || 'NewApp';
const HASKBACK_TRANSACTION_DESC = pickEnv('HASKBACK_TRANSACTION_DESC', 'HASHBACK_TRANSACTION_DESC') || 'NewApp loan processing fee';

function getMissingStkConfig() {
  const missing = [];
  if (!HASKBACK_API_KEY) missing.push('HASKBACK_API_KEY');
  if (!HASKBACK_API_URL) missing.push('HASKBACK_API_URL');
  if (!HASKBACK_ACCOUNT_ID) missing.push('HASKBACK_ACCOUNT_ID');
  if (!HASKBACK_CALLBACK_URL) missing.push('HASKBACK_CALLBACK_URL');
  if (!HASKBACK_ACCOUNT_REFERENCE) missing.push('HASKBACK_ACCOUNT_REFERENCE');
  if (!HASKBACK_TRANSACTION_DESC) missing.push('HASKBACK_TRANSACTION_DESC');
  return missing;
}

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

// --- Best-practice STK Push Endpoint ---
app.post('/api/haskback_push', async (req, res) => {
  logAlways('==== /api/haskback_push called ====');
  logAlways('Request body:', JSON.stringify(req.body, null, 2));
  try {
    const missingConfig = getMissingStkConfig();
    if (missingConfig.length > 0) {
      errorAlways('Missing server configuration:', missingConfig.join(', '));
      return res.status(500).json({
        success: false,
        message: 'Server configuration missing required STK environment variables.',
        missing: missingConfig
      });
    }

    let { msisdn, amount, reference, partyB, partyb, PartyB } = req.body;
    msisdn = normalizeMsisdn(msisdn);
    logAlways('Normalized msisdn:', msisdn);
    // --- Validate required fields ---
    if (!msisdn || !amount || !reference) {
      errorAlways('Missing required fields:', req.body);
      return res.status(400).json({ success: false, message: 'msisdn, amount, and reference are required.', debug: req.body });
    }
    partyB = partyB || partyb || PartyB || HASKBACK_PARTYB || DEFAULT_HASKBACK_PARTYB;
    if (!partyB) {
      errorAlways('Missing partyB (till number)');
      return res.status(400).json({ success: false, message: 'partyB (till number) is required.' });
    }
    // --- Build and validate payload ---
    const payload = buildPayload({ msisdn, amount, reference, partyB });
    for (const [k, v] of Object.entries(payload)) {
      if (!v || (typeof v === 'string' && v.trim() === '')) {
        errorAlways(`Missing or empty field: ${k}`, 'Current value:', v);
        return res.status(400).json({ success: false, message: `Missing or empty field: ${k}` });
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
    txStore.set(txId, { status: 'PENDING', msisdn, amount, partyB, createdAt: Date.now(), updatedAt: Date.now() });
    logAlways('STK push initiated successfully. txId:', txId, 'Response:', response.data);
    return res.json({ success: true, data: response.data, txId });
  } catch (error) {
    errorAlways('Haskback STK Push Error:', error);
    if (error.response && error.response.data) {
      errorAlways('Hashback API error response:', error.response.data);
    }
    return res.status(500).json({ success: false, error: error.response?.data || error.message, stack: error.stack });
  }
});

// --- Robust status endpoint (best practice) ---
app.post('/api/haskback_status', (req, res) => {
  logAlways('Status check:', req.body);
  let { msisdn, txId } = req.body;
  if (!msisdn || !txId) {
    return res.status(400).json({ status: 'FAILED', message: 'msisdn and txId required' });
  }
  msisdn = normalizeMsisdn(msisdn);
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
      if (tx.updatedAt && now - tx.updatedAt > TX_STATUS_EXPIRY) {
        txStore.set(txId, { ...tx, status: 'FAILED', updatedAt: now });
        return res.json({ status: 'FAILED', message: 'Transaction timed out.' });
      }
      return res.json({ status: 'PENDING', message: 'Transaction is still pending.' });
    }
  }
  return res.json({ status: 'FAILED', message: 'No transaction found.' });
});

app.post('/api/clear_pending_tx', (req, res) => {
  const msisdn = normalizeMsisdn(req.body && req.body.msisdn);
  if (!msisdn) {
    return res.status(400).json({ success: false, message: 'msisdn is required' });
  }

  let removed = 0;
  for (const [txId, tx] of txStore.entries()) {
    if (tx && tx.msisdn === msisdn && tx.status === 'PENDING') {
      txStore.delete(txId);
      removed += 1;
    }
  }

  return res.json({ success: true, removed });
});

// --- Haskback payment result callback endpoint (best practice) ---
app.post('/api/haskback_callback', (req, res) => {
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
  return res.json({ success: true });
});

app.get('/api/health', (req, res) => res.send('ok'));

app.get('/api/stk_readiness', (req, res) => {
  const missing = getMissingStkConfig();
  if (missing.length > 0) {
    return res.status(500).json({ ready: false, missing });
  }
  return res.json({ ready: true });
});

app.listen(PORT, () => logAlways('Listening on', PORT));
