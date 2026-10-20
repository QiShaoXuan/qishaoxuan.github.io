#!/usr/bin/env bash
set -Eeuo pipefail

# Install the release's locked production dependencies before invoking this script.
[[ $(id -un) == resume ]] || { echo 'Run as the resume user.' >&2; exit 1; }
[[ $# == 1 && $1 == /srv/resume/releases/* ]] || { echo 'Usage: activate-api.sh /srv/resume/releases/<release>' >&2; exit 1; }
release=$(realpath -e -- "$1")
[[ $release == /srv/resume/releases/* && $release == "$1" && -d $release ]] || { echo 'Release must be a canonical directory below /srv/resume/releases.' >&2; exit 1; }
for file in server.js package.json package-lock.json node_modules/fastify/package.json; do
  [[ -f $release/$file ]] || { echo "Missing release file: $file" >&2; exit 1; }
done
[[ -r /etc/resume/resume.env ]] || { echo 'Cannot read /etc/resume/resume.env.' >&2; exit 1; }
exec 9>/srv/resume/.activate-api.lock
flock -n 9 || { echo 'Another API activation is in progress.' >&2; exit 1; }
[[ -L /srv/resume/current ]] || { echo 'Current release must already be a symlink.' >&2; exit 1; }
previous=$(readlink -f /srv/resume/current)
[[ -d $previous && -f $previous/server.js ]] || { echo 'Previous release cannot be used for rollback.' >&2; exit 1; }
[[ $previous != "$release" ]] || { echo 'Release is already active.' >&2; exit 1; }
temporary=$(mktemp -d /tmp/resume-api-check.XXXXXX)
next_link="/srv/resume/.current-next-$$"
preflight_pid=''
switched=false
success=false

stop_preflight() {
  if [[ -n $preflight_pid ]]; then
    kill -TERM "$preflight_pid" 2>/dev/null || true
    for ((attempt=0; attempt<50; attempt++)); do
      kill -0 "$preflight_pid" 2>/dev/null || break
      sleep 0.1
    done
    if kill -0 "$preflight_pid" 2>/dev/null; then kill -KILL "$preflight_pid" 2>/dev/null || true; fi
    wait "$preflight_pid" 2>/dev/null || true
    preflight_pid=''
  fi
}
switch_link() {
  rm -f -- "$next_link" || return 1
  ln -s -- "$1" "$next_link" || return 1
  mv -Tf -- "$next_link" /srv/resume/current
}
health() {
  local port=$1 endpoint=$2
  curl --silent --show-error --fail --max-time 2 "http://127.0.0.1:$port$endpoint" |
    python3 -c 'import json,sys; data=json.load(sys.stdin); sys.exit(0 if data.get("status")=="ok" and data.get("service")=="resume-api" else 1)'
}
wait_health() {
  local port=$1
  for ((attempt=0; attempt<30; attempt++)); do
    if health "$port" /api/health >/dev/null 2>&1; then return 0; fi
    sleep 1
  done
  echo "API health timed out on loopback port $port." >&2
  return 1
}
check_routes() {
  local port=$1 status
  health "$port" /healthz >/dev/null
  status=$(curl --silent --show-error --max-time 5 -o "$temporary/chat.json" -w '%{http_code}' \
    -H 'Origin: https://qishaoxuan.github.io' -H 'Content-Type: application/json' \
    --data '{"messages":[{"role":"user","content":"deployment health check"}]}' "http://127.0.0.1:$port/api/chat")
  [[ $status == 200 ]] || { echo "Expected mock chat 200, received $status." >&2; return 1; }
  python3 -c 'import json,sys; data=json.load(open(sys.argv[1])); message=data.get("message", {}); sys.exit(0 if data.get("mode")=="mock" and message.get("role")=="assistant" and isinstance(message.get("content"), str) and message["content"].strip() else 1)' "$temporary/chat.json"
  status=$(curl --silent --show-error --max-time 5 -o /dev/null -D "$temporary/cors.headers" -w '%{http_code}' \
    -X OPTIONS -H 'Origin: https://qishaoxuan.github.io' -H 'Access-Control-Request-Method: POST' \
    -H 'Access-Control-Request-Headers: content-type' "http://127.0.0.1:$port/api/chat")
  [[ $status == 204 ]] || { echo "Expected CORS preflight 204, received $status." >&2; return 1; }
  python3 -c 'import sys; lines=open(sys.argv[1]).read().splitlines(); headers=dict(line.lower().split(":",1) for line in lines if ":" in line); sys.exit(0 if headers.get("access-control-allow-origin", "").strip()=="https://qishaoxuan.github.io" else 1)' "$temporary/cors.headers"
}
cleanup() {
  local result=$?
  trap - EXIT INT TERM
  stop_preflight
  if [[ $result != 0 && -s $temporary/preflight.log ]]; then
    echo 'Candidate startup diagnostics:' >&2
    tail -n 20 "$temporary/preflight.log" >&2
  fi
  if [[ $switched == true && $success != true ]]; then
    echo "Activation failed; restoring previous release: $previous" >&2
    if switch_link "$previous" && sudo -n /usr/bin/systemctl restart resume.service; then
      # The previous release may be the deployment-preparation placeholder.
      if curl --silent --show-error --fail --retry 10 --retry-connrefused --retry-delay 1 --max-time 2 http://127.0.0.1:3000/healthz >/dev/null; then
        echo "Rollback healthy: $previous" >&2
      else
        echo 'ROLLBACK HEALTH CHECK FAILED; inspect resume.service.' >&2
      fi
    else
      echo 'ROLLBACK FAILED; inspect /srv/resume/current and resume.service.' >&2
    fi
    result=1
  fi
  rm -f -- "$next_link"
  rm -rf -- "$temporary"
  exit "$result"
}
trap cleanup EXIT
trap 'exit 130' INT
trap 'exit 143' TERM

# Verify this exact release on loopback only. Existing production remains untouched.
# Environment assignments take precedence over --env-file values.
(
  cd "$release"
  exec env NODE_ENV=production API_HOST=127.0.0.1 HOSTNAME=127.0.0.1 API_PORT=3001 PORT=3001 \
    /opt/node/bin/node --env-file=/etc/resume/resume.env "$release/server.js"
) >"$temporary/preflight.log" 2>&1 &
preflight_pid=$!
wait_health 3001
kill -0 "$preflight_pid" 2>/dev/null || { echo 'Preflight process exited.' >&2; exit 1; }
check_routes 3001
kill -0 "$preflight_pid" 2>/dev/null || { echo 'Preflight process exited.' >&2; exit 1; }
python3 -c 'import sys; sys.exit(0 if "Resume API listening on port 3001" in open(sys.argv[1]).read() else 1)' "$temporary/preflight.log"
stop_preflight
printf 'Release: %s\nPrevious: %s\n' "$release" "$previous"
# Mark before switching so even a signal at the switch boundary restores the old link.
switched=true
switch_link "$release"
sudo -n /usr/bin/systemctl restart resume.service
wait_health 3000
check_routes 3000
success=true
printf 'Activated: %s\nPrevious retained: %s\n' "$release" "$previous"
