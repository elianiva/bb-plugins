# bb-plugin-trajectory

**DeepSeek-harness-style debug view — full log of agent operations.**

Every turn, tool call, file op, and token update in one scrollable timeline. Like the DeepSeek harness trajectory viewer, but for BB agents.

![Trajectory](https://img.shields.io/badge/BB-Plugin-Activity)

## What it does

- **Trajectory panel** (`Trajectory` in the sidebar, Activity icon) — pick any thread and see its complete event log grouped by turn. Filter by category (turn / tool / file / system / error / token), search within events, expand any row for raw JSON, export.
- **Live debug** — auto-refresh every 2.5s for active threads, follow-tail toggle, token usage header, turn grouping with timestamps.
- **CLI** — `bb trajectory` for scripting and quick inspection.

## Screens

- **Header:** thread meta (id, provider/model, status), token usage, stats (total events / turns / ops)
- **Controls:** thread picker (searchable), project filter, category pills, text filter, limit, density, auto-refresh/follow-tail
- **Timeline:** grouped by `turnId`, each event as a card with badge, timestamp, type, item summary, and expandable raw JSON. Timeline line + colored badges.

## Install

```bash
# from this repo
bb plugin install --yes ~/Development/personal/bb-plugins/bb-plugin-trajectory

# verify
bb plugin list | grep trajectory
bb trajectory --help
```

After edits:

```bash
bb plugin build      # inside plugin dir
bb plugin reload trajectory
# or
bb plugin dev        # watch
```

## CLI

```bash
bb trajectory list [--project <id>] [--search <q>] [--json]
bb trajectory show <threadId> [--limit 500] [--json]   # full event log
bb trajectory projects [--json]
```

Examples:

```bash
bb trajectory list --json | jq '.threads[].id'
bb trajectory show thr_abc123 --limit 1000 > trajectory.json
bb trajectory list --search "auth bug"
```

## RPC (for other plugins / frontend)

- `trajectory_list_threads({ projectId?, limit?, offset?, search? }) → { threads }`
- `trajectory_list_projects(null) → { projects }`
- `trajectory_get({ threadId, limit?, afterSeq?, beforeSeq?, order? }) → { thread, events, hasMore, nextSeq }`
- `trajectory_timeline({ threadId }) → { timeline }`
- `trajectory_output({ threadId }) → { output }`

## Skill

`skills/trajectory-view/SKILL.md` is auto-imported into agent threads. It tells agents how to use `bb trajectory` to inspect and export trajectories when debugging.

## Build

Uses BB plugin SDK `0.4.21`. Frontend is React + Tailwind via BB's shimmed runtime (no bundling of React/sonner/radix). Run `bb plugin build` to emit `dist/` (`server.js`, `app.js`, `app.css` + `*.meta.json`). Keep `dist/` committed for git installs.

## License

MIT — same as BB.
