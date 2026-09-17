import { permanentRedirect } from "next/navigation";

// 张年 page retired 2026-09-17 in favour of /mom-reports (see
// docs/mom-reports-implementation-handoff.md). This route stays only as a redirect so old links and
// bookmarks keep working — it renders nothing of its own and reads no archive data.
export default function AboutPage() {
  permanentRedirect("/mom-reports");
}
