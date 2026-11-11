const fs = require("fs");
const path = require("path");
const { chat } = require("./openai");
const { PROJECTS_DIR } = require("../utils/config");

const SYSTEM = `You are Fabric Mod AI, an expert Minecraft Fabric mod engineer. Return ONLY valid JSON with this schema:
{"overview":"short explanation","compatibility":{"minecraft":"version","java":"version","loader":"version range","notes":"honest caveats"},"files":[{"path":"relative/path","content":"complete text file content"}],"textures":[{"filename":"example.png","path":"src/main/resources/assets/modid/textures/item/example.png","description":"What the texture should look like"}]}
Generate a COMPLETE Gradle project with settings.gradle, build.gradle, gradle.properties, src/main/resources/fabric.mod.json, Java source, README.md, and assets/config where required. When the requested mod introduces custom items or blocks that need artwork, include one texture request per custom PNG in the textures array. Each request must contain the exact filename, a safe path under src/main/resources/assets/<modid>/textures/item/ or block/, and a concise visual description. Request only original artwork the user should provide, not vanilla Minecraft textures. If no custom artwork is needed, return an empty textures array. Use official Fabric Loom, Fabric Loader, Yarn/Mojang mappings, and Fabric API conventions compatible with the EXACT requested Minecraft version. The supported modern targets include Minecraft 26.1, 26.2, and 26.3; these are distinct versions, never interpret the word latest as a version. For 26.1–26.3, use the current version-specific Fabric toolchain and APIs; do not copy old 1.21.x build scripts, Java APIs, item constructors, registry identifiers, creative tabs, or tool-material constants. Select exact compatible stable versions from official Fabric metadata/Maven releases; if a compatible stable toolchain cannot be verified, state that clearly in compatibility.notes rather than inventing versions. Use exact, released, stable dependency and plugin versions verified against the official repositories. Never guess, shorten, or invent versions: a version such as "1.6" is not a valid substitute for a published patch release, and never fabricate versions such as "1.6.283". For Minecraft 1.21.1 only, use Fabric Loom 1.7.4 with plugin id "fabric-loom" and a Gradle 8.8-compatible build. For 26.1–26.3, do not use Loom 1.7.4; use the compatible current Loom and Gradle versions for that exact game release. Never output placeholders such as <loom-version>, TODO_VERSION, unresolved version variables, or SNAPSHOT plugin versions. Never emit accessWidenerPath/accessWidener configuration unless you also create the exact matching access widener file and declare it correctly. Do not use splitEnvironmentSourceSets unless the selected Loom version supports it. Do not create unresolved literal paths such as ${modId}.accesswidener. In Groovy build.gradle, quote interpolated dynamic names in DSL blocks (for example, "\${modId}" { ... }); never emit a bare "\${modId}" { ... } block. In settings.gradle, pluginManagement must be the first executable block and must include the Fabric Maven repository (https://maven.fabricmc.net/). Prefer stable APIs and minimal dependencies. Before returning, cross-check every Java constructor, method override, registry call, item/tool material, creative tab API, and metadata field against the selected Minecraft/Fabric API version. Ensure source code and Gradle configuration target the same exact Minecraft version. Do not use getAttackDamage() or guessed ToolMaterial constants; use the actual target-version API. Avoid generating code that is merely plausible but does not compile. Include a gradlew wrapper only if you can provide correct wrapper files; otherwise use installed Gradle. Never include binaries, secrets, absolute paths, .. path segments, symlinks, or scripts that download/execute arbitrary code. Use package dev.fabricmodai.<modid>. Provide useful comments, error handling, and client/server separation. If a feature is not feasible or version support is uncertain, say so rather than pretending.`;


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

    updated = updated.replace(/^\s*splitEnvironmentSourceSets\(\)\s*;?\s*$/gm, "");
    updated = updated.replace(/^\s*accessWidenerPath\s*=.*(?:\r?\n|$)/gm, "");
