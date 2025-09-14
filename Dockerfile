# Use Node.js 20 Alpine for smaller image size
FROM node:20-alpine

# Install mongosh in the Node.js container
RUN apk add --no-cache curl bash && \
    curl -L -o mongosh.tgz "https://github.com/mongodb-js/mongosh/releases/download/v2.5.8/mongosh-2.5.8-linux-arm64-openssl3.tgz" && \
    ls -la mongosh.tgz && \
    hexdump -C mongosh.tgz | head -5 && \
    tar -xzf mongosh.tgz && \
    ls -la mongosh-2.5.8-linux-arm64-openssl3/ && \
    mv mongosh-2.5.8-linux-arm64-openssl3/bin/* /usr/local/bin/ && \
    rm -rf mongosh.tgz mongosh-2.5.8-linux-arm64-openssl3

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
