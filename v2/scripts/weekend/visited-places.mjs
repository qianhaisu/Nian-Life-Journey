// Read-only family visited-places resolver for Nianlife "Weekend Planner".
// Strictly spot-level evidence ONLY: city visited (e.g. Shanghai/Deqing) NEVER blocks other spots in that city.
// Reads v2/lib/travel/trips.json (NEVER mutates it) + opsStateDir/visited-places.json (conversation/DB spot facts).
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { fileURLToPath } from "node:url";

const TRIPS_JSON_PATH = fileURLToPath(new URL("../../lib/travel/trips.json", import.meta.url));
export const VISITED_PLACES_SCHEMA = "nianlife.weekend-visited-places/1";

const DEFAULT_SPOT_ALIASES = [
  {
    canonicalSpot: "德清下渚湖湿地公园",
    city: "德清",
    aliases: ["下渚湖", "下渚湖湿地", "下渚湖湿地公园", "下渚湖国家湿地公园", "德清下渚湖"],
    matchInTripsSummary: "湿地公园",
    matchInTripsPlaceIds: ["cn-zj-deqing"],
  },
  {
    canonicalSpot: "德清奇幻谷",
    city: "德清",
    aliases: ["德清奇幻谷", "奇幻谷", "上渚山奇幻谷"],
    matchInTripsSummary: "奇幻谷",
  },
  {
    canonicalSpot: "德清莫干山",
    city: "德清",
    aliases: ["莫干山", "莫干山脚下"],
    matchInTripsSummary: "莫干山",
  },
  {
    canonicalSpot: "绍兴安昌古镇",
    city: "绍兴",
    aliases: ["安昌古镇", "安昌"],
    matchInTripsSummary: "安昌古镇",
  },
  {
    canonicalSpot: "兰溪水上森林",
    city: "兰溪",
    aliases: ["兰溪水上森林", "兰溪"],
    matchInTripsSummary: "兰溪坐船看水上森林",
  },
  {
    canonicalSpot: "千岛湖",
    city: "千岛湖",
    aliases: ["千岛湖"],
    matchInTripsSummary: "千岛湖",
  },
  {
    canonicalSpot: "杭州动物园",
    city: "杭州",
    aliases: ["杭州动物园"],
  },
  {
    canonicalSpot: "良渚温泉",
    city: "杭州",
    aliases: ["良渚温泉"],
  },
  {
    canonicalSpot: "上海北外滩",
    city: "上海",
    aliases: ["上海北外滩", "北外滩"],
    matchInTripsSummary: "北外滩",
  },
  {
    canonicalSpot: "上海静安寺商场",
    city: "上海",
    aliases: ["静安寺的商场"],
    matchInTripsSummary: "静安寺的商场",
  },
];

export function extractSpotRecordsFromTrips(tripsJsonPath = TRIPS_JSON_PATH) {
  if (!fs.existsSync(tripsJsonPath)) return [];
  let parsed;
  try {
    parsed = JSON.parse(fs.readFileSync(tripsJsonPath, "utf8"));
  } catch {
    return [];
  }
  const trips = Array.isArray(parsed?.trips) ? parsed.trips : [];
  const out = [];

  for (const trip of trips) {
    const haystack = `${trip.title ?? ""} ${trip.summary ?? ""} ${(trip.evidence ?? []).join(" ")}`;
    for (const def of DEFAULT_SPOT_ALIASES) {
      const placeMatch = !def.matchInTripsPlaceIds || def.matchInTripsPlaceIds.some((id) => (trip.placeIds ?? []).includes(id));
      const textMatch = def.matchInTripsSummary ? haystack.includes(def.matchInTripsSummary) : false;
      if (placeMatch && textMatch) {
        out.push({
          canonicalSpot: def.canonicalSpot,
          city: def.city,
          aliases: [...def.aliases],
          sourceKind: "trips.json",
          sourceRef: `trips.json#${trip.id}`,
          visitedDatesNote: trip.from === trip.to ? trip.from : `${trip.from}~${trip.to}`,
          evidenceNote: `${trip.title}（${trip.summary}）`,
        });
      }
    }
  }
  return out;
}

export function loadVisitedPlacesContext({
  opsStateDir = path.join(os.homedir(), "NianlifeOps", "ops-daily", "state", "weekend"),
  tripsJsonPath = TRIPS_JSON_PATH,
} = {}) {
  const fromTrips = extractSpotRecordsFromTrips(tripsJsonPath);
  const visitedFilePath = path.join(opsStateDir, "visited-places.json");
  let fromContextFile = [];
  if (fs.existsSync(visitedFilePath)) {
    try {
      const doc = JSON.parse(fs.readFileSync(visitedFilePath, "utf8"));
      if (Array.isArray(doc?.spots)) {
        fromContextFile = doc.spots;
      }
    } catch {
      // ignore malformed local context
    }
  }

  // Merge by canonicalSpot without inventing dates
  const bySpot = new Map();
  for (const rec of [...fromTrips, ...fromContextFile]) {
    if (!rec?.canonicalSpot) continue;
    const prev = bySpot.get(rec.canonicalSpot);
    if (!prev) {
      bySpot.set(rec.canonicalSpot, {
        canonicalSpot: rec.canonicalSpot,
        city: rec.city ?? "",
        aliases: [...new Set([rec.canonicalSpot, ...(rec.aliases ?? [])])],
        sources: [{
          sourceKind: rec.sourceKind ?? "weekend_context",
          sourceRef: rec.sourceRef ?? "",
          visitedDatesNote: rec.visitedDatesNote ?? null,
          evidenceNote: rec.evidenceNote ?? "",
        }],
      });
    } else {
      prev.aliases = [...new Set([...prev.aliases, ...(rec.aliases ?? [])])];
      prev.sources.push({
        sourceKind: rec.sourceKind ?? "weekend_context",
        sourceRef: rec.sourceRef ?? "",
        visitedDatesNote: rec.visitedDatesNote ?? null,
        evidenceNote: rec.evidenceNote ?? "",
      });
    }
  }

  return {
    schema: VISITED_PLACES_SCHEMA,
    spots: [...bySpot.values()],
  };
}

/**
 * Checks whether a candidate venue hits a spot-level visited record.
 * Whole cities (e.g. "上海" / "德清" / "杭州") are NEVER treated as visited spots.
 */
export function checkCandidateVisitedSpot(candidateOrText, visitedContext) {
  const spots = Array.isArray(visitedContext?.spots) ? visitedContext.spots : [];
  const text = typeof candidateOrText === "string"
    ? candidateOrText
    : [
        candidateOrText?.venueName,
        candidateOrText?.placeQueryName,
        candidateOrText?.title,
        candidateOrText?.subtitle,
      ]
        .filter(Boolean)
        .join(" ");

  for (const spot of spots) {
    const aliases = [spot.canonicalSpot, ...(spot.aliases ?? [])].filter((a) => typeof a === "string" && a.trim().length >= 2);
    const matchedAlias = aliases.find((alias) => text.includes(alias));
    if (matchedAlias) {
      return {
        visited: true,
        canonicalSpot: spot.canonicalSpot,
        matchedAlias,
        sources: spot.sources ?? [],
      };
    }
  }
  return { visited: false, canonicalSpot: null, matchedAlias: null, sources: [] };
}
