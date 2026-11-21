import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { lastAssistantMessage, modelOf } from '../src/service/transcript.mjs';

function transcript(lines) {
  const dir = mkdtempSync(join(tmpdir(), 'bridge-tx-'));
  const path = join(dir, 'session.jsonl');
  writeFileSync(path, lines.map((l) => JSON.stringify(l)).join('\n') + '\n');
  return { dir, path };
}

test('returns the most recent assistant text', () => {
  const { dir, path } = transcript([
    { type: 'assistant', message: { content: [{ type: 'text', text: 'first' }] } },
    { type: 'user', message: { content: [{ type: 'text', text: 'a question' }] } },
    { type: 'assistant', message: { content: [{ type: 'text', text: 'second' }] } },
  ]);
  assert.equal(lastAssistantMessage(path), 'second');
  rmSync(dir, { recursive: true, force: true });
});

test('skips thinking and tool_use parts', () => {
  const { dir, path } = transcript([
    { type: 'assistant', message: { content: [{ type: 'text', text: 'the answer' }] } },
    { type: 'assistant', message: { content: [{ type: 'thinking', thinking: 'hidden' }] } },
    { type: 'assistant', message: { content: [{ type: 'tool_use', name: 'Bash' }] } },
  ]);
  const out = lastAssistantMessage(path);
  assert.equal(out, 'the answer');
  assert.ok(!out.includes('hidden'), 'thinking leaked');
  rmSync(dir, { recursive: true, force: true });
});

test('handles a string content field', () => {
  const { dir, path } = transcript([
    { type: 'assistant', message: { content: 'plain string' } },
  ]);
  assert.equal(lastAssistantMessage(path), 'plain string');
  rmSync(dir, { recursive: true, force: true });
});

test('returns empty for a missing file', () => {
  assert.equal(lastAssistantMessage('/nope/does-not-exist.jsonl'), '');
  assert.equal(lastAssistantMessage(''), '');
  assert.equal(lastAssistantMessage(undefined), '');
});

test('returns empty when there is no assistant text at all', () => {
  const { dir, path } = transcript([
    { type: 'user', message: { content: [{ type: 'text', text: 'hi' }] } },
  ]);
  assert.equal(lastAssistantMessage(path), '');
  rmSync(dir, { recursive: true, force: true });
});

test('modelOf returns the most recent assistant model', () => {
  const { dir, path } = transcript([
    { type: 'assistant', message: { model: 'claude-sonnet-4-6', content: [{ type: 'text', text: 'a' }] } },
    { type: 'user', message: { content: [{ type: 'text', text: 'q' }] } },
    { type: 'assistant', message: { model: 'claude-opus-4-8', content: [{ type: 'text', text: 'b' }] } },
  ]);
  assert.equal(modelOf(path), 'claude-opus-4-8');
  rmSync(dir, { recursive: true, force: true });
});

test('modelOf is empty when no assistant record carries a model', () => {
  const { dir, path } = transcript([
    { type: 'user', message: { content: [{ type: 'text', text: 'hi' }] } },
  ]);
  assert.equal(modelOf(path), '');
  assert.equal(modelOf('/nope.jsonl'), '');
  rmSync(dir, { recursive: true, force: true });
});
