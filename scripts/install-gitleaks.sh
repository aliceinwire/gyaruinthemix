#!/usr/bin/env bash
set -euo pipefail
destination="${1:?Usage: bash scripts/install-gitleaks.sh DESTINATION_DIRECTORY}"
version=8.30.1
case "$(uname -sm)" in
  'Linux x86_64') archive=linux_x64; checksum=551f6fc83ea457d62a0d98237cbad105af8d557003051f41f3e7ca7b3f2470eb ;;
  'Linux aarch64') archive=linux_arm64; checksum=e4a487ee7ccd7d3a7f7ec08657610aa3606637dab924210b3aee62570fb4b080 ;;
  *) echo 'Install Gitleaks 8.30.1 from its official release for this architecture.' >&2; exit 1 ;;
esac
temporary=$(mktemp -d)
trap 'rm -rf "$temporary"' EXIT
curl --proto '=https' --tlsv1.2 --fail --silent --show-error --location --retry 3 \
  "https://github.com/gitleaks/gitleaks/releases/download/v${version}/gitleaks_${version}_${archive}.tar.gz" \
  -o "$temporary/gitleaks.tar.gz"
printf '%s  %s\n' "$checksum" "$temporary/gitleaks.tar.gz" | sha256sum --check --status
tar --no-same-owner -xzf "$temporary/gitleaks.tar.gz" -C "$temporary" gitleaks
mkdir -p "$destination"
install -m 0755 "$temporary/gitleaks" "$destination/gitleaks"
"$destination/gitleaks" version
