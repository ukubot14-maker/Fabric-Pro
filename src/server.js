require("dotenv").config();
const express = require("express");
const helmet = require("helmet");
const cors = require("cors");
const rateLimit = require("express-rate-limit");
const path = require("path");
const api = require("./routes/api");
const auth = require("./routes/auth");
const projects = require("./routes/projects");
const { PUBLIC_DIR, PORT, PROJECTS_DIR } = require("./utils/config");
const { initDatabase } = require("./services/database");

const app = express();
app.set("trust proxy", 1);
require("fs").mkdirSync(PROJECTS_DIR, { recursive: true });
app.use(helmet({
  crossOriginResourcePolicy: { policy: "cross-origin" },
  contentSecurityPolicy: { directives: {
    "default-src": ["'self'"],
    "style-src": ["'self'", "'unsafe-inline'", "https://fonts.googleapis.com"],
    "font-src": ["'self'", "https://fonts.gstatic.com"],
    "script-src": ["'self'"],
    "img-src": ["'self'", "data:"],
    "connect-src": ["'self'"]
  }}
}));
const origins = (process.env.CORS_ORIGINS || "http://localhost:3000").split(",").map(value => value.trim());
app.use(cors({
  origin: (origin, callback) => {
    if (!origin || origins.includes(origin)) return callback(null, true);
    callback(new Error("Origin not allowed by CORS"));
  },
  credentials: true
}));
app.use(express.json({ limit: "5mb" }));
app.use("/api", rateLimit({ windowMs: 60_000, limit: 60, standardHeaders: true, legacyHeaders: false }));
app.use("/api/auth", auth);
app.use("/api/projects", projects);
app.use("/api", api);
app.use(express.static(PUBLIC_DIR));
app.get("*", (req, res) => res.sendFile(path.join(PUBLIC_DIR, "index.html")));
app.use((error, req, res, next) => {
  console.error(error);
  if (res.headersSent) return next(error);
  res.status(500).json({ error: "The server hit an unexpected error. Please try again." });
});

async function start() {
  try {
    const connected = await initDatabase();
    console.log(connected ? "Account database initialized." : "Account database is not configured.");
  } catch (error) {
    console.error("Account database initialization failed:", error.message);
  }
  app.listen(PORT, () => console.log(`Fabric Mod AI listening on http://localhost:${PORT}`));
}
start();
