import { newIdGenerator } from "./IdGenerator";

describe(newIdGenerator, () => {
    test('it generates IDs', () => {
        const idGenerator = newIdGenerator();
        expect(idGenerator.next()).toEqual("0");
        expect(idGenerator.next()).toEqual("1");
        expect(idGenerator.next()).toEqual("2");
    });

    test('it resets when a new generator is created', () => {
        const idGenerator1 = newIdGenerator();
        expect(idGenerator1.next()).toEqual("0");
        expect(idGenerator1.next()).toEqual("1");
        expect(idGenerator1.next()).toEqual("2");

        const idGenerator2 = newIdGenerator();
        expect(idGenerator2.next()).toEqual("0");
        expect(idGenerator2.next()).toEqual("1");
        expect(idGenerator2.next()).toEqual("2");
    });
});
