FROM node:22-bookworm-slim

WORKDIR /app

# Install Java 21 from the official Eclipse Temurin image
COPY --from=eclipse-temurin:21-jdk /opt/java/openjdk /opt/java/openjdk
ENV JAVA_HOME=/opt/java/openjdk
ENV PATH="${JAVA_HOME}/bin:${PATH}"

# Install Gradle and other tools
RUN apt-get update && apt-get install -y --no-install-recommends 
    gradle zip unzip git ca-certificates 
    && rm -rf /var/lib/apt/lists/*

COPY package*.json ./
RUN npm ci --omit=dev

COPY . .

ENV NODE_ENV=production PORT=3000

EXPOSE 3000

CMD ["npm","start"]
