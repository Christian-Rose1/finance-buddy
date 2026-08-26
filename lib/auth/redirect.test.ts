import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { safeAuthRedirectPath } from "./redirect";

describe("safeAuthRedirectPath", () => {
  it("allows local absolute paths", () => {
    assert.equal(safeAuthRedirectPath("/goals?tab=active"), "/goals?tab=active");
  });

  it("uses the dashboard for external, protocol-relative, or malformed paths", () => {
    assert.equal(safeAuthRedirectPath("https://example.com"), "/dashboard");
    assert.equal(safeAuthRedirectPath("//example.com"), "/dashboard");
    assert.equal(safeAuthRedirectPath("/%2F%2Fexample.com"), "/dashboard");
    assert.equal(safeAuthRedirectPath("/\\example.com"), "/dashboard");
    assert.equal(safeAuthRedirectPath("/%"), "/dashboard");
  });
});
