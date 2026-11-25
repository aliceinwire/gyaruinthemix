#!/bin/sh
# Sourced by the web entrypoint. Disabled until a local password is provisioned.
: > /tmp/analytics-log.conf
printf '%s\n' 'location = /analytics { return 404; }' 'location ^~ /analytics/ { return 404; }' > /tmp/analytics-location.conf
if [ "${ANALYTICS_ENABLED:-false}" = true ] && [ -s /var/lib/analytics/password.sha256 ]; then
  if node --input-type=module -e "import { accessSync, constants } from 'node:fs'; accessSync('/var/lib/analytics', constants.W_OK)"; then
    cp /etc/nginx/analytics-proxy.conf /tmp/analytics-location.conf
    printf '%s\n' 'access_log syslog:server=127.0.0.1:3003,tag=analytics,nohostname analytics if=$analytics_count;' > /tmp/analytics-log.conf
    # Restart independently if collection stops; nginx keeps serving the site.
    (
      while :; do
        node --max-old-space-size=32 /opt/analytics/server.mjs
        echo 'Analytics stopped; retrying in 10 seconds.' >&2
        sleep 10
      done
    ) &
  fi
elif [ "${ANALYTICS_ENABLED:-false}" = true ]; then
  echo 'Analytics disabled: provision its password before restarting the web service.' >&2
fi
