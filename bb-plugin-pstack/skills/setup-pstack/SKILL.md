---
name: setup-pstack
description: Configure which models pstack uses per role. Detects your available models and updates the role mapping that overrides the skill defaults. Use for /setup-pstack, "configure pstack models", or changing pstack's model choices.
disable-model-invocation: true
---

# Setup pstack

Use `/setup-pstack` to map pstack roles to models. It lists models available to this session and writes the chosen role mappings to the pstack config (backed by `bb.storage.kv` via `simple-subagent`). Unconfigured roles run as `inherit-parent`.

## Steps

### 1. Detect available models

Call `pstack_config` with `action: "list-models"`. That is the dependable source: it returns `inherit-parent` plus every `provider/model` selector this session can delegate to. Never write a real selector you have not confirmed is available. `inherit-parent` is always valid even though it is not a detected selector.

### 2. Load current state

Call `pstack_config` with `action: "get"` and treat its values as the current choices. The default role-to-model mapping is `inherit-parent` for every role (the shape shown in step 5 below lists the role labels).

### 3. Map and confirm

Show every role with its current model, marking any real selector not in the detected set as needing a choice. Ask whether to accept as-is or change specific roles, offering the detected models plus `inherit-parent` (this role runs on the parent thread model) as the options. Prefer `AskUserQuestion` over free text. For panel roles (arena runners, architect runners, interrogate reviewers) the value is a list, and one subagent runs per entry, alias entries included, so the list length sets the count. `arena cross-judge pool` is also a list, but Arena selects one value from it whose model family differs from the parent's when possible. `swarm workers` is the default model for every worker unless a race or comparison assigns another model per arm.

### 4. Validate

Every real selector written must be in the detected set. `inherit-parent` always passes. If a chosen real selector is not available, stop and ask again.

### 5. Write the config

Set each changed role with `pstack_config` (`action: "set"`, plus `role` and `model` or `models`), or equivalently `bb pstack config set "<role>" <provider/model>`. Overwrite per role so re-runs stay idempotent. Role labels:

```
feature, refactoring
bug-fix
perf-issue
hillclimb
judgment and prose
hardest tasks
how explorer
how explainer
why investigators
why synthesizer
reflect tooling
reflect judgment, divergent, synthesizer
arena runners (list)
arena cross-judge pool (list)
swarm workers
architect runners (list)
interrogate reviewers (list)
```

Panel roles take a list of selectors; every other role takes one selector or `inherit-parent`.

### 6. Confirm

Tell the user the config was written and that it applies to new subagents. Re-running this skill updates it.

### 7. Offer a verification skill (optional)

Check whether the project has a way to drive the real app for proof (a `verify-*` skill, or an existing harness). If not, offer once: "want a project-local verification skill, so agents can drive the app the way a user does and prove changes work? I can generate one with /skill:create-verification-skill." On yes, invoke `/skill:create-verification-skill`. On no, move on without pushing.
