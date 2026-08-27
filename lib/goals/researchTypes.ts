export type ResearchSourceTier = "official" | "specialist" | "general";

export interface ResearchQuery {
  query: string;
  includeDomains: string[];
  maxResults?: number;
  /** Search depth preference. Defaults to "basic" when absent. */
  searchDepth?: "basic" | "advanced";
}

export interface ResearchResult {
  title: string;
  url: string;
  content: string;
  score: number | null;
  publishedDate: string | null;
  sourceTier: ResearchSourceTier;
}

export interface ResearchResponse {
  query: string;
  results: ResearchResult[];
  searchedAt: string;
}

export interface ResearchProvider {
  search(input: ResearchQuery): Promise<ResearchResponse>;
}

export const CARD_PROGRAM_DOMAINS: readonly string[] = Object.freeze([
  "chase.com",
  "americanexpress.com",
  "capitalone.com",
  "citi.com",
  "wellsfargo.com",
  "bilt.com",
]);

export const FLIGHT_OFFICIAL_DOMAINS: readonly string[] = Object.freeze([
  "united.com",
  "aircanada.com",
  "flyingblue.us",
  "britishairways.com",
  "southwest.com",
]);

export const HOTEL_OFFICIAL_DOMAINS: readonly string[] = Object.freeze([
  "hyatt.com",
  "marriott.com",
  "ihg.com",
  "hilton.com",
]);

export const OFFICIAL_DOMAINS: readonly string[] = Object.freeze([
  ...CARD_PROGRAM_DOMAINS,
  ...FLIGHT_OFFICIAL_DOMAINS,
  ...HOTEL_OFFICIAL_DOMAINS,
]);

export const SPECIALIST_DOMAINS: readonly string[] = Object.freeze([
  "awardwallet.com",
  "frequentmiler.com",
  "upgradedpoints.com",
  "thepointsguy.com",
  "onemileatatime.com",
  "liveandletsfly.com",
  "nerdwallet.com",
  "milevalue.com",
]);

export const TRUSTED_DOMAINS: readonly string[] = Object.freeze([
  ...OFFICIAL_DOMAINS,
  ...SPECIALIST_DOMAINS,
]);
