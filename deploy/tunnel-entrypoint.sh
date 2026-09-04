#!/bin/sh
set -eu

ORIGIN="${TUNNEL_ORIGIN:-http://edge:80}"
URL_FILE="${HTTPS_URL_FILE:-/runtime/https-url}"
mkdir -p "$(dirname "$URL_FILE")"

extract_url() {
	# cloudflared prints: https://adjective-noun-size.trycloudflare.com
	printf '%s\n' "$1" | sed -n 's/.*\(https:\/\/[a-zA-Z0-9.-]*trycloudflare.com\).*/\1/p' | head -n 1
}

echo "line-tunnel: opening quick tunnel to ${ORIGIN}" >&2

cloudflared tunnel --no-autoupdate --protocol http2 --url "$ORIGIN" 2>&1 | while IFS= read -r line; do
	printf '%s\n' "$line"
	url=$(extract_url "$line")
	if [ -n "$url" ]; then
		printf '%s\n' "$url" > "$URL_FILE"
		echo "line-tunnel: public https ${url}" >&2
	fi
done
