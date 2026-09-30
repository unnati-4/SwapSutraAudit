/**
 * Custom mug enquiry — options, validation and the "Your Mug Brief"
 * summary, shared by the form and its tests (30 Sep 2026).
 *
 * The server (appsscript.js, validateCustomMugEnquiry_) repeats every rule
 * and accepts only these option values; tests/test_custom_mug_enquiry.cjs
 * keeps the two lists identical. Nothing here promises a price, a maker,
 * feasibility or a delivery date.
 */

export const MUG_TYPES = ['Coffee Mug', 'Café Mug', 'Travel Mug', 'Handleless Mug', 'Large Mug', 'Mini Mug', 'Espresso Cup', 'Tea Cup', 'Other'] as const;

export const MUG_VOLUME_OPTIONS = [
  { id: '100-150', label: '100–150 ml', hint: 'Espresso / Mini', min: 100, max: 150 },
  { id: '150-200', label: '150–200 ml', hint: 'Small', min: 150, max: 200 },
  { id: '200-250', label: '200–250 ml', hint: 'Regular', min: 200, max: 250 },
  { id: '250-300', label: '250–300 ml', hint: 'Medium', min: 250, max: 300 },
  { id: '300-350', label: '300–350 ml', hint: 'Large', min: 300, max: 350 },
  { id: '350-450', label: '350–450 ml', hint: 'Extra Large', min: 350, max: 450 },
  { id: '450-600', label: '450–600 ml', hint: 'Oversized', min: 450, max: 600 },
] as const;
export const MUG_CUSTOM_VOLUME = { min: 30, max: 2000 };
export const CAPACITY_NOTE = 'Approximate capacity is fine. We’ll confirm the final usable volume during design/prototyping.';

export const MUG_QUANTITY_OPTIONS = [
  { id: '1', label: '1', min: 1, max: 1 },
  { id: '2-5', label: '2–5', min: 2, max: 5 },
  { id: '6-20', label: '6–20', min: 6, max: 20 },
  { id: '21-50', label: '21–50', min: 21, max: 50 },
  { id: '50+', label: '50+', min: 51, max: 100000 },
] as const;

export const MUG_BUDGET_TYPES = [
  { id: 'per_mug', label: 'Per mug' },
  { id: 'total', label: 'Total project' },
] as const;

/** Chips that fill the amount; the amount stored is the range's upper bound (or the floor of "10,000+"). */
export const MUG_BUDGET_RANGES = [
  { label: 'Under ₹500', amount: 500 },
  { label: '₹500–₹1,000', amount: 1000 },
  { label: '₹1,000–₹2,000', amount: 2000 },
  { label: '₹2,000–₹5,000', amount: 5000 },
  { label: '₹5,000–₹10,000', amount: 10000 },
  { label: '₹10,000+', amount: 10000 },
] as const;

export const MUG_TIMELINES = [
  { id: 'no_rush', label: 'No rush' },
  { id: 'within_2_weeks', label: 'Within 2 weeks' },
  { id: 'within_1_month', label: 'Within 1 month' },
  { id: '1_3_months', label: '1–3 months' },
  { id: 'specific_date', label: 'Need it by a specific date' },
] as const;

export const MUG_IMAGE_TYPES = ['image/jpeg', 'image/jpg', 'image/png', 'image/webp'];
export const MUG_IMAGE_INPUT_MAX_BYTES = 15 * 1024 * 1024;   // what we accept from the phone
export const MUG_IMAGE_UPLOAD_MAX_BYTES = 1.5 * 1024 * 1024; // what we send after shrinking

export interface MugEnquiryForm {
  name: string;
  email: string;
  phone: string;
  idea: string;
  mugType: string;
  volumeRange: string;       // an option id, or 'custom'
  volumeCustomMl: string;
  quantityRange: string;
  quantityExact: string;
  budgetType: string;
  budgetAmount: string;
  budgetRange: string;
  pincode: string;
  city: string;
  state: string;
  timeline: string;
  specificDate: string;
  additionalNotes: string;
  website: string;            // honeypot — people never see or fill it
}

export const EMPTY_MUG_ENQUIRY: MugEnquiryForm = {
  name: '', email: '', phone: '', idea: '', mugType: '', volumeRange: '', volumeCustomMl: '',
  quantityRange: '', quantityExact: '', budgetType: 'per_mug', budgetAmount: '', budgetRange: '',
  pincode: '', city: '', state: '', timeline: '', specificDate: '', additionalNotes: '', website: '',
};

export type MugErrors = Partial<Record<keyof MugEnquiryForm | 'referenceImage', string>>;

/** Which fields each step owns — the Next button checks only these. */
export const MUG_STEP_FIELDS: (keyof MugEnquiryForm)[][] = [
  ['name', 'email', 'phone', 'idea'],
  ['mugType', 'volumeRange', 'volumeCustomMl', 'quantityRange', 'quantityExact', 'budgetType', 'budgetAmount'],
  ['pincode', 'city', 'state', 'timeline', 'specificDate', 'additionalNotes'],
];

export const normaliseIndianPhone = (raw: string): string | null => {
  const m = String(raw || '').replace(/[\s\-().]/g, '').match(/^(?:\+?91|0)?([6-9]\d{9})$/);
  return m ? m[1] : null;
};

const todayIst = (now: Date) => new Date(now.getTime() + 330 * 60 * 1000).toISOString().slice(0, 10);

export function validateMugEnquiry(f: MugEnquiryForm, now: Date = new Date()): MugErrors {
  const e: MugErrors = {};
  if (f.name.trim().length < 2) e.name = 'Please tell us your name.';
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(f.email.trim())) e.email = 'Please enter a valid email address.';
  if (!normaliseIndianPhone(f.phone)) e.phone = 'Please enter a 10-digit Indian mobile number.';
  if (f.idea.trim().length < 20) e.idea = 'Tell us a little more about your mug idea (at least 20 characters).';
  else if (f.idea.length > 3000) e.idea = 'Please keep the idea under 3,000 characters.';

  if (!(MUG_TYPES as readonly string[]).includes(f.mugType)) e.mugType = 'Please choose a mug style.';
  if (f.volumeRange === 'custom') {
    const ml = Number(f.volumeCustomMl);
    if (!f.volumeCustomMl.trim() || !Number.isFinite(ml) || ml < MUG_CUSTOM_VOLUME.min || ml > MUG_CUSTOM_VOLUME.max) {
      e.volumeCustomMl = `Enter a capacity between ${MUG_CUSTOM_VOLUME.min} and ${MUG_CUSTOM_VOLUME.max} ml.`;
    }
  } else if (!MUG_VOLUME_OPTIONS.some((o) => o.id === f.volumeRange)) {
    e.volumeRange = 'Please choose how much it should hold.';
  }
  const q = MUG_QUANTITY_OPTIONS.find((o) => o.id === f.quantityRange);
  if (!q) e.quantityRange = 'Please choose how many mugs you need.';
  if (f.quantityExact.trim()) {
    const n = Number(f.quantityExact);
    if (!Number.isInteger(n) || n < 1 || n > 100000) e.quantityExact = 'Exact quantity must be a whole number.';
    else if (q && (n < q.min || n > q.max)) e.quantityExact = 'That number does not match the range you picked.';
  }
  if (!MUG_BUDGET_TYPES.some((b) => b.id === f.budgetType)) e.budgetType = 'Is the budget per mug or for the whole order?';
  const amount = Number(f.budgetAmount);
  if (!f.budgetAmount.trim() || !Number.isFinite(amount) || amount <= 0) e.budgetAmount = 'Please enter a budget in rupees.';
  else if (amount > 10000000) e.budgetAmount = 'That budget looks too large — please check it.';

  if (!/^[1-9]\d{5}$/.test(f.pincode.trim())) e.pincode = 'Please enter a valid 6-digit pincode.';
  if (!MUG_TIMELINES.some((t) => t.id === f.timeline)) e.timeline = 'When do you need it?';
  if (f.timeline === 'specific_date') {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(f.specificDate)) e.specificDate = 'Please pick the date you need it by.';
    else if (f.specificDate < todayIst(now)) e.specificDate = 'That date has already passed.';
  }
  if (f.additionalNotes.length > 1000) e.additionalNotes = 'Please keep notes under 1,000 characters.';
  return e;
}

export const stepErrors = (errors: MugErrors, step: number): MugErrors =>
  Object.fromEntries(Object.entries(errors).filter(([k]) => (MUG_STEP_FIELDS[step] || []).includes(k as keyof MugEnquiryForm))) as MugErrors;

/** Capacity as a number of ml (midpoint of a range), plus the range text. */
export function capacityOf(f: MugEnquiryForm): { volumeMl: number | null; volumeRange: string } {
  if (f.volumeRange === 'custom') {
    const ml = Math.round(Number(f.volumeCustomMl));
    return { volumeMl: Number.isFinite(ml) && ml > 0 ? ml : null, volumeRange: 'Custom' };
  }
  const o = MUG_VOLUME_OPTIONS.find((x) => x.id === f.volumeRange);
  return o ? { volumeMl: Math.round((o.min + o.max) / 2), volumeRange: o.label } : { volumeMl: null, volumeRange: '' };
}

const inr = (n: number) => '₹' + n.toLocaleString('en-IN');

/** "Your Mug Brief" rows, as the customer sees them before sending. */
export function mugBrief(f: MugEnquiryForm): { icon: string; label: string; value: string }[] {
  const cap = capacityOf(f);
  const q = MUG_QUANTITY_OPTIONS.find((o) => o.id === f.quantityRange);
  const qty = f.quantityExact.trim() ? `${Number(f.quantityExact)} ${Number(f.quantityExact) === 1 ? 'mug' : 'mugs'}`
    : q ? (q.id === '1' ? '1 mug' : `${q.label} mugs`) : '';
  const budgetType = MUG_BUDGET_TYPES.find((b) => b.id === f.budgetType)?.label.toLowerCase() || '';
  const amount = Number(f.budgetAmount);
  const timeline = f.timeline === 'specific_date' && f.specificDate
    ? `By ${new Date(f.specificDate + 'T00:00:00').toLocaleDateString('en-IN', { day: 'numeric', month: 'long', year: 'numeric' })}`
    : MUG_TIMELINES.find((t) => t.id === f.timeline)?.label || '';
  return [
    { icon: '☕', label: 'Style', value: f.mugType },
    { icon: '📏', label: 'Capacity', value: cap.volumeMl ? (f.volumeRange === 'custom' ? `${cap.volumeMl} ml` : `${cap.volumeRange} (about ${cap.volumeMl} ml)`) : '' },
    { icon: '📦', label: 'Quantity', value: qty },
    { icon: '💰', label: 'Budget', value: Number.isFinite(amount) && amount > 0 ? `${inr(amount)} ${budgetType}` : '' },
    { icon: '📍', label: 'Delivery', value: [f.pincode.trim(), [f.city.trim(), f.state.trim()].filter(Boolean).join(', ')].filter(Boolean).join(' · ') },
    { icon: '🗓', label: 'Timeline', value: timeline },
  ];
}

/** The request body for Apps Script submitCustomMugEnquiry. */
export function toEnquiryPayload(f: MugEnquiryForm, referenceImage: string) {
  const cap = capacityOf(f);
  return {
    action: 'submitCustomMugEnquiry',
    name: f.name.trim(), email: f.email.trim(), phone: f.phone.trim(), idea: f.idea.trim(),
    mugType: f.mugType,
    volumeRange: f.volumeRange, volumeMl: cap.volumeMl,
    quantityRange: f.quantityRange, quantityExact: f.quantityExact.trim(),
    budgetType: f.budgetType, budgetAmount: Number(f.budgetAmount), budgetRange: f.budgetRange,
    pincode: f.pincode.trim(), city: f.city.trim(), state: f.state.trim(),
    timeline: f.timeline, specificDate: f.timeline === 'specific_date' ? f.specificDate : '',
    additionalNotes: f.additionalNotes.trim(),
    website: f.website,
    referenceImage,
  };
}
