# GitHub Plus

GitHub Plus adds a **GitHub+** panel to BB for working with GitHub issues,
pull requests, and agent threads from one workspace.

The plugin is available as `github-plus` so it can coexist with BB's
built-in `github` plugin without a CLI command collision.

## Features

- Discover repositories from the `origin` remotes of local BB project sources.
- Track additional repositories with the `extraRepos` setting.
- Browse open and recently closed issues and pull requests from a local cache.
- Filter, search, and save named views for issues and pull requests.
- View issue discussions, pull request checks, reviews, comments, and diffs.
- Create issues and comment, close/reopen, assign, and relabel items.
- Start BB agent work from an issue or request an agent review of a pull request.
- Link a pull request to an existing BB thread.
- Use GitHub issues and pull requests as BB mention providers with `@` and `#`.
- Refresh automatically every five minutes, with retry/backoff for transient failures.

## Requirements

- BB with local plugin support.
- The [GitHub CLI](https://cli.github.com/) (`gh`).
- An authenticated GitHub CLI session for `github.com`:

  ```sh
  gh auth login
  gh auth status --hostname github.com
  ```

The authenticated account must be able to read the repositories you track and
must have the GitHub permissions required for any mutations you use.

GitHub Enterprise remotes are not currently discovered; repository remotes and
authentication target `github.com`.

## Permissions and data boundaries

The plugin uses the installed `gh` executable for GitHub API reads and writes;
it does not manage a separate GitHub token or call a second GitHub client. The
authenticated `gh` account therefore controls the repositories and mutations
available to the plugin. Creating issues, posting comments, changing state,
assigning users, and changing labels require the matching GitHub permissions.

For repository discovery, the server reads the `origin` remote from local BB
project checkouts. It writes synchronized items, health, and thread links to
the plugin's local SQLite cache. Cache contents are not sent to a separate
telemetry service by the plugin.

The five-minute background refresh is read-only. No agent thread is started and
no GitHub mutation is performed automatically; agent work and GitHub writes
begin only after the corresponding user action. The plugin has no delete-
repository or destructive filesystem operation.

Starting work from an issue creates an agent thread in the attached BB project
checkout, or in the configured default project, and that agent may edit files.
Reviewing a pull request creates a separate BB managed worktree. GitHub issue,
pull-request, comment, diff, filename, and code content is untrusted data; the
review prompt tells the agent not to treat it as instructions. The review agent
still runs with BB's supported `accept-edits` mode in that isolated worktree,
so inspect and reject changes before accepting them and do not assume the
prompt alone is an enforcement boundary. The plugin does not push changes or
post GitHub comments as part of starting either action.

## Install from this checkout

Build the plugin, then install the local checkout into BB:

```sh
npm install
npm run build
bb plugin install --yes /absolute/path/to/bb-plugin-github-plus
bb plugin enable github-plus
bb plugin reload github-plus
```

Confirm that it is running:

```sh
bb plugin list
bb github-plus --help
```

For an already installed development checkout, rebuild and reload it:

```sh
npm run build
bb plugin reload github-plus
```

Open the **GitHub+** panel in BB. The plugin's explicit command form is also
always available:

```sh
bb plugin run github-plus <command>
```

## Configuration

Open the GitHub Plus plugin settings in BB.

### Extra repositories

`Extra repositories` is a comma-separated list of GitHub repository names to
track in addition to repositories discovered from BB projects:

```text
acme/api, acme/web
```

The same setting can be changed from the CLI:

```sh
bb plugin config github-plus set extraRepos "acme/api,acme/web"
```

Repository names must use the `owner/repository` format. Invalid entries are
ignored and reported in the plugin log.

### Default BB project

`Default BB project` selects where an agent thread is created when a manually
tracked repository is not attached to a discovered BB project. Set it in the
plugin settings before using the agent actions for those repositories.

## CLI commands

All list commands read the plugin's synchronized cache. Use `sync` to request a
fresh refresh from GitHub.

```text
bb github-plus repos               List tracked repositories
bb github-plus issues [owner/repo]  List cached open issues
bb github-plus prs [owner/repo]     List cached open pull requests
bb github-plus sync                Refresh the cache from GitHub now
```

## Data and synchronization

The server stores synchronized issue, pull request, health, and
thread-link data in the plugin's local SQLite cache. The panel and mention
providers read that cache so browsing does not require a GitHub request for
every view.

Actions that change GitHub data—such as creating an issue, posting a comment,
changing state, assigning users, or changing labels—run through the GitHub CLI
and require the corresponding GitHub permission. Repository health displays
whether synchronization is healthy, partial, failed, or has not run yet.

## Running alongside BB's built-in GitHub plugin

GitHub Plus uses the command `bb github-plus`; BB's built-in plugin uses
`bb github`. Their storage and panel routes are namespaced separately, so they
do not overwrite one another. Enabling both can still produce duplicate GitHub
panels, mention suggestions, background synchronization, and API traffic.

For a single GitHub experience, keep the built-in `github` plugin disabled when
using GitHub Plus.

## Troubleshooting

### GitHub CLI is unavailable or unauthenticated

Run:

```sh
gh auth status --hostname github.com
bb plugin reload github-plus
```

If `gh` is not installed, install it from [cli.github.com](https://cli.github.com/)
and run `gh auth login`.

### A repository is missing

Check that its local BB project source has a GitHub `origin` remote, or add the
repository explicitly through `Extra repositories`. Then run:

```sh
bb github-plus sync
```

### Inspect plugin logs

```sh
bb plugin logs github-plus -n 50
```

GitHub content is treated as untrusted input. Review agent changes in BB before
accepting them, and confirm the target project before starting agent work.

## Development

The authoritative source is under `src/`; `dist/` is generated and should be
rebuilt before packaging.

```sh
npm install
npm run build
npm run typecheck
npm test
npm run check:package
npm pack --dry-run
```

`check:package` verifies source and generated-output parity, plugin metadata,
the canonical package contents, and an isolated packed-consumer install.

## License

MIT
