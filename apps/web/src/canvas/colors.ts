import type { RoomType } from '../../../shared/plan';

export const ROOM_COLORS: Record<RoomType, string> = {
  // charcoal, off-white and orange only: orange tints where people live, warm greys for service and circulation
  living: '#f6c9a8',
  dining: '#f2b78f',
  kitchen: '#f0a070',
  bedroom: '#f3ddc8',
  office: '#e9c2a0',
  bathroom: '#c9c2b5',
  wc: '#bab3a6',
  utility: '#aaa397',
  circulation: '#e4ded3',
  stair: '#9c968b',
  lift: '#8a857b',
  storage: '#d0c9bc',
  garage: '#958f85',
  plant: '#7f7a71',
  outdoor: '#ebe6dc',
  other: '#d6cfc2',
};
