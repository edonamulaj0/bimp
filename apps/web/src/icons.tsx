// Line icons on a 20 px grid, 1.5 px strokes, currentColor. Decorative: the control carries the name.
const P: Record<string, string> = {
  menu: 'M3 5.5h14M3 10h14M3 14.5h14',
  sidebar: 'M3.5 4h13v12h-13zM8 4v12',
  plus: 'M10 4v12M4 10h12',
  grid: 'M3.5 3.5h5.5v5.5H3.5zM11 3.5h5.5v5.5H11zM3.5 11h5.5v5.5H3.5zM11 11h5.5v5.5H11z',
  list: 'M3 5h14M3 10h14M3 15h14',
  folder: 'M2.5 5.5v10h15v-8.5h-8l-1.5-1.5z',
  user: 'M10 10a3.25 3.25 0 1 0 0-6.5 3.25 3.25 0 0 0 0 6.5zM3.5 17c.7-3 3.4-4.75 6.5-4.75s5.8 1.75 6.5 4.75',
  team: 'M7 9.5a2.75 2.75 0 1 0 0-5.5 2.75 2.75 0 0 0 0 5.5zM1.75 16c.6-2.6 2.7-4 5.25-4s4.65 1.4 5.25 4M13.5 9a2.25 2.25 0 1 0 0-4.5M14.5 11.75c1.9.3 3.3 1.6 3.75 3.75',
  gear: 'M10 12.5a2.5 2.5 0 1 0 0-5 2.5 2.5 0 0 0 0 5zM10 2.5v2M10 15.5v2M2.5 10h2M15.5 10h2M4.7 4.7l1.4 1.4M13.9 13.9l1.4 1.4M4.7 15.3l1.4-1.4M13.9 6.1l1.4-1.4',
  more: 'M5 10h.01M10 10h.01M15 10h.01',
  close: 'M5 5l10 10M15 5L5 15',
  chat: 'M3.5 4.5h13v9h-7l-3.5 3v-3h-2.5z',
  pin: 'M10 17.5s5.25-4.9 5.25-9.25a5.25 5.25 0 1 0-10.5 0C4.75 12.6 10 17.5 10 17.5zM10 10.25a2 2 0 1 0 0-4 2 2 0 0 0 0 4z',
  history: 'M3.5 10a6.5 6.5 0 1 0 1.9-4.6M3.5 3.5v3.25h3.25M10 6.5V10l2.5 1.75',
  info: 'M10 17.5a7.5 7.5 0 1 0 0-15 7.5 7.5 0 0 0 0 15zM10 9v5M10 6.25h.01',
  upload: 'M10 13V3.5M6.25 7.25 10 3.5l3.75 3.75M3.5 13v3.5h13V13',
  check: 'M4.5 10.5l3.5 3.5 7.5-8',
  chevron: 'M7.5 5l5 5-5 5',
  signout: 'M8 3.5H3.5v13H8M12.5 6.5 16 10l-3.5 3.5M16 10H7.5',
  compare: 'M7 3.5v13M13 3.5v13M3.5 7H7M13 13h3.5',
};
export const Icon = ({ name, size = 18 }: { name: keyof typeof P | string; size?: number }) => (
  <svg class="ico" width={size} height={size} viewBox="0 0 20 20" fill="none" stroke="currentColor" stroke-width="1.5"
    stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" focusable="false">
    <path d={P[name]} />
  </svg>
);
