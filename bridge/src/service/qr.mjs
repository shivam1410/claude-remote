// Render a QR code as text, using half-block characters so one terminal row
// carries two module rows. That keeps the code small enough to fit an ordinary
// window and still scan from screen.
//
// Light modules must be the *background* colour for a scanner to read it, so
// this renders dark-on-light regardless of the terminal theme.
import qr from 'qrcode-generator';

const UPPER = '▀'; // ▀
const LOWER = '▄'; // ▄
const FULL = '█';  // █
const BLANK = ' ';

// Dark text on a light background, reset at the end of every line.
const INK = '\u001b[30;47m';
const RESET = '\u001b[0m';

/**
 * Render `text` as a QR code.
 * `colour: false` emits plain characters, for piping or for tests.
 */
export function render(text, { errorCorrection = 'M', quiet = 2, colour = true } = {}) {
  const code = qr(0, errorCorrection);
  code.addData(text);
  code.make();

  const size = code.getModuleCount();
  const total = size + quiet * 2;
  const dark = (row, column) => {
    const r = row - quiet;
    const c = column - quiet;
    return r >= 0 && c >= 0 && r < size && c < size && code.isDark(r, c);
  };

  const lines = [];
  for (let row = 0; row < total; row += 2) {
    let line = '';
    for (let column = 0; column < total; column += 1) {
      const top = dark(row, column);
      const bottom = row + 1 < total ? dark(row + 1, column) : false;
      // With dark ink on a light background, a "dark" module is drawn and a
      // light one is left blank.
      if (top && bottom) line += FULL;
      else if (top) line += UPPER;
      else if (bottom) line += LOWER;
      else line += BLANK;
    }
    lines.push(colour ? `${INK}${line}${RESET}` : line);
  }
  return lines.join('\n');
}
