import { Either, HashMap, Option } from "effect";
import { dual, pipe } from "effect/Function";

export const getOrUndefined: {
    <K1>(key: K1): <K, V>(self: HashMap.HashMap<K, V>) => V | undefined
    <K, V, K1>(self: HashMap.HashMap<K, V>, key: K1): V | undefined
} = dual(
    2,
    <K, V, K1>(self: HashMap.HashMap<K, V>, key: K1): V | undefined =>
        pipe(HashMap.get(self, key), Option.getOrUndefined),
);

export const modifyAtOrFail: {
    <K, E, V>(
        key: K,
        f: (value: Option.Option<V>) => Either.Either<E, V>,
    ): (
        self: HashMap.HashMap<K, V>,
    ) => Either.Either<E, HashMap.HashMap<K, V>>,

    <K, E, V>(
        self: HashMap.HashMap<K, V>,
        key: K,
        f: (value: Option.Option<V>) => Either.Either<E, V>,
    ): Either.Either<E, HashMap.HashMap<K, V>>
} = dual(
    3,

    <K, E, V>(
        self: HashMap.HashMap<K, V>,
        key: K,
        f: (value: Option.Option<V>) => Either.Either<E, V>,
    ): Either.Either<E, HashMap.HashMap<K, V>> => {
        const existingValue = HashMap.get(self, key);
        const updatedValue = f(existingValue);
        return Either.map(updatedValue, updatedValue => HashMap.set(self, key, updatedValue));
    },
);
