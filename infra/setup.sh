#!/usr/bin/env bash
# infra/setup.sh — install Apache + Let's Encrypt TLS for backbet.co.uk
# Run as root on the Ubuntu VM:  sudo bash infra/setup.sh
set -euo pipefail

DOMAIN="backbet.co.uk"
EMAIL="matthewbeyer@hotmail.com"
CONF_SRC="$(cd "$(dirname "$0")" && pwd)/apache/backbet.co.uk.conf"
CONF_DEST="/etc/apache2/sites-available/backbet.co.uk.conf"

echo "==> Updating packages"
apt-get update -y
apt-get upgrade -y

# ── Apache ────────────────────────────────────────────────────────────────────
echo "==> Installing Apache"
apt-get install -y apache2

echo "==> Enabling Apache modules"
a2enmod proxy proxy_http ssl rewrite headers

echo "==> Copying virtual host config"
cp "$CONF_SRC" "$CONF_DEST"

echo "==> Activating site"
a2dissite 000-default.conf 2>/dev/null || true
a2ensite backbet.co.uk.conf

echo "==> Testing Apache config"
apache2ctl configtest

# ── Firewall ──────────────────────────────────────────────────────────────────
if ufw status | grep -q "Status: active"; then
    echo "==> Opening ports 80 and 443"
    ufw allow 80/tcp
    ufw allow 443/tcp
fi

echo "==> Starting Apache"
systemctl enable apache2
systemctl restart apache2

# ── Certbot / Let's Encrypt ───────────────────────────────────────────────────
echo "==> Installing Certbot"
apt-get install -y certbot python3-certbot-apache

echo "==> Obtaining TLS certificate for $DOMAIN"
# --apache flag rewrites the vhost to add SSL directives automatically.
# Certificate renews automatically via the certbot systemd timer.
certbot --apache \
    --non-interactive \
    --agree-tos \
    --email "$EMAIL" \
    --domains "$DOMAIN,www.$DOMAIN" \
    --redirect

echo "==> Reloading Apache with new certificate"
systemctl reload apache2

# ── Node.js + app dependencies ────────────────────────────────────────────────
echo "==> Checking for Node.js"
if ! command -v node &>/dev/null; then
    echo "==> Installing Node.js 20.x"
    curl -fsSL https://deb.nodesource.com/setup_20.x | bash -
    apt-get install -y nodejs
fi
node --version

APP_DIR="$(cd "$(dirname "$0")/.." && pwd)"
echo "==> Installing backend dependencies in $APP_DIR"
cd "$APP_DIR"
npm install

echo "==> Installing client dependencies"
cd "$APP_DIR/client"
npm install

echo "==> Building Expo web client (production)"
# Use expo export without --dev so __DEV__ is false in the bundle
npx expo export --platform web --output-dir dist

echo "==> Client build complete"
cd "$APP_DIR"

# ── Smoke tests ───────────────────────────────────────────────────────────────
echo "==> Smoke-testing https://$DOMAIN/hello-world"
HTTP_CODE=$(curl -s -o /dev/null -w "%{http_code}" "https://$DOMAIN/hello-world")
if [ "$HTTP_CODE" = "200" ]; then
    echo "    OK — got 200"
else
    echo "    WARNING — got $HTTP_CODE (Node.js app may not be running yet)"
fi

echo "==> Smoke-testing https://$DOMAIN/ (client app)"
HTTP_CODE=$(curl -s -o /dev/null -w "%{http_code}" "https://$DOMAIN/")
if [ "$HTTP_CODE" = "200" ]; then
    echo "    OK — got 200"
else
    echo "    WARNING — got $HTTP_CODE"
fi

echo "==> Building TypeScript"
cd "$APP_DIR"
npm run build
cp -r src/lib/service/prompts dist/lib/service/

echo "==> Starting Node.js server"
pkill -f 'node dist/server/index.js' || true
sleep 1
# disown required: without it, SSH session close sends SIGHUP and kills the process
nohup node dist/server/index.js >> "$APP_DIR/server.log" 2>&1 & disown
sleep 3

echo "==> Smoke-testing https://$DOMAIN/hello-world"
HTTP_CODE=$(curl -s -o /dev/null -w "%{http_code}" "https://$DOMAIN/hello-world")
if [ "$HTTP_CODE" = "200" ]; then
    echo "    OK — got 200"
else
    echo "    WARNING — got $HTTP_CODE"
fi

echo "==> Smoke-testing https://$DOMAIN/ (client app)"
HTTP_CODE=$(curl -s -o /dev/null -w "%{http_code}" "https://$DOMAIN/")
if [ "$HTTP_CODE" = "200" ]; then
    echo "    OK — got 200"
else
    echo "    WARNING — got $HTTP_CODE"
fi

echo ""
echo "Done."
echo "  - App:        https://$DOMAIN/"
echo "  - Hello:      https://$DOMAIN/hello-world"
echo "  - Server log: $APP_DIR/server.log"
echo "  - To redeploy: bash infra/deploy.sh (or bash infra/deploy.sh --client)"
echo "  - Cert auto-renews via: systemctl status certbot.timer"
