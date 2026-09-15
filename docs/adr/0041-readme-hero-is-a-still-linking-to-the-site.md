# ADR-0041 — The README's hero is a still linking to the site, not an inline video

**Date**: 2026-09-15
**Status**: Accepted

## Context

ADR-0039 built the documentation website and ADR-0040 deployed it; the README
kept the two screenshots it had, one per view. A screen recording says what
neither still can: that a card expands, that clicking a foreign key jumps to its
target, that the same document redraws as records and joins. The landing page
now plays a 33-second clip. The question was how the README plays it too.

Four GitHub behaviours decide the answer. They were measured — through GitHub's
Markdown rendering API, and by reading the HTML github.com actually serves — not
assumed:

1. **The Markdown sanitizer drops `<video>` entirely**, whatever its source.
   `<video src="./docs/trailer.mp4" controls></video>` renders `<p
   dir="auto"></p>`, and so does the same tag with an absolute URL.
2. **Markdown has no video syntax.** `![clip](./docs/trailer.mp4)` renders
   `<img src="./docs/trailer.mp4">` — a broken image icon.
3. **github.com injects the player itself**, server-side, for URLs on its own
   attachment hosts, and signs them on the way out. On `sxyazi/yazi`, whose
   author wrote a bare URL, the served page carries
   `<video src="https://private-user-images.githubusercontent.com/…mp4?jwt=…">`.
4. Further down, never reached: `raw.githubusercontent.com` serves a committed
   `.mp4` as `application/octet-stream` with `X-Content-Type-Options: nosniff`,
   so a `<video>` aimed at a repository path could not play even if one
   survived (1).

The player is therefore not something a README author enables. It is injected
by GitHub on recognising its own hosts, and the only way onto those hosts is a
drag-and-drop into a comment box — a flow with no API, nothing in the repository
to review, and nothing to regenerate from.

## Decision

**The README's hero is `docs/trailer-poster.png`, wrapped in a link to the
site**, replacing both screenshots:

```markdown
[![…](./docs/trailer-poster.png)](https://datagraph.defsquare.com/)
```

An ordinary image and an ordinary link. It renders wherever Markdown renders,
and the click lands on the landing page, where the clip plays with controls.

**The clip has exactly one copy in the repository**,
`website/static/video/trailer.mp4`, the file the landing page serves. The
poster is a frame cut from it, dimmed, with a play badge in the brand accent
(`#f65e5e`, from `packages/tokens`) and the running time. A second copy under
`docs/` was created while this was being settled and removed again: the README
does not need the video, only a still of it.

## Alternatives considered

- **Upload the clip as a GitHub attachment.** The one route to a real inline
  player, and the reason it was not taken is not quality: the result renders on
  github.com and nowhere else — npm, any mirror, any other host shows a bare
  URL — the address has no source in the repository, so it cannot be reviewed,
  diffed or regenerated, and refreshing the clip means repeating a manual
  gesture no script can perform.
- **An animated GIF on R2, so the weight stays out of git.** This one does
  render inline everywhere: GitHub proxies images from any host through Camo,
  and a GIF is an image. Rejected on what it costs per pixel — the full 33
  seconds measures 11 MB at 860 px/12 fps and 6.3 MB at 720 px/10 fps, a
  12-second excerpt 2.3 to 3.6 MB, all of it downloaded by every visitor to the
  repository page, with no playback controls and a 128-colour palette that
  visibly degrades the card text the clip exists to show. Camo caps image size
  at a value we had no way to measure, which puts the full-length variants at
  risk of not rendering at all.
- **Commit the mp4 and link to it as text.** GitHub's blob viewer does play an
  mp4, so `[watch the clip](./docs/trailer.mp4)` works in one click. Rejected:
  a text link in a wall of prose is invisible where a 1280-pixel still is not,
  and it duplicates a file the site already carries.

## Consequences

- **The hero renders everywhere**, because it is an image: github.com, npm,
  mirrors, any Markdown viewer, offline clones. The price is a click, and a
  reader who never clicks still sees sixty records and their joins.
- **The clip and its still must be regenerated together.** The poster is a
  frame of the trailer; re-record one without re-cutting the other and the
  README advertises a video that no longer exists. Nothing enforces this —
  unlike `packages/tokens`' CSS or the brand favicon, both guarded by
  byte-for-byte freshness tests.
- **The still's provenance is not scripted.** It was cut by hand, so the frame,
  the dimming and the badge are not reproducible from the repository. If the
  clip starts changing often, a `generate:poster` script beside the other
  generators is the first thing to add.
- **`docs/screenshots/` is now unreferenced.** The landing page moved to the
  clip and the README to the poster, leaving `structure.png` and `graph.png`
  (415 KB) with no consumer. They are kept rather than deleted, pending a use
  in the documentation pages ADR-0039 created.
- **Reopening this is GitHub's call, not ours.** Should `<video>` ever be
  allowed with a third-party source, the clip is already hosted and this becomes
  a one-line change.
