export function assert(condition, message) {
  if (!condition) {
    throw new Error(message);
  }
}

export function equal(actual, expected, message) {
  assert(Object.is(actual, expected), message ?? `Expected ${expected}, received ${actual}`);
}
