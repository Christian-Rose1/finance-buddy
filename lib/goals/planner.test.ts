import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { calculateGoalPlanOption } from "./planner";
import type {
  CalculateGoalPlanOptionInput,
  GoalPlanScenario,
  ProgramPointsProjection,
  ProgramPointsRequirement,
  RewardAccount,
} from "./types";

// Factory helpers
function createRewardAccount(
  id: string,
  ownerKey: string,
  ownerLabel: string,
  ownerType: "self" | "companion",
  balance: number,
  verificationStatus: "unverified" | "verified"
): RewardAccount {
  return {
    id,
    userId: "test-user",
    rewardProgramId: "test-program",
    ownerKey,
    ownerLabel,
    ownerType,
    balance,
    balanceAsOf: "2026-08-19",
    origin: "manual",
    verificationStatus,
    createdAt: "2026-08-19",
    updatedAt: "2026-08-19",
  };
}

function createProjection(
  ownerKey: string,
  projectedOrganicPoints: number,
  conditionalPoints: number
): ProgramPointsProjection {
  return {
    ownerKey,
    rewardProgramId: "test-program",
    projectedOrganicPoints,
    conditionalPoints,
  };
}

function createRequirement(
  ownerKey: string,
  requiredPoints: number
): ProgramPointsRequirement {
  return {
    ownerKey,
    rewardProgramId: "test-program",
    requiredPoints,
  };
}

function createScenario(
  name: string,
  requirements: ProgramPointsRequirement[],
  estimatedTaxesAndFees: number,
  estimatedAnnualFees: number,
  assumptions: string[] = [],
  warnings: string[] = []
): GoalPlanScenario {
  return {
    id: "test-scenario",
    name,
    requirements,
    estimatedTaxesAndFees,
    estimatedAnnualFees,
    currency: "USD",
    availabilityStatus: "planning_estimate",
    assumptions,
    warnings,
  };
}

// Test 1: No requirements
describe("calculateGoalPlanOption - No Requirements", () => {
  it("returns insufficient_information when no requirements", () => {
    const input: CalculateGoalPlanOptionInput = {
      rewardAccounts: [],
      projections: [],
      scenario: createScenario("Test", [], 100, 50),
    };

    const result = calculateGoalPlanOption(input);

    assert.strictEqual(result.feasibility, "insufficient_information");
    assert.strictEqual(result.programFunding.length, 0);
  });
});

// Test 2: Verified versus unverified balances
describe("calculateGoalPlanOption - Verified vs Unverified Balances", () => {
  it("correctly calculates gaps and feasibility with mixed verification status", () => {
    const input: CalculateGoalPlanOptionInput = {
      rewardAccounts: [
        createRewardAccount("1", "self", "Self", "self", 40, "verified"),
        createRewardAccount("2", "self", "Self", "self", 30, "unverified"),
      ],
      projections: [
        createProjection("self", 20, 10),
      ],
      scenario: createScenario("Test", [createRequirement("self", 100)], 100, 50),
    };

    const result = calculateGoalPlanOption(input);

    // Assert totals
    const funding = result.programFunding[0];
    assert.strictEqual(funding.verifiedCurrentPoints, 40);
    assert.strictEqual(funding.unverifiedCurrentPoints, 30);
    assert.strictEqual(funding.projectedOrganicPoints, 20);
    assert.strictEqual(funding.conditionalPoints, 10);

    // Assert gaps
    assert.strictEqual(funding.onTrackGap, 40); // 100 - 40 - 20
    assert.strictEqual(funding.verifiedPlusUnverifiedGap, 10); // 100 - 40 - 30 - 20
    assert.strictEqual(funding.optimisticGap, 0); // 100 - 40 - 30 - 20 - 10

    // Assert feasibility
    assert.strictEqual(result.feasibility, "depends_on_conditional_points");
  });
});

// Test 3: Duplicate requirements
describe("calculateGoalPlanOption - Duplicate Requirements", () => {
  it("aggregates duplicate requirements for the same owner/program", () => {
    const input: CalculateGoalPlanOptionInput = {
      rewardAccounts: [
        createRewardAccount("1", "self", "Self", "self", 100, "verified"),
      ],
      projections: [],
      scenario: createScenario(
        "Test",
        [
          createRequirement("self", 60),
          createRequirement("self", 40),
        ],
        100,
        50
      ),
    };

    const result = calculateGoalPlanOption(input);

    assert.strictEqual(result.programFunding.length, 1);
    assert.strictEqual(result.programFunding[0].requiredPoints, 100);
  });
});

// Test 4: Colon-containing owner key isolation
describe("calculateGoalPlanOption - Colon-Containing Owner Key Isolation", () => {
  it("does not use self points for companion requirement", () => {
    const input: CalculateGoalPlanOptionInput = {
      rewardAccounts: [
        createRewardAccount("1", "self", "Self", "self", 100, "verified"),
        createRewardAccount("2", "companion:1", "Companion 1", "companion", 50, "verified"),
      ],
      projections: [],
      scenario: createScenario(
        "Test",
        [
          createRequirement("companion:1", 50),
        ],
        100,
        50
      ),
    };

    const result = calculateGoalPlanOption(input);

    // Companion requirement should only see companion points
    assert.strictEqual(result.programFunding.length, 1);
    assert.strictEqual(result.programFunding[0].requiredPoints, 50);
    assert.strictEqual(result.programFunding[0].verifiedCurrentPoints, 50);
  });
});

// Test 5: Program isolation
describe("calculateGoalPlanOption - Program Isolation", () => {
  it("aggregates all accounts with the same ownerKey and programId", () => {
    const input: CalculateGoalPlanOptionInput = {
      rewardAccounts: [
        createRewardAccount("1", "self", "Self", "self", 100, "verified"),
        createRewardAccount("2", "self", "Self", "self", 50, "verified"),
      ],
      projections: [],
      scenario: createScenario(
        "Test",
        [
          createRequirement("self", 100),
        ],
        100,
        50
      ),
    };

    const result = calculateGoalPlanOption(input);

    // All accounts with same ownerKey and programId are aggregated
    assert.strictEqual(result.programFunding.length, 1);
    assert.strictEqual(result.programFunding[0].verifiedCurrentPoints, 150);
  });
});

// Test 6: Feasibility precedence
describe("calculateGoalPlanOption - Feasibility Precedence", () => {
  it("returns on_track when all requirements are on track", () => {
    const input: CalculateGoalPlanOptionInput = {
      rewardAccounts: [
        createRewardAccount("1", "self", "Self", "self", 100, "verified"),
      ],
      projections: [],
      scenario: createScenario("Test", [createRequirement("self", 100)], 100, 50),
    };

    const result = calculateGoalPlanOption(input);
    assert.strictEqual(result.feasibility, "on_track");
  });

  it("returns depends_on_unverified_balances when all gaps are covered by unverified", () => {
    const input: CalculateGoalPlanOptionInput = {
      rewardAccounts: [
        createRewardAccount("1", "self", "Self", "self", 100, "verified"),
        createRewardAccount("2", "self", "Self", "self", 50, "unverified"),
      ],
      projections: [],
      scenario: createScenario("Test", [createRequirement("self", 150)], 100, 50),
    };

    const result = calculateGoalPlanOption(input);
    assert.strictEqual(result.feasibility, "depends_on_unverified_balances");
  });

  it("returns depends_on_conditional_points when all gaps are covered by conditional", () => {
    const input: CalculateGoalPlanOptionInput = {
      rewardAccounts: [
        createRewardAccount("1", "self", "Self", "self", 100, "verified"),
      ],
      projections: [
        createProjection("self", 50, 50),
      ],
      scenario: createScenario("Test", [createRequirement("self", 200)], 100, 50),
    };

    const result = calculateGoalPlanOption(input);
    assert.strictEqual(result.feasibility, "depends_on_conditional_points");
  });

  it("returns gap_remaining when some requirements have gaps", () => {
    const input: CalculateGoalPlanOptionInput = {
      rewardAccounts: [
        createRewardAccount("1", "self", "Self", "self", 100, "verified"),
      ],
      projections: [],
      scenario: createScenario("Test", [createRequirement("self", 150)], 100, 50),
    };

    const result = calculateGoalPlanOption(input);
    assert.strictEqual(result.feasibility, "gap_remaining");
  });
});

// Test 7: Cash and metadata
describe("calculateGoalPlanOption - Cash and Metadata", () => {
  it("calculates total cash correctly", () => {
    const input: CalculateGoalPlanOptionInput = {
      rewardAccounts: [],
      projections: [],
      scenario: createScenario("Test", [], 100, 50),
    };

    const result = calculateGoalPlanOption(input);

    assert.strictEqual(result.totalEstimatedCashCost, 150);
    assert.strictEqual(result.estimatedTaxesAndFees, 100);
    assert.strictEqual(result.estimatedAnnualFees, 50);
  });

  it("copies assumptions and warnings without mutation", () => {
    const assumptions = ["Assumption 1", "Assumption 2"];
    const warnings = ["Warning 1"];

    const input: CalculateGoalPlanOptionInput = {
      rewardAccounts: [],
      projections: [],
      scenario: createScenario("Test", [], 100, 50, assumptions, warnings),
    };

    const result = calculateGoalPlanOption(input);

    assert.deepStrictEqual(result.assumptions, assumptions);
    assert.deepStrictEqual(result.warnings, warnings);

    // Verify no mutation
    assumptions.push("Assumption 3");
    warnings.push("Warning 2");

    assert.strictEqual(result.assumptions.length, 2);
    assert.strictEqual(result.warnings.length, 1);
  });

  it("does not mutate input object and arrays", () => {
    const input: CalculateGoalPlanOptionInput = {
      rewardAccounts: [
        createRewardAccount("1", "self", "Self", "self", 100, "verified"),
      ],
      projections: [],
      scenario: createScenario("Test", [createRequirement("self", 100)], 100, 50),
    };

    const originalScenario = input.scenario;
    const originalRequirements = input.scenario.requirements;
    const originalAccounts = input.rewardAccounts;

    calculateGoalPlanOption(input);

    // Verify scenario is not mutated
    assert.strictEqual(input.scenario.id, originalScenario.id);
    assert.strictEqual(input.scenario.name, originalScenario.name);

    // Verify requirements array is not mutated
    assert.strictEqual(input.scenario.requirements.length, originalRequirements.length);
    assert.strictEqual(input.scenario.requirements[0].requiredPoints, originalRequirements[0].requiredPoints);

    // Verify accounts array is not mutated
    assert.strictEqual(input.rewardAccounts.length, originalAccounts.length);
    assert.strictEqual(input.rewardAccounts[0].balance, originalAccounts[0].balance);
  });
});

// Test 8: Validation
describe("calculateGoalPlanOption - Validation", () => {
  it("throws RangeError for negative taxes and fees", () => {
    const input: CalculateGoalPlanOptionInput = {
      rewardAccounts: [],
      projections: [],
      scenario: createScenario("Test", [], -100, 50),
    };

    assert.throws(
      () => calculateGoalPlanOption(input),
      new RangeError("estimatedTaxesAndFees must be a finite non-negative number")
    );
  });

  it("throws RangeError for negative annual fees", () => {
    const input: CalculateGoalPlanOptionInput = {
      rewardAccounts: [],
      projections: [],
      scenario: createScenario("Test", [], 100, -50),
    };

    assert.throws(
      () => calculateGoalPlanOption(input),
      new RangeError("estimatedAnnualFees must be a finite non-negative number")
    );
  });

  it("throws RangeError for negative required points", () => {
    const input: CalculateGoalPlanOptionInput = {
      rewardAccounts: [],
      projections: [],
      scenario: createScenario("Test", [createRequirement("self", -100)], 100, 50),
    };

    assert.throws(
      () => calculateGoalPlanOption(input),
      new RangeError("requiredPoints must be a finite non-negative number")
    );
  });

  it("throws RangeError for negative balance", () => {
    const input: CalculateGoalPlanOptionInput = {
      rewardAccounts: [createRewardAccount("1", "self", "Self", "self", -100, "verified")],
      projections: [],
      scenario: createScenario("Test", [createRequirement("self", 100)], 100, 50),
    };

    assert.throws(
      () => calculateGoalPlanOption(input),
      new RangeError("balance must be a finite non-negative number")
    );
  });

  it("throws RangeError for negative projected organic points", () => {
    const input: CalculateGoalPlanOptionInput = {
      rewardAccounts: [],
      projections: [createProjection("self", -50, 10)],
      scenario: createScenario("Test", [createRequirement("self", 100)], 100, 50),
    };

    assert.throws(
      () => calculateGoalPlanOption(input),
      new RangeError("projectedOrganicPoints must be a finite non-negative number")
    );
  });

  it("throws RangeError for negative conditional points", () => {
    const input: CalculateGoalPlanOptionInput = {
      rewardAccounts: [],
      projections: [createProjection("self", 50, -10)],
      scenario: createScenario("Test", [createRequirement("self", 100)], 100, 50),
    };

    assert.throws(
      () => calculateGoalPlanOption(input),
      new RangeError("conditionalPoints must be a finite non-negative number")
    );
  });

  it("throws RangeError for non-finite values", () => {
    const input: CalculateGoalPlanOptionInput = {
      rewardAccounts: [],
      projections: [],
      scenario: createScenario("Test", [], 100, 50),
    };

    // Test Infinity
    input.scenario.estimatedTaxesAndFees = Infinity;
    assert.throws(
      () => calculateGoalPlanOption(input),
      new RangeError("estimatedTaxesAndFees must be a finite non-negative number")
    );

    // Test NaN
    input.scenario.estimatedTaxesAndFees = NaN;
    assert.throws(
      () => calculateGoalPlanOption(input),
      new RangeError("estimatedTaxesAndFees must be a finite non-negative number")
    );
  });
});

// Run with: npx tsx --test lib/goals/planner.test.ts