# Betfair NLP - MongoDB Data Processing

This project processes Betfair historical data files and stores them in MongoDB collections for analysis and NLP processing.

## Project Structure

```
src/
├── config/
│   ├── index.ts                    # Configuration utility and validation
│   └── database.ts                 # MongoDB connection management
├── lib/
│   ├── dao/                        # Data Access Objects
│   │   ├── index.ts                # DAO exports
│   │   ├── market-definition-dao.ts # Market definitions collection DAO
│   │   ├── price-update-dao.ts     # Price updates collection DAO
│   │   └── market-status-dao.ts    # Market statuses collection DAO
│   └── service/                    # Business logic layer
│       └── betfair-service.ts      # Main service for processing Betfair data
├── types/
│   └── betfair.ts                  # TypeScript interfaces for Betfair data
└── index.ts                        # Main application entry point
```

## Configuration

The project uses the [node-config](https://www.npmjs.com/package/config) package for hierarchical configuration management.

### Configuration Files

```
config/
├── default.json                     # Base configuration
├── development.json                 # Development overrides
├── production.json                  # Production overrides
├── test.json                        # Test overrides
└── custom-environment-variables.json # Environment variable mapping
```

### Environment Variables

You can override configuration using environment variables:

```bash
# MongoDB Configuration
export MONGODB_URI="mongodb://localhost:27017"
export MONGODB_DB_NAME="betfair_nlp_dev"

# Application Environment
export NODE_ENV="development"

# Logging
export LOG_LEVEL="debug"
```

### Configuration Structure

```json
{
  "mongodb": {
    "uri": "mongodb://localhost:27017",
    "dbName": "betfair_nlp"
  },
  "app": {
    "name": "betfair-nlp",
    "version": "1.0.0",
    "environment": "development"
  },
  "logging": {
    "level": "info",
    "enableConsole": true
  }
}
```

## Architecture

The system follows a clean separation of concerns:

- **DAO Layer** (`src/lib/dao/`): Pure MongoDB operations for each collection
- **Service Layer** (`src/lib/service/`): Business logic and data processing
- **Types** (`src/types/`): TypeScript interfaces and type definitions
- **Config** (`src/config/`): Configuration management and database connection

## MongoDB Collections

The system separates Betfair data into three main collections:

### 1. `market_definitions`
Stores complete market information including:
- Market metadata (ID, name, type, status)
- Runner information (names, IDs, status)
- Event details (event ID, name, country)
- Timestamps and version information

### 2. `price_updates`
Stores individual price changes:
- Runner ID and name
- Last traded price (LTP)
- Market and event context
- Timestamps for price movement analysis

### 3. `market_statuses`
Tracks market state transitions:
- Status changes (OPEN → SUSPENDED → CLOSED)
- Number of active runners
- Event context
- Timestamps for status tracking

## Data Flow

1. **File Processing**: Betfair data files are read line by line
2. **Message Parsing**: Each line is parsed as a JSON Betfair message
3. **Business Logic**: Service layer applies business rules and data transformation
4. **Data Routing**: Data is routed to appropriate DAOs based on content type
5. **Database Operations**: DAOs handle pure MongoDB operations
6. **Indexing**: Database indexes are created for optimal query performance

## Installation

1. Install dependencies:
```bash
npm install
```

2. Set up configuration:
```bash
# Copy and modify configuration files as needed
cp config/default.json config/local.json

# Or use environment variables
export MONGODB_URI="mongodb://localhost:27017"
export MONGODB_DB_NAME="betfair_nlp"
export NODE_ENV="development"
```

3. Build the project:
```bash
npm run build
```

4. Run the application:
```bash
npm start
```

## Usage

### Processing a Single File
```typescript
import { BetfairService } from './lib/service/betfair-service';

const service = new BetfairService(
  marketDefinitionDAO,
  priceUpdateDAO,
  marketStatusDAO
);
await service.processDataFile('BASIC/2025/Jan/1/33858191/1.237066150');
```

### Querying Data
```typescript
// Get market definitions
const markets = await marketDefinitionDAO.getByMarketId('1.237066150');

// Get price updates for a runner
const prices = await priceUpdateDAO.getByRunnerId(26817268);

// Get market status history
const statuses = await marketStatusDAO.getByMarketId('1.237066150');
```

### Business Logic Examples
```typescript
// Get comprehensive market analysis
const analysis = await service.getMarketAnalysis('1.237066150');

// Get event summary across markets
const eventSummary = await service.getEventSummary('33858191');
```

## Data Types

The system handles these Betfair message types:

- **Market Definition Updates**: Full market information with runners
- **Price Updates**: Runner price changes (LTP updates)
- **Status Changes**: Market state transitions
- **Runner Updates**: Changes to runner status or information

## Performance Features

- **Database Indexing**: Optimized indexes on key fields for each collection
- **Batch Processing**: Efficient bulk inserts for price updates
- **Connection Pooling**: MongoDB connection management
- **Error Handling**: Graceful error handling and logging
- **Separation of Concerns**: Clean DAO/Service separation for maintainability

## Development

```bash
# Run in development mode
npm run dev

# Run tests
npm test

# Run tests in watch mode
npm run test:watch

# Run tests with coverage
npm run test:coverage

# Run only service layer tests
npm run test:service

# Lint code
npm run lint

# Clean build artifacts
npm run clean
```

## MongoDB Schema Design

The collections are designed for:
- **Time-series analysis**: Timestamp-based queries
- **Market tracking**: Complete market lifecycle
- **Price analysis**: Historical price movements
- **Event correlation**: Cross-market event analysis

## DAO Responsibilities

Each DAO is responsible for:
- **MarketDefinitionDAO**: Market definition CRUD operations
- **PriceUpdateDAO**: Price update CRUD operations  
- **MarketStatusDAO**: Market status CRUD operations

## Service Layer Responsibilities

The service layer handles:
- **Business Logic**: Data transformation and validation
- **Data Routing**: Message processing and routing to appropriate DAOs
- **Analysis**: Complex queries and data aggregation
- **File Processing**: Reading and parsing data files

## Configuration Management

The project uses [node-config](https://www.npmjs.com/package/config) for:
- **Hierarchical Configuration**: Environment-specific overrides
- **Environment Variables**: Easy deployment configuration
- **Type Safety**: Full TypeScript support
- **Validation**: Configuration validation on startup
- **Flexibility**: Multiple configuration file formats
