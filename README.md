# CivicPulse

> **CivicPulse is the closure-verification layer GHMC said it needed and never built.**
>
> A civic complaint system's real failure mode is not intake — GHMC already has four
> intake channels. It is that "resolved" is an unverified claim made by the same
> person accountable for resolving it. CivicPulse makes closure evidence-based:
> the citizen's camera is the auditor, and an AI agent adjudicates.

## The Problem

These are sourced, verifiable facts about GHMC's grievance system. **These are the
only real-world numbers used anywhere in this codebase — nothing here is invented,
rounded, or embellished.**

| Fact | Source |
|---|---|
| ~600 new grievances registered **per day** in GHMC's Centralised Grievance Redressal System (CGRS), via call centre, MyGHMC app, and representations at HQ/circle/zonal offices | Deccan Chronicle, "GHMC body's redressal mechanism appalling" |
| 74,112 GHMC-related complaints registered on the Prajavani portal between January 2024 and January 2026; ~600 still pending; 1,000+ stuck in ambiguous status categories | RTI disclosure by GHMC PIO, 22 Jan 2026 (filed by RTI activist Kareem Ansari), reported by HyderabadMail |
| Officials were found **marking complaints closed without attending to them**, to impress higher authorities. 170 officials were served show-cause notices after one internal study | Deccan Chronicle |
| A senior GHMC official (anonymous): of every 1,000 grievances received, ~800 are closed as "resolved" without the issue being attended to | Deccan Chronicle |
| GHMC decided to implement a **third-party verification system** to confirm complaints were actually resolved. **Those plans were never implemented.** | Deccan Chronicle |
| GHMC spans 650 sq km, 6 zones, 30 circles, 150 wards (increased to 300 wards after the 2025 delimitation) | GHMC official circles document / Wikipedia, Administrative divisions of Hyderabad |

The ward/zone/circle reference data loaded in this build (`server/data/ghmc_wards.json`)
comes from a real, official GHMC spreadsheet, but it reflects that document's older
(2007-era) administrative structure — 5 zones and 18 circles — rather than the current
6-zone/30-circle structure named in the table above; both are real, they simply describe
GHMC's structure at different points in time, and this build did not attempt to reconcile
them.

Built for Google Cloud Gen AI Academy APAC 2026, Track 2: Intelligent Applications.

## What Is Real In This Prototype

- Shared backend store: Express uses SQLite at `server/civicpulse.db`, seeded on first start with synthetic complaints distributed across the real GHMC zone/circle/ward hierarchy (`server/data/ghmc_wards.json`) when present, or a 20-locality fallback with a loud console warning otherwise.
- Live NVIDIA AI: complaint classification runs in the server-side 7-step agent pipeline, and dashboard chat uses NVIDIA function calling with real backend tools.
- Agent pipeline: new complaints run through Ingestion, Classification, Dedup, Hotspot, Forecast, Urgency, and Recommendation agents, with trace rows stored in `agent_traces`.
- Real map: Leaflet + OpenStreetMap tiles show open complaint markers and 30-day ward hotspot circles.
- Location awareness: the citizen view can use browser geolocation or a manual locality fallback to show open issues within 2 km.
- Role simulation: Citizen, Ward Officer, and City Admin views are gated; a Ward Officer is assigned a real GHMC circle (the operational unit, headed by a Deputy Commissioner) and loads data with `GET /api/complaints?circle=`, enforced server-side.
- Telegram intake: when `TELEGRAM_BOT_TOKEN` is set, the bot accepts location/locality plus photo reports and sends them through the same pipeline.

## What Is Simulated For Demo

The complaint dataset is synthetic seed data, not a live government feed. BigQuery, ADK-style production orchestration, RAPIDS acceleration, Looker dashboards, and WhatsApp Business intake are the intended production architecture. This prototype demonstrates the same multi-channel ingestion pattern with Telegram because Telegram bot tokens are instant, while WhatsApp Business API approval usually requires Meta review and business verification.

**The problem statement above is sourced, real reporting. The demo data populating this prototype (complaints, ward activity, resolution history) is synthetic — do not confuse the two.**

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
- The seed calibrates volume to the real ~600 complaints/day figure above (30 days ≈ 18,000 rows, seeded in ~2.3s locally). Set `SEED_RATE_PER_DAY` to a smaller number (e.g. `100`) to reseed at a reduced, clearly-labelled rate if needed for a slower machine.
