# Betfair NLP

Betfair historical data processing with MongoDB

## Project Overview

This project consists of two main components:

1. **Backend**: Betfair data processing and analysis with MongoDB
2. **Client**: React Native/Expo chat application with Storybook

## Client Chat App

A modern chat interface built with React Native, Expo, and TypeScript. Features include:

- **Cross-platform**: Works on mobile (iOS/Android) and web
- **ChatGPT-like UI**: Modern chat interface with message bubbles
- **Storybook**: Component development and testing
- **Stubbed API**: Demo responses for testing

### Quick Start (Client)

```bash
cd client
npm install
npm start
```

For detailed client documentation, see [client/README.md](client/README.md).

### Client Features

- **Mobile & Web Support**: Run on iOS, Android, and web browsers
- **Storybook Integration**: Component development and testing
- **TypeScript**: Full type safety
- **Modular Components**: Reusable Message and ChatInput components
- **API Integration**: Ready for backend integration

### Client Commands

```bash
# Run on different platforms
npm run ios          # iOS simulator
npm run android      # Android emulator
npm run web          # Web browser

# Storybook
npm run storybook:headless  # CI/CD mode
npm run storybook:headful   # Browser mode
```

## Backend Setup

### Option 1: MongoDB Atlas (Recommended)

1. **Configure your MongoDB Atlas connection:**
   - Replace `<db_password>` in `config/default.json` with your actual password
   - The connection string is: `mongodb+srv://mattbeyer81:<db_password>@cluster0.lxpmuim.mongodb.net/`

2. **Verify connection:**
   - Database: `betfair_nlp` (will be created automatically)
   - Cluster: `cluster0.lxpmuim.mongodb.net`

### Option 2: Docker (Local Development)

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

### Option 3: Local MongoDB

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

```
betfair-nlp/
├── client/                    # React Native/Expo chat app
│   ├── src/
│   │   ├── components/        # UI components
│   │   └── services/          # API client
│   ├── .storybook/           # Web Storybook config
│   └── .rnstorybook/         # React Native Storybook config
├── src/                      # Backend source code
│   ├── commands/             # Processing command scripts
│   ├── lib/service/          # Core business logic
│   └── lib/dao/              # Data access objects
├── config/                   # Configuration files
├── BASIC/                    # Historical data files
└── docker-compose.yml        # Docker services
```

## Database Management

### Drop All Collections

To completely reset your database and remove all data:

#### Option 1: Using MongoDB Shell (Atlas)
```bash
# Connect to MongoDB Atlas
mongosh "mongodb+srv://mattbeyer81:<db_password>@cluster0.lxpmuim.mongodb.net/"

# Switch to the database
use betfair_nlp

# Drop all collections
db.market_definitions.drop()
db.price_updates.drop()
db.market_statuses.drop()

# Verify collections are dropped
show collections
```

#### Option 2: Using MongoDB Compass
1. Connect to `mongodb+srv://mattbeyer81:<db_password>@cluster0.lxpmuim.mongodb.net/`
2. Navigate to the `betfair_nlp` database
3. Right-click on each collection and select "Drop Collection"
4. Confirm the deletion

#### Option 3: Using Docker (Local Development)
```bash
# Connect to MongoDB
docker exec -it betfair-nlp-mongodb mongosh

# Switch to the database
use betfair_nlp

# Drop all collections
db.market_definitions.drop()
db.price_updates.drop()
db.market_statuses.drop()

# Verify collections are dropped
show collections
```

**⚠️ Warning**: Dropping collections will permanently delete all data. Make sure you have backups if needed.
