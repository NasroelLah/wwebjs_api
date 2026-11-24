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


describe("lidMigrationPatch runtime behavior", () => {
  // Minimal page-context stand-in: verifies the patch wraps throwing LID
  // converters and falls back to the original wid.
  function createFakeWindow() {
    const wid = { server: "c.us", user: "628123" };
    const calls = { isLidMigrated: 0, toUserLid: 0, toUserLidOrThrow: 0, thisOf: {} };
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
        injectToFunction() {},
      },
    };
    const owners = { isLidMigrated: lidGatingUtils, toUserLid: lidUtils, toUserLidOrThrow: lidUtils };
    return { window, calls, wid, owners };
  }

  test("wraps LID converters and falls back to wid on throw", async () => {
    const { window, calls, wid, owners } = createFakeWindow();
    globalThis.window = window;
    try {
      const source = getLidPatchSource();
      // Execute the patch body in a function receiving `window`
      await new Function("window", `return (${source})()`)(window);
      for (const target of [
        { module: "WAWebLid1X1MigrationGating", function: "Lid1X1MigrationUtils.isLidMigrated" },
        { module: "WAWebLidMigrationUtils", function: "toUserLid" },
        { module: "WAWebLidMigrationUtils", function: "toUserLidOrThrow" },
      ]) {
        const path = target.function.split(".");
        const funcName = path.pop();
        const owner = path.reduce((m, k) => m[k], window.require(target.module));
        const result = owner[funcName](wid);
        if (target.function.endsWith("isLidMigrated")) {
          assert.equal(result, false);
        } else {
          assert.equal(result, wid);
        }
      }
      assert.equal(window.__wwebjsLidPatchStatus.state, "applied");
      assert.equal(window.__wwebjsLidPatchStatus.hooks.length, 3);
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

  test("propagates unrelated errors without calling the original twice", async () => {
    const { window } = createFakeWindow();
    const owner = window.require("WAWebLidMigrationUtils");
    let calls = 0;
    owner.toUserLid = () => { calls++; throw new Error("unexpected failure"); };
    await new Function("window", `return (${getLidPatchSource()})()`)(window);
    assert.throws(() => owner.toUserLid({ user: "123" }), /unexpected failure/);
    assert.equal(calls, 1);
  });

  test("reports unavailable hooks instead of claiming the patch is applied", async () => {
    const { window } = createFakeWindow();
    delete window.require("WAWebLidMigrationUtils").toUserLid;
    const intervals = [];
    const run = new Function("window", "setInterval", "clearInterval", `return (${getLidPatchSource()})()`);
    await run(window, (callback) => { intervals.push(callback); return 1; }, () => {});
    for (let i = 0; i < 240; i++) intervals[0]();
    assert.equal(window.__wwebjsLidPatchStatus.state, "unavailable");
    assert.equal(window.__wwebjsLidPatchStatus.hooks.length, 2);
  });

  test("applies when only the optional gating hook is absent from the WhatsApp Web build", async () => {
    const { window, wid } = createFakeWindow();
    delete window.require("WAWebLid1X1MigrationGating").Lid1X1MigrationUtils.isLidMigrated;
    const intervals = [];
    const run = new Function("window", "setInterval", "clearInterval", `return (${getLidPatchSource()})()`);
    await run(window, (callback) => { intervals.push(callback); return 1; }, () => {});
    const status = window.__wwebjsLidPatchStatus;
    assert.equal(status.state, "applied");
    assert.deepEqual(status.hooks, ["WAWebLidMigrationUtils.toUserLid", "WAWebLidMigrationUtils.toUserLidOrThrow"]);
    assert.deepEqual(status.missing, ["WAWebLid1X1MigrationGating.Lid1X1MigrationUtils.isLidMigrated"]);
    assert.equal(window.require("WAWebLidMigrationUtils").toUserLidOrThrow(wid), wid);
    assert.equal(intervals.length, 0, "no retry timer is needed once required hooks are installed");
  });


  test("evalOnNewDoc export is a function (Client option contract)", () => {
    assert.equal(typeof lidMigrationPatch, "function");
  });
});
