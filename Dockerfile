FROM gradle:8.10.2-jdk21 AS gradle

FROM node:22-bookworm-slim

WORKDIR /app

# Copy verified Gradle and Java installations
COPY --from=gradle /opt/gradle /opt/gradle
COPY --from=gradle /opt/java/openjdk /opt/java/openjdk

ENV GRADLE_HOME=/opt/gradle
ENV JAVA_HOME=/opt/java/openjdk
ENV PATH=/opt/gradle/bin:/opt/java/openjdk/bin:$PATH

# Install supporting tools
RUN apt-get update && apt-get install -y --no-install-recommends zip unzip git ca-certificates && rm -rf /var/lib/apt/lists/*

# Verify the build tools during deployment
RUN java -version && gradle --version

COPY package*.json ./
RUN npm ci --omit=dev

COPY . .

ENV NODE_ENV=production PORT=3000

EXPOSE 3000

CMD ["npm","start"]
