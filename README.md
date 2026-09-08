# bb-plugins

A collection of [BB](https://getbb.app) plugins built for personal use. Each subdirectory is a standalone plugin with its own `package.json` and BB manifest. Install one or install all via `.bb/plugins.json`.

## Plugins

Each plugin documents itself in its own directory. One line each here.

| Plugin | What it does |
|--------|--------------|
| [bocchi](bb-plugin-bocchi/) | Cute pink theme for BB, based on [elianiva.com](https://elianiva.com). |
| [github-plus](bb-plugin-github-plus/) | GitHub issues and pull requests inside BB. Forked from the original by Tom Swift. Requires `gh` auth. |
| [pstack](bb-plugin-pstack/) | Poteto agent skills plus the `bb pstack` CLI. |
| [reasoning-split](bb-plugin-reasoning-split/) | Reasoning level as its own dropdown beside the model picker. |
| [send-capture](bb-plugin-send-capture/) | Agents send verification screenshots and recordings inline. |
| [simple-subagent](bb-plugin-simple-subagent/) | Minimal `subagent` tool for spawning child threads. |
| [trajectory](bb-plugin-trajectory/) | Timeline view of agent turns, tool calls, edits, and tokens. |
| [sidebar](bb-sidebar/) | Stable thread list with ordering, snooze, settle, and bulk actions. Forked from [yusuf8834/bb-sidebar](https://github.com/yusuf8834/bb-sidebar). |

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
