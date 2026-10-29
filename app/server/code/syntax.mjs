/**
 * A tiny syntax reader.
 *
 * MAX does not compile or parse a full grammar — it only needs enough structure to
 * tell code from text: where comments, strings, template expressions, regex literals
 * and JSX live, whether delimiters balance, and how a file is indented. Everything
 * downstream works on the masked copy, so a `// TODO` inside a string is never
 * treated as a comment, and an apostrophe in JSX copy is never a broken string.
 */

export const splitLines = (code) => String(code ?? "").split(/\r\n|\r|\n/);

export function lineOf(code, index) {
  let line = 1;
  for (let position = 0; position < index && position < code.length; position += 1) {
    if (code.charCodeAt(position) === 10) line += 1;
  }
  return line;
}

const JS_FAMILY = new Set(["javascript", "typescript"]);
/** Expressions that may legally be followed by a `/regex/` literal. */
const REGEX_PRECEDERS = new Set(["", "(", ",", "=", ":", "[", "!", "&", "|", "?", "{", "}", ";", "+", "-", "*", "%", "<", ">", "~", "^"]);
const REGEX_KEYWORDS = new Set(["return", "typeof", "case", "in", "of", "new", "delete", "void", "instanceof", "do", "else", "yield", "await"]);

/**
 * Replace comments, strings, template expressions, regex literals and JSX text with
 * spaces, keeping every other character (including newlines) at its original index.
 */
export function maskCode(code, language) {
  const source = String(code ?? "");
  const out = source.split("");
  const lineComments = language?.lineComment ?? [];
  const [blockOpen, blockClose] = language?.blockComment ?? [];
  const quotes = [...new Set(language?.stringQuotes ?? [])].sort((a, b) => b.length - a.length);
  const isJs = JS_FAMILY.has(language?.id);
  const isJson = language?.id === "json";
  const jsx = isJs && language?.jsx !== false;

  let unterminated = null;

  const blank = (from, to) => {
    for (let position = from; position < to && position < out.length; position += 1) {
      if (out[position] !== "\n") out[position] = " ";
    }
  };

  /** `/` is a regex when the previous meaningful character cannot end an expression. */
  const regexAllowedAt = (index) => {
    let cursor = index - 1;
    while (cursor >= 0 && /\s/.test(source[cursor])) cursor -= 1;
    if (cursor < 0) return true;
    const previous = source[cursor];
    if (REGEX_PRECEDERS.has(previous)) return true;
    // `return /re/` and friends
    let wordEnd = cursor;
    let wordStart = cursor;
    while (wordStart >= 0 && /[A-Za-z]/.test(source[wordStart])) wordStart -= 1;
    const word = source.slice(wordStart + 1, wordEnd + 1);
    return REGEX_KEYWORDS.has(word);
  };

  /**
   * Scan a quoted string starting at `start`. Templates (`${…}`) may contain real
   * code, so those expressions are masked recursively.
   * @returns {number} index just past the string
   */
  const scanString = (start, quote) => {
    let cursor = start + quote.length;
    const template = quote[0] === "`";
    while (cursor < source.length) {
      if (source[cursor] === "\\") {
        cursor += 2;
        continue;
      }
      if (template && source.startsWith("${", cursor)) {
        const end = scanCode(cursor + 2, true);
        cursor = end;
        continue;
      }
      if (source.startsWith(quote, cursor)) return cursor + quote.length;
      // Single-line quotes cannot span a newline: that is an unterminated string.
      if (!template && quote.length === 1 && source[cursor] === "\n") break;
      if (quote === '"""' || quote === "'''") {
        // Python triple quotes may span lines freely.
      }
      cursor += 1;
    }
    if (!unterminated) unterminated = { quote, line: lineOf(source, start) };
    return Math.min(cursor, source.length);
  };

  /**
   * Scan a JSX tag starting at `<`. Returns the index just past `>`, or -1 when this
   * `<` is really a generic or a comparison.
   *
   * Generics are the tricky case: `<StatePayload | null>`, `<T extends X>`,
   * `<Record<string, x>>` and `<T>(value)` all start exactly like a tag.
   */
  const scanTag = (start) => {
    const name = /^<\/?[A-Za-z][\w.:-]*/.exec(source.slice(start, start + 80));
    if (!name) return -1;
    let cursor = start + name[0].length;

    const afterName = () => {
      let look = cursor;
      while (look < source.length && (source[look] === " " || source[look] === "\t")) look += 1;
      return { look, char: source[look] ?? "" };
    };

    const { look, char } = afterName();
    const tail = source.slice(look, look + 12);

    // `<T>(value)` — a generic call, not a tag.
    if (char === ">" && /^\(\s*/.test(source.slice(look + 1, look + 4))) return -1;
    // `<A | B>`, `<A, B>`, `<A extends B>`, `<A = B>`, `<Record<string, x>>`
    if (["|", ",", "&", "=", "<", ":"].includes(char)) return -1;
    if (/^extends\b/.test(tail)) return -1;
    // An attribute must look like `name=`, `{`, `>`, `/>` or `</name>`.
    if (char && !/^(>|\/|\{|[\w-]+\s*=)/.test(tail) && char !== "") {
      if (!/^\/??>$/.test(tail) && !/^[\w-]+\s*=/.test(tail) && char !== "{" && char !== ">") return -1;
    }

    let depth = 0;
    let index = cursor;
    while (index < source.length && index - start < 4000) {
      const current = source[index];
      if (current === ";") return -1; // an expression, not a tag
      if (current === '"' || current === "'") {
        index = scanString(index, current);
        continue;
      }
      if (current === "{") depth += 1;
      else if (current === "}") depth = Math.max(0, depth - 1);
      else if (current === ">" && depth === 0) return index + 1;
      else if (current === "<" && index !== start) return -1;
      index += 1;
    }
    return -1;
  };

  /**
   * The main scanner. `stopAtBrace` is set while inside a template expression, so a
   * closing `}` returns control to the string that opened it.
   * @returns {number} index where scanning stopped
   */
  const scanCode = (from, stopAtBrace = false) => {
    let index = from;
    let braces = 0;

    while (index < source.length) {
      const char = source[index];

      if (blockOpen && source.startsWith(blockOpen, index)) {
        const end = source.indexOf(blockClose, index + blockOpen.length);
        const stop = end === -1 ? source.length : end + blockClose.length;
        blank(index, stop);
        index = stop;
        continue;
      }

      const lineToken = lineComments.find((token) => source.startsWith(token, index));
      if (lineToken) {
        const end = source.indexOf("\n", index);
        const stop = end === -1 ? source.length : end;
        blank(index, stop);
        index = stop;
        continue;
      }

      const quote = quotes.find((token) => source.startsWith(token, index));
      if (quote) {
        const stop = scanString(index, quote);
        blank(index, stop);
        index = stop;
        continue;
      }

      if (isJs && char === "/" && !isJson && regexAllowedAt(index)) {
        let cursor = index + 1;
        let inClass = false;
        let closed = false;
        while (cursor < source.length) {
          const current = source[cursor];
          if (current === "\\") {
            cursor += 2;
            continue;
          }
          if (current === "\n") break;
          if (current === "[") inClass = true;
          else if (current === "]") inClass = false;
          else if (current === "/" && !inClass) {
            closed = true;
            break;
          }
          cursor += 1;
        }
        if (closed) {
          let stop = cursor + 1;
          while (stop < source.length && /[gimsuyvd]/.test(source[stop])) stop += 1;
          blank(index, stop);
          index = stop;
          continue;
        }
      }

      if (jsx && char === "<") {
        const tagEnd = scanTag(index);
        if (tagEnd !== -1) {
          blank(index, tagEnd);
          // After an opening tag we may be in JSX text: skip it up to `<` or `{`.
          const selfClosing = source[tagEnd - 2] === "/";
          if (!selfClosing && !source.startsWith("</", index)) {
            let cursor = tagEnd;
            while (cursor < source.length && source[cursor] !== "<" && source[cursor] !== "{") cursor += 1;
            blank(tagEnd, cursor);
            index = cursor;
          } else {
            index = tagEnd;
          }
          continue;
        }
      }

      if (stopAtBrace) {
        if (char === "{") braces += 1;
        else if (char === "}") {
          if (braces === 0) return index + 1;
          braces -= 1;
        }
      }

      index += 1;
    }
    return index;
  };

  scanCode(0);

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
