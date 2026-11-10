const express = require("express");
const archiver = require("archiver");
const { pool } = require("../services/database");
const { reviseProject } = require("../services/mod-builder");
const { requireAuth } = require("../middleware/auth");

const router = express.Router();
router.use(requireAuth);

router.get("/", async (req, res, next) => {
  try {
    const result = await pool.query(
      "SELECT id,name,minecraft_version,overview,created_at,updated_at,jsonb_array_length(files) AS file_count FROM projects WHERE user_id=$1 ORDER BY updated_at DESC",
      [req.user.id]
    );
    res.json({ projects: result.rows });
  } catch (error) { next(error); }
});

router.get("/:id", async (req, res, next) => {
  try {
    const result = await pool.query(
      "SELECT id,name,minecraft_version,prompt,overview,files,check_errors,check_warnings,created_at,updated_at FROM projects WHERE id=$1 AND user_id=$2",
      [req.params.id, req.user.id]
    );
    if (!result.rowCount) return res.status(404).json({ error: "Mod project not found." });
    res.json({ project: result.rows[0] });
  } catch (error) { next(error); }
});

router.post("/:id/revise", async (req, res, next) => {
  try {
    const instruction = String(req.body?.instruction || "").trim();
    if (instruction.length < 8 || instruction.length > 4000) {
      return res.status(400).json({ error: "Describe the fix or feature in 8–4,000 characters." });
    }
    const found = await pool.query(
      "SELECT id,user_id,name,minecraft_version,prompt,overview,files FROM projects WHERE id=$1 AND user_id=$2",
      [req.params.id, req.user.id]
    );
    if (!found.rowCount) return res.status(404).json({ error: "Mod project not found." });
    const current = found.rows[0];
    const revised = await reviseProject(current, instruction);
    const update = await pool.query(
      "UPDATE projects SET files=$1::jsonb,overview=$2,prompt=$3,updated_at=NOW(),check_errors='[]'::jsonb,check_warnings='[]'::jsonb WHERE id=$4 AND user_id=$5 RETURNING id,name,minecraft_version,overview,updated_at,jsonb_array_length(files) AS file_count",
      [JSON.stringify(revised.files), revised.overview, current.prompt + "\n\nRequested update: " + instruction, current.id, req.user.id]
    );
    res.json({ project: update.rows[0], message: "The updated source files have been saved to your account. Build and test the project before using it." });
  } catch (error) { next(error); }
});

router.post("/:id/textures", async (req, res, next) => {
  try {
    const filePath = String(req.body?.path || "");
    const dataUrl = String(req.body?.pngDataUrl || "");
    const allowed = /^src\\/main\\/resources\\/assets\\/[a-z0-9_.-]{1,64}\\/textures\\/(item|block)\\/[a-zA-Z0-9_-]{1,64}\\.png$/;
    if (!allowed.test(filePath)) return res.status(400).json({ error: "Texture path must be inside your mod's item or block texture folder." });
    const match = dataUrl.match(/^data:image\\/png;base64,([A-Za-z0-9+/=]+)$/);
    if (!match) return res.status(400).json({ error: "Upload must be a valid PNG image." });
    const buffer = Buffer.from(match[1], "base64");
    if (buffer.length < 8 || buffer.length > 1024 * 1024 || !buffer.subarray(0,8).equals(Buffer.from([137,80,78,71,13,10,26,10]))) {
      return res.status(400).json({ error: "PNG must be valid and no larger than 1 MB." });
    }
    const found = await pool.query("SELECT files FROM projects WHERE id=$1 AND user_id=$2", [req.params.id, req.user.id]);
    if (!found.rowCount) return res.status(404).json({ error: "Mod project not found." });
    const files = Array.isArray(found.rows[0].files) ? found.rows[0].files : [];
    const content = buffer.toString("base64");
    const existing = files.findIndex(file => file.path === filePath);
    const entry = { path: filePath, content: "data:image/png;base64," + content, encoding: "base64-png" };
    if (existing >= 0) files[existing] = entry; else files.push(entry);
    await pool.query("UPDATE projects SET files=$1::jsonb,updated_at=NOW() WHERE id=$2 AND user_id=$3", [JSON.stringify(files), req.params.id, req.user.id]);
    res.json({ ok: true, path: filePath, message: "Texture saved to your project." });
  } catch (error) { next(error); }
});

router.get("/:id/download", async (req, res, next) => {
  try {
    const found = await pool.query(
      "SELECT name,files FROM projects WHERE id=$1 AND user_id=$2",
      [req.params.id, req.user.id]
    );
    if (!found.rowCount) return res.status(404).json({ error: "Mod project not found." });
    const name = String(found.rows[0].name || "FabricMod").replace(/[^a-zA-Z0-9_-]/g, "") || "FabricMod";
    res.setHeader("Content-Type", "application/zip");
    res.setHeader("Content-Disposition", `attachment; filename="${name}-fabric-project.zip"`);
    const archive = archiver("zip", { zlib: { level: 8 } });
    archive.on("error", error => { if (!res.headersSent) next(error); else res.destroy(error); });
    archive.pipe(res);
    for (const file of found.rows[0].files) {
      if (file.encoding === "base64-png" && String(file.content || "").startsWith("data:image/png;base64,")) {
        archive.append(Buffer.from(file.content.slice("data:image/png;base64,".length), "base64"), { name: file.path });
      } else {
        archive.append(String(file.content || ""), { name: file.path });
      }
    }
    archive.finalize();
  } catch (error) { next(error); }
});

module.exports = router;
