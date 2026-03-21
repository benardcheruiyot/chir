# mkopochapchap Backend (Haskback API)

_Test edit: This line was added to demonstrate a commit and push._

## Setup

1. Copy `.env.example` to `.env` and fill your Haskback API values.
2. Set `HASKBACK_API_URL` to your local or production endpoint (e.g., https://kite-wf2d.onrender.com).
3. Paste your Haskback API key in `HASKBACK_API_KEY`.
4. Set `HASKBACK_CALLBACK_URL` to your callback endpoint (e.g., https://instantmkoponow.vercel.app/api/haskback_callback).
5. Set `HASKBACK_ACCOUNT_REFERENCE` and `HASKBACK_TRANSACTION_DESC` as needed.

## Running

1. Install dependencies: `npm install`
2. Start server: `node src/server.js`

## Endpoints

- `/api/health` — Health check
- `/api/haskback_push` — Initiate Haskback transaction (implement as needed)
- `/api/haskback_status` — Check transaction status (implement as needed)
- `/api/haskback_callback` — Callback endpoint
