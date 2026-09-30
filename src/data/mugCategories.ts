import type { MugCategory } from '../types/mugs';

/** The shelves on /mugs. Order here is the order on the page. */
export const MUG_CATEGORIES: MugCategory[] = [
  { id: 'bookish', label: 'Bookish Mugs', blurb: 'For the chapter you promised was your last.' },
  { id: 'minimal', label: 'Minimal Mugs', blurb: 'Quiet shapes. Nothing to read but your book.' },
  { id: 'funny-reader', label: 'Funny Reader Mugs', blurb: 'For TBRs that have become a lifestyle.' },
  { id: 'cafe-style', label: 'Café-Style Mugs', blurb: 'The weight of a good café cup, at home.' },
  { id: 'aesthetic', label: 'Aesthetic Mugs', blurb: 'Glaze, texture, and a little morning light.' },
  { id: 'personalized', label: 'Personalized Mugs', blurb: 'A name, a line, a detail that is yours.' },
];
