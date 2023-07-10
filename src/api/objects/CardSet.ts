import { HS } from '../utils/effect/EffectImports';

import { Card } from '../objects';

export const northAmerica: HS.HashSet<Card.Card> = HS.fromIterable([
    Card.decode(['Suspect', 'Miss Scarlet' ]),
    Card.decode(['Suspect', 'Col. Mustard' ]),
    Card.decode(['Suspect', 'Mrs. White' ]),
    Card.decode(['Suspect', 'Mr. Green' ]),
    Card.decode(['Suspect', 'Mrs. Peacock' ]),
    Card.decode(['Suspect', 'Prof. Plum' ]),
    Card.decode(['Weapon', 'Candlestick' ]),
    Card.decode(['Weapon', 'Knife' ]),
    Card.decode(['Weapon', 'Lead pipe' ]),
    Card.decode(['Weapon', 'Revolver' ]),
    Card.decode(['Weapon', 'Rope' ]),
    Card.decode(['Weapon', 'Wrench' ]),
    Card.decode(['Room', 'Kitchen' ]),
    Card.decode(['Room', 'Ball room' ]),
    Card.decode(['Room', 'Conservatory' ]),
    Card.decode(['Room', 'Dining room' ]),
    Card.decode(['Room', 'Billiard room' ]),
    Card.decode(['Room', 'Library' ]),
    Card.decode(['Room', 'Lounge' ]),
    Card.decode(['Room', 'Hall' ]),
    Card.decode(['Room', 'Study' ]),
]);
