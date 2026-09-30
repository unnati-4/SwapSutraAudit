/**
 * ⚠ DEVELOPMENT ONLY — SAMPLE DATA ⚠
 *
 * These are NOT real products, prices or sellers. They exist so the /mugs
 * layout can be built and reviewed on a developer's machine before an
 * authorised product feed is connected. MugsPage imports this file only
 * behind `import.meta.env.DEV`, so it is removed from production builds
 * (tests/test_mugs_marketplace.cjs checks the built bundle).
 * No ratings, discounts or availability are invented here.
 */
import type { MugProduct } from '../types/mugs';

const base = {
  imageUrl: '', mrp: null, currency: 'INR', availability: '', sourceMarketplace: '', sourceUrl: '',
  affiliateUrl: '', vendor: 'DEV SAMPLE', rating: null, ratingCount: null, ratingSource: '', devSample: true,
};

export const DEV_SAMPLE_MUGS: MugProduct[] = [
  { ...base, id: 'dev-1', category: 'bookish', title: '[DEV SAMPLE] Margin Notes Mug', description: 'Sample card: a cream mug with a pencilled margin note.', price: 499 },
  { ...base, id: 'dev-2', category: 'minimal', title: '[DEV SAMPLE] Plain Stoneware Mug', description: 'Sample card: an unglazed rim, nothing else.', price: 649 },
  { ...base, id: 'dev-3', category: 'funny-reader', title: '[DEV SAMPLE] One More Chapter Mug', description: 'Sample card with a longer description to check that two lines clamp neatly on a narrow phone screen.', price: 399 },
  { ...base, id: 'dev-4', category: 'cafe-style', title: '[DEV SAMPLE] Café Cup & Saucer', description: 'Sample card: a heavier café-style cup.', price: 899, mrp: 1099, sourceMarketplace: 'Sample marketplace', sourceUrl: 'https://example.com/dev-sample' },
  { ...base, id: 'dev-5', category: 'aesthetic', title: '[DEV SAMPLE] Speckled Glaze Mug', description: 'Sample card: speckled glaze.', price: 749 },
  { ...base, id: 'dev-6', category: 'personalized', title: '[DEV SAMPLE] Your Initials Mug', description: 'Sample card: a personalised mug.', price: null },
];
