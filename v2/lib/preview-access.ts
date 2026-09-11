// Whether this deployment serves the private reading surface at all.
//
// /preview and /preview/[year] can show stories that nobody has reviewed yet. Today they are kept
// out of the navigation and robots.ts disallows the whole site — that hides the door, it does not
// lock it. Anyone who learns the path reaches the drafts, and once the site is public "nobody links
// to it" stops being a property of the system and becomes a hope about visitors.
//
// So the surface is a server-side switch instead. It is CLOSED unless the deployment says
// otherwise: a container that sets nothing serves 404 at /preview, exactly as if the route did not
// exist. The private container turns it on explicitly.
//
// Deliberately NOT here: a login, a password, a session, a role. Those are a different piece of work
// and this project has ruled them out for now. This is one boolean whose default is the safe one.
export const PREVIEW_READING_FLAG = "PREVIEW_READING_ENABLED";

const TRUTHY = /^(1|true|on|yes)$/i;

/**
 * True only when the flag is present and explicitly affirmative. Anything else — unset, empty,
 * "false", "0", a typo — reads as closed, because the failure that matters is a draft served to a
 * reader who was never meant to see it, not a 404 an operator can fix in one line.
 */
export function previewReadingEnabled(env: NodeJS.ProcessEnv = process.env): boolean {
  const raw = env[PREVIEW_READING_FLAG];
  if (typeof raw !== "string") return false;
  return TRUTHY.test(raw.trim());
}
