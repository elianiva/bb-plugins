# Vendoring

**Source:** https://github.com/cursor/plugins/tree/main/pstack
**Upstream commit:** see `git log` in the vendor source (cloned via `read` tool to `/Users/elianiva/Development/repos/cursor/plugins@main`)
**License:** MIT, Copyright (c) 2026 Lauren Tan (see `LICENSE`)

## What is vendored

- `skills/*` — 45 skills from upstream `pstack/skills/*` (all upstream skills) vendored verbatim, then lightly adapted for BB:
  - `subagent_type: generalPurpose` → `agent: poteto-agent` via `subagent` tool (provided by `bb-plugin-simple-subagent`)
  - Cursor model slugs (`grok-4.6-fast-xhigh`, `claude-fable-5.1-thinking-max`, etc.) → `inherit-parent` defaults; role→model mapping via `pstack_config` / `bb pstack config` proxying to `simple-subagent`
  - `~/.cursor/rules/pstack-models.mdc` → BB storage (`bb.storage.kv` via `simple-subagent`)
  - `readonly: true` → BB tool filtering (do not grant write/edit tools)
- `skills/poteto-mode/playbooks/*` and `skills/*/references/*` and `skills/*/scripts/*` — copied with the skills
- `agents/poteto-agent.md` and `agents/comment-sicko.md` — ported as `skills/poteto-agent/SKILL.md` and `skills/comment-sicko/SKILL.md` for BB's `subagent` tool

## BB additions (not in upstream)

- `skills/comment-sicko`, `skills/poteto-agent` — BB skill wrappers for the upstream agents
- `skills/example-todos` — example todo skill kept for compatibility

## Update procedure

1. Pull latest upstream: `git clone https://github.com/cursor/plugins` and copy `pstack/skills/*` and `pstack/agents/*`
2. Re-apply BB adaptations (search for `subagent_type`, `generalPurpose`, `~/.cursor`, model slugs)
3. Copy `pstack/LICENSE` if changed
4. Update this file with the new upstream commit
