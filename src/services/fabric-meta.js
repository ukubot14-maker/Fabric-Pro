const BASE = "https://meta.fabricmc.net/v2";
async function getJSON(url) {
  const r = await fetch(url, {headers:{"User-Agent":"Fabric-Mod-AI/1.0"}});
  if (!r.ok) throw new Error(`Fabric metadata request failed (${r.status})`);
  return r.json();
}
async function getVersions() {
  const [games, loaders] = await Promise.all([
    getJSON(`${BASE}/versions/game`), getJSON(`${BASE}/versions/loader`)
  ]);
  return {games:games.map(x=>({version:x.version,stable:!!x.stable})),loaders:loaders.slice(0,20).map(x=>({version:x.version,stable:!!x.stable}))};
}
module.exports={getVersions};
