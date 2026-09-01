---
name: trajectory-view
description: Inspect the full agent trajectory — every turn, tool call, file operation, and token update — via the Trajectory debug view (DeepSeek harness style). Use when debugging what an agent did, auditing tool use, or exporting a trajectory.
---

# Trajectory View

The Trajectory plugin gives a DeepSeek-harness-style debug view: one scrollable timeline of every agent operation.

## Where to look

- **BB UI:** `Trajectory` in the sidebar (Activity icon) — pick a thread, filter by category (turn / tool / file / system / error / token), expand any row for raw JSON, export.
- **CLI:** `bb trajectory` — scriptable access to the same data.

## CLI

| Command | Effect |
| --- | --- |
| `bb trajectory list [--project <id>] [--search <q>] [--json]` | List threads |
| `bb trajectory show <threadId> [--limit 500] [--json]` | Full event log for a thread (seq, time, type) |
| `bb trajectory projects [--json]` | List projects |

Add `--json` when output drives code. The JSON event objects match `bb thread log --json` shape (`seq`, `type`, `createdAt`, `scope`, `data`).

## Procedure

1. List threads: `bb trajectory list` or `bb trajectory list --search "keyword"`.
2. Show trajectory: `bb trajectory show <threadId>` — pipe to a file or parse with `--json`.
3. For interactive debugging, open the Trajectory panel in BB — it auto-refreshes active threads and groups events by turn.

## Tips

- Filter in the UI by `tool` to see only tool calls, `file` for file ops, `error` for failures, `token` for context-window/tokens.
- Use `Export` in the UI or `bb trajectory show <id> --json > trajectory.json` to save a full trace.
- The live `follow tail` and `auto-refresh` toggles keep the view pinned to the latest events for running agents.
