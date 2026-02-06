/**
 * @fileoverview Validation helper unit tests
 */

import { describe, it } from "node:test";
import assert from "node:assert";
import { isValidScheduleFormat } from "./validationHelper.mjs";

describe("isValidScheduleFormat", () => {
  it("should return true for valid schedule format", () => {
    assert.strictEqual(isValidScheduleFormat("2024-12-25 10:30:00"), true);
    assert.strictEqual(isValidScheduleFormat("2025-01-01 00:00:00"), true);
    assert.strictEqual(isValidScheduleFormat("2023-06-15 23:59:59"), true);
  });

  it("should return false for invalid formats", () => {
    assert.strictEqual(isValidScheduleFormat("2024-12-25"), false);
    assert.strictEqual(isValidScheduleFormat("10:30:00"), false);
    assert.strictEqual(isValidScheduleFormat("2024/12/25 10:30:00"), false);
    assert.strictEqual(isValidScheduleFormat("25-12-2024 10:30:00"), false);
    assert.strictEqual(isValidScheduleFormat("invalid"), false);
    assert.strictEqual(isValidScheduleFormat(""), false);
    assert.strictEqual(isValidScheduleFormat(null), false);
    assert.strictEqual(isValidScheduleFormat(undefined), false);
  });
});
