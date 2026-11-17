import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { WeekendDetailView } from "@/components/weekend-detail-view";
import { renderOnDemand } from "@/lib/render-on-demand";
import { readWeekendById } from "@/lib/weekend/content";
import {
  DEFAULT_EXCLUDED_EXPERIENCE_TYPES,
  emptyWeekendState,
  WeekendStateStore,
} from "@/lib/weekend/state-store";
import type {
  DepartureKey,
  ExcludedExperienceTypeItem,
  WeekendStateFile,
} from "@/lib/weekend/types";
import "../weekend.css";

function resolveProposalId(
  requested: string | undefined,
  saved: string | null | undefined,
  proposals: ReadonlyArray<{ id: string }>
): string {
  if (requested && proposals.some((item) => item.id === requested)) {
    return requested;
  }
  if (saved && proposals.some((item) => item.id === saved)) {
    return saved;
  }
  return proposals[0]?.id ?? "";
}

function resolveDeparture(
  requested: string | undefined,
  saved: DepartureKey | null | undefined
): DepartureKey {
  if (requested === "sat_morning" || requested === "sat_afternoon") {
    return requested;
  }
  if (saved === "sat_morning" || saved === "sat_afternoon") {
    return saved;
  }
  return "sat_morning";
}

export async function generateMetadata({
  params,
  searchParams,
}: {
  params: Promise<{ weekId: string }>;
  searchParams?: Promise<{ proposal?: string; mode?: string }>;
}): Promise<Metadata> {
  const { weekId } = await params;
  const resolvedSearch = searchParams ? await searchParams : {};
  const bundle = await readWeekendById(weekId);
  if (!bundle) {
    return { title: "周末详情" };
  }
  const active =
    bundle.snapshot.proposals.find((p) => p.id === resolvedSearch.proposal) ??
    bundle.snapshot.proposals[0];
  const prefix = resolvedSearch.mode === "live" ? "周六现场 · " : "";
  return {
    title: active ? `${prefix}${active.title}` : "周末详情",
  };
}

export default async function WeekendDetailPage({
  params,
  searchParams,
}: {
  params: Promise<{ weekId: string }>;
  searchParams?: Promise<{ proposal?: string; departure?: string; mode?: string }>;
}) {
  await renderOnDemand();
  const { weekId } = await params;
  const resolvedSearch = searchParams ? await searchParams : {};
  const bundle = await readWeekendById(weekId);
  if (!bundle) {
    notFound();
  }

  let initialState: WeekendStateFile | null = emptyWeekendState(bundle.weekId);
  let initialExcludedTypes: ExcludedExperienceTypeItem[] = [
    ...DEFAULT_EXCLUDED_EXPERIENCE_TYPES,
  ];
  try {
    const store = new WeekendStateStore();
    const [weekState, excludedTypes] = await Promise.all([
      store.readWeekState(bundle.weekId),
      store.readExcludedTypes(),
    ]);
    initialState = weekState;
    initialExcludedTypes = excludedTypes;
  } catch {
    // 保留安全默认状态，保证详情与现场页可读
  }

  const initialProposalId = resolveProposalId(
    resolvedSearch.proposal,
    initialState?.selectedProposalId,
    bundle.snapshot.proposals
  );
  const initialDeparture = resolveDeparture(
    resolvedSearch.departure,
    initialState?.selectedDeparture
  );
  const initialMode = resolvedSearch.mode === "live" ? "live" : "plan";

  return (
    <main className="wd-page">
      <div className="wd-wrap">
        <WeekendDetailView
          weekId={bundle.weekId}
          snapshot={bundle.snapshot}
          isExpired={bundle.isExpired}
          initialProposalId={initialProposalId}
          initialDeparture={initialDeparture}
          initialMode={initialMode}
          initialState={initialState}
          initialExcludedTypes={initialExcludedTypes}
        />
      </div>
    </main>
  );
}
