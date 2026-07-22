// Round 2 Task 4, Step 7 (ROUND2.md §4.1): shared timeout budget for any live
// fetch that has a static-snapshot fallback to fall back on (App.tsx's
// complaints fetch, CityAdmin.tsx's verification-stats fetch). How long to
// wait before giving up on a possibly cold-starting backend (Render's free
// tier can take ~50s to wake) and honestly relabelling the already-rendered
// snapshot data as "Showing cached data" instead of leaving a "Live data
// loading…" badge spinning through the full cold-start window. The backend
// keeps booting in the background regardless — a later retry (tab switch,
// manual refresh) may still succeed once it's warm.
export const LIVE_FETCH_TIMEOUT_MS = 10000;
