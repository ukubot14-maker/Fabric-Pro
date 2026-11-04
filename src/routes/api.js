const express=require("express");
const fs=require("fs");
const path=require("path");
const archiver=require("archiver");
const {v4:uuid}=require("uuid");
const {getVersions}=require("../services/fabric-meta");
const {createProject}=require("../services/mod-builder");
const {PROJECTS_DIR,LIMIT_MS,MAX_ACTIVE_JOBS}=require("../utils/config");
const router=express.Router(),jobs=new Map();
function remaining(j){return Math.max(0,Math.ceil((j.deadline-Date.now())/1000));}
function snapshot(j){return {id:j.id,name:j.name,version:j.version,status:j.status,phase:j.phase,log:j.log.slice(-50),files:j.fileList||[],fileCount:j.fileCount||0,buildStatus:j.buildStatus||"pending",remainingSeconds:remaining(j),error:j.error||null};}
function log(j,msg){j.log.push({at:new Date().toISOString(),message:msg});j.log=j.log.slice(-100);}
router.get("/health",(req,res)=>res.json({ok:true,service:"Fabric Mod AI",limitMinutes:30,activeJobs:[...jobs.values()].filter(j=>j.status==="running").length}));
router.get("/versions",async(req,res)=>{try{res.json(await getVersions());}catch(e){res.status(503).json({error:e.message});}});
router.post("/jobs",async(req,res)=>{
 if(!process.env.OPENAI_API_KEY)return res.status(503).json({error:"AI backend is not configured. Add OPENAI_API_KEY to the server environment."});
 if([...jobs.values()].filter(j=>j.status==="running").length>=MAX_ACTIVE_JOBS)return res.status(429).json({error:"The mod workshop is busy. Try again when the current build finishes."});
 const {name,prompt,version}=req.body||{};
 if(typeof prompt!=="string"||prompt.trim().length<8||prompt.length>12000)return res.status(400).json({error:"Describe the mod in 8–12,000 characters."});
 const cleanName=String(name||"MyFabricMod").replace(/[^a-zA-Z0-9_-]/g,"").slice(0,48)||"MyFabricMod";
 const target=String(version||"latest").slice(0,40);
 const j={id:uuid(),name:cleanName,version:target,prompt:prompt.trim(),status:"running",phase:"Planning",started:Date.now(),deadline:Date.now()+LIMIT_MS,log:[],fileCount:0,fileList:[],buildStatus:"pending"};
 jobs.set(j.id,j);log(j,`Accepted project. Hard deadline: ${new Date(j.deadline).toISOString()}.`);
 res.status(202).json(snapshot(j));
 createProject(j,msg=>{j.phase=msg;log(j,msg);}).then(dir=>{
   if(Date.now()>j.deadline){j.status="expired";j.phase="Time limit reached";log(j,"Project exceeded its 30-minute deadline.");return;}
   j.status="completed";j.phase="Project source ready";log(j,"Project generation workflow finished.");
 }).catch(e=>{j.status=Date.now()>j.deadline?"expired":"failed";j.phase=j.status==="expired"?"Time limit reached":"Needs attention";j.error=e.message;log(j,e.message);});
});
router.get("/jobs/:id",(req,res)=>{const j=jobs.get(req.params.id);if(!j)return res.status(404).json({error:"Project not found"});if(j.status==="running"&&Date.now()>j.deadline){j.status="expired";j.phase="Time limit reached";log(j,"Hard deadline reached.");}res.json(snapshot(j));});
router.get("/jobs/:id/download",(req,res)=>{
 const j=jobs.get(req.params.id);if(!j)return res.status(404).json({error:"Project not found"});
 const dir=path.join(PROJECTS_DIR,j.id);if(!fs.existsSync(dir))return res.status(404).json({error:"Project files are not ready."});
 res.setHeader("Content-Type","application/zip");res.setHeader("Content-Disposition",`attachment; filename="${j.name}-fabric-project.zip"`);
 const archive=archiver("zip",{zlib:{level:8}});archive.on("error",e=>res.destroy(e));archive.pipe(res);archive.directory(dir,false);archive.finalize();
});
module.exports=router;
