# Send Capture

Agents capture a screenshot or recording with `agent-browser` and send it
inline for verification via the `send_capture` tool. The bundled `send-capture`
skill carries the capture flow.

## Tool

`send_capture` params:

- `path` (required) — absolute path to the capture file.
- `label` — short subject label (defaults to the filename).
- `kind` — `photo` (default) or `video`.
- `mimeType` — override the inferred mime type.

Photos return text plus an inline image. Videos return a text reference with
the file path — inline video rendering lands in a later phase.

## Skill flow

1. Isolate an `agent-browser` session (`AGENT_BROWSER_SESSION`).
2. Capture into `$PWD/.tmp/captures` (stable filenames, absolute paths).
3. Send via the `send_capture` tool — never a bare path.
4. Remote only when asked: serve the captures dir, share with
   `bb connect expose`, unexpose when done.
5. `agent-browser close` when finished.

## Limits

- Photo bytes capped at 5MB; larger files are rejected with an error.
- Video returns a path reference only — no bytes this phase.
- Local-only by default; ask before exposing anything remotely.
