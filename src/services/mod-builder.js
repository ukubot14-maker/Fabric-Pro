const fs = require("fs");
const path = require("path");
const { chat } = require("./openai");
const { PROJECTS_DIR } = require("../utils/config");

const SYSTEM = `You are Fabric Mod AI, an expert Minecraft Fabric mod engineer. Return ONLY valid JSON with this schema:
{"overview":"short explanation","compatibility":{"minecraft":"version","java":"version","loader":"version range","notes":"honest caveats"},"files":[{"path":"relative/path","content":"complete text file content"}],"textures":[{"filename":"example.png","path":"src/main/resources/assets/modid/textures/item/example.png","description":"What the texture should look like"}]}
Generate a COMPLETE Gradle project with settings.gradle, build.gradle, gradle.properties, src/main/resources/fabric.mod.json, Java source, README.md, and assets/config where required. When the requested mod introduces custom items or blocks that need artwork, include one texture request per custom PNG in the textures array. Each request must contain the exact filename, a safe path under src/main/resources/assets/<modid>/textures/item/ or block/, and a concise visual description. Request only original artwork the user should provide, not vanilla Minecraft textures. If no custom artwork is needed, return an empty textures array. Use official Fabric Loom, Fabric Loader, Yarn/Mojang mappings, and Fabric API conventions compatible with the EXACT requested Minecraft version. The supported modern targets include Minecraft 26.1, 26.2, and 26.3; these are distinct versions, never interpret the word latest as a version. For 26.1–26.3, use the current version-specific Fabric toolchain and APIs; do not copy old 1.21.x build scripts, Java APIs, item constructors, registry identifiers, creative tabs, or tool-material constants. Select exact compatible stable versions from official Fabric metadata/Maven releases; if a compatible stable toolchain cannot be verified, state that clearly in compatibility.notes rather than inventing versions. Use exact, released, stable dependency and plugin versions verified against the official repositories. Never guess, shorten, or invent versions: a version such as "1.6" is not a valid substitute for a published patch release, and never fabricate versions such as "1.6.283". For Minecraft 1.21.1 only, use Fabric Loom 1.7.4 with plugin id "fabric-loom" and Gradle 8.8. For Minecraft 26.1, 26.2, and 26.3, use the unobfuscated-version plugin id "net.fabricmc.fabric-loom", stable Loom 1.18.2, Gradle 9.7.1, and Java 25. Do not use the legacy "fabric-loom" plugin ID or Loom 1.6.0 for Minecraft 26.x. Keep the exact requested minecraft_version in gradle.properties. Every generated project must include gradle/wrapper/gradle-wrapper.properties with the exact pinned Gradle distribution URL; never assume the user's globally installed Gradle is compatible. Never output placeholders such as <loom-version>, TODO_VERSION, unresolved version variables, or SNAPSHOT plugin versions. Never emit accessWidenerPath/accessWidener configuration unless you also create the exact matching access widener file and declare it correctly. Do not use splitEnvironmentSourceSets unless the selected Loom version supports it. Do not create unresolved literal paths such as \${modId}.accesswidener. In Groovy build.gradle, quote interpolated dynamic names in DSL blocks (for example, "\${modId}" { ... }); never emit a bare "\${modId}" { ... } block. In settings.gradle, pluginManagement must be the first executable block and must include the Fabric Maven repository (https://maven.fabricmc.net/). Prefer stable APIs and minimal dependencies. Before returning, cross-check every Java constructor, method override, registry call, item/tool material, creative tab API, and metadata field against the selected Minecraft/Fabric API version. Ensure source code and Gradle configuration target the same exact Minecraft version. Do not use getAttackDamage() or guessed ToolMaterial constants; use the actual target-version API. Avoid generating code that is merely plausible but does not compile. Do not assume the developer's machine has Gradle installed. The backend adds BUILD.bat, build.ps1, build.sh, and a pinned gradle-wrapper.properties file; these scripts must download and use the exact pinned Gradle distribution when a complete Gradle wrapper is not included. Never include binaries, secrets, absolute paths, .. path segments, symlinks, or scripts that download/execute arbitrary code. Use package dev.fabricmodai.<modid>. Provide useful comments, error handling, and client/server separation. If a feature is not feasible or version support is uncertain, say so rather than pretending.`;


function normalizeGradleToolchain(dir, targetMinecraftVersion) {
  const target = String(targetMinecraftVersion || "").trim();
  const isModern = /^26\./.test(target);
  const isLegacy1211 = target === "1.21.1";
  if (!isModern && !isLegacy1211) return false;

  const loomVersion = isModern ? "1.18.2" : "1.7.4";
  const gradleVersion = isModern ? "9.7.1" : "8.8";
  const pluginId = isModern ? "net.fabricmc.fabric-loom" : "fabric-loom";
  let changed = false;

  for (const file of ["build.gradle", "build.gradle.kts"]) {
    const fullPath = path.join(dir, file);
    if (!fs.existsSync(fullPath)) continue;
    const original = fs.readFileSync(fullPath, "utf8");
    let updated = original;
    if (file.endsWith(".kts")) {
      updated = updated.replace(/id\s*\(\s*["'](?:fabric-loom|net\.fabricmc\.fabric-loom)["']\s*\)/g,
        'id("' + pluginId + '")');
      updated = updated.replace(/(id\s*\(\s*["']net\.fabricmc\.fabric-loom["']\s*\)\s+version\s+["'])[^"']+(["'])/g,
        (_m, before, after) => before + loomVersion + after);
    } else {
      updated = updated.replace(/id\s*\(?\s*["'](?:fabric-loom|net\.fabricmc\.fabric-loom)["']\s*\)?/g,
        "id '" + pluginId + "'");
      updated = updated.replace(/(id\s*["']net\.fabricmc\.fabric-loom["']\s+version\s+["'])[^"']+(["'])/g,
        (_m, before, after) => before + loomVersion + after);
      updated = updated.replace(/(id\s*["']fabric-loom["']\s+version\s+["'])[^"']+(["'])/g,
        (_m, before, after) => before + loomVersion + after);
    }
    updated = updated.replace(/(net\.fabricmc:fabric-loom(?:-remap)?:)[0-9][A-Za-z0-9.+-]*/g,
      (_m, before) => before + loomVersion);
    if (isModern) {
      updated = updated.replace(/JavaVersion\.VERSION_21/g, "JavaVersion.VERSION_25");
      updated = updated.replace(/options\.release\s*(?:\.set\()?\s*21\s*\)?/g, "options.release = 25");
      updated = updated.replace(/(sourceCompatibility|targetCompatibility)\s*=\s*["']?21["']?/g, "$1 = JavaVersion.VERSION_25");
      updated = updated.replace(/JavaLanguageVersion\.of\(21\)/g, "JavaLanguageVersion.of(25)");
    }
    if (updated !== original) {
      fs.writeFileSync(fullPath, updated, "utf8");
      changed = true;
    }
  }

  const propertiesPath = path.join(dir, "gradle.properties");
  let properties = fs.existsSync(propertiesPath) ? fs.readFileSync(propertiesPath, "utf8") : "";
  const setProperty = (text, key, value) => {
    const line = new RegExp("^" + key + "=.*$", "m");
    return line.test(text) ? text.replace(line, key + "=" + value) :
      (text && !text.endsWith("\n") ? text + "\n" : text) + key + "=" + value + "\n";
  };
  const originalProperties = properties;
  properties = setProperty(properties, "loom_version", loomVersion);
  properties = setProperty(properties, "minecraft_version", target);
  if (isModern) properties = setProperty(properties, "java_version", "25");
  if (properties !== originalProperties) {
    fs.writeFileSync(propertiesPath, properties, "utf8");
    changed = true;
  }

  const wrapperDir = path.join(dir, "gradle", "wrapper");
  fs.mkdirSync(wrapperDir, { recursive: true });
  const wrapperPath = path.join(wrapperDir, "gradle-wrapper.properties");
  const wrapperText = [
    "distributionBase=GRADLE_USER_HOME",
    "distributionPath=wrapper/dists",
    "distributionUrl=https\\://services.gradle.org/distributions/gradle-" + gradleVersion + "-bin.zip",
    "networkTimeout=10000",
    "validateDistributionUrl=true",
    "zipStoreBase=GRADLE_USER_HOME",
    "zipStorePath=wrapper/dists",
    ""
  ].join("\n");
  if (!fs.existsSync(wrapperPath) || fs.readFileSync(wrapperPath, "utf8") !== wrapperText) {
    fs.writeFileSync(wrapperPath, wrapperText, "utf8");
    changed = true;
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

function addBuildInstructions(dir, targetMinecraftVersion) {
  const targetMatch = String(targetMinecraftVersion || "").match(/^(\\d+)\\.(\\d+)(?:\\.(\\d+))?/);
  const major = targetMatch ? Number(targetMatch[1]) : 1;
  const minor = targetMatch ? Number(targetMatch[2]) : 21;
  const patch = targetMatch && targetMatch[3] ? Number(targetMatch[3]) : 0;
  const requiredJava = major >= 26 ? 25 :
    (major === 1 && (minor > 20 || (minor === 20 && patch >= 5))) ? 21 :
    (major === 1 && minor >= 18) ? 17 :
    (major === 1 && minor >= 17) ? 16 : 8;
  const bat = [
    "@echo off",
    "setlocal",
    "cd /d \"%~dp0\"",
    "where java >nul 2>nul",
    "if errorlevel 1 (echo Install the Java JDK required by this Minecraft version first.& pause & exit /b 1)",
    "powershell -NoProfile -ExecutionPolicy Bypass -File \"%~dp0build.ps1\"",
    "if errorlevel 1 (echo BUILD FAILED.& pause & exit /b 1)",
    "echo BUILD SUCCESSFUL. Your JAR is in build\\libs",
    "pause",
    ""
  ].join("\r\n");
  fs.writeFileSync(path.join(dir, "BUILD.bat"), bat, "utf8");

  const ps1 = [
    "$ErrorActionPreference = 'Stop'",
    "Set-Location $PSScriptRoot",
    "$javaText = (& java -version 2>&1 | Out-String)",
    "if ($javaText -notmatch 'version \"(\\d+)') { throw 'Could not detect Java. Install the required JDK.' }",
    "$javaMajor = [int]$Matches[1]",
    "if ($javaMajor -lt " + requiredJava + ") { throw 'This project requires JDK " + requiredJava + " or newer. Install it, then reopen this window.' }",
    "if (Test-Path (Join-Path $PSScriptRoot 'gradlew.bat')) { & (Join-Path $PSScriptRoot 'gradlew.bat') build; exit $LASTEXITCODE }",
    "$props = Join-Path $PSScriptRoot 'gradle/wrapper/gradle-wrapper.properties'",
    "if (-not (Test-Path $props)) { throw 'Missing gradle/wrapper/gradle-wrapper.properties. The project has no pinned Gradle version.' }",
    "$line = Get-Content $props | Where-Object { $_ -match '^distributionUrl=' } | Select-Object -First 1",
    "if (-not $line) { throw 'The Gradle distributionUrl is missing.' }",
    "$url = ($line -replace '^distributionUrl=', '') -replace '\\\\:', ':'",
    "if ($url -notmatch 'gradle-([0-9][0-9A-Za-z.\\-]*)-bin\\.zip') { throw ('Cannot read Gradle version from: ' + $url) }",
    "$version = $Matches[1]",
    "$cache = Join-Path $env:USERPROFILE '.gradle/fabric-mod-ai'",
    "$gradle = Join-Path $cache ('gradle-' + $version + '/bin/gradle.bat')",
    "New-Item -ItemType Directory -Force -Path $cache | Out-Null",
    "if (-not (Test-Path $gradle)) {",
    "  $zip = Join-Path $cache ('gradle-' + $version + '-bin.zip')",
    "  Write-Host ('Downloading the project-required Gradle ' + $version + '...')",
    "  Invoke-WebRequest -Uri $url -OutFile $zip",
    "  Expand-Archive -Path $zip -DestinationPath $cache -Force",
    "  Remove-Item $zip -Force",
    "}",
    "if (-not (Test-Path $gradle)) { throw ('Gradle ' + $version + ' did not install correctly.') }",
    "Write-Host ('Building with the project-required Gradle ' + $version + '...')",
    "& $gradle build",
    "if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }",
    "Write-Host 'BUILD SUCCESSFUL. Your JAR is in build/libs.'",
    ""
  ].join("\r\n");
  fs.writeFileSync(path.join(dir, "build.ps1"), ps1, "utf8");

  const sh = [
    "#!/usr/bin/env sh",
    "set -eu",
    "cd \"$(dirname \"$0\")\"",
    "JAVA_TEXT=$(java -version 2>&1 | head -n 1)",
    "JAVA_MAJOR=$(printf '%s' \"$JAVA_TEXT\" | sed -n 's/.*version \"\\([0-9][0-9]*\\).*/\\1/p')",
    "[ -n \"$JAVA_MAJOR\" ] || { echo 'Could not detect Java. Install the required JDK.' >&2; exit 1; }",
    "[ \"$JAVA_MAJOR\" -ge " + requiredJava + " ] || { echo 'This project requires JDK " + requiredJava + " or newer.' >&2; exit 1; }",
    "if [ -x ./gradlew ]; then exec ./gradlew build; fi",
    "PROPS=gradle/wrapper/gradle-wrapper.properties",
    "[ -f \"$PROPS\" ] || { echo 'Missing pinned Gradle wrapper properties.' >&2; exit 1; }",
    "URL=$(sed -n 's/^distributionUrl=//p' \"$PROPS\" | sed 's/\\\\:/:/g')",
    "VERSION=$(printf '%s' \"$URL\" | sed -n 's/.*gradle-\\([0-9][0-9A-Za-z.-]*\\)-bin\\.zip.*/\\1/p')",
    "[ -n \"$VERSION\" ] || { echo 'Could not read pinned Gradle version.' >&2; exit 1; }",
    "CACHE=\"\${HOME}/.gradle/fabric-mod-ai\"",
    "GRADLE=\"\${CACHE}/gradle-\${VERSION}/bin/gradle\"",
    "mkdir -p \"$CACHE\"",
    "if [ ! -x \"$GRADLE\" ]; then",
    "  ZIP=\"\${CACHE}/gradle-\${VERSION}-bin.zip\"",
    "  echo \"Downloading project-required Gradle \${VERSION}...\"",
    "  if command -v curl >/dev/null 2>&1; then curl -fL \"$URL\" -o \"$ZIP\"; else wget -O \"$ZIP\" \"$URL\"; fi",
    "  unzip -oq \"$ZIP\" -d \"$CACHE\"",
    "  rm -f \"$ZIP\"",
    "fi",
    "exec \"$GRADLE\" build",
    ""
  ].join("\n");
  fs.writeFileSync(path.join(dir, "build.sh"), sh, "utf8");

  fs.writeFileSync(path.join(dir, "BUILD-INSTRUCTIONS.md"), [
    "# Build the Fabric mod JAR",
    "",
    "This project pins its own Gradle version in gradle/wrapper/gradle-wrapper.properties.",
    "",
    "**Java:** This project requires JDK " + requiredJava + " or newer. Download a JDK from https://adoptium.net/temurin/releases/?version=" + requiredJava + " and install it before building.",
    "",
    "**Windows:** Extract the ZIP and double-click BUILD.bat. The script checks Java and downloads/uses this project's exact Gradle version automatically; it does not use a mismatched system Gradle installation.",
    "",
    "**macOS/Linux:** Install the required JDK and run ./build.sh. The script checks Java and downloads/uses the pinned Gradle version automatically.",
    "",
    "After a successful build, find the mod JAR in build/libs and copy it into your Minecraft mods folder.",
    "",
    "Fabric Mod AI performs lightweight source and metadata checks before creating this ZIP. Those checks do not compile Java or prove in-game functionality. The local Gradle build is the compilation test.",
    ""
  ].join("\n"), "utf8");
}

async function createProject(job, onLog, waitForTexture) {
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
  if (normalizeGradleToolchain(dir, job.version)) onLog("Pinned the matching Fabric Loom and Gradle toolchain for Minecraft " + job.version + ". BUILD.bat will install and use that exact Gradle version.");
  addBuildInstructions(dir, job.version);
  onLog("Added BUILD.bat and build.sh so users can compile the JAR on their own computers.");

  const textures = Array.isArray(result.textures) ? result.textures.slice(0, 12) : [];
  for (const texture of textures) {
    const texturePath = String(texture.path || "").replace(/\\/g, "/");
    const allowed = /^src\/main\/resources\/assets\/[a-z0-9_.-]{1,64}\/textures\/(item|block)\/[a-zA-Z0-9_-]{1,64}\.png$/;
    if (!allowed.test(texturePath) || !safePath(texturePath)) {
      onLog("Skipped an invalid texture request from the AI: " + String(texture.filename || "unnamed"));
      continue;
    }
    const filename = path.posix.basename(texturePath);
    onLog("Texture needed: " + filename + ". Waiting for your upload.");
    const imageBuffer = await waitForTexture({
      filename,
      path: texturePath,
      description: String(texture.description || "Upload the PNG texture requested for this mod.")
    });
    if (!Buffer.isBuffer(imageBuffer) || imageBuffer.length < 8 ||
        !imageBuffer.subarray(0, 8).equals(Buffer.from([137,80,78,71,13,10,26,10]))) {
      throw new Error("The uploaded texture was not a valid PNG: " + filename);
    }
    const destination = path.join(dir, texturePath);
    fs.mkdirSync(path.dirname(destination), { recursive: true });
    fs.writeFileSync(destination, imageBuffer);
    onLog("Added " + filename + ". Continuing mod generation.");
  }

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

async function reviseProject(project, instruction) {
  if (!project || !Array.isArray(project.files) || !project.files.length) throw new Error("Saved project files are missing.");
  const total = project.files.reduce((n, file) => n + Buffer.byteLength(String(file.content || "")), 0);
  if (total > 3000000) throw new Error("This project is too large for an AI revision request (3 MB limit).");
  const raw = await chat([
    { role: "system", content: SYSTEM + "\n\nREVISION MODE: You are editing an existing project. Return the COMPLETE updated project file list in the same JSON schema. Preserve existing working features and files unless the requested change requires editing them. Do not omit source files. Never return only a patch or snippets. Keep paths safe and relative." },
    { role: "user", content:
      "Project name: " + project.name + "\nMinecraft version: " + project.minecraft_version +
      "\nOriginal project brief: " + project.prompt +
      "\nUser requested change: " + instruction +
      "\nCurrent project files as JSON: " + JSON.stringify(project.files)
    }
  ], { timeoutMs: 180000 });
  let result;
  try { result = JSON.parse(raw); } catch { throw new Error("AI revision response was not valid project JSON."); }
  if (!Array.isArray(result.files) || !result.files.length) throw new Error("AI revision did not return a complete files array.");
  const seen = new Set();
  for (const file of result.files) {
    if (!file || !safePath(file.path) || typeof file.content !== "string") throw new Error("AI revision returned an unsafe or invalid file.");
    if (seen.has(file.path)) throw new Error("AI revision returned a duplicate file path: " + file.path);
    seen.add(file.path);
  }
  const totalBytes = result.files.reduce((n, file) => n + Buffer.byteLength(file.content), 0);
  if (totalBytes > 4000000) throw new Error("Revised project exceeded the 4 MB safety limit.");

  const byPath = new Map(result.files.map(file => [file.path, file.content]));
  for (const supportFile of ["BUILD.bat", "build.ps1", "build.sh", "BUILD-INSTRUCTIONS.md"]) {
    const existing = project.files.find(file => file.path === supportFile);
    if (existing && !byPath.has(supportFile)) {
      result.files.push(existing);
      byPath.set(supportFile, existing.content);
    }
  }
  const hasGradle = byPath.has("build.gradle") || byPath.has("build.gradle.kts");
  const hasSettings = byPath.has("settings.gradle") || byPath.has("settings.gradle.kts");
  const javaFiles = result.files.filter(file => file.path.startsWith("src/main/java/") && file.path.endsWith(".java"));
  const errors = [];
  if (!hasGradle) errors.push("Missing build.gradle or build.gradle.kts.");
  if (!hasSettings) errors.push("Missing settings.gradle or settings.gradle.kts.");
  if (!byPath.has("src/main/resources/fabric.mod.json")) errors.push("Missing fabric.mod.json.");
  if (!javaFiles.length) errors.push("No Java source files were returned.");
  const metadataText = byPath.get("src/main/resources/fabric.mod.json");
  if (metadataText) {
    try {
      const metadata = JSON.parse(metadataText);
      if (!metadata.id || !/^[a-z][a-z0-9_]{1,63}$/.test(metadata.id)) errors.push("fabric.mod.json has an invalid mod id.");
      const entrypoints = Object.values(metadata.entrypoints || {}).flat();
      for (const entry of entrypoints) {
        const className = typeof entry === "string" ? entry : entry && entry.value;
        if (typeof className === "string" && className.includes(".") && !javaFiles.some(file => file.path.endsWith(className.replace(/\\./g, "/") + ".java"))) {
          errors.push("Entrypoint class not found in returned Java sources: " + className);
        }
      }
    } catch (error) {
      errors.push("fabric.mod.json is invalid JSON: " + error.message);
    }
  }
  for (const file of ["build.gradle", "build.gradle.kts", "settings.gradle", "settings.gradle.kts"]) {
    const content = byPath.get(file) || "";
    if (/TODO_VERSION|REPLACE_ME|<loom-version>|SNAPSHOT/i.test(content)) errors.push(file + " contains an unresolved or SNAPSHOT version.");
  }
  if (errors.length) throw new Error("AI revision failed source checks: " + errors.join(" "));
  const report = [
    "# " + project.name, "",
    result.overview || project.overview || "Updated Fabric mod project", "",
    "## Automated source checks", "",
    "Status: PASSED",
    "- Java source files found: " + javaFiles.length,
    "- fabric.mod.json: valid JSON",
    "- Gradle project files: present", "",
    "The AI revision passed lightweight structural checks. Java compilation and in-game testing have not been performed.", "",
    "## Build the JAR", "",
    "Run BUILD.bat on Windows or ./build.sh on macOS/Linux. The compiled JAR should appear in build/libs.", ""
  ].join("\n");
  const reportIndex = result.files.findIndex(file => file.path === "FABRIC-MOD-AI-REPORT.md");
  if (reportIndex >= 0) result.files[reportIndex].content = report;
  else result.files.push({ path: "FABRIC-MOD-AI-REPORT.md", content: report });
  return { overview: result.overview || project.overview || "", files: result.files };
}

module.exports = { createProject, reviseProject, safePath };
