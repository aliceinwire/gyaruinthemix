#!/usr/bin/env bash
set -euo pipefail
set +x
cd "$(dirname "$0")/.."
kind="${1:-}"
mode="${2:---local}"
case "$kind" in stripe_secret_key|stripe_webhook_secret) ;; *) echo 'Usage: bash scripts/setup-secret.sh stripe_secret_key|stripe_webhook_secret --local|--docker' >&2; exit 1;; esac
case "$mode" in --local|--docker) ;; *) echo 'Invalid mode' >&2; exit 1;; esac
umask 077
[[ ! -L secrets ]] || { echo 'Refusing a symlinked secrets directory' >&2; exit 1; }
mkdir -p secrets
chmod 700 secrets
[[ ! -L "secrets/$kind" && ( ! -e "secrets/$kind" || -f "secrets/$kind" ) ]] || { echo 'Refusing a non-regular secret destination' >&2; exit 1; }
temporary=$(mktemp secrets/.secret.XXXXXX)
trap 'rm -f "$temporary"' EXIT
read -r -s -p "Paste $kind (hidden): " secret_value
printf '\n'
case "$kind" in
  stripe_secret_key) [[ "$secret_value" =~ ^rk_(test|live)_[a-zA-Z0-9]+$ ]] || { echo 'Use a restricted Stripe API key for test or live mode' >&2; exit 1; };;
  stripe_webhook_secret) [[ "$secret_value" =~ ^whsec_[a-zA-Z0-9]+$ ]] || { echo 'Invalid secret format' >&2; exit 1; };;
esac
printf '%s' "$secret_value" > "$temporary"
unset secret_value
if [[ "$mode" == '--docker' ]]; then
  # Standalone Compose bind-mounts file secrets: host numeric ownership matters.
  if [[ $(id -u) -eq 0 ]]; then chgrp 10001 "$temporary"; else sudo chgrp 10001 "$temporary"; fi
  chmod 0440 "$temporary"
else
  chmod 0600 "$temporary"
fi
mv -fT -- "$temporary" "secrets/$kind"
echo "Saved secrets/$kind. Recreate ONLY the API container after rotation."
