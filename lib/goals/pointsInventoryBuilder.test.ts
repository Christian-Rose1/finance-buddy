import { test } from "node:test";
import assert from "node:assert/strict";
import { buildPointsInventory } from "./pointsInventoryBuilder";
import type { RewardAccount } from "./types";

function makeAccount(overrides: Partial<RewardAccount> = {}): RewardAccount {
  return {
    id: "acct-1",
    userId: "user-1",
    rewardProgramId: "prog-1",
    ownerKey: "key-1",
    ownerLabel: "Self",
    ownerType: "self",
    balance: 1000,
    balanceAsOf: "2026-01-01",
    origin: "manual",
    verificationStatus: "unverified",
    createdAt: "2026-01-01",
    updatedAt: "2026-01-01",
    ...overrides,
  };
}

test("copies verified account values exactly and includes accountId", () => {
  const account = makeAccount({
    id: "acct-verified",
    rewardProgramId: "prog-verified",
    ownerLabel: "Self",
    ownerType: "self",
    balance: 5000,
    balanceAsOf: "2026-06-01",
    origin: "evidence",
    verificationStatus: "verified",
  });

  const result = buildPointsInventory([account], [
    { id: "prog-verified", name: "Chase Ultimate Rewards" },
  ]);

  assert.equal(result.length, 1);
  assert.deepEqual(result[0], {
    accountId: "acct-verified",
    rewardProgramId: "prog-verified",
    programName: "Chase Ultimate Rewards",
    ownerLabel: "Self",
    ownerType: "self",
    balance: 5000,
    balanceAsOf: "2026-06-01",
    origin: "evidence",
    verificationStatus: "verified",
  });
});

test("copies unverified account values exactly and remains unverified", () => {
  const account = makeAccount({
    id: "acct-unverified",
    rewardProgramId: "prog-2",
    ownerLabel: "Companion",
    ownerType: "companion",
    balance: 300,
    balanceAsOf: "2026-02-01",
    origin: "manual",
    verificationStatus: "unverified",
  });

  const result = buildPointsInventory([account], [
    { id: "prog-2", name: "Marriott Bonvoy" },
  ]);

  assert.equal(result.length, 1);
  assert.equal(result[0].verificationStatus, "unverified");
  assert.equal(result[0].origin, "manual");
  assert.equal(result[0].balance, 300);
  assert.equal(result[0].balanceAsOf, "2026-02-01");
  assert.equal(result[0].ownerLabel, "Companion");
  assert.equal(result[0].ownerType, "companion");
});

test("manual origin remains manual without implying verification", () => {
  const account = makeAccount({
    origin: "manual",
    verificationStatus: "unverified",
  });

  const result = buildPointsInventory([account], [
    { id: "prog-1", name: "Chase Ultimate Rewards" },
  ]);

  assert.equal(result[0].origin, "manual");
  assert.equal(result[0].verificationStatus, "unverified");
});

test("two accounts for the same program remain two rows", () => {
  const account1 = makeAccount({
    id: "acct-self",
    ownerLabel: "Self",
    ownerType: "self",
    balance: 1000,
  });
  const account2 = makeAccount({
    id: "acct-companion",
    ownerLabel: "Companion",
    ownerType: "companion",
    balance: 500,
  });

  const result = buildPointsInventory([account1, account2], [
    { id: "prog-1", name: "Chase Ultimate Rewards" },
  ]);

  assert.equal(result.length, 2);
  assert.equal(result[0].accountId, "acct-self");
  assert.equal(result[1].accountId, "acct-companion");
});

test("self and companion accounts remain separate", () => {
  const accountSelf = makeAccount({
    id: "acct-self",
    ownerLabel: "Self",
    ownerType: "self",
    balance: 1000,
  });
  const accountCompanion = makeAccount({
    id: "acct-companion",
    ownerLabel: "Companion",
    ownerType: "companion",
    balance: 500,
  });

  const result = buildPointsInventory([accountSelf, accountCompanion], [
    { id: "prog-1", name: "Chase Ultimate Rewards" },
  ]);

  assert.equal(result[0].ownerType, "self");
  assert.equal(result[1].ownerType, "companion");
  // No aggregation across owners.
  assert.equal(result[1].balance, 500);
  assert.equal(result[0].balance, 1000);
});

test("program names map by exact program ID", () => {
  const account1 = makeAccount({
    id: "acct-1",
    rewardProgramId: "prog-1",
    balance: 100,
  });
  const account2 = makeAccount({
    id: "acct-2",
    rewardProgramId: "prog-2",
    balance: 200,
  });

  const result = buildPointsInventory([account1, account2], [
    { id: "prog-1", name: "Chase Ultimate Rewards" },
    { id: "prog-2", name: "American Airlines AAdvantage" },
  ]);

  assert.equal(result[0].programName, "Chase Ultimate Rewards");
  assert.equal(result[1].programName, "American Airlines AAdvantage");
});

test("missing catalog program produces programName null", () => {
  const account = makeAccount({
    rewardProgramId: "unknown-prog",
  });

  const result = buildPointsInventory([account], [
    { id: "prog-1", name: "Chase Ultimate Rewards" },
  ]);

  assert.equal(result[0].programName, null);
});

test("zero balance remains zero", () => {
  const account = makeAccount({ balance: 0 });

  const result = buildPointsInventory([account], [
    { id: "prog-1", name: "Chase Ultimate Rewards" },
  ]);

  assert.equal(result[0].balance, 0);
});

test("accountId is present and equals RewardAccount id", () => {
  const account = makeAccount({ id: "acct-x" });

  const result = buildPointsInventory([account], []);

  assert.equal(result[0].accountId, "acct-x");
});

test("userId and ownerKey are absent at runtime", () => {
  const account = makeAccount();
  const result = buildPointsInventory([account], []);
  const row = result[0] as unknown as Record<string, unknown>;

  assert.equal("userId" in row, false);
  assert.equal("ownerKey" in row, false);
});

test("input arrays and objects are not mutated", () => {
  const account1 = makeAccount({
    id: "acct-1",
    rewardProgramId: "prog-1",
    ownerLabel: "Self",
    ownerType: "self",
    balance: 1000,
    balanceAsOf: "2026-01-01",
    origin: "manual",
    verificationStatus: "unverified",
  });
  const account2 = makeAccount({
    id: "acct-2",
    rewardProgramId: "prog-1",
    ownerLabel: "Companion",
    ownerType: "companion",
    balance: 200,
    balanceAsOf: "2026-02-01",
    origin: "evidence",
    verificationStatus: "verified",
  });
  const accounts = [account1, account2];
  const programs = [
    { id: "prog-1", name: "Chase" },
    { id: "prog-2", name: "Amex" },
  ];

  const beforeAccounts = JSON.parse(JSON.stringify(accounts));
  const beforePrograms = JSON.parse(JSON.stringify(programs));

  buildPointsInventory(accounts, programs);

  assert.deepEqual(accounts, beforeAccounts);
  assert.deepEqual(programs, beforePrograms);
});

test("input array order is preserved", () => {
  const account1 = makeAccount({ id: "acct-1" });
  const account2 = makeAccount({ id: "acct-2" });
  const account3 = makeAccount({ id: "acct-3" });

  const result = buildPointsInventory([account1, account2, account3], []);

  assert.deepEqual(
    result.map((r) => r.accountId),
    ["acct-1", "acct-2", "acct-3"]
  );
});
