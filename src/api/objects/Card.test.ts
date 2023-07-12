import { E, EQ, SFMT } from "../utils/effect/EffectImports";
import { compose, pipe } from "@effect/data/Function";
import { Struct_get } from "../utils/effect/Effect";
import dedent from "ts-dedent";

import * as Card from "./Card";

describe('Card', () => {
    test('equal cards are equal', () => {
        expect(
            Card.decodeSync(['room', 'dining room']),
        ).toEqual(
            Card.decodeSync(['room', 'dining room']),
        );

        expect(EQ.equals(
            Card.decodeSync(['room', 'dining room']),
            Card.decodeSync(['room', 'dining room']),
        )).toEqual(true);
    });

    describe('parsing', () => {
        test('on a valid card', () => {
            expect(pipe(
                Card.decodeEither(['room', 'dining room'], { errors: 'all' }),
            )).toEqual(
                E.right(Card.decodeSync(['room', 'dining room']),
            ));
        });

        test('on a completely invalid card', () => {
            expect(pipe(
                Card.decodeEither(['', ''], { errors: 'all' }),
                E.mapLeft(compose(Struct_get('errors'), SFMT.formatErrors)),
            )).toEqual(
                E.left(dedent`
                    error(s) found
                    ├─ [0]
                    │  └─ cardType should be non-empty
                    └─ [1]
                       └─ cardLabel should be non-empty
                `),
            );
        });
    });
});
