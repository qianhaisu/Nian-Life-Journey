// Dependency graph over the ledger, built from EFFECTIVE link roles (human link corrections applied).
// One definition of "what depends on what", used by impact, analysis snapshots and timeline block hashes,
// so the three cannot drift apart.
//
//   episode  depends on: its members (attached/candidate/background observations), its encounters
//   encounter depends on: the canonical facts that belong to it (of_encounter), its documents
//   observation / canonical_fact / episode depends on: the sources it is documented in / read from / supported by
//
// A dependent's hash therefore changes when anything it (transitively) rests on changes.
import { EPISODE_MEMBERSHIP_ROLES, entityKey, hashOf, type Content, type EntityKind, type Ledger, type Link, type LinkRole, type Ref } from "./model";

export type EffLink = Link & { effectiveRole: LinkRole | "removed"; correctionId?: string };

export function effectiveLinks(ledger: Ledger, extra: Link[] = []): EffLink[] {
  const overlay = new Map<string, { role: LinkRole | "removed"; id: string }>();
  for (const c of ledger.corrections) if (c.type === "link") overlay.set(c.linkId, { role: c.afterRole, id: c.id });
  return [...Object.values(ledger.links), ...extra.filter((l) => !ledger.links[l.id])].map((l) => ({ ...l, effectiveRole: overlay.get(l.id)?.role ?? l.role, correctionId: overlay.get(l.id)?.id }));
}

/** [dependent, dependency] for one link, or null when the effective role creates no dependency. */
export function dependencyEdge(l: EffLink): [Ref, Ref] | null {
  const r = l.effectiveRole;
  if (r === "removed") return null;
  if ((EPISODE_MEMBERSHIP_ROLES as string[]).includes(r)) return [l.to, l.from];
  if (r === "encounter") return [l.from, l.to];
  if (r === "of_encounter") return [l.to, l.from];
  if (r === "from_source" || r === "supports" || r === "documented_in") return [l.from, l.to];
  return null;
}

export function getPath(obj: unknown, path: string): unknown {
  let cur: unknown = obj;
  for (const p of path.split(".")) { if (typeof cur !== "object" || cur === null) return undefined; cur = (cur as Record<string, unknown>)[p]; }
  return cur;
}
const SAFE_SEGMENT = /^[A-Za-z_][A-Za-z0-9_]*$/;
export function assertSafePath(path: string) {
  const parts = path.split(".");
  if (!parts.length || parts.some((p) => !SAFE_SEGMENT.test(p) || p === "__proto__" || p === "constructor" || p === "prototype")) throw new Error(`unsafe field path: ${path}`);
}
export function setPath(obj: Content, path: string, value: unknown) {
  assertSafePath(path);
  const parts = path.split(".");
  let cur = obj as Record<string, unknown>;
  for (const p of parts.slice(0, -1)) { if (typeof cur[p] !== "object" || cur[p] === null) cur[p] = {}; cur = cur[p] as Record<string, unknown>; }
  cur[parts[parts.length - 1]] = value;
}

export function effectiveContent(ledger: Ledger, ref: Ref): { content: Content; version: number; corrections: string[] } | undefined {
  const e = ledger.entities[entityKey(ref.kind, ref.id)];
  if (!e) return undefined;
  const v = e.versions[e.versions.length - 1];
  const content = structuredClone(v.content);
  const applied: string[] = [];
  for (const c of ledger.corrections) if (c.type === "field" && c.ref.kind === ref.kind && c.ref.id === ref.id) { setPath(content, c.field, c.after); applied.push(c.id); }
  return { content, version: v.version, corrections: applied };
}

export class Graph {
  ledger: Ledger;
  links: EffLink[];
  deps = new Map<string, Set<string>>(); // dependent -> dependencies
  rdeps = new Map<string, Set<string>>(); // dependency -> dependents
  private edgeLinks = new Map<string, EffLink[]>(); // dependent -> its dependency links
  private nodeHash = new Map<string, string>();
  private closure = new Map<string, string>();
  constructor(ledger: Ledger, extraLinks: Link[] = []) {
    this.ledger = ledger;
    this.links = effectiveLinks(ledger, extraLinks);
    for (const l of this.links) {
      const e = dependencyEdge(l);
      if (!e) continue;
      const a = entityKey(e[0].kind, e[0].id), b = entityKey(e[1].kind, e[1].id);
      (this.deps.get(a) ?? this.deps.set(a, new Set()).get(a)!).add(b);
      (this.rdeps.get(b) ?? this.rdeps.set(b, new Set()).get(b)!).add(a);
      (this.edgeLinks.get(a) ?? this.edgeLinks.set(a, []).get(a)!).push(l);
    }
  }
  /** Effective content hash of one node (version + content with corrections). Sources are hashed per edge, see closureHash. */
  private hashNode(key: string): string {
    const hit = this.nodeHash.get(key);
    if (hit) return hit;
    const e = this.ledger.entities[key];
    const eff = e ? effectiveContent(this.ledger, { kind: e.kind, id: e.id }) : undefined;
    const h = eff ? hashOf({ v: eff.version, c: eff.content }) : "absent";
    this.nodeHash.set(key, h);
    return h;
  }
  /** All entities reachable through dependencies (including the start). */
  dependenciesOf(key: string): string[] {
    const seen = new Set<string>([key]);
    const stack = [key];
    while (stack.length) for (const d of this.deps.get(stack.pop()!) ?? []) if (!seen.has(d)) { seen.add(d); stack.push(d); }
    return [...seen];
  }
  /** Everything that transitively depends on any of `keys` (including `keys`). */
  dependentsOf(keys: string[]): Set<string> {
    const seen = new Set<string>(keys);
    const stack = [...keys];
    while (stack.length) for (const d of this.rdeps.get(stack.pop()!) ?? []) if (!seen.has(d)) { seen.add(d); stack.push(d); }
    return seen;
  }
  /** Hash of an entity and everything it rests on. Source contents come from the version each link is bound to. */
  closureHash(ref: Ref): string {
    const key = entityKey(ref.kind, ref.id);
    const hit = this.closure.get(key);
    if (hit) return hit;
    const nodes = this.dependenciesOf(key).sort();
    const parts = nodes.map((k) => {
      const kind = k.slice(0, k.indexOf(":")) as EntityKind;
      const edges = (this.edgeLinks.get(k) ?? []).map((l) => [l.id, l.effectiveRole]).sort();
      return [k, kind === "source" ? "src" : this.hashNode(k), edges];
    });
    const bound = nodes.flatMap((k) => (this.edgeLinks.get(k) ?? []).filter((l) => l.to.kind === "source").map((l) => {
      const src = this.ledger.entities[entityKey("source", l.to.id)];
      const v = l.toVersion ?? src?.versions.length ?? 0;
      const ver = src?.versions[v - 1];
      return [l.id, v, ver ? hashOf(ver.content) : "absent", src ? src.versions.length > v : false];
    })).sort();
    const h = hashOf({ parts, bound });
    this.closure.set(key, h);
    return h;
  }
}
