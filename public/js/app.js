const API_BASE = window.FABRIC_MOD_AI_API || "https://fabric-pro-ai.onrender.com";
const $ = id => document.getElementById(id);
let jobId = null, pollTimer = null, deadline = 0;
let currentUser = null, authMode = "login", currentProject = null;
let sessionToken = localStorage.getItem("fmai_token") || "";

async function api(path, options = {}) {
  const response = await fetch(API_BASE + "/api" + path, {
    ...options,
    credentials: "omit",
    headers: { "Content-Type": "application/json", ...(sessionToken ? { Authorization: "Bearer " + sessionToken } : {}), ...(options.headers || {}) }
  });
  const data = await response.json().catch(() => ({ error: "The server returned an unreadable response." }));
  if (!response.ok) throw new Error(data.error || `Request failed (${response.status})`);
  return data;
}
function stop() { clearInterval(pollTimer); pollTimer = null; }
function setNotice(message, error = false) {
  $("notice").textContent = message;
  $("notice").classList.toggle("error", error);
}
function openAuth(mode = "login") {
  setAuthMode(mode);
  $("auth-modal").classList.remove("hidden");
}
function closeAuth() { $("auth-modal").classList.add("hidden"); }
function setAuthMode(mode) {
  authMode = mode;
  const register = mode === "register";
  $("auth-title").textContent = register ? "Create your account." : "Welcome back.";
  $("auth-subtitle").textContent = register ? "Save your mods and continue improving them." : "Log in to access your saved mods.";
  $("auth-submit").textContent = register ? "CREATE ACCOUNT →" : "LOG IN →";
  $("login-tab").classList.toggle("active", !register);
  $("register-tab").classList.toggle("active", register);
  $("auth-password").autocomplete = register ? "new-password" : "current-password";
  $("auth-status").textContent = register ? "Use at least 10 characters for your password." : "";
}
function updateAccountUI() {
  $("account-button").classList.toggle("hidden", !!currentUser);
  $("logout-button").classList.toggle("hidden", !currentUser);
  $("account-email").classList.toggle("hidden", !currentUser);
  $("account-email").textContent = currentUser ? currentUser.email : "";
  $("nav-library").disabled = !currentUser;
  if (!currentUser && $("library").classList.contains("hidden") === false) showWorkspace("new");
}
function showWorkspace(which) {
  const library = which === "library";
  $("library").classList.toggle("hidden", !library);
  $("builder").classList.toggle("hidden", library);
  if (library) $("progress").classList.add("hidden");
  else if ($("progress").dataset.started === "true") $("progress").classList.remove("hidden");
  document.querySelector(".welcome").classList.toggle("hidden", library);
  $("nav-new").classList.toggle("active", !library);
  $("nav-library").classList.toggle("active", library);
  if (library) loadProjects();
}
async function loadProjects() {
  if (!currentUser) return;
  const list = $("project-list");
  list.replaceChildren();
  const loading = document.createElement("p");
  loading.className = "empty-state";
  loading.textContent = "Loading your saved mods…";
  list.append(loading);
  try {
    const data = await api("/projects");
    list.replaceChildren();
    if (!data.projects.length) {
      const empty = document.createElement("p");
      empty.className = "empty-state";
      empty.textContent = "No saved mods yet. Generate your first mod and it will appear here.";
      list.append(empty);
      $("project-detail").classList.add("hidden");
      return;
    }
    data.projects.forEach(project => {
      const card = document.createElement("button");
      card.type = "button";
      card.className = "project-card";
      const name = document.createElement("b");
      name.textContent = project.name;
      const meta = document.createElement("small");
      meta.textContent = `Minecraft ${project.minecraft_version} · ${project.file_count} files · Updated ${new Date(project.updated_at).toLocaleDateString()}`;
      card.append(name, meta);
      card.addEventListener("click", () => openProject(project.id));
      list.append(card);
    });
  } catch (error) {
    list.replaceChildren();
    const message = document.createElement("p");
    message.className = "empty-state error";
    message.textContent = error.message;
    list.append(message);
  }
}
async function openProject(id) {
  try {
    const data = await api("/projects/" + encodeURIComponent(id));
    currentProject = data.project;
    const project = currentProject;
    $("project-detail").classList.remove("hidden");
    $("detail-name").textContent = project.name;
    $("detail-meta").textContent = `Minecraft ${project.minecraft_version} · ${project.files.length} source files · Updated ${new Date(project.updated_at).toLocaleString()}`;
    $("project-download").href = "#";
    $("project-download").dataset.projectId = project.id;
    const files = $("project-files");
    files.replaceChildren();
    project.files.forEach((file, index) => {
      const button = document.createElement("button");
      button.type = "button";
      button.className = "file-button" + (index === 0 ? " active" : "");
      button.textContent = file.path;
      button.addEventListener("click", () => {
        files.querySelectorAll(".file-button").forEach(item => item.classList.remove("active"));
        button.classList.add("active");
        $("project-preview").textContent = file.content;
      });
      files.append(button);
    });
    $("project-preview").textContent = project.files[0]?.content || "No source files found.";
    $("revision-input").value = "";
    $("revision-status").textContent = "";
    $("project-detail").scrollIntoView({ behavior: "smooth", block: "start" });
  } catch (error) {
    $("revision-status").textContent = error.message;
  }
}

async function downloadProjectFile(event, projectId) {
  event.preventDefault();
  if (!sessionToken) {
    openAuth("login");
    $("auth-status").textContent = "Please log in again to download your mod.";
    return;
  }
  const link = event.currentTarget;
  const originalText = link.textContent;
  link.setAttribute("aria-busy", "true");
  link.style.pointerEvents = "none";
  try {
    const response = await fetch(API_BASE + "/api/projects/" + encodeURIComponent(projectId) + "/download", {
      method: "GET",
      credentials: "omit",
      headers: { Authorization: "Bearer " + sessionToken }
    });
    if (!response.ok) {
      const data = await response.json().catch(() => ({}));
      if (response.status === 401) {
        throw new Error("Your login session expired. Please log out and log back in.");
      }
      throw new Error(data.error || `Download failed (${response.status}).`);
    }
    const blob = await response.blob();
    if (!blob.size || (blob.type && !blob.type.includes("zip"))) {
      throw new Error("The server did not return a ZIP file. Please try again.");
    }
    const disposition = response.headers.get("Content-Disposition") || "";
    const match = disposition.match(/filename="?([^";]+)"?/i);
    const filename = match ? match[1] : "fabric-mod-project.zip";
    const objectUrl = URL.createObjectURL(blob);
    const downloadLink = document.createElement("a");
    downloadLink.href = objectUrl;
    downloadLink.download = filename;
    document.body.append(downloadLink);
    downloadLink.click();
    downloadLink.remove();
    URL.revokeObjectURL(objectUrl);
  } catch (error) {
    setNotice(error.message, true);
  } finally {
    link.removeAttribute("aria-busy");
    link.style.pointerEvents = "";
    if (originalText) link.textContent = originalText;
  }
}

async function reviseCurrentProject() {
  if (!currentProject) return;
  const instruction = $("revision-input").value.trim();
  if (instruction.length < 8) {
    $("revision-status").textContent = "Describe the change in at least 8 characters.";
    return;
  }
  const button = $("revise-button");
  button.disabled = true;
  button.textContent = "✦ WORKING ON YOUR MOD…";
  $("revision-status").textContent = "The AI is reviewing your saved files and preparing a complete updated project. This may take a few minutes.";
  try {
    await api("/projects/" + encodeURIComponent(currentProject.id) + "/revise", {
      method: "POST", body: JSON.stringify({ instruction })
    });
    $("revision-status").textContent = "Updated source files saved. Download the ZIP and build/test it on your computer.";
    await openProject(currentProject.id);
    await loadProjects();
  } catch (error) {
    $("revision-status").textContent = error.message;
  } finally {
    button.disabled = false;
    button.textContent = "✦ UPDATE THIS MOD";
  }
}
async function restoreSession() {
  if (!sessionToken) {
    currentUser = null;
    updateAccountUI();
    return;
  }
  try {
    const data = await api("/auth/me");
    currentUser = data.user;
    updateAccountUI();
  } catch {
    currentUser = null;
    sessionToken = "";
    localStorage.removeItem("fmai_token");
    updateAccountUI();
  }
}
function render(job) {
  $("phase").textContent = job.phase || "Working";
  $("status").textContent = `${job.status.toUpperCase()} · ${job.version}`;
  $("filecount").textContent = `${job.fileCount || job.files?.length || 0} files`;
  $("logs").textContent = (job.log || []).map(item =>
    `${item.at ? new Date(item.at).toLocaleTimeString() + "  " : ""}${item.message || item}`
  ).join("\n");
  $("logs").scrollTop = $("logs").scrollHeight;
  const seconds = Math.max(0, job.remainingSeconds ?? Math.ceil((deadline - Date.now()) / 1000));
  $("timer").textContent = `${String(Math.floor(seconds / 60)).padStart(2, "0")}:${String(seconds % 60).padStart(2, "0")}`;
  $("fill").style.width = `${Math.min(100, 100 * (1 - seconds / 3600))}%`;
  if (job.status === "completed") {
    $("done").classList.remove("hidden");
    $("build-status").textContent = `Source checks: ${job.buildStatus || "not reported"}. This is a source ZIP, not a compiled JAR. Extract it and run BUILD.bat (Windows) or ./build.sh (Mac/Linux).`;
    $("download").href = "#";
    $("download").dataset.projectId = job.projectId || job.id;
    stop();
    $("create").disabled = false;
    loadProjects();
  }
  if (["failed", "expired"].includes(job.status)) {
    setNotice(job.error || "The project stopped. Review the activity log for details.", true);
    stop();
    $("create").disabled = false;
  }
}
async function poll() {
  if (!jobId) return;
  try { render(await api("/jobs/" + encodeURIComponent(jobId))); }
  catch (error) { setNotice(error.message, true); stop(); $("create").disabled = false; }
}

$("prompt").addEventListener("input", () => $("char-count").textContent = `${$("prompt").value.length.toLocaleString()} / 12,000`);
document.querySelectorAll("[data-prompt]").forEach(button => button.addEventListener("click", () => {
  $("prompt").value = button.dataset.prompt;
  $("prompt").dispatchEvent(new Event("input"));
  $("prompt").focus();
}));
$("create").addEventListener("click", async () => {
  if (!currentUser) { openAuth("login"); $("auth-status").textContent = "Log in or create an account before generating a mod."; return; }
  const prompt = $("prompt").value.trim();
  if (prompt.length < 8) { setNotice("Add a little more detail before starting (at least 8 characters).", true); return; }
  $("create").disabled = true;
  $("progress").classList.remove("hidden");
  $("progress").dataset.started = "true";
  $("done").classList.add("hidden");
  $("logs").textContent = "Submitting project brief…";
  setNotice("Your project is being queued. The deadline starts when the backend accepts it.");
  try {
    const job = await api("/jobs", {
      method: "POST",
      body: JSON.stringify({ name: $("modname").value, version: $("version").value.trim() || "latest", prompt })
    });
    jobId = job.id;
    deadline = Date.now() + 3600000;
    render(job);
    pollTimer = setInterval(poll, 2000);
    $("progress").scrollIntoView({ behavior: "smooth", block: "start" });
  } catch (error) {
    setNotice(error.message, true);
    $("create").disabled = false;
  }
});

$("account-button").addEventListener("click", () => openAuth("login"));
$("auth-close").addEventListener("click", closeAuth);
$("auth-modal").addEventListener("click", event => { if (event.target === $("auth-modal")) closeAuth(); });
$("login-tab").addEventListener("click", () => setAuthMode("login"));
$("register-tab").addEventListener("click", () => setAuthMode("register"));
$("auth-form").addEventListener("submit", async event => {
  event.preventDefault();
  const button = $("auth-submit");
  button.disabled = true;
  $("auth-status").textContent = authMode === "register" ? "Creating your account…" : "Logging in…";
  try {
    const data = await api("/auth/" + authMode, {
      method: "POST",
      body: JSON.stringify({ email: $("auth-email").value, password: $("auth-password").value })
    });
    currentUser = data.user;
    sessionToken = data.token;
    localStorage.setItem("fmai_token", sessionToken);
    updateAccountUI();
    closeAuth();
    $("auth-password").value = "";
    setNotice("Signed in. Your mods will be saved to your account.");
    if (!$("library").classList.contains("hidden")) loadProjects();
  } catch (error) {
    $("auth-status").textContent = error.message;
  } finally { button.disabled = false; }
});
$("logout-button").addEventListener("click", async () => {
  try { await api("/auth/logout", { method: "POST", body: "{}" }); }
  finally { currentUser = null; sessionToken = ""; localStorage.removeItem("fmai_token"); updateAccountUI(); setNotice("You have been logged out."); }
});
$("nav-new").addEventListener("click", () => showWorkspace("new"));
$("nav-library").addEventListener("click", () => { if (currentUser) showWorkspace("library"); else openAuth("login"); });
$("refresh-projects").addEventListener("click", loadProjects);
$("revise-button").addEventListener("click", reviseCurrentProject);
$("download").addEventListener("click", event => downloadProjectFile(event, $("download").dataset.projectId));
$("project-download").addEventListener("click", event => downloadProjectFile(event, $("project-download").dataset.projectId));

async function boot() {
  try {
    const health = await api("/health");
    $("backend-status").textContent = health.ok ? (health.accountsConfigured ? "Online · accounts ready" : "Online · database setup needed") : "Unavailable";
    document.querySelector(".pulse").style.background = health.accountsConfigured ? "#a8ed70" : "#e0b85c";
  } catch {
    $("backend-status").textContent = "Backend not connected";
    document.querySelector(".pulse").style.background = "#e0b85c";
  }
  try {
    const versions = await api("/versions");
    $("versions").innerHTML = versions.games.map(item => `<option value="${item.version}">${item.stable ? "Stable" : "Snapshot"}</option>`).join("");
    $("version-note").textContent = `Loaded ${versions.games.length} official game version entries. You can also type a version manually.`;
  } catch {
    $("version-note").textContent = "Version list unavailable; you can still type a Minecraft version.";
  }
  await restoreSession();
}
boot();
