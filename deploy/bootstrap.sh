#!/usr/bin/env bash
set -Eeuo pipefail
umask 027

SCRIPT_DIR=$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)
NODE_VERSION=${NODE_VERSION:-24.22.0}
PUBLIC_KEY_FILE=${1:?Usage: sudo bash bootstrap.sh /path/to/admin-key.pub}
[[ $EUID -eq 0 ]] || { echo 'Run as root.' >&2; exit 1; }
source /etc/os-release
[[ $ID == ubuntu && $VERSION_ID == 24.04 ]] || { echo 'Requires Ubuntu 24.04.' >&2; exit 1; }
[[ $(uname -m) == x86_64 ]] || { echo 'Requires x86_64.' >&2; exit 1; }
[[ $NODE_VERSION =~ ^24\.[0-9]+\.[0-9]+$ ]] || { echo 'Requires an explicit Node 24 version.' >&2; exit 1; }
ssh-keygen -lf "$PUBLIC_KEY_FILE" >/dev/null

BACKUP_DIR="/var/backups/resume-bootstrap/$(date -u +%Y%m%dT%H%M%S)-$$"
mkdir -p "$BACKUP_DIR"
chmod 700 "$BACKUP_DIR"
for file in /etc/nginx/sites-available/resume /etc/nginx/sites-enabled/default /etc/systemd/system/resume.service /etc/resume/resume.env /etc/sudoers.d/resume-restart; do
    if [[ -e $file || -L $file ]]; then
        cp -a --parents "$file" "$BACKUP_DIR"
    fi
done
echo "Backups: $BACKUP_DIR"

export DEBIAN_FRONTEND=noninteractive
apt-get -o DPkg::Lock::Timeout=180 update
apt-get -o DPkg::Lock::Timeout=180 install -y --no-install-recommends ca-certificates curl xz-utils git nginx sudo

NODE_DIR="/opt/node-v${NODE_VERSION}-linux-x64"
if [[ ! -x $NODE_DIR/bin/node ]]; then
    DOWNLOAD_DIR=$(mktemp -d)
    trap 'rm -rf -- "$DOWNLOAD_DIR"' EXIT
    ARCHIVE="node-v${NODE_VERSION}-linux-x64.tar.xz"
    URL="https://nodejs.org/dist/v${NODE_VERSION}"
    curl --fail --location --retry 2 --connect-timeout 15 --max-time 240 "$URL/$ARCHIVE" -o "$DOWNLOAD_DIR/$ARCHIVE"
    curl --fail --location --retry 2 --connect-timeout 15 --max-time 60 "$URL/SHASUMS256.txt" -o "$DOWNLOAD_DIR/SHASUMS256.txt"
    (cd "$DOWNLOAD_DIR"; awk -v file="$ARCHIVE" '$2 == file { print }' SHASUMS256.txt > selected.sha256; test -s selected.sha256; sha256sum -c selected.sha256)
    tar -xJf "$DOWNLOAD_DIR/$ARCHIVE" -C /opt --no-same-owner
    chmod -R go-w "$NODE_DIR"
fi
ln -sfn "$NODE_DIR" /opt/node
for binary in node npm npx; do
    ln -sfn "/opt/node/bin/$binary" "/usr/local/bin/$binary"
done

if ! id resume >/dev/null 2>&1; then
    useradd --create-home --shell /bin/bash resume
fi
install -d -o resume -g resume -m 750 /srv/resume /srv/resume/releases /srv/resume/shared
install -d -o resume -g resume -m 700 /home/resume/.ssh
touch /home/resume/.ssh/authorized_keys
if ! grep -qF -- "$(awk '{ print $2 }' "$PUBLIC_KEY_FILE")" /home/resume/.ssh/authorized_keys; then
    cat "$PUBLIC_KEY_FILE" >> /home/resume/.ssh/authorized_keys
fi
chown resume:resume /home/resume/.ssh/authorized_keys
chmod 600 /home/resume/.ssh/authorized_keys
install -d -o root -g resume -m 750 /etc/resume
if [[ ! -e /etc/resume/resume.env ]]; then
    install -o root -g resume -m 640 "$SCRIPT_DIR/resume.env.example" /etc/resume/resume.env
fi

# Preserve an already deployed application on reruns.
if [[ ! -e /srv/resume/current && ! -L /srv/resume/current ]]; then
    install -d -o resume -g resume -m 750 /srv/resume/releases/preparation
    install -o resume -g resume -m 640 "$SCRIPT_DIR/readiness/server.js" /srv/resume/releases/preparation/server.js
    ln -s /srv/resume/releases/preparation /srv/resume/current
fi

install -o root -g root -m 644 "$SCRIPT_DIR/resume.service" /etc/systemd/system/resume.service
printf '%s\n' 'resume ALL=(root) NOPASSWD: /usr/bin/systemctl restart resume.service' > "$BACKUP_DIR/resume-restart"
visudo -cf "$BACKUP_DIR/resume-restart"
install -o root -g root -m 440 "$BACKUP_DIR/resume-restart" /etc/sudoers.d/resume-restart
systemd-analyze verify /etc/systemd/system/resume.service

PROXY_HEALTH_URL=http://127.0.0.1/healthz
if [[ -r /etc/letsencrypt/live/resume-ip/fullchain.pem ]]; then
    # HTTPS is managed by setup-ip-https.sh; never replace it with the HTTP template.
    echo 'Preserving the existing IP HTTPS site configuration.'
    PROXY_HEALTH_URL=https://101.201.78.159/healthz
else
    install -o root -g root -m 644 "$SCRIPT_DIR/resume.nginx" /etc/nginx/sites-available/resume
fi
ln -sfn /etc/nginx/sites-available/resume /etc/nginx/sites-enabled/resume
if [[ -L /etc/nginx/sites-enabled/default ]]; then
    unlink /etc/nginx/sites-enabled/default
fi
nginx -t
systemctl daemon-reload
systemctl enable --now resume.service
systemctl restart resume.service
systemctl enable --now nginx.service
systemctl reload nginx.service

for endpoint in http://127.0.0.1:3000/healthz "$PROXY_HEALTH_URL"; do
    # Both the Node process and Nginx's reloaded workers start asynchronously.
    for attempt in {1..15}; do
        if curl --noproxy '*' --resolve 101.201.78.159:443:127.0.0.1 --fail --silent --max-time 3 "$endpoint" >/dev/null; then break; fi
        sleep 1
    done
    curl --noproxy '*' --resolve 101.201.78.159:443:127.0.0.1 --fail --silent --show-error --max-time 3 "$endpoint"
    printf '\n'
done
systemctl is-active resume.service nginx.service
/opt/node/bin/node --version
/usr/local/bin/npm --version
echo 'Environment ready. The public website still returns maintenance HTTP 503.'
