# Apache Proxy Setup for Betfair NLP

This document describes the Apache proxy configuration that maps port 80 to the Node.js API server running on port 3000.

## Overview

The setup consists of:
- **Apache HTTP Server**: Acts as a reverse proxy on port 80
- **Node.js API Server**: Runs the Betfair NLP API on port 3000
- **Basic Authentication**: Protects all endpoints with username `matthew` and password `beyer`

## Files

- `apache.conf` - Apache configuration file
- `Dockerfile.apache` - Dockerfile for Apache container
- `docker-compose.apache-test.yml` - Docker Compose file for testing
- `test-apache-proxy.sh` - Test script to verify the setup

## Quick Start

1. **Start the containers:**
   ```bash
   docker-compose -f docker-compose.apache-test.yml up -d
   ```

2. **Test the setup:**
   ```bash
   ./test-apache-proxy.sh
   ```

3. **Manual testing:**
   ```bash
   # Test health endpoint
   curl -X GET http://localhost:80/health \
     -H "Authorization: Basic $(echo -n 'matthew:beyer' | base64)"
   
   # Test API endpoint
   curl -X POST http://localhost:80/api/query \
     -H "Content-Type: application/json" \
     -H "Authorization: Basic $(echo -n 'matthew:beyer' | base64)" \
     -d '{"query": "Show me all open markets"}'
   ```

## Configuration Details

### Apache Configuration (`apache.conf`)

The Apache configuration:
- Proxies all requests from port 80 to `localhost:3000`
- Handles WebSocket connections
- Sets proper headers for proxy handling
- Includes security headers
- Provides logging

### Docker Setup

- **API Server**: Uses Node.js 20 Alpine image
- **Apache Proxy**: Uses official Apache 2.4 image
- **Network**: Both containers communicate via Docker network
- **Host Access**: API server connects to host MongoDB via `host.docker.internal`

## Authentication

All endpoints require Basic Authentication:
- **Username**: `matthew`
- **Password**: `beyer`
- **Header**: `Authorization: Basic <base64-encoded-credentials>`

## Testing Results

✅ **Apache proxy working**: Requests on port 80 are proxied to port 3000
✅ **Authentication working**: Unauthenticated requests return 401
✅ **API communication**: Apache successfully forwards requests to Node.js API
✅ **Database connection**: API server connects to MongoDB successfully

## Troubleshooting

1. **Apache container restarting**: Check logs with `docker logs betfair-nlp-apache`
2. **API not responding**: Check API logs with `docker logs betfair-nlp-api`
3. **Database connection issues**: Ensure MongoDB is running on host port 27017

## Cleanup

To stop and remove all containers:
```bash
docker-compose -f docker-compose.apache-test.yml down -v
```
