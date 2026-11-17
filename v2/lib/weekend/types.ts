// Core TypeScript models for the Nianlife V2 Weekend Planner ("周末去哪").
// Strictly read-only relative to formal travel footprints; no collaborative voting or share-template payloads.

export type WeekendPlannerStatus =
  | "collecting"
  | "published"
  | "unavailable"
  | "expired"
  | "rest_recommended";

export type EffectiveWeekendStatus = WeekendPlannerStatus;

export type VerificationStatus = "verified" | "unconfirmed" | "estimated";
export type ProposalSlot = "preferred" | "alt_local" | "alt_1h";
export type DepartureKey = "sat_morning" | "sat_afternoon";
export type CrowdRiskLevel = "low" | "low_to_medium" | "medium" | "high";
export type SignalStrength = "strong" | "weak";
export type SundayOutcome =
  | "went_loved"
  | "went_adult_meh"
  | "went_tired"
  | "went_pitfall"
  | "stayed_home";

export interface ExcludedExperienceTypeItem {
  experienceType: string;
  label: string;
  excludedAt: string;
  addedBy?: string;
  note?: string;
}

export interface WeekendImageAsset {
  src: string;
  alt: string;
  caption?: string;
  sourcePage?: string;
  timeNote?: string;
  ossKey?: string;
  sha256?: string;
}

export interface XhsEvidenceNote {
  seq: number;
  noteId: string;
  title: string;
  author: string;
  publishedAt: string; // YYYY-MM-DD
  within30Days: boolean;
  likes: string;
  collects: string;
  commentCountText: string;
  commentsCaptured: number;
  url: string;
  keyTakeaway: string;
  commentFeedback: string;
  noImageUsed: boolean;
}

export interface LatestDepartureCutoff {
  hasCutoff: boolean;
  anchorClosingTime: string;
  eveningBackupClosingTime?: string;
  cutoffTime: string;
  cutoffTimeRelaxed?: string;
  formulaNote: string;
  headline: string;
  fallbackAction: string;
}

export interface WorthGoingCheckItem {
  label: string;
  status: VerificationStatus;
  detail: string;
}

export interface DepartureTimelineItem {
  timeWindow: string;
  segmentKey: string;
  title: string;
  location: string;
  slotWeather3h: string;
  driveOrWalkNote: string;
  strollerAndRestNote: string;
  isRestBuffer: boolean;
  category: string;
}

export interface DeparturePlan {
  label: string;
  departureTime: string;
  arrivalEstimate: string;
  trimNote: string;
  returnTime: string;
  timeline: DepartureTimelineItem[];
}

export interface DegradationAlternative {
  name: string;
  driveOrWalk: string;
  indoor: boolean;
  parking: string;
  note: string;
}

export interface DegradationBranch {
  triggerLabel: string;
  actionSummary: string;
  nearbyAlternatives: DegradationAlternative[];
  returnRouteHint: string;
}

export interface WeekendHotelOption {
  rank: number;
  tag: string;
  name: string;
  brandType?: string;
  districtArea?: string;
  address: string;
  rating: string;
  recommendedRoom: string;
  bedSpec?: string;
  liveRatesCny: {
    note: string;
    [rateField: string]: number | string;
  };
  freeCancellationDeadline: string;
  childAndCribPolicy: string;
  cribStatusNote?: string;
  poolSummary?: string;
  poolStatus?: VerificationStatus;
  parkingPolicy: string;
  parkingStatus: VerificationStatus;
  routingNote?: string;
  capturedAt?: string;
  verificationStatus: VerificationStatus;
  bookingUrl: string;
  image?: WeekendImageAsset;
  galleryImages?: WeekendImageAsset[];
}

export interface WeekendHotelEliminatedOption {
  name: string;
  status: "over_budget" | "sold_out" | "eliminated";
  priceFound: string;
  reason: string;
}

export type WeekendProposalHotel =
  | { required: false; note: string }
  | {
      required: true;
      budgetConstraint: string;
      preferenceSummary?: string;
      recommendationReason?: string;
      areaComparisonNote?: string;
      searchQueryParams: {
        checkIn: string;
        checkOut: string;
        rooms: number;
        adults: number;
        children: number;
        childAgeParam: string;
        capturedAt: string;
        verificationStatus: VerificationStatus;
      };
      options: WeekendHotelOption[];
      eliminatedOptions: WeekendHotelEliminatedOption[];
    };

export interface WeekendProposal {
  id: string;
  slot: ProposalSlot;
  rank: number;
  badge: string;
  experienceType: string;
  experienceTypeLabel: string;
  signalStrength: SignalStrength;
  signalStrengthLabel?: string;
  title: string;
  subtitle: string;
  region: string;
  isOvernight: boolean;
  paceLabel: string;
  hotelSummaryShort?: string;
  heroImage?: WeekendImageAsset;
  galleryImages?: WeekendImageAsset[];
  driveFromSandun: {
    distanceKmEstimate: number;
    durationMinutesRange: [number, number];
    durationLabel: string;
    directionFromSandun: string;
    verificationStatus: VerificationStatus;
    honestRuleNote?: string;
  };
  latestDepartureCutoff: LatestDepartureCutoff;
  weatherSlots: Array<{
    slotLabel: string;
    condition: string;
    tempRangeC: string;
    wind: string;
    precipRiskNote: string;
  }>;
  xhsEvidence: {
    digest: string;
    commentSignals: string;
    notes: XhsEvidenceNote[];
  };
  oneLineReason: string;
  worthGoingChecks: {
    coreAnchorAndReason: WorthGoingCheckItem;
    driveToContentRatio: WorthGoingCheckItem;
    loop15MinAndRestWindow: WorthGoingCheckItem;
    rainOrFailBackup: WorthGoingCheckItem;
    adultDelight: WorthGoingCheckItem;
    notJustDiningCounterCheck: WorthGoingCheckItem;
  };
  urgentBookingsTonight: Array<{
    item: string;
    required: boolean;
    deadline: string;
    channel: string;
    verificationStatus: VerificationStatus;
    note: string;
  }>;
  departures: Record<DepartureKey, DeparturePlan>;
  degradationTree: {
    rain: DegradationBranch;
    childTired: DegradationBranch;
    crowded: DegradationBranch;
    returnEarly: DegradationBranch;
  };
  crowdAndTraffic: {
    roadPattern: {
      basis: "historical_weekend_pattern" | "historical_and_xhs_pattern";
      isEstimate: true;
      summary: string;
      bestDepartureWindow: string;
      avoidWindow: string;
    };
    venueCrowd: {
      riskLevel: CrowdRiskLevel;
      isEstimate: true;
      peakHours: string;
      offPeakTip: string;
      signals: string[];
    };
  };
  hotel: WeekendProposalHotel;
  costBreakdown: {
    totalTripBudgetSet: false;
    totalBudgetNote: string;
    items: Array<{
      label: string;
      amountText: string;
      verificationStatus: VerificationStatus;
      note: string;
    }>;
  };
  sources: Array<{
    title: string;
    url: string;
    sourceType: string;
    verificationStatus: VerificationStatus;
    verifiedAt: string;
    note?: string;
  }>;
}

export interface InspirationItem {
  id: string;
  poolKind: "seasonalLimited" | "evergreen";
  poolTag: string;
  availabilityStatus: "active" | "blocked";
  experienceType?: string;
  experienceTypeLabel?: string;
  signalStrength?: SignalStrength;
  title: string;
  region: string;
  driveFromSandun: string;
  whyThisWeek: string;
  image?: WeekendImageAsset;
  caveat?: string;
  keyFacts: {
    openingHours: string;
    bookingRequired: boolean;
    bookingChannel: string;
    ticketSummary: string;
    strollerNote: string;
    bookingAvailabilityStatus?: VerificationStatus;
    ticketPolicyStatus?: VerificationStatus;
  };
  verificationStatus: VerificationStatus;
  verifiedAt: string;
  xhsEvidence: XhsEvidenceNote[];
  sources: string[];
}

export interface NoGoAlert {
  id: string;
  severity: "high" | "medium" | "low";
  venue: string;
  blockedRange: string;
  reason: string;
  verificationStatus: VerificationStatus;
  verifiedAt: string;
  sourceUrl: string;
}

export interface ModeProbeResult {
  mode: string;
  httpStatus: number;
  elapsedMs: number;
  noteCardCount: number;
  loginModal: boolean;
  captcha: boolean;
  screenshot: string;
  screenshotVerifiedOnDisk: boolean;
}

export interface WeekendWeatherCityDaySummary {
  date: string;
  dayLabel: string;
  summary: string;
  wind: string;
  icon?: string;
  conditionShort?: string;
}

export interface WeekendWeatherHour3Segment {
  slot: string;
  condition: string;
  temp: string;
  windDir: string;
  windForce: string;
}

export interface WeekendWeatherCity {
  city: string;
  code: string;
  sourceUrl: string;
  daysSummary: WeekendWeatherCityDaySummary[];
  hour3Segments: Record<string, WeekendWeatherHour3Segment[]>;
  weekendTip: string;
}

export interface WeekendWeatherSummary {
  testedAt: string;
  primarySourceLabel: string;
  secondarySourceLabel: string;
  precipProbabilityPct: number | null;
  precipProbabilityStatus: VerificationStatus;
  precipProbabilityNote: string;
  horizonConfidence: "low" | "medium" | "high";
  horizonConfidenceLabel: string;
  fridayRefreshHint: string;
  cities: WeekendWeatherCity[];
}

export interface WeekendPlannerSnapshot {
  schema: "nianlife.weekend-planner/1";
  weekId: string;
  weekendRange: {
    from: string;
    to: string;
    label: string;
    satLabel: string;
    sunLabel: string;
  };
  generatedAt: string;
  status: WeekendPlannerStatus;
  userFacingStatusLabels: {
    verified: "已确认" | string;
    unconfirmed: "待确认" | string;
    estimated: "预估" | string;
  };
  verificationSummaryNote: string;
  publishCadence: {
    collectedAt: string;
    regularPublishTarget: string;
    fridayRefreshTarget: string;
    note: string;
  };
  unavailableNotice?: {
    reason:
      | "xhs_auth_expired"
      | "xhs_risk_stopped"
      | "pc_offline_mon_to_wed"
      | "insufficient_recent_notes";
    headline: string;
    summary: string;
    detectedAt: string;
    actionForTeddy: string;
    fallbackArchiveWeekId?: string;
  };
  fridayAlert?: {
    refreshedAt: string;
    severity: "info" | "adjust";
    headline: string;
    summary: string;
    swapSuggestion?: string;
    keepsSelectedProposal: boolean;
  };
  restRecommendation?: {
    reason: string;
    weatherOrCrowdTrigger: string;
    microActivities: Array<{
      title: string;
      driveMinutes: string;
      indoor: boolean;
      note: string;
    }>;
  };
  childProfile: {
    name: string;
    birthDay: string;
    ageOnSaturday: string;
    ageLabel: string;
    ageFormula: string;
    mobilityBoundary: string;
    unconfirmedPreferences: string[];
    confirmedSleepArrangement?: string;
  };
  familyBaseline: {
    origin: { name: string; lat: number; lng: number };
    transport: string;
    maxDistanceScope: string;
    departureWindow: string;
    crowdAndStyleRule: string;
    hotelBudget: {
      regularTargetRmb: number;
      stretchAllowed: boolean;
      hardCapRmb: number;
      party: string;
      preferences?: string[];
      note: string;
    };
    totalTripBudget: null;
    totalBudgetPolicy: string;
  };
  weatherSummary: WeekendWeatherSummary;
  crawlAudit?: {
    testedAt: string;
    manifestPath: string;
    manifestMdPath: string;
    xiaohongshuLoggedIn: {
      profileDir: string;
      authBackupPath: string;
      rateLimitPolicy: {
        concurrency: number;
        randomDelayMsRange: string;
        riskStopRule: string;
        riskStopTriggered: boolean;
        falsePositiveCalibrationNote?: string;
      };
      summary: {
        totalKeywords: number;
        searchSuccessCount: number;
        searchSuccessRate: string;
        totalNavRequests: number;
        notesAttempted: number;
        notesSucceeded: number;
        bodyReadSuccessRate: string;
        within30DaysCount: number;
        notePublishDateRange: string;
        avgNoteElapsedMs: number;
        riskStopCount: number;
      };
      modeComparison: {
        keywordTested: string;
        headless: ModeProbeResult;
        headed: ModeProbeResult;
        conclusion: string;
      };
    };
    ctripLoggedIn: {
      testedAt: string;
      searchCondition: string;
      hotelsChecked: number;
      withinBudgetOptions: Array<{
        name: string;
        hotelId: string;
        ratesSummary: string;
        url: string;
      }>;
      eliminatedOptions: Array<{
        name: string;
        reason: string;
        rawJson: string;
      }>;
    };
    weatherAndOfficial: {
      weatherLatencyRangeMs: string;
      openMeteoStatus: string;
      officialDetailPagesVerified: string[];
    };
  };
  excludedExperienceTypes?: ExcludedExperienceTypeItem[];
  proposals: WeekendProposal[];
  inspirationPool: InspirationItem[];
  noGoAlerts: NoGoAlert[];
}

export interface WeekendFridayAlertAck {
  adoptedSwap: boolean;
  updatedAt: string | null;
}

export interface WeekendSundayFeedback {
  outcome: SundayOutcome | null;
  tags: string[];
  submittedAt: string | null;
  proposalId: string | null;
}

export interface WeekendStateFile {
  schema: "nianlife.weekend-state/1";
  weekId: string;
  updatedAt: string | null;
  selectedProposalId: string | null;
  selectedDeparture: DepartureKey | null;
  checklist?: Record<string, boolean>;
  fridayAlertAck: WeekendFridayAlertAck;
  sundayFeedback: WeekendSundayFeedback;
  feedbackReceiptKeys: string[];
}

export interface WeekendExcludedTypesFile {
  schema: "nianlife.weekend-excluded-types/1";
  updatedAt: string;
  excludedExperienceTypes: ExcludedExperienceTypeItem[];
}

export interface WeekendCurrentBundle {
  effectiveStatus: EffectiveWeekendStatus;
  today: string;
  isExpired: boolean;
  weekId: string | null;
  snapshot: WeekendPlannerSnapshot | null;
  historicalSnapshot: WeekendPlannerSnapshot | null;
  statusHeadline: string;
  statusDetail: string;
}

export interface WeekendWeekBundle {
  effectiveStatus: EffectiveWeekendStatus;
  today: string;
  isExpired: boolean;
  weekId: string;
  snapshot: WeekendPlannerSnapshot;
}

export type WeekendStatePostBody =
  | {
      action: "selectProposal";
      weekId: string;
      proposalId: string | null;
      departure?: DepartureKey;
    }
  | {
      action: "ackFridayAlert";
      weekId: string;
      adoptedSwap: boolean;
    }
  | {
      action: "submitSundayFeedback";
      weekId: string;
      outcome: SundayOutcome;
      tags?: string[];
      proposalId?: string | null;
      receiptKey?: string;
    }
  | {
      action: "excludeType";
      mode: "add" | "remove";
      experienceType: string;
      label?: string;
      addedBy?: string;
      note?: string;
      weekId?: string;
    };

export interface WeekendStateGetResponse {
  ok: true;
  state: WeekendStateFile;
  excludedExperienceTypes: ExcludedExperienceTypeItem[];
}

export interface WeekendStatePostResponse {
  ok: true;
  state: WeekendStateFile | null;
  excludedExperienceTypes: ExcludedExperienceTypeItem[];
  deduplicated?: boolean;
}
