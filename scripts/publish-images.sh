#!/usr/bin/env bash
# Called only by the trusted main job after its exact local images pass smoke tests.
set -euo pipefail
[[ ${GITHUB_ACTIONS:-} == true && ${RUNNER_ENVIRONMENT:-} == github-hosted ]]
[[ ${GITHUB_EVENT_NAME:-} == push && ${GITHUB_REF:-} == refs/heads/main ]]
[[ ${GITHUB_REPOSITORY:-} == aliceinwire/gyaruinthemix ]]
[[ ${GITHUB_SHA:-} =~ ^[0-9a-f]{40}$ ]]
registry=ghcr.io/aliceinwire/gyaruinthemix
names=(web web-api api)
images=("gyaruinthemix-web:release-links-$GITHUB_SHA" "gyaruinthemix-web:release-api-$GITHUB_SHA" "gyaruinthemix-api:release-api-$GITHUB_SHA")
# Refuse any source mismatch before authenticating or moving a registry tag.
for image in "${images[@]}"; do
  [[ $(docker image inspect "$image" --format '{{index .Config.Labels "org.opencontainers.image.revision"}}') == "$GITHUB_SHA" ]]
  [[ $(docker image inspect "$image" --format '{{index .Config.Labels "org.opencontainers.image.source"}}') == "https://github.com/$GITHUB_REPOSITORY" ]]
done
[[ $(docker image inspect "${images[0]}" --format '{{index .Config.Labels "io.gyaruinthemix.checkout-mode"}}') == payment_links ]]
[[ $(docker image inspect "${images[1]}" --format '{{index .Config.Labels "io.gyaruinthemix.checkout-mode"}}') == api ]]
export DOCKER_CONFIG
DOCKER_CONFIG=$(mktemp -d)
trap 'rm -rf "$DOCKER_CONFIG"' EXIT
printf '%s' "$GHCR_TOKEN" | docker login ghcr.io -u "$GITHUB_ACTOR" --password-stdin
unset GHCR_TOKEN
for index in "${!names[@]}"; do
  destination="$registry-${names[$index]}"
  docker tag "${images[$index]}" "$destination:sha-$GITHUB_SHA"
  docker push "$destination:sha-$GITHUB_SHA"
done
# Moving tags is not atomic; API-mode updater checks both revision labels first.
for index in 2 1 0; do
  destination="$registry-${names[$index]}"
  docker tag "${images[$index]}" "$destination:main"
  docker push "$destination:main"
done
