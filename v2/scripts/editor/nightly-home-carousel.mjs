// Existing nightly pipeline only; bounded and no model calls from page rendering.
// Updates the local release cache. Publishing remains the normal gated main release.
import fs from 'node:fs';
import path from 'node:path';
import {createHash} from 'node:crypto';
import {spawnSync} from 'node:child_process';
import {writeCarouselCache} from './home-carousel-cache.mjs';
import {CAROUSEL_PROMPT_VERSION} from './home-carousel-score.mjs';

const workDir=path.resolve(process.env.NIANLIFE_CAROUSEL_WORK_DIR??`.data/home-carousel-nightly/${CAROUSEL_PROMPT_VERSION}`);
fs.mkdirSync(path.join(workDir,'scores'),{recursive:true});
const cacheFile=path.resolve('data/photo-topics.json');
const previous=JSON.parse(fs.readFileSync(cacheFile,'utf8'));
// Preserve the reviewed initial release and explicit per-theme vetoes.
const overrides={};
for(const [id,label]of Object.entries(previous.topics)){
 const score=label.carousel;if(score?.promptVersion!==CAROUSEL_PROMPT_VERSION)continue;
 const file=path.join(workDir,'scores',createHash('sha256').update(id).digest('hex')+'.json');
 if(!fs.existsSync(file))fs.writeFileSync(file,JSON.stringify({id,model:'glm-5.3-flash',...score}));
 overrides[id]={approvedThemes:score.approvedThemes??[],...(score.excludedThemes?{excludedThemes:score.excludedThemes}:{}),...(score.sceneKey?{sceneKey:score.sceneKey}:{})};
}
const {openRds}=await import('../../.data/night-rds.mjs');
const rds=await openRds({readOnly:true});let rows;
try{
 rows=(await rds.client.query(`select m.id,to_char(m.taken_at,'YYYY-MM-DD HH24:MI:SS') as "takenAt",m.width,m.height,'photo' as type
 from media m where m.type='photo' and m.visibility<>'private' and m.taken_at::date<=current_date
 and least(m.width,m.height)>=480 and greatest(m.width,m.height)>=720
 and (select q.decision from content_quality_reviews q where q.target_kind='media_subject_check' and q.target_id=m.id order by q.reviewed_at desc limit 1)='approved'
 and exists(select 1 from media_locations ml where ml.media_asset_id=m.media_asset_id and ml.provider='hot' and ml.variant='web' and ml.status='ready')
 order by m.taken_at,m.id`)).rows;
}finally{await rds.close();}
for(const p of rows)if(previous.topics[p.id]?.carousel?.takenAt!==p.takenAt)delete overrides[p.id];
const manifest=path.join(workDir,'candidates.json');fs.writeFileSync(manifest,JSON.stringify(rows));
fs.writeFileSync(path.join(workDir,'overrides.json'),JSON.stringify(overrides));
const scored=spawnSync(process.execPath,['scripts/editor/home-carousel-rescore.mjs','--manifest',manifest,'--work-dir',workDir,'--concurrency','4','--batch-size','3'],{stdio:'inherit'});
if(scored.status!==0)process.exit(scored.status??1);
const stamp=new Date().toISOString().replace(/[:.]/g,'-');const backup=path.join(workDir,`cache-before-${stamp}.json`);
fs.copyFileSync(cacheFile,backup);
const candidate=path.join(workDir,'cache-next.json');
console.log(writeCarouselCache({workDir,previousFile:backup,outFile:candidate,overrideFile:path.join(workDir,'overrides.json')}));
fs.renameSync(candidate,cacheFile);
console.log('Updated offline release cache; production changes only after the normal gated release.');
