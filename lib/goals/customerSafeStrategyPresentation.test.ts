import assert from "node:assert/strict";
import { test } from "node:test";
import { buildCustomerSafeStrategyPresentation } from "./customerSafeStrategyPresentation";
import type { Goal } from "./types";
import type {
  PersonalizedStrategy,
  StrategyAction,
  StrategyAllocationScenario,
  StrategyAlternative,
  StrategyAwardOption,
  StrategyPointsAllocation,
  StrategyPointsInventoryItem,
} from "./strategyTypes";

const goal: Goal = {
  id: "goal-private",
  userId: "user-private",
  type: "travel",
  title: "Paris",
  status: "active",
  origin: ["DEN"],
  destinations: ["Paris"],
  earliestDeparture: "2027-04-03",
  latestReturn: "2027-04-30",
  minimumNights: 8,
  maximumNights: 16,
  travelerCount: 2,
  cabinPreference: "economy",
  optimizationPriority: "balanced",
  maximumCashBudget: 2000,
  currency: "USD",
  allowNewCards: false,
  createdAt: "2026-08-01T00:00:00.000Z",
  updatedAt: "2026-08-01T00:00:00.000Z",
};

type OptionOverrides = Partial<StrategyAwardOption>;
type AccountOverrides = Partial<StrategyPointsInventoryItem>;
type AllocationOverrides = Partial<StrategyPointsAllocation>;
type ScenarioOverrides = Partial<StrategyAllocationScenario>;

function inventoryAccount(overrides: AccountOverrides = {}): StrategyPointsInventoryItem {
  return {
    accountId: "account-a",
    rewardProgramId: "program-a",
    programName: "Program A",
    ownerLabel: "You",
    ownerType: "self",
    balance: 80_000,
    balanceAsOf: "2027-01-01",
    origin: "manual",
    verificationStatus: "verified",
    ...overrides,
  };
}

function allocation(overrides: AllocationOverrides = {}): StrategyPointsAllocation {
  return {
    accountId: "account-a",
    rewardProgramId: "program-a",
    programName: "Allocation supplied program",
    ownerLabel: "Allocation supplied owner",
    fundingMethod: "direct_program",
    availablePoints: 999_999,
    plannedPoints: 10_000,
    remainingPoints: 70_000,
    pointsGap: 0,
    ...overrides,
  };
}

function awardOption(
  id: string,
  redemptionType: "flight" | "hotel",
  overrides: OptionOverrides = {},
): StrategyAwardOption {
  return {
    id,
    sourceId: `source-${id}`,
    programName: "Program A",
    redemptionType,
    pricingBasis: redemptionType === "flight" ? "round_trip" : "per_night",
    itineraryLabel: "Paris planning estimate",
    pointsRequired: 10_000,
    cashFees: null,
    seats: null,
    cabin: "economy",
    transferFromProgramId: null,
    transferRatio: null,
    centsPerPoint: null,
    availabilityStatus: "unknown",
    evidenceLevel: "planning_benchmark",
    travelerCountCovered: redemptionType === "flight" ? 2 : null,
    nightCountCovered: redemptionType === "hotel" ? 1 : null,
    coverageStatus: "source_explicit",
    ...overrides,
  };
}

function scenario(overrides: ScenarioOverrides = {}): StrategyAllocationScenario {
  return {
    id: "scenario-a",
    kind: "balanced",
    title: "Balanced scenario",
    status: "feasible",
    flightOptionId: "flight-1",
    hotelOptionId: "hotel-1",
    flightPointsRequired: 10_000,
    hotelPointsRequired: 10_000,
    travelerCount: 2,
    tripNights: 8,
    allocations: [],
    assumptions: [],
    warnings: [],
    ...overrides,
  };
}

function action(overrides: Partial<StrategyAction> = {}): StrategyAction {
  return {
    priority: 1,
    title: "Check the saved details",
    explanation: "Confirm the planning details before acting.",
    deadline: null,
    sourceIds: ["source-action"],
    ...overrides,
  };
}

function alternative(overrides: Partial<StrategyAlternative> = {}): StrategyAlternative {
  return {
    title: "A flexible alternative",
    tradeoff: "This may change the timing.",
    sourceIds: ["source-alternative"],
    ...overrides,
  };
}

function baseStrategy(overrides: Partial<PersonalizedStrategy> = {}): PersonalizedStrategy {
  return {
    headline: "A planning strategy",
    summary: "Use your points carefully.",
    feasibility: "insufficient_information",
    pointsGap: null,
    recommendedAwardOptionId: null,
    recommendedCardOfferId: null,
    flightOptions: [1, 2, 3, 4].map((id) => awardOption(`flight-${id}`, "flight")),
    hotelOptions: [1, 2, 3, 4].map((id) => awardOption(`hotel-${id}`, "hotel")),
    actions: [action()],
    alternatives: [1, 2, 3].map((id) => alternative({ title: `Alternative ${id}` })),
    assumptions: ["The saved dates are flexible for planning."],
    warnings: ["Check current availability before acting."],
    followUpQuestions: ["Which cabin do you prefer?"],
    pointsInventory: [inventoryAccount()],
    allocationScenarios: [scenario()],
    currentCashOptions: [],
    customerVerifiedOptions: [],
    ...overrides,
  };
}

function build(
  strategy: PersonalizedStrategy = baseStrategy(),
  generatedAt: string | null = "2027-01-02T03:04:05.000Z",
) {
  return buildCustomerSafeStrategyPresentation(goal, strategy, generatedAt);
}

function withExtras<T extends object>(value: T, extras: Record<string, unknown>): T {
  return Object.assign(value, extras);
}

function serialized(value: unknown): string {
  return JSON.stringify(value);
}

test("builds strategy-first presentation with deterministic caps and safe labels", () => {
  const view = build();

  assert.equal(view.strategy.headline, "A planning strategy");
  assert.equal(view.flightEstimates.length, 3);
  assert.equal(view.hotelEstimates.length, 3);
  assert.equal(view.alternatives.length, 2);
  assert.equal(view.flightEstimates[0]?.evidenceLabel, "Planning estimate");
  assert.equal(view.details.evidenceLabels.includes("Planning estimate"), true);
  assert.equal(view.goal.dateWindowIsFlexible, true);
  assert.equal(view.lastResearched, "2027-01-02T03:04:05.000Z");
  assert.equal(view.refinementTopics.length, 1);
});

test("keeps scenarios and account ownership separate while omitting empty future lanes", () => {
  const view = build();

  assert.equal(view.rewards.scenarios.length, 1);
  assert.equal(view.rewards.verified.length, 1);
  assert.equal(serialized(view).includes("currentCashOptions"), false);
  assert.equal(serialized(view).includes("customerVerifiedOptions"), false);
  assert.equal(view.rewards.summary.includes("Accounts and programs remain separate."), true);
});

test("resolves same-program accounts by account identity and does not merge balances", () => {
  const first = inventoryAccount({
    accountId: "account-same-program-1",
    rewardProgramId: "program-same",
    programName: "Same Rewards",
    ownerLabel: "You",
    balance: 80_000,
    verificationStatus: "verified",
  });
  const second = inventoryAccount({
    accountId: "account-same-program-2",
    rewardProgramId: "program-same",
    programName: "Same Rewards",
    ownerLabel: "Alex",
    ownerType: "companion",
    balance: 12_000,
    verificationStatus: "unverified",
  });
  const view = build(baseStrategy({
    pointsInventory: [first, second],
    allocationScenarios: [scenario({
      allocations: [
        allocation({ accountId: first.accountId, rewardProgramId: "wrong-program", programName: "Wrong program", ownerLabel: "Wrong owner" }),
        allocation({ accountId: second.accountId, rewardProgramId: "wrong-program-2", programName: "Another wrong program", ownerLabel: "Another wrong owner" }),
      ],
    })],
  }));

  assert.deepEqual(view.rewards.verified.map((item) => [item.programName, item.ownerLabel, item.balance]), [["Same Rewards", "You", 80_000]]);
  assert.deepEqual(view.rewards.unverified.map((item) => [item.programName, item.ownerLabel, item.balance]), [["Same Rewards", "Alex", 12_000]]);
  assert.deepEqual(view.rewards.scenarios[0]?.allocations.map((item) => [item.programName, item.ownerLabel, item.availablePoints, item.verificationLabel]), [
    ["Same Rewards", "You", 80_000, "Confirmed rewards balance"],
    ["Same Rewards", "Alex", 12_000, "Balance needs confirmation"],
  ]);
  assert.equal(serialized(view).includes("92000"), false);
  assert.equal(serialized(view).includes("Wrong program"), false);
  assert.equal(serialized(view).includes("Wrong owner"), false);
});

test("preserves owner and verification distinctions across different programs", () => {
  const view = build(baseStrategy({
    pointsInventory: [
      inventoryAccount({ accountId: "account-owner-you", rewardProgramId: "program-one", programName: "Rewards One", ownerLabel: "You", ownerType: "self", balance: 50_000, verificationStatus: "verified" }),
      inventoryAccount({ accountId: "account-owner-companion", rewardProgramId: "program-two", programName: "Rewards Two", ownerLabel: "Jordan", ownerType: "companion", balance: 30_000, verificationStatus: "unverified" }),
    ],
  }));

  assert.equal(view.rewards.confirmedCount, 1);
  assert.equal(view.rewards.needsConfirmationCount, 1);
  assert.deepEqual(view.rewards.verified.map((item) => item.ownerLabel), ["You"]);
  assert.deepEqual(view.rewards.unverified.map((item) => item.ownerLabel), ["Jordan"]);
  assert.equal(serialized(view).includes("80000"), false);
});

test("ignores conflicting allocation identity labels and uses neutral labels for missing accounts", () => {
  const view = build(baseStrategy({
    pointsInventory: [inventoryAccount({ accountId: "account-real", programName: "Inventory Rewards", ownerLabel: "Inventory Owner", balance: 42_000 })],
    allocationScenarios: [scenario({
      allocations: [
        allocation({
          accountId: "account-real",
          programName: "Forged Allocation Program",
          ownerLabel: "Forged Allocation Owner",
          rewardProgramId: "forged-program",
        }),
        allocation({
          accountId: "account-missing",
          programName: "Fallback Program Must Not Appear",
          ownerLabel: "Fallback Owner Must Not Appear",
          availablePoints: 1_000_000,
        }),
      ],
    })],
  }));
  const [resolved, unresolved] = view.rewards.scenarios[0]?.allocations ?? [];
  const output = serialized(view);

  assert.equal(resolved?.programName, "Inventory Rewards");
  assert.equal(resolved?.ownerLabel, "Inventory Owner");

  const hostileLabelView = build(baseStrategy({
    pointsInventory: [inventoryAccount({ accountId: "account-safe", programName: "https://hostile.example/program" })],
    allocationScenarios: [scenario({ allocations: [allocation({ accountId: "account-safe" })] })],
  }));
  assert.equal(hostileLabelView.rewards.scenarios[0]?.allocations[0]?.programName, "Reward program");
  assert.equal(serialized(hostileLabelView).includes("https://hostile.example/program"), false);
  assert.equal(resolved?.availablePoints, 42_000);
  assert.equal(unresolved?.programName, "Rewards account not confirmed");
  assert.equal(unresolved?.ownerLabel, "Rewards account not confirmed");
  assert.equal(unresolved?.ownerType, null);
  assert.equal(unresolved?.availablePoints, null);
  assert.equal(unresolved?.verificationLabel, "Rewards account not confirmed");
  assert.equal(output.includes("account-missing"), false);
  assert.equal(output.includes("Forged Allocation Program"), false);
  assert.equal(output.includes("Fallback Owner Must Not Appear"), false);
});

test("retains only finite allocation numbers and never treats malformed values as amounts", () => {
  const malformed = [Number.NaN, Number.POSITIVE_INFINITY, Number.NEGATIVE_INFINITY, "12000", { amount: 1 }] as unknown as number[];
  const view = build(baseStrategy({
    allocationScenarios: [scenario({
      allocations: malformed.map((value, index) => allocation({
        accountId: "account-a",
        plannedPoints: value,
        remainingPoints: value,
        pointsGap: value,
        availablePoints: value,
      })),
    })],
  }));

  for (const item of view.rewards.scenarios[0]?.allocations ?? []) {
    assert.equal(item.plannedPoints, null);
    assert.equal(item.remainingPoints, null);
    assert.equal(item.pointsGap, null);
    assert.equal(item.availablePoints, 80_000);
  }
  assert.equal(serialized(view).includes("Infinity"), false);
  assert.equal(serialized(view).includes("12000"), false);
});

const scenarioKindLabels: Array<[StrategyAllocationScenario["kind"], string]> = [
  ["flight_first", "Flight-first points planning"],
  ["hotel_first", "Hotel-first points planning"],
  ["balanced", "Balanced points planning"],
  ["fallback", "Planning path"],
];
for (const [kind, expected] of scenarioKindLabels) {
  test(`maps scenario kind ${kind} to a safe label`, () => {
    const view = build(baseStrategy({ allocationScenarios: [scenario({ kind })] }));
    assert.equal(view.rewards.scenarios[0]?.label, expected);
  });
}

const fundingLabels: Array<[StrategyPointsAllocation["fundingMethod"], string]> = [
  ["transfer_source", "Potential transfer path"],
  ["direct_program", "Use this confirmed rewards account"],
];
for (const [fundingMethod, expected] of fundingLabels) {
  test(`maps funding method ${fundingMethod} to a safe label`, () => {
    const view = build(baseStrategy({ allocationScenarios: [scenario({ allocations: [allocation({ fundingMethod })] })] }));
    assert.equal(view.rewards.scenarios[0]?.allocations[0]?.fundingLabel, expected);
  });
}

const pricingLabels: Array<[StrategyAwardOption["pricingBasis"], string]> = [
  ["one_way", "One way"],
  ["round_trip", "Round trip"],
  ["per_night", "Per night"],
  ["total_stay", "Total stay"],
  ["unknown", "Pricing basis not confirmed"],
];
for (const [pricingBasis, expected] of pricingLabels) {
  test(`maps pricing basis ${pricingBasis} to a safe label`, () => {
    const view = build(baseStrategy({
      flightOptions: [awardOption("flight-mapping", "flight", { pricingBasis })],
      hotelOptions: [],
    }));
    assert.equal(view.flightEstimates[0]?.pricingLabel, expected);
  });
}

const coverageLabels: Array<[NonNullable<StrategyAwardOption["coverageStatus"]>, string]> = [
  ["source_explicit", "Coverage stated by the research source"],
  ["standard_assumption", "Uses a planning assumption"],
  ["unknown", "Coverage not confirmed"],
];
for (const [coverageStatus, expected] of coverageLabels) {
  test(`maps coverage ${coverageStatus} to a safe label`, () => {
    const view = build(baseStrategy({
      flightOptions: [awardOption("flight-coverage", "flight", { coverageStatus })],
      hotelOptions: [],
    }));
    assert.equal(view.flightEstimates[0]?.coverageLabel, expected);
  });
}

const statusLabels: Array<[StrategyAllocationScenario["status"], string]> = [
  ["feasible", "Planning scenario"],
  ["gap", "We don’t see a confirmed rewards balance that can fund this option."],
  ["conditional", "Conditional planning scenario"],
  ["insufficient_information", "We can’t work out the full points requirement yet."],
];
for (const [status, expected] of statusLabels) {
  test(`maps scenario status ${status} to a safe label`, () => {
    const view = build(baseStrategy({ allocationScenarios: [scenario({ status })] }));
    assert.equal(view.rewards.scenarios[0]?.statusLabel, expected);
  });
}

test("uses fixed neutral labels for unknown runtime enum values", () => {
  const unknownKind = "unknown_scenario_kind";
  const unknownFunding = "unknown_funding_method";
  const unknownPricing = "unknown_pricing_basis";
  const unknownCoverage = "unknown_coverage_state";
  const unknownStatus = "unknown_scenario_status";
  const view = build(baseStrategy({
    flightOptions: [awardOption("flight-unknown", "flight", {
      pricingBasis: unknownPricing as StrategyAwardOption["pricingBasis"],
      coverageStatus: unknownCoverage as NonNullable<StrategyAwardOption["coverageStatus"]>,
    })],
    hotelOptions: [],
    allocationScenarios: [scenario({
      kind: unknownKind as StrategyAllocationScenario["kind"],
      status: unknownStatus as StrategyAllocationScenario["status"],
      allocations: [allocation({ fundingMethod: unknownFunding as StrategyPointsAllocation["fundingMethod"] })],
    })],
  }));
  const output = serialized(view);

  assert.equal(view.flightEstimates[0]?.pricingLabel, "Pricing basis not confirmed");
  assert.equal(view.flightEstimates[0]?.coverageLabel, "Coverage not confirmed");
  assert.equal(view.rewards.scenarios[0]?.label, "Planning path");
  assert.equal(view.rewards.scenarios[0]?.statusLabel, "More information needed");
  assert.equal(view.rewards.scenarios[0]?.allocations[0]?.fundingLabel, "Funding method not confirmed");
  for (const raw of [unknownKind, unknownFunding, unknownPricing, unknownCoverage, unknownStatus]) {
    assert.equal(output.includes(raw), false, raw);
  }
});

test("filters unsafe model sentences without leaving fragments", () => {
  const view = build(baseStrategy({
    headline: "A safe headline. This is bookable and guaranteed.",
    summary: "Safe opening. This is available for booking. Safe middle. See https://example.test/source. Safe ending.",
    actions: [action({
      title: "Safe action",
      explanation: "Safe action context. Live results are available now. Continue with the saved plan.",
    })],
    alternatives: [alternative({
      title: "Alternative with exact availability.",
      tradeoff: "A safe tradeoff remains.",
    })],
    assumptions: ["Safe assumption. The provider payload says guaranteed results."],
    warnings: ["Safe warning. See source-123 for validation details."],
    followUpQuestions: ["Safe topic. This stay is bookable."],
  }));
  const output = serialized(view);

  assert.equal(view.strategy.headline, "A safe headline.");
  assert.equal(view.strategy.summary, "Safe opening. Safe middle. Safe ending.");
  assert.equal(view.strategy.actions[0]?.explanation, "Safe action context. Continue with the saved plan.");
  assert.equal(view.alternatives[0]?.tradeoff, "A safe tradeoff remains.");
  assert.deepEqual(view.details.assumptions, ["Safe assumption."]);
  assert.deepEqual(view.details.warnings, ["Safe warning."]);
  assert.deepEqual(view.refinementTopics, ["Safe topic."]);
  for (const forbidden of ["bookable", "guaranteed", "available for booking", "https://example.test", "source-123", "payload", "validation", "Live results"]) {
    assert.equal(output.includes(forbidden), false, forbidden);
  }
});

test("uses the fixed planning fallback when all narrative sentences are unsafe", () => {
  const view = build(baseStrategy({
    headline: "This is live.",
    summary: "This exact availability is guaranteed and bookable.",
    actions: [action({ title: "This is live.", explanation: "Available for booking." })],
    alternatives: [alternative({ title: "This is bookable.", tradeoff: "This is guaranteed." })],
    assumptions: ["https://example.test/source"],
    warnings: ["provider payload validation stage"],
    followUpQuestions: ["This is live."],
  }));

  assert.equal(view.strategy.headline, "Your planning strategy");
  assert.equal(view.strategy.summary, "Planning guidance based on your saved goal.");
  assert.equal(view.strategy.actions[0]?.title, "Planning action");
  assert.equal(view.strategy.actions[0]?.explanation, "");
  assert.equal(view.alternatives[0]?.title, "Planning alternative");
  assert.equal(view.alternatives[0]?.tradeoff, "");
  assert.deepEqual(view.details.assumptions, []);
  assert.deepEqual(view.details.warnings, []);
  assert.deepEqual(view.refinementTopics, []);
});

test("recursively allowlists every raw boundary and drops hostile sentinels", () => {
  const sentinelValues = [
    "hostile-account-id",
    "hostile-customer-id",
    "hostile-goal-id",
    "hostile-program-id",
    "hostile-source-id",
    "https://hostile.example/secret",
    "hostile-provider-payload",
    "hostile-model-reference",
    "hostile-signature",
    "hostile-secret",
    "hostile-raw-content",
    "hostile-database-metadata",
  ];
  const hostile = Object.fromEntries(sentinelValues.map((value, index) => [`hostileKey${index}`, value]));
  const hostileAccount = withExtras(inventoryAccount({ accountId: "raw-account-id" }), { ...hostile, nested: { hostile: sentinelValues } });
  const hostileAllocation = withExtras(allocation({ accountId: "raw-account-id" }), { ...hostile, nested: [{ hostile: sentinelValues }] });
  const hostileScenario = withExtras(scenario({ allocations: [hostileAllocation] }), { ...hostile, nested: { hostile: sentinelValues } });
  const hostileFlight = withExtras(awardOption("raw-flight-id", "flight"), { ...hostile, nested: { hostile: sentinelValues } });
  const hostileHotel = withExtras(awardOption("raw-hotel-id", "hotel"), { ...hostile, nested: [{ hostile: sentinelValues }] });
  const hostileAction = withExtras(action(), { ...hostile, nested: { hostile: sentinelValues } });
  const hostileAlternative = withExtras(alternative(), { ...hostile, nested: [{ hostile: sentinelValues }] });
  const hostileGoal = withExtras(goal, { ...hostile, nested: { hostile: sentinelValues } });
  const assumptions = withExtras(["Safe assumption."], { ...hostile, nested: sentinelValues });
  const warnings = withExtras(["Safe warning."], { ...hostile, nested: sentinelValues });
  const strategy = withExtras(baseStrategy({
    flightOptions: [hostileFlight],
    hotelOptions: [hostileHotel],
    actions: [hostileAction],
    alternatives: [hostileAlternative],
    assumptions,
    warnings,
    followUpQuestions: ["Safe topic."],
    pointsInventory: [hostileAccount],
    allocationScenarios: [hostileScenario],
  }), { ...hostile, nested: { hostile: sentinelValues } });
  const output = serialized(buildCustomerSafeStrategyPresentation(hostileGoal, strategy));

  for (const value of sentinelValues) {
    assert.equal(output.includes(value), false, value);
  }
  for (const key of Object.keys(hostile)) {
    assert.equal(output.includes(key), false, key);
  }
  for (const forbidden of [
    "raw-account-id",
    "raw-flight-id",
    "raw-hotel-id",
    "source-",
    "https://",
    "payload",
    "signature",
    "validation",
    "stage",
    "provider",
    "model",
    "database",
  ]) {
    assert.equal(output.toLowerCase().includes(forbidden), false, forbidden);
  }
});

test("keeps native coverage and amounts without extrapolating totals", () => {
  const view = build(baseStrategy({
    flightOptions: [awardOption("flight-native", "flight", {
      pricingBasis: "one_way",
      pointsRequired: 25_000,
      cashFees: 95,
      travelerCountCovered: 1,
      coverageStatus: "source_explicit",
    })],
    hotelOptions: [awardOption("hotel-native", "hotel", {
      pricingBasis: "per_night",
      pointsRequired: 30_000,
      nightCountCovered: 1,
      coverageStatus: "standard_assumption",
    })],
  }));

  assert.equal(view.flightEstimates[0]?.pricingLabel, "One way");
  assert.equal(view.flightEstimates[0]?.travelerCountCovered, 1);
  assert.equal(view.flightEstimates[0]?.pointsRequired, 25_000);
  assert.equal(view.flightEstimates[0]?.cashFees, 95);
  assert.equal(view.hotelEstimates[0]?.pricingLabel, "Per night");
  assert.equal(view.hotelEstimates[0]?.nightCountCovered, 1);
  assert.equal(view.hotelEstimates[0]?.pointsRequired, 30_000);
  assert.equal(serialized(view).includes("240000"), false);
});

test("maps every saved optimization priority to a fixed customer label", () => {
  const cases = [
    ["lowest_cash", "Lowest cash cost"],
    ["best_experience", "Best experience"],
    ["simplest", "Simplest path"],
    ["balanced", "Balanced"],
  ] as const;
  for (const [optimizationPriority, expected] of cases) {
    const view = buildCustomerSafeStrategyPresentation(
      { ...goal, optimizationPriority },
      baseStrategy(),
    );
    assert.equal(view.goal.priority, expected);
  }
});

test("maps every saved cabin preference to a fixed customer label", () => {
  const cases = [
    ["economy", "Economy"],
    ["premium_economy", "Premium economy"],
    ["business", "Business"],
    ["first", "First class"],
    ["flexible", "Flexible"],
  ] as const;
  for (const [cabinPreference, expected] of cases) {
    const view = buildCustomerSafeStrategyPresentation(
      { ...goal, cabinPreference },
      baseStrategy(),
    );
    assert.equal(view.goal.cabin, expected);
  }
});

test("uses neutral labels for unknown goal priority and cabin values", () => {
  const view = buildCustomerSafeStrategyPresentation(
    {
      ...goal,
      optimizationPriority: "future_priority" as Goal["optimizationPriority"],
      cabinPreference: "future_cabin" as Goal["cabinPreference"],
    },
    baseStrategy(),
  );
  assert.equal(view.goal.priority, "Planning preferences saved");
  assert.equal(view.goal.cabin, "Cabin preference saved");
  const output = serialized(view);
  assert.equal(output.includes("future_priority"), false);
  assert.equal(output.includes("future_cabin"), false);
});

test("accepts safe goal labels and rejects URLs, controls, internal tokens, and overlong values", () => {
  const view = buildCustomerSafeStrategyPresentation(
    {
      ...goal,
      origin: ["  New   York (JFK)  ", "https://unsafe.example", "bad\u0000place", "account-123", "x".repeat(121)],
      destinations: ["  Paris, France  ", "program-456", "https://unsafe.example/destination"],
    },
    baseStrategy(),
  );
  assert.equal(view.goal.route, "New York (JFK) → Paris, France");
  assert.equal(view.goal.route.includes("unsafe.example"), false);
  assert.equal(view.goal.route.includes("account-123"), false);
  assert.equal(view.goal.route.includes("program-456"), false);
});

test("omits invalid displayed goal and estimate amounts without replacement calculations", () => {
  const view = buildCustomerSafeStrategyPresentation(
    {
      ...goal,
      travelerCount: Number.NaN,
      minimumNights: -2,
      maximumNights: "8" as unknown as number,
      maximumCashBudget: Number.POSITIVE_INFINITY,
    },
    baseStrategy({
      allocationScenarios: [],
      pointsInventory: [inventoryAccount({ balance: Number.POSITIVE_INFINITY })],
      flightOptions: [awardOption("invalid-flight", "flight", {
        pointsRequired: Number.NaN,
        cashFees: -5,
        seats: "2" as unknown as number,
      })],
      hotelOptions: [awardOption("invalid-hotel", "hotel", {
        pointsRequired: Number.POSITIVE_INFINITY,
        cashFees: "95" as unknown as number,
        seats: -1,
      })],
    }),
  );
  const output = serialized(view);

  assert.equal(view.goal.travelerCount, null);
  assert.equal(view.goal.nights, null);
  assert.equal(view.goal.budget, null);
  assert.equal(view.rewards.verified[0]?.balance, null);
  assert.equal(view.flightEstimates[0]?.pointsRequired, null);
  assert.equal(view.flightEstimates[0]?.cashFees, null);
  assert.equal(view.flightEstimates[0]?.seats, null);
  assert.equal(view.hotelEstimates[0]?.pointsRequired, null);
  assert.equal(view.hotelEstimates[0]?.cashFees, null);
  assert.equal(view.hotelEstimates[0]?.seats, null);
  assert.equal(output.includes("Infinity"), false);
  assert.equal(output.includes("NaN"), false);
  assert.equal(output.includes('"8"'), false);
});

test("clears every identity-dependent field for an unresolved allocation", () => {
  const view = build(baseStrategy({
    allocationScenarios: [scenario({
      allocations: [allocation({
        accountId: "missing-attractive-account",
        programName: "Misleading Program",
        ownerLabel: "Misleading Owner",
        fundingMethod: "transfer_source",
        availablePoints: 500_000,
        plannedPoints: 100_000,
        remainingPoints: 400_000,
        pointsGap: 0,
      })],
    })],
  }));
  const item = view.rewards.scenarios[0]?.allocations[0];

  assert.deepEqual(item, {
    key: "allocation-1-1",
    programName: "Rewards account not confirmed",
    ownerLabel: "Rewards account not confirmed",
    ownerType: null,
    fundingLabel: null,
    availablePoints: null,
    plannedPoints: null,
    remainingPoints: null,
    pointsGap: null,
    verificationLabel: "Rewards account not confirmed",
  });
  const output = serialized(view);
  for (const forbidden of ["missing-attractive-account", "Misleading Program", "Misleading Owner", "500000", "100000", "400000", "transfer_source"]) {
    assert.equal(output.includes(forbidden), false, forbidden);
  }
});

test("keeps finite deterministic values for a resolved allocation", () => {
  const view = build(baseStrategy({
    allocationScenarios: [scenario({
      allocations: [allocation({
        plannedPoints: 12_000,
        remainingPoints: 68_000,
        pointsGap: 2_000,
      })],
    })],
  }));
  const item = view.rewards.scenarios[0]?.allocations[0];

  assert.equal(item?.availablePoints, 80_000);
  assert.equal(item?.plannedPoints, 12_000);
  assert.equal(item?.remainingPoints, 68_000);
  assert.equal(item?.pointsGap, 2_000);
});

test("drops hostile object elements from lists and follow-up topics", () => {
  const hostileElement = { sentinel: "hostile-list-value", nested: { sourceId: "source-hostile" } } as unknown as string;
  const view = build(baseStrategy({
    assumptions: ["Keep this assumption.", hostileElement],
    warnings: [hostileElement, "Keep this warning."],
    followUpQuestions: [hostileElement, "Keep this topic."],
  }));
  const output = serialized(view);

  assert.deepEqual(view.details.assumptions, ["Keep this assumption."]);
  assert.deepEqual(view.details.warnings, ["Keep this warning."]);
  assert.deepEqual(view.refinementTopics, ["Keep this topic."]);
  assert.equal(output.includes("hostile-list-value"), false);
  assert.equal(output.includes("source-hostile"), false);
});
