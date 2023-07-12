import { HS } from '../utils/effect/EffectImports';

import { Card } from '../objects';

export const northAmerica: HS.HashSet<Card.Card> = HS.fromIterable([
    Card.decodeSync(['Suspect', 'Miss Scarlet' ]),
    Card.decodeSync(['Suspect', 'Col. Mustard' ]),
    Card.decodeSync(['Suspect', 'Mrs. White' ]),
    Card.decodeSync(['Suspect', 'Mr. Green' ]),
    Card.decodeSync(['Suspect', 'Mrs. Peacock' ]),
    Card.decodeSync(['Suspect', 'Prof. Plum' ]),
    Card.decodeSync(['Weapon', 'Candlestick' ]),
    Card.decodeSync(['Weapon', 'Knife' ]),
    Card.decodeSync(['Weapon', 'Lead pipe' ]),
    Card.decodeSync(['Weapon', 'Revolver' ]),
    Card.decodeSync(['Weapon', 'Rope' ]),
    Card.decodeSync(['Weapon', 'Wrench' ]),
    Card.decodeSync(['Room', 'Kitchen' ]),
    Card.decodeSync(['Room', 'Ball room' ]),
    Card.decodeSync(['Room', 'Conservatory' ]),
    Card.decodeSync(['Room', 'Dining room' ]),
    Card.decodeSync(['Room', 'Billiard room' ]),
    Card.decodeSync(['Room', 'Library' ]),
    Card.decodeSync(['Room', 'Lounge' ]),
    Card.decodeSync(['Room', 'Hall' ]),
    Card.decodeSync(['Room', 'Study' ]),
]);
