#!/usr/bin/env bash
# ============================================================
# 50 Gram — Oracle Cloud VM bootstrap (bir marta ishlatiladi)
# Ishlatish:  sudo bash deploy/setup-server.sh
# Bu script: Docker o'rnatadi, 80/443 portlarni ochadi
# (Oracle Ubuntu image'ida iptables default yopiq bo'ladi),
# swap qo'shadi va /opt/50gram papkasini tayyorlaydi.
# ============================================================
set -euo pipefail

if [[ $EUID -ne 0 ]]; then
  echo "sudo bilan ishga tushiring: sudo bash deploy/setup-server.sh"
  exit 1
fi

echo "== 1/4 Docker o'rnatish =="
if command -v docker >/dev/null 2>&1; then
  echo "Docker allaqachon bor"
else
  curl -fsSL https://get.docker.com | sh
fi
systemctl enable --now docker

# Sababi: bun image'lariga ARM64 arch yaxshi mos keladi, hech qanday
# platforma flagi kerak emas — arm64 native build bo'ladi.

echo "== 2/4 iptables: 80/443 ochish (Oracle default yopiq) =="
iptables -C INPUT -p tcp --dport 80 -j ACCEPT 2>/dev/null || iptables -I INPUT -p tcp --dport 80 -j ACCEPT
iptables -C INPUT -p tcp --dport 443 -j ACCEPT 2>/dev/null || iptables -I INPUT -p tcp --dport 443 -j ACCEPT
export DEBIAN_FRONTEND=noninteractive
apt-get update -y
apt-get install -y iptables-persistent
netfilter-persistent save

echo "== 3/4 Swap 4GB (build uchun xavfsizlik) =="
if ! swapon --show | grep -q swapfile; then
  fallocate -l 4G /swapfile && chmod 600 /swapfile && mkswap /swapfile && swapon /swapfile
  echo '/swapfile none swap sw 0 0' >> /etc/fstab
  echo "Swap qo'shildi"
else
  echo "Swap allaqachon bor"
fi

echo "== 4/4 Loyiha papkasi =="
mkdir -p /opt/50gram
# Agar ubuntu user bo'lsa egasini o'zgartiramiz
if id -u ubuntu >/dev/null 2>&1; then
  chown -R ubuntu:ubuntu /opt/50gram
  usermod -aG docker ubuntu
fi

echo ""
echo "TAYYOR! Keyingi qadam:"
echo "  git clone https://<TOKEN>@github.com/<user>/50gram.git /opt/50gram"
echo "  cd /opt/50gram && cp .env.example .env && nano .env"
echo "  docker compose up -d --build"
echo "  docker compose exec web bunx prisma db push"
echo "  docker compose exec web bun run db:seed"
