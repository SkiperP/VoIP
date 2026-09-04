#!/bin/sh
set -eu

ORIGIN_HOST="${TUNNEL_ORIGIN_HOST:-edge}"
ORIGIN_PORT="${TUNNEL_ORIGIN_PORT:-80}"
URL_FILE="${HTTPS_URL_FILE:-/runtime/https-url}"
mkdir -p "$(dirname "$URL_FILE")" /root/.ssh

extract_url() {
	printf '%s\n' "$1" | sed -n \
		-e 's/.*\(https:\/\/[a-zA-Z0-9-]*\.free\.pinggy\.net\).*/\1/p' \
		-e 's/.*\(https:\/\/[a-zA-Z0-9-]*\.run\.pinggy-free\.link\).*/\1/p' \
		| head -n 1
}

echo "line-tunnel: ssh -p 443 a.pinggy.io -> ${ORIGIN_HOST}:${ORIGIN_PORT}" >&2

while true; do
	ssh -p 443 -T \
		-o StrictHostKeyChecking=accept-new \
		-o UserKnownHostsFile=/root/.ssh/known_hosts \
		-o ServerAliveInterval=30 \
		-o ServerAliveCountMax=3 \
		-o ExitOnForwardFailure=yes \
		-o LogLevel=ERROR \
		-R "0:${ORIGIN_HOST}:${ORIGIN_PORT}" \
		a.pinggy.io 2>&1 | while IFS= read -r line; do
			printf '%s\n' "$line"
			url=$(extract_url "$line")
			if [ -n "$url" ]; then
				printf '%s\n' "$url" > "$URL_FILE"
				echo "line-tunnel: public https ${url}" >&2
			fi
		done
	echo "line-tunnel: ssh exited, retry in 3s" >&2
	sleep 3
done
