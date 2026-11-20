// Turn a raw assistant or user message into the short, scrubbed line that the
// phone is allowed to see.
//
// The user's constraint is explicit: status plus a redacted summary of the last
// message. Not the transcript, not tool output, not file contents. Code blocks
// are dropped wholesale because they are the most likely carrier of work source
// and the least useful thing to read on a phone.
import { scrub } from './scrub.mjs';

const MAX_CHARS = 200;

function stripNoise(text) {
  return text
    // Fenced code blocks, including unterminated trailing fences.
    .replace(/```[\s\S]*?(?:```|$)/g, ' ')
    // Indented blocks that are almost certainly code or tool output.
    .replace(/^(?: {4}|\t).*$/gm, ' ')
    // Inline code spans: keep the sentence, drop the token.
    .replace(/`[^`\n]*`/g, ' ')
    // Markdown links: keep the label, drop the URL.
    .replace(/\[([^\]]*)\]\([^)]*\)/g, '$1')
    // Bare URLs and absolute paths.
    .replace(/\bhttps?:\/\/\S+/g, ' ')
    .replace(/(?:^|\s)(?:\/[\w.-]+){2,}\/?/g, ' ')
    // XML-ish wrappers the CLI uses around injected context.
    .replace(/<\/?[a-zA-Z][\w-]*[^>]*>/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function firstSentences(text, limit) {
  const parts = text.split(/(?<=[.!?])\s+/);
  let out = '';
  for (const part of parts) {
    if (out && (out + ' ' + part).length > limit) break;
    out = out ? `${out} ${part}` : part;
    if (out.length >= limit) break;
  }
  return out || text;
}

function truncate(text, limit) {
  if (text.length <= limit) return text;
  const cut = text.slice(0, limit - 1);
  const space = cut.lastIndexOf(' ');
  return `${(space > limit * 0.6 ? cut.slice(0, space) : cut).trimEnd()}…`;
}

/**
 * Produce a <= 200 character, scrubbed, prose summary of a message.
 * Returns '' when nothing publishable survives (for example a code-only reply).
 */
export function summarise(message, { maxChars = MAX_CHARS } = {}) {
  if (typeof message !== 'string' || message.trim() === '') return '';

  const prose = stripNoise(message);
  if (prose === '') return '';

  return truncate(scrub(firstSentences(prose, maxChars)), maxChars);
}

export const limits = { MAX_CHARS };
