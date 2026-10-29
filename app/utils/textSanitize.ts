// Text that comes from a PDF text layer or a clipboard can carry characters no downstream
// library can survive:
// - pdf.js writes "\u0000" for every glyph whose font has no Unicode mapping (CID 0 / .notdef).
//   kuromoji's doublearray trie reads U+0000 as its terminator, returns an entry with no word
//   id for it, and the lattice builder then throws `Cannot read properties of undefined
//   (reading 'length')` - the whole annotation job fails on one stray byte.
// - An unpaired UTF-16 surrogate makes kuromoji's UTF-8 conversion return null
//   (`Cannot read properties of null (reading 'length')`).
// Control characters carry no readable meaning in a script, so they are dropped instead of
// replaced: `待って\u0000いた` becomes `待っていた`, not `待って�いた`.
const LONE_SURROGATE = /[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/g;
// C0 controls except TAB/LF/CR, plus DEL and the C1 block (never valid in UTF-8 text).
const CONTROL = /[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F-\u009F]/g;

export function sanitizeText(text: string): string {
  return text.replace(LONE_SURROGATE, '').replace(CONTROL, '');
}
