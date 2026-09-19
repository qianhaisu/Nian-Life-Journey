"use client";

import { useEffect } from "react";
import { claimChunkReload } from "@/lib/chunk-recovery";

export default function ReadingError({ error }: { error: Error & { digest?: string }; reset: () => void }) {
  useEffect(() => {
    // Reading sessionStorage itself may throw in restricted browser contexts.
    try {
      if (claimChunkReload(error, window.sessionStorage, window.location.href)) window.location.reload();
    } catch { /* The manual retry below remains available. */ }
  }, [error]);

  return <section className="reading-wrap" role="alert">
    <h1 className="serif">这一页暂时没打开</h1>
    <p>请重新打开这一页，再接着看。</p>
    <button className="text-link" onClick={() => window.location.reload()}>重新打开</button>
    <p><a href="/memory">回到记忆</a></p>
  </section>;
}
