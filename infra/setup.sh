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

# ── Smoke test ────────────────────────────────────────────────────────────────
echo "==> Smoke-testing https://$DOMAIN/hello-world"
HTTP_CODE=$(curl -s -o /dev/null -w "%{http_code}" "https://$DOMAIN/hello-world")
if [ "$HTTP_CODE" = "200" ]; then
    echo "    OK — got 200"
else
    echo "    WARNING — got $HTTP_CODE (Node.js app may not be running yet)"
fi

echo ""
echo "Done. Next steps:"
echo "  1. Make sure the Node.js app is running on port 3000 (npm run server)"
echo "  2. Visit https://$DOMAIN/hello-world"
echo "  3. Cert auto-renews via: systemctl status certbot.timer"
