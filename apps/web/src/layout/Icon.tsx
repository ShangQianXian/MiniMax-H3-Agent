import type { CSSProperties } from 'react';

const paths = {
  edit: 'm16 3 5 5-12 12H4v-5L16 3ZM13 6l5 5',
  trash: 'M3 6h18M9 6V3h6v3M5 6l1 15h12l1-15M10 10v7M14 10v7',
  plus: 'M12 5v14M5 12h14',
  folder: 'M3 7V5h6l2 3h10l-3 12H3V7Z',
  nodes: 'M4 3h6v6H4zM14 15h6v6h-6zM7 9v7h7',
  spark: 'm12 3 2.5 6.5L21 12l-6.5 2.5L12 21l-2.5-6.5L3 12l6.5-2.5Z',
  tasks: 'M9 5h11M9 12h11M9 19h11M3 5h1M3 12h1M3 19h1',
  expand: 'M14 4h6v6M20 4l-7 7M10 20H4v-6M4 20l7-7',
  arrow: 'M12 20V4m-6 6 6-6 6 6',
  wave: 'M3 10v4M7 6v12M12 3v18M17 7v10M21 10v4',
  close: 'm6 6 12 12M6 18 18 6',
  chevron: 'm6 9 6 6 6-6',
  image: 'M3 3h18v18H3zM3 16l6-6 7 7 3-3 2 2M15 7h.01',
  help: 'M9 9a3 3 0 1 1 5 2c-2 1-2 2-2 3M12 17h.01',
  grid: 'M3 3h7v7H3zM14 3h7v7h-7zM3 14h7v7H3zM14 14h7v7h-7z',
  map: 'm3 5 6-2 6 2 6-2v16l-6 2-6-2-6 2V5ZM9 3v16M15 5v16',
  panel: 'M3 4h18v16H3zM9 4v16',
  download: 'M12 3v12m-5-5 5 5 5-5M4 16v5h16v-5',
};
export function Icon({ name, size = 18, style }: { name: keyof typeof paths; size?: number; style?: CSSProperties }) {
  return <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" style={style}><path d={paths[name]} />{name === 'help' && <circle cx="12" cy="12" r="10" />}</svg>;
}
