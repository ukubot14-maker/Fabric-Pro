const fs = require("fs");
const path = require("path");
const { spawn } = require("child_process");
const { chat } = require("./openai");
const { PROJECTS_DIR } = require("../utils/config");

const SYSTEM = `You are Fabric Mod AI, an expert Minecraft Fabric mod engineer. Return ONLY valid JSON with this schema:
{"overview":"short explanation","compatibility":{"minecraft":"version","java":"version","loader":"version range","notes":"honest caveats"},"files":[{"path":"relative/path","content":"complete text file content"}]}
Generate a COMPLETE Gradle project with settings.gradle, build.gradle, gradle.properties, src/main/resources/fabric.mod.json, Java source, README.md, and assets/config where required. Use official Fabric Loom and Fabric API conventions compatible with the requested Minecraft version. Use exact, released, stable dependency and plugin versions. Never output placeholders such as <loom-version>, TODO_VERSION, unresolved version variables, or SNAPSHOT plugin versions. In settings.gradle, pluginManagement must be the first executable block and must include the Fabric Maven repository (https://maven.fabricmc.net/). Prefer stable APIs and minimal dependencies. Include a gradlew wrapper only if you can provide correct wrapper files; otherwise use installed Gradle. Never include binaries, secrets, absolute paths, .. path segments, symlinks, or scripts that download/execute arbitrary code. Use package dev.fabricmodai.<modid>. Provide useful comments, error handling, and client/server separation. If a feature is not feasible or version support is uncertain, say so rather than pretending.`;

const MAX_BUILD_ATTEMPTS = 3; // Initial build plus up to two AI repair/build cycles.
const MAX_BUILD_MS = 8 * 60 * 1000;
const MAX_REPAIR_MS = 150 * 1000;
const DIAGNOSTIC_CHARS = 18000;

function safePath(p) {
  const s = String(p || "").replace(/\\/g, "/");
  const parts = s.split("/");
  return !!s && !s.startsWith("/") && !parts.includes("..") &&
    !s.includes("\0") && !parts.some(x => [".git", ".gradle", "build", "node_modules"].includes(x));
}

function writeFiles(dir, files) {
  let count = 0, bytes = 0;
  for (const f of files) {
    if (!safePath(f.path) || typeof f.content !== "string") continue;
    bytes += Buffer.byteLength(f.content);
    if (bytes > 4_000_000) throw new Error("Generated source exceeded the 4 MB project safety limit.");
    const dest = path.join(dir, f.path);
    fs.mkdirSync(path.dirname(dest), { recursive: true });
    fs.writeFileSync(dest, f.content, "utf8");
    count++;
  }
  if (!count) throw new Error("AI did not return any valid project files.");
  return count;
}

function refreshFileList(dir, job) {
  const files = [];
  function walk(current, relative = "") {
    for (const entry of fs.readdirSync(current, { withFileTypes: true })) {
      if ([".git", ".gradle", "build", "node_modules"].includes(entry.name)) continue;
      const rel = path.posix.join(relative, entry.name);
      if (entry.isDirectory()) walk(path.join(current, entry.name), rel);
      else if (entry.isFile()) files.push(rel);
    }
  }
  walk(dir);
  job.fileList = files.sort();
  job.fileCount = files.length;
}

function run(cmd, args, { cwd, timeoutMs = 120000 } = {}) {
  return new Promise(resolve => {
    let child;
    try {
      child = spawn(cmd, args, {
        cwd,
        stdio: ["ignore", "pipe", "pipe"],
        detached: process.platform !== "win32"
      });
    } catch (error) {
      resolve({ code: 127, stdout: "", stderr: error.message, timedOut: false });
      return;
    }

    let out = "", err = "", done = false, timedOut = false;
    const keepTail = (current, chunk) => (current + chunk).slice(-1000000);
    const timer = setTimeout(() => {
      timedOut = true;
      try {
        if (process.platform !== "win32" && child.pid) process.kill(-child.pid, "SIGKILL");
        else child.kill("SIGKILL");
      } catch (_) {}
      finish(124);
    }, Math.max(1000, timeoutMs));

    function finish(code) {
      if (done) return;
      done = true;
      clearTimeout(timer);
      resolve({ code: code ?? 1, stdout: out, stderr: err, timedOut });
    }

    child.stdout.on("data", data => { out = keepTail(out, data.toString()); });
    child.stderr.on("data", data => { err = keepTail(err, data.toString()); });
    child.on("error", error => { err = keepTail(err, error.message); finish(127); });
    child.on("close", finish);
  });
}

function gradleInvocation(dir) {
  const wrapper = path.join(dir, "gradlew");
  const wrapperBat = path.join(dir, "gradlew.bat");
  if (process.platform === "win32" && fs.existsSync(wrapperBat)) {
    return { command: "gradlew.bat", prefix: [] };
  }
  if (fs.existsSync(wrapper)) {
    return process.platform === "win32"
      ? { command: "gradlew.bat", prefix: [] }
      : { command: "bash", prefix: ["./gradlew"] };
  }
  return { command: "gradle", prefix: [] };
}

function diagnostics(result) {
  return [
    "Exit code: " + result.code + (result.timedOut ? " (timed out)" : ""),
    "STDERR:",
    result.stderr || "(none)",
    "STDOUT:",
    result.stdout || "(none)"
  ].join("\n").slice(-DIAGNOSTIC_CHARS);
}

function validateGradleConfig(dir) {
  const issues = [];
  const settingsPath = fs.existsSync(path.join(dir, "settings.gradle"))
    ? path.join(dir, "settings.gradle")
    : path.join(dir, "settings.gradle.kts");
  const buildPath = fs.existsSync(path.join(dir, "build.gradle"))
    ? path.join(dir, "build.gradle")
    : path.join(dir, "build.gradle.kts");
  if (!fs.existsSync(settingsPath)) issues.push("Missing settings.gradle or settings.gradle.kts.");
  if (!fs.existsSync(buildPath)) issues.push("Missing build.gradle or build.gradle.kts.");
  if (!fs.existsSync(settingsPath) || !fs.existsSync(buildPath)) return issues;

  const settings = fs.readFileSync(settingsPath, "utf8");
  const build = fs.readFileSync(buildPath, "utf8");
  const gradleText = settings + "\n" + build;
  if (/<(?:loom-version|fabric-loom-version|minecraft-version|fabric-api-version|version)>|TODO_VERSION|REPLACE_ME/i.test(gradleText)) {
    issues.push("Gradle files contain an unresolved version placeholder.");
  }
  if (/fabric-loom[\s\S]{0,160}?SNAPSHOT/i.test(gradleText)) {
    issues.push("Fabric Loom is configured with a SNAPSHOT version; use a released stable version.");
  }
  const executableSettings = settings
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/^\s*\/\/.*$/gm, "")
    .trimStart();
  if (!/^pluginManagement\s*\{/m.test(executableSettings)) {
    issues.push("settings.gradle must start with pluginManagement { as its first executable block.");
  }
  const pluginBlock = executableSettings.indexOf("pluginManagement");
  const firstRootSetting = executableSettings.search(/\b(rootProject\.name|include|plugins\s*\{)/);
  if (pluginBlock > 0 && firstRootSetting >= 0 && firstRootSetting < pluginBlock) {
    issues.push("pluginManagement must appear before rootProject.name, include, and plugins blocks in settings.gradle.");
  }
  if (!/maven\.fabricmc\.net/i.test(settings)) {
    issues.push("settings.gradle pluginManagement must declare https://maven.fabricmc.net/ for Fabric Loom resolution.");
  }
  return issues;
}

function readRepairContext(dir) {
  const names = ["settings.gradle", "settings.gradle.kts", "build.gradle", "build.gradle.kts", "gradle.properties", "src/main/resources/fabric.mod.json"];
  const parts = [];
  for (const name of names) {
    const file = path.join(dir, name);
    if (fs.existsSync(file) && fs.statSync(file).isFile()) {
      parts.push("===== " + name + " =====\n" + fs.readFileSync(file, "utf8"));
    }
  }
  return parts.join("\n\n").slice(-45000) || "No standard Gradle configuration files were found.";
}

async function createProject(job, onLog) {
  const dir = path.join(PROJECTS_DIR, job.id);
  fs.mkdirSync(dir, { recursive: true });
  const remainingMs = () => job.deadline - Date.now();
  const budget = () => Math.max(1000, remainingMs() - 15000);
  const buildLogPath = path.join(dir, "BUILD-LOG.txt");

  onLog("Planning the mod architecture and target-version strategy.");
  const raw = await chat([
    { role: "system", content: SYSTEM },
    { role: "user", content:
      `Mod name: ${job.name}\nMinecraft version: ${job.version}\nMod requirements:\n${job.prompt}\nCreate the complete project now. Do not spend time asking questions; make sensible assumptions and document them.`
    }
  ], { timeoutMs: Math.min(180000, budget()) });

  if (remainingMs() <= 0) throw new Error("The 60-minute deadline was reached during code generation.");
  let result;
  try { result = JSON.parse(raw); }
  catch { throw new Error("AI response was not valid project JSON."); }
  if (!Array.isArray(result.files)) throw new Error("AI response did not contain a files array.");

  const count = writeFiles(dir, result.files);
  fs.writeFileSync(path.join(dir, "FABRIC-MOD-AI-REPORT.md"),
    `# ${job.name}\n\n${result.overview || "Generated Fabric mod project"}\n\n## Compatibility\n\n- Minecraft: ${result.compatibility?.minecraft || job.version}\n- Java: ${result.compatibility?.java || "See README"}\n- Fabric Loader: ${result.compatibility?.loader || "See build.gradle"}\n- Notes: ${result.compatibility?.notes || "Build and test before use."}\n\nGenerated by Fabric Mod AI. Source generation is not proof of a successful build.\n`);
  refreshFileList(dir, job);
  onLog(`Wrote ${count} source files and generated the project report.`);

  const hasGradleProject =
    fs.existsSync(path.join(dir, "build.gradle")) ||
    fs.existsSync(path.join(dir, "build.gradle.kts"));
  const invocation = gradleInvocation(dir);

  if (!hasGradleProject) {
    job.buildStatus = "not-run";
    onLog("No Gradle build file was generated; source project is ready without compilation.");
    return dir;
  }

  if (remainingMs() <= 30000) {
    job.buildStatus = "not-run";
    onLog("Not enough time remained to safely start a Gradle build.");
    return dir;
  }

  onLog("Checking whether the Gradle toolchain is available.");
  const check = await run(invocation.command, [...invocation.prefix, "--version"], {
    cwd: dir, timeoutMs: Math.min(20000, budget())
  });

  if (check.code !== 0) {
    job.buildStatus = "not-run";
    fs.writeFileSync(buildLogPath, diagnostics(check));
    refreshFileList(dir, job);
    onLog("Gradle is unavailable or the wrapper could not start. Details are in BUILD-LOG.txt.");
    return dir;
  }

  let lastBuild = null;
  for (let attempt = 1; attempt <= MAX_BUILD_ATTEMPTS; attempt++) {
    if (remainingMs() <= 30000) break;

    onLog(attempt === 1
      ? "Running Gradle build. Build output is being captured."
      : `Running Gradle build after repair (attempt ${attempt} of ${MAX_BUILD_ATTEMPTS}).`);

    const configIssues = validateGradleConfig(dir);
    let build;
    if (configIssues.length) {
      build = { code: 1, stdout: "", stderr: "Pre-build validation failed:\n" + configIssues.map(x => "- " + x).join("\n"), timedOut: false };
    } else {
      onLog("Checking Gradle configuration before compilation.");
      const configCheck = await run(invocation.command, [...invocation.prefix, "help", "--no-daemon"], {
        cwd: dir,
        timeoutMs: Math.min(120000, budget())
      });
      if (configCheck.code !== 0) {
        build = configCheck;
      } else {
        onLog("Gradle configuration check passed. Starting compilation.");
        build = await run(invocation.command, [...invocation.prefix, "build", "--no-daemon"], {
          cwd: dir,
          timeoutMs: Math.min(MAX_BUILD_MS, budget())
        });
      }
    }
    lastBuild = build;

    fs.appendFileSync(buildLogPath,
      `\n\n========== BUILD ATTEMPT ${attempt} · ${new Date().toISOString()} ==========\n${diagnostics(build)}\n`);
    refreshFileList(dir, job);

    if (build.code === 0) {
      job.buildStatus = "passed";
      onLog("Gradle build passed. The project compiled successfully.");
      break;
    }

    job.buildStatus = "failed";
    onLog(build.timedOut
      ? `Gradle build attempt ${attempt} timed out; diagnostics saved.`
      : `Gradle build attempt ${attempt} failed; diagnostics saved.`);

    if (attempt === MAX_BUILD_ATTEMPTS || remainingMs() <= 90000) {
      if (remainingMs() <= 90000) onLog("Not enough time remained for another safe AI repair/build cycle.");
      break;
    }

    onLog(`Sending Gradle diagnostics to AI for repair ${attempt} of ${MAX_BUILD_ATTEMPTS - 1}.`);
    let repairRaw;
    try {
      repairRaw = await chat([
        { role: "system", content: SYSTEM },
        { role: "user", content:
          `Repair this existing Fabric project using the actual Gradle diagnostics. Return ONLY JSON with the required overview, compatibility object, and files array. Include complete corrected contents for every changed file. Preserve the target Minecraft version and architecture. Fix the reported build errors; do not make unrelated changes.\n\nTarget Minecraft version: ${job.version}\nMod requirements: ${job.prompt}\n\nBuild diagnostics:\n${diagnostics(build)}\n\nCurrent project files:\n${job.fileList.join("\n")}\n\nCurrent Gradle configuration and mod metadata (complete file contents):\n${readRepairContext(dir)}`
        }
      ], { timeoutMs: Math.min(MAX_REPAIR_MS, budget()) });
    } catch (error) {
      onLog("AI repair request failed: " + error.message);
      break;
    }

    let fixed;
    try { fixed = JSON.parse(repairRaw); }
    catch {
      onLog("AI repair response was not valid JSON; stopping repair attempts.");
      break;
    }

    if (!Array.isArray(fixed.files) || fixed.files.length === 0) {
      onLog("AI repair returned no changed files; stopping repair attempts.");
      break;
    }

    try {
      const changed = writeFiles(dir, fixed.files);
      refreshFileList(dir, job);
      onLog(`Applied ${changed} repaired file(s). The next Gradle build will verify the repair.`);
    } catch (error) {
      onLog("Could not apply AI repair: " + error.message);
      break;
    }
  }

  if (job.buildStatus !== "passed" && lastBuild) {
    onLog("Build did not pass. The ZIP includes BUILD-LOG.txt with the latest diagnostics.");
  }

  refreshFileList(dir, job);
  return dir;
}

module.exports = { createProject };
