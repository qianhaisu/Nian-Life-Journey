// 生成首页回忆播放器用的四首原创背景音乐（2026-09-16）。
//
// 跑法（产物已提交，平时不需要重跑；只有改音乐本身才跑）：
//
//     npm run music:build
//
// 产出：v2/public/audio/memory-{bright,tender,calm,open}.mp3
//
// ─────────────────────────────────────────────────────────────────────────────
// 为什么是自己合成的，而不是找一首歌
// ─────────────────────────────────────────────────────────────────────────────
//
// 用户 2026-09-16 的要求是「音轨要和不同的首页故事内容主题有关，有的欢快有的宁静，
// iPhone 相册回忆就是这么做的」。这需要**一组**风格不同、长度合适、可以随时再加一首的曲子。
//
// 任务书同时钉死了授权：「背景音乐采用有明确网页使用授权的本地音轨或自制原创音轨，记录来源与
// 授权。不要拿 Apple Music 歌曲或临时音频外链直接接入。」
//
// 所以这里的选择是**自制原创**：下面每一个音符都是这段代码算出来的正弦波叠加，没有采样、
// 没有素材库、没有第三方录音。版权干净，来源就是这个文件，改一个数字就是改一遍曲子。
//
//   授权记录：Nianlife 自制原创，2026-09-16，作者 = 本脚本。无第三方素材。
//   编码器：@breezystack/lamejs（LGPL-3.0）**只在构建期用**，产物 mp3 不包含它的任何代码，
//           运行时也不加载它——网站只拿到四个静态 .mp3。
//
// ─────────────────────────────────────────────────────────────────────────────
// 四首曲子为什么不一样
// ─────────────────────────────────────────────────────────────────────────────
//
// 情绪由 lib/home-memory-mood.ts 按**档案里真的记下来的东西**判定（照片节奏 + 已发布标题原文），
// 不是对画面内容的判断。这个文件只负责把四种情绪写成四段声音，彼此的区别是音阶、速度、
// 音区和衰减——不是同一段曲子调个音量。
//
// 共同的底线，四首都守：没有打击乐、没有突起的音头、最后三秒淡出、峰值压在 -12dB 左右。
// 它是放在一段家庭回忆后面的东西，不该抢画面（用户：「照片保持原色」「文字克制」同一个道理）。
import { Mp3Encoder } from "@breezystack/lamejs";
import { mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const SAMPLE_RATE = 44100;
const BITRATE = 96;
// 60 秒：一段回忆最长 12 张 × 5 秒 = 60 秒，曲子刚好盖满最长的一段，短的一段自然淡出收尾。
const SECONDS = 60;
const OUT_DIR = path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "public", "audio");

/** 半音 → 频率（A4 = 440Hz）。用十二平均律算，不写死一张频率表。 */
const note = (semitonesFromA4) => 440 * Math.pow(2, semitonesFromA4 / 12);

/**
 * 四种性格。每一项都是**一句能读懂的音乐决定**，不是随机数：
 *
 *   scale    音阶（相对 A4 的半音）。五声音阶天然不容易难听，也不容易显得"有情绪主张"。
 *   step     每个音之间隔多久（秒）。慢 = 安静，快 = 明亮。
 *   decay    每个音衰减多快。衰减慢 = 余音长 = 开阔。
 *   voices   同时叠几个八度，制造厚度。
 *   gain     总音量，四首听感拉平。
 */
const MOODS = {
  // 明亮：大调五声，走得快，音区偏高，衰减快——像有人在旁边轻轻弹着玩。
  bright: { scale: [4, 6, 9, 11, 16, 18, 21], step: 1.05, decay: 1.5, voices: 2, gain: 0.17, detune: 0.4 },
  // 温柔：大调五声但低一个八度，中速，衰减适中。这是默认那一首，普通的一天用它。
  tender: { scale: [-8, -6, -3, -1, 4, 6, 9], step: 1.9, decay: 1.0, voices: 2, gain: 0.16, detune: 0.3 },
  // 安静：小调色彩，很慢，低音区，余音长——放在晚上拍的那一段后面。
  calm: { scale: [-12, -9, -7, -5, -2, 0, 3], step: 3.2, decay: 0.55, voices: 3, gain: 0.15, detune: 0.2 },
  // 开阔：四度五度的宽音程，中速，余音最长——出门一整天的那种空间感。
  open: { scale: [-5, 0, 2, 7, 12, 14, 19], step: 2.3, decay: 0.7, voices: 3, gain: 0.155, detune: 0.5 },
};

/**
 * 一个音：正弦基频 + 一点点二次谐波（让它不像测试音），指数衰减包络，起音 40ms 淡入。
 *
 * 40ms 的起音是必须的：直接从 0 跳到峰值会产生一个"咔"的爆音，在手机小喇叭上尤其明显。
 */
function voice(buffer, startSample, freq, decay, amp, detune) {
  const length = Math.min(buffer.length - startSample, Math.floor(SAMPLE_RATE * (6 / decay)));
  if (length <= 0) return;
  const attack = Math.floor(SAMPLE_RATE * 0.04);
  for (let i = 0; i < length; i += 1) {
    const t = i / SAMPLE_RATE;
    const env = Math.min(1, i / attack) * Math.exp(-t * decay);
    // 「衰减到听不见就提前收工」这条**只能在起音爬完之后**判。
    // 2026-09-16 第一版写成无条件判断，结果是：第 0 个采样点的起音系数正好是 0，
    // env=0 < 阈值，每一个音都在第一个采样点上 break——四首曲子全是**纯静音**，
    // 而且因为静音压缩率一样，四个 mp3 字节数一模一样（720,353），看起来还很"正常"。
    // 这正是任务书说的「不能用按钮和假曲名冒充音乐已交付」，所以这条边界写死在这里。
    if (i > attack && env < 0.0005) break;
    // 轻微失谐的第二个振子：两条正弦之间的拍频让音色有一点"活"的感觉，不是死板的电子音。
    const a = Math.sin(2 * Math.PI * freq * t);
    const b = Math.sin(2 * Math.PI * (freq + detune) * t);
    const harmonic = Math.sin(2 * Math.PI * freq * 2 * t) * 0.12;
    buffer[startSample + i] += (a * 0.5 + b * 0.5 + harmonic) * env * amp;
  }
}

/** 一首曲子：沿时间轴撒音符，音高在音阶里做一个缓慢的上下往复，不是随机游走。 */
function render(spec) {
  const total = SAMPLE_RATE * SECONDS;
  const buffer = new Float32Array(total);
  const { scale, step, decay, voices, gain, detune } = spec;

  let index = 0;
  for (let t = 0; t < SECONDS; t += step) {
    // 三角波形的索引走法：在音阶里上行再下行，听起来像一句话，而不是一串无关的音。
    const period = scale.length * 2 - 2;
    const pos = index % period;
    const degree = pos < scale.length ? pos : period - pos;
    const start = Math.floor(t * SAMPLE_RATE);
    for (let v = 0; v < voices; v += 1) {
      // 每个声部差一个八度，音量递减，叠出厚度而不是叠出响度。
      voice(buffer, start, note(scale[degree] + v * 12), decay, gain / (v + 1.6), detune);
    }
    // 每隔几个音补一个低八度的根音，给曲子一个落脚点。
    if (index % 4 === 0) voice(buffer, start, note(scale[0] - 12), decay * 0.55, gain * 0.5, detune * 0.5);
    index += 1;
  }

  // 整体淡入淡出：开头 1.5 秒，结尾 3 秒。结尾长一些，因为播放结束时要"自然停住"。
  const fadeIn = SAMPLE_RATE * 1.5;
  const fadeOut = SAMPLE_RATE * 3;
  let peak = 0;
  for (let i = 0; i < total; i += 1) {
    const inGain = Math.min(1, i / fadeIn);
    const outGain = Math.min(1, (total - i) / fadeOut);
    buffer[i] *= inGain * outGain;
    const abs = Math.abs(buffer[i]);
    if (abs > peak) peak = abs;
  }
  // 归一化到 -12dBFS。四首听感一致，而且留足余量，不会在手机上削顶。
  const target = Math.pow(10, -12 / 20);
  const scaleBy = peak > 0 ? target / peak : 1;
  const pcm = new Int16Array(total);
  for (let i = 0; i < total; i += 1) {
    pcm[i] = Math.max(-1, Math.min(1, buffer[i] * scaleBy)) * 32767;
  }
  return { pcm, peak: peak * scaleBy };
}

function encode(pcm) {
  const encoder = new Mp3Encoder(1, SAMPLE_RATE, BITRATE);
  const chunks = [];
  for (let i = 0; i < pcm.length; i += 1152) {
    const chunk = encoder.encodeBuffer(pcm.subarray(i, i + 1152));
    if (chunk.length) chunks.push(Buffer.from(chunk));
  }
  const tail = encoder.flush();
  if (tail.length) chunks.push(Buffer.from(tail));
  return Buffer.concat(chunks);
}

mkdirSync(OUT_DIR, { recursive: true });
let totalBytes = 0;
for (const [mood, spec] of Object.entries(MOODS)) {
  const { pcm, peak } = render(spec);
  const mp3 = encode(pcm);
  const file = path.join(OUT_DIR, `memory-${mood}.mp3`);
  writeFileSync(file, mp3);
  totalBytes += mp3.length;
  console.log(
    `${mood.padEnd(7)} ${String(Math.round(mp3.length / 1024)).padStart(4)} KB  `
    + `${SECONDS}s  peak=${peak.toFixed(3)}  step=${spec.step}s  voices=${spec.voices}`,
  );
}
console.log(`\n共 ${(totalBytes / 1048576).toFixed(2)} MB，写入 ${OUT_DIR}`);
console.log("授权：Nianlife 自制原创（本脚本合成），无第三方素材。");
