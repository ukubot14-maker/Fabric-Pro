const express = require("express");
const fs = require("fs");
const path = require("path");
const archiver = require("archiver");
const { v4: uuid } = require("uuid");
const { getVersions } = require("../services/fabric-meta");
const { createProject } = require("../services/mod-builder");
const { PROJECTS_DIR, LIMIT_MS, MAX_ACTIVE_JOBS } = require("../utils/config");
const { pool, isReady } = require("../services/database");
const { requireAuth } = require("../middleware/auth");

const router = express.Router();
const jobs = new Map();

function remaining(job) { return Math.max(0, Math.ceil((job.deadline - Date.now()) / 1000)); }
function snapshot(job) {
  return {
    id: job.id, projectId: job.projectId || null, name: job.name, version: job.version,
    status: job.status, phase: job.phase, log: job.log.slice(-50),
    files: job.fileList || [], fileCount: job.fileCount || 0,
    buildStatus: job.buildStatus || "pending", checkErrors: job.checkErrors || [],
    checkWarnings: job.checkWarnings || [], pendingTexture: job.pendingTexture || null,
    remainingSeconds: remaining(job), error: job.error || null
  };
}
function log(job, message) {
  job.log.push({ at: new Date().toISOString(), message });
  job.log = job.log.slice(-100);
}
function readProjectFiles(dir) {
  const files = [];
  function walk(folder, relative = "") {
    for (const entry of fs.readdirSync(folder, { withFileTypes: true })) {
      if ([".git", ".gradle", "build", "node_modules"].includes(entry.name)) continue;
      const rel = path.posix.join(relative, entry.name);
      const full = path.join(folder, entry.name);
      if (entry.isDirectory()) walk(full, rel);
      else if (entry.isFile()) {
        if (rel.toLowerCase().endsWith(".png")) {
          files.push({ path: rel, content: "data:image/png;base64," + fs.readFileSync(full).toString("base64"), encoding: "base64-png" });
        } else {
          files.push({ path: rel, content: fs.readFileSync(full, "utf8") });
        }
      }
    }
  }
  walk(dir);
  return files;
}

router.get("/health", (req, res) => res.json({
  ok: true, service: "Fabric Mod AI", limitMinutes: 60,
  accountsConfigured: isReady(),
  activeJobs: [...jobs.values()].filter(job => ["running", "waiting_for_texture"].includes(job.status)).length
}));
router.get("/versions", async (req, res) => {
  try { res.json(await getVersions()); }
  catch (error) { res.status(503).json({ error: error.message }); }
});

router.post("/jobs", requireAuth, async (req, res) => {
  if (!isReady()) return res.status(503).json({ error: "Account database is not configured." });
  if (!process.env.GROQ_API_KEY) return res.status(503).json({ error: "AI backend is not configured. Add GROQ_API_KEY to the server environment." });
  if ([...jobs.values()].filter(job => ["running", "waiting_for_texture"].includes(job.status)).length >= MAX_ACTIVE_JOBS) {
    return res.status(429).json({ error: "The mod workshop is busy. Try again when the current project finishes." });
  }
  const { name, prompt, version } = req.body || {};
  if (typeof prompt !== "string" || prompt.trim().length < 8 || prompt.length > 12000) {
    return res.status(400).json({ error: "Describe the mod in 8–12,000 characters." });
  }
  const cleanName = String(name || "MyFabricMod").replace(/[^a-zA-Z0-9_-]/g, "").slice(0, 48) || "MyFabricMod";
  const target = String(version || "latest").slice(0, 40);
  const job = {
    id: uuid(), userId: req.user.id, name: cleanName, version: target, prompt: prompt.trim(),
    status: "running", phase: "Planning", started: Date.now(), deadline: Date.now() + LIMIT_MS,
    log: [], fileCount: 0, fileList: [], buildStatus: "pending"
  };
  jobs.set(job.id, job);
  log(job, `Accepted project. Hard deadline: ${new Date(job.deadline).toISOString()}.`);
  res.status(202).json(snapshot(job));

  createProject(job, message => { job.phase = message; log(job, message); }, texture =>
    new Promise(resolve => {
      job.status = "waiting_for_texture";
      job.phase = "Upload " + texture.filename;
      job.pendingTexture = texture;
      job.resolveTexture = resolve;
      job.textureTimeout = setTimeout(() => {
        job.resolveTexture = null;
        job.pendingTexture = null;
        job.status = "expired";
        reject(new Error("The generation deadline was reached while waiting for a texture upload."));
      }, Math.max(1000, job.deadline - Date.now()));
    })
  ).then(async dir => {
    if (Date.now() > job.deadline) {
      job.status = "expired"; job.phase = "Time limit reached";
      log(job, "Project exceeded its 60-minute deadline."); return;
    }
    const files = readProjectFiles(dir);
    const reportFile = files.find(file => file.path === "FABRIC-MOD-AI-REPORT.md");
    const overview = reportFile ? reportFile.content.split("\n").slice(0, 5).join("\n") : "";
    await pool.query(
      "INSERT INTO projects(id,user_id,name,minecraft_version,prompt,overview,files,check_errors,check_warnings) VALUES($1,$2,$3,$4,$5,$6,$7::jsonb,$8::jsonb,$9::jsonb)",
      [job.id, job.userId, job.name, job.version, job.prompt, overview, JSON.stringify(files),
       JSON.stringify(job.checkErrors || []), JSON.stringify(job.checkWarnings || [])]
    );
    job.projectId = job.id;
    job.status = "completed"; job.phase = "Saved to your mod library";
    log(job, "Project saved to your account's My Mods library.");
    log(job, "Project generation workflow finished.");
  }).catch(error => {
    job.status = Date.now() > job.deadline ? "expired" : "failed";
    job.phase = job.status === "expired" ? "Time limit reached" : "Needs attention";
    job.error = error.message; log(job, error.message);
  });
});

router.post("/jobs/:id/texture", requireAuth, (req, res) => {
  const job = jobs.get(req.params.id);
  if (!job || job.userId !== req.user.id) return res.status(404).json({ error: "Project job not found." });
  if (job.status !== "waiting_for_texture" || !job.pendingTexture || typeof job.resolveTexture !== "function") {
    return res.status(409).json({ error: "This project is not waiting for a texture upload." });
  }
  const dataUrl = String(req.body?.pngDataUrl || "");
  const match = dataUrl.match(/^data:image\/png;base64,([A-Za-z0-9+/=]+)$/);
  if (!match) return res.status(400).json({ error: "Please upload a PNG image." });
  const buffer = Buffer.from(match[1], "base64");
  if (buffer.length < 8 || buffer.length > 1024 * 1024 ||
      !buffer.subarray(0, 8).equals(Buffer.from([137,80,78,71,13,10,26,10]))) {
    return res.status(400).json({ error: "PNG must be valid and no larger than 1 MB." });
  }
  const resolve = job.resolveTexture;
  clearTimeout(job.textureTimeout);
  job.textureTimeout = null;
  job.resolveTexture = null;
  job.pendingTexture = null;
  job.status = "running";
  job.phase = "Continuing generation";
  log(job, "Texture upload received. Continuing generation.");
  resolve(buffer);
  res.json({ ok: true, message: "Texture received. Generation is continuing." });
});

router.get("/jobs/:id", requireAuth, (req, res) => {
  const job = jobs.get(req.params.id);
  if (!job || job.userId !== req.user.id) return res.status(404).json({ error: "Project job not found." });
  if (["running", "waiting_for_texture"].includes(job.status) && Date.now() > job.deadline) {
    job.status = "expired"; job.phase = "Time limit reached"; log(job, "Hard deadline reached.");
  }
  res.json(snapshot(job));
});

router.get("/jobs/:id/download", requireAuth, async (req, res, next) => {
  try {
    const result = await pool.query("SELECT name,files FROM projects WHERE id=$1 AND user_id=$2", [req.params.id, req.user.id]);
    if (!result.rowCount) return res.status(404).json({ error: "Saved project not found." });
    const name = String(result.rows[0].name).replace(/[^a-zA-Z0-9_-]/g, "") || "FabricMod";
    res.setHeader("Content-Type", "application/zip");
    res.setHeader("Content-Disposition", `attachment; filename="${name}-fabric-project.zip"`);
    const archive = archiver("zip", { zlib: { level: 8 } });
    archive.on("error", error => { if (!res.headersSent) next(error); else res.destroy(error); });
    archive.pipe(res);
    for (const file of result.rows[0].files) archive.append(String(file.content || ""), { name: file.path });
    archive.finalize();
  } catch (error) { next(error); }
});

module.exports = router;
