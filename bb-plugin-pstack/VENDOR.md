# Vendoring

**Source:** https://github.com/cursor/plugins/tree/main/pstack
**Upstream commit:** `df3fb15` (2026-09-08) — `git -C /Users/elianiva/Development/repos/cursor/plugins@main rev-parse HEAD`
**License:** MIT, Copyright (c) 2026 Lauren Tan (see `LICENSE`)

## What is vendored

- `skills/*` — 47 skills from upstream `pstack/skills/*` (all upstream skills, including new `principle-attack-the-premise` and `principle-test-behavior-not-implementation`) vendored verbatim, then lightly adapted for BB:
  - `subagent_type: generalPurpose` / `Task` tool → `agent: poteto-agent` via the `subagent` tool (provided by `bb-plugin-simple-subagent`)
  - Cursor model slugs (`grok-4.6-fast-xhigh`, `claude-fable-5-1-thinking-max`, etc.) → `inherit-parent` defaults; role→model mapping via `pstack_config` / `bb pstack config` proxying to `simple-subagent`
  - `~/.cursor/rules/pstack-models.mdc` → BB storage (`bb.storage.kv` via `simple-subagent`); skill text points at `pstack_config` / `~/.pi/agent/pstack/models.json`
  - `readonly: true` → BB tool filtering (do not grant write/edit tools)
  - Cursor-only tooling renamed: `AskQuestion` → `AskUserQuestion`, `create-skill` → Pi Agent Skills standard, `/deslop` → **unslop** skill, `/loop` → explicit watcher command, `/<skill>` → `/skill:<skill>`
  - Cursor paths → Pi paths (`.cursor/skills/` → `.pi/skills/`, transcripts via `$PI_SESSION_FILE` / `pstack_sessions`)
  - Removed with upstream: `how` critique mode and the `how critics` role (deleted `skills/how/references/critic-prompt.md` and `critique-rubric.md`, dropped `how critics` from both plugins' `server.ts` role tables)
- `skills/poteto-mode/playbooks/*` and `skills/*/references/*` and `skills/*/scripts/*` — copied with the skills (including new `skills/poteto-mode/scripts/check-plan.mjs`; `skills/poteto-mode/scripts/worktree-audit.sh` keeps the `$PI_SESSION_FILE` adaptation)
- `agents/poteto-agent.md` and `agents/comment-sicko.md` — ported as `skills/poteto-agent/SKILL.md` and `skills/comment-sicko/SKILL.md` for BB's `subagent` tool

## BB additions (not in upstream)

- `skills/comment-sicko`, `skills/poteto-agent` — BB skill wrappers for the upstream agents
- `skills/example-todos` — example todo skill kept for compatibility

## Update procedure

1. Pull latest upstream: `git -C /Users/elianiva/Development/repos/cursor/plugins@main pull --ff-only` (or `git clone https://github.com/cursor/plugins`) and copy `pstack/skills/*` and `pstack/agents/*`
2. Re-apply BB adaptations (search for `subagent_type`, `generalPurpose`, `Task` tool, `~/.cursor`, `.cursor/`, model slugs, `AskQuestion`, `create-skill`, `deslop`, `/loop`, `agent-transcripts`)
3. Copy `pstack/LICENSE` if changed
4. Drop files/roles upstream removed; update this file with the new upstream commit
