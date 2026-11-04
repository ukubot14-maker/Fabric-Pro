const {MODEL}=require("../utils/config");
async function chat(messages, {timeoutMs=120000, json=true}={}) {
  if (!process.env.OPENAI_API_KEY) throw new Error("OPENAI_API_KEY is not configured on the server.");
  const controller=new AbortController(); const timer=setTimeout(()=>controller.abort(),timeoutMs);
  try {
    const body={model:MODEL,temperature:0.2,messages};
    if(json) body.response_format={type:"json_object"};
    const r=await fetch("https://api.openai.com/v1/chat/completions",{
      method:"POST",signal:controller.signal,
      headers:{"Authorization":`Bearer ${process.env.OPENAI_API_KEY}`,"Content-Type":"application/json"},
      body:JSON.stringify(body)
    });
    const data=await r.json().catch(()=>({}));
    if(!r.ok) throw new Error(data.error?.message||`AI provider returned ${r.status}`);
    return data.choices?.[0]?.message?.content||"";
  } catch(e) {
    if(e.name==="AbortError") throw new Error("AI request timed out.");
    throw e;
  } finally {clearTimeout(timer);}
}
module.exports={chat};
