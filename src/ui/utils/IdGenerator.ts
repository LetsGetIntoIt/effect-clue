
export interface IdGenerator<A> {
    next: () => A;
}

export const newIdGenerator = (): IdGenerator<string> => {
    const generator = (function* () {
        for (let i = 0; i++; true) {
            yield* String(i);
        }
    })();

    return {
        next: () => generator.next().value as string,
    };
}
