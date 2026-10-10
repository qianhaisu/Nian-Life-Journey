import { MonthDayEntry } from "@/components/month-day-entry";
import type { TimelineDay, TimelineWeek } from "@/lib/month-timeline";

// Every week is present on the initial server render; native anchors work before hydration.
export function MonthTimeline({ year, monthAgeLabel, weeks, entries, highlights = [] }: {
  year: string;
  monthAgeLabel?: string;
  weeks: TimelineWeek[];
  entries: TimelineDay[][];
  highlights?: { day: string; title: string }[];
}) {
  return <>
    {highlights.length > 0 ? <nav className="month-highlights" aria-label="这个月值得再读的日子">
      <p className="section-mark">值得再读</p>
      {highlights.map((item) => <a key={item.day} href={`#day-${item.day}`}>{Number(item.day.slice(8))} 日 · {item.title}</a>)}
    </nav> : null}
    {weeks.length > 1 ? <nav className="month-jump" aria-label="跳到这个月的某一周">
      {weeks.map((week) => <a key={week.id} href={`#${week.id}`}>{week.label}</a>)}
    </nav> : null}
    <section className="month-days month-days--edited" aria-label="这个月">
      {weeks.map((week, index) => <div className="month-week" id={week.id} key={week.id}>
        {weeks.length > 1 ? <p className="week-mark">{week.label}</p> : null}
        <ol>
          {entries[index].map((entry) => <li className="month-day" key={entry.day}>
            <MonthDayEntry entry={entry} year={year} monthAgeLabel={monthAgeLabel} />
          </li>)}
        </ol>
      </div>)}
    </section>
  </>;
}
