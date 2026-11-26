#!/usr/bin/env bash
# Copies a published GitHub release onto the website server so it can be downloaded without GitHub
# (release downloads stall for many users in mainland China). The server pulls the files itself,
# verifies them against the release's SHA256SUMS.txt, and only then makes them visible.
#
#   scripts/sync-release-to-server.sh v1.3.0 [ssh-host]      (ssh-host defaults to "huawei")
#
# Files land in /var/www/saiaino.xyz/html/downloads/<tag>/ and are served by nginx as
# https://saiaino.xyz/downloads/<tag>/<file>. Nothing is ever deleted: re-running for a tag moves the
# previous copy aside, and old versions stay until you remove them by hand.
set -euo pipefail

TAG="${1:?usage: sync-release-to-server.sh vX.Y.Z [ssh-host]}"
HOST="${2:-huawei}"
REPO="${UKU_REPO:-Cheese-nya/uku-furigana}"
DEST="${UKU_DOWNLOAD_DIR:-/var/www/saiaino.xyz/html/downloads}"

ssh -o BatchMode=yes "$HOST" bash -s -- "$TAG" "$REPO" "$DEST" <<'REMOTE'
set -euo pipefail
tag=$1 repo=$2 dest=$3
[[ $tag =~ ^v[0-9]+\.[0-9]+\.[0-9]+$ ]] || { echo "bad tag: $tag" >&2; exit 1; }

incoming="$dest/.incoming-$tag"
mkdir -p "$dest" "$incoming"
base="https://github.com/$repo/releases/download/$tag"
files=(
  "Uku-Furigana-$tag-windows.exe"
  "Uku-Furigana-$tag-macos-arm64.dmg"
  "Uku-Furigana-$tag-macos-x86_64.dmg"
  "Uku-Furigana-$tag.apk"
  "Uku-Furigana-web-$tag.zip"
  "SHA256SUMS.txt"
)

for f in "${files[@]}"; do
  echo "fetch $f"
  curl -fsSL --retry 3 --connect-timeout 15 -o "$incoming/$f" "$base/$f"
done

echo "verify"
( cd "$incoming" && sha256sum -c SHA256SUMS.txt )

chown -R www-data:www-data "$incoming"
chmod 755 "$incoming"
chmod 644 "$incoming"/*

if [ -e "$dest/$tag" ]; then
  mv "$dest/$tag" "$dest/.replaced-$tag-$(date +%Y%m%d%H%M%S)"
fi
mv "$incoming" "$dest/$tag"
echo "published: $dest/$tag"
ls -l "$dest/$tag"
REMOTE
