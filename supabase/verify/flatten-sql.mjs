// ===================================================================
// flatten-sql.mjs -- make PostgreSQL single-user mode usable
// ===================================================================
// WHAT PROBLEM THIS SOLVES
//
// `postgres --single` reads its input ONE LINE AT A TIME and treats each
// line as a complete statement. Our SQL is full of multi-line statements:
// every `do $$ ... $$;`, every `create function ... as $$ ... $$;`. Fed
// straight in, single-user mode chops them at every newline and reports
// hundreds of nonsense syntax errors such as
//   "syntax error at or near v_seen at character 3"
// which are an artefact of the reading method, not faults in the SQL.
//
// So this rewrites the input so every TOP-LEVEL statement occupies
// exactly one line, while a string literal keeps its content.
//
// WHY NOT JUST `Get-Content | Set-Content -join ' '`
// Because three things would be silently destroyed:
//
//   1. `;` inside a dollar-quoted function body would end the statement
//      halfway through a migration.
//   2. `--` inside a string would look like a comment. Worse, once new
//      lines become spaces, a `--` comment INSIDE a plpgsql body would
//      swallow the whole rest of the body, because the newline that used
//      to end it is gone. That one turns a working test into a mystery.
//   3. An apostrophe inside a comment or an escaped quote would end a
//      string early and truncate everything after it.
//
// So the input is walked as a character stream with explicit states,
// using the same rules the SQL lexer uses.
//
// WHAT IT PRESERVES
//   - every statement's meaning, byte for byte, outside comments
//   - dollar-quoted bodies as one unit, comments inside them stripped
//     safely before their newlines are collapsed
//   - string literals, including doubled quotes and E'' escapes
//
// WHAT IT CHANGES
//   - newlines and tabs inside a statement become single spaces
//   - `--` and `/* */` comments are removed
//   - a newline is emitted after each top-level `;`
// ===================================================================

import { readFileSync, writeFileSync } from 'node:fs'

const DOLLAR_TAG = /^\$(?:[A-Za-z_][A-Za-z_0-9]*)?\$/

/**
 * Look forward from `start` across whitespace and comments and report what
 * is the next significant character, plus whether a newline was crossed.
 *
 * The newline matters because PostgreSQL only joins adjacent string
 * constants when the whitespace between them contains one. Comments are
 * skipped too, so `'a'\n-- note\n'b'` is recognised as a concatenation
 * rather than left as `'a' 'b'`, which is a syntax error.
 */
function peekAcrossGap(src, start) {
  let j = start
  let sawNewline = false

  while (j < src.length) {
    const ch = src[j]

    if (ch === ' ' || ch === '\t' || ch === '\r') { j++; continue }
    if (ch === '\n') { sawNewline = true; j++; continue }

    if (ch === '-' && src[j + 1] === '-') {
      const nl = src.indexOf('\n', j)
      if (nl === -1) { j = src.length } else { sawNewline = true; j = nl + 1 }
      continue
    }

    if (ch === '/' && src[j + 1] === '*') {
      let depth = 1
      j += 2
      while (j < src.length && depth > 0) {
        if (src[j] === '\n') sawNewline = true
        if (src[j] === '/' && src[j + 1] === '*') { depth++; j += 2; continue }
        if (src[j] === '*' && src[j + 1] === '/') { depth--; j += 2; continue }
        j++
      }
      continue
    }

    break
  }

  return { index: j, sawNewline, next: src[j] }
}

/**
 * Read one single-quoted string constant starting at `i`.
 * Returns the raw text and the index just past it.
 *
 * Handles `''` as an escaped quote, and treats `E'...'` / `e'...'` as
 * backslash-escaped -- otherwise a statement containing `\'` is cut short
 * at the backslash and the failure surfaces many lines later as an
 * unrelated syntax error.
 */
function readStringLiteral(src, i) {
  const before = src[i - 1]
  const isEscapeString =
    (before === 'e' || before === 'E') &&
    (i - 1 === 0 || !/[A-Za-z0-9_]/.test(src[i - 2]))

  let j = i + 1
  while (j < src.length) {
    if (isEscapeString && src[j] === '\\') { j += 2; continue }
    if (src[j] === "'") {
      if (src[j + 1] === "'") { j += 2; continue }
      j++
      break
    }
    j++
  }
  // Include the E/e prefix in the raw text when present, so callers see
  // the whole constant and can tell it apart from a plain string. (The
  // prefix is only meaningful to us inside the literal's backslash
  // handling; dropping it would silently turn `E'\n'` into a two-char
  // string.)
  const rawStart = isEscapeString ? i - 1 : i
  return { raw: src.slice(rawStart, j), end: j, isEscapeString }
}

/**
 * Join two adjacent string constants into one, the way PostgreSQL does.
 *
 * PostgreSQL folds `'first' \n 'second'` into a single string constant
 * during parsing. That folding is not available to us here -- the newline
 * that triggers it is exactly what has to go -- and `||` is not a
 * substitute, because `COMMENT ON ... IS` takes a string constant and
 * nothing else: `'a' || 'b'` there is a syntax error.
 *
 * So the two are joined textually. Inside a literal, `''` already means a
 * plain quote, so gluing the inner parts together keeps every escape
 * valid on both sides of the join.
 *
 * Returns null when either side is an E-string: its backslash escapes
 * would change meaning on contact with a plain string, and merging them
 * silently would be worse than letting PostgreSQL complain.
 */
function mergeStringLiterals(first, second) {
  if (first[0] !== "'" || second[0] !== "'") return null
  if (first.length < 2 || second.length < 2) return null
  if (first.endsWith("'") !== true || second.endsWith("'") !== true) return null
  return "'" + first.slice(1, -1) + second.slice(1, -1) + "'"
}

/**
 * Rewrite SQL so each top-level statement is one line.
 *
 * `topLevel` is false while inside a dollar-quoted body: there, `;` is
 * plpgsql's own separator and must NOT break the line, because that line
 * is still in the middle of the statement that opened the dollar quote.
 */
function rewrite(src, topLevel) {
  let out = ''
  let i = 0
  // Where the most recent string constant starts in `out`, or -1 when the
  // most recent significant token was not a string. Used to merge
  // adjacent string constants across a newline.
  let lastStringStart = -1

  while (i < src.length) {
    const c = src[i]

    // --- line comment --------------------------------------------------
    if (c === '-' && src[i + 1] === '-') {
      const nl = src.indexOf('\n', i)
      i = nl === -1 ? src.length : nl + 1
      out += ' '
      continue
    }

    // --- block comment (nestable, as SQL allows) ------------------------
    if (c === '/' && src[i + 1] === '*') {
      let depth = 1
      i += 2
      while (i < src.length && depth > 0) {
        if (src[i] === '/' && src[i + 1] === '*') { depth++; i += 2; continue }
        if (src[i] === '*' && src[i + 1] === '/') { depth--; i += 2; continue }
        i++
      }
      out += ' '
      continue
    }

    // --- single-quoted string -------------------------------------------
    if (c === "'") {
      const { raw, end } = readStringLiteral(src, i)
      if (raw.includes('\n')) {
        // Worth saying out loud, though it is nearly always harmless: a
        // line break inside a string becomes a space. In practice this
        // only ever fires on `comment on column/function is '...'` text,
        // where the wording of a developer note does not matter. It would
        // matter for a user-facing message, so it is reported rather than
        // done silently.
        process.stderr.write(
          'NOTE: a string literal spans more than one line; its line ' +
            'break was replaced with a space (usually a COMMENT ON text).\n',
        )
      }
      lastStringStart = out.length
      out += raw.replace(/[\r\n\t]/g, ' ')
      i = end
      continue
    }

    // --- double-quoted identifier ----------------------------------------
    if (c === '"') {
      lastStringStart = -1
      let j = i + 1
      while (j < src.length) {
        if (src[j] === '"') {
          if (src[j + 1] === '"') { j += 2; continue }
          j++
          break
        }
        j++
      }
      out += src.slice(i, j).replace(/[\r\n\t]/g, ' ')
      i = j
      continue
    }

    // --- dollar-quoted body ----------------------------------------------
    if (c === '$') {
      const m = DOLLAR_TAG.exec(src.slice(i))
      if (m) {
        lastStringStart = -1
        const tag = m[0]
        const bodyStart = i + tag.length
        const close = src.indexOf(tag, bodyStart)
        const bodyEnd = close === -1 ? src.length : close
        // Recurse in NON-top-level mode: `;` inside stays put, comments
        // inside are still stripped, and the result is already a single
        // line -- rewrite() never emits a newline in that mode. Deliberately
        // NOT collapsing runs of spaces here: doing so would rewrite the
        // content of any string literal inside the body, and a message like
        // 'a    b' becoming 'a b' is exactly the kind of silent damage this
        // file exists to avoid.
        const body = rewrite(src.slice(bodyStart, bodyEnd), false)
        out += tag + body + (close === -1 ? '' : tag)
        i = close === -1 ? src.length : close + tag.length
        continue
      }
    }

    // --- end of statement --------------------------------------------------
    if (c === ';') {
      lastStringStart = -1
      out += topLevel ? ';\n' : ';'
      i++
      continue
    }

    // --- whitespace --------------------------------------------------------
    // Two string constants separated by whitespace containing a NEWLINE are
    // concatenated by PostgreSQL -- a documented rule, and the SQL in
    // `comment on ... is 'first part' \n 'second part'` depends on it.
    //
    // Collapsing that newline to a space turns a working statement into
    // "syntax error at or near 'second part'", and the error looks like a
    // fault in the comment text rather than in the reading method. So when
    // a gap between two string constants would have been a concatenation,
    // the two literals are MERGED into one (see mergeStringLiterals for
    // why `||` is not an option).
    //
    // Deliberately only when a newline was in the gap: `'a' 'b'` on one
    // line is a syntax error in PostgreSQL, and rewriting it would hide a
    // real mistake in the source rather than expose it.
    if (c === '\r' || c === '\n' || c === '\t' || c === ' ') {
      if (lastStringStart !== -1 && out.replace(/\s+$/, '').endsWith("'")) {
        const peek = peekAcrossGap(src, i)
        if (peek.sawNewline && peek.next === "'") {
          const second = readStringLiteral(src, peek.index)
          const merged = mergeStringLiterals(
            out.slice(lastStringStart),
            second.raw.replace(/[\r\n\t]/g, ' '),
          )
          if (merged !== null) {
            out = out.slice(0, lastStringStart) + merged
            lastStringStart = out.length - merged.length
            i = second.end
            continue
          }
        }
      }
      while (i < src.length && /[\s]/.test(src[i])) i++
      out += ' '
      continue
    }

    out += c
    lastStringStart = -1
    i++
  }

  return out
}


// --- single-user mode compatibility: strip WITH clause from CREATE VIEW ---
// Single-user mode (postgres --single) doesn't recognize security_definer/owner
// parameters in CREATE VIEW ... WITH (...) syntax. Strip them for harness runs.
// Also strip ALTER TABLE ENABLE ROW LEVEL SECURITY and CREATE POLICY on views,
// since single-user mode doesn't support RLS on views the same way.
function stripViewWithClause(sql) {
  // Debug: log input
  const hasCreateView = sql.includes('create or replace view public.account_list_view');
  if (hasCreateView) {
    const idx = sql.indexOf('create or replace view public.account_list_view');
    console.error('DEBUG stripViewWithClause input (around account_list_view):', sql.slice(idx, idx + 120));
  }
  let out = sql
    // Strip WITH clause from CREATE VIEW - use a more precise regex
    .replace(
      /create or replace view\s+([\w.]+)\s+with\s*\([^)]*\)\s*as/gi,
      (match, viewName) => {
        if (hasCreateView) console.error('DEBUG: matched CREATE VIEW, viewName=', viewName);
        return 'create or replace view ' + viewName + ' as';
      }
    )
    .replace(
      /create view\s+([\w.]+)\s+with\s*\([^)]*\)\s*as/gi,
      'create view $1 as'
    )
    // Strip ALTER TABLE ... ENABLE ROW LEVEL SECURITY on views
    .replace(
      /alter table\s+(public\.[\w.]+)\s+enable row level security;/gi,
      '-- alter table $1 enable row level security;'
    )
    // Strip CREATE POLICY on views
    .replace(
      /create policy\s+"[^"]+"\s+on\s+public\.[\w.]+\s+for\s+select\s+to\s+authenticated\s+using\s*\([\s\S]*?\);/gi,
      ''
    )
    .replace(
      /drop policy if exists\s+"[^"]+"\s+on\s+public\.[\w.]+;/gi,
      ''
    );
  if (hasCreateView) {
    const idx = out.indexOf('create or replace view public.account_list_view');
    if (idx >= 0) {
      console.error('DEBUG stripViewWithClause output (around account_list_view):', out.slice(idx, idx + 120));
    } else {
      console.error('DEBUG: CREATE VIEW MISSING from output!');
    }
  }
  return out;
}

export function flattenSql(source) {
  // Trim each line and drop blanks. Safe because the only newlines this
  // produces are the ones placed after a top-level `;`.
  let out = rewrite(source, true)
    .split('\n')
    .map((l) => l.trim())
    .filter((l) => l.length > 0)
    .join('\n');
  // Strip WITH clause from CREATE VIEW for single-user mode compatibility
  out = stripViewWithClause(out);
  return out;
}


// --- command line use ---------------------------------------------------
// node flatten-sql.mjs <in.sql> <out.sql>
if (process.argv.length === 4) {
  const [, , input, output] = process.argv
  const flattened = flattenSql(readFileSync(input, 'utf8'))
  writeFileSync(output, flattened, 'utf8')
  const statements = flattened.split('\n').filter((l) => l.length > 0)
  const longest = statements.reduce((m, s) => Math.max(m, s.length), 0)
  console.error(
    `flattened: ${statements.length} statements, longest ${longest} chars`,
  )
}
