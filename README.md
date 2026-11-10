# Fabric Mod AI — Pro

A professional full-stack web application for AI-assisted Minecraft Fabric mod development.

## What's included

- Responsive developer-workbench UI with project brief, version picker, live activity log and countdown.\n- Account registration and login with scrypt password hashing and secure, HttpOnly sessions.\n- Private My Mods library with saved project source, file viewer, ZIP downloads, and AI-assisted revision requests.\n- PostgreSQL persistence for users, sessions, and generated mod projects.
- Node.js/Express backend; the OpenAI API key remains server-side.
- Official Fabric metadata lookup for game and loader versions.
- Per-project 60-minute server-side hard deadline, plus concurrency and rate limits. Most projects are expected to finish in about 30 minutes; complex projects may use the extra time.
- AI-generated Gradle/Fabric project files, compatibility report, and ZIP download.
- Optional Gradle build attempt when Gradle or a project wrapper is available.
- Build log capture and one targeted AI repair pass when time allows.
- Dockerfile and Docker Compose for deployment.

## Run locally

Requirements: Node.js 20+, npm, a Groq API key. To compile a generated mod, install a suitable JDK and Gradle, or use a valid Gradle wrapper included in the generated project.

```bash
npm install
cp .env.example .env
```

Edit `.env` and set `GROQ_API_KEY`. Set `DATABASE_URL` to a PostgreSQL connection string to enable accounts and saved mods. Optionally set `GROQ_MODEL` (default `openai/gpt-oss-120b`). Then:

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

Use persistent disk/storage for `data/` if you want generated ZIPs to survive restarts. The backend does not compile generated projects. Users download and extract the ZIP, then run BUILD.bat (Windows) or ./build.sh (macOS/Linux) to compile locally. The resulting mod JAR is in build/libs.

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

## Project time policy

The server assigns a hard 60-minute deadline when a job is accepted. The UI countdown is informational; server enforcement is authoritative. AI generation receives a timeout based on the remaining budget. Gradle compilation happens on the user’s computer, not on the backend.

## Important engineering notes

- “All versions” means the user can request any Minecraft version. Fabric Loader, Fabric API, Loom, mappings and Java compatibility vary by game version. The generated project must declare its actual target and caveats; do not assume one dependency set works for every release.
- A successful source check is not proof that a mod compiles or works in-game. The report distinguishes structural checks from actual compilation, which the user performs locally.
- Account data, sessions, and saved project files are stored in PostgreSQL. Active generation jobs and their live logs remain in process memory, so run a single backend instance unless a shared job queue is added. Configure a PostgreSQL database before enabling public registration. Apply rate limits and monitor usage.
- Do not execute untrusted generated Gradle projects on a machine containing sensitive credentials. Use an isolated container with restricted network/filesystem access for builds.
\n\n## Accounts and saved projects\n\nThe account system uses PostgreSQL via `DATABASE_URL`. On startup, the app creates the required tables automatically. Passwords are stored as scrypt hashes; login sessions are random opaque tokens stored hashed in the database and sent as HttpOnly, SameSite=Lax cookies. Each project is scoped to its owner. Add a PostgreSQL database connection string to Render before expecting registration or login to work.\n