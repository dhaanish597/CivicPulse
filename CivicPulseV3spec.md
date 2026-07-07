# CivicPulse — v3 Spec Addendum (UI Overhaul, NVIDIA Migration, New Agentic Features)

**Read `PROJECT_SPEC.md` (v2) first if it's still in the repo — this document assumes
everything in it is already built and working.** Verified against the actual
repo: SQLite store, seed data across the 20 real localities, Leaflet map,
7-step orchestrator (`server/agents/`), Gemini-based classification +
tool-calling chat, role select with server-side ward scoping, and the Telegram
bot are all present and functional. **Do not re-architect any of that.** This
document is three additive changes on top of it, in priority order. Same rule
as v2 applies: never leave the app in a broken/non-building state between
changes, run `npm run typecheck` and `npm run build` after every phase.

---

## 0. Why this version exists

Judges will see three things in the first 90 seconds: how it looks, whether
the "AI" is doing something beyond a single classify call, and whether it
solves a problem a real city resident would recognize. v2 fixed the
architecture (real backend, real map, real orchestration, real tool-calling
chat) but the surface still reads as "photo → category classifier with a
map bolted on." v3 closes that gap:

1. **UI** — currently a competent but generic teal/navy dashboard. Needs a
   deliberate, consistent visual identity across every screen.
2. **Gemini → NVIDIA** — `GEMINI_API_KEY` now requires prepaid billing on
   Google's side, which is a blocker with no manual workaround available in
   the time remaining. Move both the classifier and the tool-calling chat to
   NVIDIA's free hosted API at build.nvidia.com.
3. **New agentic use cases** — add two real, end-to-end workflows that show
   the agents doing something with real-world consequence, not just labeling
   photos: (a) a citizen can **track** what happens to their report and see
   the AI hand a **lead** to the ward officer, and (b) a citizen can **plan a
   route** and get **rerouted** around active hotspots.

---

## 1. UI/UX overhaul (P0)

**Use the `ui-ux-pro-max` skill** (and the `frontend-design` skill for
styling primitives) before touching any component. Read both before writing
CSS or JSX.

This is a **restyle + consistency pass**, not a data-layer rewrite. Leaflet,
the map data pipeline, the agent trace, and all API contracts stay exactly as
they are — only presentation, layout, and motion change.

### The core problem
Right now the visual identity (teal `#0E5C56` / navy `#1F3A5F` / amber / coral,
Inter font, flat cards) is competent but interchangeable with any AI-dashboard
template. Nothing about it says "Hyderabad municipal command center" or
"agentic platform" specifically. Fix that by picking **one** distinctive
direction and applying it with zero exceptions across Role Select, Report
Issue, Ward Dashboard, City Admin, the chat panel, and the two new screens in
§3. A patchwork of "the new components look great, the old ones didn't get
touched" is a worse outcome than a consistent, slightly less flashy pass
everywhere.

Pick one (or synthesize a variant), then commit to it everywhere:

- **"Municipal Command Center"** — dark, data-dense, map-first. Monospace or
  tabular-figure treatment for stat numbers (ward IDs, severity scores, days
  open), glass/blur KPI cards over the map, a subdued grid backdrop. Signals
  "operations room," which fits the multi-agent narrative well.
- **"Civic Trust"** — refine rather than replace the existing teal/terracotta
  palette: generous whitespace, a distinctive serif/sans pairing for
  headlines vs. data, warm editorial tone. Signals "government service done
  right," which fits the "for citizens" narrative.
- **Bento-grid modern**, but with one strong idiosyncratic signature element
  so it doesn't read as generic SaaS — e.g. a custom illustrated marker style
  per category (not default Leaflet pins), a distinctive reveal animation on
  `AgentActivityPanel` steps firing in sequence, or hand-tuned illustrations
  for empty states.

Whichever direction: the agent trace (`AgentActivityPanel`) and the new
route-risk visualization (§3.2) are the two highest-leverage places to invest
polish, since they're what actually differentiates "agentic platform" from
"CRUD app with a map." A live, visually satisfying step-by-step reveal there
matters more than icon-perfect KPI cards.

### Concrete asks
- Consistent spacing/typography scale and one accent-color logic (not four
  competing brights) applied everywhere, including inside Leaflet popups.
- Replace default Leaflet pin markers with the category-colored custom
  markers if not already fully polished — this is a cheap, high-visibility win.
- Add motion: the `AgentActivityPanel` trace steps should reveal sequentially
  as they arrive (not pop in all at once), and status changes in the new
  Officer Leads Board (§3.1) should animate on transition.
- Empty/loading states for every new panel (route planner before a search,
  tracker before any reports exist) — don't ship components that only look
  good with data.
- Mobile-usable at minimum for the citizen-facing screens (Report Issue,
  Near Me, Track My Reports, Route Planner) — judges may view on a phone.

---

## 2. Gemini → NVIDIA API migration (P0)

### Why
`GEMINI_API_KEY` generation now requires a billing-enabled Google Cloud
project; there is no free path left inside the remaining build window.
NVIDIA's hosted catalog at **build.nvidia.com** is free (NVIDIA Developer
Program signup, no credit card), OpenAI-compatible, and covers both jobs this
app needs from an LLM: multimodal classification and tool-calling chat.

### What to keep unchanged
The rest of the pipeline must not care which provider is behind it:
- `classifyWithGemini(...)` → rename to `classifyImage(...)` (or keep the
  name if less churn) but **keep the exact same return shape**:
  `{ category, severity, reasoning }`. Every caller in
  `server/agents/classificationAgent.mjs` stays as-is.
- `answerWithTools({ question, lat, lng })` → **keep the exact same return
  shape**: `{ answer, toolsUsed }`. `server/index.mjs` and
  `src/services/chatService.ts` stay as-is.

### New module: `server/nvidia.mjs` (replaces `server/gemini.mjs`)
- Base URL: `https://integrate.api.nvidia.com/v1/chat/completions`
  (OpenAI-compatible request/response shape — standard `messages` array,
  standard `tools`/`tool_calls`, standard streaming/non-streaming).
- Auth: `Authorization: Bearer ${process.env.NVIDIA_API_KEY}` header (not
  the `x-goog-api-key` header the Gemini module used).
- Env var rename: `GEMINI_API_KEY` → `NVIDIA_API_KEY` in `.env`, `.env.example`,
  and every `process.env` read.

**Model selection — verify against `build.nvidia.com/models` before wiring
in, since the catalog changes; substitute the closest current equivalent
(same capability tier) if a listed model has been renamed or retired:**

| Job | Recommended default model | Needs |
|---|---|---|
| Photo classification (vision) | `meta/llama-3.2-11b-vision-instruct` | Accepts image input, decent JSON-following |
| Conversational agent tool-calling | `meta/llama-3.1-70b-instruct` (or `nvidia/llama-3.3-nemotron-super-49b-v1.5` as an alternative) | Confirmed OpenAI-format function/tool calling |

Both are confirmed reachable via the standard `/v1/chat/completions` endpoint
with an `nvapi-...` key. Free tier is rate-limited (roughly 40 requests/min)
rather than metered by a hard credit wall for most models — add basic retry
with backoff around NVIDIA calls, since a 429 mid-demo is worse than a
one-second retry.

### Format changes to make

**Image input** (classification): OpenAI-compatible vision format —
```js
messages: [{
  role: 'user',
  content: [
    { type: 'text', text: buildClassificationPrompt(textNote) },
    { type: 'image_url', image_url: { url: `data:${mimeType};base64,${data}` } },
  ],
}]
```
Verify this exact shape against the model's page on `docs.api.nvidia.com`
before assuming — some NIM-hosted vision models expect this OpenAI form,
a few older ones expect an embedded `<img>` tag in the text content instead.
Test with one real photo before wiring it into the pipeline.

**Structured JSON output**: NVIDIA's OpenAI-compatible endpoint supports
`response_format: { type: 'json_object' }` on most instruct models, but
**not** all models honor a strict schema the way Gemini's `response_schema`
did. Keep the existing defensive pattern already in `gemini.mjs`
(`stripCodeFence`, `validateClassification`) — prompt for JSON-only output,
strip code fences, validate the parsed shape, and **retry once** with a
stricter "return ONLY the JSON object, no prose" follow-up message if
validation fails on the first attempt, before throwing.

**Tool/function calling**: standard OpenAI `tools` array (`type: "function"`,
`function: { name, description, parameters }`) and `tool_choice: "auto"`.
Response comes back as `message.tool_calls` (array of `{id, function: {name,
arguments}}`, arguments as a **JSON string** you must `JSON.parse`, unlike
Gemini's already-parsed `args` object). Tool results go back as a message
with `role: "tool"`, `tool_call_id`, and `content` (stringified result) —
this is a real structural difference from Gemini's `role: "function"` shape,
not just a rename; rewrite `conversationalAgent.mjs`'s loop around it rather
than patching field names.

### Non-negotiable for this section
- Don't leave both `gemini.mjs` and `nvidia.mjs` in the repo as dead code —
  delete the old one once the new one is verified working end to end
  (classification on a real photo, and at least one chat question that
  triggers a tool call).
- Update `.env.example`, `README.md`, and any comments referencing Gemini.

---

## 3. New real-world agentic features

Both features below reuse existing services (`hotspotService`,
`forecastService`, `urgencyService`, the orchestrator, `tools.mjs`) — they
are new *workflows* wrapped around agents that already exist, not a second
platform bolted on.

### 3.1 Issue Tracking & AI Resolution Leads (P0)

**The problem this solves:** right now a citizen submits a report, watches
the trace animate once, and then the report vanishes from their view forever.
There's no sense of an agent *doing* anything beyond classifying. This
closes the loop: the citizen can check back on their report, and the ward
officer sees the AI actively generating and updating a prioritized "lead"
rather than a static dispatch list.

**Schema changes** (`server/db.mjs`, run as a migration guarded by
`PRAGMA table_info` checks so it's safe on restart against an existing DB):
```sql
ALTER TABLE complaints ADD COLUMN status TEXT NOT NULL DEFAULT 'reported';
-- values: 'reported' | 'acknowledged' | 'in_progress' | 'resolved'
ALTER TABLE complaints ADD COLUMN lead TEXT;
ALTER TABLE complaints ADD COLUMN status_updated_at TEXT;

CREATE TABLE status_events (
  id TEXT PRIMARY KEY,
  complaint_id TEXT NOT NULL,
  status TEXT NOT NULL,
  note TEXT,
  actor TEXT NOT NULL,        -- 'agent' | 'officer'
  created_at TEXT NOT NULL
);
```
Backfill existing rows: `status = 'resolved'` where `resolved = 1`, else
`'reported'`.

**New agent: `server/agents/resolutionAgent.mjs`**
- Called once at the end of `runPipeline()` (writes the initial `reported`
  status_event and a first-pass `lead` string — this can reuse
  `recommendationAgent`'s output, just persisted instead of shown once).
- Called again whenever status moves to `in_progress`: regenerate the lead
  with fresh context (current recurrence count in that ward/category,
  days_open, hotspot rank) — one short NVIDIA call, e.g. *"3 similar Garbage
  Overflow reports within 200m in the last 5 days — treat as a cluster, flag
  to Ward 8 sanitation as a single high-priority route stop rather than three
  separate pickups."* Rule-based fallback text if the call fails — never
  block a status change on the LLM being reachable.

**New endpoints** (`server/index.mjs`):
- `PATCH /api/complaints/:id/status` — body `{ status, note }`. Appends a
  `status_events` row, updates `complaints.status` /
  `status_updated_at` / legacy `resolved` bool, re-runs `resolutionAgent`
  when appropriate.
- `GET /api/complaints/:id` — single complaint + full `status_events`
  timeline + current `lead`. Used by both the citizen tracker and the
  officer detail view.

**New tool** (`server/agents/tools.mjs`): `get_report_status({ complaint_id
})` so the conversational agent can answer "what's happening with report
CMP-1234?" directly in chat, not just through the dedicated screen.

**Frontend:**
- `src/components/TrackMyReports.tsx` (Citizen role). On successful submit
  in `ReportIssue.tsx`, store `{ id, locality, category, submittedAt }` in
  `localStorage` (key `civicpulse_my_reports` — this is a real browser app,
  not a sandboxed artifact, so `localStorage` is the right call here since
  there's no auth system to key reports to a user otherwise). List each
  report with a status pill, the current AI lead text, and a simple
  timeline (reported → acknowledged → in progress → resolved). A manual
  refresh button is sufficient; don't build a polling system for a hackathon
  demo.
- `src/components/OfficerLeadsBoard.tsx` (Ward Officer role) — replaces the
  read-only dispatch list with actionable cards: complaint summary + current
  AI lead + buttons (`Acknowledge` → `Start Work` → `Resolve`) that call the
  PATCH endpoint. This is what makes the officer role feel like it's using
  the agent, not just viewing its output.
- Extend `AgentActivityPanel.tsx` to also render the persisted
  `status_events` after the initial live trace, so returning to a report
  later still shows the full story.

### 3.2 Smart Route Advisor (P0)

**The problem this solves:** directly the "planning a trip, see the route,
get rerouted if it's bad" use case — and it's the single most visibly
"agentic" feature to add, since it chains a real external tool call
(routing), spatial reasoning against live complaint data, and an LLM
judgment call in one user-facing action.

**Routing data source:** the public OSRM demo server —
`https://router.project-osrm.org/route/v1/driving/{lng1},{lat1};{lng2},{lat2}?overview=full&geometries=geojson&alternatives=true`
— free, no API key, returns real road-network routes as GeoJSON. **This is a
shared community demo server (FOSSGIS), not a production API**: cap client
calls to roughly one per second, never call it in a loop, and say so in the
README. If it's unreachable (blocked network, demo-day wifi, server
downtime), fail gracefully — show a clear "routing service unavailable"
message and fall back to a straight-line distance estimate. Never fabricate
a route.

**New file: `server/routing.mjs`** — thin fetch wrapper around the above,
returns `{ points: [[lat,lng], ...], alternatives: [...] }` or throws a
typed error the caller can catch for the fallback path.

**New agent: `server/agents/routeAgent.mjs`**
Given origin and destination (lat/lng, resolved from either browser
geolocation or a locality picker):
1. Call `routing.mjs` for the route geometry and any alternatives.
2. Buffer the route polyline (~250m) and query the DB for open complaints
   within that buffer, weighting severity ≥4 and categories that plausibly
   block travel (waterlogging, road damage, fallen trees, etc.) more
   heavily; also check whether the route crosses any of the current
   citywide top-5 hotspot wards (reuse `hotspotService`).
3. If exposure is high, make **one** NVIDIA call with that structured
   summary asking for a 1–2 sentence plain-language advisory, and — if
   OSRM returned alternatives — which alternative index looks cleanest by
   the same exposure check (compute the check for each alternative
   server-side; ask the LLM to phrase the recommendation, not to pick blind).
4. Return `{ route, riskScore, flaggedComplaints, advisory,
   alternativeRouteIndex? }`.

**New endpoint:** `POST /api/route-check` — body `{ originLat, originLng,
destLat, destLng }`.

**New tool** (`tools.mjs`): `check_route({ origin, destination })` — accepts
locality names or coordinates, so a citizen can type "I'm heading from
Gachibowli to Secunderabad, is my route OK?" directly in chat.

**Frontend: `src/components/RoutePlanner.tsx`** (Citizen role) — origin
(locality dropdown or "use my location") + destination locality dropdown +
"Check my route" button. Draws the route on a `MapView` instance colored by
`riskScore` (green/amber/red), drops markers on flagged complaints along the
path, shows the advisory text, and a one-tap "show alternative route" button
when one was offered.

### 3.3 Neighborhood Digest (P1 — only if time remains after 3.1 and 3.2)

Small card in `NearMePanel`: *"This week in {locality}"* — a 2–3 sentence
LLM-phrased summary of trend direction + top category, built entirely from
data `forecastAgent` and `hotspotService` already compute. Cache the
generated text server-side per locality (an in-memory map keyed by locality
+ hour is enough) so it isn't re-generated on every render — this is a
cheap, low-risk addition, do it last.

---

## 4. Non-negotiables

- **Never break the build.** Run `npm run typecheck` and `npm run build`
  after every phase in this document, same as v2.
- **Never expose `NVIDIA_API_KEY` or `TELEGRAM_BOT_TOKEN` to the client** —
  server-only, read from `process.env`, same as v2's rule for Gemini.
- **Respect the OSRM demo server's usage policy** — reasonable request rate,
  no hammering it in loops or polling; note this plainly in the README as an
  explicit "known limitation for a production version" alongside the
  synthetic-data disclosure v2 already requires.
- **Preserve existing contracts.** `classifyImage(...)`'s and
  `answerWithTools(...)`'s return shapes must not change, so nothing
  downstream of them needs to churn beyond what's specified above.
- **Don't silently stub.** If a recommended NVIDIA model turns out not to
  reliably support vision or tool calling in testing, say so directly, pick
  the closest working substitute from the catalog, and note the substitution
  in the README — don't fake it with a hardcoded response.
- **The UI pass is additive/restyling only.** Every existing feature (map,
  near-me, chat, Telegram bot, role scoping) must still work exactly as
  before after the visual pass — this is not a rewrite of data flow or
  component structure, just presentation and layout.
- Keep committing in small logical chunks if git access is available.

---

## 5. Definition of done checklist

- [ ] One consistent visual direction applied across every screen, including
      the two new ones — no patchwork of "new components look great, old
      ones didn't get touched"
- [ ] `AgentActivityPanel` trace steps reveal sequentially, not all at once
- [ ] `server/nvidia.mjs` fully replaces `server/gemini.mjs`; `gemini.mjs`
      deleted once verified; `GEMINI_API_KEY` fully replaced by
      `NVIDIA_API_KEY` in code, `.env.example`, and README
- [ ] Photo classification verified working end-to-end on a real uploaded
      photo through the new NVIDIA vision model
- [ ] At least one chat question verified to trigger a real NVIDIA tool call
      and return a grounded answer
- [ ] `status` + `lead` + `status_events` schema added; existing rows
      backfilled without crashing on restart
- [ ] Citizen can track a submitted report's status and current AI lead via
      `TrackMyReports.tsx`
- [ ] Ward Officer can advance a report's status via `OfficerLeadsBoard.tsx`
      and see the AI lead update in response
- [ ] Citizen can plan a route via `RoutePlanner.tsx`, see it drawn on the
      map, and get a real advisory (or alternative-route suggestion) when
      the route crosses active hotspots
- [ ] `check_route` and `get_report_status` added to the conversational
      agent's tool set and reachable from chat
- [ ] OSRM usage stays within reasonable-use limits; graceful fallback if
      the demo server is unreachable
- [ ] `npm run build` and `npm run typecheck` both pass cleanly
- [ ] README updated: NVIDIA setup instructions, OSRM limitation disclosure,
      what's real vs. simulated (carried forward from v2)