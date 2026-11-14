// Floor material by room type (a visual convention, not data from the drawing). Shared by the 2D and 3D views.
import type { RoomType } from '../../../shared/plan';

export type FloorKind = 'wood' | 'tiles' | 'concrete' | 'deck' | 'plain';
export const FLOOR_OF: Record<RoomType, FloorKind> = {
  living: 'wood', dining: 'wood', bedroom: 'wood', office: 'wood', circulation: 'wood', stair: 'wood',
  kitchen: 'tiles', bathroom: 'tiles', wc: 'tiles', utility: 'tiles',
  garage: 'concrete', plant: 'concrete', storage: 'concrete', lift: 'concrete', outdoor: 'deck', other: 'plain',
};

