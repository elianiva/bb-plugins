# bb-plugins

Personal, semi-private BB plugins collection — rough/WIP quality, kept here mainly so I can pull them onto other machines. Not submitted to the BB Community marketplace. Each subdirectory is a standalone plugin with its own `package.json` and bb manifest; `.bb/plugins.json` indexes them as a collection.

| Plugin | Source | Description |
|--------|--------|-------------|
| [bb-plugin-pstack](file:///Users/elianiva/Development/personal/bb-plugins/bb-plugin-pstack) | `bb-plugin-pstack` | Port of poteto's pstack (cursor/plugins/pstack + pi-pstack) — 43+ skills, poteto-mode, subagents, `bb pstack` CLI |
| [bb-plugin-opencode-go-usage](file:///Users/elianiva/Development/personal/bb-plugins/bb-plugin-opencode-go-usage) | `bb-plugin-opencode-go-usage` | OpenCode Go quota viewer (`bb opencode-go-usage`) |
| [bb-plugin-trajectory](file:///Users/elianiva/Development/personal/bb-plugins/bb-plugin-trajectory) | `bb-plugin-trajectory` | DeepSeek-harness-style debug view — full log of agent operations (turns, tool calls, file ops, tokens) |
| [bb-plugin-bocchi](file:///Users/elianiva/Development/personal/bb-plugins/bb-plugin-bocchi) | `bb-plugin-bocchi` | Pink cute Bocchi theme — soft gradient |
| [bb-plugin-reasoning-split](file:///Users/elianiva/Development/personal/bb-plugins/bb-plugin-reasoning-split) | `bb-plugin-reasoning-split` | Splits reasoning level into its own dropdown beside the model picker |

## Usage

### Local (this machine)

```bash
# install / move
bb plugin install --yes ~/Development/personal/bb-plugins/bb-plugin-pstack
bb plugin install --yes ~/Development/personal/bb-plugins/bb-plugin-opencode-go-usage

# verify
bb plugin list
bb pstack status
bb opencode-go-usage --help

# after edits
bb plugin build   # inside plugin dir, emits dist/
bb plugin reload <id>
# or watch
bb plugin dev
```

Plugins are `path:` installs — the directory itself is the source. `dist/` is gitignored and rebuilt by bb at install time; run `bb plugin build` locally before `bb plugin reload` to pick up edits.

### On another machine (from this repo)

```bash
# by name, via .bb/plugins.json
bb plugin install git:github.com/elianiva/bb-plugins@main --plugin pstack
bb plugin install git:github.com/elianiva/bb-plugins@main --plugin trajectory

# or by subdirectory, no manifest needed
bb plugin install git:github.com/elianiva/bb-plugins@main --subdirectory bb-plugin-bocchi
```

bb records the subdirectory per install, so `bb plugin outdated`/`update`/`remove` keep working independently even though every plugin shares this one repo.
