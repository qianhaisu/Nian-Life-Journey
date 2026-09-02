import type { TimeSignature as Signature } from "@/lib/time-signature";

// The only way a date appears on a family page: "2026 年 8 月 14 日 · 当时 1 岁 7 个月".
export function TimeSignature({ signature, className = "" }: { signature: Signature; className?: string }) {
  return <p className={`time-signature ${className}`.trim()}>
    <time dateTime={signature.day}>{signature.dateLabel}</time>
    {signature.ageLabel ? <span>当时 {signature.ageLabel}</span> : null}
  </p>;
}
