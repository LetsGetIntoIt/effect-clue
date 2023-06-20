
import { D, HS } from '../utils/EffectImports';

import * as Card from './Card';

export interface OwnershipOfOwner  extends D.Case {
    _tag: "OwnershipOfOwner";
    readonly owned: HS.HashSet<Card.Card>;
    readonly unowned: HS.HashSet<Card.Card>;
};

export const OwnershipOfOwner = D.tagged<OwnershipOfOwner>("OwnershipOfOwner");
