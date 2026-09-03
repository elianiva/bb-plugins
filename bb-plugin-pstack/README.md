# bb-plugin-pstack

BB port of [poteto's pstack](https://github.com/cursor/plugins/tree/main/pstack) — the same rigorous engineering discipline from Cursor, now in BB.

Based on [cursor/plugins/pstack](https://github.com/cursor/plugins/tree/main/pstack) (MIT, Copyright 2026 Lauren Tan). See [VENDOR.md](VENDOR.md) and [LICENSE](LICENSE).

## What you get

- **40+ skills** under `skills/` — `poteto-mode`, `how`, `why`, `architect`, `arena`, `swarm`, `interrogate`, `reflect`, `tdd`, `unslop`, `no-comments`, and 21 `principle-*` skills. BB auto-imports every `skills/<name>/SKILL.md` into agent threads.
- **Poteto mode** — sticky instruction injection via `bb.agents.contributeInstructions`. Toggle with `bb pstack poteto on|off` (per-thread or `--global`), or `bb pstack poteto "your task"` to enable and hint. Agents read `skill://poteto-mode` and its Principles index before planning.
- **Native tools** (visible to agents):
  - `pstack_todo` — checklist (`get|set|add|complete`), persisted per thread in `bb.storage.kv`
  - `pstack_config` — role→model mapping (`get|list-models|set`); a thin proxy over [bb-plugin-simple-subagent](../bb-plugin-simple-subagent)'s config, which is where the roles actually live
  - `pstack_sessions` — lists BB threads for the current project
  - `subagent` is provided by the separate [bb-plugin-simple-subagent](../bb-plugin-simple-subagent) plugin (install it alongside pstack) — delegates to BB child threads (`task`, `tasks[]`, `chain` with `{previous}`, `agent`, `role`, `model`). Concurrency capped at 4, max 8 tasks.
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

Poteto delegates run as BB child threads via the `subagent` tool, registered by the separate [bb-plugin-simple-subagent](../bb-plugin-simple-subagent) plugin — install both. `poteto-agent` reads `skill://poteto-mode` in full before work; `comment-sicko` is a read-only comment reviewer. Configure delegation models via `bb pstack config` or the `pstack_config` tool (both proxy to simple-subagent's config) — unconfigured roles inherit the parent's provider/model.

## Safety

The server logs destructive command patterns (git push, gh pr mutations, infrastructure, recursive deletes) for diagnostics; actual blocking is at the provider permission layer, matching upstream's `knownExternalWrite` guard.

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

All 45 skills vendored from upstream (see [VENDOR.md](VENDOR.md)), with minimal BB adaptations:

- `subagent_type: generalPurpose` → `agent: poteto-agent` via the `subagent` tool (from [bb-plugin-simple-subagent](../bb-plugin-simple-subagent))
- Cursor model slugs → `inherit-parent` defaults via `pstack_config` / `bb pstack config`
- `~/.cursor/rules/pstack-models.mdc` → BB storage (`bb.storage.kv` via `simple-subagent`)

BB adds `poteto-agent`, `comment-sicko`, and `example-todos` as skills (upstream ships them as `agents/`). Playbooks live at `skills/poteto-mode/playbooks/` (investigation, bug-fix, perf-issue, feature, refactoring, prototype, shipping, babysit, etc.) and are selected by `poteto-mode`'s routing.

## License

MIT — see [LICENSE](LICENSE) (upstream MIT, Copyright 2026 Lauren Tan).
