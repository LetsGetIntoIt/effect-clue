import { ReadonlyArray, pipe } from "effect";
import { Card, CardCategory } from "../../logic";

export const cardsByCategory = (cards: Card[]): Record<CardCategory, Card[]> => pipe(
        cards,

        ReadonlyArray.reduce<Record<CardCategory, Card[]>, Card>(
            {},
            (cardsByCategory, card) => {
                const [category] = card;
                const otherCardsInCategory = cardsByCategory[category] ?? [];
                return {
                    ...cardsByCategory,
                    [category]: [...otherCardsInCategory, card] ,
                };
            }
        ),
    );
