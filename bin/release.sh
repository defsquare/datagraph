#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")/.."

# Load local, git-ignored release config if present, so the operator sets
# DATAGRAPH_* once instead of exporting them in every shell. Copy
# bin/release.env.example to bin/release.env and fill it in (its values override
# the current environment). Point DATAGRAPH_RELEASE_ENV elsewhere to use a
# different file. No secrets/bucket/URL live in tracked files.
ENV_FILE="${DATAGRAPH_RELEASE_ENV:-bin/release.env}"
if [ -f "$ENV_FILE" ]; then
  echo "==> [config] loading $ENV_FILE"
  set -a; . "$ENV_FILE"; set +a
fi

# Usage: bin/release.sh <version> [--skip-build] [--dry-run]
#   <version>     e.g. 0.1.0 (no leading v)
#   --skip-build  reuse an existing universal binary (fast iteration)
#   --dry-run     do everything except upload, tag and tap push (prints what it would do)

BINARY="apps/demo/src-tauri/target/universal-apple-darwin/release/datagraph"
STABLE_ASSET="datagraph-macos.tar.gz"

SKIP_BUILD=0
DRY_RUN=0
VERSION=""

for arg in "$@"; do
  case "$arg" in
    --skip-build) SKIP_BUILD=1 ;;
    --dry-run)    DRY_RUN=1 ;;
    -*)           echo "Unknown flag: $arg" >&2; exit 2 ;;
    *)  [ -z "$VERSION" ] || { echo "Unexpected extra argument: $arg" >&2; exit 2; }
        VERSION="$arg" ;;
  esac
done

[ -n "$VERSION" ] || { echo "Usage: bin/release.sh <version> [--skip-build] [--dry-run]" >&2; exit 2; }

[[ "$VERSION" =~ ^[0-9]+\.[0-9]+\.[0-9]+([.-][0-9A-Za-z]+)*$ ]] || {
  echo "Invalid version: $VERSION (expected e.g. 0.1.0)" >&2; exit 2; }

TAG="v${VERSION}"
ARTIFACT="dist/datagraph-${VERSION}-macos-universal.tar.gz"

require_env() {
  local missing=0
  for v in "$@"; do
    if [ -z "${!v:-}" ]; then echo "Missing required env: $v" >&2; missing=1; fi
  done
  [ "$missing" -eq 0 ] || exit 2
}

preflight() {
  echo "==> [preflight] $TAG from a clean tree"
  local problem=""
  [ -z "$(git status --porcelain)" ] || problem="working tree is dirty; commit or stash before releasing"
  if git rev-parse -q --verify "refs/tags/$TAG" >/dev/null; then
    problem="tag $TAG already exists"
  fi
  # `return 0`, not bare `return`: a bare return would inherit the failed
  # test's status 1 and `set -e` would kill the script on the happy path.
  [ -n "$problem" ] || return 0
  [ "$DRY_RUN" -eq 1 ] || { echo "$problem" >&2; exit 1; }
  echo "    WARNING: $problem (dry-run: continuing)"
}

build() {
  if [ "$SKIP_BUILD" -eq 1 ]; then
    echo "==> [build] skipped (--skip-build); using existing $BINARY"
  else
    echo "==> [build] universal binary"
    pnpm build
    pnpm --filter demo tauri build --target universal-apple-darwin
  fi

  if [ ! -x "$BINARY" ]; then
    [ "$DRY_RUN" -eq 1 ] || { echo "$BINARY missing; drop --skip-build" >&2; exit 1; }
    echo "    WARNING: $BINARY missing (dry-run: continuing without it)"
    return
  fi

  # lipo invalidates the arm64 slice's signature, and macOS refuses to run an
  # arm64 binary whose signature is broken; ad-hoc signing restores a valid one.
  echo "==> [sign] ad-hoc re-sign"
  codesign --force -s - "$BINARY"

  echo "==> [smoke] $BINARY --help"
  "$BINARY" --help >/dev/null
}

SHA256=""

package() {
  if [ ! -f "$BINARY" ]; then
    echo "==> [package] DRY-RUN would tar $BINARY into $ARTIFACT"
    SHA256="<sha256>"
    return
  fi
  mkdir -p dist
  echo "==> [package] $ARTIFACT"
  tar czf "$ARTIFACT" -C "$(dirname "$BINARY")" datagraph
  SHA256="$(shasum -a 256 "$ARTIFACT" | awk '{print $1}')"
  echo "    sha256: $SHA256"
}

DOWNLOAD_URL=""
LATEST_URL=""

upload() {
  local key="datagraph/$(basename "$ARTIFACT")"
  local stable_key="datagraph/${STABLE_ASSET}"
  DOWNLOAD_URL="${DATAGRAPH_DL_BASE_URL:-<dl-base-url>}/${key}"
  LATEST_URL="${DATAGRAPH_DL_BASE_URL:-<dl-base-url>}/${stable_key}"
  # Same bytes under two keys: the stable one is what the README's copy-paste
  # install curls, the versioned one is what the formula pins so an old formula
  # keeps installing its own version.
  if [ "$DRY_RUN" -eq 1 ]; then
    echo "==> [upload] DRY-RUN would put r2://${DATAGRAPH_R2_BUCKET:-<bucket>}/${key} via wrangler"
    echo "    url: $DOWNLOAD_URL"
    echo "==> [upload] DRY-RUN would put r2://${DATAGRAPH_R2_BUCKET:-<bucket>}/${stable_key} via wrangler"
    echo "    url: $LATEST_URL"
    return
  fi
  require_env DATAGRAPH_R2_BUCKET DATAGRAPH_DL_BASE_URL
  DOWNLOAD_URL="${DATAGRAPH_DL_BASE_URL}/${key}"
  LATEST_URL="${DATAGRAPH_DL_BASE_URL}/${stable_key}"
  # Auth comes from a prior `wrangler login` (OAuth, stored locally); no creds in env.
  # npx runs wrangler without a global install; --remote targets the real bucket.
  echo "==> [upload] r2://${DATAGRAPH_R2_BUCKET}/${key} (wrangler)"
  npx --yes wrangler r2 object put "${DATAGRAPH_R2_BUCKET}/${key}" \
    --file "$ARTIFACT" \
    --content-type application/gzip \
    --remote
  echo "    url: $DOWNLOAD_URL"
  echo "==> [upload] r2://${DATAGRAPH_R2_BUCKET}/${stable_key} (wrangler)"
  npx --yes wrangler r2 object put "${DATAGRAPH_R2_BUCKET}/${stable_key}" \
    --file "$ARTIFACT" \
    --content-type application/gzip \
    --remote
  echo "    url: $LATEST_URL"
}

release() {
  # Unlike specy the version is also recorded as a git tag; the hosting itself
  # needs no GitLab release — R2 serves the bytes.
  if [ "$DRY_RUN" -eq 1 ]; then
    echo "==> [release] DRY-RUN would tag $TAG and push it"
    return
  fi
  echo "==> [release] tagging $TAG"
  git tag "$TAG"
  git push origin "$TAG"
}

publish_formula() {
  local rendered
  rendered="$(sed \
    -e "s|@@VERSION@@|${VERSION}|g" \
    -e "s|@@URL@@|${DOWNLOAD_URL}|g" \
    -e "s|@@SHA256@@|${SHA256}|g" \
    Formula/datagraph.rb.tmpl)"

  if [ "$DRY_RUN" -eq 1 ]; then
    echo "==> [formula] DRY-RUN rendered formula:"
    echo "$rendered"
    return
  fi
  require_env DATAGRAPH_TAP_DIR
  [ -d "$DATAGRAPH_TAP_DIR/.git" ] || { echo "DATAGRAPH_TAP_DIR is not a git checkout: $DATAGRAPH_TAP_DIR" >&2; exit 2; }
  mkdir -p "$DATAGRAPH_TAP_DIR/Formula"
  printf '%s\n' "$rendered" > "$DATAGRAPH_TAP_DIR/Formula/datagraph.rb"
  echo "==> [formula] wrote $DATAGRAPH_TAP_DIR/Formula/datagraph.rb"
  git -C "$DATAGRAPH_TAP_DIR" add Formula/datagraph.rb
  git -C "$DATAGRAPH_TAP_DIR" commit -m "datagraph ${VERSION}"
  git -C "$DATAGRAPH_TAP_DIR" push
  echo "==> [formula] pushed"
}

preflight
build
package
upload
release
publish_formula
echo "==> done: $DOWNLOAD_URL ($SHA256)"
