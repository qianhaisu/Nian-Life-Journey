// Which raw photo sources are trusted to show Zhang Nian without a published
// life_event vouching for each image.
//
// "trusted" in MediaPrivilege (lib/publication-moments.ts) lets a photo appear
// beside a day's text on the month page (as a hero or supporting thumbnail),
// become the month cover, and reach the home-page cover slot.
//
// Two kinds of trust:
//   sourceType === "family_photo"  — Quark album originals; the family's own
//     photo collection, ingested via quark-photo-apply.mjs. Not a specific label
//     because the Quark batch label varies by run date.
//   sourceLabel in TRUSTED_WECHAT_SOURCE_LABELS  — specific WeChat groups where
//     every image is of Zhang Nian (confirmed by Teddy). Identified by the
//     conversation's stable label, not sourceType, so no data migration is needed.
//
// To add a new source: drop its label into TRUSTED_WECHAT_SOURCE_LABELS with a
// comment, then commit.
import { DAYCARE_CONVERSATION } from "@/lib/organizer/subject-gate";
import type { RawSource } from "@/lib/types";

// P1-4, 2026-09-05: expanded from family-archive.ts (previously only DAYCARE_CONVERSATION).
// 主群 (主力作战部队群) added — Teddy confirmed every photo there is of Zhang Nian.
const TRUSTED_WECHAT_SOURCE_LABELS: ReadonlySet<string> = new Set([
  DAYCARE_CONVERSATION,                     // 乳儿班群 (WeFlow JSON)
  "conversation:a673c0e0563be6ecf1867094", // 主群 (作战部队), current export
  "conversation:856b8ec2b8f3ec2871782ca6", // 主群, earlier export
  "conversation:064d5dfbd798a5f27223c758", // 主群 (作战部队), post-fix id
]);

export function isTrustedPhotoSource(
  source: Pick<RawSource, "sourceType" | "sourceLabel">,
): boolean {
  return (
    source.sourceType === "family_photo" ||
    (!!source.sourceLabel && TRUSTED_WECHAT_SOURCE_LABELS.has(source.sourceLabel))
  );
}
