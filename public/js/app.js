// Set this to your deployed backend URL when frontend and backend are hosted separately.
const API_BASE = window.FABRIC_MOD_AI_API || "";
const $=id=>document.getElementById(id);
let jobId=null,pollTimer=null,deadline=0;
async function api(path,options={}) {
 const r=await fetch(API_BASE+"/api"+path,{...options,headers:{"Content-Type":"application/json",...(options.headers||{})}});
 const data=await r.json().catch(()=>({error:"The server returned an unreadable response."}));
 if(!r.ok)throw new Error(data.error||`Request failed (${r.status})`);
 return data;
}
function stop(){clearInterval(pollTimer);pollTimer=null;}
function setNotice(message,error=false){$("notice").textContent=message;$("notice").classList.toggle("error",error);}
function render(j){
 $("phase").textContent=j.phase||"Working";$("status").textContent=`${j.status.toUpperCase()} · ${j.version}`;$("filecount").textContent=`${j.fileCount||j.files?.length||0} files`;
 $("logs").textContent=(j.log||[]).map(x=>`${x.at?new Date(x.at).toLocaleTimeString()+"  ":""}${x.message||x}`).join("\\n");$("logs").scrollTop=$("logs").scrollHeight;
 const s=Math.max(0,j.remainingSeconds??Math.ceil((deadline-Date.now())/1000));
 $("timer").textContent=`${String(Math.floor(s/60)).padStart(2,"0")}:${String(s%60).padStart(2,"0")}`;$("fill").style.width=`${Math.min(100,100*(1-s/3600))}%`;
 if(j.status==="completed"){$("done").classList.remove("hidden");$("build-status").textContent=`Source checks: ${j.buildStatus||"not reported"}. This is a source ZIP, not a compiled JAR. Extract it and run BUILD.bat (Windows) or ./build.sh (Mac/Linux) to create the JAR.`;$("download").href=API_BASE+`/api/jobs/${j.id}/download`;stop();$("create").disabled=false;}
 if(["failed","expired"].includes(j.status)){setNotice(j.error||"The project stopped. Review the build activity for details.",true);stop();$("create").disabled=false;}
}
async function poll(){if(!jobId)return;try{render(await api(`/jobs/${jobId}`));}catch(e){setNotice(e.message,true);stop();$("create").disabled=false;}}
$("prompt").addEventListener("input",()=>$("char-count").textContent=`${$("prompt").value.length.toLocaleString()} / 12,000`);
document.querySelectorAll("[data-prompt]").forEach(b=>b.addEventListener("click",()=>{$("prompt").value=b.dataset.prompt;$("prompt").dispatchEvent(new Event("input"));$("prompt").focus();}));
$("create").addEventListener("click",async()=>{
 const prompt=$("prompt").value.trim();if(prompt.length<8){setNotice("Add a little more detail before starting (at least 8 characters).",true);return;}
 $("create").disabled=true;$("progress").classList.remove("hidden");$("done").classList.add("hidden");$("logs").textContent="Submitting project brief…";setNotice("Your project is being queued. The server starts the deadline when it accepts the job.");
 try{const j=await api("/jobs",{method:"POST",body:JSON.stringify({name:$("modname").value,version:$("version").value.trim()||"latest",prompt})});jobId=j.id;deadline=Date.now()+3600000;render(j);pollTimer=setInterval(poll,2000);$("progress").scrollIntoView({behavior:"smooth",block:"start"});}
 catch(e){setNotice(e.message,true);$("create").disabled=false;}
});
async function boot(){
 try{const h=await api("/health");$("backend-status").textContent=h.ok?"Online · ready":"Unavailable";document.querySelector(".pulse").style.background=h.ok?"#a8ed70":"#e0b85c";}
 catch{$("backend-status").textContent="Backend not connected";document.querySelector(".pulse").style.background="#e0b85c";}
 try{const v=await api("/versions");$("versions").innerHTML=v.games.map(x=>`<option value="${x.version}">${x.stable?"Stable":"Snapshot"}</option>`).join("");$("version-note").textContent=`Loaded ${v.games.length} official game version entries. Enter another version manually if needed.`;}
 catch{$("version-note").textContent="Version list unavailable; you can still type a Minecraft version.";}
}
boot();