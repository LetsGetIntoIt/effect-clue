
import { D, HS, P, M, O, E, EQ, B, BOOL } from '../utils/EffectImports';
import { pipe, constTrue, constFalse } from '@effect/data/Function';
import * as CardOwner from './CardOwner';

export interface CardOwnershipOwned extends D.Case {
    _tag: "CardOwnershipOwned";
    readonly owner: CardOwner.CardOwner;
    readonly nonOwners: HS.HashSet<CardOwner.CardOwner>;
};

// TODO validate that the owner doesn't show up as a non-owner
export const CardOwnershipOwned = D.tagged<CardOwnershipOwned>("CardOwnershipOwned");

export interface CardOwnershipUnowned extends D.Case {
    _tag: "CardOwnershipUnowned";
    readonly nonOwners: HS.HashSet<CardOwner.CardOwner>;
};

export const CardOwnershipUnowned = D.tagged<CardOwnershipUnowned>("CardOwnershipUnowned");

export type CardOwnership = CardOwnershipOwned | CardOwnershipUnowned;

// TODO can Data.Case give this for free?
export const isOwned: P.Refinement<CardOwnership, CardOwnershipOwned> =
    (ownership): ownership is CardOwnershipOwned =>
        pipe(
            M.value(ownership),
            M.when({ _tag: 'CardOwnershipOwned' }, constTrue),
            M.when({ _tag: 'CardOwnershipUnowned' }, constFalse),
            M.exhaustive,
        );

// TODO can Data.Case give this for free?
export const isUnowned: P.Refinement<CardOwnership, CardOwnershipUnowned> =
    (ownership): ownership is CardOwnershipUnowned =>
        pipe(
            M.value(ownership),
            M.when({ _tag: 'CardOwnershipOwned' }, constFalse),
            M.when({ _tag: 'CardOwnershipUnowned' }, constTrue),
            M.exhaustive,
        );

// TODO can this be baked in as a property of the objects themselves, so that its just directly available?
export const getOwner: (ownership: CardOwnership) => O.Option<CardOwner.CardOwner> =
    pipe(
        M.type<CardOwnership>(),
        M.when({ _tag: 'CardOwnershipOwned' }, ({ owner }) => O.some(owner)),
        M.when({ _tag: 'CardOwnershipUnowned' }, O.none),
        M.exhaustive,
    );

export const combine: (
    second: CardOwnership,
) => (
    first: CardOwnership,
) => E.Either<string, CardOwnership> =
    pipe(
        M.type<CardOwnership>(),

        M.when({ _tag: 'CardOwnershipOwned' }, (second) => pipe(
            M.type<CardOwnership>(),

            M.when({ _tag: 'CardOwnershipOwned' }, (first) => pipe(
                // Both are owned
                // They can only be combined if their owners are the same
                EQ.equals(first.owner, second.owner),

                BOOL.match(
                    // They do not match
                    () => E.left('Conflicting ownership'),

                    () => E.right(CardOwnershipOwned({
                        owner: first.owner,
                        nonOwners: HS.union(first.nonOwners, second.nonOwners),
                    })),
                ),
            )),

            M.when(({ _tag: 'CardOwnershipUnowned' }), (first) => pipe(
                // Second is owned, first is unowned
                E.right(CardOwnershipOwned({
                    owner: second.owner,
                    nonOwners: HS.union(first.nonOwners, second.nonOwners),
                })),
            )),
            
            M.exhaustive,
        )),

        M.when(({ _tag: 'CardOwnershipUnowned' }), (second) => pipe(
            M.type<CardOwnership>(),

            M.when({ _tag: 'CardOwnershipOwned' }, (first) => pipe(
                // Second is unowned, first is owned
                E.right(CardOwnershipOwned({
                    owner: first.owner,
                    nonOwners: HS.union(first.nonOwners, second.nonOwners),
                })),
            )),

            M.when(({ _tag: 'CardOwnershipUnowned' }), (first) => pipe(
                // Both are unowned
                E.right(CardOwnershipUnowned({
                    nonOwners: HS.union(first.nonOwners, second.nonOwners),
                })),
            )),

            M.exhaustive,
        )),
        
        M.exhaustive,
    );
