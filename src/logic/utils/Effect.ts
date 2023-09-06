import { HashMap, Option, flow } from "effect";

export const getOrUndefined: {
    <K1>(key: K1): <K, V>(self: HashMap.HashMap<K, V>) => V | undefined
    <K, V, K1>(self: HashMap.HashMap<K, V>, key: K1): V | undefined
} = flow(HashMap.get, Option.getOrUndefined) as any;
