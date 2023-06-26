import { E } from "../utils/EffectImports";
import { pipe } from "@effect/data/Function";

import * as Card from "./Card";

describe('Card', () => {
    describe('#Equal', () => {
        test('unvalidated cards are equal', () => {
            expect(
                Card.Card({
                    cardType: 'room',
                    label: 'dining room',
                }),
            ).toEqual(
                Card.Card({
                    cardType: 'room',
                    label: 'dining room',
                }),
            );
        });
    });

    describe('ValidCard', () => {
        describe('#constructor', () => {
            test('on a valid card', () => {
                expect(pipe(
                    Card.Card({
                        cardType: 'room',
                        label: 'dining room',
                    }),
    
                    Card.ValidatedCard,
                )).toEqual(
                    E.right(Card.Card({
                        cardType: 'room',
                        label: 'dining room',
                    })),
                );
            });

            test('on a completely invalid card', () => {
                expect(pipe(
                    Card.Card({
                        cardType: '',
                        label: '',
                    }),
    
                    Card.ValidatedCard,
                )).toEqual(
                    E.left([
                        { message: 'cardType should be a non-empty string', },
                        { message: 'label should be a non-empty string', },
                    ]),
                );
            });
        });
    });
});
