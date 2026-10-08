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
- `/replays/[replayId]`: status summary; live dashboard is not built yet.
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

`useReplayLiveConnection(replayId)` is not mounted by any page yet. It drives a single global `liveStore`, so mount only one per page.

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
