# Stage 1: Build
FROM node:20-alpine AS build

# Set workdir
WORKDIR /usr/src/app

# Copy package files and install dependencies
COPY package*.json ./
RUN npm ci

# Copy source code
COPY . .

# Stage 2: Production
FROM node:20-alpine AS production

# Set production environment
ENV NODE_ENV=production

# Set workdir and user
WORKDIR /usr/src/app
RUN chown -R node:node /usr/src/app
USER node

# Copy only necessary files from build stage
COPY --from=build --chown=node:node /usr/src/app/package*.json ./
COPY --from=build --chown=node:node /usr/src/app/node_modules ./node_modules
COPY --from=build --chown=node:node /usr/src/app/server ./server
COPY --from=build --chown=node:node /usr/src/app/public ./public
COPY --from=build --chown=node:node /usr/src/app/db.js ./db.js
COPY --from=build --chown=node:node /usr/src/app/schemas ./schemas

# Expose app port
EXPOSE 3000

# Start command
CMD ["node", "server/server.js"]
