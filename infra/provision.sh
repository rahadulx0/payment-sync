#!/usr/bin/env bash
# One-time VPS provisioning (architecture §16.1). Idempotent and boring on
# purpose — this runs once and must be re-readable in a year.
#
# Usage (as root on a fresh Debian 12 / Ubuntu 22.04+ box):
#   DEPLOY_USER=deploy SSH_PUBKEY="ssh-ed25519 AAAA..." bash provision.sh
set -Eeuo pipefail

: "${DEPLOY_USER:=deploy}"
: "${SSH_PUBKEY:?SSH_PUBKEY is required — provisioning would lock you out otherwise}"

echo "[provision] base packages"
export DEBIAN_FRONTEND=noninteractive
apt-get update -y
apt-get install -y --no-install-recommends \
  ca-certificates curl gnupg ufw fail2ban unattended-upgrades \
  age awscli jq

echo "[provision] timezone UTC (containers assume it)"
timedatectl set-timezone UTC || true

echo "[provision] deploy user"
if ! id -u "${DEPLOY_USER}" >/dev/null 2>&1; then
  adduser --disabled-password --gecos "" "${DEPLOY_USER}"
fi
install -d -m 700 -o "${DEPLOY_USER}" -g "${DEPLOY_USER}" "/home/${DEPLOY_USER}/.ssh"
echo "${SSH_PUBKEY}" > "/home/${DEPLOY_USER}/.ssh/authorized_keys"
chown "${DEPLOY_USER}:${DEPLOY_USER}" "/home/${DEPLOY_USER}/.ssh/authorized_keys"
chmod 600 "/home/${DEPLOY_USER}/.ssh/authorized_keys"

echo "[provision] docker"
if ! command -v docker >/dev/null 2>&1; then
  install -m 0755 -d /etc/apt/keyrings
  curl -fsSL https://download.docker.com/linux/debian/gpg | gpg --dearmor -o /etc/apt/keyrings/docker.gpg
  chmod a+r /etc/apt/keyrings/docker.gpg
  echo "deb [arch=$(dpkg --print-architecture) signed-by=/etc/apt/keyrings/docker.gpg] \
https://download.docker.com/linux/debian $(. /etc/os-release && echo "$VERSION_CODENAME") stable" \
    > /etc/apt/sources.list.d/docker.list
  apt-get update -y
  apt-get install -y docker-ce docker-ce-cli containerd.io docker-buildx-plugin docker-compose-plugin
fi
usermod -aG docker "${DEPLOY_USER}"

echo "[provision] ssh hardening (keys only, no root login)"
sed -i 's/^#\?PasswordAuthentication.*/PasswordAuthentication no/' /etc/ssh/sshd_config
sed -i 's/^#\?PermitRootLogin.*/PermitRootLogin no/' /etc/ssh/sshd_config
sed -i 's/^#\?PubkeyAuthentication.*/PubkeyAuthentication yes/' /etc/ssh/sshd_config
systemctl reload ssh || systemctl reload sshd || true
# Break-glass: if you lock yourself out, use the provider's web console.

echo "[provision] firewall — only 22/80/443"
ufw --force reset
ufw default deny incoming
ufw default allow outgoing
ufw allow 22/tcp
ufw allow 80/tcp
ufw allow 443/tcp
ufw --force enable

echo "[provision] fail2ban + unattended upgrades"
systemctl enable --now fail2ban
dpkg-reconfigure -f noninteractive unattended-upgrades || true

echo "[provision] swap + kernel tuning for redis/postgres"
if [ ! -f /swapfile ]; then
  fallocate -l 2G /swapfile
  chmod 600 /swapfile
  mkswap /swapfile
  swapon /swapfile
  echo '/swapfile none swap sw 0 0' >> /etc/fstab
fi
cat > /etc/sysctl.d/99-paysync.conf <<'SYSCTL'
vm.overcommit_memory=1
net.core.somaxconn=1024
SYSCTL
sysctl --system >/dev/null

echo "[provision] app directory"
install -d -m 750 -o "${DEPLOY_USER}" -g "${DEPLOY_USER}" /opt/paysync
# Secrets live here, root-owned 600, injected via compose env_file — never baked
# into an image and never printed in CI logs.
touch /opt/paysync/.env
chmod 600 /opt/paysync/.env
chown root:root /opt/paysync/.env

echo "[provision] done. Next: place /opt/paysync/.env, then deploy from CI."
