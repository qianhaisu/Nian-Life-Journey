// Which ledger candidates a month page could ever show, decided before any model is asked.
//
// The September round sent every unique original to the vision model and applied the admission
// gates afterwards. That order has two costs once it runs across twenty months. The obvious one is
// that most of an older month's pictures come from conversations that are not on the trusted list
// and were never subject-checked, so the model would describe thousands of pictures no page may
// show. The less obvious one is a correctness problem: a burst is compared as a whole, so an
// unadmitted frame can be named the burst's lead, and every admitted frame that "repeats" it is then
// not selected — the moment disappears from the page behind a picture the page was never going to
// draw. Gating first keeps the model choosing only among pictures that can actually appear.
//
// The gates are the ones month-curate.mjs applies, in its order: deliverable and not private,
// the latest media_subject_check is not store_only, and the picture is privileged (trusted source or
// subject approved). A topic score is not among them and never becomes one.
//
// The store_only veto also holds across byte-identical rows. The same photograph often arrives under
// two media ids (once per WeChat export). A reviewer's store_only on one id is a statement about
// those bytes, so a twin nobody has reviewed may not carry them onto a page; only a twin holding its
// own `approved` check can, because that is a separate decision by someone who looked.

export const latestSubjectDecision = (candidate) => candidate?.subjectCheck?.decision ?? null;

/** The first gate a candidate fails, or "admissible". Order matters: it mirrors month-curate.mjs. */
export function admissionGate(candidate) {
  if (!candidate.publishable) return "not-publishable";
  if (latestSubjectDecision(candidate) === "store_only") return "store-only";
  if (!candidate.privileged) return "subject-unverified";
  return "admissible";
}

/**
 * Which member of a byte-identical cluster may represent it, and whether the cluster is admitted.
 * `members` are ledger candidates sharing one original checksum.
 */
export function clusterAdmission(members, pick) {
  const vetoed = members.some((m) => latestSubjectDecision(m) === "store_only");
  if (vetoed) {
    const approved = members.filter((m) => admissionGate(m) === "admissible" && latestSubjectDecision(m) === "approved");
    if (approved.length) {
      return { chosen: pick(approved), admitted: true, vetoed: true,
        basis: "a sibling row is store_only; this row holds its own approved subject check" };
    }
    return { chosen: pick(members.filter((m) => latestSubjectDecision(m) === "store_only")), admitted: false, vetoed: true,
      basis: "a row carrying these bytes is store_only and no row holds its own approved subject check" };
  }
  const admissible = members.filter((m) => admissionGate(m) === "admissible");
  if (admissible.length) return { chosen: pick(admissible), admitted: true, vetoed: false, basis: "admissible" };
  return { chosen: pick(members), admitted: false, vetoed: false, basis: admissionGate(pick(members)) };
}
