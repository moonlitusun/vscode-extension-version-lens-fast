# Version Lens Fast

`Version Lens Fast` is a clean-room, performance-first fork idea inspired by the original [Version Lens](https://open-vsx.org/extension/pflannery/vscode-versionlens).

This project keeps the familiar workflow of inline dependency update lenses, but it intentionally narrows the scope to one thing first:

- `package.json` only
- public npm-compatible registries
- fast open, fast refresh, fast bulk update

## Why this fork exists

The original extension is feature-rich and supports many ecosystems. That breadth is useful, but it also means more parsing paths, more providers, and more work during refreshes.

This fork focuses on a smaller target so the common Node.js case feels much snappier:

- parse only `package.json`
- fetch registry metadata in the background
- dedupe identical requests
- cache packuments aggressively
- refresh CodeLens incrementally instead of blocking the editor

## Upstream attribution

- Original listing: [Open VSX - Version Lens](https://open-vsx.org/extension/pflannery/vscode-versionlens)
- Original source: [gitlab.com/versionlens/vscode-versionlens](https://gitlab.com/versionlens/vscode-versionlens)

This repository does not try to replace the original project. It is a focused reimplementation for users who mainly want a very fast `package.json` experience.

## Current scope

Implemented now:

- inline CodeLens for `dependencies`, `devDependencies`, `peerDependencies`, `optionalDependencies`, `bundledDependencies`, and `bundleDependencies`
- click-to-update for a single dependency
- bulk update commands for `latest`, `major`, `minor`, and `patch`
- alphabetical sorting per dependency section
- show or hide release lenses
- show or hide prerelease targets
- in-memory registry cache with TTL

Not implemented yet:

- non-`package.json` manifests
- vulnerability diagnostics
- private registry auth workflows
- custom install tasks

The code is structured so more manifest providers can be added later without rewriting the core refresh flow.

Right now the shipped provider is only:

- `package.json` manifest provider

But the internal structure already separates:

- manifest detection and parsing
- npm registry resolution
- CodeLens rendering and update commands

## Performance approach

The extension is designed to feel responsive even in larger `package.json` files:

- `provideCodeLenses` returns quickly from a local snapshot
- network fetches run in the background with bounded concurrency
- repeated dependencies share the same in-flight registry request
- document refreshes are invalidated by version, so stale responses are dropped
- toggling the lenses back on shows cached results first, then refreshes in the background with a busy indicator

## Commands

- `Version Lens Fast: Toggle release versions`
- `Version Lens Fast: Show prerelease versions`
- `Version Lens Fast: Hide prerelease versions`
- `Version Lens Fast: Clear cache`
- `Version Lens Fast: Update dependencies to latest`
- `Version Lens Fast: Update dependencies (major-only)`
- `Version Lens Fast: Update dependencies (minor-only)`
- `Version Lens Fast: Update dependencies (patch-only)`
- `Version Lens Fast: Sort dependencies alphabetically`

## Settings

- `versionLensFast.showOnStartup`
- `versionLensFast.includePrerelease`
- `versionLensFast.cacheTtlMinutes`
- `versionLensFast.registryUrl`
- `versionLensFast.maxConcurrentRequests`
- `versionLensFast.sections`

## Publish

This project is set up like a normal VS Code extension and can be packaged with:

```bash
npm install
npm run build
npx @vscode/vsce package
```

Before publishing to the VS Code Marketplace or Open VSX, update the metadata in `package.json` if you want a different `publisher`, repository URL, icon, or display copy.

## Local testing in VS Code

Open this repository in VS Code and use one of these flows:

### Install the packaged VSIX

Use `Extensions: Install from VSIX...` and select:

- `version-lens-fast-0.1.0.vsix`

### Run in Extension Development Host

This repository includes:

- `.vscode/launch.json`
- `.vscode/tasks.json`

So you can:

```bash
npm install
```

Then press `F5` in VS Code to build and launch a development host window with the extension loaded.
