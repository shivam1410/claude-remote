import test from 'node:test';
import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';
import { render } from '../src/service/qr.mjs';
import { encode } from '../src/service/pairing.mjs';

const URI = encode({
  key: randomBytes(32),
  uid: 'EXAMPLEUID000000000000000000',
  databaseUrl: 'https://example-default-rtdb.firebaseio.com',
});

test('renders a square block of half-block characters', () => {
  const lines = render(URI, { colour: false }).split('\n');
  const width = lines[0].length;

  assert.ok(lines.length > 10, 'suspiciously few rows');
  // Two module rows per text row, so height is about half the width.
  assert.ok(Math.abs(width / 2 - lines.length) <= 1, `${width} wide vs ${lines.length} tall`);
  assert.ok(lines.every((l) => l.length === width), 'ragged rows');
  assert.ok(/[▀▄█]/.test(lines.join('')), 'no block characters drawn');
});

test('includes a quiet zone, which scanners require', () => {
  const lines = render(URI, { colour: false, quiet: 2 }).split('\n');
  assert.equal(lines[0].trim(), '', 'top quiet zone is not blank');
  assert.equal(lines[lines.length - 1].trim(), '', 'bottom quiet zone is not blank');
  assert.ok(lines.every((l) => l.startsWith('  ')), 'left quiet zone is missing');
});

test('colour output wraps each line and resets it', () => {
  const lines = render(URI).split('\n');
  assert.ok(lines.every((l) => l.startsWith('\u001b[30;47m') && l.endsWith('\u001b[0m')));
});

test('grows with the payload rather than failing', () => {
  const small = render('short', { colour: false }).split('\n')[0].length;
  const large = render('x'.repeat(400), { colour: false }).split('\n')[0].length;
  assert.ok(large > small, 'capacity did not grow with input');
});
