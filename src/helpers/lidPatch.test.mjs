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

  test("is idempotent via an id flag", () => {
    assert.match(getLidPatchSource(), /__wwebjsLidPatchApplied/);
  });
});

describe("lidMigrationPatch runtime behavior", () => {
  // Minimal page-context stand-in: verifies the patch wraps throwing LID
  // converters and falls back to the original wid.
  function createFakeWindow() {
    const wid = { server: "c.us", user: "628123" };
    const calls = { isLidMigrated: 0, toUserLid: 0, toUserLidOrThrow: 0, thisOf: {} };
    const injectionTargets = [];
    const lidGatingUtils = {
      isLidMigrated() {
        calls.isLidMigrated++;
        calls.thisOf.isLidMigrated = this;
        throw new Error("lid-migrated client does not have an accountLid!");
      },
    };
    const lidUtils = {
      toUserLid() {
        calls.toUserLid++;
        calls.thisOf.toUserLid = this;
        throw new Error("No LID for user");
      },
      toUserLidOrThrow() {
        calls.toUserLidOrThrow++;
        calls.thisOf.toUserLidOrThrow = this;
        throw new Error("No LID for user");
      },
    };
    const modules = {
      WAWebLid1X1MigrationGating: { Lid1X1MigrationUtils: lidGatingUtils },
      WAWebLidMigrationUtils: lidUtils,
      WAWebWidFactory: { createWid: () => wid },
    };
    const window = {
      require(module) {
        if (!(module in modules)) throw new Error("unknown module " + module);
        return modules[module];
      },
      WWebJS: {
        injectToFunction(target, callback) {
          injectionTargets.push({ target, callback });
        },
      },
    };
    const owners = { isLidMigrated: lidGatingUtils, toUserLid: lidUtils, toUserLidOrThrow: lidUtils };
    return { window, calls, injectionTargets, wid, owners };
  }

  test("wraps LID converters and falls back to wid on throw", async () => {
    const { window, calls, injectionTargets, wid, owners } = createFakeWindow();
    globalThis.window = window;
    try {
      const source = getLidPatchSource();
      // Execute the patch body in a function receiving `window`
      await new Function("window", `return (${source})()`)(window);

      for (const { target, callback } of injectionTargets) {
        // Resolve the owning object the same way injectToFunction does
        const path = target.function.split(".");
        const funcName = path.pop();
        const owner = path.reduce((m, k) => m[k], window.require(target.module));
        const original = owner[funcName];
        const result = callback(owner, original, wid);
        if (target.function.endsWith("isLidMigrated")) {
          assert.equal(result, false, "isLidMigrated must fall back to false on throw");
        } else {
          assert.equal(result, wid, `${target.function} must fall back to the original wid`);
        }
      }
      assert.equal(calls.toUserLidOrThrow, 1);
      assert.equal(calls.isLidMigrated, 1);
      // Regression: originals must run with their owning object as `this`,
      // matching whatsapp-web.js injectToFunction (origFunction.apply(module, args)).
      assert.equal(calls.thisOf.isLidMigrated, owners.isLidMigrated);
      assert.equal(calls.thisOf.toUserLid, owners.toUserLid);
      assert.equal(calls.thisOf.toUserLidOrThrow, owners.toUserLidOrThrow);
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
