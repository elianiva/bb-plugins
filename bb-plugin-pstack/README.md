# bb-plugin-pstack

BB port of [poteto's pstack](https://github.com/cursor/plugins/tree/main/pstack) — the same rigorous engineering discipline from Cursor, now in BB.

Based on:
- **Upstream:** [cursor/plugins/pstack](https://github.com/cursor/plugins/tree/main/pstack) (MIT)
- **Pi adaptation:** [pi-pstack](https://github.com/kkgogogo17/pi-pstack) (~/.pi/agent/extensions/pi-pstack) — 43 skills ported, poteto-mode extension, subagents

## What you get

- **40+ skills** under `skills/` — `poteto-mode`, `how`, `why`, `architect`, `arena`, `swarm`, `interrogate`, `reflect`, `tdd`, `unslop`, `no-comments`, and 21 `principle-*` skills. BB auto-imports every `skills/<name>/SKILL.md` into agent threads.
- **Poteto mode** — sticky instruction injection via `bb.agents.contributeInstructions`. Toggle with `bb pstack poteto on|off` (per-thread or `--global`), or `bb pstack poteto "your task"` to enable and hint. Agents read `skill://poteto-mode` and its Principles index before planning.
- **Native tools** (visible to agents):
  - `pstack_todo` — checklist (`get|set|add|complete`), persisted per thread in `bb.storage.kv`
  - `pstack_config` — role→model mapping (`get|list-models|set`), global `pstack:config`
  - `pstack_sessions` — lists BB threads for the current project
  - `subagent` — delegates to BB child threads (`task`, `tasks[]`, `chain` with `{previous}`, `agent: poteto-agent|comment-sicko`, `role`, `model`). Concurrency capped at 4, max 8 tasks.
- **CLI:** `bb pstack`
  ```
  bb pstack status [--json] [--thread <id>]
  bb pstack poteto on|off [--thread <id>] [--global]
  bb pstack poteto "<task>"
  bb pstack todo get|set|add|complete ...
  bb pstack config get|list-models|set ...
  bb pstack sessions [--project <id>]
  bb pstack setup
  ```
- **Dashboard:** Pstack page in the sidebar (`/plugins/pstack/pstack`) — poteto state, todos, and config.

## Subagents

Poteto delegates run as BB child threads (`bb.sdk.threads.spawn` with `parentThreadId`). `poteto-agent` reads `skill://poteto-mode` in full before work; `comment-sicko` is a read-only comment reviewer. Configure delegation models via `bb pstack config` or `pstack_config` tool — unconfigured roles inherit the parent's provider/model.

## Safety

The server logs destructive command patterns (git push, gh pr mutations, infrastructure, recursive deletes) for diagnostics; actual blocking is at the provider permission layer, matching pi-pstack's `knownExternalWrite` guard.

## Install

```bash
cd bb-plugin-pstack
npm install
bb plugin install .          # registers directory in place
# or
bb plugin build              # emits dist/* for git/npm consumers
```

After editing, reload:

```bash
bb plugin reload pstack
# or watch:
bb plugin dev
```

## Configure

```
bb pstack setup                          # shows roles and current config
bb pstack config list-models
bb pstack config set "arena runners" provider/model --json
bb pstack config set "feature, refactoring" inherit-parent
bb pstack poteto on --global
```

Or via the `pstack_config` tool from inside an agent.

## Skills

All skills are the pi-pstack versions (which already adapted Cursor's `subagent_type` and `~/.cursor/rules/pstack-models.mdc` references to `subagent` tool and `~/.pi/agent/pstack/models.json`). For BB they resolve to BB's `subagent` tool and KV-backed `pstack:config`.

Playbooks live at `skills/poteto-mode/playbooks/` (investigation, bug-fix, perf-issue, feature, refactoring, prototype, shipping, babysit, etc.) and are selected by `poteto-mode`'s routing.

## License

MIT — derived from Cursor's pstack (MIT). See upstream LICENSE.
