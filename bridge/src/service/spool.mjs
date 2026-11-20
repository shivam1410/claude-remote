// Drain the hook spool exactly once per record.
//
// The hook appends and never coordinates; this side keeps a byte cursor per
// file so a crash re-reads at most one partial line and never replays a day of
// events. Partial trailing lines are left for the next pass.
import { readFileSync, readdirSync, writeFileSync, mkdirSync, statSync } from 'node:fs';
import { join } from 'node:path';

/** Load the cursor map, tolerating a missing or corrupt file. */
export function readCursor(path) {
  try {
    const parsed = JSON.parse(readFileSync(path, 'utf8'));
    return parsed && typeof parsed === 'object' ? parsed : {};
  } catch {
    return {};
  }
}

export function writeCursor(path, cursor) {
  writeFileSync(path, JSON.stringify(cursor), { mode: 0o600 });
}

/**
 * Read every complete record written since the last cursor position.
 * Returns { records, cursor } — the caller persists the cursor only after the
 * records have been published, so a failed publish is retried rather than lost.
 */
export function drain(spoolDir, cursor) {
  mkdirSync(spoolDir, { recursive: true });

  const next = { ...cursor };
  const records = [];

  for (const name of readdirSync(spoolDir).filter((f) => f.endsWith('.jsonl')).sort()) {
    const path = join(spoolDir, name);
    const size = statSync(path).size;
    const from = Number(next[name] ?? 0);

    // A file that shrank was rotated or truncated; start over rather than
    // reading from a stale offset into the middle of a record.
    const start = from > size ? 0 : from;
    if (start === size) continue;

    const text = readFileSync(path, 'utf8').slice(start);
    // split always leaves a trailing element: '' for a clean newline ending, or
    // a partial record otherwise. Dropping it is correct in both cases.
    const complete = text.split('\n').slice(0, -1);
    const consumed = complete.reduce((sum, line) => sum + Buffer.byteLength(line) + 1, 0);

    for (const line of complete) {
      if (!line.trim()) continue;
      try {
        records.push(JSON.parse(line));
      } catch {
        // A malformed line is skipped, not retried: the hook writes one JSON
        // object per line, so a broken line will never become valid.
      }
    }
    next[name] = start + consumed;
  }

  records.sort((a, b) => (a.ts ?? 0) - (b.ts ?? 0));
  return { records, cursor: next };
}
