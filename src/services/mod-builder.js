const fs = require("fs");
const path = require("path");
const { chat } = require("./openai");
const { PROJECTS_DIR } = require("../utils/config");

const SYSTEM = `You are Fabric Mod AI, an expert Minecraft Fabric mod engineer. Return ONLY valid JSON with this schema:
{"overview":"short explanation","compatibility":{"minecraft":"version","java":"version","loader":"version range","notes":"honest caveats"},"files":[{"path":"relative/path","content":"complete text file content"}]}
Generate a COMPLETE Gradle project with settings.gradle, build.gradle, gradle.properties, src/main/resources/fabric.mod.json, Java source, README.md, and assets/config where required. Use official Fabric Loom and Fabric API conventions compatible with the requested Minecraft version. Use exact, released, stable dependency and plugin versions verified against the official repositories. Never guess, shorten, or invent versions: a version such as "1.6" is not a valid substitute for a published patch release, and never fabricate versions such as "1.6.283". For Minecraft 1.21.1, use Fabric Loom 1.7.4 with plugin id "fabric-loom". Never output placeholders such as <loom-version>, TODO_VERSION, unresolved version variables, or SNAPSHOT plugin versions. In Groovy build.gradle, quote interpolated dynamic names in DSL blocks (for example, "\${modId}" { ... }); never emit a bare "\${modId}" { ... } block. In settings.gradle, pluginManagement must be the first executable block and must include the Fabric Maven repository (https://maven.fabricmc.net/). Prefer stable APIs and minimal dependencies. Include a gradlew wrapper only if you can provide correct wrapper files; otherwise use installed Gradle. Never include binaries, secrets, absolute paths, .. path segments, symlinks, or scripts that download/execute arbitrary code. Use package dev.fabricmodai.<modid>. Provide useful comments, error handling, and client/server separation. If a feature is not feasible or version support is uncertain, say so rather than pretending.`;


function normalizeKnownGradleConfig(dir, targetMinecraftVersion) {
  // Only apply this known compatibility pin to Minecraft 1.21.1.
  if (String(targetMinecraftVersion) !== "1.21.1") return false;

  let changed = false;
  for (const file of ["settings.gradle", "settings.gradle.kts", "build.gradle", "build.gradle.kts"]) {
    const fullPath = path.join(dir, file);
    if (!fs.existsSync(fullPath)) continue;

    const original = fs.readFileSync(fullPath, "utf8");
    let updated = original.replace(
      /(id\s*\(?\s*["']fabric-loom["']\s*\)?\s+version\s+["'])[^"']+(["'])/g,
      (_match, before, after) => before + "1.7.4" + after
    );
    updated = updated.replace(
      /(net\.fabricmc:fabric-loom:)\d+\.\d+(?:\.\d+)?(?:[-+][A-Za-z0-9.-]+)?/g,
      (_match, before) => before + "1.7.4"
    );

    if (updated !== original) {
      fs.writeFileSync(fullPath, updated, "utf8");
      changed = true;
    }
  }
  return changed;
}

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

function validateSourceProject(dir) {
  const errors = [], warnings = [];
  const required = ["settings.gradle", "build.gradle", "src/main/resources/fabric.mod.json"];
  for (const file of required) if (!fs.existsSync(path.join(dir, file)) &&
    !(file.endsWith(".gradle") && fs.existsSync(path.join(dir, file + ".kts")))) errors.push("Missing " + file);
  const javaRoot = path.join(dir, "src/main/java");
  let javaCount = 0;
  if (fs.existsSync(javaRoot)) {
    const walk = d => fs.readdirSync(d, {withFileTypes:true}).forEach(e => {
      const p = path.join(d,e.name);
      if (e.isDirectory()) walk(p); else if (e.isFile() && e.name.endsWith(".java")) javaCount++;
    });
    walk(javaRoot);
  }
  if (!javaCount) errors.push("No Java source files found.");
  const metadataPath = path.join(dir, "src/main/resources/fabric.mod.json");
  let metadata = null;
  if (fs.existsSync(metadataPath)) {
    try {
      metadata = JSON.parse(fs.readFileSync(metadataPath,"utf8"));
      if (!metadata.id || !/^[a-z][a-z0-9_]{1,63}$/.test(metadata.id)) errors.push("fabric.mod.json has an invalid mod id.");
    } catch (e) { errors.push("fabric.mod.json is invalid JSON: " + e.message); }
  }
  for (const file of ["settings.gradle","settings.gradle.kts","build.gradle","build.gradle.kts"]) {
    const p=path.join(dir,file); if (!fs.existsSync(p)) continue;
    const s=fs.readFileSync(p,"utf8");
    if (/TODO_VERSION|REPLACE_ME|<loom-version>|SNAPSHOT/i.test(s)) errors.push(file + " contains an unresolved or SNAPSHOT version.");
  }
  const buildPath=["build.gradle","build.gradle.kts"].map(x=>path.join(dir,x)).find(fs.existsSync);
  if (buildPath && !/fabric-loom/i.test(fs.readFileSync(buildPath,"utf8"))) warnings.push("Fabric Loom declaration not detected.");
  return {errors,warnings,javaCount,metadata};
}

function addBuildInstructions(dir) {
  fs.writeFileSync(path.join(dir,"BUILD.bat"), `@echo off
setlocal
cd /d "%~dp0"
where java >nul 2>nul
if errorlevel 1 (echo Install a compatible JDK first.& pause & exit /b 1)
if exist gradlew.bat (call gradlew.bat build) else (
  where gradle >nul 2>nul
  if errorlevel 1 (echo Gradle is missing and no wrapper is included.& pause & exit /b 1)
  call gradle build
)
if errorlevel 1 (echo BUILD FAILED.& pause & exit /b 1)
echo BUILD SUCCESSFUL. Your JAR is in build\libs
pause
`, "utf8");
  fs.writeFileSync(path.join(dir,"build.sh"), `#!/usr/bin/env sh
set -eu
cd "$(dirname "$0")"
if [ -x ./gradlew ]; then exec ./gradlew build; fi
if command -v gradle >/dev/null 2>&1; then exec gradle build; fi
echo "Install Gradle or include a Gradle wrapper." >&2
exit 1
`, "utf8");
  fs.writeFileSync(path.join(dir,"BUILD-INSTRUCTIONS.md"), `# Build the Fabric mod JAR

This ZIP contains a Gradle source project, not a compiled JAR.

**Windows:** Install a JDK compatible with the target Minecraft version. Extract the ZIP and double-click BUILD.bat. If no Gradle wrapper is included, install Gradle first.

**macOS/Linux:** Install a compatible JDK and Gradle (unless a wrapper is included), then run ./build.sh.

After a successful build, find the mod JAR in build/libs and copy it into your Minecraft mods folder.

Fabric Mod AI runs lightweight source and metadata checks before creating this ZIP. Those checks do not compile Java or prove in-game functionality. The actual Gradle build is the compilation test.

A general file converter cannot compile Java source code into a working Fabric mod JAR. Gradle must compile and package the project.
`, "utf8");
}

async function createProject(job, onLog) {
  const dir = path.join(PROJECTS_DIR, job.id);
  fs.mkdirSync(dir, { recursive: true });
  const remainingMs = () => job.deadline - Date.now();
  const budget = () => Math.max(1000, remainingMs() - 15000);

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
  addBuildInstructions(dir);
  onLog("Added BUILD.bat and build.sh so users can compile the JAR on their own computers.");

  const checks = validateSourceProject(dir);
  const report = [
    "# " + job.name, "",
    result.overview || "Generated Fabric mod project", "",
    "## Compatibility", "",
    "- Minecraft: " + (result.compatibility?.minecraft || job.version),
    "- Java: " + (result.compatibility?.java || "See project configuration"),
    "- Fabric Loader: " + (result.compatibility?.loader || "See project configuration"),
    "- Notes: " + (result.compatibility?.notes || "Build and test before use."), "",
    "## Automated source checks", "",
    checks.errors.length ? "Status: FAILED" : "Status: PASSED",
    "- Java source files found: " + checks.javaCount,
    "- fabric.mod.json: " + (checks.metadata ? "valid JSON" : "not validated"),
    ...checks.errors.map(x => "- ERROR: " + x),
    ...checks.warnings.map(x => "- WARNING: " + x), "",
    "These are structural checks only. The server did not compile the Java code or test the mod in Minecraft.", "",
    "## Create the JAR", "",
    "Extract the ZIP and run BUILD.bat on Windows or ./build.sh on macOS/Linux. The compiled JAR will be in build/libs.", "",
    "A general-purpose file converter cannot compile Java source into a Fabric mod JAR. Use the included Gradle build scripts.", ""
  ].join("\n");
  fs.writeFileSync(path.join(dir, "FABRIC-MOD-AI-REPORT.md"), report, "utf8");

  job.buildStatus = checks.errors.length ? "checks-failed" : "checks-passed";
  job.checkErrors = checks.errors;
  job.checkWarnings = checks.warnings;
  if (checks.errors.length) onLog("Source checks found " + checks.errors.length + " issue(s). See FABRIC-MOD-AI-REPORT.md.");
  else onLog("Lightweight source checks passed. Java compilation and in-game testing have not been performed.");
  if (checks.warnings.length) onLog("Source checks produced " + checks.warnings.length + " warning(s).");

  refreshFileList(dir, job);
  onLog("Wrote " + count + " source files and packaged the project for local JAR building.");
  return dir;
}
module.exports = { createProject };
