#!/usr/bin/env bash
set -Eeuo pipefail
umask 027
[[ $EUID -eq 0 ]] || { echo 'Run as root through ECS Cloud Assistant.' >&2; exit 1; }
SCRIPT_DIR=$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)
SITE=/etc/nginx/sites-available/resume
DEV_UNIT=/etc/systemd/system/resume-development.service
PROD_UNIT=/etc/systemd/system/resume.service
DEV_SUDO=/etc/sudoers.d/resume-development-restart
PROD_SUDO=/etc/sudoers.d/resume-restart
[[ -f $SITE && -f $PROD_UNIT && -L /srv/resume/current && -r /etc/resume/resume.env ]] || { echo 'Existing production deployment required.' >&2; exit 1; }
[[ -r /etc/letsencrypt/live/resume-ip/fullchain.pem && -r /etc/letsencrypt/live/resume-ip/privkey.pem ]] || { echo 'Existing IP HTTPS certificate required.' >&2; exit 1; }
for binary in nginx visudo systemctl systemd-analyze curl; do command -v "$binary" >/dev/null; done
[[ -x /opt/node/bin/node ]] || { echo 'Existing Node runtime required.' >&2; exit 1; }
nginx -t
exec 9>/var/lock/resume-environments.lock
flock -n 9 || { echo 'Environment setup is already running.' >&2; exit 1; }
BACKUP_DIR="/var/backups/resume-environments/$(date -u +%Y%m%dT%H%M%S)-$$"
install -d -m 700 "$BACKUP_DIR"
files=("$SITE" "$PROD_UNIT" "$DEV_UNIT" "$DEV_SUDO" "$PROD_SUDO")
for file in "${files[@]}"; do
  if [[ -e $file || -L $file ]]; then cp -a --parents "$file" "$BACKUP_DIR"; fi
done
was_dev_active=false
if systemctl is-active --quiet resume-development.service; then was_dev_active=true; fi
was_dev_enabled=false
if systemctl is-enabled --quiet resume-development.service; then was_dev_enabled=true; fi
success=false
cleanup() {
  local result=$?
  trap - EXIT INT TERM
  if [[ $success != true ]]; then
    echo "Setup failed; restoring configuration from $BACKUP_DIR." >&2
    if [[ $was_dev_active != true ]]; then systemctl stop resume-development.service || true; fi
    if [[ $was_dev_enabled != true ]]; then systemctl disable resume-development.service || true; fi
    for file in "${files[@]}"; do
      if [[ -e $BACKUP_DIR$file || -L $BACKUP_DIR$file ]]; then cp -a "$BACKUP_DIR$file" "$file"; else rm -f -- "$file"; fi
    done
    systemctl daemon-reload || true
    if [[ $was_dev_active == true ]]; then systemctl restart resume-development.service || true; fi
    nginx -t && systemctl reload nginx.service || echo 'NGINX RESTORE FAILED; inspect configuration.' >&2
    result=1
  fi
  exit "$result"
}
trap cleanup EXIT
trap 'exit 130' INT
trap 'exit 143' TERM
if ! id resume-dev >/dev/null 2>&1; then useradd --create-home --shell /bin/bash resume-dev; fi
install -d -o resume-dev -g resume-dev -m 750 /srv/resume-development /srv/resume-development/releases
install -d -o root -g resume-dev -m 750 /etc/resume-development
if [[ ! -e /etc/resume-development/resume.env ]]; then
  printf '%s\n' 'NODE_ENV=production' 'HOSTNAME=127.0.0.1' 'API_HOST=127.0.0.1' 'PORT=3100' 'API_PORT=3100' 'NODE_OPTIONS=--max-old-space-size=128' 'API_ALLOWED_ORIGINS=https://qishaoxuan.github.io' > /etc/resume-development/resume.env
  chown root:resume-dev /etc/resume-development/resume.env
  chmod 640 /etc/resume-development/resume.env
fi
# Keep a functioning rollback target before the first development release.
if [[ ! -e /srv/resume-development/current && ! -L /srv/resume-development/current ]]; then
  install -d -o resume-dev -g resume-dev -m 750 /srv/resume-development/releases/preparation
  install -o resume-dev -g resume-dev -m 640 "$SCRIPT_DIR/readiness/server.js" /srv/resume-development/releases/preparation/server.js
  ln -s /srv/resume-development/releases/preparation /srv/resume-development/current
fi
install -o root -g root -m 644 "$SCRIPT_DIR/resume.service" "$PROD_UNIT"
install -o root -g root -m 644 "$SCRIPT_DIR/resume-development.service" "$DEV_UNIT"
for pair in 'resume resume.service resume-restart' 'resume-dev resume-development.service resume-development-restart'; do
  read -r user unit name <<< "$pair"
  printf '%s ALL=(root) NOPASSWD: /usr/bin/systemctl restart %s\n' "$user" "$unit" > "$BACKUP_DIR/$name.candidate"
  visudo -cf "$BACKUP_DIR/$name.candidate"
  install -o root -g root -m 440 "$BACKUP_DIR/$name.candidate" "/etc/sudoers.d/$name"
done
systemd-analyze verify "$PROD_UNIT" "$DEV_UNIT"
systemctl daemon-reload
systemctl enable --now resume-development.service
systemctl restart resume-development.service
# The placeholder intentionally exposes only /healthz until the first release.
curl --noproxy '*' --silent --show-error --fail --retry 10 --retry-connrefused --retry-delay 1 --max-time 3 http://127.0.0.1:3100/healthz >/dev/null
install -o root -g root -m 644 "$SCRIPT_DIR/resume.ip-https.nginx" "$SITE"
nginx -t
systemctl reload nginx.service
for route in /healthz /dev/healthz; do
  curl --noproxy '*' --resolve 101.201.78.159:443:127.0.0.1 --silent --show-error --fail --retry 5 --retry-delay 1 --max-time 3 "https://101.201.78.159$route" >/dev/null
done
success=true
printf 'Dual environments ready. Configuration backup: %s\n' "$BACKUP_DIR"
echo 'Existing production process and TLS renewal remain running; API releases are deployed separately.'
