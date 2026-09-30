/**
 * Coffee mug marketplace types (30 Sep 2026).
 *
 * A MugProduct only ever comes from an authorised source — an affiliate
 * feed, a merchant's own product data, or a product SwapSutra has
 * permission to list — through the MugProducts sheet (Apps Script
 * getMugProducts). Optional fields stay empty rather than being invented:
 * no MRP, rating or availability is shown unless the source supplied it.
 */
export type MugCategoryId = 'bookish' | 'minimal' | 'funny-reader' | 'cafe-style' | 'aesthetic' | 'personalized';

export interface MugProduct {
  id: string;
  title: string;
  description: string;
  category: MugCategoryId;
  imageUrl: string;
  price: number | null;
  /** Only when the source supplied it and it is above price. */
  mrp: number | null;
  currency: string;
  availability: string;
  /** e.g. "Amazon", "Flipkart", or empty for SwapSutra's own listing. */
  sourceMarketplace: string;
  sourceUrl: string;
  affiliateUrl: string;
  vendor: string;
  /** Only when the source supplied it, with ratingSource naming where from. */
  rating: number | null;
  ratingCount: number | null;
  ratingSource: string;
  /** Set only on DEVELOPMENT ONLY sample data (src/data/mugs.dev.ts). */
  devSample?: boolean;
}

export interface MugCategory {
  id: MugCategoryId;
  label: string;
  blurb: string;
}
