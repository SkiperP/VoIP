#!/usr/bin/env bash
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
mkdir -p "$ROOT/bin"
VERSION="${LIVEKIT_VERSION:-1.13.6}"
ARCHIVE="livekit_${VERSION}_linux_amd64.tar.gz"
URL="https://github.com/livekit/livekit/releases/download/v${VERSION}/${ARCHIVE}"
if [[ -x "$ROOT/bin/livekit-server" ]]; then
  echo "livekit-server already in bin/"
  exit 0
fi
curl -fsSL "$URL" -o "/tmp/${ARCHIVE}"
tar -xzf "/tmp/${ARCHIVE}" -C "$ROOT/bin" livekit-server
chmod +x "$ROOT/bin/livekit-server"
echo "installed $ROOT/bin/livekit-server"
