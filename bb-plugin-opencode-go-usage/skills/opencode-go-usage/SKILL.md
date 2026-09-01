---
name: opencode-go-usage
description: Show OpenCode Go quota via `bb opencode-go-usage`. Use when the user asks about OpenCode Go usage, limits, quota, 5-hour / weekly / monthly windows, or wants to check how much Go capacity is used/remaining.
---

# OpenCode Go usage

The Opencode Go Usage plugin reads `GET https://opencode.ai/zen/go/v1/usage` with `Authorization: Bearer <key>` — the same numbers as the OpenCode dashboard.

## Setup

The API key is stored as a plugin secret setting:

```bash
bb plugin config opencode-go-usage set apiKey <your-opencode-go-key>
bb plugin reload opencode-go-usage
```

Optional base URL override (default `https://opencode.ai/zen/go`):

```bash
bb plugin config opencode-go-usage set baseUrl https://opencode.ai/zen/go
```

A key can also be passed per-invocation with `--api-key` without saving it.

## Commands

| Command | Effect |
| --- | --- |
| `bb opencode-go-usage` | Show 5h / weekly / monthly usage (percent used, bar, resetsAt) |
| `bb opencode-go-usage show` | Same as above |
| `bb opencode-go-usage status` | Same as above |
| `bb opencode-go-usage --json` | Same as JSON (`{ ok, data: { usage: { rolling, weekly, monthly } } }`) |
| `bb opencode-go-usage --api-key <key>` | Use a one-off key (not saved) |
| `bb opencode-go-usage --base-url <url>` | Override base URL for this call |

The UI is also at **Go usage** in the BB sidebar (`/plugins/opencode-go-usage/go-usage`), with progress bars, reset timers, and raw JSON.

## Response shape

JSON (`--json`) returns:

```json
{
  "ok": true,
  "data": {
    "fetchedAt": "2026-09-01T...",
    "endpoint": "https://opencode.ai/zen/go/v1/usage",
    "usage": {
      "rolling": { "label": "5 Hour", "percent": 23.4, "status": "ok", "resetsAt": "2026-09-01T...", "usedFraction": 0.234 },
      "weekly":  { "label": "Weekly", "percent": 12.0, "status": "ok", "resetsAt": "..." },
      "monthly": { "label": "Monthly","percent": 45.2, "status": "ok", "resetsAt": "..." }
    },
    "raw": { "usage": { "rolling": {...}, "weekly": {...}, "monthly": {...} } }
  }
}
```

`status` is `ok` or `rate-limited` (the latter renders as exhausted). `percent` is 0–100.

## Rules

- Prefer `--json` when the output drives code.
- If the CLI reports "No API key", tell the user to set it with `bb plugin config opencode-go-usage set apiKey <key>` and reload.
- 401/403 means the key is wrong, expired, or has no Go subscription — surface the upstream message.
