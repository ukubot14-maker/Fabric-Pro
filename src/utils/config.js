const path = require("path");

const ROOT = path.resolve(__dirname, "../..");

module.exports = {
  ROOT,
  PUBLIC_DIR: path.join(ROOT, "public"),
  DATA_DIR: path.join(ROOT, "data"),
  PROJECTS_DIR: path.join(ROOT, "data", "projects"),
  PORT: Number(process.env.PORT || 3000),
  MODEL: process.env.GROQ_MODEL || "openai/gpt-oss-120b",
  LIMIT_MS: 60 * 60 * 1000,
  MAX_ACTIVE_JOBS: Math.max(1, Number(process.env.MAX_ACTIVE_JOBS || 1))
};
