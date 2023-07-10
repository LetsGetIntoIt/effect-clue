
import { D, HS, P, M, O, E, EQ, BOOL } from '../../utils/effect/EffectImports';
import { pipe, constTrue, constFalse } from '@effect/data/Function';
import * as CardOwner from '../../game/CardOwner';

export interface OwnershipOfOwnedCard extends D.Case {
    _tag: "OwnershipOfOwnedCard";
    readonly owner: CardOwner.CardOwner;
    readonly nonOwners: HS.HashSet<CardOwner.CardOwner>;
};

// TODO validate that the owner doesn't show up as a non-owner
export const OwnershipOfOwnedCard = D.tagged<OwnershipOfOwnedCard>("OwnershipOfOwnedCard");

export interface OwnershipOfUnownedCard extends D.Case {
    _tag: "OwnershipOfUnownedCard";
    readonly nonOwners: HS.HashSet<CardOwner.CardOwner>;
};

export const OwnershipOfUnownedCard = D.tagged<OwnershipOfUnownedCard>("OwnershipOfUnownedCard");

export type OwnershipOfCard = OwnershipOfOwnedCard | OwnershipOfUnownedCard;

// TODO can Data.Case give this for free?
export const isOwned: P.Refinement<OwnershipOfCard, OwnershipOfOwnedCard> =
    (ownership): ownership is OwnershipOfOwnedCard =>
        pipe(
            M.value(ownership),
            M.tag('OwnershipOfOwnedCard', constTrue),
            M.tag('OwnershipOfUnownedCard', constFalse),
            M.exhaustive,
        );

// TODO can Data.Case give this for free?
export const isUnowned: P.Refinement<OwnershipOfCard, OwnershipOfUnownedCard> =
    (ownership): ownership is OwnershipOfUnownedCard =>
        pipe(
            M.value(ownership),
            M.tag('OwnershipOfOwnedCard', constFalse),
            M.tag('OwnershipOfUnownedCard', constTrue),
            M.exhaustive,
        );

// TODO can this be baked in as a property of the objects themselves, so that its just directly available?
export const getOwner: (ownership: OwnershipOfCard) => O.Option<CardOwner.CardOwner> =
    pipe(
        M.type<OwnershipOfCard>(),
        M.tag('OwnershipOfOwnedCard', ({ owner }) => O.some(owner)),
        M.tag('OwnershipOfUnownedCard', O.none<CardOwner.CardOwner>),
        M.exhaustive,
    );

export const combine: (
    second: OwnershipOfCard,
) => (
    first: OwnershipOfCard,
) => E.Either<string, OwnershipOfCard> =
    pipe(
        M.type<OwnershipOfCard>(),

        M.tag('OwnershipOfOwnedCard', (second) => pipe(
            M.type<OwnershipOfCard>(),

            M.tag('OwnershipOfOwnedCard', (first) => pipe(
                // Both are owned
                // They can only be combined if their owners are the same
                EQ.equals(first.owner, second.owner),

                BOOL.match(
                    // They do not match
                    () => E.left('Conflicting ownership'),

                    () => E.right(OwnershipOfOwnedCard({
                        owner: first.owner,
                        nonOwners: HS.union(first.nonOwners, second.nonOwners),
                    })),
                ),
            )),

            M.tag('OwnershipOfUnownedCard', (first) => pipe(
                // Second is owned, first is unowned
                E.right(OwnershipOfOwnedCard({
                    owner: second.owner,
                    nonOwners: HS.union(first.nonOwners, second.nonOwners),
                })),
            )),
            
            M.exhaustive,
        )),

        M.tag('OwnershipOfUnownedCard', (second) => pipe(
            M.type<OwnershipOfCard>(),

            M.tag('OwnershipOfOwnedCard', (first) => pipe(
                // Second is unowned, first is owned
                E.right(OwnershipOfOwnedCard({
                    owner: first.owner,
                    nonOwners: HS.union(first.nonOwners, second.nonOwners),
                })),
            )),

            M.tag('OwnershipOfUnownedCard', (first) => pipe(
                // Both are unowned
                E.right(OwnershipOfUnownedCard({
                    nonOwners: HS.union(first.nonOwners, second.nonOwners),
                })),
            )),

            M.exhaustive,
        )),
        
        M.exhaustive,
    );
