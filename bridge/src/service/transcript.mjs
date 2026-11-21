// Read the last assistant message out of a session transcript.
//
// The transcript stays on this machine. Only the summarised, scrubbed, capped
// result of this function is ever encrypted and published, per the constraint
// that the database holds a status and one short line, nothing more.
import { openSync, fstatSync, readSync, closeSync } from 'node:fs';

const TAIL_BYTES = 256 * 1024;

/** Read the final chunk of a file as text, without loading the whole thing. */
function readTail(path, bytes = TAIL_BYTES) {
  const fd = openSync(path, 'r');
  try {
    const { size } = fstatSync(fd);
    const length = Math.min(size, bytes);
    const buffer = Buffer.alloc(length);
    readSync(fd, buffer, 0, length, size - length);
    return buffer.toString('utf8');
  } finally {
    closeSync(fd);
  }
}

/** Pull the plain-text parts out of one transcript entry. */
function textOf(entry) {
  const content = entry?.message?.content;
  if (typeof content === 'string') return content;
  if (!Array.isArray(content)) return '';
  return content
    .filter((part) => part?.type === 'text' && typeof part.text === 'string')
    .map((part) => part.text)
    .join('\n')
    .trim();
}

/**
 * Return the most recent assistant text in a transcript, or '' when there is
 * none, the file is unreadable, or the tail holds no complete record.
 */
export function lastAssistantMessage(path) {
  if (typeof path !== 'string' || path === '') return '';

  let tail;
  try {
    tail = readTail(path);
  } catch {
    return '';
  }

  const lines = tail.split('\n');
  for (let i = lines.length - 1; i >= 0; i -= 1) {
    const line = lines[i].trim();
    if (!line.startsWith('{')) continue;

    let entry;
    try {
      entry = JSON.parse(line);
    } catch {
      // A partial first line is expected when the tail cuts mid-record.
      continue;
    }
    if (entry?.type !== 'assistant') continue;

    const text = textOf(entry);
    if (text) return text;
  }
  return '';
}

/**
 * The model id from the most recent assistant record (e.g. "claude-opus-4-8"),
 * or '' when the tail holds none. Same cheap tail read as the message.
 */
export function modelOf(path) {
  if (typeof path !== 'string' || path === '') return '';

  let tail;
  try {
    tail = readTail(path);
  } catch {
    return '';
  }

  const lines = tail.split('\n');
  for (let i = lines.length - 1; i >= 0; i -= 1) {
    const line = lines[i].trim();
    if (!line.startsWith('{')) continue;

    let entry;
    try {
      entry = JSON.parse(line);
    } catch {
      continue;
    }
    if (entry?.type === 'assistant' && typeof entry?.message?.model === 'string') {
      return entry.message.model;
    }
  }
  return '';
}
