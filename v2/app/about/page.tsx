import Link from "next/link";
import { GrowthChart } from "@/components/growth-chart";
import { SleepJourneyTrend } from "@/components/sleep-journey-trend";
import { careEpisodes, careRecords, currentPortrait, events, growthRecords, profile, sleepJourney } from "@/lib/mock-data";

function ageLabel() { return "1 岁 7 个月"; }

export default function AboutPage() {
  const episode = careEpisodes[0];
  const episodeRecords = episode.recordIds.map((id) => careRecords.find((record) => record.id === id)).filter((record): record is NonNullable<typeof record> => Boolean(record));
  return <div className="about-page">
    <header className="about-masthead wide-wrap"><span className="section-mark">现在</span><h1 className="serif">关于张年</h1><p>身体、语言、睡眠，还有那些正在慢慢变化的事。</p></header>
    <section className="portrait-section wide-wrap" aria-labelledby="portrait-title"><div className="portrait-facts"><span className="section-mark">现在的张年</span><h2 id="portrait-title" className="serif">{ageLabel()}</h2><p>出生于 {profile.birthDate.replaceAll("-", ".")}</p><div><strong>86 <small>cm</small></strong><strong>12.1 <small>kg</small></strong></div></div><div className="portrait-notes">{currentPortrait.map((item) => <article key={item.label}><h3>{item.label}{item.private ? <span>仅家庭可见</span> : null}</h3><p>{item.summary}</p></article>)}</div></section>
    <section className="growth-section reading-wrap" aria-labelledby="growth-title"><div className="section-heading"><span className="section-mark">成长</span><h2 id="growth-title" className="serif">最近量到的身高和体重</h2><p>数字是测量，变化还在每天的日子里。</p></div><div className="chart-pair"><GrowthChart records={growthRecords} kind="height" title="身高" /><GrowthChart records={growthRecords} kind="weight" title="体重" /></div><div className="development-paths">{(["language", "motor"] as const).map((kind) => <article key={kind}><h3 className="serif">{kind === "language" ? "最近会说的话" : "最近学会的动作"}</h3><ol>{growthRecords.filter((record) => record.kind === kind).sort((a, b) => a.observedAt.localeCompare(b.observedAt)).map((record) => <li key={record.id}><time>{record.observedAt.slice(0, 7).replace("-", ".")}</time><p>{record.note}</p>{record.lifeEventId ? <Link href={`/events/${record.lifeEventId}`}>回到那一天 ↗</Link> : null}</li>)}</ol></article>)}</div></section>
    <section className="sleep-section wide-wrap" aria-labelledby="sleep-title"><div className="section-heading"><span className="section-mark">睡眠记录 · 仅家庭可见</span><h2 id="sleep-title" className="serif">从夜里醒来，<br />到慢慢自己睡着</h2><p>这是家里一路看着的变化，不是医疗监测。</p></div><SleepJourneyTrend phases={sleepJourney} /></section>
    <section className="care-section reading-wrap" aria-labelledby="care-title"><div className="section-heading"><span className="section-mark">健康与关注 · 默认私密</span><h2 id="care-title" className="serif">需要被照顾的事，<br />也保留来路</h2><p>这里只做家庭观察与历史归档，不给出自动诊断。</p></div><div className="care-ledger">{careRecords.filter((record) => !record.careEpisodeId).map((record) => <article key={record.id}><span>{record.status}</span><h3>{record.title}</h3><p>{record.note}</p>{record.nextStep ? <small>{record.nextStep}</small> : null}</article>)}</div><details className="care-episode"><summary><span>{episode.startedAt.slice(5).replace("-", ".")}—{episode.endedAt?.slice(5).replace("-", ".")}</span><strong>{episode.title}</strong><small>查看受控整理示例</small></summary><ol>{episodeRecords.map((record) => <li key={record.id}><time>{record.observedAt.slice(8)}</time><div><strong>{record.title}</strong><p>{record.note}</p></div></li>)}</ol><p>医疗原始文档永久保留；提取内容需要爸爸妈妈确认。</p></details></section>
  </div>;
}
