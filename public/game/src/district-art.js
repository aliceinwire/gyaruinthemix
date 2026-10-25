import { DISTRICT_CATALOG } from './district-catalog.js';
const seasons = new Set(['spring','summer','autumn','winter']);
const rasters = new Map(), jobs = new Map();
const MAX_CACHED_PLATES = 12;
export function getDistricts(cityId) {
  return Object.hasOwn(DISTRICT_CATALOG,cityId) ? DISTRICT_CATALOG[cityId] : [];
}
export function getDistrictScene(cityId,index=0) {
  const scenes=getDistricts(cityId);
  return scenes[Math.max(0,Math.min(scenes.length-1,Math.floor(Number(index)||0)))] || null;
}
function keyFor(cityId,index,season) {
  const scene=getDistrictScene(cityId,index);
  return scene && seasons.has(season) ? `${cityId}/${scene.id}/${season}` : null;
}
export function getDistrictRaster(cityId,index,season) {
  const key=keyFor(cityId,index,season), value=rasters.get(key);
  if(value) {rasters.delete(key);rasters.set(key,value);}
  return value || null;
}
export function preloadDistrictArt(cityId,index,season) {
  const key=keyFor(cityId,index,season), scene=getDistrictScene(cityId,index);
  if(!key) return Promise.resolve(false);
  if(rasters.has(key)) return Promise.resolve(true);
  if(jobs.has(key)) return jobs.get(key);
  const job=new Promise((resolve,reject)=>{
    const image=new Image(); let settled=false;
    const timeout=setTimeout(()=>finish(new Error('District art load timed out')),15000);
    function finish(error) {
      if(settled)return; settled=true;clearTimeout(timeout);image.onload=null;image.onerror=null;
      jobs.delete(key);
      if(error) reject(error); else resolve(true);
    }
    image.onload=()=>{
      if(image.naturalWidth!==528||image.naturalHeight!==165){finish(new Error('District art dimensions do not match'));return;}
      rasters.set(key,image);
      while(rasters.size>MAX_CACHED_PLATES)rasters.delete(rasters.keys().next().value);
      finish();
    };
    image.onerror=()=>finish(new Error('District art failed to load'));
    image.src=new URL(`../assets/districts/${cityId}/${scene.files[season]}?v=${scene.hashes[season]}`,import.meta.url).href;
  });
  jobs.set(key,job);return job;
}
export function districtArtStats(){return {cached:rasters.size,pending:jobs.size};}
