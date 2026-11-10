#!/bin/sh
# Builds dist/AlwaysOnlineTab-<version>.zip containing only runtime files.
set -eu
cd "$(dirname "$0")/.."
version=$(node -p "require('./manifest.json').version")
mkdir -p dist
out="dist/AlwaysOnlineTab-$version.zip"
rm -f "$out"
zip -qr -X "$out" manifest.json src _locales icons LICENSE
echo "$out"
