#!/bin/bash

echo "🚀 Testing Apache Proxy Setup"
echo "=============================="

# Wait for services to be ready
echo "⏳ Waiting for services to start..."
sleep 10

# Test 1: Direct access to Node.js API (port 3000)
echo ""
echo "📡 Test 1: Direct API access (port 3000)"
echo "----------------------------------------"
if curl -s -o /dev/null -w "%{http_code}" http://localhost:3000/api/query -H "Content-Type: application/json" -H "Authorization: Basic $(echo -n 'matthew:beyer' | base64)" -d '{"query": "Show me all open markets"}' | grep -q "200"; then
    echo "✅ Direct API access working"
else
    echo "❌ Direct API access failed"
fi

# Test 2: Proxied access through Apache (port 80)
echo ""
echo "🌐 Test 2: Proxied access through Apache (port 80)"
echo "------------------------------------------------"
if curl -s -o /dev/null -w "%{http_code}" http://localhost:80/api/query -H "Content-Type: application/json" -H "Authorization: Basic $(echo -n 'matthew:beyer' | base64)" -d '{"query": "Show me all open markets"}' | grep -q "200"; then
    echo "✅ Apache proxy working"
else
    echo "❌ Apache proxy failed"
fi

# Test 3: Check Apache logs
echo ""
echo "📋 Test 3: Apache logs"
echo "----------------------"
echo "Apache access log (last 5 lines):"
docker logs betfair-nlp-apache 2>&1 | grep -E "(GET|POST)" | tail -5

# Test 4: Check if authentication is working through proxy
echo ""
echo "🔐 Test 4: Authentication through proxy"
echo "--------------------------------------"
echo "Testing without authentication (should fail):"
curl -s -w "HTTP Status: %{http_code}\n" http://localhost:80/api/query -H "Content-Type: application/json" -d '{"query": "test"}' | head -1

echo ""
echo "Testing with authentication (should succeed):"
curl -s -w "HTTP Status: %{http_code}\n" http://localhost:80/api/query -H "Content-Type: application/json" -H "Authorization: Basic $(echo -n 'matthew:beyer' | base64)" -d '{"query": "Show me all open markets"}' | head -1

echo ""
echo "🎉 Testing complete!"
