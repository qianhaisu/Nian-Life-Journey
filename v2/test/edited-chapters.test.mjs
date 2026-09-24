import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { withEditedChapters, contentOnlyChapter } from '../lib/edited-chapters.ts';
import { buildMonthTimeline } from '../lib/month-timeline.ts';
import { invalidateMonthContent } from '../lib/month-content.ts';
import { passesCoverRules } from '../scripts/editor/cover-rules.mjs';
import { prenatalStoryForFamily } from '../lib/prenatal-story.ts';
import { validateDayText } from '../scripts/editor/validate-day.mjs';

test('prenatal labels change only the reading copy and nationality is not a blanket veto', () => {
  const source={occurredAt:'2024-11-06T02:00:00Z',title:'一段话',story:'苏静说，Ted 回了一句。',storySections:['Ted 说']};
  const shown=prenatalStoryForFamily(source);
  assert.equal(shown.story,'妈妈说，爸爸 回了一句。');assert.equal(source.story,'苏静说，Ted 回了一句。');
  const result=validateDayText({title:'国籍办理',paragraphs:['聊到了国籍办理。']},[]);
  assert.equal(result.errors.some(e=>e.includes('证件与身份办理')),false);
});

test('content-only prenatal month appears once, excluded months leave navigation', () => {
  const before = [{year:'2024',months:['2024-05','2024-06'].map(m=>contentOnlyChapter(m,'2025-01-03'))}];
  const contents = [{month:'2024-08',days:[{}]},{month:'2024-06',days:[{}]},{month:'2024-07',days:[]}];
  const result=withEditedChapters(before,contents,'2025-01-03');
  assert.deepEqual(result[0].months.map(m=>m.month),['2024-08','2024-06']);
  assert.equal(result[0].months[0].ageLabel,'出生前 5 个月');
  assert.equal(before[0].months.length,2);
});

test('timeline and later-week API keep edited days without a database chapter', async () => {
  const dir=await fs.mkdtemp(path.join(os.tmpdir(),'edited-month-'));
  const old=process.env.MONTH_CONTENT_DIR;process.env.MONTH_CONTENT_DIR=dir;invalidateMonthContent();
  try {
    await fs.writeFile(path.join(dir,'2024-08.json'),JSON.stringify({schema:'nianlife.month-content/1',month:'2024-08',days:[16,27].map(day=>({day:`2024-08-${day}`,kind:'text-only',title:'一段原话',paragraphs:['有来源的记录。'],firstScreenMediaIds:[],expandedMediaIds:[]}))}));
    const timeline=await buildMonthTimeline({chapters:[],media:[],eventIdentities:[],privilege:{confirmed:new Set(),trusted:new Set()},traceEvents:[],birthDay:'2025-01-03'},'2024','08');
    assert.equal(timeline.stats.contentDays,2);assert.equal(timeline.weeks.length,2);assert.equal(timeline.order,'asc');
    assert.deepEqual([...timeline.byDay.keys()],['2024-08-16','2024-08-27']);
  } finally {if(old===undefined)delete process.env.MONTH_CONTENT_DIR;else process.env.MONTH_CONTENT_DIR=old;invalidateMonthContent();await fs.rm(dir,{recursive:true,force:true});}
});

test('cover hard conditions cannot be outvoted by a high score', () => {
  const good={childMain:true,adultFace:false,otherChild:false,faceHeightRatio:0.2,frontalOrThreeQuarter:true,eyesOpen:true,sharp:true,bright:true,unobstructed:true,sensitive:false,score:100};
  assert.equal(passesCoverRules(good),true);
  for(const bad of [{faceHeightRatio:0.19},{eyesOpen:false},{adultFace:true},{otherChild:true},{sharp:false},{sensitive:true},{unobstructed:false}]) assert.equal(passesCoverRules({...good,...bad}),false);
});
