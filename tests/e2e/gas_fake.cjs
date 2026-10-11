/**
 * tests/e2e/gas_fake.cjs (11 Oct 2026, final launch check)
 *
 * An in-memory Google Apps Script runtime: a real spreadsheet (sheets,
 * rows, ranges), script properties, cache, locks, mail, Drive and
 * UrlFetch. The REAL appsscript.js is loaded unchanged and driven only
 * through doPost / doGet — the same door the website uses — so a test
 * walks the site the way a new reader would, with real session tokens.
 */
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const crypto = require('crypto');

const root = path.join(__dirname, '..', '..');

/** A chainable no-op for formatting calls we don't model. */
function chain(target) {
  return new Proxy(target, {
    get(t, k) {
      if (k in t) return t[k];
      if (typeof k === 'symbol') return undefined;
      return () => chain(t);
    }
  });
}

function makeSpreadsheet() {
  const sheets = {};
  const order = [];
  function makeSheet(name) {
    const data = [];
    const width = () => data.reduce((m, r) => Math.max(m, r.length), 0);
    const cell = (r, c) => { const row = data[r - 1]; const v = row ? row[c - 1] : undefined; return v === undefined || v === null ? '' : v; };
    const put = (r, c, v) => { while (data.length < r) data.push([]); const row = data[r - 1]; while (row.length < c) row.push(''); row[c - 1] = v; };
    function range(r, c, nr, nc) {
      nr = nr || 1; nc = nc || 1;
      return chain({
        getValues: () => { const out = []; for (let i = 0; i < nr; i++) { const row = []; for (let j = 0; j < nc; j++) row.push(cell(r + i, c + j)); out.push(row); } return out; },
        getDisplayValues: () => { const out = []; for (let i = 0; i < nr; i++) { const row = []; for (let j = 0; j < nc; j++) row.push(String(cell(r + i, c + j))); out.push(row); } return out; },
        getValue: () => cell(r, c),
        setValue: (v) => { put(r, c, v); return range(r, c, nr, nc); },
        setValues: (rows) => { rows.forEach((row, i) => row.forEach((v, j) => put(r + i, c + j, v))); return range(r, c, nr, nc); },
        clearContent: () => { for (let i = 0; i < nr; i++) for (let j = 0; j < nc; j++) if (data[r - 1 + i]) put(r + i, c + j, ''); return range(r, c, nr, nc); },
        getRow: () => r, getColumn: () => c, getNumRows: () => nr, getNumColumns: () => nc,
        getLastRow: () => r + nr - 1, getLastColumn: () => c + nc - 1,
      });
    }
    const sheet = chain({
      _data: data,
      getName: () => name,
      getSheetName: () => name,
      getSheetId: () => order.indexOf(name) + 1,
      getLastRow: () => data.length,
      getLastColumn: () => width(),
      getMaxRows: () => Math.max(1000, data.length),
      getMaxColumns: () => Math.max(26, width()),
      getRange: (r, c, nr, nc) => {
        if (typeof r === 'string') throw new Error('A1 notation not modelled: ' + r);
        return range(r, c, nr, nc);
      },
      getDataRange: () => range(1, 1, Math.max(1, data.length), Math.max(1, width())),
      appendRow: (row) => { data.push(row.map(v => (v === undefined || v === null ? '' : v))); return sheet; },
      deleteRow: (r) => { data.splice(r - 1, 1); return sheet; },
      deleteRows: (r, n) => { data.splice(r - 1, n); return sheet; },
      deleteColumn: (c) => { data.forEach(row => { if (row.length >= c) row.splice(c - 1, 1); }); return sheet; },
      insertRowAfter: (r) => { data.splice(r, 0, []); return sheet; },
      insertRowsAfter: (r, n) => { for (let i = 0; i < n; i++) data.splice(r, 0, []); return sheet; },
      clear: () => { data.length = 0; return sheet; },
      clearContents: () => { data.length = 0; return sheet; },
    });
    return sheet;
  }
  const ss = chain({
    getId: () => 'SS_TEST',
    getName: () => 'SwapSutra (test)',
    getUrl: () => 'https://docs.google.com/spreadsheets/d/SS_TEST',
    getSheetByName: (n) => sheets[n] || null,
    getSheets: () => order.map(n => sheets[n]),
    insertSheet: (n) => { if (sheets[n]) throw new Error('Sheet exists: ' + n); sheets[n] = makeSheet(n); order.push(n); return sheets[n]; },
  });
  return { ss, sheets };
}

function pad(n, w) { return String(n).padStart(w || 2, '0'); }
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
function formatDate(d, tz, fmt) {
  const off = /5:30|Kolkata|Calcutta/.test(String(tz)) ? 5.5 * 3600e3 : 0;
  const t = new Date(new Date(d).getTime() + off);
  const Y = t.getUTCFullYear(), M = t.getUTCMonth(), D = t.getUTCDate(), h = t.getUTCHours(), m = t.getUTCMinutes(), s = t.getUTCSeconds();
  const tokens = { yyyy: String(Y), MMMM: MONTHS[M], MMM: MONTHS[M], MM: pad(M + 1), dd: pad(D), d: String(D), HH: pad(h), H: String(h), hh: pad(h % 12 || 12), h: String(h % 12 || 12), mm: pad(m), ss: pad(s), a: h < 12 ? 'AM' : 'PM', EEE: ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'][t.getUTCDay()] };
  return String(fmt).replace(/yyyy|MMMM|MMM|MM|dd|d|HH|H|hh|h|mm|ss|a|EEE|'[^']*'/g, (tok) => tok[0] === "'" ? tok.slice(1, -1) : tokens[tok]);
}

function bytesOf(x) {
  if (Array.isArray(x)) return Buffer.from(x.map(b => (b < 0 ? b + 256 : b)));
  if (Buffer.isBuffer(x)) return x;
  return Buffer.from(String(x), 'utf8');
}
const signed = (buf) => Array.from(buf).map(b => (b > 127 ? b - 256 : b));

/**
 * Builds a runtime. Options: props (script properties), now (ms).
 */
function boot(options) {
  const opts = options || {};
  const { ss, sheets } = makeSpreadsheet();
  // The live spreadsheet already has these sheets with their header rows
  // (they are only ever opened header-less by the script).
  const seed = Object.assign({
    Chats: ['chatId', 'bookId', 'ownerEmail', 'requesterEmail', 'adminEmail', 'chatStatus', 'createdAt', 'swapId', 'chatType', 'requestId', 'responseId'],
    Messages: ['messageId', 'chatId', 'senderEmail', 'senderRole', 'message', 'createdAt', 'mediaUrl', 'mediaType'],
  }, opts.seed || {});
  Object.keys(seed).forEach(n => { ss.insertSheet(n).appendRow(seed[n]); });
  const props = Object.assign({}, opts.props || {});
  const cache = {};
  const emails = [];
  const files = [];
  const fetches = [];
  let fileSeq = 0;

  const blob = (bytes, type, name) => chain({
    _bytes: bytesOf(bytes), getBytes: () => signed(bytesOf(bytes)), getContentType: () => type, getName: () => name,
    getDataAsString: () => bytesOf(bytes).toString('utf8'), setName: (n) => { name = n; return blob(bytes, type, n); },
    getSize: () => bytesOf(bytes).length,
  });
  const makeFile = (b, folderName) => {
    const id = 'FILE' + (++fileSeq);
    const rec = { id, name: b && b.getName ? b.getName() : 'file', folder: folderName, sharing: null, type: b && b.getContentType ? b.getContentType() : '' };
    files.push(rec);
    return chain({
      getId: () => id, getName: () => rec.name, getUrl: () => 'https://drive.google.com/file/d/' + id + '/view',
      getDownloadUrl: () => 'https://drive.google.com/uc?id=' + id, getMimeType: () => rec.type,
      setSharing: (a, p) => { rec.sharing = [a, p]; }, setName: (n) => { rec.name = n; },
      getSize: () => 10, getBlob: () => b, setTrashed: () => { rec.trashed = true; }, getDateCreated: () => new Date(),
    });
  };
  const folders = {};
  const makeFolder = (name) => {
    if (folders[name]) return folders[name];
    const f = chain({
      getId: () => 'FOLDER_' + name, getName: () => name,
      createFile: (b) => makeFile(b, name),
      createFolder: (n) => makeFolder(name + '/' + n),
      getFoldersByName: (n) => iter(folders[name + '/' + n] ? [folders[name + '/' + n]] : []),
      getFilesByName: () => iter([]), getFiles: () => iter([]),
      setSharing: () => {},
    });
    folders[name] = f;
    return f;
  };
  function iter(list) { let i = 0; return { hasNext: () => i < list.length, next: () => list[i++] }; }

  const sandbox = {
    console: { log() {}, error() {}, warn() {}, info() {} },
    Logger: { log() {} },
    SpreadsheetApp: { getActiveSpreadsheet: () => ss, openById: () => ss, flush() {}, getUi: () => chain({}) },
    PropertiesService: {
      getScriptProperties: () => ({
        getProperty: (k) => (k in props ? props[k] : null),
        getProperties: () => Object.assign({}, props),
        setProperty: (k, v) => { props[k] = String(v); },
        setProperties: (o) => { Object.keys(o).forEach(k => { props[k] = String(o[k]); }); },
        deleteProperty: (k) => { delete props[k]; },
        getKeys: () => Object.keys(props),
      }),
      getUserProperties: () => ({ getProperty: () => null, setProperty() {} }),
    },
    CacheService: {
      getScriptCache: () => ({
        get: (k) => (k in cache ? cache[k] : null),
        put: (k, v) => { cache[k] = String(v); },
        remove: (k) => { delete cache[k]; },
        removeAll: (ks) => (ks || []).forEach(k => { delete cache[k]; }),
        putAll: (o) => Object.keys(o).forEach(k => { cache[k] = String(o[k]); }),
        getAll: (ks) => { const o = {}; (ks || []).forEach(k => { if (k in cache) o[k] = cache[k]; }); return o; },
      }),
    },
    LockService: { getScriptLock: () => ({ tryLock: () => true, waitLock() {}, releaseLock() {}, hasLock: () => true }), getUserLock: () => ({ tryLock: () => true, waitLock() {}, releaseLock() {} }) },
    Utilities: {
      getUuid: () => crypto.randomUUID(),
      base64Encode: (x) => bytesOf(x).toString('base64'),
      base64Decode: (s) => signed(Buffer.from(String(s), 'base64')),
      base64EncodeWebSafe: (x) => bytesOf(x).toString('base64').replace(/\+/g, '-').replace(/\//g, '_'),
      base64DecodeWebSafe: (s) => signed(Buffer.from(String(s).replace(/-/g, '+').replace(/_/g, '/'), 'base64')),
      computeHmacSha256Signature: (value, key) => signed(crypto.createHmac('sha256', String(key)).update(String(value)).digest()),
      computeDigest: (alg, str) => signed(crypto.createHash(String(alg).toLowerCase().indexOf('md5') !== -1 ? 'md5' : 'sha256').update(String(str)).digest()),
      DigestAlgorithm: { SHA_256: 'sha256', MD5: 'md5' },
      Charset: { UTF_8: 'utf8' },
      newBlob: (bytes, type, name) => blob(bytes, type, name),
      formatDate,
      sleep() {},
    },
    MailApp: { sendEmail: (a, b, c, d) => { emails.push(typeof a === 'object' ? a : { to: a, subject: b, body: c, options: d }); }, getRemainingDailyQuota: () => 100 },
    GmailApp: { sendEmail: (to, subject, body, o) => { emails.push(Object.assign({ to, subject, body }, o || {})); } },
    DriveApp: {
      Access: { ANYONE_WITH_LINK: 'ANYONE_WITH_LINK', PRIVATE: 'PRIVATE', ANYONE: 'ANYONE' },
      Permission: { VIEW: 'VIEW', EDIT: 'EDIT', NONE: 'NONE' },
      getFoldersByName: (n) => iter(folders[n] ? [folders[n]] : []),
      createFolder: (n) => makeFolder(n),
      getFolderById: (id) => makeFolder(String(id).replace(/^FOLDER_/, '')),
      getFileById: (id) => chain({ getId: () => id, setSharing() {}, getUrl: () => 'https://drive.google.com/file/d/' + id + '/view', getBlob: () => blob('', 'image/png', 'x'), setTrashed() {} }),
      getRootFolder: () => makeFolder('root'),
      createFile: (b) => makeFile(b, 'root'),
    },
    UrlFetchApp: {
      fetch: (url, o) => {
        fetches.push({ url, o });
        // Drive resumable uploads (videos): a session, then the pieces.
        if (/uploadType=resumable/.test(url)) return { getResponseCode: () => 200, getContentText: () => '', getHeaders: () => ({ Location: 'https://upload.example/session/' + (++fileSeq) }) };
        if (/^https:\/\/upload\.example\//.test(url)) { const id = 'FILE' + (++fileSeq); files.push({ id, name: 'video', folder: 'videos' }); return { getResponseCode: () => 200, getContentText: () => JSON.stringify({ id }), getHeaders: () => ({}) }; }
        if (/googleapis\.com\/drive\/v3\/files\/[^/]+\/permissions/.test(url)) return { getResponseCode: () => 200, getContentText: () => '{}', getHeaders: () => ({}) };
        if (/googleapis\.com\/drive\/v3\/files/.test(url)) return { getResponseCode: () => 200, getContentText: () => '{"id":"x"}', getHeaders: () => ({}) };
        return { getResponseCode: () => 404, getContentText: () => '{}', getHeaders: () => ({}), getBlob: () => blob('', 'text/plain', 'x') };
      },
      fetchAll: (reqs) => reqs.map(r => { fetches.push(r); return { getResponseCode: () => 404, getContentText: () => '{}', getHeaders: () => ({}) }; }),
    },
    ScriptApp: {
      getOAuthToken: () => 'tok', newTrigger: () => chain({}), getProjectTriggers: () => [], deleteTrigger() {},
      WeekDay: { MONDAY: 'MONDAY', SUNDAY: 'SUNDAY' }, getService: () => chain({ getUrl: () => 'https://script.google.com/macros/s/TEST/exec' }),
    },
    Session: { getScriptTimeZone: () => 'Asia/Kolkata', getActiveUser: () => ({ getEmail: () => '' }), getEffectiveUser: () => ({ getEmail: () => 'swapsutra@gmail.com' }) },
    ContentService: { MimeType: { JSON: 'JSON', TEXT: 'TEXT' }, createTextOutput: (t) => ({ __text: t, setMimeType() { return this; }, getContent() { return t; } }) },
    HtmlService: { createHtmlOutput: (h) => ({ __text: h, setTitle() { return this; }, setXFrameOptionsMode() { return this; } }), XFrameOptionsMode: {} },
    Maps: { newGeocoder: () => chain({ geocode: () => ({ status: 'ZERO_RESULTS', results: [] }), reverseGeocode: () => ({ status: 'ZERO_RESULTS', results: [] }) }) },
  };
  sandbox.globalThis = sandbox;
  const ctx = vm.createContext(sandbox);
  const gs = fs.readFileSync(path.join(root, 'appsscript.js'), 'utf8');
  vm.runInContext(gs, ctx, { filename: 'appsscript.js' });
  vm.runInContext(`(function(){ const RealDate = Date; let fake = null;
    class FakeDate extends RealDate { constructor(...a) { if (a.length === 0 && fake !== null) super(fake); else super(...a); }
      static now() { return fake !== null ? fake : RealDate.now(); } }
    globalThis.Date = FakeDate; globalThis.__setNow = v => { fake = v; }; })()`, ctx);
  if (opts.now) ctx.__setNow(opts.now);

  const parse = (out) => { const t = out && (out.__text !== undefined ? out.__text : out); try { return JSON.parse(t); } catch (e) { return { __raw: t }; } };
  const rt = {
    ctx, sheets, props, emails, files, fetches, cache,
    now(ms) { ctx.__setNow(ms); },
    post(body, token) { const b = Object.assign({}, body); if (token) b.sessionToken = token; return parse(ctx.doPost({ postData: { contents: JSON.stringify(b) }, parameter: {} })); },
    get(params, token) { const p = Object.assign({}, params); if (token) p.sessionToken = token; Object.keys(p).forEach(k => { if (typeof p[k] !== 'string') p[k] = typeof p[k] === 'object' ? JSON.stringify(p[k]) : String(p[k]); }); return parse(ctx.doGet({ parameter: p, parameters: {} })); },
    rows(name) { const s = sheets[name]; if (!s) return []; const d = s._data; const h = d[0] || []; return d.slice(1).map(r => { const o = {}; h.forEach((k, i) => { o[k] = r[i] === undefined ? '' : r[i]; }); return o; }); },
    lastOtp(email) {
      const m = emails.filter(e => String(e.to || '').toLowerCase() === email.toLowerCase()).map(e => String(e.htmlBody || e.body || '')).reverse().map(t => t.match(/(\d{6})/)).find(Boolean);
      return m ? m[1] : null;
    },
    mailTo(email) { return emails.filter(e => String(e.to || '').toLowerCase().split(',').map(s => s.trim()).includes(email.toLowerCase())); },
  };
  return rt;
}

module.exports = { boot, root };
