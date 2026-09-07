import { test, describe } from "node:test";
import assert from "node:assert/strict";
import {
  isLidResolutionError,
  getLidPatchSource,
  lidMigrationPatch,
} from "./lidPatch.mjs";

describe("isLidResolutionError", () => {
  test("matches the page error reported in issue #3834", () => {
    const error = new Error("No LID for user");
    assert.equal(isLidResolutionError(error), true);
  });

  test("matches nested evaluation errors from puppeteer", () => {
    const error = new Error(
      "Evaluation failed: Error: No LID for user\n    at toUserLidOrThrow"
    );
    assert.equal(isLidResolutionError(error), true);
  });

  test("matches the lid-missing chat table variant", () => {
    assert.equal(isLidResolutionError(new Error("Lid is missing in chat table")), true);
    assert.equal(
      isLidResolutionError(new Error("lid-migrated client does not have an accountLid!")),
      true
    );
  });

  test("is case-insensitive", () => {
    assert.equal(isLidResolutionError(new Error("no lid for user")), true);
  });

  test("does not match unrelated errors", () => {
    assert.equal(isLidResolutionError(new Error("Message send timeout")), false);
    assert.equal(isLidResolutionError(new Error("serialize failed")), false);
    assert.equal(isLidResolutionError(new Error("invalid chat id")), false);
  });

  test("handles non-Error inputs", () => {
    assert.equal(isLidResolutionError("No LID for user"), true);
    assert.equal(isLidResolutionError(undefined), false);
    assert.equal(isLidResolutionError(null), false);
    assert.equal(isLidResolutionError({}), false);
  });
});

describe("lidMigrationPatch source", () => {
  test("is a self-contained function expression", () => {
    const source = getLidPatchSource();
    assert.match(source, /^function \(\) \{/);
    new Function(`(${source})`);
  });

  test("guards all three LID migration hooks", () => {
    const source = getLidPatchSource();
    assert.match(source, /Lid1X1MigrationUtils\.isLidMigrated/);
    assert.match(source, /'WAWebLidMigrationUtils', function: 'toUserLid'/);
    assert.match(source, /'WAWebLidMigrationUtils', function: 'toUserLidOrThrow'/);
  });

  test("falls back to the original wid instead of throwing", () => {
    const source = getLidPatchSource();
    assert.match(source, /try \{ return func\(wid\); \} catch \{ return wid; \}/);
  });

  test("is idempotent via an id flag", () => {
    assert.match(getLidPatchSource(), /__wwebjsLidPatchApplied/);
  });
});

describe("lidMigrationPatch runtime behavior", () => {
  // Minimal page-context stand-in: verifies the patch wraps throwing LID
  // converters and falls back to the original wid.
  function createFakeWindow() {
    const wid = { server: "c.us", user: "628123" };
    const calls = { isLidMigrated: 0, toUserLid: 0, toUserLidOrThrow: 0 };
    const injectionTargets = [];
    const window = {
      require(module) {
        if (module === "WAWebLid1X1MigrationGating") {
          return {
            Lid1X1MigrationUtils: {
              isLidMigrated() {
                calls.isLidMigrated++;
                throw new Error("lid-migrated client does not have an accountLid!");
              },
            },
          };
        }
        if (module === "WAWebLidMigrationUtils") {
          return {
            toUserLid() {
              calls.toUserLid++;
              throw new Error("No LID for user");
            },
            toUserLidOrThrow() {
              calls.toUserLidOrThrow++;
              throw new Error("No LID for user");
            },
          };
        }
        if (module === "WAWebWidFactory") return { createWid: () => wid };
        throw new Error("unknown module " + module);
      },
      WWebJS: {
        injectToFunction(target, callback) {
          injectionTargets.push({ target, callback });
        },
      },
    };
    return { window, calls, injectionTargets, wid };
  }

  test("wraps LID converters and falls back to wid on throw", async () => {
    const { window, calls, injectionTargets, wid } = createFakeWindow();
    globalThis.window = window;
    try {
      const source = getLidPatchSource();
      // Execute the patch body in a function receiving `window`
      await new Function("window", `return (${source})()`)(window);

      for (const { target, callback } of injectionTargets) {
        // Simulate the injected wrapper: callback(module, original, ...args)
        const module = window.require(target.module);
        const original = target.function
          .split(".")
          .reduce((m, k) => m[k], window.require(target.module));
        const result = callback(module, original, wid);
        if (target.function.endsWith("isLidMigrated")) {
          assert.equal(result, false, "isLidMigrated must fall back to false on throw");
        } else {
          assert.equal(result, wid, `${target.function} must fall back to the original wid`);
        }
      }
      assert.equal(calls.toUserLidOrThrow, 1);
      assert.equal(calls.isLidMigrated, 1);
    } finally {
      delete globalThis.window;
    }
  });

  test("is idempotent: second run does not re-inject", async () => {
    const { window, injectionTargets } = createFakeWindow();
    globalThis.window = window;
    try {
      const source = getLidPatchSource();
      await new Function("window", `return (${source})()`)(window);
      await new Promise((r) => setTimeout(r, 30));
      const firstCount = injectionTargets.length;
      assert.equal(firstCount, 3);

      await new Function("window", `return (${source})()`)(window);
      await new Promise((r) => setTimeout(r, 30));
      assert.equal(injectionTargets.length, firstCount);
    } finally {
      delete globalThis.window;
    }
  });

  test("evalOnNewDoc export is a function (Client option contract)", () => {
    assert.equal(typeof lidMigrationPatch, "function");
  });
});
