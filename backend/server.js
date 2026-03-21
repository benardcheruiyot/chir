// Minimal, clean, working Express server.js
const express = require('express');
const path = require('path');
const cors = require('cors');
const { randomUUID } = require('crypto');
require('dotenv').config();

const app = express();
const PORT = Number(process.env.PORT || 3000);

app.use(express.json({ limit: '1mb' }));
app.use(express.static(path.join(__dirname, '..', 'frontend')));
app.disable('x-powered-by');
app.use(cors({
  origin: [
    'https://instantmkoponow.vercel.app',
    'http://localhost:3000'
  ],
  credentials: true
}));

app.use((req, res, next) => {
  req.requestId = randomUUID();
  res.setHeader('X-Request-Id', req.requestId);
  next();
});

app.get('/api/health', (_req, res) => {
  res.json({ ok: true, service: 'hashback-backend' });
});

app.post('/api/haskback_push', (req, res) => {
  // Dummy implementation for deployment sanity
  res.json({ success: true, message: 'Push endpoint working.' });
});

app.post('/api/haskback_callback', (req, res) => {
  res.json({ success: true });
});

app.use((req, res) => {
  if (req.path.startsWith('/api/')) {
    return res.status(404).json({ success: false, message: 'API route not found' });
  }
  return res.status(404).send('Not Found');
});

app.listen(PORT, () => {
  console.log(`Hashback server running on port ${PORT}`);
});
