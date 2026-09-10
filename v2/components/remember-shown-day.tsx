"use client";

import { useEffect } from "react";
import { LAST_SHOWN_DAY_COOKIE } from "@/lib/home-recent-pick";

// Records which day the front page just showed, so the next visit can pick a different one.
//
// A cookie rather than localStorage on purpose: the server has to know the answer while it is
// choosing, and it can only read what the request carries. Choosing on the server and then
// correcting on the client would mean the reader sees one story replaced by another a moment after
// the page settles — the flash this component exists to avoid. It renders nothing and changes
// nothing on screen, so it cannot disagree with the server's HTML during hydration.
//
// SameSite=Lax, no expiry beyond a year, and the value is one date string. It is not an identifier
// and nothing else reads it.
export function RememberShownDay({ day }: { day: string }) {
  useEffect(() => {
    try {
      document.cookie = `${LAST_SHOWN_DAY_COOKIE}=${day}; path=/; max-age=31536000; samesite=lax`;
    } catch {
      // A browser that refuses cookies simply gets an unfiltered draw next time.
    }
  }, [day]);
  return null;
}
