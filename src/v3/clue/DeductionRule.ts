import * as E from '@effect/data/Either';

import * as DeductionSet from "./ConclusionMapSet";

type DeductionRule = ({
    // Accepts the game state (card set, player set, etc.)
}) => (
    // Accepts a current set of deductions
    deductions: DeductionSet.DeductionSet
) =>
    // Returns either an logical error, or a new set of deductions (newly-deduced only)
    E.Either<string, DeductionSet.DeductionSet>;
