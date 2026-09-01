// Six-level evidence tier (§8.1). Deterministic classification from source metadata only.
import type { EvidenceTier, WindowSource } from "./types";

export function classifyTier(source: WindowSource): EvidenceTier {
  if (source.sourceType === "medical_document" || source.sourceType === "checkup_document") return "authoritative_document";
  if (source.contributorRole === "hospital") return "authoritative_document";
  if (source.sourceType === "growth_measurement") return "user_direct_input";
  if (source.contributorRole === "father" || source.contributorRole === "mother") return "firsthand_observation";
  if (source.contributorRole === "teacher" || source.contributorRole === "grandfather" || source.contributorRole === "grandmother") return "firsthand_observation";
  return "reported_speech";
}

// A single fact can be classified once its claimant role is known (e.g. "妈妈转述医生的说法").
export function claimTier(claimantRole: "father" | "mother" | "teacher" | "grandfather" | "grandmother" | "hospital" | "system_import" | "reported"): EvidenceTier {
  if (claimantRole === "hospital") return "authoritative_document";
  if (claimantRole === "reported") return "reported_speech";
  return "firsthand_observation";
}
