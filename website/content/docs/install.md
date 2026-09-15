---
title: Install datagraph
linkTitle: Install
weight: 1
---

`datagraph` is the demo app packaged as a Tauri v2 desktop binary. Point it at a JSON document and it opens the canvas, with no project to set up and no code to write.

## macOS, Apple silicon

Each release uploads the prebuilt binary to Defsquare's download host and pushes the matching formula to the Defsquare tap, so the shortest route is Homebrew:

```bash
brew install defsquare/tap/datagraph
```

Later versions arrive with `brew upgrade datagraph`. Without Homebrew, take the tarball directly; that URL always serves the most recent release:

```bash
curl -fsSL https://dl.datagraph.defsquare.com/datagraph/datagraph-darwin-arm64.tar.gz | tar -xz
sudo mv datagraph /usr/local/bin/
```

Verify:

```bash
datagraph --help
```

### The quarantine caveat

The binary is not signed by an Apple Developer identity. In practice that changes nothing for either route above: `curl` sets no `com.apple.quarantine` attribute on what it writes (Homebrew downloads with `curl` too), so Gatekeeper never assesses the file and neither install prompts.

A **browser** download does set the attribute, and macOS then refuses to open the binary. Clear it once:

```bash
xattr -d com.apple.quarantine ./datagraph
```

{{< callout type="info" >}}
There is no `.app` and no `.dmg` on any platform. `tauri build` produces a raw executable meant to be launched from a shell, which is what makes the CLI arguments useful in the first place.
{{< /callout >}}

## Build from source

The fallback on any platform, and the only route on Intel Macs, Linux and Windows. You need pnpm and a Rust toolchain (Tauri v2).

```bash
git clone https://github.com/defsquare/datagraph.git && cd datagraph
pnpm install
pnpm --filter demo tauri build   # → apps/demo/src-tauri/target/release/datagraph
```

The built binary is not on your `PATH`; symlink it somewhere that is:

```bash
ln -s "$PWD/apps/demo/src-tauri/target/release/datagraph" /usr/local/bin/datagraph
```

## The npm package

`@defsquare/datagraph` — the embeddable JS renderer — **is not published yet**. It lives in the repository at [`packages/renderer`](https://github.com/defsquare/datagraph/tree/main/packages/renderer), with the headless [`packages/core`](https://github.com/defsquare/datagraph/tree/main/packages/core) underneath it, and both are built and tested on every change; neither has a version on npm, so there is no install command to give you. See [JS API](/docs/api/) for what the surface looks like today.

Until then, the desktop binary above is the supported way to use `datagraph`.

## Related

- [Getting started](/docs/getting-started/)
- [Config: ids, refs, groups](/docs/config/)
- [The Claude Code plugin](/docs/plugin/)
