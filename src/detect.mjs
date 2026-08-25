// Finding "fences": code that exists because of an external condition.
// Chesterton's Fence at industrial scale. The fence stands long after the
// reason for building it is gone, and nobody dares take it down.

// Two classes of word, because they carry different weight. A "workaround" is
// a fence by definition. The word "until" is ordinary English that happens to
// appear in fences, and treating it as proof produced two hundred findings on
// webpack that were plain explanatory comments. A weak word only counts when
// something else in the comment names the condition: a tracker link, a
// deadline, a version.
const STRONG_WORDS = [
  'workaround', 'work around', 'work-around',
  'kludge', 'monkey ?-?patch(?:ed|ing)?',
  'hack(?:s|ed|ing)?(?: around)?',
  'remove (?:when|once|after)', 'revert (?:when|once)',
  'drop once', 'delete (?:when|once)',
  'can be removed', 'no longer needed', '(?:once|when) fixed',
  'due to (?:a )?bug', 'because of (?:a )?bug', 'upstream bug', 'known bug',
  'broken in', 'do not upgrade', 'pinn?ed because', 'pin because',
];

// Phrases that read as a fence in a note and as ordinary prose everywhere
// else. "TODO remove this class" is a fence; "remove this chunk from its
// parents" is a sentence about what the code does. They count only next to a
// marker or a named condition.
const MEDIUM_WORDS = [
  'remove (?:this|it)', 'delete (?:this|it)', 'drop when',
  'blocked by', 'waiting on',
];

const MARKER_RE = /\b(?:TODO|FIXME|HACK|XXX)\b/i;

const WEAK_WORDS = [
  'until', 'temporar(?:y|ily)', 'for now', 'regression',
  'polyfill', 'shim', 'fallback', 'legacy',
];

const rx = (words) => new RegExp(`\\b(?:${words.join('|')})\\b`, 'gi');
const STRONG_RE = rx(STRONG_WORDS);
const MEDIUM_RE = rx(MEDIUM_WORDS);
const WEAK_RE = rx(WEAK_WORDS);

// External trackers: the condition lives outside this repository, which is
// exactly why nobody notices when it stops being true.
const REF_PATTERNS = [
  { kind: 'github', re: /https?:\/\/github\.com\/([\w.-]+)\/([\w.-]+)\/(?:issues|pull)\/(\d+)/gi,
    id: (m) => `github:${m[1]}/${m[2]}#${m[3]}`, url: (m) => m[0] },
  { kind: 'chromium', re: /(?:https?:\/\/)?(?:crbug\.com\/|bugs\.chromium\.org\/p\/chromium\/issues\/detail\?id=)(\d+)/gi,
    id: (m) => `crbug:${m[1]}`, url: (m) => `https://crbug.com/${m[1]}` },
  { kind: 'mozilla', re: /bugzilla\.mozilla\.org\/show_bug\.cgi\?id=(\d+)/gi,
    id: (m) => `bugzilla:${m[1]}`, url: (m) => m[0] },
  { kind: 'webkit', re: /bugs\.webkit\.org\/show_bug\.cgi\?id=(\d+)/gi,
    id: (m) => `webkit:${m[1]}`, url: (m) => m[0] },
];

const DATE_RE = /\b(?:until|after|before|remove|revisit|expires?|expire[sd]?|do)\b[^\n]{0,24}?(20\d{2})-(\d{2})(?:-(\d{2}))?/i;
const VERSION_RE = /\b(?:until|once|when|fixed in|released in|requires?|needs?)\b[^\n]{0,40}?\bv?(\d+\.\d+(?:\.\d+)?)/i;

/**
 * Which comment markers a file can have. Getting this wrong in either
 * direction is expensive: "//" inside a Python floor division is not a
 * comment, and "#fff" in a stylesheet is not one either. Both produced
 * findings in the first version.
 */
const C_LIKE = new Set(['.js', '.mjs', '.cjs', '.jsx', '.ts', '.tsx', '.mts', '.cts',
  '.java', '.kt', '.swift', '.go', '.rs', '.c', '.h', '.cc', '.cpp', '.hpp',
  '.cs', '.m', '.mm', '.php', '.scss', '.less', '.vue', '.svelte', '.gradle']);
const HASH_LIKE = new Set(['.py', '.rb', '.sh', '.bash', '.zsh', '.yml', '.yaml',
  '.toml', '.tf', '.dockerfile']);

export function styleFor(file) {
  const lower = file.toLowerCase();
  const dot = lower.lastIndexOf('.');
  const ext = dot === -1 ? '' : lower.slice(dot);
  if (lower.endsWith('dockerfile')) return { hash: true };
  if (ext === '.sql') return { dashes: true, block: true };
  if (ext === '.css') return { block: true };
  if (HASH_LIKE.has(ext)) return { hash: true, docstring: ext === '.py' };
  if (C_LIKE.has(ext)) return { slash: true, block: true };
  return { slash: true, hash: true, block: true };
}

const TRIPLE = ['"""', "'''"];

/**
 * The comment on one line, or null. Quotes are tracked so that a URL inside a
 * string is not read as a comment, and so that a comment sitting after real
 * code is still found: the first version skipped any line containing a quote,
 * which missed every `doSomething("x"); // workaround for ...`.
 */
export function commentPart(line, style = { slash: true, hash: true, block: true }) {
  const trimmed = line.trimStart();
  if (style.docstring) {
    for (const q of TRIPLE) {
      if (trimmed.startsWith(q)) return trimmed.slice(3).replace(/("""|''')\s*$/, '').trim();
    }
  }
  if (style.block && trimmed.startsWith('*') && !trimmed.startsWith('*/')) {
    return trimmed.replace(/^\*+\s?/, '').replace(/\*\/\s*$/, '').trim();
  }
  let quote = null;
  for (let i = 0; i < line.length; i++) {
    const c = line[i];
    if (quote) {
      if (c === '\\') i++;
      else if (c === quote) quote = null;
      continue;
    }
    if (c === '"' || c === "'" || c === '`') { quote = c; continue; }
    if (style.slash && c === '/' && line[i + 1] === '/') return line.slice(i + 2).trim();
    if (style.block && c === '/' && line[i + 1] === '*') {
      return line.slice(i + 2).replace(/\*\/.*$/, '').trim();
    }
    if (style.hash && c === '#') return line.slice(i + 1).trim();
    if (style.dashes && c === '-' && line[i + 1] === '-') return line.slice(i + 2).trim();
    if (c === '<' && line.startsWith('<!--', i)) return line.slice(i + 4).replace(/-->.*$/, '').trim();
  }
  return null;
}

/**
 * Adjacent comment lines, grouped, with the code stripped off. Deliberately
 * language agnostic: this has to work on files nobody here has seen.
 */
export function commentBlocks(text, style) {
  const lines = text.split(/\r?\n/);
  const blocks = [];
  let cur = null;
  for (let i = 0; i < lines.length; i++) {
    const part = commentPart(lines[i], style);
    if (part) {
      if (!cur) cur = { start: i + 1, end: i + 1, lines: [], raw: lines[i] };
      cur.end = i + 1;
      cur.lines.push(part);
    } else if (cur) {
      blocks.push(cur);
      cur = null;
    }
  }
  if (cur) blocks.push(cur);
  return blocks;
}

function wordsIn(text, re) {
  re.lastIndex = 0;
  const found = new Set();
  let m;
  while ((m = re.exec(text)) !== null) found.add(m[0].toLowerCase());
  return [...found];
}

function refsIn(text) {
  const found = [];
  for (const p of REF_PATTERNS) {
    p.re.lastIndex = 0;
    let m;
    while ((m = p.re.exec(text)) !== null) {
      const id = p.id(m);
      if (!found.some((f) => f.id === id)) found.push({ id, kind: p.kind, url: p.url(m) });
    }
  }
  return found;
}

/**
 * Fences found in a single file.
 * A fence is a comment showing that code exists because of an external
 * condition: someone else's bug, a version, a deadline.
 */
export function detectFences(file, text) {
  const out = [];
  const style = styleFor(file);
  for (const block of commentBlocks(text, style)) {
    const body = block.lines.join(' ').replace(/\s+/g, ' ').slice(0, 600);
    if (body.length < 12) continue;

    const strong = wordsIn(body, STRONG_RE);
    const medium = wordsIn(body, MEDIUM_RE);
    const weak = wordsIn(body, WEAK_RE);
    const refs = refsIn(body);
    const dateM = body.match(DATE_RE);
    const verM = body.match(VERSION_RE);

    let premise;
    if (refs.length > 0) premise = { type: 'tracker', refs };
    else if (dateM) {
      const iso = `${dateM[1]}-${dateM[2]}-${dateM[3] ?? '01'}`;
      premise = { type: 'date', date: iso, overdue: new Date(iso) < new Date() };
    } else if (verM) premise = { type: 'version', version: verM[1] };
    else premise = { type: 'none' };

    // What it takes to call a comment a fence. A link to an external tracker
    // is the premise by itself: someone wrote this code because of that bug.
    // Failing that, a strong word. A weak word ("until", "polyfill") only
    // counts when the comment also names a deadline or a version, because on
    // its own it is ordinary English and produces mostly noise.
    const named = premise.type === 'date' || premise.type === 'version';
    const marker = MARKER_RE.test(body);
    const qualifies = refs.length > 0
      || strong.length > 0
      || (medium.length > 0 && (marker || named))
      || (weak.length > 0 && named);
    if (!qualifies) continue;

    // The class says what breaks when the premise dies, and those are two
    // different repairs, which is why the distinction earns its keep.
    const isDoc = /^\s*(?:\/\*\*|\*)/.test(block.raw ?? '')
      || /@remarks|@param|@returns|\{@link/.test(body);
    let kind;
    if (refs.length > 0 && (strong.length > 0 || medium.length > 0 || !isDoc)) kind = 'code';
    else if (refs.length > 0) kind = 'docs';
    else if (premise.type === 'date') kind = 'deadline';
    else kind = 'unmarked';

    out.push({
      file,
      line: block.start,
      endLine: block.end,
      text: body.replace(/^\W+/, '').slice(0, 240),
      words: [...strong, ...medium, ...weak].slice(0, 3),
      premise,
      kind,
      confidence: refs.length > 0 ? 'high' : premise.type === 'date' ? 'medium' : 'low',
    });
  }
  return out;
}
