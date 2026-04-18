/**
 * Tiny assertion helpers for tests that need to narrow an optional down
 * to its non-undefined variant without reaching for `!` (which
 * silently lies to the type system).
 *
 * Unlike expect(...).toBeDefined(), these *return* the narrowed value
 * and throw a descriptive Error on failure — so the assertion line also
 * produces the value the rest of the test needs. Jest still counts the
 * throw as a test failure.
 */

export const expectDefined = <T>(
    value: T | undefined | null,
    label?: string,
): T => {
    if (value === undefined || value === null) {
        throw new Error(
            `Expected value to be defined${label ? ` (${label})` : ""}, got ${value}`,
        );
    }
    return value;
};

/** Assert that an array has at least `n` elements and return the first n. */
export const expectAtLeast = <T>(
    arr: ReadonlyArray<T>,
    n: number,
    label?: string,
): ReadonlyArray<T> => {
    if (arr.length < n) {
        throw new Error(
            `Expected${label ? ` ${label}` : " array"} to have at least ${n} elements; got ${arr.length}`,
        );
    }
    return arr;
};

/** Get `arr[index]`, throwing if missing. */
export const expectAt = <T>(
    arr: ReadonlyArray<T>,
    index: number,
    label?: string,
): T => {
    const value = arr[index];
    if (value === undefined) {
        throw new Error(
            `Expected${label ? ` ${label}` : " array"} to have element at index ${index}; length is ${arr.length}`,
        );
    }
    return value;
};
