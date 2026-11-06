#!/bin/sh
# Only the podcast directory delivered by the VPS enables file discovery.
if [ -d /podcast-source ]; then
  (
    while :; do
      flock /var/lib/podcast/refresh.lock node --max-old-space-size=48 /opt/podcast/index.mjs || echo 'Podcast refresh failed; keeping the last published index.' >&2
      sleep 60
    done
  ) &
fi
exec nginx "$@"
