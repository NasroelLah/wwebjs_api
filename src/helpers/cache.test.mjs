/**
 * @fileoverview Cache helper unit tests
 */

import { describe, it, beforeEach, after } from "node:test";
import assert from "node:assert";
import { cache, CacheTTL, withCache } from "./cache.mjs";

describe("Cache", () => {
  beforeEach(() => {
    cache.clear();
    // Reset stats
    cache.stats = { hits: 0, misses: 0 };
  });

  after(() => {
    cache.destroy();
  });

  describe("get/set", () => {
    it("should store and retrieve values", () => {
      cache.set("key1", "value1");
      assert.strictEqual(cache.get("key1"), "value1");
    });

    it("should return null for non-existent keys", () => {
      assert.strictEqual(cache.get("nonexistent"), null);
    });

    it("should return null for expired entries", async () => {
      cache.set("expiring", "value", 10); // 10ms TTL
      await new Promise((resolve) => setTimeout(resolve, 20));
      assert.strictEqual(cache.get("expiring"), null);
    });

    it("should store complex objects", () => {
      const obj = { name: "test", items: [1, 2, 3] };
      cache.set("object", obj);
      assert.deepStrictEqual(cache.get("object"), obj);
    });
  });

  describe("has", () => {
    it("should return true for existing keys", () => {
      cache.set("exists", "value");
      assert.strictEqual(cache.has("exists"), true);
    });

    it("should return false for non-existent keys", () => {
      assert.strictEqual(cache.has("notexists"), false);
    });
  });

  describe("delete", () => {
    it("should delete a key", () => {
      cache.set("toDelete", "value");
      cache.delete("toDelete");
      assert.strictEqual(cache.has("toDelete"), false);
    });
  });

  describe("deletePattern", () => {
    it("should delete keys matching pattern", () => {
      cache.set("user:1", "a");
      cache.set("user:2", "b");
      cache.set("other:1", "c");
      cache.deletePattern("user:");
      assert.strictEqual(cache.has("user:1"), false);
      assert.strictEqual(cache.has("user:2"), false);
      assert.strictEqual(cache.has("other:1"), true);
    });
  });

  describe("getStats", () => {
    it("should track hits and misses", () => {
      cache.set("hit", "value");
      cache.get("hit"); // hit
      cache.get("miss"); // miss

      const stats = cache.getStats();
      assert.strictEqual(stats.hits, 1);
      assert.strictEqual(stats.misses, 1);
    });
  });
});

describe("CacheTTL", () => {
  it("should have correct values", () => {
    assert.strictEqual(CacheTTL.SHORT, 10000);
    assert.strictEqual(CacheTTL.MEDIUM, 60000);
    assert.strictEqual(CacheTTL.LONG, 300000);
    assert.strictEqual(CacheTTL.HOUR, 3600000);
  });
});

describe("withCache decorator", () => {
  it("should cache function results", async () => {
    let callCount = 0;
    
    const expensiveFunction = async (x) => {
      callCount++;
      return x * 2;
    };
    
    const cachedFn = withCache("test", CacheTTL.SHORT)(expensiveFunction);
    
    const result1 = await cachedFn(5);
    const result2 = await cachedFn(5);
    
    assert.strictEqual(result1, 10);
    assert.strictEqual(result2, 10);
    assert.strictEqual(callCount, 1); // Should only be called once
  });
});
