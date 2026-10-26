#!/usr/bin/env bash
# Installiert den Druck-Agenten als Dienst (Raspberry Pi OS, Debian, Ubuntu).
#
#   curl -fsSL http://SERVER:8080/downloads/install-agent.sh | sudo bash -s -- http://SERVER:8080 TOKEN
#
# Der Dienst startet beim Booten automatisch und verbindet sich selbst neu,
# wenn WLAN oder Server kurz weg sind.
set -euo pipefail

SERVER_URL="${1:-}"
AGENT_TOKEN="${2:-}"
if [ -z "$SERVER_URL" ] || [ -z "$AGENT_TOKEN" ]; then
  echo "Aufruf: install-agent.sh <SERVER_URL> <AGENT_TOKEN>" >&2
  exit 1
fi
if [ "$(id -u)" -ne 0 ]; then
  echo "Bitte mit sudo ausführen." >&2
  exit 1
fi

node_major() { node -p 'process.versions.node.split(".")[0]' 2>/dev/null || echo 0; }

if ! command -v node >/dev/null 2>&1 || [ "$(node_major)" -lt 18 ]; then
  echo "Installiere Node.js …"
  apt-get update -qq
  apt-get install -y -qq nodejs
fi
if [ "$(node_major)" -lt 18 ]; then
  echo "Node.js 18 oder neuer wird benötigt (gefunden: $(node -v 2>/dev/null || echo keins))." >&2
  exit 1
fi

if systemctl is-active --quiet cups 2>/dev/null; then
  echo "Hinweis: CUPS läuft auf diesem Rechner und kann USB-Drucker belegen."
  echo "         Falls Drucken nicht klappt: sudo systemctl disable --now cups cups-browsed"
fi

install -d -m 755 /opt/bestellsystem-agent
curl -fsSL "${SERVER_URL%/}/downloads/agent.mjs" -o /opt/bestellsystem-agent/agent.mjs

umask 077
cat > /etc/bestellsystem-agent.env <<CONF
SERVER_URL=${SERVER_URL%/}
AGENT_TOKEN=${AGENT_TOKEN}
CONF
umask 022

if ! id -u bestell-agent >/dev/null 2>&1; then
  useradd --system --no-create-home --shell /usr/sbin/nologin bestell-agent
fi
# USB-Drucker (/dev/usb/lp*) gehören der Gruppe "lp".
usermod -aG lp bestell-agent

cat > /etc/systemd/system/bestellsystem-agent.service <<UNIT
[Unit]
Description=Bestellsystem Druck-Agent
After=network-online.target
Wants=network-online.target

[Service]
EnvironmentFile=/etc/bestellsystem-agent.env
ExecStart=$(command -v node) /opt/bestellsystem-agent/agent.mjs
Restart=always
RestartSec=3
User=bestell-agent
SupplementaryGroups=lp

[Install]
WantedBy=multi-user.target
UNIT

systemctl daemon-reload
systemctl enable --now bestellsystem-agent
systemctl restart bestellsystem-agent

echo
echo "Gefundene USB-Drucker:"
node /opt/bestellsystem-agent/agent.mjs --list || true
echo
echo "Fertig. Der Agent sollte im Admin-Bereich unter „Drucker“ als verbunden erscheinen."
echo "Protokoll ansehen: journalctl -u bestellsystem-agent -f"
