/**
 * A tiny syntax reader.
 *
 * MAX does not compile or parse a full grammar — it only needs enough structure to
 * tell code from text: where comments and strings are, whether delimiters balance,
 * and how a file is indented. Everything downstream works on the masked copy, so a
 * `// TODO` inside a string is never treated as a comment.
 */

export const splitLines = (code) => String(code ?? "").split(/\r\n|\r|\n/);

export function lineOf(code, index) {
  let line = 1;
  for (let position = 0; position < index && position < code.length; position += 1) {
    if (code.charCodeAt(position) === 10) line += 1;
  }
  return line;
}

const isIdentifier = (char) => /[A-Za-z0-9_$]/.test(char ?? "");

/**
 * Replace comments and string literals with spaces, keeping every other character
 * (including newlines) at its original index. The result is safe to regex over.
 */
export function maskCode(code, language) {
  const source = String(code ?? "");
  const out = source.split("");
  const lineComments = language?.lineComment ?? [];
  const [blockOpen, blockClose] = language?.blockComment ?? [];
  const quotes = [...(language?.stringQuotes ?? [])].sort((a, b) => b.length - a.length);

  let unterminated = null;
  let index = 0;

  const blank = (from, to) => {
    for (let position = from; position < to && position < out.length; position += 1) {
      if (out[position] !== "\n") out[position] = " ";
    }
  };

  while (index < source.length) {
    if (blockOpen && source.startsWith(blockOpen, index)) {
      const end = source.indexOf(blockClose, index + blockOpen.length);
      const stop = end === -1 ? source.length : end + blockClose.length;
      blank(index, stop);
      index = stop;
      continue;
    }

    const lineComment = lineComments.find((token) => source.startsWith(token, index));
    if (lineComment) {
      const end = source.indexOf("\n", index);
      const stop = end === -1 ? source.length : end;
      blank(index, stop);
      index = stop;
      continue;
    }

    const quote = quotes.find((token) => source.startsWith(token, index));
    if (quote) {
      let cursor = index + quote.length;
      let closed = false;
      while (cursor < source.length) {
        if (source[cursor] === "\\") {
          cursor += 2;
          continue;
        }
        if (source.startsWith(quote, cursor)) {
          cursor += quote.length;
          closed = true;
          break;
        }
        // Single-line quotes cannot span a newline: that is an unterminated string.
        if (quote.length === 1 && source[cursor] === "\n") break;
        cursor += 1;
      }
      blank(index, cursor);
      if (!closed && !unterminated) unterminated = { quote, line: lineOf(source, index) };
      index = cursor;
      continue;
    }

    index += 1;
  }

  return { masked: out.join(""), unterminated };
}

const OPENERS = { "(": ")", "[": "]", "{": "}" };
const CLOSERS = { ")": "(", "]": "[", "}": "{" };

/** Balanced-bracket check on already-masked code. */
export function delimiterProblems(masked) {
  const stack = [];
  const problems = [];
  for (let index = 0; index < masked.length; index += 1) {
    const char = masked[index];
    if (OPENERS[char]) {
      stack.push({ char, index });
    } else if (CLOSERS[char]) {
      const top = stack.pop();
      if (!top) {
        problems.push({ kind: "unexpected-close", char, index, line: lineOf(masked, index) });
      } else if (top.char !== CLOSERS[char]) {
        problems.push({
          kind: "mismatch",
          char,
          expected: OPENERS[top.char],
          index,
          line: lineOf(masked, index),
          openedLine: lineOf(masked, top.index),
        });
      }
    }
  }
  for (const leftover of stack.slice(0, 4)) {
    problems.push({ kind: "unclosed", char: leftover.char, index: leftover.index, line: lineOf(masked, leftover.index) });
  }
  return problems;
}

/** Count leading tabs and spaces so a file can be checked for mixed indentation. */
export function indentProfile(lines) {
  let tabbed = 0;
  let spaced = 0;
  let mixed = 0;
  for (const line of lines) {
    if (!line.trim()) continue;
    const leading = line.match(/^[ \t]+/)?.[0] ?? "";
    if (!leading) continue;
    const tabs = (leading.match(/\t/g) ?? []).length;
    const spaces = (leading.match(/ /g) ?? []).length;
    if (tabs && spaces) mixed += 1;
    else if (tabs) tabbed += 1;
    else spaced += 1;
  }
  return { tabbed, spaced, mixed };
}

/** Replace only the characters at the given positions, leaving strings untouched. */
export function replaceAt(text, edits) {
  if (!edits.length) return text;
  let out = "";
  let cursor = 0;
  for (const edit of [...edits].sort((a, b) => a.start - b.start)) {
    if (edit.start < cursor) continue;
    out += text.slice(cursor, edit.start) + edit.text;
    cursor = edit.end;
  }
  return out + text.slice(cursor);
}
