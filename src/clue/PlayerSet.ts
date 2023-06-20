import * as B from '@effect/data/Brand';
import * as HS from '@effect/data/HashSet';
import * as E from '@effect/data/Either';
import { flow, pipe } from '@effect/data/Function';
import { Brand_refined } from '../utils/ShouldBeBuiltin';

import * as Player from './Player';

export type PlayerSet = B.Branded<HS.HashSet<Player.ValidatedPlayer>, 'PlayerSet'>;

const PlayerSet = B.nominal<PlayerSet>();

export const add = (owner: Player.ValidatedPlayer): ((players: PlayerSet) => PlayerSet) =>
    flow(HS.add(owner), PlayerSet);

export type ValidatedPlayerSet = PlayerSet & B.Brand<'ValidatedPlayerSet'>;

export const ValidatedPlayerSet = Brand_refined<ValidatedPlayerSet>([
    // TODO check that there is at least 1 player
]);

export const empty: ValidatedPlayerSet = pipe(
    HS.empty(),
    PlayerSet,
    ValidatedPlayerSet,
    E.getOrThrow,
);
