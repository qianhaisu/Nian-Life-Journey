// Renders a monthly_snapshot.summary as a bulleted list. The A-track writer produces the summary
// as newline-separated "- " prefixed lines; this component strips the prefix and renders each line
// as a <li>. Every surface that shows a snapshot summary must go through here so the format is
// consistent wherever the family reads it.
export function SnapshotSummary({ text, className }: { text: string; className?: string }) {
  const lines = text.split('\n').map((line) => line.replace(/^-\s*/, '')).filter(Boolean);
  if (lines.length === 0) return null;
  return (
    <ul className={className}>
      {lines.map((line, i) => <li key={i}>{line}</li>)}
    </ul>
  );
}
