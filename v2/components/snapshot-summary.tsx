// Renders a monthly_snapshot.summary as a bulleted list. The A-track writer produces the summary
// as newline-separated "- " prefixed lines; this component strips the prefix and renders each line
// as a <li>. Every surface that shows a snapshot summary must go through here so the format is
// consistent wherever the family reads it.
//
// When icons={true}, each line gets a small inline SVG icon chosen by keyword match.
// Used only on the home page "最近的新变化" section.

const SAGE = '#9EAB92';
const CLAY = '#C2A88A';
const APRICOT = '#D4A893';

function LanguageIcon() {
  return <svg width="16" height="16" viewBox="0 0 16 16" fill="none" aria-hidden="true">
    <path d="M3 4.5C3 3.4 3.9 2.5 5 2.5H11C12.1 2.5 13 3.4 13 4.5V8.5C13 9.6 12.1 10.5 11 10.5H8.5L5.5 13V10.5H5C3.9 10.5 3 9.6 3 8.5V4.5Z" stroke={SAGE} strokeWidth="1.4" strokeLinejoin="round"/>
  </svg>;
}
function ActionIcon() {
  return <svg width="16" height="16" viewBox="0 0 16 16" fill="none" aria-hidden="true">
    <circle cx="8" cy="3" r="1.5" stroke={CLAY} strokeWidth="1.4"/>
    <path d="M8 4.5V9M5.5 6.5L10.5 6M8 9L5.5 13.5M8 9L10.5 12" stroke={CLAY} strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round"/>
  </svg>;
}
function InterestIcon() {
  return <svg width="16" height="16" viewBox="0 0 16 16" fill="none" aria-hidden="true">
    <path d="M2 4C4.5 3 6.5 3.5 8 5C9.5 3.5 11.5 3 14 4V12C11.5 11 9.5 11.5 8 13C6.5 11.5 4.5 11 2 12V4Z" stroke={SAGE} strokeWidth="1.4" strokeLinejoin="round"/>
    <path d="M8 5V13" stroke={SAGE} strokeWidth="1.4" strokeLinecap="round"/>
  </svg>;
}
function RestIcon() {
  return <svg width="16" height="16" viewBox="0 0 16 16" fill="none" aria-hidden="true">
    <path d="M12 4C12 4 10 3 8 4.5C6 6 5.5 8.5 6.5 10.5C7.5 12.5 10 13 12 11.5C9.5 12 7.5 10.5 7 8.5C6.5 6.5 7.5 5 12 4Z" stroke={APRICOT} strokeWidth="1.4" strokeLinejoin="round"/>
  </svg>;
}
function SocialIcon() {
  return <svg width="16" height="16" viewBox="0 0 16 16" fill="none" aria-hidden="true">
    <circle cx="5.5" cy="4.5" r="1.8" stroke={CLAY} strokeWidth="1.4"/>
    <path d="M1.5 14C1.5 11.5 3.3 9.5 5.5 9.5" stroke={CLAY} strokeWidth="1.4" strokeLinecap="round"/>
    <circle cx="11" cy="5" r="1.5" stroke={CLAY} strokeWidth="1.4"/>
    <path d="M7.5 14C7.5 11.5 9.1 9.8 11 9.8C12.9 9.8 14.5 11.5 14.5 14" stroke={CLAY} strokeWidth="1.4" strokeLinecap="round"/>
  </svg>;
}
function DefaultIcon() {
  return <svg width="16" height="16" viewBox="0 0 16 16" fill="none" aria-hidden="true">
    <circle cx="8" cy="8" r="2.5" stroke={SAGE} strokeWidth="1.4"/>
  </svg>;
}

const ICON_RULES: Array<{ re: RegExp; icon: () => React.ReactElement }> = [
  { re: /说|词|喊|叫|话|唱|语|歌|喃|哼|字|数字/, icon: LanguageIcon },
  { re: /走|跑|跳|舞|爬|踢|骑|钻|荡|腿|脚/, icon: ActionIcon },
  { re: /绘本|玩|喜欢|书|画|故事|音乐|积木|游戏|兴趣/, icon: InterestIcon },
  { re: /吃|睡|饭|餐|饮食|午睡|饿/, icon: RestIcon },
  { re: /老师|小朋友|家人|朋友|班级|伙伴|同学/, icon: SocialIcon },
];

function iconForLine(text: string): React.ReactElement {
  for (const { re, icon: Icon } of ICON_RULES) {
    if (re.test(text)) return <Icon />;
  }
  return <DefaultIcon />;
}

export function SnapshotSummary({ text, className, icons }: { text: string; className?: string; icons?: boolean }) {
  const lines = text.split('\n').map((line) => line.replace(/^-\s*/, '')).filter(Boolean);
  if (lines.length === 0) return null;
  return (
    <ul className={className}>
      {lines.map((line, i) => (
        <li key={i} style={icons ? { display: 'flex', alignItems: 'center', gap: '8px' } : undefined}>
          {icons && <span style={{ flexShrink: 0, lineHeight: 1 }}>{iconForLine(line)}</span>}
          {line}
        </li>
      ))}
    </ul>
  );
}
