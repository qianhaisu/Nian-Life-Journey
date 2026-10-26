// Bounded offline/nightly scoring. Explicit candidate manifest, resumable receipts, no DB writes.
import fs from 'node:fs';
import path from 'node:path';
import sharp from 'sharp';
import {createHash} from 'node:crypto';
import {CAROUSEL_PROMPT,CAROUSEL_PROMPT_VERSION,parsePartialCarouselScores} from './home-carousel-score.mjs';
const GLM_MODEL=process.env.AI_MODEL??'deepseek-flash';const DS_BASE=(process.env.DEEPSEEK_BASE_URL??'https://api.deepseek.com/anthropic').replace(/\/$/,'');
import {persistCarouselHistory,restoreCarouselScores} from './home-carousel-history.mjs';
const args=process.argv.slice(2),flag=(k,d)=>args.includes(k)?args[args.indexOf(k)+1]:d;
const manifest=flag('--manifest'),dir=flag('--work-dir');
if(!manifest||!dir)throw new Error('Pass --manifest and --work-dir; offline/nightly use only');
const candidates=JSON.parse(fs.readFileSync(manifest,'utf8'));
const env={...process.env};for(const line of fs.readFileSync('.env.local','utf8').split(/\r?\n/)){const m=line.match(/^([A-Z_]+)=(.*)$/);if(m&&!env[m[1]])env[m[1]]=m[2].replace(/^["']|["']$/g,'');}
if(!env.DEEPSEEK_API_KEY)throw new Error('missing DEEPSEEK_API_KEY');if(GLM_MODEL!=='deepseek-flash')throw new Error('only deepseek-flash is allowed for this scorer');
fs.mkdirSync(path.join(dir,'images'),{recursive:true});fs.mkdirSync(path.join(dir,'scores'),{recursive:true});
console.log(JSON.stringify({restoredFromHistory:restoreCarouselScores(candidates,dir)}));
const hash=id=>createHash('sha256').update(id).digest('hex');
const scoreFile=id=>path.join(dir,'scores',hash(id)+'.json');
const todo=candidates.filter(p=>{
 try {const old=JSON.parse(fs.readFileSync(scoreFile(p.id),'utf8'));return old.promptVersion!==CAROUSEL_PROMPT_VERSION||old.takenAt!==p.takenAt;}
 catch{return true;}
});
const limit=Number(flag('--limit',todo.length));const queue=todo.slice(0,limit);let cursor=0,done=0,failed=0,streak=0,stopped=false;
const receipts=path.join(dir,'calls.jsonl');
const batchSize=Math.min(6,Math.max(1,Number(flag('--batch-size','6'))));
async function imageFor(p){
 const file=path.join(dir,'images',hash(p.id)+'.webp');
 if(!fs.existsSync(file)){const r=await fetch(`https://nianlife.cn/api/media/${encodeURIComponent(p.id)}?variant=web`,{signal:AbortSignal.timeout(60000)});if(!r.ok)throw new Error(`image HTTP ${r.status}`);fs.writeFileSync(file,Buffer.from(await r.arrayBuffer()));}
 return sharp(fs.readFileSync(file)).rotate().resize({width:1024,height:1024,fit:'inside',withoutEnlargement:true}).jpeg({quality:88}).toBuffer();
}
async function worker(){
 while(!stopped&&cursor<queue.length){const batch=queue.slice(cursor,cursor+=batchSize);const started=new Date().toISOString();let responseText,responseModel,usage;
 try{
 const images=await Promise.all(batch.map(imageFor));
 const content=[{type:'text',text:CAROUSEL_PROMPT},...batch.flatMap((p,i)=>[{type:'text',text:`id=${i}; 拍摄日期=${p.takenAt?.slice(0,10)}`},{type:'image',source:{type:'base64',media_type:'image/jpeg',data:images[i].toString('base64')}}])];
 const res=await fetch(`${DS_BASE}/v1/messages`,{method:'POST',headers:{'content-type':'application/json','x-api-key':env.DEEPSEEK_API_KEY,'anthropic-version':'2023-06-01'},body:JSON.stringify({model:GLM_MODEL,max_tokens:12000,messages:[{role:'user',content}]}),signal:AbortSignal.timeout(300000)});
 if(!res.ok){const t=await res.text();throw new Error(`DeepSeek HTTP ${res.status} ${t.slice(0,120).replace(/sk-[A-Za-z0-9_-]+/g,'[REDACTED]')}`);}const body=await res.json();if(body.model&&body.model!==GLM_MODEL)throw new Error('model mismatch');
 if(body.stop_reason==='max_tokens')throw new Error('truncated');
 responseText=(body.content??[]).filter(b=>b.type==='text').map(b=>b.text).join(String.fromCharCode(10)).trim();
 responseModel=GLM_MODEL;usage=body.usage;
 const rows=parsePartialCarouselScores(responseText,batch.map((_,i)=>String(i)));
 for(const row of rows){const i=Number(row.id);
  const p=batch[i],out=scoreFile(p.id),tmp=out+'.tmp';
  fs.writeFileSync(tmp,JSON.stringify({...row,id:p.id,takenAt:p.takenAt,model:GLM_MODEL,inputImageSha256:createHash('sha256').update(images[i]).digest('hex'),promptVersion:CAROUSEL_PROMPT_VERSION,assessedAt:new Date().toISOString()},null,2));
  fs.renameSync(tmp,out);
 }
 fs.appendFileSync(receipts,JSON.stringify({started,model:GLM_MODEL,ids:batch.map(p=>p.id),usage:usage,ok:rows.length===batch.length,scoredIds:rows.map(r=>batch[Number(r.id)].id),responseText})+'\n');done+=rows.length;failed+=batch.length-rows.length;streak=rows.length?0:streak+1;if(streak>=3)stopped=true;console.log(JSON.stringify({done,remaining:queue.length-done-failed,failed}));
 }catch(e){failed+=batch.length;streak++;fs.appendFileSync(receipts,JSON.stringify({started,model:responseModel,ids:batch.map(p=>p.id),ok:false,error:e.message,responseText,usage})+'\n');console.log(JSON.stringify({failed,error:e.message}));if(streak>=3)stopped=true;}
 }
}
console.log(JSON.stringify({model:GLM_MODEL,version:CAROUSEL_PROMPT_VERSION,total:candidates.length,pending:queue.length}));
await Promise.all(Array.from({length:Math.min(12,Math.max(1,Number(flag('--concurrency','6'))))},worker));
console.log(persistCarouselHistory(dir));
console.log(JSON.stringify({done,failed,stopped}));if(failed||stopped)process.exitCode=1;
