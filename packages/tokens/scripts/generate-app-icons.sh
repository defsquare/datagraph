#!/usr/bin/env bash
# Rasterises the application icon set into apps/demo/src-tauri/icons/.
#
# Kept out of `pnpm test` and out of any build on purpose: it needs
# rsvg-convert (brew install librsvg) and iconutil (macOS only). The output is
# committed, so nobody else has to own that toolchain.
#
#   packages/tokens/scripts/generate-app-icons.sh
#
# Sizes below 48 px are cut from the MIN artwork: at that scale the bracket is
# a single pixel row and the full mark turns to mud. That threshold is the
# whole reason two source files exist.

set -euo pipefail

here="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
brand="$here/../brand"
out="$here/../../../apps/demo/src-tauri/icons"

for tool in rsvg-convert iconutil; do
  command -v "$tool" >/dev/null || { echo "missing: $tool" >&2; exit 1; }
done

mkdir -p "$out"

# render <size> <target-png>
render() {
  local size="$1" target="$2" src="$brand/datagraph-appicon.svg"
  [ "$size" -lt 48 ] && src="$brand/datagraph-appicon-min.svg"
  rsvg-convert -w "$size" -h "$size" "$src" -o "$target"
}

# --- The five files tauri.conf.json names, plus the raw icon.png.
render 32   "$out/32x32.png"
render 128  "$out/128x128.png"
render 256  "$out/128x128@2x.png"
render 512  "$out/icon.png"

# --- Windows Store assets shipped by the Tauri template.
render 30  "$out/Square30x30Logo.png"
render 44  "$out/Square44x44Logo.png"
render 71  "$out/Square71x71Logo.png"
render 89  "$out/Square89x89Logo.png"
render 107 "$out/Square107x107Logo.png"
render 142 "$out/Square142x142Logo.png"
render 150 "$out/Square150x150Logo.png"
render 284 "$out/Square284x284Logo.png"
render 310 "$out/Square310x310Logo.png"
render 50  "$out/StoreLogo.png"

# --- .icns, through the iconset layout iconutil expects.
iconset="$(mktemp -d)/datagraph.iconset"
mkdir -p "$iconset"
for pair in 16:icon_16x16 32:icon_16x16@2x 32:icon_32x32 64:icon_32x32@2x \
            128:icon_128x128 256:icon_128x128@2x 256:icon_256x256 \
            512:icon_256x256@2x 512:icon_512x512 1024:icon_512x512@2x; do
  render "${pair%%:*}" "$iconset/${pair##*:}.png"
done
iconutil -c icns "$iconset" -o "$out/icon.icns"
rm -rf "$(dirname "$iconset")"

# --- .ico. ImageMagick is not a dependency here: an ICO is a short header
#     followed by whole PNG files, and Vista onwards reads that form.
ico_tmp="$(mktemp -d)"
for size in 16 24 32 48 64 128 256; do render "$size" "$ico_tmp/$size.png"; done
python3 - "$ico_tmp" "$out/icon.ico" <<'PY'
import struct, sys
from pathlib import Path

tmp, target = Path(sys.argv[1]), Path(sys.argv[2])
sizes = [16, 24, 32, 48, 64, 128, 256]
blobs = [(s, (tmp / f"{s}.png").read_bytes()) for s in sizes]

offset = 6 + 16 * len(blobs)
header = struct.pack("<HHH", 0, 1, len(blobs))
entries, payload = b"", b""
for size, blob in blobs:
    # 256 is stored as 0: the field is one byte wide.
    entries += struct.pack("<BBBBHHII", size % 256, size % 256, 0, 0, 1, 32, len(blob), offset)
    payload += blob
    offset += len(blob)
target.write_bytes(header + entries + payload)
print(f"écrit: {target}")
PY
rm -rf "$ico_tmp"

echo "écrit: $out (icônes applicatives)"
