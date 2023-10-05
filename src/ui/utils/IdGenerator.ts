
export interface IdGenerator<A> {
    next: () => A;
}

export const newIdGenerator = (): IdGenerator<string> => {
    const generator = (function* () {
        let nextId = 0;
        while (true) {
            yield String(nextId);
            nextId++;
        }
    })();

    return {
        next: () => generator.next().value as string,
    };
}
