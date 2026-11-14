import type { RoomType } from '../../../shared/plan';

export const ROOM_COLORS: Record<RoomType, string> = {
  // muted, architectural tones that sit on warm paper; one hue family per kind of space
  living: '#e6c07a',
  dining: '#e0a46c',
  bedroom: '#9cb7cf',
  kitchen: '#e79a77',
  bathroom: '#8bc4b5',
  wc: '#a8d2c7',
  utility: '#b8c4b3',
  circulation: '#d6cfc2',
  stair: '#b3ada2',
  lift: '#9c978d',
  storage: '#c8b38e',
  office: '#b8a8d2',
  garage: '#afaaa1',
  plant: '#c8a69f',
  outdoor: '#a8c789',
  other: '#d8b2c3',
};
