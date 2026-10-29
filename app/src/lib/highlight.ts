/**
 * A small syntax highlighter for the island's editor.
 *
 * No dependency, no worker, no network: one character scanner per language family
 * that walks the text once and yields coloured spans. It only has to look right on
 * a laptop screen, so it recognises what a reader cares about — comments, strings,
 * numbers, keywords, types, function calls and tags.
 */

type TokenType =
  | "plain"
  | "comment"
  | "string"
  | "number"
  | "keyword"
  | "type"
  | "function"
  | "operator"
  | "tag"
  | "attr"
  | "property"
  | "selector"
  | "punct";

interface Grammar {
  lineComment: string[];
  blockComment?: [string, string];
  strings: string[];
  keywords: string[];
  types?: string[];
  /** Uppercase-insensitive keywords (SQL). */
  caseInsensitive?: boolean;
}

const C_LIKE_KEYWORDS = [
  "if", "else", "for", "while", "do", "switch", "case", "default", "break", "continue", "return",
  "const", "let", "var", "function", "class", "extends", "new", "delete", "typeof", "instanceof",
  "in", "of", "this", "super", "throw", "try", "catch", "finally", "async", "await", "yield",
  "import", "export", "from", "as", "static", "get", "set", "void", "public", "private", "protected",
  "readonly", "interface", "enum", "namespace", "declare", "implements", "abstract", "satisfies",
];

const GRAMMARS: Record<string, Grammar> = {
  javascript: {
    lineComment: ["//"],
    blockComment: ["/*", "*/"],
    strings: ["`", '"', "'"],
    keywords: [...C_LIKE_KEYWORDS, "null", "undefined", "true", "false", "debugger"],
    types: ["String", "Number", "Boolean", "Object", "Array", "Promise", "Map", "Set", "JSON", "Math", "console"],
  },
  typescript: {
    lineComment: ["//"],
    blockComment: ["/*", "*/"],
    strings: ["`", '"', "'"],
    keywords: [...C_LIKE_KEYWORDS, "null", "undefined", "true", "false", "type", "keyof", "infer", "is", "asserts"],
    types: ["string", "number", "boolean", "any", "unknown", "never", "object", "symbol", "bigint", "Array", "Promise", "Record", "Partial"],
  },
  python: {
    lineComment: ["#"],
    strings: ['"""', "'''", '"', "'"],
    keywords: [
      "def", "class", "return", "if", "elif", "else", "for", "while", "break", "continue", "pass",
      "import", "from", "as", "try", "except", "finally", "raise", "with", "lambda", "yield",
      "global", "nonlocal", "assert", "del", "in", "is", "not", "and", "or", "True", "False", "None",
      "async", "await", "self", "match", "case",
    ],
    types: ["int", "str", "float", "bool", "list", "dict", "set", "tuple", "bytes", "len", "range", "print", "open", "enumerate", "zip"],
  },
  java: {
    lineComment: ["//"],
    blockComment: ["/*", "*/"],
    strings: ['"""', '"', "'"],
    keywords: [
      "public", "private", "protected", "static", "final", "class", "interface", "extends", "implements",
      "new", "return", "if", "else", "for", "while", "do", "switch", "case", "default", "break",
      "continue", "try", "catch", "finally", "throw", "throws", "void", "package", "import", "this",
      "super", "null", "true", "false", "abstract", "synchronized", "instanceof", "record", "enum", "var",
    ],
    types: ["int", "long", "double", "float", "boolean", "char", "byte", "short", "String", "Object", "List", "Map", "Set", "Optional"],
  },
  csharp: {
    lineComment: ["//"],
    blockComment: ["/*", "*/"],
    strings: ['@"', '"', "'"],
    keywords: [
      "using", "namespace", "class", "struct", "record", "interface", "public", "private", "protected",
      "internal", "static", "readonly", "const", "new", "return", "if", "else", "for", "foreach",
      "while", "do", "switch", "case", "default", "break", "continue", "try", "catch", "finally",
      "throw", "void", "var", "this", "base", "null", "true", "false", "async", "await", "get", "set",
    ],
    types: ["int", "long", "double", "float", "bool", "char", "byte", "string", "object", "List", "Dictionary", "Task", "IEnumerable"],
  },
  c: {
    lineComment: ["//"],
    blockComment: ["/*", "*/"],
    strings: ['"', "'"],
    keywords: [
      "int", "char", "float", "double", "void", "long", "short", "unsigned", "signed", "const",
      "static", "struct", "union", "enum", "typedef", "return", "if", "else", "for", "while", "do",
      "switch", "case", "default", "break", "continue", "goto", "sizeof", "include", "define",
    ],
    types: ["size_t", "FILE", "NULL", "uint8_t", "int32_t", "int64_t", "bool"],
  },
  cpp: {
    lineComment: ["//"],
    blockComment: ["/*", "*/"],
    strings: ['R"(', '"', "'"],
    keywords: [
      "int", "char", "float", "double", "void", "long", "short", "unsigned", "const", "constexpr",
      "static", "struct", "class", "union", "enum", "typedef", "template", "typename", "namespace",
      "using", "public", "private", "protected", "virtual", "override", "return", "if", "else", "for",
      "while", "do", "switch", "case", "default", "break", "continue", "new", "delete", "try", "catch",
      "throw", "auto", "nullptr", "true", "false", "include", "define",
    ],
    types: ["std", "string", "vector", "map", "set", "unique_ptr", "shared_ptr", "size_t", "size_t"],
  },
  rust: {
    lineComment: ["//"],
    blockComment: ["/*", "*/"],
    strings: ['r#"', '"', "'"],
    keywords: [
      "fn", "let", "mut", "const", "static", "struct", "enum", "trait", "impl", "for", "while",
      "loop", "match", "if", "else", "return", "break", "continue", "use", "mod", "pub", "crate",
      "self", "Self", "super", "async", "await", "move", "ref", "where", "dyn", "unsafe", "as", "in",
      "true", "false", "Some", "None", "Ok", "Err",
    ],
    types: ["String", "Vec", "Option", "Result", "Box", "Rc", "Arc", "HashMap", "i32", "i64", "u32", "u64", "usize", "f64", "bool", "str"],
  },
  go: {
    lineComment: ["//"],
    blockComment: ["/*", "*/"],
    strings: ["`", '"', "'"],
    keywords: [
      "package", "import", "func", "var", "const", "type", "struct", "interface", "map", "chan",
      "go", "defer", "select", "case", "default", "if", "else", "for", "range", "switch", "return",
      "break", "continue", "fallthrough", "goto", "nil", "true", "false",
    ],
    types: ["string", "int", "int64", "float64", "bool", "byte", "rune", "error", "any"],
  },
  ruby: {
    lineComment: ["#"],
    strings: ['"', "'"],
    keywords: [
      "def", "end", "class", "module", "if", "elsif", "else", "unless", "while", "until", "for",
      "do", "begin", "rescue", "ensure", "raise", "return", "yield", "self", "nil", "true", "false",
      "require", "include", "attr_accessor", "attr_reader", "then", "and", "or", "not", "puts",
    ],
    types: ["String", "Integer", "Float", "Array", "Hash", "Symbol", "Proc"],
  },
  swift: {
    lineComment: ["//"],
    blockComment: ["/*", "*/"],
    strings: ['"""', '"'],
    keywords: [
      "func", "let", "var", "class", "struct", "enum", "protocol", "extension", "import", "return",
      "if", "else", "guard", "for", "while", "repeat", "switch", "case", "default", "break",
      "continue", "throw", "throws", "try", "catch", "defer", "in", "init", "self", "Self", "nil",
      "true", "false", "public", "private", "internal", "static", "final", "async", "await", "some", "any",
    ],
    types: ["String", "Int", "Double", "Float", "Bool", "Array", "Dictionary", "Set", "Optional", "Result"],
  },
  sql: {
    lineComment: ["--"],
    blockComment: ["/*", "*/"],
    strings: ["'", '"'],
    keywords: [
      "select", "from", "where", "insert", "into", "values", "update", "set", "delete", "create",
      "table", "alter", "drop", "join", "left", "right", "inner", "outer", "on", "group", "by",
      "order", "having", "limit", "offset", "distinct", "as", "and", "or", "not", "null", "is",
      "in", "like", "between", "exists", "union", "all", "case", "when", "then", "else", "end",
      "asc", "desc", "primary", "key", "foreign", "references", "index", "default", "returning",
    ],
    types: ["int", "integer", "text", "varchar", "boolean", "date", "timestamp", "numeric", "serial", "uuid"],
    caseInsensitive: true,
  },
  json: {
    lineComment: ["//"],
    strings: ['"'],
    keywords: ["true", "false", "null"],
    types: [],
  },
  css: {
    lineComment: [],
    blockComment: ["/*", "*/"],
    strings: ['"', "'"],
    keywords: ["important", "media", "supports", "keyframes", "from", "to", "import", "root"],
    types: [],
  },
  html: {
    lineComment: [],
    blockComment: ["<!--", "-->"],
    strings: ['"', "'"],
    keywords: [],
    types: [],
  },
  text: { lineComment: [], strings: [], keywords: [] },
};

const escapeHtml = (text: string) =>
  text.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

const CLASS: Record<TokenType, string> = {
  plain: "",
  comment: "tok-comment",
  string: "tok-string",
  number: "tok-number",
  keyword: "tok-keyword",
  type: "tok-type",
  function: "tok-function",
  operator: "tok-operator",
  tag: "tok-tag",
  attr: "tok-attr",
  property: "tok-property",
  selector: "tok-selector",
  punct: "tok-punct",
};

const isDigit = (char: string) => char >= "0" && char <= "9";
const isIdentStart = (char: string) => /[A-Za-z_$]/.test(char);
const isIdent = (char: string) => /[A-Za-z0-9_$]/.test(char);

/** HTML/XML: tags, attribute names, strings and comments. */
function tokenizeMarkup(code: string): string {
  let out = "";
  let index = 0;
  while (index < code.length) {
    if (code.startsWith("<!--", index)) {
      const end = code.indexOf("-->", index);
      const stop = end === -1 ? code.length : end + 3;
      out += `<span class="${CLASS.comment}">${escapeHtml(code.slice(index, stop))}</span>`;
      index = stop;
      continue;
    }
    if (code[index] === "<") {
      const match = /^<\/?([a-zA-Z][\w:-]*)/.exec(code.slice(index));
      if (match) {
        out += `<span class="${CLASS.punct}">${escapeHtml(code[index] + (code[index + 1] === "/" ? "/" : ""))}</span>`;
        out += `<span class="${CLASS.tag}">${escapeHtml(match[1])}</span>`;
        index += match[0].length;
        // attributes until the closing > of this tag
        while (index < code.length && code[index] !== ">") {
          if (code[index] === '"' || code[index] === "'") {
            const quote = code[index];
            let cursor = index + 1;
            while (cursor < code.length && code[cursor] !== quote) cursor += 1;
            out += `<span class="${CLASS.string}">${escapeHtml(code.slice(index, cursor + 1))}</span>`;
            index = cursor + 1;
            continue;
          }
          const attribute = /^[a-zA-Z_:][\w:.-]*/.exec(code.slice(index));
          if (attribute) {
            out += `<span class="${CLASS.attr}">${escapeHtml(attribute[0])}</span>`;
            index += attribute[0].length;
            continue;
          }
          out += escapeHtml(code[index]);
          index += 1;
        }
        continue;
      }
    }
    out += escapeHtml(code[index]);
    index += 1;
  }
  return out;
}

/** CSS: selectors, property names, values. */
function tokenizeCss(code: string): string {
  let out = "";
  let index = 0;
  let inBlock = false;
  while (index < code.length) {
    if (code.startsWith("/*", index)) {
      const end = code.indexOf("*/", index);
      const stop = end === -1 ? code.length : end + 2;
      out += `<span class="${CLASS.comment}">${escapeHtml(code.slice(index, stop))}</span>`;
      index = stop;
      continue;
    }
    if (code[index] === '"' || code[index] === "'") {
      const quote = code[index];
      let cursor = index + 1;
      while (cursor < code.length && code[cursor] !== quote) cursor += code[cursor] === "\\" ? 2 : 1;
      out += `<span class="${CLASS.string}">${escapeHtml(code.slice(index, cursor + 1))}</span>`;
      index = cursor + 1;
      continue;
    }
    if (code[index] === "{") {
      inBlock = true;
      out += `<span class="${CLASS.punct}">{</span>`;
      index += 1;
      continue;
    }
    if (code[index] === "}") {
      inBlock = false;
      out += `<span class="${CLASS.punct}">}</span>`;
      index += 1;
      continue;
    }
    if (inBlock) {
      const property = /^[-a-zA-Z]+(?=\s*:)/.exec(code.slice(index));
      if (property) {
        out += `<span class="${CLASS.property}">${escapeHtml(property[0])}</span>`;
        index += property[0].length;
        continue;
      }
      const number = /^-?[\d.]+(px|em|rem|%|vh|vw|s|ms|fr|pt|ch|deg)?/.exec(code.slice(index));
      if (number && number[1] !== undefined) {
        out += `<span class="${CLASS.number}">${escapeHtml(number[0])}</span>`;
        index += number[0].length;
        continue;
      }
      if (code.startsWith("!important", index)) {
        out += `<span class="${CLASS.keyword}">!important</span>`;
        index += 10;
        continue;
      }
    } else {
      const selector = /^[.#]?[a-zA-Z][\w-]*/.exec(code.slice(index));
      if (selector) {
        out += `<span class="${CLASS.selector}">${escapeHtml(selector[0])}</span>`;
        index += selector[0].length;
        continue;
      }
      if (code[index] === "@") {
        const atRule = /^@[\w-]+/.exec(code.slice(index));
        if (atRule) {
          out += `<span class="${CLASS.keyword}">${escapeHtml(atRule[0])}</span>`;
          index += atRule[0].length;
          continue;
        }
      }
    }
    out += escapeHtml(code[index]);
    index += 1;
  }
  return out;
}

/** Everything else: one pass, longest-match first. */
function tokenizeCode(code: string, grammar: Grammar): string {
  const keywords = new Set(grammar.keywords.map((word) => (grammar.caseInsensitive ? word.toLowerCase() : word)));
  const types = new Set((grammar.types ?? []).map((word) => (grammar.caseInsensitive ? word.toLowerCase() : word)));
  const strings = [...grammar.strings].sort((a, b) => b.length - a.length);

  let out = "";
  let index = 0;

  const push = (type: TokenType, text: string) => {
    const className = CLASS[type];
    out += className ? `<span class="${className}">${escapeHtml(text)}</span>` : escapeHtml(text);
  };

  while (index < code.length) {
    const rest = code.slice(index);

    if (grammar.blockComment) {
      const [open, close] = grammar.blockComment;
      if (rest.startsWith(open)) {
        const end = code.indexOf(close, index + open.length);
        const stop = end === -1 ? code.length : end + close.length;
        push("comment", code.slice(index, stop));
        index = stop;
        continue;
      }
    }

    const lineToken = grammar.lineComment.find((token) => rest.startsWith(token));
    if (lineToken) {
      const end = code.indexOf("\n", index);
      const stop = end === -1 ? code.length : end;
      push("comment", code.slice(index, stop));
      index = stop;
      continue;
    }

    const quote = strings.find((token) => rest.startsWith(token));
    if (quote) {
      let cursor = index + quote.length;
      while (cursor < code.length) {
        if (code[cursor] === "\\") {
          cursor += 2;
          continue;
        }
        if (code.startsWith(quote, cursor)) {
          cursor += quote.length;
          break;
        }
        if (quote.length === 1 && code[cursor] === "\n") break;
        cursor += 1;
      }
      push("string", code.slice(index, Math.min(cursor, code.length)));
      index = Math.min(cursor, code.length);
      continue;
    }

    if (isDigit(code[index])) {
      const number = /^(0[xXbBoO][\da-fA-F_]+|\d[\d_]*(\.\d+)?([eE][+-]?\d+)?)[a-zA-Z]*/.exec(rest);
      const text = number?.[0] ?? code[index];
      push("number", text);
      index += text.length;
      continue;
    }

    if (isIdentStart(code[index])) {
      let cursor = index;
      while (cursor < code.length && isIdent(code[cursor])) cursor += 1;
      const word = code.slice(index, cursor);
      const key = grammar.caseInsensitive ? word.toLowerCase() : word;
      let type: TokenType = "plain";
      if (keywords.has(key)) type = "keyword";
      else if (types.has(key)) type = "type";
      else {
        // a name used as a call, or a Capitalised name, reads as a function/type
        const ahead = code.slice(cursor).match(/^\s*\(/);
        if (ahead) type = "function";
        else if (/^[A-Z]/.test(word) && word.length > 1) type = "type";
      }
      push(type, word);
      index = cursor;
      continue;
    }

    if (/[+\-*/%=<>!&|^~?:]/.test(code[index])) {
      const operator = /^[+\-*/%=<>!&|^~?:]+/.exec(rest)?.[0] ?? code[index];
      push("operator", operator);
      index += operator.length;
      continue;
    }

    if (/[{}()[\];,.]/.test(code[index])) {
      push("punct", code[index]);
      index += 1;
      continue;
    }

    out += escapeHtml(code[index]);
    index += 1;
  }
  return out;
}

/** Returns HTML with coloured spans. `code` is escaped, never injected raw. */
export function highlight(code: string, language: string): string {
  const grammar = GRAMMARS[language] ?? GRAMMARS.text;
  if (language === "html") return tokenizeMarkup(code);
  if (language === "css") return tokenizeCss(code);
  return tokenizeCode(code, grammar);
}
