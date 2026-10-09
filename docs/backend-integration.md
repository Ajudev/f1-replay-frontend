# Backend integration

Source of truth: `docs/openapi.json` (REST) and the backend `README.md` "WebSocket API" section plus
`app/gateway/messages.py` (WebSocket, not in OpenAPI). Frontend types: `src/lib/api/types.ts` (REST aliases
of the generated schema) and `src/lib/ws/messages.ts`.

`docs/openapi.json` was exported from code because no server was running:

```bash
cd ../backend && uv run python -c "import json; from app.main import app; print(json.dumps(app.openapi(), indent=1))" > ../frontend/docs/openapi.json
cd ../frontend && npm run gen:api
```

## REST

Base URL `NEXT_PUBLIC_API_BASE_URL` + `/api/v1`. Client: `src/lib/api/endpoints.ts` (`api.*`).

| Method | Path | Key params |
| --- | --- | --- |
| GET | `/seasons` | |
| GET | `/races` | `season`, `round`, `event`, `session_type` |
| GET | `/races/{race_id}` | |
| GET | `/races/{race_id}/drivers` | `session_type` |
| GET | `/races/{race_id}/laps` | `driver`, `session_type`, `limit`, `offset`, `lap_from`, `lap_to` |
| GET | `/sessions/{session_id}` | |
| GET | `/sessions/{session_id}/laps` | `driver`, `limit`, `offset`, `lap_from`, `lap_to` |
| GET | `/sessions/{session_id}/stints` | `driver` |
| GET | `/sessions/{session_id}/track-status` | |
| POST | `/replays` | body `{session_id, playback_speed}` |
| GET | `/replays/{replay_id}` | |
| POST | `/replays/{replay_id}/start` `pause` `resume` `stop` `restart` | |
| PATCH | `/replays/{replay_id}/speed` | body `{playback_speed}` (1, 2, 5, 10, 20) |
| GET | `/replays/{replay_id}/state` | |
| GET | `/replays/{replay_id}/drivers/{driver}` | |
| GET | `/replays/{replay_id}/events` | `event_type` (repeatable), `driver`, `run_id`, `limit`, `offset`, `lap_from`, `lap_to` |
| GET | `/replays/{replay_id}/events/{event_id}` | |
| GET | `/replays/{replay_id}/timing` | `driver`, `lap_from`, `lap_to` |
| GET | `/replays/{replay_id}/drivers/{driver}/timing` | `lap_from`, `lap_to` |

Not wrapped (admin/ingestion): `/health`, `/ready`, `POST /races/import`, session `/timeline*`.

### Errors

Error body: `{code, message, details}`. `ApiError` exposes `status`, `code`, `message`, `details`.
Client-generated codes: `NETWORK_ERROR` (fetch failed, status 0), `TIMEOUT` (15 s default, status 0),
`HTTP_<status>` (non-JSON error body). A caller abort is rethrown as the original `AbortError`. Retries
(TanStack Query): none on 4xx, at most 2 on network/timeout/5xx, mutations 0.

### Pagination

Laps and events return pages with `limit` and `offset` (events also `total`). Use `limit`/`offset` params.

## WebSocket

`WS {NEXT_PUBLIC_WS_BASE_URL}/api/v1/replays/{replay_id}/stream`. JSON text frames.

Envelope: `type`, `schema_version` (1), `replay_id`, `run_id` (null for lifecycle), `sequence` (null for
lifecycle), `race_time_ms`, `lap_number`, `emitted_at`, `payload`. `parseServerMessage` validates the envelope
and, per type, the required payload keys and primitive types (nullable fields stay `null`; a missing or
mistyped key rejects the frame). Unknown types and invalid frames are dropped before the store (dev-only
`console.warn`); other `schema_version` values are rejected.

| Type | Payload |
| --- | --- |
| `SNAPSHOT` | `replay`, `state` (or null), `state_error` |
| `PONG` / `ERROR` | `{}` / `{code, message, details}` |
| `REPLAY_STATUS`, `REPLAY_COMPLETED` | `replay` |
| `REPLAY_CLOCK` | status, current_race_time_ms, current_lap, total_laps, playback_speed, emitted_event_count, total_events |
| `RACE_STATE_SNAPSHOT` | `reason` (`STATE_INITIALIZED`/`STATE_REBUILT`/`STATE_COMPLETED`), `state` |
| `RACE_STATE_UPDATE` | `kinds`, `race` (partial race fields), `last_sequence` |
| `DRIVER_UPDATE` | `driver` (DriverState without `recent_laps`) |
| `LAP_COMPLETED` | `driver_id`, `abbreviation`, `lap`, `laps_completed` |
| `POSITION_CHANGED`, `PIT_STATUS_CHANGED`, `TRACK_STATUS_CHANGED` | notifications; already contained in updates |
| `DETECTED_EVENT` | `event` (same as an item of `/events`) |

Client messages: `{"type":"PING"}` (answered by `PONG`), `{"type":"RESYNC"}` (answered by a fresh `SNAPSHOT`).

### Ordering and reconciliation

- First message on every connection (and after a client `RESYNC`) is a `SNAPSHOT`. The server registers the
  connection before building it and filters buffered messages the snapshot already covers, so snapshot plus
  deltas is gap-free per connection.
- `sequence` is the per-run replay-timeline sequence. One timeline event can produce several messages that
  share a sequence, and not every timeline event produces a message, so it is not contiguous on the socket.
  The client therefore does not detect gaps from numbers: the reducer drops a lower sequence and applies an
  equal or higher one. Loss is handled by reconnecting, which yields a fresh `SNAPSHOT`.
- A different `run_id` on a state message means a restart: the message is not applied and `needsResync` is
  set; the connection hook sends one `RESYNC`. `RACE_STATE_SNAPSHOT` (`STATE_INITIALIZED`) adopts the new run
  directly, clearing driver state, detected events and the sequence cursor. Replay metadata is kept.
- `REPLAY_STATUS`, `REPLAY_CLOCK`, `REPLAY_COMPLETED` carry no run or sequence and are unordered relative to
  state messages. Treat the race as finished on `RACE_STATE_SNAPSHOT` with `reason` `STATE_COMPLETED`.
- Deltas: race update shallow-merges; driver update merges and keeps `recent_laps`, then re-sorts by
  `position`; lap completed upserts by `lap_number`; race snapshot replaces the state.

### Detected events

`DETECTED_EVENT` messages are stored unchanged in `liveStore.events`: at most 200, ordered by
`source_sequence`, deduplicated by `detected_event_id`, and only for the current `run_id`. They bypass the
sequence check and never move the state cursor. Messages published while the socket was down are not
replayed, so on every `SNAPSHOT` (connect, reconnect, resync) the hook fetches `GET /replays/{id}/events`
for the snapshot's run (`run_id`, `limit=200`; the list is oldest first, so when `total` exceeds 200 a second
request reads the tail) and merges it with the same dedup. A response is discarded if the replay or run
changed, or the connection was torn down, while it was in flight. There is no event feed UI yet.

### Single view of the replay

`selectEffectiveReplay` (`src/lib/replay/effective-replay.ts`) is the only source for status, clock, lap and
speed on the dashboard. While the socket is open and a `SNAPSHOT` has arrived it returns the live replay with
`REPLAY_CLOCK` fields overlaid as received (no interpolation; a paused clock is static). Otherwise (initial
load, connecting, failed socket) it returns the REST copy. A `REPLAY_STATUS` or `REPLAY_COMPLETED` frame
carries all clock fields and discards an older stored clock.

A successful REST command writes the confirmed `Replay` to the query cache and to the live store. There is no
hold: the gateway delivers frames in publish order per replay (backend `app/gateway/fanout.py`) and every
transition is broadcast, so a stale in-flight frame is superseded by the backend's next `REPLAY_STATUS`. The
latest frame wins; worst case is a brief flicker. A `SNAPSHOT` of the same run with a lower `sequence` than
the last applied one is ignored.

While the socket is not open, `useReplay` polls every `REPLAY_POLL_MS` regardless of status, except terminal
statuses (`COMPLETED`, `FAILED`, `STOPPED`); polling is off while the socket is open.

### Event backfill and leakage

The detection worker (backend `app/detection/worker.py`) persists detected events as it consumes
`race.state.events`, which advance with the replay clock, so the REST backfill only contains events up to the
replay cursor. `GET /events` has no explicit cursor filter, so a future full-race analysis mode must not rely
on it for leakage protection.

### Connection lifecycle and cleanup

`useReplayLiveConnection(replayId)` is mounted once, in `Dashboard` (keyed by `replayId`). It resets the store
for the replay, opens one `ReplaySocket`, and on cleanup aborts the event backfill, closes the socket
(handlers detached, so late frames are ignored) and resets the store. Strict Mode's double mount therefore
leaves one live socket, and the store also rejects any frame whose `replay_id` is not the current one. The
socket status is shown beside the header: Connecting, Live, Reconnecting, Disconnected (with a Retry button
once retries are exhausted or the close code forbids reconnecting) or Sync error (`needsResync` or an
`ERROR`/`state_error` other than `REPLAY_NOT_STARTED`). Anything but Live adds "Displayed state may be stale".
A socket disconnect never calls a replay control endpoint; the replay keeps running on the backend.

### Reconnect and close codes

`ReplaySocket` (`retry()` restarts it manually and resets attempts) reconnects with exponential backoff (500 ms base, 30 s cap, jittered, 10 attempts by
default; the attempt counter resets only when a `SNAPSHOT` arrives, since the backend accepts the socket before failing with 1013/1011) and treats the new `SNAPSHOT` as authoritative. Keep-alive `PING` every 25 s.

| Code | Meaning | Reconnect |
| --- | --- | --- |
| 1008 | replay_id not a UUID | no |
| 4404 | unknown replay | no |
| 4408 | client too slow | yes |
| 1013 | retry later (snapshot failed) | yes |
| 1011 | server error | yes |
| 1001 | server shutdown | yes |

### CORS

Backend default allows `http://localhost:3000`. Other origins need backend configuration.

## Race explorer and replay creation

Routes: `/races` (season selector via `?season=`, optional `?q=` search), `/races/[raceId]` (detail, sessions,
drivers, Create Replay), `/replays/[replayId]` (playback dashboard, REST plus live WebSocket updates).

- `GET /seasons`, `GET /races?season=`, `GET /races/{id}`, `GET /races/{id}/drivers?session_type=` feed the
  explorer. These return only races already imported into PostgreSQL; there is no catalogue of
  not-yet-imported races, no pagination and no circuit name or team colour field. Search is client-side
  over name, official name, country and location.
- `POST /replays` is sent with `{session_id, playback_speed: 1}` (the generated type requires speed). It
  does not start playback; `/start` is never called. The frontend navigates to `/replays/{response.id}`
  only after success.
- Only `RACE` and `SPRINT` sessions are offered for replay, matching the backend timeline builder's
  `SUPPORTED_SESSION_TYPES`; other types are shown as unavailable. A timeline must also be generated, or
  creation fails with the backend's 404/409 message.
- `POST /races/import` is deliberately unused: the UI never triggers ingestion.

## Replay dashboard (`/replays/[replayId]`)

- Component `ReplayDashboard` (keyed by `replayId`, so local error state resets on switch). Hooks in
  `src/lib/query/hooks.ts`: `useReplay` and `useReplayControl(replayId)` (start, pause, resume, stop, restart
  and speed through one mutation, so only one command is in flight). Helpers in `src/lib/replay/playback.ts`.
- Allowed actions follow the backend table: CREATED: start. RUNNING: pause, stop, restart. PAUSED: resume,
  stop, restart. STOPPED, COMPLETED, FAILED: restart. Others are disabled. The backend still decides; a 409
  is shown inline and the replay is refetched. The page never starts a replay on open.
- Speeds 1, 2, 5, 10, 20 (PATCH `/speed`, allowed in any status). The selected speed is always the
  backend-confirmed `playback_speed`; there is no optimistic value.
- Cache sync: a command response is written to `["replays", id]` after cancelling in-flight queries, so an
  older poll cannot overwrite it. Command errors invalidate the key.
- Polling: `useReplay` refetches every `REPLAY_POLL_MS` (1500 ms) only while status is RUNNING and the
  replay's socket is not open (fallback). A failed poll keeps the last data and shows a warning.
- Clock is `current_race_time_ms` as HH:MM:SS from the effective replay (live `REPLAY_CLOCK` when connected,
  else the last REST response); it is not interpolated. Progress is lap based (`current_lap / total_laps`), read-only, 100% when completed, unavailable when
  totals are null. Stop ends the replay; only Restart plays it again.

## Known gaps

- No seeking or lap skipping (not supported by the backend).
- `Replay` has no monotonic field. A frame already in flight when a command succeeds can briefly show the
  previous status; the backend's own lifecycle frame follows in order and wins.
- `GET /replays/{id}/events` has no explicit cursor filter; it is safe for live backfill only because
  detections are persisted as the replay advances (see "Event backfill and leakage").

- No running backend was available: live REST responses and WebSocket frames are not verified, only
  the exported schema and backend source.
- Tyre compound is a free string in the schema, not an enum.
- Lifecycle messages are unordered relative to state messages.
- No authentication.
- Messages published while disconnected are not replayed; recovery is a fresh snapshot.
- Payloads are validated for required keys and primitive types only (not nested driver or lap fields).
