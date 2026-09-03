# bb-plugins

A collection of [BB](https://getbb.app) plugins built for personal use. Each subdirectory is a standalone plugin with its own `package.json` and BB manifest. Install one or install all via `.bb/plugins.json`.

> Originally a private scratch repo for syncing between machines — now public so others can use, fork, and reference the plugins.

## Plugins

| Plugin | What it does |
|--------|--------------|
| [bb-plugin-bocchi](bb-plugin-bocchi/) | **Bocchi theme** — pink, cute, soft gradient theme for BB (ported from the Bocchi the Rock! palette). |
| [bb-plugin-github-plus](bb-plugin-github-plus/) | **GitHub Plus** — browse GitHub issues and pull requests inside BB. Discover repos from `origin` remotes, track extra repos, filter/search, view discussions/checks/reviews/diffs, create/comment/close/assign/label, and start agent work from an issue or PR. Requires `gh` auth. |
| [bb-plugin-pstack](bb-plugin-pstack/) | **Pstack** — BB port of [poteto's pstack](https://github.com/cursor/plugins/tree/main/pstack) (MIT). 45+ skills (`poteto-mode`, `how`, `why`, `architect`, `arena`, `swarm`, `interrogate`, etc.), sticky poteto-mode instruction injection, `pstack_todo` / `pstack_config` / `pstack_sessions` tools, and `bb pstack` CLI (`status`, `poteto on|off`, `todo`, `config`, `sessions`, `setup`). Delegation via `bb-plugin-simple-subagent`. See [VENDOR.md](bb-plugin-pstack/VENDOR.md). |
| [bb-plugin-reasoning-split](bb-plugin-reasoning-split/) | **Reasoning Split** — splits the reasoning-level selector into its own dropdown beside the model picker (e.g. `Claude Opus 4.5 | High · Normal | Build | Full access`). |
| [bb-plugin-simple-subagent](bb-plugin-simple-subagent/) | **Simple Subagent** — minimal delegation primitive. Registers one tool, `subagent`, for spawning isolated child threads: single `task`, parallel `tasks[]` (cap 4), or sequential `chain` with `{previous}` interpolation. Split out of `pstack` so other plugins can delegate without pulling the full skill set. |
| [bb-plugin-trajectory](bb-plugin-trajectory/) | **Trajectory** — DeepSeek-harness-style debug view. Full timeline of agent operations (turns, tool calls, file edits, token usage) for inspecting what an agent did. |

## Install

### One plugin

```bash
bb plugin install git:github.com/elianiva/bb-plugins@main --plugin pstack
bb plugin install git:github.com/elianiva/bb-plugins@main --plugin github-plus
bb plugin install git:github.com/elianiva/bb-plugins@main --subdirectory bb-plugin-bocchi
```

Or locally via path:

```bash
bb plugin install --yes ~/Development/personal/bb-plugins/bb-plugin-pstack
```

### All via collection manifest

`.bb/plugins.json` indexes all plugins in this repo as a collection:

```bash
bb plugin install git:github.com/elianiva/bb-plugins@main
```

`bb` records the subdirectory per install, so `bb plugin outdated` / `update` / `remove` work independently even though every plugin shares one repo.

## Development

```bash
bb plugin list
bb plugin build   # inside a plugin dir — emits dist/
bb plugin reload <id>
bb plugin dev     # watch mode
```

Plugins are `path:` installs — the directory itself is the source. `dist/` is gitignored and rebuilt at install time.

## License

Each plugin carries its own license. `bb-plugin-pstack` and `bb-plugin-github-plus` are MIT. See each `LICENSE` / `VENDOR.md` for provenance.
