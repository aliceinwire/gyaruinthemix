#!/usr/bin/env bash
set -euo pipefail
cd "$(git rev-parse --show-toplevel)"
command -v gitleaks >/dev/null || { echo 'Install Gitleaks using scripts/install-gitleaks.sh; scan cannot be skipped.' >&2; exit 2; }
[[ $(gitleaks version) == '8.30.1' ]] || { echo 'Use the pinned Gitleaks 8.30.1 release.' >&2; exit 2; }
arguments=(--config .gitleaks.toml --redact=100 --no-banner --no-color --ignore-gitleaks-allow --gitleaks-ignore-path /dev/null --max-decode-depth 2)
case "${1:-history}" in
  history) exec gitleaks git "${arguments[@]}" --log-opts='--all' . ;;
  staged) exec gitleaks git "${arguments[@]}" --pre-commit --staged . ;;
  *) echo 'Usage: bash scripts/scan-secrets.sh history|staged' >&2; exit 2 ;;
esac
