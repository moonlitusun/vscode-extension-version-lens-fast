# Version Lens Fast

`Version Lens Fast` is a focused, performance-first VS Code extension for checking and updating dependencies inside `package.json`.

It keeps the most useful part of the original Version Lens workflow, inline version actions directly in the editor, but narrows the scope to the most common JavaScript use case so the experience stays fast and predictable.

## Demo

![Version Lens Fast demo](images/CleanShot%202026-03-22%20at%2009.49.26.gif)

## Why this exists

The original [Version Lens](https://open-vsx.org/extension/pflannery/vscode-versionlens) is a strong extension with broad ecosystem support. That breadth is valuable, but it also means more parser paths, more provider logic, and more work per refresh.

This project takes a different tradeoff:

- support `package.json` first
- optimize heavily for responsiveness
- keep the codebase small and readable
- preserve room for more manifest providers later

The goal is simple: make the `package.json` case feel fast enough that you want to leave it on all the time.

## What it does

- Shows inline update actions above dependencies in `package.json`
- Supports `dependencies`, `devDependencies`, `peerDependencies`, `optionalDependencies`, `bundledDependencies`, and `bundleDependencies`
- Updates one dependency at a time without replacing the whole file
- Supports bulk updates for `latest`, `major`, `minor`, and `patch`
- Sorts dependency sections alphabetically
- Can include or exclude prerelease versions
- Shows cached results immediately when toggled back on, then refreshes in the background
- Keeps the editor title bar minimal, with a single release toggle button
- Respects npm registry configuration from `.npmrc`, user config, and registry auth tokens

## What it does not do yet

- Other manifest formats such as `requirements.txt`, `pom.xml`, or `Cargo.toml`
- Vulnerability diagnostics
- Custom install tasks

The internals already separate manifest parsing, registry resolution, and editor rendering, so adding more providers later does not require rewriting the core refresh flow.

## Performance design

This extension is built around a few specific performance choices:

- `provideCodeLenses` returns quickly from a local snapshot instead of waiting on the network
- Registry lookups are deduplicated so repeated requests for the same package do not fan out
- Results are cached in memory with TTL control
- Document refresh is incremental, so changing one dependency only re-checks that dependency
- Toggling the lenses back on prefers cached results first, then performs a background refresh
- Dependency updates use targeted text ranges instead of replacing the whole document, which avoids view jumps

## Commands

The editor title bar intentionally stays minimal: it keeps a single release toggle button. Less-frequent actions such as prerelease toggling and bulk updates are available from the Command Palette.

- `Version Lens Fast: Toggle release versions`
  Shows or hides the inline dependency update actions for the active `package.json`.

- `Version Lens Fast: Toggle prerelease versions`
  Switches prerelease versions on or off when computing available updates.

- `Version Lens Fast: Clear cache`
  Clears the in-memory registry cache so the next refresh pulls fresh package metadata.

- `Version Lens Fast: Update dependencies to latest`
  Updates all dependencies in the active file to the latest available target recognized by the extension.

- `Version Lens Fast: Update dependencies (major-only)`
  Updates only dependencies that have a newer major version available.

- `Version Lens Fast: Update dependencies (minor-only)`
  Updates only dependencies that have a newer minor version available.

- `Version Lens Fast: Update dependencies (patch-only)`
  Updates only dependencies that have a newer patch version available.

- `Version Lens Fast: Sort dependencies alphabetically`
  Sorts supported dependency sections in the active `package.json` without changing their group structure.

## Settings

- `versionLensFast.showOnStartup`
  Controls whether the release lenses are visible when a supported file opens.

- `versionLensFast.includePrerelease`
  Includes prerelease versions such as `alpha`, `beta`, and `rc` in update targets.

- `versionLensFast.cacheTtlMinutes`
  Sets how long registry results stay warm in memory before the extension considers them stale.

- `versionLensFast.registryUrl`
  Explicitly overrides the registry base URL. If you leave it at the default value, the extension uses your npm config and `.npmrc` files instead.

- `versionLensFast.maxConcurrentRequests`
  Limits how many package metadata requests can run at the same time.

- `versionLensFast.sections`
  Controls which top-level `package.json` sections are scanned.

## Local development

### Run locally in VS Code

This repository includes:

- `.vscode/launch.json`
- `.vscode/tasks.json`

So you can run it locally with:

```bash
npm install
```

Then press `F5` in VS Code to launch an Extension Development Host window.

### Install the packaged VSIX

To test the packaged extension directly:

```bash
npm run package
```

Then use `Extensions: Install from VSIX...` and choose:

- `version-lens-fast-0.1.0.vsix`

## Quality checks

This repository includes unit tests for:

- npm registry resolution and caching
- `package.json` dependency parsing and editable ranges
- provider-level incremental refresh behavior

Run everything locally with:

```bash
npm test
```

Build and package manually with:

```bash
npm run build
npm run package
```

## Publishing

This project is structured like a normal VS Code extension and can be published with `vsce`.

Before publishing, make sure:

- the `publisher` field in `package.json` matches your Marketplace publisher
- your PAT has Marketplace publish permissions
- your repository metadata and listing copy are set the way you want

## Upstream attribution

This extension is a focused reimplementation inspired by the original Version Lens project.

- Original listing: [Open VSX - Version Lens](https://open-vsx.org/extension/pflannery/vscode-versionlens)
- Original source: [gitlab.com/versionlens/vscode-versionlens](https://gitlab.com/versionlens/vscode-versionlens)

This project does not try to replace upstream. It exists to provide a smaller, faster `package.json`-first experience while keeping the door open for future expansion.
