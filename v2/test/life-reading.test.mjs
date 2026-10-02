import test from 'node:test';import assert from 'node:assert/strict';
import {growthThreads,personMatches,READING_PEOPLE,searchArchive,searchTerms,quotesIn,buildYearBook,selectReadingPhotos} from '../lib/life-reading.ts';
const day=(date,text,extra={})=>({day:date,title:'那一天',href:'/memory/'+date.replaceAll('-','/'),ageLabel:'1 岁',paragraphs:[text],photos:[],milestone:null,lead:false,...extra});
const photo=(id,key)=>({id,type:'photo',src:'/api/media/'+id,alt:'已审核照片',displayKey:key});

test('成长线串起不同月份的原文，保留尝试、否定与日期，不制造第一次',()=>{
 const entries=[day('2026-09-04','他会说「打开」了。'),day('2025-08-02','他试着喊妈妈，还不清楚。'),day('2026-03-12','他说「倒」。'),day('2024-12-01','妈妈说宝宝以后会喊妈妈。')];
 const thread=growthThreads(entries,'2025-01-03').find(t=>t.id==='words');
 assert.deepEqual(thread.anchors.map(m=>m.entry.day),['2025-08-02','2026-03-12','2026-09-04']);
 assert.equal(thread.anchors[0].excerpt,'他试着喊妈妈，还不清楚。');
 assert.equal(growthThreads(entries).length,0,'出生日期未知时不把成人或孕期话语当作成长');
});
test('行动各自成线，单条记录没有虚假的中间与最近节点，重复段落保留原资料不重复展出',()=>{
 const entries=[day('2026-01-01','他自己吃饭，握着勺子试了试。'),day('2026-01-02','他自己吃饭，握着勺子试了试。'),day('2026-02-01','他自己走了一小段。'),day('2026-03-01','他坐了小马桶。')];
 const threads=growthThreads(entries,'2025-01-03');
 assert.equal(threads.find(t=>t.id==='eating').anchors.length,1);
 assert.equal(threads.find(t=>t.id==='walking').matches[0].entry.day,'2026-02-01');
 assert.equal(threads.find(t=>t.id==='toileting').matches[0].entry.day,'2026-03-01');
 assert.equal(entries.length,4);
});
test('人物仅从明确文字归类，提到与在场区分；妈妈名字合并，老师作为群体',()=>{
 const entries=[day('2026-01-01','外公在群里说「真可爱」。'),day('2026-01-02','今天去公园。',{photos:[photo('grandpa-looking')]}),day('2026-01-03','苏静抱着他看书。'),day('2026-01-04','妈妈说下周再去。'),day('2026-01-05','大兵老师陪他玩球。')];
 assert.deepEqual(personMatches(entries,READING_PEOPLE.find(p=>p.id==='maternal-grandfather')).map(m=>m.entry.day),['2026-01-01']);
 assert.equal(personMatches(entries,READING_PEOPLE.find(p=>p.id==='mother')).length,2);
 assert.equal(personMatches(entries,READING_PEOPLE.find(p=>p.id==='teachers')).length,1);
});
test('问题检索匹配原话、人物别名及自己进食表达，按最早记录排序，组合条件全部成立',()=>{
 const entries=[day('2026-09-02','他说「打开」，妈妈笑了。'),day('2026-03-01','妈妈说「打开」，他还没有说。'),day('2026-05-01','他自己拿勺子吃饭。'),day('2026-06-01','苏静带他到温州。'),day('2026-06-02','爸爸去了温州。')];
 assert.deepEqual(searchArchive(entries,'第一次说打开').map(m=>m.entry.day),['2026-09-02'],'问孩子第一次说某词，不匹配大人的话和否定记录');
 assert.equal(searchArchive(entries,'什么时候开始自己吃饭')[0].entry.day,'2026-05-01');
 assert.equal(searchArchive(entries,'妈妈 温州')[0].entry.day,'2026-06-01');
 assert.equal(searchArchive(entries,'妈妈 月球').length,0);
 assert.deepEqual(searchTerms('的和'),[]);
});
test('引语只能从真实引号里摘出，不把描述或归属猜成原话',()=>{
 assert.deepEqual(quotesIn('他说「打开」，后来喊“妈妈”。'),['打开','妈妈']);
 assert.deepEqual(quotesIn('外公觉得他会说打开了。'),[]);
 assert.deepEqual(quotesIn('「打开」「打开」'),['打开']);
});
test('年度书只收该年，章节按月份连续，重要记录优先，同文件照片跨章不重放且不动原文',()=>{
 const jan=day('2025-01-03','他出生了。',{milestone:{kind:'birth',badge:'出生'},photos:[photo('a','same')]});
 const feb=day('2025-02-04','外婆抱着他。',{photos:[photo('alias','same'),photo('b','other')]});
 const book=buildYearBook('2025',[{month:'2025-02',intro:'二月的回顾。',entries:[feb]},{month:'2024-12',entries:[day('2024-12-01','过去。')]},{month:'2025-01',intro:'一月的回顾。',entries:[jan]}],'2025-01-03','2026-10-02');
 assert.deepEqual(book.chapters.map(c=>c.month),['2025-01','2025-02']);
 assert.deepEqual(book.chapters.flatMap(c=>c.photos.map(p=>p.media.id)),['a','b']);
 assert.equal(book.ongoing,false);assert.match(book.ageLabel,/出生的那天/);assert.equal(book.intro,'一月的回顾。');assert.equal(feb.photos.length,2);
 assert.equal(buildYearBook('2026',[],'2025-01-03','2026-10-02').ongoing,true);
});

test('不把对孩子说话、爬行垫、教案、建议或远程评论变成成长及共同出行',()=>{
 const entries=[day('2026-01-01','妈妈看着他说「打开」。'),day('2026-01-02','他坐在白色爬行垫上。'),day('2026-01-03','外公说「现在他需要与他多沟通，唱儿歌」。'),day('2026-01-04','老师写的主题是「好玩的滑板车」，目标是锻炼宝宝。'),day('2026-01-05','外公说「今天天气好带小年去大自然玩挺好的」。'),day('2026-01-06','外公带他去了江边。')];
 assert.equal(growthThreads(entries,'2025-01-03').length,0);
 assert.equal(searchArchive(entries,'第一次说打开').length,0);
 assert.deepEqual(searchArchive(entries,'和外公去过哪里').map(m=>m.entry.day),['2026-01-06']);
});

test('年度书优先沿用本月已审核封面、分配不同日子，并跨章剔除已有同场景标注',()=>{
 const a=day('2025-01-03','他出生了。',{photos:[photo('a','file-a'),photo('cover','file-cover')]});
 const b=day('2025-01-05','他回家了。',{photos:[photo('b','file-b')]});
 const c=day('2025-02-03','后来。',{photos:[photo('scene-alias','file-c'),photo('different','file-d')]});
 const book=buildYearBook('2025',[{month:'2025-01',pinnedPhotoId:'cover',entries:[a,b]},{month:'2025-02',entries:[c]}],'2025-01-03','2026-10-02',{sceneKey:p=>['cover','scene-alias'].includes(p.id)?'known-scene':undefined});
 assert.deepEqual(book.chapters[0].photos.map(p=>p.media.id),['cover','b']);
 assert.deepEqual(book.chapters[1].photos.map(p=>p.media.id),['different']);
 assert.equal(a.photos.length,2);
});

test('不会把替孩子配的内心独白、妈妈喂饭、推车装饰或水面当成成长',()=>{
 const entries=[day('2026-01-01','雪姨替他说了一句：「今天好开心」。'),day('2026-01-02','妈妈担心自己给他喂不好。'),day('2026-01-03','他坐在挂满彩色玩具的推车里。'),day('2026-01-04','他坐在船舱里，手搭着窗框，窗外是水面。')];
 assert.equal(growthThreads(entries,'2025-01-03').length,0);
});

test('出生前、出生跨年的生命时间有真实上下文；未知生日不猜年龄',()=>{
 const before=day('2025-01-01','还在等见面。');const after=day('2025-12-31','后来。');
 const book=buildYearBook('2025',[{month:'2025-01',entries:[before]},{month:'2025-12',entries:[after]}],'2025-01-03','2026-10-02');
 assert.equal(book.ageLabel,'出生前 到 11 个月');
 assert.equal(buildYearBook('2025',[{month:'2025-01',entries:[before]}],undefined,'2026-10-02').ageLabel,undefined);
});

test('老师转述孩子的新词保留原文，不漏掉自己说倒与刚刚说打开',()=>{
 const entries=[day('2026-09-08','老师说他「全部倒出来，自己说倒」。'),day('2026-09-09','老师说：「宝贝刚刚说，打开…」，又说「没很标准」。')];
 assert.deepEqual(growthThreads(entries,'2025-01-03').find(t=>t.id==='words').matches.map(m=>m.entry.day),['2026-09-08','2026-09-09']);
});

test('成人叙述的他不成为开口节点，真实翻身尝试进入行动线',()=>{
 const entries=[day('2026-01-01','他说没力气给孩子换了。'),day('2025-03-01','他开始自己翻身了。')];
 const threads=growthThreads(entries,'2025-01-03');assert.equal(threads.some(t=>t.id==='words'),false);assert.equal(threads.find(t=>t.id==='walking').matches[0].entry.day,'2025-03-01');
});

test('同一句里的成人引语不串到孩子的说词检索结果',()=>{
 const entries=[day('2026-01-01','他说「ball」，妈妈说「打开」。'),day('2026-01-02','妈妈说他现在会说ball，「ball很会说」。')];
 assert.equal(searchArchive(entries,'第一次说打开').length,0);assert.deepEqual(searchArchive(entries,'第一次说ball').map(m=>m.entry.day),['2026-01-01','2026-01-02']);
});

test('成长和人物页面的日子配图也跨段去重，不重复同文件或已知场景',()=>{
 const entries=[day('2026-01-01','他玩了。',{photos:[photo('a','same')]}),day('2026-01-02','后来。',{photos:[photo('alias','same'),photo('scene-alias','other'),photo('different','last')]}),day('2026-01-03','又一天。',{photos:[photo('again','same')]})];
 assert.deepEqual(selectReadingPhotos(entries,p=>['a','scene-alias'].includes(p.id)?'known-scene':undefined).map(p=>p?.id),['a','different',undefined]);assert.equal(entries[1].photos.length,3);
});
