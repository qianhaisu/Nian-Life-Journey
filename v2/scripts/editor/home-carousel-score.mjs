// Nightly/offline only. No imports from the page-rendering dependency graph.
export const CAROUSEL_PROMPT_VERSION = 'home-carousel-v4';
export const CAROUSEL_THEMES = ['water','sleep','laugh','eat','outdoor','toy','hold','spring','summer','autumn','winter'];
export const CAROUSEL_PROMPT = `为张年的首页回忆选图。每张图独立判断，只依据真实画面，不依据旧标签或文件名猜测。输入日期是实际拍摄日期。
三条原则：
1 主题必须看得见。water=孩子真的游泳或喷水戏水，岸边、空泳池、洗澡不算；sleep=真的睡着，闭眼打哈欠不算；laugh=自然笑；eat=正在吃饭；outdoor=户外活动；toy=正在玩玩具；hold=被家人抱着。允许一张匹配多个主题。
季节同时核对拍摄日期和画面：春3-5月，夏6-8月，秋9-11月，冬12-2月（冬天跨年）。冬需厚衣、雪、室内取暖等；夏需短袖、玩水、户外阳光等；春秋需对应衣着、植被/落叶等可见线索。不能仅因日期正确就给高分，普通室内照片看不出季节一律低分。
2 张年是画面主体，脸清楚完整，光线足够，无失焦/动态拖影/遮挡。截图、文字图、他很小的合影、背影、被切脸、裸露私密部位、医疗单据、无关第三方主体均不合格。睡觉可以闭眼；其他主题闭眼明显不自然则不合格。不要用背景清楚代替脸清楚。表情评价自然程度，不评价长相或推测心情。
3 每段最终至少8张不同场景合格照。不足必须扩大日期/场景候选，仍不足则下线，不允许抬分凑数。
每张输出三个0-100分维度：matches(每个主题的主题匹配分)、clarity(脸部清晰和光线)、expression(表情自然)。另明确布尔 qualified(满足全部质量/隐私要求)、eyesOpen、sleeping、childMain、faceClear、faceUnblocked、motionBlur、sensitive；scene用简短可区分的衣服+环境描述；why一句依据。所有键必填。主题80分以上必须有明确可见依据，清晰度80以上必须五官清楚。
只输出JSON数组，顺序与输入一致：[{"id":"输入id","matches":{"water":0,"sleep":0,"laugh":0,"eat":0,"outdoor":0,"toy":0,"hold":0,"spring":0,"summer":0,"autumn":0,"winter":0},"clarity":0,"expression":0,"qualified":false,"eyesOpen":false,"sleeping":false,"childMain":false,"faceClear":false,"faceUnblocked":false,"motionBlur":false,"sensitive":false,"scene":"","why":""}]`;

function scoreArray(text) {
  // Read one complete JSON array, allowing a Markdown fence or trailing explanation.
  // Never repair missing fields, numbers or missing photos.
  const start=text.indexOf('[');let end=-1,depth=0,quoted=false,escaped=false;
  for(let i=start;i>=0&&i<text.length;i++){
    const ch=text[i];if(quoted){if(escaped)escaped=false;else if(ch==='\\')escaped=true;else if(ch==='"')quoted=false;continue;}
    if(ch==='"')quoted=true;else if(ch==='[')depth++;else if(ch===']'&&--depth===0){end=i+1;break;}
  }
  if(end<0)throw new Error('missing score array');
  return JSON.parse(text.slice(start,end));
}

export function parseCarouselScores(text, ids) {
  const raw=scoreArray(text);
  if(!Array.isArray(raw)||raw.length!==ids.length)throw new Error('score batch shape');
  const score=n=>typeof n==='number'&&Number.isFinite(n)&&n>=0&&n<=100;
  return ids.map(id=>{
    const r=raw.find(x=>String(x.id)===id);
    if(!r||!CAROUSEL_THEMES.every(k=>score(r.matches?.[k]))||!score(r.clarity)||!score(r.expression)
      ||!['qualified','eyesOpen','sleeping','childMain','faceClear','faceUnblocked','motionBlur','sensitive'].every(k=>typeof r[k]==='boolean')
      ||typeof r.scene!=='string'||typeof r.why!=='string')throw new Error('incomplete score');
    return r;
  });
}

export function parsePartialCarouselScores(text,ids) {
 const raw=scoreArray(text);if(!Array.isArray(raw))throw new Error('score batch shape');
 const results=[];
 for(const id of ids){const matches=raw.filter(r=>String(r.id)===id);if(matches.length!==1)continue;
  try{results.push(...parseCarouselScores(JSON.stringify(matches),[id]));}catch{/* Leave incomplete photos unscored. */}
 }
 return results;
}
