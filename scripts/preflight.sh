#!/usr/bin/env bash
set -euo pipefail
bouncer=${1:-"$HOME/bouncer"}
cd "$bouncer"
command -v docker >/dev/null || { echo 'Docker is unavailable on this machine.' >&2; exit 1; }
docker context show
docker ps --format 'table {{.Names}}\t{{.Image}}\t{{.Ports}}\t{{.Status}}'
docker network ls
docker compose ls
docker stats --no-stream --format 'table {{.Name}}\t{{.MemUsage}}\t{{.CPUPerc}}'
free -m
ss -ltn
uname -m
# Scoped metadata avoids printing unrelated container environment values.
while IFS= read -r container_id; do
  docker inspect --format '{{.Name}} id={{.Id}} started={{.State.StartedAt}} image={{.Image}} networks={{range $name, $_ := .NetworkSettings.Networks}}{{$name}} {{end}} project={{index .Config.Labels "com.docker.compose.project"}}' "$container_id"
done < <(docker ps -q)
docker network inspect nginx-proxy --format 'Existing network: {{.Name}} driver={{.Driver}} members={{range .Containers}}{{.Name}} {{end}}'
docker compose --project-directory "$PWD" --env-file .env -f docker-compose.yml config --quiet
cat <<'NOTICE'
Read-only preflight complete. No containers or host configuration changed.
Only deploy/bouncer/docker-compose.yml is supported. Retain the existing project.
Website services: gyaruinthemix-web; optional gyaruinthemix-api.
No new host ports. Web joins nginx-proxy; API stays on the private website network.
Default caps: web 64 MiB, optional API 192 MiB. Check real free memory and disk.
Inspect the domain, TLS routing, existing workloads and architecture before setup.
NOTICE
