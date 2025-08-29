# Local Development Setup with Docker

This guide explains how to run the Betfair NLP backend locally using Docker for both the API server and MongoDB, and how to process BASIC files.

## Prerequisites

- Docker and Docker Compose installed
- Node.js and Yarn (for local development)
- Basic knowledge of Docker commands

## Quick Start

### 1. Start the Local Development Environment

```bash
# Start MongoDB and API server with Docker
yarn server:docker
```

This command will:
- Start MongoDB container on port 27017
- Start the Node.js API server on port 3000
- Mount your local `src`, `config`, and `BASIC` directories for live development
- Wait for MongoDB to be healthy before starting the API server

### 2. Check Service Status

```bash
# View API server logs
yarn server:docker:logs

# Check if services are running
docker ps
```

### 3. Process BASIC Files

```bash
# Process files in BASIC/2025/Jan/1/33858191 (excluding .bz2 files)
yarn process:basic:docker

# Process a specific directory
yarn process:basic:docker BASIC/2025/Jan/1/33858191
```

### 4. Stop the Environment

```bash
# Stop all containers
yarn server:docker:down
```

## Available Scripts

### Docker Management
- `yarn server:docker` - Start MongoDB and API server containers
- `yarn server:docker:down` - Stop all containers
- `yarn server:docker:logs` - View API server logs
- `yarn server:docker:build` - Rebuild Docker images

### File Processing
- `yarn process:basic:docker` - Process BASIC files (excluding .bz2)
- `yarn process:basic:local` - Process BASIC files using local MongoDB

### Development
- `yarn server:dev` - Run server locally with hot reload
- `yarn server` - Run server locally in production mode

## Configuration

The Docker setup uses the following configuration:

- **MongoDB**: `mongodb://mongodb:27017` (container-to-container communication)
- **Database**: `betfair_nlp_dev`
- **API Server**: Port 3000
- **Environment**: `docker` (uses `config/docker.json`)

## File Processing Details

The `process:basic:docker` script:

1. **Excludes .bz2 files** as requested
2. **Processes all other files** in the specified directory
3. **Handles duplicate data gracefully** (shows errors but continues processing)
4. **Provides progress updates** and summary statistics
5. **Connects to Docker MongoDB** automatically

## Troubleshooting

### MongoDB Connection Issues
```bash
# Check MongoDB container status
docker logs betfair-nlp-mongodb-local

# Restart containers
yarn server:docker:down
yarn server:docker
```

### File Processing Errors
- Duplicate key errors are normal when reprocessing the same data
- The script continues processing despite these errors
- Check the final summary for actual success/failure counts

### Port Conflicts
```bash
# Check what's using port 3000
lsof -i :3000

# Stop conflicting services
brew services stop mongodb-community  # if running locally
```

## Data Persistence

MongoDB data is persisted in a Docker volume:
- **Volume**: `betfair-nlp_mongodb_data_local`
- **Location**: Docker managed volume
- **Persistence**: Data survives container restarts

To completely reset the database:
```bash
yarn server:docker:down
docker volume rm betfair-nlp_mongodb_data_local
yarn server:docker
```

## API Endpoints

Once running, the API is available at:
- **Health Check**: `http://localhost:3000/health`
- **Query API**: `http://localhost:3000/api/query`
- **Horses API**: `http://localhost:3000/api/horses/top`

All endpoints require basic authentication:
- **Username**: `matthew`
- **Password**: `beyer`
