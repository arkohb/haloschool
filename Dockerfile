FROM node:18-alpine

WORKDIR /app

# Install build tools needed for better-sqlite3 native addon on Alpine
RUN apk add --no-cache python3 make g++

# Copy package files
COPY package*.json ./

# Install dependencies (npm install works without lock file)
RUN npm install --omit=dev

# Copy application code
COPY . .

EXPOSE 5000

# Health check
HEALTHCHECK --interval=30s --timeout=10s --start-period=5s --retries=3 \
  CMD node -e "require('http').get('http://localhost:5000/api/health', (r) => {if (r.statusCode !== 200) throw new Error(r.statusCode)})"

CMD ["npm", "start"]
