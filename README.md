# CivicPulse

CivicPulse is a hackathon prototype for Hyderabad civic operations intelligence, built for Google Cloud Gen AI Academy APAC 2026, Track 2: Intelligent Applications. Citizens can report issues, ward officers see ward-scoped dispatch data, and city admins monitor cross-ward hotspots, forecasts, and resource pressure.

## What Is Real In This Prototype

- Shared backend store: Express uses SQLite at `server/civicpulse.db`, seeded on first start with synthetic complaints across 20 approximate Hyderabad locality centroids.
- Live NVIDIA AI: complaint classification runs in the server-side 7-step agent pipeline, and dashboard chat uses NVIDIA function calling with real backend tools.
- Agent pipeline: new complaints run through Ingestion, Classification, Dedup, Hotspot, Forecast, Urgency, and Recommendation agents, with trace rows stored in `agent_traces`.
- Real map: Leaflet + OpenStreetMap tiles show open complaint markers and 30-day ward hotspot circles.
- Location awareness: the citizen view can use browser geolocation or a manual locality fallback to show open issues within 2 km.
- Role simulation: Citizen, Ward Officer, and City Admin views are gated; ward officers load data with `GET /api/complaints?ward=`.
- Telegram intake: when `TELEGRAM_BOT_TOKEN` is set, the bot accepts location/locality plus photo reports and sends them through the same pipeline.

## What Is Simulated For Demo

The complaint dataset is synthetic seed data, not a live government feed. BigQuery, ADK-style production orchestration, RAPIDS acceleration, Looker dashboards, and WhatsApp Business intake are the intended production architecture. This prototype demonstrates the same multi-channel ingestion pattern with Telegram because Telegram bot tokens are instant, while WhatsApp Business API approval usually requires Meta review and business verification.

## Split Deployment Architecture

This project is deployed across two hosts:
- **Vercel**: Hosts ONLY the Vite/React frontend (static build).
- **Render**: Hosts the Express backend (`server/index.mjs`), the agent orchestrator, and the Telegram bot as a persistent Node web service.

**Required Environment Variables (Render)**:
- `NVIDIA_API_KEY`: The API key for classification and chat.
- `TELEGRAM_BOT_TOKEN`: (Optional) The bot token for Telegram intake.
- `ALLOWED_ORIGIN`: The Vercel frontend URL to allow CORS (e.g., `https://your-frontend.vercel.app`).
- `NODE_ENV`: Should be set to `production`.

**Required Environment Variables (Vercel)**:
- `VITE_API_BASE_URL`: The Render backend URL (e.g., `https://civicpulse-backend.onrender.com`).

**Known Limitation for Production**: 
1. The Smart Route Advisor uses a public, shared OSRM demo server (router.project-osrm.org) to generate route geometries. This is acceptable for a hackathon demo but is a known limitation for a production version. A real deployment would use a dedicated routing engine or enterprise API.
2. The SQLite database uses a local file (`server/civicpulse.db`). On Render's free tier or standard deployment without a persistent disk, this data will reset on every redeploy. The app automatically reseeds synthetic demo data on start if the database is empty, making this acceptable for demo purposes.

## Local Setup

1. Install dependencies:

```bash
npm install
```

2. Create `.env` in the project root:

```bash
NVIDIA_API_KEY=your_nvidia_key
TELEGRAM_BOT_TOKEN=your_optional_telegram_bot_token
```

Get a NVIDIA API key from build.nvidia.com. Create a Telegram bot token with Telegram's `@BotFather`.

3. Start the web app, Express API, SQLite seed, and optional Telegram bot:

```bash
npm run dev
```

The app is served from the Express/Vite server, usually `http://localhost:5173`.

## Useful Commands

- `npm run dev` starts Express, Vite middleware, SQLite seed-on-empty, and Telegram polling when configured.
- `npm run typecheck` runs TypeScript checks for the frontend.
- `npm run build` builds the frontend.
- `npm run lint` runs ESLint.

## Notes

- `NVIDIA_API_KEY` and `TELEGRAM_BOT_TOKEN` are read only from server-side code and are not exposed to the client bundle.
- `.env` is ignored by git.
- The SQLite file is generated locally; deleting `server/civicpulse.db` lets the app reseed synthetic demo data on next startup.
