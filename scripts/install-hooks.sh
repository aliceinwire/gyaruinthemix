#!/usr/bin/env bash
set -euo pipefail
cd "$(git rev-parse --show-toplevel)"
configured=$(git config --get core.hooksPath || true)
if [[ -n "$configured" && "$configured" != '.githooks' ]] || [[ -z "$configured" && -e "$(git rev-parse --git-path hooks/pre-commit)" ]]; then
  echo 'Existing hooks found. Add bash scripts/scan-secrets.sh staged to your existing pre-commit hook; no hook was overwritten.' >&2
  exit 1
fi
git config --local core.hooksPath .githooks
echo 'Installed the repository pre-commit hook. Gitleaks must be on PATH.'
