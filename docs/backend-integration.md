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
lifecycle), `race_time_ms`, `lap_number`, `emitted_at`, `payload`. `parseServerMessage` checks the envelope
only; unknown types are ignored, other `schema_version` values are rejected.

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

- First message is a `SNAPSHOT`; buffered state messages it already covers are filtered by the server.
- Within a run `sequence` never decreases; several messages share one sequence. The reducer drops lower
  sequences and applies equal ones.
- A different `run_id` means a restart: the reducer does not apply the message and flags `needsResync`;
  the connection hook sends `RESYNC`.
- `REPLAY_STATUS`, `REPLAY_CLOCK`, `REPLAY_COMPLETED` are unordered relative to state messages. Treat the
  race as finished on `RACE_STATE_SNAPSHOT` with `reason` `STATE_COMPLETED`, not on `REPLAY_COMPLETED`.
- Deltas: race update shallow-merges; driver update merges and keeps `recent_laps`, then re-sorts by
  `position`; lap completed upserts by `lap_number`; race snapshot replaces the state.

`useReplayLiveConnection` drives a single global `liveStore`: mount only one per page.

### Reconnect and close codes

`ReplaySocket` reconnects with exponential backoff (500 ms base, 30 s cap, jittered, 10 attempts by
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

## Known gaps

- No running backend was available: live REST responses and WebSocket frames are not verified, only
  the exported schema and backend source.
- Tyre compound is a free string in the schema, not an enum.
- Lifecycle messages are unordered relative to state messages.
- No authentication.
- Messages published while disconnected are not replayed; recovery is a fresh snapshot.
- Payloads are not deep-validated at runtime; they are trusted after the envelope check.
