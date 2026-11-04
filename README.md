# Fabric Mod AI — Pro

A professional full-stack web application for AI-assisted Minecraft Fabric mod development.

## What's included

- Responsive developer-workbench UI with project brief, version picker, live activity log and countdown.
- Node.js/Express backend; the OpenAI API key remains server-side.
- Official Fabric metadata lookup for game and loader versions.
- Per-project 30-minute server-side deadline, plus concurrency and rate limits.
- AI-generated Gradle/Fabric project files, compatibility report, and ZIP download.
- Optional Gradle build attempt when Gradle or a project wrapper is available.
- Build log capture and one targeted AI repair pass when time allows.
- Dockerfile and Docker Compose for deployment.

## Run locally

Requirements: Node.js 20+, npm, an OpenAI API key. For actual Gradle compilation, install a suitable JDK and Gradle, or include a valid Gradle wrapper in the generated project.

```bash
npm install
cp .env.example .env
```

Edit `.env` and set `OPENAI_API_KEY`. Then:

```bash
npm start
```

Open http://localhost:3000.

## Deploy

### Backend (recommended: Render, Railway, Fly.io, or a VPS)

Deploy this repository as a Node web service. Set environment variables:
- `OPENAI_API_KEY` — secret API key
- `OPENAI_MODEL` — model available to your API account (default `gpt-4.1`)
- `CORS_ORIGINS` — exact frontend origin(s), comma-separated
- `MAX_ACTIVE_JOBS` — concurrent projects (default 1)

Use persistent disk/storage for `data/` if you want generated ZIPs to survive restarts. The included Dockerfile installs OpenJDK 21 and zip utilities; it does not install Gradle globally. A generated project can provide a wrapper, otherwise the build step reports that compilation was skipped.

### GitHub Pages frontend

GitHub Pages can host only the static frontend. This app is already structured so `public/` can be published separately:
1. Copy `public/index.html`, `public/css/`, and `public/js/` into the root of a GitHub Pages repository (preserve `css/` and `js/` paths).
2. In `public/js/app.js`, set `API_BASE` to the HTTPS URL of your deployed backend:
   `const API_BASE = "https://your-backend.example.com";`
3. Set `CORS_ORIGINS` on the backend to your GitHub Pages origin, e.g. `https://ukubot14-maker.github.io`.

Do not add `.env`, API keys, or private server files to the Pages repository.

## API

- `GET /api/health`
- `GET /api/versions`
- `POST /api/jobs` with `{ "name": "...", "version": "1.21.1", "prompt": "..." }`
- `GET /api/jobs/:id`
- `GET /api/jobs/:id/download`

## 30-minute policy

The server assigns a deadline at job acceptance and checks it again before marking the project complete. The UI countdown is informational; server enforcement is authoritative. Generation and build operations receive timeouts based on the remaining budget. The job is not allowed to continue indefinitely.

## Important engineering notes

- “All versions” means the user can request any Minecraft version. Fabric Loader, Fabric API, Loom, mappings and Java compatibility vary by game version. The generated project must declare its actual target and caveats; do not assume one dependency set works for every release.
- A successful AI response is not proof that a mod compiles. The UI reports whether Gradle compilation passed, failed, or was skipped.
- For production, use a persistent job store/queue, authentication, per-user quotas, artifact retention cleanup, stronger sandbox isolation for Gradle builds, and monitoring. This starter keeps jobs in process memory and should run as a single backend instance.
- Do not execute untrusted generated Gradle projects on a machine containing sensitive credentials. Use an isolated container with restricted network/filesystem access for builds.
