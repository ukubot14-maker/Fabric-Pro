FROM node:22-bookworm-slim

WORKDIR /app

# Install Java 21, Gradle, and build tools
RUN apt-get update && apt-get install -y --no-install-recommends 
    openjdk-21-jdk-headless 
    gradle 
    zip 
    unzip 
    git 
    ca-certificates 
    && rm -rf /var/lib/apt/lists/*

COPY package*.json ./
RUN npm ci --omit=dev

COPY . .

ENV NODE_ENV=production PORT=3000

EXPOSE 3000

CMD ["npm","start"]
