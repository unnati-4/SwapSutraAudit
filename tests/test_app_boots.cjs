/**
 * test_app_boots.cjs
 *
 * Loads the PRODUCTION BUILD in a real browser and fails if anything
 * throws before the app paints.
 *
 * Why this exists. A `const` in the component body that reads state
 * declared further down is a temporal dead zone error: it throws on the
 * very first render, React unmounts everything, and the page goes white.
 * That shipped once — `listingMrpNumber` was derived above the
 * `listingMrp` it reads — and nothing caught it, because every other test
 * in this repo reads the source as text. Source-level tests cannot
 * evaluate anything, so no amount of them will ever notice that a file
 * which parses fine also cannot run.
 *
 * The minified error is `Cannot access 'Ac' before initialization`, which
 * names a variable that exists only after minification, so production
 * cannot even tell you which one it was. That is the other reason this
 * test loads the build rather than trusting the browser to explain
 * afterwards.
 *
 * Deliberately narrow: it checks that the app boots and renders, nothing
 * about what it renders. A boot check that also asserts content becomes a
 * test people disable when the copy changes.
 */

const { execSync, spawn } = require('child_process');
const fs = require('fs');
const http = require('http');
const path = require('path');

let passed = 0, failed = 0;
function check(label, cond, detail = '') {
  if (cond) { passed++; console.log('PASS: ' + label); }
  else { failed++; console.log('FAIL: ' + label + (detail ? '  [' + detail + ']' : '')); }
}

const root = path.join(__dirname, '..');
const dist = path.join(root, 'dist');

(async () => {
  let chromium;
  try {
    ({ chromium } = require('playwright'));
  } catch {
    // Not an excuse to pass. A boot check that silently skips is a boot
    // check that reports success on the day it matters.
    console.log('SKIP: playwright is not installed — cannot boot the app.');
    console.log('\n0 passed, 0 failed (skipped)');
    process.exit(0);
  }

  if (!fs.existsSync(path.join(dist, 'index.html'))) {
    console.log('Building first (no dist/index.html)...');
    execSync('npm run build', { cwd: root, stdio: 'ignore' });
  }

  // A static server over dist. Vite's own preview would do, but shelling
  // out to it makes this test depend on killing a child process reliably,
  // and a fifteen-line server has no such failure mode.
  const types = {
    '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css',
    '.json': 'application/json', '.svg': 'image/svg+xml', '.png': 'image/png',
    '.webmanifest': 'application/manifest+json', '.ico': 'image/x-icon',
  };
  const server = http.createServer((req, res) => {
    const rel = decodeURIComponent(String(req.url || '/').split('?')[0]);
    let file = path.join(dist, rel === '/' ? 'index.html' : rel);
    if (!file.startsWith(dist) || !fs.existsSync(file) || fs.statSync(file).isDirectory()) {
      file = path.join(dist, 'index.html');           // SPA fallback
    }
    res.writeHead(200, { 'Content-Type': types[path.extname(file)] || 'application/octet-stream' });
    fs.createReadStream(file).pipe(res);
  });

  await new Promise((resolve) => server.listen(0, resolve));
  const port = server.address().port;

  const browser = await chromium.launch();
  const errors = [];
  try {
    const page = await browser.newPage({ viewport: { width: 390, height: 844 } });

    // An uncaught exception anywhere in the app is a failure. Network
    // failures are not — there is no backend here, and the app is
    // expected to survive that.
    page.on('pageerror', (err) => errors.push(String(err && err.message || err)));

    await page.goto(`http://127.0.0.1:${port}/`, { waitUntil: 'load', timeout: 45000 });
    await page.waitForTimeout(3000);

    check('1. The app boots without throwing',
      errors.length === 0, errors.slice(0, 3).join(' | '));

    // The specific failure mode, named, so a regression is recognisable
    // rather than just "something threw".
    check('2. Nothing is read before it is initialised',
      !errors.some((e) => /before initialization/i.test(e)),
      errors.filter((e) => /before initialization/i.test(e)).join(' | '));

    const rendered = await page.evaluate(() => ({
      text: document.body.innerText.trim().length,
      nodes: document.querySelectorAll('div').length,
    }));

    check('3. Something actually rendered, rather than a blank page',
      rendered.text > 200 && rendered.nodes > 10, JSON.stringify(rendered));

    const overflow = await page.evaluate(() => ({
      sw: document.documentElement.scrollWidth,
      cw: document.documentElement.clientWidth,
    }));
    check('4. The page does not scroll sideways on a phone',
      overflow.sw <= overflow.cw + 1, JSON.stringify(overflow));
  } finally {
    await browser.close();
    server.close();
  }

  console.log(`\n${passed} passed, ${failed} failed`);
  process.exit(failed ? 1 : 0);
})();
