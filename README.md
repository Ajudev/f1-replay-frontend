# F1 Replay frontend

Dashboard for the F1 historical race replay backend (FastAPI, separate repository). It replays completed
races as though they are live. The browser talks to the backend over REST and WebSocket only.

## Stack

Next.js 16 (App Router), React 19, TypeScript (strict), Tailwind CSS v4, shadcn/ui
(Radix), TanStack Query, Zustand, native WebSocket, Lucide icons, Vitest + React Testing Library.

## Setup

```bash
cp .env.example .env.local
npm install
npm run dev
```

| Variable | Default | Purpose |
| --- | --- | --- |
| `NEXT_PUBLIC_API_BASE_URL` | `http://localhost:8000` | Backend REST origin (`http`/`https`) |
| `NEXT_PUBLIC_WS_BASE_URL` | `ws://localhost:8000` | Backend WebSocket origin (`ws`/`wss`) |

Both are public and bundled into the browser. Invalid URLs throw at startup. Never put secrets here.

`shadcn` is a runtime dependency (not dev) because `globals.css` imports `shadcn/tailwind.css`.

## Scripts

| Script | Purpose |
| --- | --- |
| `npm run dev` / `build` / `start` | Next.js dev server, production build, serve build |
| `npm run lint` | ESLint |
| `npm run typecheck` | `tsc --noEmit` |
| `npm test` | Vitest (`test:watch` for watch mode) |
| `npm run gen:api` | Regenerate `src/lib/api/schema.d.ts` from `docs/openapi.json` |

## Structure

```text
src/app/                  routes, layout, error and not-found boundaries
src/components/           shared UI (ui/ is shadcn)
src/lib/env.ts            validated public env
src/lib/domain-styles.ts  status / tyre / severity presentation
src/lib/api/              schema.d.ts (generated), types.ts (aliases), client.ts, endpoints.ts
src/lib/query/            QueryClient factory, query keys, Providers
src/lib/ws/               envelope types + parser, ReplaySocket
src/lib/replay/           live reducer, Zustand live store, useReplayLiveConnection
docs/                     openapi.json, backend-integration.md
```

## Race explorer

- `/races`: seasons from the backend (newest first, `?season=`), client-side search, race cards.
- `/races/[raceId]`: race info, drivers, session choice, **Create Replay** (creates only; does not start).
- `/replays/[replayId]`: playback dashboard (Start/Pause/Resume/Stop/Restart, speed, clock, lap progress) over REST; no live timing yet.
- Limitations: lists only races imported into the backend; no circuit name or team colour; the import
  endpoint is never called; only `RACE` and `SPRINT` sessions are replayable from the UI.
- Tests: `npm test` (Vitest + React Testing Library); race UI tests are in `src/components/races/`.

## Architecture and data flow

```text
REST  -> api.* (typed fetch, ApiError) -> TanStack Query -> components
WS    -> ReplaySocket -> parseServerMessage -> liveStore.apply -> liveReducer -> components
```

State ownership:

- **TanStack Query** owns REST server data (races, sessions, replay, event pages, timing). Keys for a
  replay start with `["replays", replayId]` (see `queryKeys`). Mutations (replay commands) retry 0, are
  never optimistic, and invalidate `["replays", id]` on success.
- **Zustand (`liveStore`)** owns transient live replay state from the WebSocket: replay, race state,
  clock, run id, last sequence, connection status, selected driver. It is scoped to one `replayId` and
  is reset on replay switch and on unmount.
- The backend is authoritative. The reducer applies backend deltas; it never recomputes race logic,
  never interpolates the clock, and never classifies events.
- Sequence handling lives in the pure reducer, not the socket: state messages of the same run with a
  lower sequence are dropped (equal sequences apply, as several messages share one), a different run id
  sets `needsResync`, and `useReplayLiveConnection` answers with `RESYNC`.

`useReplayLiveConnection(replayId)` is mounted by the replay dashboard (`ReplayDashboard`). It drives a single global `liveStore`, so mount only one per page.

## Replay dashboard

- **Layout:** one sticky replay bar (race identity, connection, replay status, race clock, lap X/Y, track status and fastest lap, read-only lap progress, playback buttons, speed), then the timing tower, driver details, event feed and analytics.
- **State ownership:** the REST replay query (`useReplay`) owns the initial/fallback replay; `liveStore` owns clock, snapshot, deltas, events and selection. The bar merges them via `selectEffectiveReplay`; the backend stays authoritative. FAILED shows an alert with the backend `status_reason`; COMPLETED shows a final-standings note and clears nothing.
- **Selection:** `selectedDriverId` is the primary driver (timing tower, details). `comparisonDriverIds` are the analytics slots (max 4). "Show on charts" on an event highlights it, selects its primary driver and fills comparison slots; it never touches the replay clock.
- **Animations:** position gains/losses flash the row and events that arrive after the first batch flash their card (CSS keyframes in `globals.css`, 1.5s, background only). `motion-reduce:animate-none` plus the global reduced-motion rule disable them. Snapshots clear position changes, so the initial snapshot, reconnect and restart do not animate. The event feed never auto-scrolls. Events arriving before the first non-empty batch is seen are treated as backfill.
- **Error boundaries:** `SectionBoundary` wraps the timing tower, driver details, event feed and analytics separately; a throw shows an error state with "Try again" and leaves the rest and the replay bar working.
- **Render performance:** `Dashboard` reads only REST query state; clock/live fields are subscribed in `ReplayBar`. A test (`replay-dashboard.render.test.tsx`) counts renders and asserts a `REPLAY_CLOCK` frame does not re-render LiveTiming or Analytics. Only render counts were measured, not wall-clock timings.
- **Limitations:** no seeking or lap skipping (backend does not support it); no Playwright E2E in this repo.

## Design system conventions

- Dark theme with semantic tokens from `globals.css`; use tokens rather than raw colors.
- Status, tyre compound, track status, severity and position change presentation comes from
  `src/lib/domain-styles.ts`. Color is never the only signal: every treatment pairs color with an icon
  and a text label.
- Unavailable values render as an explicit `—`/`N/A`, never invented numbers.
- Loading, empty and error states use the shared `states` components.

## Testing

`npm test` runs Vitest with jsdom. Network and WebSocket behaviour is tested with stubbed `fetch` and a
fake `WebSocket` injected into `ReplaySocket`. Fixtures in `src/lib/test-fixtures.ts` follow the generated
schema.
