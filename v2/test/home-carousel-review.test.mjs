import test from 'node:test';
import assert from 'node:assert/strict';
import {selectHomeMemories} from '../lib/home-memory.ts';
import {CAROUSEL_THEMES,topicLookupFrom} from '../lib/home-memory-topics.ts';
import {parseCarouselScores,parsePartialCarouselScores} from '../scripts/editor/home-carousel-score.mjs';
import {compileCarouselCache} from '../scripts/editor/home-carousel-cache.mjs';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {persistCarouselHistory,restoreCarouselScores} from '../scripts/editor/home-carousel-history.mjs';
const dates=Array.from({length:10},(_,i)=>`2026-07-${String(i+1).padStart(2,'0')} 12:00:00`);
const photos=dates.map((takenAt,i)=>({id:`p${i}`,takenAt,type:'photo',src:`/api/media/p${i}?variant=web`,width:1200,height:1600}));
const archive={birthDay:'2025-01-03',time:{today:'2026-09-24'},privilege:{checked:new Set(photos.map(p=>p.id))},chapters:[{year:'2026',months:[{month:'2026-07',photoDays:photos.map(p=>({day:p.takenAt.slice(0,10),photos:[p]}))}]}]};
const label=(p,overrides={})=>({topic:'其他',water:false,value:.9,confidence:.9,carousel:{promptVersion:'home-carousel-v4',takenAt:p.takenAt,
 matches:Object.fromEntries(CAROUSEL_THEMES.map(k=>[k,k==='summer'?95:0])),clarity:95,expression:90,qualified:true,eyesOpen:true,sleeping:false,childMain:true,faceClear:true,faceUnblocked:true,motionBlur:false,sensitive:false,approvedThemes:[...CAROUSEL_THEMES],...overrides}});
const select=(fn=label)=>selectHomeMemories(archive,topicLookupFrom({model:'glm-5.3-flash',promptVersion:'home-carousel-v4',topics:Object.fromEntries(photos.map(p=>[p.id,fn(p)]))}));
test('season needs visible seasonal evidence as well as capture date',()=>{
 assert.equal(select().memories[0].slides.length,10);
 assert.equal(select(p=>label(p,{matches:Object.fromEntries(CAROUSEL_THEMES.map(k=>[k,0]))})).memories.length,0);
 const wronglyGrouped={...archive,chapters:[{year:'2026',months:[{...archive.chapters[0].months[0],month:'2026-01'}]}]};
 assert.equal(selectHomeMemories(wronglyGrouped,id=>label(photos.find(p=>p.id===id))).memories[0].title,'2026 年的夏天');
});
test('seven qualified scenes are hidden; eight are enough',()=>{
 for(const n of [7,8])assert.equal(select(p=>label(p,{qualified:Number(p.id.slice(1))<n})).memories.length,n===8?1:0);
});
test('bad faces, stale dates and reviewer exclusions cannot be compensated by high match scores',()=>{
 for(const bad of [{approvedThemes:undefined},{approvedThemes:[]},{clarity:79},{faceClear:false},{faceUnblocked:false},{motionBlur:true},{sensitive:true},{childMain:false},{takenAt:'2025-07-01'},{excludedThemes:['summer']},{eyesOpen:false}])assert.equal(select(p=>label(p,bad)).memories.length,0);
});
test('closed eyes are allowed only for actual sleeping in the sleep theme',()=>{
 const match=Object.fromEntries(CAROUSEL_THEMES.map(k=>[k,k==='sleep'?95:0]));
 assert.equal(select(p=>label(p,{eyesOpen:false,sleeping:true,matches:match})).memories[0].key,'topic:sleep');
 assert.equal(select(p=>label(p,{eyesOpen:false,sleeping:false,matches:match})).memories.length,0);
});
test('scene keys prevent visually duplicate photos on different timestamps from filling a theme',()=>{
 assert.equal(select(p=>label(p,{sceneKey:'same-scene'})).memories.length,0);
});
test('old labels and incomplete model scores never pass as new scores',()=>{
 assert.equal(selectHomeMemories(archive,()=>({topic:'户外',water:false,value:1,confidence:1})).memories.length,0);
 assert.throws(()=>parseCarouselScores('[{"id":"0","clarity":100}]',['0']));
});

test('a partial batch reuses only complete, unambiguous results',()=>{
 const complete={id:'0',scene:'toy on mat',why:'clear face',...label(photos[0]).carousel};
 const incomplete={id:'1',clarity:99};
 assert.equal(parsePartialCarouselScores(JSON.stringify([complete,incomplete]),['0','1']).length,1);
 assert.equal(parsePartialCarouselScores(JSON.stringify([complete,complete]),['0']).length,0);
 assert.equal(parsePartialCarouselScores('```json\n'+JSON.stringify([complete])+'\n```\nExplanation',['0']).length,1);
});
test('render cache omits private model descriptions and human notes while preserving vetoes',()=>{
 const p=photos[0];const row={id:p.id,model:'glm-5.3-flash',scene:'private room detail',why:'private judgement',...label(p).carousel};
 const cache=compileCarouselCache({topics:{}},[row],{[p.id]:{excludedThemes:['summer'],reason:'private manual note',qualified:true}});
 const json=JSON.stringify(cache);assert.ok(!json.includes('private'));assert.deepEqual(cache.topics[p.id].carousel.excludedThemes,['summer']);
});
test('private history is append-only, idempotent and reusable without losing older scores',()=>{
 const root=fs.mkdtempSync(path.join(os.tmpdir(),'nian-carousel-history-'));
 try{
  const work=path.join(root,'work');fs.mkdirSync(path.join(work,'scores'),{recursive:true});
  const p=photos[0];fs.writeFileSync(path.join(work,'candidates.json'),JSON.stringify([p]));
  const row={id:p.id,model:'glm-5.3-flash',assessedAt:'2026-09-24T01:00:00Z',why:'first review',...label(p).carousel};
  fs.writeFileSync(path.join(work,'scores','one.json'),JSON.stringify(row));
  assert.equal(persistCarouselHistory(work,root).added,1);assert.equal(persistCarouselHistory(work,root).added,0);
  fs.writeFileSync(path.join(work,'scores','one.json'),JSON.stringify({...row,assessedAt:'2026-09-24T02:00:00Z',clarity:85,why:'second review'}));
  assert.equal(persistCarouselHistory(work,root).total,2);
  const fresh=path.join(root,'fresh');fs.mkdirSync(path.join(fresh,'scores'),{recursive:true});
  assert.equal(restoreCarouselScores([p],fresh,root),1);
  assert.equal(JSON.parse(fs.readFileSync(path.join(fresh,'scores',fs.readdirSync(path.join(fresh,'scores'))[0]),'utf8')).why,'second review');
  const changed=path.join(root,'changed');fs.mkdirSync(path.join(changed,'scores'),{recursive:true});
  assert.equal(restoreCarouselScores([{...p,takenAt:'2026-07-02'}],changed,root),0);
 }finally{fs.rmSync(root,{recursive:true,force:true});}
});
