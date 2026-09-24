import fs from 'node:fs';
import path from 'node:path';
import {createHash} from 'node:crypto';
import {CAROUSEL_PROMPT_VERSION,CAROUSEL_THEMES} from './home-carousel-score.mjs';

// Keep model facts separate from a reviewer's theme-specific vetoes. Raw descriptions stay private.
export function compileCarouselCache(previous, scores, overrides = {}) {
  // Old unscored labels remain in private history, never relabelled as new GLM results.
  const topics = Object.fromEntries(Object.entries(previous.topics).filter(([,label])=>label.carousel?.promptVersion===CAROUSEL_PROMPT_VERSION));
  const names={water:'玩水',sleep:'睡觉',laugh:'笑',eat:'吃饭',outdoor:'户外',toy:'玩玩具',hold:'抱着'};
  for(const row of scores){
    if(row.promptVersion!==CAROUSEL_PROMPT_VERSION||row.model!=='glm-5.3-flash')throw new Error('unversioned score');
    const {id}=row;
    const score=Object.fromEntries(['promptVersion','takenAt','matches','clarity','expression','qualified','eyesOpen','sleeping','childMain','faceClear','faceUnblocked','motionBlur','sensitive'].map(k=>[k,row[k]]));
    const best=Object.keys(names).sort((a,b)=>score.matches[b]-score.matches[a])[0];
    const manual=overrides[id]??{};
    if(manual.excludedThemes&&!manual.excludedThemes.every(k=>CAROUSEL_THEMES.includes(k)))throw new Error('invalid reviewer theme');
    if(manual.approvedThemes&&!manual.approvedThemes.every(k=>CAROUSEL_THEMES.includes(k)))throw new Error('invalid approved theme');
    topics[id]={topic:score.matches[best]>=80?names[best]:'其他',water:score.matches.water>=80,
      value:(score.clarity*.7+score.expression*.3)/100,confidence:score.matches[best]/100,
      carousel:{...score,approvedThemes:manual.approvedThemes??[],...(manual.excludedThemes?{excludedThemes:manual.excludedThemes}:{}),...(manual.sceneKey?{sceneKey:manual.sceneKey.startsWith('scene:')?manual.sceneKey:'scene:'+createHash('sha256').update(manual.sceneKey).digest('hex').slice(0,24)}:{})}};
  }
  return {model:'glm-5.3-flash',promptVersion:CAROUSEL_PROMPT_VERSION,assessedAt:new Date().toISOString(),
    scope:`Offline visual review of ${scores.length} subject-checked candidate photos; no model calls during rendering.`,topics};
}

export function writeCarouselCache({workDir,previousFile,outFile,overrideFile,requireComplete=true}) {
  const previous=JSON.parse(fs.readFileSync(previousFile,'utf8'));
  const scores=fs.readdirSync(path.join(workDir,'scores')).filter(f=>f.endsWith('.json')).map(f=>JSON.parse(fs.readFileSync(path.join(workDir,'scores',f),'utf8')));
  const manifest=JSON.parse(fs.readFileSync(path.join(workDir,'candidates.json'),'utf8'));
  const byId=new Map(scores.map(s=>[s.id,s]));
  const exclusionsFile=path.join(workDir,'unscored-exclusions.json');
  const exclusions=fs.existsSync(exclusionsFile)?JSON.parse(fs.readFileSync(exclusionsFile,'utf8')):{};
  const unscored=manifest.filter(p=>byId.get(p.id)?.takenAt!==p.takenAt);
  if(requireComplete&&unscored.some(p=>exclusions[p.id]?.takenAt!==p.takenAt||!exclusions[p.id]?.reason||!exclusions[p.id]?.callId))throw new Error('candidate manifest is not fully scored or explicitly excluded');
  const overrides=overrideFile&&fs.existsSync(overrideFile)?JSON.parse(fs.readFileSync(overrideFile,'utf8')):{};
  const cache=compileCarouselCache(previous,scores,overrides);
  for(const p of unscored)delete cache.topics[p.id];
  fs.writeFileSync(outFile,JSON.stringify(cache,null,2)+'\n');
  return {scored:scores.length,candidates:manifest.length};
}
