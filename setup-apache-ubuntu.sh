#!/bin/bash

# Ubuntu Apache Setup Script for Betfair NLP
# This script automates the installation and configuration of Apache as a reverse proxy

set -e  # Exit on any error

echo "🚀 Ubuntu Apache Setup for Betfair NLP"
echo "======================================"

# Check if running as root or with sudo
if [[ $EUID -ne 0 ]]; then
   echo "❌ This script must be run as root or with sudo"
   exit 1
fi

# Update system packages
echo "📦 Updating system packages..."
apt update
apt upgrade -y

# Install Apache
echo "🌐 Installing Apache HTTP Server..."
apt install apache2 -y

# Enable required modules
echo "⚙️  Enabling required Apache modules..."
a2enmod proxy
a2enmod proxy_http
a2enmod rewrite
a2enmod headers

# Create Apache configuration
echo "📝 Creating Apache configuration..."
cat > /etc/apache2/sites-available/betfair-nlp.conf << 'EOF'
# Apache configuration for Betfair NLP API proxy
ServerName localhost

# Proxy configuration
ProxyPreserveHost On
ProxyRequests Off

# Main virtual host configuration
<VirtualHost *:80>
    ServerName localhost
    DocumentRoot /var/www/html
    
    # Proxy all requests to the Node.js server
    ProxyPass / http://localhost:3000/
    ProxyPassReverse / http://localhost:3000/
    
    # Handle WebSocket connections if needed
    RewriteEngine On
    RewriteCond %{HTTP:Upgrade} websocket [NC]
    RewriteCond %{HTTP:Connection} upgrade [NC]
    RewriteRule ^/?(.*) "ws://localhost:3000/$1" [P,L]
    
    # Set headers for proper proxy handling
    RequestHeader set X-Forwarded-Proto "http"
    RequestHeader set X-Forwarded-Port "80"
    RequestHeader set X-Real-IP "%{REMOTE_ADDR}s"
    RequestHeader set X-Forwarded-For "%{REMOTE_ADDR}s"
    
    # Logging
    ErrorLog ${APACHE_LOG_DIR}/betfair-nlp_error.log
    CustomLog ${APACHE_LOG_DIR}/betfair-nlp_access.log combined
    
    # Security headers
    Header always set X-Content-Type-Options nosniff
    Header always set X-Frame-Options DENY
    Header always set X-XSS-Protection "1; mode=block"
</VirtualHost>
EOF

# Disable default site
echo "🔄 Disabling default Apache site..."
a2dissite 000-default.conf

# Enable our configuration
echo "✅ Enabling Betfair NLP configuration..."
a2ensite betfair-nlp.conf

# Test configuration
echo "🧪 Testing Apache configuration..."
if apache2ctl configtest; then
    echo "✅ Configuration test passed"
else
    echo "❌ Configuration test failed"
    exit 1
fi

# Configure firewall if UFW is active
if ufw status | grep -q "Status: active"; then
    echo "🔥 Configuring firewall..."
    ufw allow 'Apache'
    echo "✅ Firewall configured for Apache"
else
    echo "ℹ️  UFW not active, skipping firewall configuration"
fi

# Start and enable Apache
echo "🚀 Starting Apache service..."
systemctl start apache2
systemctl enable apache2

# Check Apache status
if systemctl is-active --quiet apache2; then
    echo "✅ Apache is running"
else
    echo "❌ Apache failed to start"
    systemctl status apache2
    exit 1
fi

# Create test script
echo "📜 Creating test script..."
cat > /usr/local/bin/test-betfair-nlp.sh << 'EOF'
#!/bin/bash

echo "🧪 Testing Betfair NLP Apache Setup"
echo "==================================="

# Test Apache is running
echo "1. Testing Apache status..."
if systemctl is-active --quiet apache2; then
    echo "   ✅ Apache is running"
else
    echo "   ❌ Apache is not running"
    exit 1
fi

# Test port 80 is listening
echo "2. Testing port 80..."
if netstat -tlnp | grep -q ":80 "; then
    echo "   ✅ Port 80 is listening"
else
    echo "   ❌ Port 80 is not listening"
fi

# Test basic connectivity
echo "3. Testing basic connectivity..."
if curl -s -o /dev/null -w "%{http_code}" http://localhost/ | grep -q "200\|401"; then
    echo "   ✅ Basic connectivity working"
else
    echo "   ❌ Basic connectivity failed"
fi

# Test health endpoint (if Node.js app is running)
echo "4. Testing health endpoint..."
if curl -s -o /dev/null -w "%{http_code}" http://localhost/health -H "Authorization: Basic $(echo -n 'matthew:beyer' | base64)" | grep -q "200"; then
    echo "   ✅ Health endpoint working"
else
    echo "   ⚠️  Health endpoint not responding (Node.js app may not be running)"
fi

echo ""
echo "🎉 Testing complete!"
echo ""
echo "Next steps:"
echo "1. Ensure your Node.js application is running on port 3000"
echo "2. Test with: curl http://localhost/health -H 'Authorization: Basic $(echo -n 'matthew:beyer' | base64)'"
echo "3. Check logs: tail -f /var/log/apache2/betfair-nlp_access.log"
EOF

chmod +x /usr/local/bin/test-betfair-nlp.sh

echo ""
echo "🎉 Apache setup complete!"
echo ""
echo "📋 Summary:"
echo "   ✅ Apache installed and configured"
echo "   ✅ Proxy modules enabled"
echo "   ✅ Configuration created and enabled"
echo "   ✅ Apache service started and enabled"
echo "   ✅ Firewall configured (if UFW was active)"
echo ""
echo "🔧 Useful commands:"
echo "   Test setup: /usr/local/bin/test-betfair-nlp.sh"
echo "   Check status: systemctl status apache2"
echo "   View logs: tail -f /var/log/apache2/betfair-nlp_access.log"
echo "   Restart: systemctl restart apache2"
echo "   Reload config: systemctl reload apache2"
echo ""
echo "⚠️  Important: Make sure your Node.js application is running on port 3000"
echo "   The proxy will only work if the backend application is accessible at localhost:3000"
