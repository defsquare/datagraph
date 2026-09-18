# Changelog

All notable changes to datagraph are documented here. The format follows
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/), the versions follow
[Semantic Versioning](https://semver.org/spec/v2.0.0.html). `bin/release.sh`
refuses to tag a version that has no section below, and copies that section
into the tag's annotation.

## [Unreleased]

## [0.2.0] - 2026-09-18

### Added

- Tree view, a third view beside the graph and structure views. Its containment
  is re-derived from the references; it opens fully expanded and flows top to
  bottom.
- One toolbar button per view, the active one pressed.
- Documentation website at https://datagraph.defsquare.com, a Hugo site
  deployed as an assets-only Cloudflare Worker.

### Changed

- The README defers user documentation to the website and opens on a still
  linking to it.

## [0.1.2] - 2026-09-15

### Changed

- All user-visible UI strings are in English.

## [0.1.1] - 2026-09-14

### Changed

- The repository's home is GitHub; the Claude plugin marketplace moves to the
  org repo.

## [0.1.0] - 2026-09-12

### Added

- First release: an arm64 macOS binary and its Homebrew tap.

[Unreleased]: https://github.com/defsquare/datagraph/compare/v0.2.0...HEAD
[0.2.0]: https://github.com/defsquare/datagraph/compare/v0.1.2...v0.2.0
[0.1.2]: https://github.com/defsquare/datagraph/compare/v0.1.1...v0.1.2
[0.1.1]: https://github.com/defsquare/datagraph/compare/v0.1.0...v0.1.1
[0.1.0]: https://github.com/defsquare/datagraph/releases/tag/v0.1.0
