import * as T from '@effect/io/Effect';

import * as Card from "./Card";
import { Effect_expectSucceed, Effect_test } from '../utils/EffectTest';

describe('Card', () => {
    describe('#create', () => {
        it('succeeds and returns the right thing', () => {
            Effect_test(T.gen(function* ($) {
                const card = yield* $(Effect_expectSucceed(
                    Card.create({
                        cardType: 'type',
                        label: 'label',
                    }),
                ));

                expect(card).toEqual({
                    cardType: 'type',
                    label: 'label',
                });
            }));
        });
    });

    test('#toString', () => {
        Effect_test(T.gen(function* ($) {
            const card = yield* $(Effect_expectSucceed(
                Card.create({
                    cardType: 'type',
                    label: 'label',
                }),
            ));

            expect(`${card}`).toEqual('');
        }));
    });
});
