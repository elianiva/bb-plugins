# bb-plugin-opencode-go-usage

Show **OpenCode Go** quota from `https://opencode.ai/zen/go/v1/usage` inside bb.

- **Go usage** page in the sidebar (`/plugins/opencode-go-usage/go-usage`) — 5 Hour / Weekly / Monthly bars with `percent`, `status`, and `resetsAt`.
- **CLI** `bb opencode-go-usage` — same data in your terminal, `--json` for machines.
- **API key** — stored as a secret plugin setting (`bb plugin config opencode-go-usage set apiKey <key>`), or passed per-call with `--api-key`.

## Install

```bash
cd bb-plugin-opencode-go-usage
npm install
bb plugin install .
```

After editing, reload:

```bash
bb plugin reload opencode-go-usage
# or
bb plugin dev  # watch + reload
```

## Configure

```bash
bb plugin config opencode-go-usage set apiKey <your-opencode-go-key>
bb plugin config opencode-go-usage set baseUrl https://opencode.ai/zen/go
bb plugin reload opencode-go-usage
```

## Use

```bash
bb opencode-go-usage                # human-readable bars
bb opencode-go-usage --json         # machine JSON
bb opencode-go-usage --api-key sk-... --json
bb opencode-go-usage --base-url https://opencode.ai/zen/go
```

Open **Go usage** in the left nav for the visual panel (refresh, override key, raw JSON).

## API

`GET https://opencode.ai/zen/go/v1/usage` with `Authorization: Bearer <key>` returns:

```json
{ "usage": { "rolling": { "percent": 12.3, "status": "ok", "resetsAt": "2026-09-01T..." }, "weekly": {...}, "monthly": {...} } }
```

The plugin normalizes `--base-url` (trailing slash, `/v1`, or full `/v1/usage` all work).

## Stack

- `server.ts` — settings (`apiKey` secret, `baseUrl`), RPC `usage_get`, CLI, 60s kv cache, fetch + error mapping.
- `app.tsx` — sidebar panel with progress bars and reset timers.
- `skills/opencode-go-usage/SKILL.md` — agent skill for `bb opencode-go-usage`.
