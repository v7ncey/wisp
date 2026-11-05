import assert from "node:assert/strict";

/** A tiny expect() over node:assert, so tests read the same without a native-binary test runner. */
export function expect<T>(actual: T) {
  const api = {
    toBe: (v: T) => assert.strictEqual(actual, v),
    toEqual: (v: unknown) => assert.deepStrictEqual(actual, v),
    toContain: (v: unknown) =>
      assert.ok((actual as unknown as { includes(x: unknown): boolean }).includes(v), `expected ${JSON.stringify(actual)} to contain ${JSON.stringify(v)}`),
    toBeNull: () => assert.strictEqual(actual, null),
    toBeGreaterThan: (n: number) => assert.ok((actual as unknown as number) > n, `expected ${actual} > ${n}`),
    toMatchObject: (v: Record<string, unknown>) => {
      for (const [k, val] of Object.entries(v)) assert.deepStrictEqual((actual as Record<string, unknown>)[k], val, `key ${k}`);
    },
    not: {
      toContain: (v: unknown) =>
        assert.ok(!(actual as unknown as { includes(x: unknown): boolean }).includes(v), `expected ${JSON.stringify(actual)} not to contain ${JSON.stringify(v)}`),
      toBeNull: () => assert.notStrictEqual(actual, null),
    },
  };
  return api;
}
