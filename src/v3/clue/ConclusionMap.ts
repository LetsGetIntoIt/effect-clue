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

import { Show } from '../utils/ShouldBeBuiltin';

import * as Conclusion from './Conclusion';

/**
 * Something that we know about a specific topic
 * Q - the topic that we know about
 * Conclusion - the conclusion we have about that topic
 */
export type ConclusionMap<Q extends EQ.Equal, A extends EQ.Equal> =
    EQ.Equal & Show & {
        conclusions: HM.HashMap<Q, Conclusion.Conclusion<A>>;
    };

const create = <Q extends EQ.Equal, A extends EQ.Equal>(conclusions: HM.HashMap<Q, A>): ConclusionMap<Q, A> =>
    ({

    });

export const empty: <Q extends EQ.Equal, A extends EQ.Equal>() => ConclusionMap<Q, A> =
    flow(HM.empty, create);

export const add = <Q extends EQ.Equal, A extends EQ.Equal>(
    question: Q,
    answer: A,
    reason: Conclusion.Reason,
) => (
    { conclusions }: ConclusionMap<Q, A>,
): E.Either<string, ConclusionMap<Q, A>> =>
    null;
