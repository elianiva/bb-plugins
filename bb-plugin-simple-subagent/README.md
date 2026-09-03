# Simple Subagent

A minimal, server-only BB plugin that registers one native tool, `subagent`,
for delegating work to isolated child threads.

Split out of `bb-plugin-pstack` so the delegation primitive can be used
without pstack's skills, todo/config tools, or UI.

## Tool: `subagent`

Delegate work to one or more isolated subagents (BB child threads). Each
subagent runs as a separate thread and returns only its final result.

- `task: string` — single task
- `tasks: string[]` — parallel tasks (concurrency capped at 4)
- `chain: string[]` — sequential tasks; each entry may reference `{previous}`
  to interpolate the prior step's result
- `agent?: string` — free-form label included in the result header
- `model?: string` — one-off `provider/model` override; omitted inherits the
  parent thread's provider and model

A child that errors out or times out still has its output fetched and
forwarded to the parent — nothing is silently dropped.

## Install

```sh
npm install
bb plugin install .
```
