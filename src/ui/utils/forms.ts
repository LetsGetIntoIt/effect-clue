
export const ifEnter = <E extends KeyboardEvent>(handle: (evt: E) => void) => (evt: E): void => {
    if (evt.key === 'Enter') {
        handle(evt);
    }
}
