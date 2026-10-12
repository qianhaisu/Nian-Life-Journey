"use client";

import { useId, useRef, useEffect } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";

const modes = [{ href: "/memory", label: "按时间" }, { href: "/memory/growth", label: "看成长" }, { href: "/memory/people", label: "看人物" }];

export function MemoryReadingMode({ current = "按时间" }: { current?: string }) {
  const ref = useRef<HTMLDetailsElement>(null);
  const id = useId();
  const pathname = usePathname();
  useEffect(() => {
    if (ref.current) ref.current.open = false;
  }, [pathname]);
  useEffect(() => {
    const outside = (event: PointerEvent) => { if (event.target instanceof Node && !ref.current?.contains(event.target) && ref.current) ref.current.open = false; };
    const escape = (event: KeyboardEvent) => {
      if (event.key === "Escape" && ref.current?.open) { ref.current.open = false; ref.current.querySelector("summary")?.focus(); }
    };
    document.addEventListener("pointerdown", outside);
    document.addEventListener("keydown", escape);
    return () => { document.removeEventListener("pointerdown", outside); document.removeEventListener("keydown", escape); };
  }, []);
  return <details className="reading-mode" ref={ref}>
    <summary aria-controls={id} aria-label={`阅读方式：${current}`}>{current}<span aria-hidden="true">⌄</span></summary>
    <nav id={id} aria-label="记忆阅读方式">{modes.map(mode => <Link href={mode.href} prefetch={false} key={mode.href} aria-current={mode.label === current ? "page" : undefined}>
      {mode.label}{mode.label === current && <span aria-hidden="true">✓</span>}
    </Link>)}</nav>
  </details>;
}
