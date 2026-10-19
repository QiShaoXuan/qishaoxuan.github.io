#!/usr/bin/env bash
set -Eeuo pipefail
umask 027

[[ $EUID -eq 0 ]] || { echo 'Run as root.' >&2; exit 1; }
SCRIPT_DIR=$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)
CERTBOT=/opt/certbot/bin/certbot
SITE=/etc/nginx/sites-available/resume
BACKUP_DIR="/var/backups/resume-https/$(date -u +%Y%m%dT%H%M%S)-$$"
[[ -f $SITE ]] || { echo 'Run bootstrap.sh before setting up HTTPS.' >&2; exit 1; }
mkdir -p "$BACKUP_DIR"
chmod 700 "$BACKUP_DIR"
cp -a "$SITE" "$BACKUP_DIR/resume.nginx"
for file in /etc/systemd/system/resume-certbot-renew.service /etc/systemd/system/resume-certbot-renew.timer /etc/letsencrypt/renewal-hooks/deploy/resume-reload-nginx; do
    if [[ -e $file ]]; then cp -a --parents "$file" "$BACKUP_DIR"; fi
done
echo "Backups: $BACKUP_DIR"

if [[ ! -x $CERTBOT ]]; then
    export DEBIAN_FRONTEND=noninteractive
    apt-get -o DPkg::Lock::Timeout=180 update
    apt-get -o DPkg::Lock::Timeout=180 install -y --no-install-recommends python3-venv
    python3 -m venv /opt/certbot
    /opt/certbot/bin/python -m pip install --index-url https://pypi.org/simple --upgrade pip
    /opt/certbot/bin/python -m pip install --index-url https://pypi.org/simple certbot==5.8.0
fi
/opt/certbot/bin/python - <<'PY'
from importlib.metadata import version
assert tuple(map(int, version('certbot').split('.')[:2])) >= (5, 4), 'Certbot >= 5.4 required'
PY
"$CERTBOT" --version
install -d -o root -g root -m 755 /var/www/letsencrypt/.well-known/acme-challenge
install -d -o root -g root -m 700 /etc/letsencrypt/renewal-hooks/deploy
install -o root -g root -m 750 "$SCRIPT_DIR/reload-nginx.sh" /etc/letsencrypt/renewal-hooks/deploy/resume-reload-nginx

activate_site() {
    install -o root -g root -m 644 "$1" "$SITE"
    if ! nginx -t || ! systemctl reload nginx.service; then
        cp -a "$BACKUP_DIR/resume.nginx" "$SITE"
        nginx -t && systemctl reload nginx.service
        echo 'Nginx activation failed; restored the previous configuration.' >&2
        exit 1
    fi
}

if [[ ! -r /etc/letsencrypt/live/resume-ip/fullchain.pem ]]; then
    activate_site "$SCRIPT_DIR/resume.nginx"
fi

# ACME account registration intentionally does not supply a personal email.
# Existing valid certificates are retained; never force a production renewal.
"$CERTBOT" certonly --non-interactive --agree-tos --register-unsafely-without-email \
    --webroot --webroot-path /var/www/letsencrypt \
    --ip-address 101.201.78.159 --cert-name resume-ip \
    --required-profile shortlived --key-type ecdsa --keep-until-expiring

activate_site "$SCRIPT_DIR/resume.ip-https.nginx"
install -o root -g root -m 644 "$SCRIPT_DIR/resume-certbot-renew.service" /etc/systemd/system/resume-certbot-renew.service
install -o root -g root -m 644 "$SCRIPT_DIR/resume-certbot-renew.timer" /etc/systemd/system/resume-certbot-renew.timer
systemd-analyze verify /etc/systemd/system/resume-certbot-renew.service /etc/systemd/system/resume-certbot-renew.timer
systemctl daemon-reload
systemctl enable --now resume-certbot-renew.timer

# Exercise renewal validation and the deploy hook, without installing a test cert.
"$CERTBOT" renew --cert-name resume-ip --dry-run --run-deploy-hooks --non-interactive
systemctl start resume-certbot-renew.service
systemctl list-timers resume-certbot-renew.timer --no-pager
openssl x509 -in /etc/letsencrypt/live/resume-ip/fullchain.pem -noout -issuer -dates -ext subjectAltName
echo 'IP HTTPS configured. Verify the public endpoint with normal certificate validation.'
