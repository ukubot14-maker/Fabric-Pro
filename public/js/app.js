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


/* Texture Studio: client-side PNG pixel editor and authenticated project save */
let textureItems = [], activeTextureIndex = -1, textureTool = "pencil", textureUndo = [];
const textureCanvas = $("texture-canvas");
const textureCtx = textureCanvas.getContext("2d", { willReadFrequently: true });
function textureActive() { return textureItems[activeTextureIndex] || null; }
function textureDraw() {
  const item = textureActive();
  textureCtx.clearRect(0, 0, 512, 512);
  if (!item) return;
  const off = document.createElement("canvas");
  off.width = item.width; off.height = item.height;
  off.getContext("2d").putImageData(item.image, 0, 0);
  textureCtx.imageSmoothingEnabled = false;
  textureCtx.drawImage(off, 0, 0, 512, 512);
  const cellW = 512 / item.width, cellH = 512 / item.height;
  if (item.width <= 128 && item.height <= 128) {
    textureCtx.save();
    textureCtx.strokeStyle = "rgba(210,235,210,.22)";
    textureCtx.lineWidth = .5;
    for (let x = 0; x <= item.width; x++) { textureCtx.beginPath(); textureCtx.moveTo(x * cellW, 0); textureCtx.lineTo(x * cellW, 512); textureCtx.stroke(); }
    for (let y = 0; y <= item.height; y++) { textureCtx.beginPath(); textureCtx.moveTo(0, y * cellH); textureCtx.lineTo(512, y * cellH); textureCtx.stroke(); }
    textureCtx.restore();
  }
  $("texture-name").textContent = item.name;
  $("texture-dimensions").textContent = item.width + " × " + item.height;
  $("texture-filename").value = item.name.replace(/\.png$/i, "").replace(/[^a-zA-Z0-9_-]/g, "_").slice(0,64) || "custom_texture";
  $("texture-download").disabled = false;
  $("texture-undo").disabled = !textureUndo.length;
  $("texture-save-project").disabled = !currentUser || !$("texture-project").value;
}
function textureRenderList() {
  const list = $("texture-assets-list"); list.replaceChildren();
  if (!textureItems.length) { const p=document.createElement("p"); p.className="empty-state"; p.textContent="Load one or more PNG textures to begin."; list.append(p); return; }
  textureItems.forEach((item,index)=>{
    const b=document.createElement("button"); b.type="button"; b.className="texture-asset"+(index===activeTextureIndex?" active":"");
    const img=document.createElement("img"); img.className="texture-thumb"; img.src=item.url; img.alt="";
    const span=document.createElement("span"); span.textContent=item.name+" · "+item.width+"×"+item.height;
    b.append(img,span); b.addEventListener("click",()=>{activeTextureIndex=index;textureUndo=[];textureRenderList();textureDraw();}); list.append(b);
  });
}
function textureSnapshot() { const item=textureActive(); if(item){textureUndo.push(new ImageData(new Uint8ClampedArray(item.image.data),item.width,item.height));if(textureUndo.length>30)textureUndo.shift();} }
function texturePoint(event) {
  const rect=textureCanvas.getBoundingClientRect(), item=textureActive();
  if(!item)return null;
  return {x:Math.max(0,Math.min(item.width-1,Math.floor((event.clientX-rect.left)/rect.width*item.width))),y:Math.max(0,Math.min(item.height-1,Math.floor((event.clientY-rect.top)/rect.height*item.height)))};
}
function texturePaint(event) {
  const item=textureActive(), point=texturePoint(event); if(!item||!point)return;
  const idx=(point.y*item.width+point.x)*4, data=item.image.data;
  if(textureTool==="eraser"){data[idx]=data[idx+1]=data[idx+2]=data[idx+3]=0;}
  else {const color=$("texture-color").value;data[idx]=parseInt(color.slice(1,3),16);data[idx+1]=parseInt(color.slice(3,5),16);data[idx+2]=parseInt(color.slice(5,7),16);data[idx+3]=255;}
  textureDraw();
}
function textureFlood(point) {
  const item=textureActive(); if(!item)return;
  const data=item.image.data, start=(point.y*item.width+point.x)*4, target=[...data.slice(start,start+4)];
  const color=$("texture-color").value, replacement=[parseInt(color.slice(1,3),16),parseInt(color.slice(3,5),16),parseInt(color.slice(5,7),16),255];
  if(target.every((v,i)=>v===replacement[i]))return;
  const stack=[point], seen=new Uint8Array(item.width*item.height);
  while(stack.length){const p=stack.pop(), pos=p.y*item.width+p.x, i=pos*4;if(seen[pos]||data[i]!==target[0]||data[i+1]!==target[1]||data[i+2]!==target[2]||data[i+3]!==target[3])continue;seen[pos]=1;data.set(replacement,i);if(p.x)stack.push({x:p.x-1,y:p.y});if(p.x+1<item.width)stack.push({x:p.x+1,y:p.y});if(p.y)stack.push({x:p.x,y:p.y-1});if(p.y+1<item.height)stack.push({x:p.x,y:p.y+1});}
}
$("texture-upload").addEventListener("change", async event=>{
  const files=[...event.target.files||[]].filter(file=>file.type==="image/png"||file.name.toLowerCase().endsWith(".png"));
  for(const file of files){
    if(file.size>5*1024*1024){$("texture-save-status").textContent=file.name+" is over the 5 MB limit.";continue;}
    try{const bitmap=await createImageBitmap(file);if(bitmap.width>512||bitmap.height>512){bitmap.close();$("texture-save-status").textContent=file.name+" is larger than 512×512 pixels.";continue;}
      const c=document.createElement("canvas");c.width=bitmap.width;c.height=bitmap.height;const cx=c.getContext("2d",{willReadFrequently:true});cx.drawImage(bitmap,0,0);bitmap.close();
      textureItems.push({name:file.name,width:c.width,height:c.height,image:cx.getImageData(0,0,c.width,c.height),url:URL.createObjectURL(file)});
    }catch{$("texture-save-status").textContent="Could not load "+file.name+". Make sure it is a valid PNG.";}
  }
  if(textureItems.length){activeTextureIndex=textureItems.length-1;textureUndo=[];textureRenderList();textureDraw();$("texture-save-status").textContent="Texture loaded. Edit it, then download it or save it into a mod project.";}
  event.target.value="";
});
let texturePainting=false;
textureCanvas.addEventListener("pointerdown",event=>{const p=texturePoint(event);if(!p)return;event.preventDefault();textureSnapshot();if(textureTool==="fill"){textureFlood(p);textureDraw();return;}texturePainting=true;textureCanvas.setPointerCapture(event.pointerId);texturePaint(event);});
textureCanvas.addEventListener("pointermove",event=>{if(texturePainting)texturePaint(event);});
textureCanvas.addEventListener("pointerup",()=>{texturePainting=false;});
textureCanvas.addEventListener("pointercancel",()=>{texturePainting=false;});
document.querySelectorAll("[data-tool]").forEach(button=>button.addEventListener("click",()=>{textureTool=button.dataset.tool;document.querySelectorAll("[data-tool]").forEach(b=>b.classList.toggle("active",b===button));}));
$("texture-undo").addEventListener("click",()=>{const item=textureActive();if(item&&textureUndo.length){item.image=textureUndo.pop();textureDraw();}});
$("texture-clear").addEventListener("click",()=>{const item=textureActive();if(!item)return;textureSnapshot();item.image.data.fill(0);textureDraw();});
function texturePngBlob(){const item=textureActive();if(!item)return null;const c=document.createElement("canvas");c.width=item.width;c.height=item.height;c.getContext("2d").putImageData(item.image,0,0);return new Promise(resolve=>c.toBlob(resolve,"image/png"));}
$("texture-download").addEventListener("click",async()=>{const blob=await texturePngBlob();if(!blob)return;const url=URL.createObjectURL(blob);const a=document.createElement("a");a.href=url;a.download=(textureActive().name.replace(/\.png$/i,"")||"texture")+".png";a.click();URL.revokeObjectURL(url);});
async function loadTextureProjectOptions(){
  const select=$("texture-project");select.innerHTML="";
  if(!currentUser){select.add(new Option("Log in to load projects",""));$("texture-save-project").disabled=true;return;}
  try{const data=await api("/projects");select.add(new Option("Choose a saved mod…",""));data.projects.forEach(p=>select.add(new Option(p.name+" · "+p.minecraft_version,p.id)));$("texture-save-project").disabled=!textureActive();}
  catch(error){select.add(new Option(error.message,""));}
}
$("texture-project").addEventListener("change",()=>{$("texture-save-project").disabled=!currentUser||!textureActive()||!$("texture-project").value;});
$("texture-save-project").addEventListener("click",async()=>{
  const item=textureActive(),projectId=$("texture-project").value;
  if(!item||!projectId){$("texture-save-status").textContent="Load a PNG and choose a saved project first.";return;}
  const namespace=$("texture-namespace").value.trim().toLowerCase(),filename=$("texture-filename").value.trim().replace(/\.png$/i,""),kind=$("texture-kind").value;
  if(!/^[a-z0-9_.-]{1,64}$/.test(namespace)||!/^[a-zA-Z0-9_-]{1,64}$/.test(filename)){ $("texture-save-status").textContent="Use a valid namespace and a file name with letters, numbers, _ or -.";return;}
  const button=$("texture-save-project");button.disabled=true;button.textContent="SAVING TEXTURE…";
  try{
    const blob=await texturePngBlob();const dataUrl=await new Promise((resolve,reject)=>{const reader=new FileReader();reader.onload=()=>resolve(reader.result);reader.onerror=reject;reader.readAsDataURL(blob);});
    const result=await api("/projects/"+encodeURIComponent(projectId)+"/textures",{method:"POST",body:JSON.stringify({path:"src/main/resources/assets/"+namespace+"/textures/"+kind+"/"+filename+".png",pngDataUrl:dataUrl})});
    $("texture-save-status").textContent="Saved "+result.path+" into your mod project. Download the project ZIP again to get the updated texture.";
  }catch(error){$("texture-save-status").textContent=error.message;}
  finally{button.disabled=!textureActive()||!$("texture-project").value;button.textContent="SAVE TO MOD PROJECT →";}
});
$("nav-textures").addEventListener("click",()=>{showWorkspace("textures");$("texture-studio").classList.remove("hidden");$("builder").classList.add("hidden");$("library").classList.add("hidden");$("progress").classList.add("hidden");document.querySelector(".welcome").classList.add("hidden");$("nav-new").classList.remove("active");$("nav-library").classList.remove("active");$("nav-textures").classList.add("active");loadTextureProjectOptions();});
const originalShowWorkspace=showWorkspace;
showWorkspace=function(which){originalShowWorkspace(which);$("texture-studio").classList.add("hidden");$("nav-textures").classList.toggle("active",false);};
const originalUpdateAccountUI=updateAccountUI;
updateAccountUI=function(){originalUpdateAccountUI();if($("texture-studio")&&!$("texture-studio").classList.contains("hidden"))loadTextureProjectOptions();};
