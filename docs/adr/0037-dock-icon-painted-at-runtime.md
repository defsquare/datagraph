# ADR-0037 — The Dock icon is painted by the process, not carried by a bundle

**Date**: 2026-09-13
**Status**: Accepted

## Context

datagraph got a mark (ADR-0036) and a complete application icon set, and the
icon still did not appear. The diagnosis, measured rather than assumed:

- `bundle.active` is `false` (ADR-0020), and the Tauri bundler is the **only**
  reader of `bundle.icon`. The five paths declared in `tauri.conf.json` were
  read by nobody.
- `bin/release.sh` tars the bare Mach-O (ADR-0033). `otool -s __TEXT
  __info_plist` on it comes back empty, and `mdls` reports
  `public.unix-executable`.
- macOS draws an application icon from a bundle's `Contents/Resources`, by way
  of `CFBundleIconFile`. A bare executable has nowhere to carry one.

The obvious repair — ship a `.app` — is not free here. Wrapping the existing
binary and adding `Contents/Resources` invalidates its ad-hoc signature:
`spctl` answers `code has no resources but signature indicates they must be
present`. Re-signing ad-hoc fixes the structure but not the reception: a
downloaded, quarantined, un-notarised `.app` is refused on double-click. Making
the icon appear that way therefore means a Developer ID, notarisation in the
release pipeline, and the yearly Apple fee — the exact cost ADR-0033 declined.
None of it currently applies, because a brew-installed binary launched from a
shell never meets Gatekeeper.

## Decision

Set the Dock tile from inside the running process, in `src-tauri/src/dock.rs`,
called from Tauri's `setup` hook: decode a PNG frozen into the binary with
`include_bytes!` and hand it to `NSApplication::setApplicationIconImage`.

`objc2` and `objc2-app-kit` become explicit macOS-only dependencies. Both were
already in `Cargo.lock` — Tauri vendors them — so this pulls nothing new; it
only stops the dependency being implicit.

This is the repository's first `unsafe` block. objc2 marks the AppKit setters
unsafe because it cannot prove the caller is on the main thread; the
`MainThreadMarker` acquired just above is that proof, and the block carries a
`SAFETY:` comment saying so and nothing more.

The icon is embedded rather than read from disk: the artifact is deliberately a
single file, and an icon loaded from a neighbouring path would be an icon that
disappears the moment someone moves the binary.

The application icon uses a **white** ground. At Dock size a tile has to hold
its own silhouette, and the canvas grey `#eef0f3` goes muddy against a light
wallpaper.

## Alternatives considered

- **Ship a `.app`, built by a release-script wrapper** — rejected for now: it
  buys the Finder icon at the price of code signing and notarisation, and it
  turns a one-file tarball into a directory. Revisit the day datagraph is
  distributed to people who do not go through the tap; on that day signing is a
  prerequisite anyway, not a cost the icon imposed.
- **`bundle.active: true`** — same Gatekeeper consequences, since they come
  from the bundle and not from who builds it, plus it would undo ADR-0020 and
  ADR-0033 by flipping a boolean instead of superseding them.
- **An `Info.plist` embedded in the binary** (`__TEXT,__info_plist`) — gives the
  process a name and an identifier, but not an icon: `CFBundleIconFile` names a
  resource file, and there is no bundle to hold one.

## Consequences

- **The Finder is unchanged.** The file on disk is still a Unix executable with
  a generic icon. The mark shows in the Dock and in the ⌘-Tab switcher, and only
  while the app runs — there is a brief moment at launch where the tile is still
  the placeholder.
- The rest of the icon set (`.icns`, `.ico`, the Windows tiles) stays generated
  and committed, and stays unread. Only `icons/icon.png` is now consumed, by
  `include_bytes!`. This refines the second consequence of ADR-0036.
- A unit test asserts the embedded bytes are a 512 px PNG. It is the only guard
  over a file produced by a macOS-only script that no test runs; without it a
  bad regeneration would reach a release as a blurred tile.
- Linux and Windows get an empty `set_icon()`. Neither needs it: both read the
  window icon from elsewhere, and neither is a supported target today.
