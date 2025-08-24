# Betfair NLP

Betfair historical data processing with MongoDB

## Setup

### Option 1: Docker (Recommended)

1. **Start MongoDB with Docker Compose:**
   ```bash
   docker-compose up -d
   ```

2. **Verify MongoDB is running:**
   - MongoDB: `mongodb://admin:password123@localhost:27017/betfair_nlp`
   - Mongo Express (Web UI): http://localhost:8081
   - Username: `admin`, Password: `password123`

3. **Install dependencies:**
   ```bash
   yarn install
   ```

4. **Build the project:**
   ```bash
   yarn build
   ```

### Option 2: Local MongoDB

1. Install MongoDB locally
2. Copy `env.example` to `.env` and configure your connection
3. Install dependencies: `yarn install`
4. Build the project: `yarn build`

## Available Commands

### Data Processing Commands

After decompressing your .bz2 files to .jsonl format, you can use these commands to process them:

#### Process a single file
```bash
yarn process:file 'BASIC/2025/Feb/1/33928245/1.237066150.jsonl'
```

#### Process all files in a directory
```bash
yarn process:directory 'BASIC/2025/Feb/1/33928245'
```

#### Process all files for a specific event
```bash
yarn process:event '33928245'
```

### Development Commands

- `yarn dev` - Start development server
- `yarn test` - Run tests
- `yarn build` - Build for production
- `yarn format` - Format code with Prettier
- `yarn lint` - Run ESLint

### Docker Commands

- `docker-compose up -d` - Start MongoDB and Mongo Express
- `docker-compose down` - Stop all services
- `docker-compose logs mongodb` - View MongoDB logs
- `docker-compose logs mongo-express` - View Mongo Express logs
- `docker-compose restart mongodb` - Restart MongoDB service

## Data Processing Workflow

1. **Decompress files**: Extract your .bz2 files to .jsonl format
2. **Process files**: Use the processing commands above to load data into MongoDB
3. **Analyze data**: Use the service methods to query and analyze the processed data

## File Structure

- `BASIC/` - Contains historical data organized by date and event
- `src/commands/` - Processing command scripts
- `src/lib/service/` - Core business logic
- `src/lib/dao/` - Data access objects for MongoDB
