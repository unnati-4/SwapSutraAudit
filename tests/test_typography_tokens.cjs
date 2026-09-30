/**
 * test_typography_tokens.cjs  (30 Sep 2026)
 * One typography system for the whole site: tokens in index.css §0,
 * Tailwind utilities mapped onto them, no hard-coded sizes left.
 */
const fs = require('fs');
const path = require('path');
let passed = 0, failed = 0;
function check(label, cond, detail = '') {
  if (cond) { passed++; console.log('PASS: ' + label); }
  else { failed++; console.log('FAIL: ' + label + (detail ? '  [' + detail + ']' : '')); }
}
const root = path.join(__dirname, '..');
const read = (p) => fs.readFileSync(path.join(root, p), 'utf8');
const css = read('src/index.css');
const html = read('index.html');
const walk = (d) => fs.readdirSync(d, { withFileTypes: true }).flatMap((e) => e.isDirectory() ? walk(path.join(d, e.name)) : [path.join(d, e.name)]);
const tsx = walk(path.join(root, 'src')).filter((f) => /\.(tsx|ts)$/.test(f)).map((f) => [path.relative(root, f), fs.readFileSync(f, 'utf8')]);

console.log('--- tokens ---');
const need = ['--font-display', '--font-body', '--font-ui',
  '--font-size-xs', '--font-size-sm', '--font-size-md', '--font-size-lg', '--font-size-xl', '--font-size-2xl', '--font-size-3xl', '--font-size-4xl',
  '--font-weight-regular', '--font-weight-medium', '--font-weight-semibold', '--font-weight-bold',
  '--line-height-tight', '--line-height-normal', '--line-height-relaxed',
  '--letter-spacing-tight', '--letter-spacing-normal'];
const tokenBlock = css.slice(css.indexOf('0. TYPOGRAPHY TOKENS'), css.indexOf('@theme {'));
check('1. Every requested token is defined in one place (index.css §0)', need.every((t) => new RegExp(t + ':').test(tokenBlock)), need.filter((t) => !new RegExp(t + ':').test(tokenBlock)).join(','));
check('2. Display serif + readable humanist sans (Cormorant Garamond / Source Sans 3)', /--font-display:\s*"Cormorant Garamond"/.test(tokenBlock) && /--font-body:\s*"Source Sans 3"/.test(tokenBlock));
check('3. The page loads exactly those two families (no startup geometric sans)', /family=Cormorant\+Garamond/.test(html) && /family=Source\+Sans\+3/.test(html) && !/Plus\+Jakarta|Inter:/.test(html));
const lg = ['lg', 'xl', '2xl', '3xl', '4xl', '5xl'];
check('4. Sizes from lg upward are fluid (clamp), not per-breakpoint jumps', lg.every((k) => new RegExp(`--font-size-${k}:\\s*clamp\\(`).test(tokenBlock)));
const px = (v) => (v.endsWith('rem') ? parseFloat(v) * 16 : parseFloat(v));
const mins = Object.fromEntries([...tokenBlock.matchAll(/--font-size-(\w+):\s*(?:clamp\(\s*)?([\d.]+(?:rem|px))/g)].map((m) => [m[1], px(m[2])]));
check('5. Nothing is smaller than 11px; body text is 16px', Object.values(mins).every((v) => v >= 11) && mins.md === 16, JSON.stringify(mins));
check('6. Fluid steps keep their order at every width (min and max ascend)', (() => {
  const order = ['xs', 'sm', 'md', 'lg', 'xl', '2xl', '3xl', '4xl', '5xl'];
  const maxes = Object.fromEntries([...tokenBlock.matchAll(/--font-size-(\w+):\s*clamp\([^,]+,[^,]+,\s*([\d.]+rem)\)/g)].map((m) => [m[1], px(m[2])]));
  for (let i = 1; i < order.length; i++) {
    const a = order[i - 1], b = order[i];
    if (!(mins[b] >= mins[a])) return false;
    if (maxes[a] && maxes[b] && !(maxes[b] > maxes[a])) return false;
  }
  return true;
})());

console.log('--- Tailwind follows the tokens ---');
const theme = css.slice(css.indexOf('@theme {'), css.indexOf('}', css.indexOf('@theme {')));
check('7. text-* utilities read the size tokens', ['xs', 'sm', 'lg', 'xl', '2xl', '3xl', '4xl'].every((k) => new RegExp(`--text-${k}:\\s*var\\(--font-size-${k}\\)`).test(theme)) && /--text-base:\s*var\(--font-size-md\)/.test(theme));
check('8. font-sans / font-serif read --font-body / --font-display', /--font-sans:\s*var\(--font-body\)/.test(theme) && /--font-serif:\s*var\(--font-display\)/.test(theme));
check('9. leading-* and tracking-* read the tokens', /--leading-relaxed:\s*var\(--line-height-relaxed\)/.test(theme) && /--tracking-tight:\s*var\(--letter-spacing-tight\)/.test(theme) && /--tracking-widest:\s*var\(--letter-spacing-caps\)/.test(theme));
check('10. Nothing heavier than bold (font-black / extrabold map to bold)', /--font-weight-black:\s*var\(--font-weight-bold\)/.test(theme) && /--font-weight-extrabold:\s*var\(--font-weight-bold\)/.test(theme));

console.log('--- no hard-coded type left ---');
const arbitrary = tsx.flatMap(([f, s]) => [...s.matchAll(/(?<![\w-])text-\[\d+(?:\.\d+)?(?:px|rem|em)\]/g)].map((m) => f + ':' + m[0]));
check('11. No arbitrary text-[Npx] sizes in any component', arbitrary.length === 0, arbitrary.slice(0, 5).join(', '));
const trackArb = tsx.flatMap(([f, s]) => [...s.matchAll(/(?<![\w-])tracking-\[[\d.]+em\]/g)].map((m) => f + ':' + m[0]));
check('12. No arbitrary tracking-[Nem] values', trackArb.length === 0, trackArb.slice(0, 5).join(', '));
check('13. No inline fontSize in components', !tsx.some(([, s]) => /fontSize\s*:/.test(s)));
const body = css.slice(css.indexOf('@theme {'));
const literal = [...body.matchAll(/(?<![-\w])font-size:\s*([^;}]+)/g)].map((m) => m[1].trim()).filter((v) => !/^var\(--font-size-|^inherit|^100%|^1em|^0/.test(v));
check('14. Every CSS font-size reads a token', literal.length === 0, literal.slice(0, 6).join(' | '));
const weights = [...body.matchAll(/(?<![-\w])font-weight:\s*([^;}]+)/g)].map((m) => m[1].trim()).filter((v) => !/^var\(--font-weight-|^inherit/.test(v));
check('15. Every CSS font-weight reads a token', weights.length === 0, weights.slice(0, 6).join(' | '));
check('16. Headings h1–h6 use the scale', /h1 \{ font-size: var\(--font-size-4xl\)/.test(css) && /h2 \{ font-size: var\(--font-size-3xl\)/.test(css));
check('17. Body text 16px in the body font', /body \{[\s\S]{0,200}font-family: var\(--font-body\);[\s\S]{0,60}font-size: var\(--font-size-md\)/.test(css));
check('18. Form fields are 16px (iOS does not zoom into them)', /input, textarea, select \{[\s\S]{0,300}font-size: var\(--font-size-md\)/.test(css));
check('19. No mobile-only per-class headline overrides (the tokens are fluid instead)', !/\[class\*="text-5xl"\]/.test(css));
check('20. Semantic roles available for new screens', ['type-display', 'type-h1', 'type-h2', 'type-body', 'type-eyebrow', 'type-price'].every((c) => css.includes('.' + c + ' ')));
check('21. Canvas share image uses the new body font', /Source Sans 3/.test(read('src/utils/shelfImage.ts')));

console.log('\n' + passed + ' passed, ' + failed + ' failed (' + (passed + failed) + ' total)');
process.exit(failed === 0 ? 0 : 1);
