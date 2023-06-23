import { pipe } from "@effect/data/Function";
import { B } from "./EffectImports";

type MockedValue<A> = B.Branded<A, 'MockedValue'>;
const MockedValueOf = <A>() => B.nominal<MockedValue<A>>();

export const mockValue = <A = any>(id: string): MockedValue<A> =>
    pipe(Symbol(id) as any, MockedValueOf());
