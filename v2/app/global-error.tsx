"use client";

import { useEffect } from "react";
import { claimReload } from "@/lib/chunk-recovery";

// Replaces Next's bare "Application error: a client-side exception has occurred" screen, which is
// what a reader sees when a failure escapes app/error.tsx (root layout, router state). Teddy hit it
// on 2026-09-28 tapping a month on a phone tab opened before a release; fresh loads of every month
// were fine. It renders instead of the root layout, so it brings its own <html>/<body> and styles.
export default function GlobalError({ error }: { error: Error & { digest?: string }; reset: () => void }) {
  useEffect(() => {
    try {
      if (claimReload(window.sessionStorage, window.location.href)) window.location.reload();
    } catch { /* The manual retry below remains available. */ }
  }, [error]);

  return <html lang="zh-CN"><body style={{ margin: 0, background: "#f5efe4", color: "#3b322a", fontFamily: "system-ui, sans-serif" }}>
    <section role="alert" style={{ maxWidth: 480, margin: "30vh auto 0", padding: "0 24px", textAlign: "center", lineHeight: 1.8 }}>
      <h1 style={{ fontSize: 22, fontWeight: 600 }}>这一页暂时没打开</h1>
      <p>请重新打开这一页，再接着看。</p>
      <p><button onClick={() => window.location.reload()} style={{ font: "inherit", color: "inherit", background: "none", border: 0, textDecoration: "underline", padding: 8 }}>重新打开</button></p>
      <p><a href="/memory" style={{ color: "inherit" }}>回到记忆</a></p>
    </section>
  </body></html>;
}
