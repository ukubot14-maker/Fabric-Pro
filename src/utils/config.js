```js
const path = require("path");

const ROOT = path.resolve(__dirname, "../..");

module.exports = {
  ROOT,

  PUBLIC_DIR: path.join(ROOT, "public"),
  DATA_DIR: path.join(ROOT, "data"),
  PROJECTS_DIR: path.join(ROOT, "data", "projects"),

  PORT: Number(process.env.PORT || 3000),

  // Groq AI model
  MODEL: process.env.GROQ_MODEL || "openai/gpt-oss-120b",

  // Maximum time allowed for each mod project: 30 minutes
  LIMIT_MS: 30 * 60 * 1000,

  // Maximum number of active projects
  MAX_ACTIVE_JOBS: Math.max(
    1,
    Number(process.env.MAX_ACTIVE_JOBS || 1)
  )
};
```
