import * as EQ from '@effect/data/Equal';
import * as ROA from '@effect/data/ReadonlyArray';
import * as EQV from '@effect/data/typeclass/Equivalence';
import * as ST from '@effect/data/Struct';
import * as S from '@effect/data/String';
import * as TU from '@effect/data/Tuple';
import * as H from '@effect/data/Hash';
import * as HS from '@effect/data/HashSet';
import * as HM from '@effect/data/HashMap';
import * as P from '@effect/data/Predicate';
import * as E from '@effect/data/Either';
import * as B from '@effect/data/Boolean';
import { flow, pipe } from '@effect/data/Function';

import { Show, Show_showHashMap, Show_symbol } from '../utils/ShouldBeBuiltin';

import * as Conclusion from './Conclusion';

/**
 * Something that we know about a specific topic
 * Q - the topic that we know about
 * Conclusion - the conclusion we have about that topic
 */
export type ConclusionMap<Q, A> =
    EQ.Equal & Show & {
        conclusions: HM.HashMap<Q, Conclusion.Conclusion<A>>;
    };

const create = <Q, A>(
    conclusions: HM.HashMap<Q, Conclusion.Conclusion<A>>
): ConclusionMap<Q, A> =>
    ({
        conclusions,

        [Show_symbol](): string {
           return Show_showHashMap(this.conclusions);
        },

        [EQ.symbol](that: EQ.Equal): boolean {
            return isCard(that)
                && Equivalence(this, that);
        },

        [H.symbol](): number {
            return H.structure({
                ...this
            });
        },
    });

export const empty = <Q, A>(): ConclusionMap<Q, A> =>
    create(HM.empty());

export const add = <Q, A>(
    question: Q,
    answer: A,
    reason: Conclusion.Reason,
): ((conclusions: ConclusionMap<Q, A>) => E.Either<string, ConclusionMap<Q, A>>) =>
    null;
