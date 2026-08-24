// Finding "fences": code that exists because of an external condition.
// Chesterton's Fence at industrial scale. The fence stands long after the
// reason for building it is gone, and nobody dares take it down.

const FENCE_WORDS = [
  'workaround', 'work around', 'work-around',
  'hack', 'kludge', 'monkey patch', 'monkeypatch', 'monkey-patch',
  'temporary', 'temporarily', 'for now',
  'remove when', 'remove once', 'remove after', 'remove this',
  'revert when', 'revert once', 'drop when', 'delete when',
  'can be removed', 'no longer needed', 'once fixed', 'when fixed',
  'until ', 'due to a bug', 'due to bug', 'because of a bug',
  'broken in', 'regression', 'upstream bug', 'known bug',
  'polyfill', 'shim ', 'pinned because', 'pin because', 'do not upgrade',
];

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

const COMMENT_START = /^\s*(?:\/\/+|#+|\*|\/\*|--|;;?|<!--|%|"""|''')/;

function isCommentish(line) {
  return COMMENT_START.test(line);
}

// Group adjacent comment lines into blocks. Deliberately language-agnostic:
// this has to work on any text file, including languages we have never seen.
export function commentBlocks(text) {
  const lines = text.split('\n');
  const blocks = [];
  let cur = null;
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const inlineComment = !isCommentish(line) && /(?:\/\/|#|\/\*)\s*\S/.test(line) && !/['"`]/.test(line);
    if (isCommentish(line) || inlineComment) {
      if (!cur) cur = { start: i + 1, end: i + 1, lines: [] };
      cur.end = i + 1;
      cur.lines.push(line.trim());
    } else if (cur) {
      blocks.push(cur);
      cur = null;
    }
  }
  if (cur) blocks.push(cur);
  return blocks;
}

function fenceWordsIn(text) {
  const low = text.toLowerCase();
  return FENCE_WORDS.filter((w) => low.includes(w));
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
  for (const block of commentBlocks(text)) {
    const body = block.lines.join(' ').replace(/\s+/g, ' ').slice(0, 600);
    if (body.length < 12) continue;

    const words = fenceWordsIn(body);
    const refs = refsIn(body);
    const dateM = body.match(DATE_RE);
    const verM = body.match(VERSION_RE);

    // A link to an external tracker is itself the premise: someone wrote this
    // code because of that bug. Words like "workaround" only confirm it.
    if (refs.length === 0 && words.length === 0) continue;

    let premise;
    if (refs.length > 0) premise = { type: 'tracker', refs };
    else if (dateM) {
      const iso = `${dateM[1]}-${dateM[2]}-${dateM[3] ?? '01'}`;
      premise = { type: 'date', date: iso, overdue: new Date(iso) < new Date() };
    } else if (verM) premise = { type: 'version', version: verM[1] };
    else premise = { type: 'none' };

    // The class says what breaks when the premise dies, and those are two
    // different repairs, which is why the distinction earns its keep.
    const isDoc = /^\s*(?:\/\*\*|\*)/.test(block.lines[0] ?? '')
      || /@remarks|@param|@returns|\{@link/.test(body);
    let kind;
    if (refs.length > 0 && (words.length > 0 || !isDoc)) kind = 'code';
    else if (refs.length > 0) kind = 'docs';
    else if (premise.type === 'date') kind = 'deadline';
    else kind = 'unmarked';

    out.push({
      file,
      line: block.start,
      endLine: block.end,
      text: body.replace(/^\W+/, '').slice(0, 240),
      words: words.slice(0, 3),
      premise,
      kind,
      confidence: refs.length > 0 ? 'high' : premise.type === 'date' ? 'medium' : 'low',
    });
  }
  return out;
}
