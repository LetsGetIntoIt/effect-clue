import { expect } from '@jest/globals';
import { Equal } from 'effect';

expect.addEqualityTesters([
    function (a, b): boolean {
        return Equal.equals(a, b);
    }
]);
