FROM node:22-bookworm-slim AS builder

WORKDIR /app

# python3/make/g++ are needed if better-sqlite3/sodium-native/@snazzah/davey
# have no prebuilt binary for this platform and fall back to compiling.
RUN apt-get update && apt-get install -y --no-install-recommends \
    python3 make g++ \
    && rm -rf /var/lib/apt/lists/*

COPY package.json package-lock.json ./
RUN npm ci --omit=dev

FROM node:22-bookworm-slim

WORKDIR /app

RUN groupadd --gid 1001 nodeapp && useradd --uid 1001 --gid nodeapp --shell /bin/bash --create-home nodeapp

COPY --from=builder /app/node_modules ./node_modules
COPY . .

RUN mkdir -p /app/data /app/sounds && chown -R nodeapp:nodeapp /app

USER nodeapp

CMD ["node", "index.js"]
