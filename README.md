# CivicPulse

CivicPulse is a hackathon prototype for municipal civic operations intelligence. It lets citizens report civic issues with a photo or note, helps classify the report, and gives ward administrators a dashboard for hotspots, urgency, and short-term complaint trends.

This repo was built for the Google Cloud Gen AI Academy APAC 2026 hackathon.

## What Is Live AI

- Gemini complaint classification: the report flow sends an uploaded image and optional note to the local backend endpoint `POST /api/classify`, which calls Gemini and returns `{ category, severity, reasoning }`.
- Gemini dashboard chat: the ward dashboard sends a compact aggregate summary of the complaint dataset to `POST /api/chat`, then Gemini answers grounded in that summary.

The Gemini API key is read only by the Express backend from `process.env.GEMINI_API_KEY`. It is never sent to the browser or bundled into the Vite frontend.

## What Is Simulated For Demo

The current dataset is generated locally in `src/data/mockComplaints.ts`. The dashboard calculations for urgency, forecasts, and hotspots are real client-side calculations over that demo dataset.

The intended production architecture is simulated in this repo: BigQuery for city-scale complaint storage and analytics, ADK-style agent orchestration, RAPIDS acceleration for heavy geospatial or forecasting workloads, and Looker dashboards for operational reporting.

## Local Setup

1. Clone the repo.
2. Install dependencies:

```bash
npm install
```

3. Create `.env` in the project root and add your Gemini key:

```bash
GEMINI_API_KEY=your_key_here
```

Get a key from https://aistudio.google.com/apikey.

4. Start the local app and API server:

```bash
npm run dev
```

The Express server runs Vite in middleware mode, so the frontend and API are served from the same local origin, usually `http://localhost:5173`.

## Scripts

- `npm run dev` starts the Express API server and Vite dev middleware.
- `npm run build` builds the frontend.
- `npm run lint` runs ESLint.
- `npm run typecheck` runs TypeScript checks for the frontend app.
