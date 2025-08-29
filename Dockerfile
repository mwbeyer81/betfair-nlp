# Use Node.js 20 Alpine for smaller image size
FROM node:20-alpine

# Set working directory
WORKDIR /app

# Copy package files
COPY package.json yarn.lock ./

# Install dependencies (including dev dependencies)
RUN yarn install --frozen-lockfile

# Copy source code
COPY . .

# Build the TypeScript application
RUN yarn build

# Expose port
EXPOSE 3000

# Start the application (default to production)
CMD ["yarn", "server"]
