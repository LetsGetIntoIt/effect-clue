import { Data, Predicate, Number as EffectNumber } from "effect";
import { dual, flow } from "effect/Function";

export type Probability = Data.Data<{
    numerator: bigint;
    denominator: bigint;
}>;

export const Probability = (numerator: bigint, denominator: bigint): Probability =>
    Data.struct({ numerator, denominator });

export const isAlways: Predicate.Predicate<Probability> = ({ numerator, denominator }) =>
    numerator === denominator;

export const isNever: Predicate.Predicate<Probability> = ({ numerator }) =>
    numerator === 0n;

export const toDecimal = (probability: Probability): number =>
    Number(probability.numerator) / Number(probability.denominator);

export const match: {
    <A>({
        onAlways,        
        onNever,
        otherwise,
    }: {
        onAlways: (probability: Probability) => A;
        onNever: (probability: Probability) => A;
        otherwise: (probability: Probability) => A;
    }): (
        self: Probability,
    ) => A,

    <A>(
        self: Probability,
        {
            onAlways,        
            onNever,
            otherwise,
        }: {
            onAlways: (probability: Probability) => A;
            onNever: (probability: Probability) => A;
            otherwise: (probability: Probability) => A;
        }
    ): A,
} = dual(
    2,

    <A>(
        self: Probability,
        {
            onAlways,        
            onNever,
            otherwise,
        }: {
            onAlways: (probability: Probability) => A;
            onNever: (probability: Probability) => A;
            otherwise: (probability: Probability) => A;
        }
    ): A => {
        if (isAlways(self)) {
            return onAlways(self);
        }
    
        if (isNever(self)) {
            return onNever(self);
        }

        return otherwise(self);
    },
);

export const toPercent = (probability: Probability): number =>
    match(probability, {
        onAlways: () => 100,
        onNever: () => 0,
        otherwise: flow(toDecimal, EffectNumber.multiply(100)),
    });
