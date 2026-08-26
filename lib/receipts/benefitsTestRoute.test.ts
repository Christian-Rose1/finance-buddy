import assert from "node:assert/strict";
import { afterEach, describe, it } from "node:test";
import type { NextRequest } from "next/server";
import { POST } from "@/app/api/receipts/benefits-test/route";

const originalNodeEnv = process.env.NODE_ENV;
const mutableEnv = process.env as Record<string, string | undefined>;

afterEach(() => {
  if (originalNodeEnv === undefined) {
    delete mutableEnv.NODE_ENV;
  } else {
    mutableEnv.NODE_ENV = originalNodeEnv;
  }
});

describe("POST /api/receipts/benefits-test", () => {
  it("returns a safe 404 in production without parsing the request body", async () => {
    mutableEnv.NODE_ENV = "production";
    let parseAttempts = 0;
    const request = {
      async json() {
        parseAttempts += 1;
        throw new Error("Production route attempted to parse the request.");
      },
    } as unknown as NextRequest;

    const response = await POST(request);

    assert.equal(response.status, 404);
    assert.deepEqual(await response.json(), {
      ok: false,
      error: "Not found.",
    });
    assert.equal(parseAttempts, 0);
  });
});
