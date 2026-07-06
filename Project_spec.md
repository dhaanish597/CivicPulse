# CivicPulse — Complete Project Spec (v2)

**Read this entire file before writing any code.** This is the authoritative spec for
finishing the CivicPulse hackathon prototype (Google Cloud Gen AI Academy APAC 2026,
Track 2: Intelligent Applications — "AI for Better Living and Smarter Communities").

You are working inside an existing Bolt-generated repo. **Do not start over.** Reuse
`urgencyService.ts`, `forecastService.ts`, `hotspotService.ts` logic (the math is real
and correct) — the problems are: no shared backend data store, no map, no location
awareness, no visible agent orchestration, no roles, and no second intake channel.
Fix exactly those, in the priority order below.

---

## 0. What's actually wrong with the current build (read this first)

1. **Fake data** — `src/data/mockComplaints.ts` lives only in the browser, regenerates
   per session, uses invented ward names ("Hill View Colony") and coordinates centered
   on Bangalore (12.9716, 77.5946) despite the pitch being Hyderabad-flavored.
2. **No real map** — `WardDashboard.tsx` draws complaint "dots" as absolutely-positioned
   `<div>`s on a plain background. Not an actual map.
3. **No location-based answers** — there is no geolocation, no distance calculation,
   no "issues near me" anywhere in the app.
4. **Feels like a classification demo, not a platform** — the only visible AI is
   photo-in → category-out. There's no orchestration, no visible reasoning trail.
5. **"Agent" = one Gemini call** — `server/index.mjs` has two flat endpoints
   (`/api/classify`, `/api/chat`) that each make a single Gemini request. There is no
   tool use, no multi-step pipeline, nothing resembling the 6-agent architecture the
   pitch deck describes.
6. **No roles** — every screen is visible to everyone via a plain tab bar. No
   ward-scoped data, no citizen vs. officer vs. admin distinction.
7. **Fake/ungrounded locations** — same root cause as #1; coordinates don't correspond
   to any real place.

Everything below fixes these seven things, in priority order, with a hard 3-hour
budget. **P0 is non-negotiable. Do P0 completely before touching P1. If you're
running low on time inside a phase, simplify that phase's scope rather than
skipping ahead** — always leave the app in a working, buildable state between
every change.

---

## 1. Target architecture

```
┌─────────────┐   ┌──────────────┐
│  Web App    │   │ Telegram Bot │   (two intake/interaction channels)
│ (React/Vite)│   │  (Telegraf)  │
└──────┬──────┘   └──────┬───────┘
       │                 │
       └────────┬────────┘
                ▼
      ┌───────────────────┐
      │  Express API       │  server/index.mjs
      │  (single backend)  │
      └─────────┬──────────┘
                ▼
      ┌───────────────────────────┐
      │   Agent Orchestrator       │  server/agents/orchestrator.mjs
      │  Ingestion → Classify →    │
      │  Dedup → Hotspot →         │
      │  Forecast → Urgency →      │
      │  Recommendation            │
      └─────────┬──────────────────┘
                ▼
      ┌───────────────────┐        ┌──────────────────────┐
      │  SQLite (or        │◄──────►│ Conversational Agent  │
      │  Supabase if       │        │ (Gemini function-     │
      │  already configured)│        │  calling / tool use)  │
      └───────────────────┘        └──────────────────────┘
```

Both the web app and the Telegram bot call the **same** backend, write to the
**same** database, and go through the **same** agent pipeline. That shared backend
is what makes this "one platform, multiple channels" instead of "one app."

---

## 2. Data layer — do this first, everything else depends on it

**Decision rule:** check `.env` for `SUPABASE_URL` + a working `SUPABASE_ANON_KEY`/
`SUPABASE_SERVICE_ROLE_KEY`. If present *and* you can confirm connectivity, use
Supabase (Postgres) as the shared store. **Otherwise — and this is the expected
default — use `better-sqlite3`** with a single file `server/civicpulse.db`. Do NOT
attempt to create a new Supabase project or ask the user to; that's a manual
account-creation step outside your control. Default to SQLite unless the
credentials are already sitting there and working.

### Schema (SQLite or equivalent Postgres table)

```sql
CREATE TABLE complaints (
  id TEXT PRIMARY KEY,
  ward INTEGER NOT NULL,
  locality TEXT NOT NULL,
  category TEXT NOT NULL,
  severity INTEGER NOT NULL,
  reported_at TEXT NOT NULL,      -- ISO timestamp
  resolved INTEGER NOT NULL DEFAULT 0,
  days_open INTEGER NOT NULL DEFAULT 0,
  lat REAL NOT NULL,
  lng REAL NOT NULL,
  source TEXT NOT NULL,           -- 'Citizen App' | 'Telegram' | 'Call Center'
  description TEXT,
  reasoning TEXT                  -- Gemini's classification reasoning, if any
);

CREATE TABLE agent_traces (
  id TEXT PRIMARY KEY,
  complaint_id TEXT NOT NULL,
  step_name TEXT NOT NULL,        -- 'Ingestion', 'Classification', 'Dedup', etc.
  step_order INTEGER NOT NULL,
  detail TEXT NOT NULL,           -- short human-readable result of that step
  created_at TEXT NOT NULL
);
```

### Real Hyderabad locality table (use this instead of invented ward names)

Replace the fake `wardAddresses` map in `mockComplaints.ts` with this — these are
**approximate real coordinates** for well-known Hyderabad localities (good enough
for a demo map; note in code comments that they're approximate, not surveyed):

```
Ward 1  — Kukatpally        17.4849, 78.4138
Ward 2  — Miyapur            17.4969, 78.3822
Ward 3  — Kondapur            17.4615, 78.3639
Ward 4  — Madhapur / Hitec City  17.4483, 78.3915
Ward 5  — Gachibowli          17.4401, 78.3489
Ward 6  — Jubilee Hills        17.4326, 78.4071
Ward 7  — Banjara Hills        17.4156, 78.4347
Ward 8  — Ameerpet            17.4374, 78.4482
Ward 9  — Begumpet             17.4435, 78.4682
Ward 10 — Secunderabad         17.4399, 78.4983
Ward 11 — Tarnaka              17.4275, 78.5083
Ward 12 — Nallakunta           17.4020, 78.4912
Ward 13 — Kachiguda            17.3833, 78.4975
Ward 14 — Malakpet             17.3746, 78.5000
Ward 15 — Charminar            17.3616, 78.4747
Ward 16 — Mehdipatnam          17.3948, 78.4389
Ward 17 — Attapur              17.3654, 78.4276
Ward 18 — Dilsukhnagar         17.3687, 78.5247
Ward 19 — Uppal                17.4058, 78.5590
Ward 20 — LB Nagar             17.3457, 78.5518
```

Jitter individual complaints by up to ~600m around their ward's centroid (roughly
±0.005° lat/lng) so they don't all stack on one point on the map.

### Seed script

Write `server/seed.mjs`: generates ~300 synthetic complaints across the 20 localities
above (skew Ward 8/Ameerpet + "Garbage Overflow" as the standout hotspot, same
skew logic already in the old `mockComplaints.ts` — port the distribution logic,
just fix the coordinates/names and write rows into SQLite instead of a JS array).
Run automatically on first server start if the DB is empty.

### Backend endpoints to add/change

- `GET /api/complaints` — all complaints (used by web app instead of the static
  import; supports optional `?ward=`, `?resolved=`, `?since=` query params)
- `POST /api/complaints` — create a new complaint (used by both the web report
  form and the Telegram bot). Runs the full agent pipeline (see §4) before saving.
- `GET /api/hotspots`, `GET /api/forecast?ward=`, `GET /api/dispatch?ward=` — thin
  wrappers around the existing hotspot/forecast/urgency logic, now reading from
  the DB instead of a client-side array.
- `GET /api/nearby?lat=&lng=&radius_km=` — haversine-filtered open complaints
  near a point, sorted by distance. **This is the "issues near me" endpoint.**
- `POST /api/chat` — rewritten as a tool-calling agent (see §5), not a flat prompt.
- Keep `/api/classify` but call it from *inside* the agent pipeline (§4), not
  directly from the frontend anymore.

Update `src/services/*` to fetch from these endpoints (with `fetch('/api/...')`)
instead of importing the static mock array. Keep the same function names/shapes
where reasonable so components don't need heavy rewrites.

---

## 3. Real map (P0)

Add `leaflet` + `react-leaflet` (no API key needed — use OpenStreetMap tiles,
tile URL `https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png`, attribution required
per OSM usage policy — include the standard attribution string).

Build `src/components/MapView.tsx`:
- Centered on Hyderabad (17.3850, 78.4867), zoom ~11
- One marker per open complaint, colored by category (reuse the existing
  `categoryColors` map), sized/pulsing by severity
- Circle overlays per ward showing approximate hotspot intensity (radius/opacity
  scaled by 30-day complaint count for that ward — this is a legitimate way to
  show "ward boundaries" without needing real GHMC GIS polygon data)
- Marker click → popup with category, severity, days open, locality name
- Replace the fake dot-grid in `WardDashboard.tsx` with this component
- Also embed a smaller version (or the same component, different props) on the
  City Admin view showing all wards at once

---

## 4. Agent orchestration (P0 — this is the single most important fix)

Create `server/agents/`:

- `orchestrator.mjs` — exported `runPipeline(complaintInput)` that runs these
  steps **in order**, writes a row to `agent_traces` after each step, and
  returns the final saved complaint + full trace array:
  1. **IngestionAgent** (`ingestionAgent.mjs`) — validates the input (has
     photo or text, has coordinates or locality), normalizes it into the
     complaint shape. Pure logic, no API call.
  2. **ClassificationAgent** (`classificationAgent.mjs`) — calls Gemini
     multimodal (existing `/api/classify` logic, moved here) → category +
     severity + reasoning.
  3. **DeduplicationAgent** (`dedupAgent.mjs`) — real logic: query DB for
     open complaints of the same category within ~150m (haversine) and
     within the last 3 days; if found, mark as a likely duplicate and link
     to the existing complaint id instead of creating a new row (still log
     the trace step either way).
  4. **HotspotAgent** — wraps existing `hotspotService` logic against the DB.
  5. **ForecastAgent** — wraps existing `forecastService` logic.
  6. **UrgencyAgent** — wraps existing `urgencyService` logic, scores the new
     complaint against current recurrence counts.
  7. **RecommendationAgent** (`recommendationAgent.mjs`) — given hotspot +
     forecast + urgency output, produce one short actionable recommendation
     string (e.g. "Ward 8 (Ameerpet) is trending 40% above baseline for
     Garbage Overflow — recommend an extra collection run this week"). Simple
     rule-based logic is fine; a short Gemini call for nicer phrasing is a
     bonus if time allows.

- `tools.mjs` — the tool/function definitions exposed to the conversational
  agent (see §5).
- `conversationalAgent.mjs` — the chat endpoint's brain (see §5).

**Frontend: `src/components/AgentActivityPanel.tsx`** — after a citizen submits
a report, show a live-updating vertical timeline of the trace steps as they
come back (`Ingestion ✓ → Classification ✓ (Garbage Overflow, sev 4) → Dedup ✓
(no duplicate found) → Hotspot ✓ → Forecast ✓ → Urgency ✓ (score 47) →
Recommendation ✓`). This is the single highest-impact UI addition — it's what
visually proves "an agent pipeline is running," not just a classifier. Show
this panel on the Report Issue screen right after submit, and make each trace
row expandable to show its `detail` text.

---

## 5. Conversational agent with real tool use (P0)

Replace the current "stuff a JSON summary into one Gemini prompt" chat with a
**real tool-calling loop**, using Gemini's function calling / tools API.

Tools to expose (implement each as a real function against the DB):

```
get_nearby_issues({ lat, lng, radius_km })  -> nearby open complaints + distance
get_ward_summary({ ward })                  -> counts by category, avg severity
get_hotspots({ limit })                     -> top citywide hotspots
get_forecast({ ward })                      -> 7-day forecast for a ward
get_dispatch_list({ ward, limit })          -> urgency-ranked open complaints
```

Backend loop (`conversationalAgent.mjs`):
1. Send the user's question + tool definitions + (if provided) the user's
   current lat/lng to Gemini.
2. If Gemini responds with a function call, execute the matching real
   function against SQLite, send the result back to Gemini as a function
   response.
3. Repeat until Gemini returns a final natural-language answer (cap at ~4
   tool-call round trips to avoid runaway loops).
4. Return the final answer **and** the list of tools that were actually
   invoked, so the frontend can show "used: get_nearby_issues, get_ward_summary"
   as a small transparency line under the chat answer — reinforces that this
   is a real agent, not a canned response.

This directly answers "what are the issues near me" for the first time: if the
frontend has the user's location (via the browser Geolocation API, see §6) and
passes it along with the chat question, the model can call `get_nearby_issues`
with those real coordinates.

Update `src/services/chatService.ts` to send `{ question, lat, lng }` to
`/api/chat` instead of a full complaint summary blob.

---

## 6. "Issues near me" — citizen-facing location feature (P0)

On the **citizen (Report Issue) view**, add a `NearMePanel.tsx`:
- Button: "Show issues near me" → requests `navigator.geolocation.getCurrentPosition`
- On success, calls `GET /api/nearby?lat=&lng=&radius_km=2`
- Renders a short list: category, distance (e.g. "310m away"), days open,
  status — sorted nearest-first
- Graceful fallback if geolocation is denied: let the user pick their locality
  from a dropdown (use the same 20 localities from §2) instead of raw coordinates
- Also make sure the chat (§5) can answer "what issues are near me" using the
  same geolocation value if the user grants permission before asking

---

## 7. Roles (P0)

Add a landing screen (`src/components/RoleSelect.tsx`) shown before the tab bar:
- Three cards: **Citizen**, **Ward Officer**, **City Admin**
- Citizen → name only, goes straight to Report Issue + Near Me
- Ward Officer → must also pick their ward (dropdown of the 20 localities) —
  their dashboard is **scoped to only that ward's data**, not all 20
- City Admin → sees all wards, cross-ward comparisons, no ward picker
- Store the role (+ ward, if officer) in React context; gate which tabs are
  visible per role (citizen never sees the officer dispatch list or admin KPIs;
  officer never sees other wards' dispatch lists; admin sees everything)
- No real authentication needed (no passwords) — this is a role **simulation**
  for demo purposes, be upfront about that if asked, but the **data scoping
  must be real** (an officer's dashboard should actually filter by their ward
  server-side via the `?ward=` query param, not just hide UI elements)

---

## 8. Telegram bot — second intake channel (P1, do after P0 is solid)

Use `telegraf` (`npm install telegraf`). Create `server/telegramBot.mjs`:
- Bot commands: `/start` (welcome + instructions), and accept any photo message
  (with optional caption as the text note) as a new complaint
- On receiving a photo: download it, base64-encode, POST it through the exact
  same `runPipeline()` orchestrator used by the web app (source = `'Telegram'`)
  — do not duplicate classification logic, reuse the same pipeline
- Reply to the user in Telegram with the classification result + a one-line
  "Report #CMP-XXXX logged, thank you" confirmation
- Ask the user for their location (Telegram supports a native location-share
  button — use it if straightforward; otherwise fall back to asking them to
  reply with a locality name from the 20-locality list)
- Start the bot's polling **only if `TELEGRAM_BOT_TOKEN` is present in `.env`**
  — if it's missing, log a clear one-line warning and continue running the web
  server normally (never crash the whole app because the bot token is absent)

**Why Telegram and not WhatsApp:** WhatsApp Business API requires Meta app
review / business verification that will not complete inside a 3-hour window.
Telegram bot tokens are instant (via @BotFather, no approval). Frame this
explicitly in the README/video: "WhatsApp is the target production channel per
the architecture slide; this prototype demonstrates the same multi-channel
ingestion pattern via Telegram, which supports the same instant developer
setup this hackathon timeline requires."

---

## 9. Non-negotiables

- **Never break the build.** After every phase, run `npm run typecheck` and
  `npm run build`. Fix errors before moving to the next phase.
- **Never expose `GEMINI_API_KEY` or `TELEGRAM_BOT_TOKEN` to the client.** Both
  only ever live in `server/` and are read from `process.env`.
- **Never fabricate data as if it were live/real-world** — synthetic seed data
  is fine and expected (there's no real open dataset for this), but say so
  plainly in the README, exactly like the pitch deck already does.
- **Don't silently stub things.** If something in this spec turns out to be
  genuinely infeasible in the time remaining, say so directly instead of
  quietly leaving a fake/mock version in place and calling it done.
- Keep committing to git in small logical chunks as you go (if you have git
  access in this environment) so progress isn't lost if the session ends.

---

## 10. Definition of done checklist

- [ ] SQLite (or Supabase, if already configured) shared data store live; both
      web app and Telegram bot read/write the same store
- [ ] 20 real Hyderabad localities with approximate real coordinates replace
      all fake ward names/addresses
- [ ] Real Leaflet + OpenStreetMap map showing complaint markers + ward hotspot
      circles, on both Ward Dashboard and City Admin
- [ ] `GET /api/nearby` implemented; "Show issues near me" panel works via
      browser geolocation with a manual-locality fallback
- [ ] Full 7-step agent pipeline (`orchestrator.mjs`) runs on every new
      complaint from both channels, with an `agent_traces` row per step
- [ ] `AgentActivityPanel` visibly shows the live agent trace after a citizen
      submits a report
- [ ] Conversational agent uses real Gemini function-calling with the 5 tools
      in §5, and can correctly answer a genuine "what issues are near me"
      question when given coordinates
- [ ] Role select screen gates Citizen / Ward Officer (ward-scoped) / City
      Admin (all-ward) views, with real server-side data scoping for officers
- [ ] Telegram bot accepts a photo report, runs it through the same pipeline,
      and replies with the classification — end to end, tested at least once
- [ ] `npm run build` and `npm run typecheck` both pass cleanly
- [ ] README updated to describe what's real vs. simulated, and how to run
      both the web app and the Telegram bot locally