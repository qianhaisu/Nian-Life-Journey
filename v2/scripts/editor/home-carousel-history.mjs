// Private, append-only model review history. Never imported by a rendering module.
import fs from 'node:fs';
import path from 'node:path';
import {createHash} from 'node:crypto';
import {fileURLToPath} from 'node:url';
import {CAROUSEL_PROMPT,CAROUSEL_PROMPT_VERSION} from './home-carousel-score.mjs';
const digest=value=>createHash('sha256').update(value).digest('hex');
export const HISTORY_ROOT=process.env.NIANLIFE_PHOTO_REVIEW_HISTORY??'C:/Users/teddy/NianlifeOps/photo-reviews';

export function restoreCarouselScores(candidates,workDir,historyRoot=HISTORY_ROOT) {
 const file=path.join(historyRoot,'home-carousel','reviews.jsonl');if(!fs.existsSync(file))return 0;
 const byId=new Map(candidates.map(p=>[p.id,p]));let reused=0;
 const records=fs.readFileSync(file,'utf8').split(/\r?\n/).filter(Boolean).map(line=>JSON.parse(line)).sort((a,b)=>b.assessedAt.localeCompare(a.assessedAt));
 for(const row of records){
  const p=byId.get(row.mediaId);if(!p||row.model!=='glm-5.3-flash'||row.promptVersion!==CAROUSEL_PROMPT_VERSION||row.promptHash!==digest(CAROUSEL_PROMPT)
    ||row.takenAt!==p.takenAt||row.source.width!==p.width||row.source.height!==p.height)continue;
  const out=path.join(workDir,'scores',digest(p.id)+'.json');if(fs.existsSync(out))continue;
  const localImage=path.join(workDir,'images',digest(p.id)+'.webp');
  if(fs.existsSync(localImage)&&row.source.imageSha256&&digest(fs.readFileSync(localImage))!==row.source.imageSha256)continue;
  fs.writeFileSync(out,JSON.stringify(row.result,null,2));reused++;
 }
 return reused;
}

export function persistCarouselHistory(workDir,historyRoot=HISTORY_ROOT) {
 const root=path.join(historyRoot,'home-carousel');fs.mkdirSync(path.join(root,'prompts'),{recursive:true});
 const legacy=path.join(workDir,'cache-before.json');if(fs.existsSync(legacy)){
  const bytes=fs.readFileSync(legacy);const archiveDir=path.join(root,'cache-snapshots');fs.mkdirSync(archiveDir,{recursive:true});
  const snapshot=path.join(archiveDir,`${digest(bytes)}.json`);if(!fs.existsSync(snapshot))fs.writeFileSync(snapshot,bytes);
 }
 const promptHash=digest(CAROUSEL_PROMPT);const promptFile=path.join(root,'prompts',`${CAROUSEL_PROMPT_VERSION}-${promptHash.slice(0,12)}.json`);
 if(!fs.existsSync(promptFile))fs.writeFileSync(promptFile,JSON.stringify({version:CAROUSEL_PROMPT_VERSION,model:'glm-5.3-flash',sha256:promptHash,prompt:CAROUSEL_PROMPT},null,2));
 const ledger=path.join(root,'reviews.jsonl'),callsFile=path.join(root,'calls.jsonl'),manualFile=path.join(root,'human-reviews.jsonl');
 const readLines=file=>fs.existsSync(file)?fs.readFileSync(file,'utf8').split(/\r?\n/).filter(Boolean).map(line=>JSON.parse(line)):[];
 const existing=readLines(ledger);const ids=new Set(existing.map(r=>r.reviewId));const callIds=new Set(readLines(callsFile).map(r=>r.callId));
 const candidates=JSON.parse(fs.readFileSync(path.join(workDir,'candidates.json'),'utf8'));const candidateById=new Map(candidates.map(p=>[p.id,p]));
 let added=0;
 for(const file of fs.readdirSync(path.join(workDir,'scores')).filter(f=>f.endsWith('.json'))){
  const raw=JSON.parse(fs.readFileSync(path.join(workDir,'scores',file),'utf8'));
  // A nightly seed copied from the release cache is not a new model call.
  if(!raw.assessedAt)continue;
  const reviewId=digest(JSON.stringify(raw));if(ids.has(reviewId))continue;
  const p=candidateById.get(raw.id);const imageFile=path.join(workDir,'images',digest(raw.id)+'.webp');
  const row={schema:'nianlife.photo-review/1',reviewId,mediaId:raw.id,takenAt:raw.takenAt,model:raw.model,promptVersion:raw.promptVersion,promptHash,
    assessedAt:raw.assessedAt,source:{variant:'web',mediaRoute:`/api/media/${encodeURIComponent(raw.id)}?variant=web`,width:p?.width,height:p?.height,
      imageSha256:fs.existsSync(imageFile)?digest(fs.readFileSync(imageFile)):undefined},result:raw};
  fs.appendFileSync(ledger,JSON.stringify(row)+'\n');existing.push(row);ids.add(reviewId);added++;
 }
 const taskCalls=path.join(workDir,'calls.jsonl');let calls=0;
 for(const raw of readLines(taskCalls)){const callId=digest(JSON.stringify(raw));if(callIds.has(callId))continue;fs.appendFileSync(callsFile,JSON.stringify({callId,promptHash,promptVersion:CAROUSEL_PROMPT_VERSION,...raw})+'\n');callIds.add(callId);calls++;}
 const old=new Set(readLines(manualFile).map(r=>r.decisionId));
 for(const name of ['visual-review.json','overrides.json','unscored-exclusions.json']){
  const manual=path.join(workDir,name);if(!fs.existsSync(manual))continue;
  const decisions=JSON.parse(fs.readFileSync(manual,'utf8'));
  for(const [mediaId,decision]of Object.entries(decisions)){const decisionId=digest(JSON.stringify({mediaId,decision}));if(!old.has(decisionId)){fs.appendFileSync(manualFile,JSON.stringify({decisionId,mediaId,reviewedAt:new Date().toISOString(),reviewer:'Codex visual review',decision})+'\n');old.add(decisionId);}}
 }
 const latest={};for(const row of existing){const key=`${row.mediaId}|${row.promptVersion}|${row.takenAt}|${row.model}`;if(!latest[key]||row.assessedAt>latest[key].assessedAt)latest[key]={reviewId:row.reviewId,assessedAt:row.assessedAt};}
 fs.writeFileSync(path.join(root,'index.json'),JSON.stringify(latest,null,2));
 fs.writeFileSync(path.join(root,'README.md'),'# 首页回忆照片评分历史\n\n私有资料，不提交 Git、不放到公开网页。\n\n- reviews.jsonl：逐照片原始结构化评分、理由、模型、提示词版本、日期、来源及图像哈希；追加保留旧版本。\n- calls.jsonl：成功和失败调用、用量；失败不能冒充已评分。\n- human-reviews.jsonl：目视审查否决及原因，独立于模型分数。\n- prompts/：每个版本的完整提示词。\n- index.json：可重建的最新结果索引，历史以 JSONL 为准。\n\n同一媒体、拍摄日期、模型与提示词版本的有效评分可复用。媒体内容或规则改变后重评，旧结果不删除。页面缓存只是历史的精简投影，不是唯一记录。\n');
 return {root,added,calls,total:existing.length};
}
if(process.argv[1]&&path.resolve(process.argv[1])===fileURLToPath(import.meta.url))console.log(persistCarouselHistory(process.argv[2]));
