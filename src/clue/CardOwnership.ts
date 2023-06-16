import * as E from '@effect/data/Either';
import * as H from '@effect/data/Hash';
import * as EQ from "@effect/data/Equal";
import * as ST from "@effect/data/Struct";
import * as EQV from '@effect/data/typeclass/Equivalence';
import * as O from '@effect/data/Option';
import * as HS from "@effect/data/HashSet";
import * as P from '@effect/data/Predicate';
import * as S from '@effect/data/String';
import * as M from "@effect/match";
import * as B from '@effect/data/Boolean';
import { constant, flow, pipe } from '@effect/data/Function';

import { Refinement_struct, Refinement_and, HashSet_every, Refinement_or, Equals_getRefinement } from '../utils/ShouldBeBuiltin';

import * as CardOwner from "./CardOwner";
import * as Pair from './Pair';

type RawCardOnwershipOwned = {
    readonly _cardOwnershipType: 'owned';
    readonly owner: CardOwner.CardOwner;
    readonly nonOwners: HS.HashSet<CardOwner.CardOwner>;
};

type RawCardOnwershipUnowned = {
    readonly _cardOwnershipType: 'unowned';
    readonly nonOwners: HS.HashSet<CardOwner.CardOwner>;
};

export type CardOwnershipOwned = EQ.Equal & RawCardOnwershipOwned;
export type CardOwnershipUnowned = EQ.Equal & RawCardOnwershipUnowned;
export type CardOwnership = CardOwnershipOwned | CardOwnershipUnowned;

export const isCardOwnershipOwned: P.Refinement<unknown, CardOwnershipOwned> =
    pipe(
        Refinement_struct({
            _cardOwnershipType: Equals_getRefinement('owned'),
            owner: CardOwner.isCardOwner,
            nonOwners: pipe(HS.isHashSet, P.compose(HashSet_every(CardOwner.isCardOwner)))
        }),

        Refinement_and(EQ.isEqual),
    );

export const isCardOwnershipUnowned: P.Refinement<unknown, CardOwnership> =
    pipe(
        Refinement_struct({
            _cardOwnershipType: Equals_getRefinement('unowned'),
            owner: P.isUndefined,
            nonOwners: pipe(HS.isHashSet, P.compose(HashSet_every(CardOwner.isCardOwner)))
        }),

        Refinement_and(EQ.isEqual),
    );

export const isCardOwnership: P.Refinement<unknown, CardOwnership> =
    pipe(
        isCardOwnershipOwned,
        Refinement_or(isCardOwnershipUnowned),
    );

export const Equivalence: EQV.Equivalence<CardOwnership> = ST.getEquivalence({
    _cardOwnershipType: S.Equivalence,
    owner: O.getEquivalence(CardOwner.Equivalence),
    nonOwners: EQ.equivalence(),
});

const createInternal = (
    cardOwnership: RawCardOnwershipOwned | RawCardOnwershipUnowned,
): CardOwnership =>
    Object.freeze({
        ...cardOwnership,

        toString: constant(pipe(
            M.value(cardOwnership),

            M.when({  _cardOwnershipType: 'owned' }, (self) =>
                `Owned by '${self.owner}' and not by ${self.nonOwners})`
            ),

            M.when({  _cardOwnershipType: 'unowned' }, (self) =>
                `Not owned by ${self.nonOwners})`
            ),

            M.exhaustive,
        )),

        [EQ.symbol](that: EQ.Equal): boolean {
            return isCardOwnership(that) && Equivalence(this, that);
        },

        [H.symbol](): number {
            return H.structure({
                ...this
            });
        },
    });

export const createOwned = (cardOwnership: Omit<RawCardOnwershipOwned, '_cardOwnershipType'>): CardOwnership =>
    pipe(
        cardOwnership,

        ownership => ({
            _cardOwnershipType: 'owned' as const,
            ...cardOwnership,
        }),

        createInternal,
    );

export const createUnowned = (cardOwnership: Omit<RawCardOnwershipUnowned, '_cardOwnershipType'>): CardOwnership =>
    pipe(
        cardOwnership,

        ownership => ({
            _cardOwnershipType: 'unowned' as const,
            ...cardOwnership,
        }),

        createInternal,
    );

export const combine: (
    second: CardOwnership,
) => (
    first: CardOwnership,
) => E.Either<string, CardOwnership> =
    pipe(
        M.type<CardOwnership>(),

        M.when({ _cardOwnershipType: 'owned' }, (second) => pipe(
            M.type<CardOwnership>(),

            M.when({ _cardOwnershipType: 'owned' }, (first) => pipe(
                // Both are owned
                // They can only be combined if their owners are the same
                EQ.equals(first.owner)(second.owner),

                B.match(
                    // They do not match
                    () => E.left('Conflicting ownership'),

                    () => E.right(createOwned({
                        owner: first.owner,
                        nonOwners: HS.union(first.nonOwners, second.nonOwners),
                    })),
                ),
            )),
    
            M.when(({ _cardOwnershipType: 'unowned' }), (first) => pipe(
                // Second is owned, first is unowned
                E.right(createOwned({
                    owner: second.owner,
                    nonOwners: HS.union(first.nonOwners, second.nonOwners),
                })),
            )),
            
            M.exhaustive,
        )),

        M.when(({ _cardOwnershipType: 'unowned' }), (second) => pipe(
            M.type<CardOwnership>(),

            M.when({ _cardOwnershipType: 'owned' }, (first) => pipe(
                // Second is unowned, first is owned
                E.right(createOwned({
                    owner: first.owner,
                    nonOwners: HS.union(first.nonOwners, second.nonOwners),
                })),
            )),

            M.when(({ _cardOwnershipType: 'unowned' }), (first) => pipe(
                // Both are unowned
                E.right(createUnowned({
                    nonOwners: HS.union(first.nonOwners, second.nonOwners),
                })),
            )),

            M.exhaustive,
        )),
        
        M.exhaustive,
    );

// TODO does this short-hand make sense? Can we reduce the number of properties in each object instead?
export const getOwner: (ownership: CardOwnership) => O.Option<CardOwner.CardOwner> =
    pipe(
        M.type<CardOwnership>(),
        M.when({  _cardOwnershipType: 'owned' }, ({ owner }) => O.some(owner)),
        M.when({  _cardOwnershipType: 'unowned' }, O.none),
        M.exhaustive,
    );

// TODO does this short-hand make sense? Can we reduce the number of properties in each object instead?
export const getNonOwners = (ownership: CardOwnership): HS.HashSet<CardOwner.CardOwner> =>
    ownership.nonOwners;
