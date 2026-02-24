FROM node:22-bookworm-slim

# Container marker — test-guard.ts checks for this
ENV IN_CLAWCOIN_TEST_CONTAINER=1

# Install pnpm and git
RUN corepack enable && corepack prepare pnpm@latest --activate
RUN apt-get update && apt-get install -y git && rm -rf /var/lib/apt/lists/*

WORKDIR /app

# Copy package files first for layer caching
COPY package.json package-lock.json* ./
COPY contracts/package.json contracts/

# Install dependencies
RUN npm install

# Install contract dependencies
RUN cd contracts && npm install

# Copy full source
COPY . .

CMD ["npm", "test"]
