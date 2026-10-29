#!/usr/bin/env bash
# Pushes a published GitHub release to the mainland-China mirror server from THIS machine.
# The Singapore server is blocked from mainland China and the mirror cannot pull from GitHub at a usable
# speed, so the files travel GitHub -> maintainer machine -> mirror. Run it after the release is published:
#
#   scripts/sync-release-to-shanghai.sh v1.7.0 [ssh-host]     (ssh-host defaults to "uku-cn")
#
# Files land in /var/www/uku-mirror/downloads/<tag>/ and are served by nginx as
# http://<mirror-ip>/downloads/<tag>/<file>. The release's SHA256SUMS.txt is checked before and after the
# upload; nothing on the mirror is deleted (a re-run moves the previous copy aside).
set -euo pipefail

TAG="${1:?usage: sync-release-to-shanghai.sh vX.Y.Z [ssh-host]}"
HOST="${2:-uku-cn}"
REPO="${UKU_REPO:-Cheese-nya/uku-furigana}"
DEST="${UKU_MIRROR_DIR:-/var/www/uku-mirror/downloads}"
[[ $TAG =~ ^v[0-9]+\.[0-9]+\.[0-9]+$ ]] || { echo "bad tag: $TAG" >&2; exit 1; }

work="$(mktemp -d)"
trap 'rm -rf "$work"' EXIT

echo "download $TAG from GitHub"
gh release download "$TAG" --repo "$REPO" --dir "$work" \
  --pattern "Uku-Furigana-$TAG-windows.exe" --pattern "Uku-Furigana-$TAG.apk" \
  --pattern "Uku-Furigana-web-$TAG.zip" --pattern SHA256SUMS.txt

echo "verify locally"
( cd "$work" && sha256sum -c SHA256SUMS.txt )

echo "upload to $HOST"
ssh -o BatchMode=yes "$HOST" "mkdir -p '$DEST/.incoming-$TAG'"
rsync -ah --info=progress2 --partial "$work"/ "$HOST:$DEST/.incoming-$TAG/"

echo "verify on the mirror and publish"
ssh -o BatchMode=yes "$HOST" bash -s -- "$TAG" "$DEST" <<'REMOTE'
set -euo pipefail
tag=$1 dest=$2
incoming="$dest/.incoming-$tag"
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
