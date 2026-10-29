/**
 * The rule book.
 *
 * Every rule is a plain function over text — no network, no model, no compiler.
 * A rule can be checked (find issues) and, when it is safe, fixed (rewrite the text).
 * "Safe" means the fix cannot change behaviour: whitespace, `==` → `===`, `var` →
 * `let`, `except:` → `except Exception:`. Anything that needs judgement is reported
 * with a hint and left alone.
 */

import { delimiterProblems, indentProfile, lineOf, replaceAt, splitLines } from "./syntax.mjs";

const JS_TS = ["javascript", "typescript"];
const C_FAMILY = ["c", "cpp"];

const matches = (masked, pattern) => {
  const found = [];
  const regex = new RegExp(pattern.source, pattern.flags.includes("g") ? pattern.flags : `${pattern.flags}g`);
  let match;
  while ((match = regex.exec(masked)) !== null) found.push(match);
  return found;
};

const codeLines = (ctx) => splitLines(ctx.masked);

const TODO = /\b(TODO|FIXME|XXX|HACK)\b/;

/* ------------------------------------------------------------------ common */

const commonRules = [
  {
    id: "conflict-markers",
    severity: "error",
    title: "Merge conflict left in the file",
    hint: "Resolve the conflict: keep the version you want and delete the <<<<<<< / ======= / >>>>>>> lines.",
    langs: "*",
    check(ctx) {
      return matches(ctx.masked, /^(<{7}|={7}|>{7}).*$/m).map((match) => ({
        line: lineOf(ctx.masked, match.index),
        message: "Leftover merge conflict marker.",
      }));
    },
  },
  {
    id: "unterminated-string",
    severity: "error",
    title: "String never closed",
    hint: "Add the missing quote — everything after this point is currently swallowed.",
    langs: (language) => language.stringQuotes.length > 0,
    check(ctx) {
      if (!ctx.syntax.unterminated) return [];
      return [{ line: ctx.syntax.unterminated.line, message: `A ${ctx.syntax.unterminated.quote} string is never closed.` }];
    },
  },
  {
    id: "unbalanced-delimiters",
    severity: "error",
    title: "Brackets do not match",
    hint: "Each ( [ { needs its closing partner. This is the first thing to fix.",
    langs: "*",
    check(ctx) {
      return delimiterProblems(ctx.masked).slice(0, 6).map((problem) => {
        if (problem.kind === "unclosed") {
          return { line: problem.line, message: `“${problem.char}” is never closed.` };
        }
        if (problem.kind === "mismatch") {
          return { line: problem.line, message: `“${problem.char}” closes a “${problem.expected}” opened on line ${problem.openedLine}.` };
        }
        return { line: problem.line, message: `“${problem.char}” closes something that was never opened.` };
      });
    },
  },
  {
    id: "crlf",
    severity: "info",
    title: "Windows line endings",
    hint: "Saved with CRLF. Harmless, but git diffs and shells are happier with LF.",
    langs: "*",
    fixable: true,
    check(ctx) {
      return ctx.code.includes("\r\n") ? [{ line: 1, message: "File uses CRLF line endings." }] : [];
    },
    fix(code) {
      return code.includes("\r\n") ? code.replace(/\r\n/g, "\n") : null;
    },
  },
  {
    id: "trailing-whitespace",
    severity: "info",
    title: "Trailing spaces",
    hint: "Invisible spaces at the end of a line create noisy diffs.",
    langs: "*",
    fixable: true,
    check(ctx) {
      const issues = [];
      splitLines(ctx.code).forEach((line, index) => {
        if (/[ \t]+$/.test(line)) issues.push({ line: index + 1, message: `${line.length - line.trimEnd().length} trailing space(s).` });
      });
      return issues.slice(0, 20);
    },
    fix(code) {
      const next = code.replace(/[ \t]+$/gm, "");
      return next === code ? null : next;
    },
  },
  {
    id: "final-newline",
    severity: "info",
    title: "No newline at end of file",
    hint: "POSIX tools and git both prefer a final newline.",
    langs: "*",
    fixable: true,
    check(ctx) {
      return ctx.code.length > 0 && !ctx.code.endsWith("\n") ? [{ line: splitLines(ctx.code).length, message: "Last line has no newline." }] : [];
    },
    fix(code) {
      return code.length && !code.endsWith("\n") ? `${code.replace(/\n+$/, "")}\n` : null;
    },
  },
  {
    id: "mixed-indentation",
    severity: "warn",
    title: "Tabs and spaces mixed",
    hint: "Pick one. Python raises IndentationError, and every diff tool gets confused.",
    langs: (language) => language.id !== "html" && language.id !== "text",
    fixable: true,
    check(ctx) {
      const profile = indentProfile(splitLines(ctx.code));
      const issues = [];
      if (profile.mixed) issues.push({ line: 1, message: `${profile.mixed} line(s) mix tabs and spaces.` });
      if (ctx.language.indent === "tabs" && profile.spaced) {
        issues.push({ line: 1, message: `${profile.spaced} line(s) use spaces where gofmt uses tabs.` });
      }
      if (ctx.language.indent === "spaces" && profile.tabbed) {
        issues.push({ line: 1, message: `${profile.tabbed} line(s) are indented with tabs.` });
      }
      return issues;
    },
    fix(code, ctx) {
      const width = ctx.language.indentWidth || 4;
      const useTabs = ctx.language.indent === "tabs";
      const next = splitLines(code)
        .map((line) => {
          const leading = line.match(/^[ \t]+/)?.[0];
          if (!leading) return line;
          const depth = leading.replace(/\t/g, " ".repeat(width)).length;
          const indent = useTabs ? "\t".repeat(Math.round(depth / width)) : " ".repeat(depth);
          return indent + line.slice(leading.length);
        })
        .join("\n");
      return next === code ? null : next;
    },
  },
  {
    id: "long-line",
    severity: "info",
    title: "Very long line",
    hint: "Over 140 characters is hard to read on a laptop screen; wrap it.",
    langs: "*",
    check(ctx) {
      const issues = [];
      splitLines(ctx.code).forEach((line, index) => {
        if (line.length > 140) issues.push({ line: index + 1, message: `${line.length} characters.` });
      });
      return issues.slice(0, 8);
    },
  },
  {
    id: "todo-comment",
    severity: "info",
    title: "Leftover TODO",
    hint: "Fine to keep — just know it shipped.",
    langs: "*",
    check(ctx) {
      const issues = [];
      codeLines(ctx).forEach((line, index) => {
        if (TODO.test(line)) issues.push({ line: index + 1, message: "TODO / FIXME marker." });
      });
      return issues.slice(0, 10);
    },
  },
];

/* ------------------------------------------------------------------ python */

const pythonRules = [
  {
    id: "py-none-compare",
    severity: "warn",
    title: "Compare to None with is",
    hint: "`is None` is the correct, faster test; `== None` can be overloaded by a class.",
    langs: ["python"],
    fixable: true,
    check(ctx) {
      return matches(ctx.masked, /(==|!=)\s*None\b/).map((match) => ({
        line: lineOf(ctx.masked, match.index),
        message: `Use “${match[1] === "==" ? "is" : "is not"} None”.`,
      }));
    },
    fix(code, ctx) {
      const edits = matches(ctx.masked, /(==|!=)\s*None\b/).map((match) => ({
        start: match.index,
        end: match.index + match[0].length,
        text: match[1] === "==" ? "is None" : "is not None",
      }));
      return edits.length ? replaceAt(code, edits) : null;
    },
  },
  {
    id: "py-bare-except",
    severity: "warn",
    title: "Bare except",
    hint: "`except:` swallows KeyboardInterrupt and typos. Catch Exception instead.",
    langs: ["python"],
    fixable: true,
    check(ctx) {
      return matches(ctx.masked, /^([ \t]*)except\s*:/gm).map((match) => ({
        line: lineOf(ctx.masked, match.index),
        message: "Bare `except:` catches everything.",
      }));
    },
    fix(code, ctx) {
      const edits = matches(ctx.masked, /^([ \t]*)except\s*:/gm).map((match) => ({
        start: match.index,
        end: match.index + match[0].length,
        text: `${match[1]}except Exception:`,
      }));
      return edits.length ? replaceAt(code, edits) : null;
    },
  },
  {
    id: "py-is-literal",
    severity: "warn",
    title: "`is` compared with a literal",
    hint: "`is` tests identity. Use `==` for strings, numbers and True/False.",
    langs: ["python"],
    fixable: true,
    check(ctx) {
      return matches(ctx.masked, /\bis\s+(not\s+)?(?=\s*("|'|\d|True\b|False\b))/).map((match) => ({
        line: lineOf(ctx.masked, match.index),
        message: "Identity check against a literal.",
      }));
    },
    fix(code, ctx) {
      const edits = matches(ctx.masked, /\bis(\s+not)?\s+(?="|'|\d|True\b|False\b)/g).map((match) => ({
        start: match.index,
        end: match.index + match[0].length,
        text: match[1] ? " != " : " == ",
      }));
      return edits.length ? replaceAt(code, edits) : null;
    },
  },
  {
    id: "py-mutable-default",
    severity: "warn",
    title: "Mutable default argument",
    hint: "A list/dict default is created once and shared by every call. Use None and build inside.",
    langs: ["python"],
    check(ctx) {
      return matches(ctx.masked, /def\s+\w+\s*\([^)]*=\s*(\[\]|\{\}|set\(\))/).map((match) => ({
        line: lineOf(ctx.masked, match.index),
        message: "Default value is mutable and shared across calls.",
      }));
    },
  },
  {
    id: "py-import-star",
    severity: "warn",
    title: "Wildcard import",
    hint: "`from x import *` hides where names come from and can overwrite yours.",
    langs: ["python"],
    check(ctx) {
      return matches(ctx.masked, /^\s*from\s+[\w.]+\s+import\s+\*/gm).map((match) => ({
        line: lineOf(ctx.masked, match.index),
        message: "Wildcard import.",
      }));
    },
  },
  {
    id: "py-unused-import",
    severity: "info",
    title: "Unused import",
    hint: "Imported but never used in this file.",
    langs: ["python"],
    check(ctx) {
      const issues = [];
      const pattern = /^\s*(?:from\s+[\w.]+\s+)?import\s+([\w,\s*]+)$/gm;
      let match;
      while ((match = pattern.exec(ctx.masked)) !== null) {
        const names = match[1]
          .split(",")
          .map((name) => name.trim().split(/\s+as\s+/).pop())
          .filter((name) => name && name !== "*");
        for (const name of names) {
          const used = new RegExp(`\\b${name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\b`, "g");
          const occurrences = (ctx.masked.match(used) ?? []).length;
          if (occurrences <= 1) issues.push({ line: lineOf(ctx.masked, match.index), message: `“${name}” is imported but never used.` });
        }
      }
      return issues.slice(0, 8);
    },
  },
  {
    id: "py-range-len",
    severity: "info",
    title: "range(len(...))",
    hint: "Prefer `for item in items:`. Use enumerate() when you need the index.",
    langs: ["python"],
    check(ctx) {
      return matches(ctx.masked, /range\s*\(\s*len\s*\(/).map((match) => ({
        line: lineOf(ctx.masked, match.index),
        message: "Iterate the sequence directly instead.",
      }));
    },
  },
  {
    id: "py-indent-width",
    severity: "info",
    title: "Odd indentation",
    hint: "Python reads indentation; keep it to a clean multiple of four.",
    langs: ["python"],
    check(ctx) {
      const issues = [];
      splitLines(ctx.code).forEach((line, index) => {
        const leading = line.match(/^ +/)?.[0];
        if (leading && leading.length % 4 !== 0) issues.push({ line: index + 1, message: `${leading.length} spaces of indent.` });
      });
      return issues.slice(0, 6);
    },
  },
];

/* ------------------------------------------------------------ js / ts / jsx */

const jsRules = [
  {
    id: "js-loose-equality",
    severity: "warn",
    title: "Loose equality",
    hint: "`==` converts types (`'' == 0` is true). Use `===` / `!==`.",
    langs: JS_TS,
    fixable: true,
    check(ctx) {
      return matches(ctx.masked, /(^|[^=!<>])([=!]=)(?![=>])(?!\s*(null|undefined)\b)/g).map((match) => ({
        line: lineOf(ctx.masked, match.index),
        message: `Use “${match[2]}==”.`,
      }));
    },
    fix(code, ctx) {
      const edits = matches(ctx.masked, /(^|[^=!<>])([=!]=)(?![=>])(?!\s*(null|undefined)\b)/g).map((match) => {
        const offset = match.index + match[1].length;
        return { start: offset, end: offset + 2, text: match[2] === "==" ? "===" : "!==" };
      });
      return edits.length ? replaceAt(code, edits) : null;
    },
  },
  {
    id: "js-var",
    severity: "info",
    title: "`var` in modern code",
    hint: "`var` leaks out of blocks. Prefer `const`, or `let` when it must change.",
    langs: JS_TS,
    fixable: true,
    check(ctx) {
      return matches(ctx.masked, /\bvar\s+\w/).map((match) => ({
        line: lineOf(ctx.masked, match.index),
        message: "Declared with var.",
      }));
    },
    fix(code, ctx) {
      const edits = matches(ctx.masked, /\bvar(\s+\w)/g).map((match) => ({
        start: match.index,
        end: match.index + 3,
        text: "let",
      }));
      return edits.length ? replaceAt(code, edits) : null;
    },
  },
  {
    id: "js-debugger",
    severity: "warn",
    title: "`debugger` left in",
    hint: "This pauses the browser for whoever opens the page.",
    langs: JS_TS,
    fixable: true,
    check(ctx) {
      return matches(ctx.masked, /\bdebugger\b/).map((match) => ({
        line: lineOf(ctx.masked, match.index),
        message: "Debugger statement.",
      }));
    },
    fix(code, ctx) {
      const lines = splitLines(code);
      const maskedLines = splitLines(ctx.masked);
      const next = lines.filter((_line, index) => !/^\s*debugger\s*;?\s*$/.test(maskedLines[index] ?? "")).join("\n");
      return next === code ? null : next;
    },
  },
  {
    id: "js-eval",
    severity: "error",
    title: "eval / new Function",
    hint: "Runs arbitrary text as code — a classic remote-code-execution hole.",
    langs: JS_TS,
    check(ctx) {
      return matches(ctx.masked, /\b(eval\s*\(|new\s+Function\s*\()/).map((match) => ({
        line: lineOf(ctx.masked, match.index),
        message: "Dynamic code execution.",
      }));
    },
  },
  {
    id: "js-console",
    severity: "info",
    title: "Console output left in",
    hint: "Fine while debugging; remove before shipping.",
    langs: JS_TS,
    check(ctx) {
      return matches(ctx.masked, /\bconsole\.(log|debug|info|dir)\s*\(/).map((match) => ({
        line: lineOf(ctx.masked, match.index),
        message: "console call.",
      }));
    },
  },
  {
    id: "js-unused-import",
    severity: "info",
    title: "Unused import",
    hint: "Remove it — bundlers keep the tree but readers pay the cost.",
    langs: JS_TS,
    check(ctx) {
      const issues = [];
      const pattern = /^\s*import\s+(?:([\w*\s{},]+?)\s+from\s+)?["'][^"']+["'];?/gm;
      let match;
      while ((match = pattern.exec(ctx.masked)) !== null) {
        const names = (match[1] ?? "")
          .replace(/[{}]/g, " ")
          .split(",")
          .map((name) => name.trim().split(/\s+as\s+/).pop())
          .filter((name) => name && name !== "*" && !name.startsWith("type "));
        for (const name of names) {
          const used = new RegExp(`\\b${name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\b`, "g");
          if ((ctx.masked.match(used) ?? []).length <= 1) {
            issues.push({ line: lineOf(ctx.masked, match.index), message: `“${name}” is imported but never used.` });
          }
        }
      }
      return issues.slice(0, 8);
    },
  },
  {
    id: "ts-any",
    severity: "info",
    title: "`any` type",
    hint: "`any` turns TypeScript off for that value. Use `unknown` and narrow it.",
    langs: ["typescript"],
    check(ctx) {
      return matches(ctx.masked, /:\s*any\b/).map((match) => ({
        line: lineOf(ctx.masked, match.index),
        message: "Type escapes the checker.",
      }));
    },
  },
];

/* ---------------------------------------------------------------- c family */

const cRules = [
  {
    id: "c-gets",
    severity: "error",
    title: "gets() is unsafe",
    hint: "gets() cannot know the buffer size and was removed from C11. Use fgets(buffer, size, stdin).",
    langs: C_FAMILY,
    check(ctx) {
      return matches(ctx.masked, /\bgets\s*\(/).map((match) => ({ line: lineOf(ctx.masked, match.index), message: "Unbounded read into a buffer." }));
    },
  },
  {
    id: "c-strcpy",
    severity: "warn",
    title: "Unbounded string copy",
    hint: "strcpy/sprintf can overflow. Prefer strncpy/snprintf with an explicit size.",
    langs: C_FAMILY,
    check(ctx) {
      return matches(ctx.masked, /\b(strcpy|strcat|sprintf|vsprintf)\s*\(/).map((match) => ({
        line: lineOf(ctx.masked, match.index),
        message: `${match[1]}() has no length limit.`,
      }));
    },
  },
  {
    id: "c-missing-include",
    severity: "warn",
    title: "Missing include",
    hint: "The function is used but its header is never included — this will not compile.",
    langs: ["c"],
    check(ctx) {
      const issues = [];
      const pairs = [
        [/\b(printf|scanf|fopen|fgets|puts|gets)\s*\(/, "stdio.h"],
        [/\b(malloc|calloc|realloc|free|exit|atoi)\s*\(/, "stdlib.h"],
        [/\b(strlen|strcpy|strcmp|strncpy|memset|memcpy)\s*\(/, "string.h"],
      ];
      for (const [pattern, header] of pairs) {
        if (pattern.test(ctx.masked) && !new RegExp(`#\\s*include\\s*[<"]${header.replace(".", "\\.")}[>"]`).test(ctx.masked)) {
          issues.push({ line: 1, message: `“${header}” is not included.` });
        }
      }
      return issues;
    },
  },
  {
    id: "cpp-using-namespace",
    severity: "info",
    title: "using namespace std",
    hint: "In a header this leaks into every file that includes it. Prefer std:: explicitly.",
    langs: ["cpp"],
    check(ctx) {
      return matches(ctx.masked, /using\s+namespace\s+std\s*;/).map((match) => ({
        line: lineOf(ctx.masked, match.index),
        message: "Whole namespace pulled in.",
      }));
    },
  },
  {
    id: "cpp-missing-include",
    severity: "warn",
    title: "Missing include",
    hint: "cout / endl need <iostream>.",
    langs: ["cpp"],
    check(ctx) {
      if (!/\b(cout|cin|cerr)\b/.test(ctx.masked)) return [];
      if (/#\s*include\s*<iostream>/.test(ctx.masked)) return [];
      return [{ line: 1, message: "<iostream> is not included." }];
    },
  },
];

/* ------------------------------------------------------------ jvm / dotnet */

const managedRules = [
  {
    id: "java-string-equality",
    severity: "warn",
    title: "String compared with ==",
    hint: "In Java, == compares references. Use a.equals(b) or Objects.equals(a, b).",
    langs: ["java"],
    check(ctx) {
      // Strings are blanked in the masked copy, so find the operator there and
      // confirm against the real text that a literal follows it.
      return matches(ctx.masked, /\b\w+\s*[!=]=/g)
        .filter((match) => /^\s*"/.test(ctx.code.slice(match.index + match[0].length)))
        .map((match) => ({
          line: lineOf(ctx.masked, match.index),
          message: "Reference comparison on a string — use .equals().",
        }));
    },
  },
  {
    id: "java-system-out",
    severity: "info",
    title: "System.out.println left in",
    hint: "Use a logger (java.util.logging / SLF4J) so output can be switched off.",
    langs: ["java"],
    check(ctx) {
      return matches(ctx.masked, /System\.(out|err)\.print/).map((match) => ({
        line: lineOf(ctx.masked, match.index),
        message: "Console print in application code.",
      }));
    },
  },
  {
    id: "empty-catch",
    severity: "warn",
    title: "Empty catch block",
    hint: "Swallowing an exception hides real failures. Log it or handle it.",
    langs: ["java", "csharp", "cpp"],
    check(ctx) {
      return matches(ctx.masked, /catch\s*\([^)]*\)\s*\{\s*\}/).map((match) => ({
        line: lineOf(ctx.masked, match.index),
        message: "Exception is caught and ignored.",
      }));
    },
  },
  {
    id: "cs-console",
    severity: "info",
    title: "Console output left in",
    hint: "Use ILogger so the output can be routed and filtered.",
    langs: ["csharp"],
    check(ctx) {
      return matches(ctx.masked, /Console\.(Write|WriteLine)/).map((match) => ({
        line: lineOf(ctx.masked, match.index),
        message: "Console write in application code.",
      }));
    },
  },
];

/* -------------------------------------------------------------- rust / go */

const systemsRules = [
  {
    id: "rust-unwrap",
    severity: "warn",
    title: "unwrap() can panic",
    hint: "In library code prefer `?` and a real error type; unwrap aborts the process.",
    langs: ["rust"],
    check(ctx) {
      return matches(ctx.masked, /\.unwrap\s*\(\s*\)/).map((match) => ({
        line: lineOf(ctx.masked, match.index),
        message: "Panics instead of returning an error.",
      }));
    },
  },
  {
    id: "rust-unimplemented",
    severity: "warn",
    title: "Placeholder macro",
    hint: "todo!/unimplemented! panics at runtime — do not ship it.",
    langs: ["rust"],
    check(ctx) {
      return matches(ctx.masked, /\b(todo|unimplemented)\s*!\s*\(/).map((match) => ({
        line: lineOf(ctx.masked, match.index),
        message: `${match[1]}!() is still in the code.`,
      }));
    },
  },
  {
    id: "go-panic",
    severity: "warn",
    title: "panic in library code",
    hint: "Return an error instead; only main or an impossible state should panic.",
    langs: ["go"],
    check(ctx) {
      return matches(ctx.masked, /\bpanic\s*\(/).map((match) => ({ line: lineOf(ctx.masked, match.index), message: "panic() call." }));
    },
  },
  {
    id: "go-fmt-print",
    severity: "info",
    title: "Print debugging",
    hint: "fmt.Println left in; use a logger.",
    langs: ["go"],
    check(ctx) {
      return matches(ctx.masked, /\bfmt\.Print(f|ln)?\s*\(/).map((match) => ({
        line: lineOf(ctx.masked, match.index),
        message: "fmt print.",
      }));
    },
  },
];

/* ------------------------------------------------------------ ruby / swift */

const otherRules = [
  {
    id: "rb-nil-compare",
    severity: "info",
    title: "Compare to nil",
    hint: "`x.nil?` reads better than `x == nil`, and cannot be redefined by ==.",
    langs: ["ruby"],
    check(ctx) {
      return matches(ctx.masked, /==\s*nil\b/).map((match) => ({ line: lineOf(ctx.masked, match.index), message: "Use .nil? instead." }));
    },
  },
  {
    id: "rb-puts-debug",
    severity: "info",
    title: "puts debugging",
    hint: "Use a logger so output can be switched off in production.",
    langs: ["ruby"],
    check(ctx) {
      return matches(ctx.masked, /(^|[;\s])puts\b/).map((match) => ({
        line: lineOf(ctx.masked, match.index),
        message: "puts in application code.",
      }));
    },
  },
  {
    id: "swift-force-try",
    severity: "warn",
    title: "try! / as!",
    hint: "A failed force cast crashes the app. Use try?/as? with a guard.",
    langs: ["swift"],
    check(ctx) {
      return matches(ctx.masked, /\b(try|as)\s*!/).map((match) => ({
        line: lineOf(ctx.masked, match.index),
        message: `${match[1]}! crashes on failure.`,
      }));
    },
  },
  {
    id: "swift-print",
    severity: "info",
    title: "print left in",
    hint: "Use os.Logger so logs are filterable.",
    langs: ["swift"],
    check(ctx) {
      return matches(ctx.masked, /\bprint\s*\(/).map((match) => ({ line: lineOf(ctx.masked, match.index), message: "print() in application code." }));
    },
  },
];

/* ------------------------------------------------------------------- html */

const VOID_TAGS = new Set([
  "area", "base", "br", "col", "embed", "hr", "img", "input", "link", "meta", "param", "source", "track", "wbr", "!doctype",
]);

const htmlRules = [
  {
    id: "html-doctype",
    severity: "warn",
    title: "Missing <!DOCTYPE html>",
    hint: "Without it the browser renders in quirks mode.",
    langs: ["html"],
    fixable: true,
    check(ctx) {
      const head = ctx.code.slice(0, 400).toLowerCase();
      return head.includes("<html") && !head.includes("<!doctype") ? [{ line: 1, message: "No doctype before <html>." }] : [];
    },
    fix(code) {
      if (!/<html/i.test(code) || /<!doctype/i.test(code.slice(0, 400))) return null;
      return `<!DOCTYPE html>\n${code.replace(/^\s+/, "")}`;
    },
  },
  {
    id: "html-lang",
    severity: "info",
    title: "<html> has no lang",
    hint: "Screen readers pick a voice from lang; search engines use it too.",
    langs: ["html"],
    fixable: true,
    check(ctx) {
      const tag = ctx.code.match(/<html\b[^>]*>/i)?.[0];
      return tag && !/\blang\s*=/i.test(tag) ? [{ line: lineOf(ctx.code, ctx.code.indexOf(tag)), message: "<html> has no lang attribute." }] : [];
    },
    fix(code) {
      const tag = code.match(/<html\b[^>]*>/i)?.[0];
      if (!tag || /\blang\s*=/i.test(tag)) return null;
      return code.replace(tag, tag.replace(/<html/i, '<html lang="en"'));
    },
  },
  {
    id: "html-title",
    severity: "info",
    title: "No <title>",
    hint: "The tab label and search result title come from <title>.",
    langs: ["html"],
    check(ctx) {
      return /<head/i.test(ctx.code) && !/<title/i.test(ctx.code) ? [{ line: 1, message: "<head> without <title>." }] : [];
    },
  },
  {
    id: "html-img-alt",
    severity: "warn",
    title: "<img> without alt",
    hint: "Screen readers announce the alt text. Use alt=\"\" only for decoration.",
    langs: ["html"],
    check(ctx) {
      return matches(ctx.code, /<img\b[^>]*>/gi)
        .filter((match) => !/\balt\s*=/i.test(match[0]))
        .map((match) => ({ line: lineOf(ctx.code, match.index), message: "Image has no alt text." }));
    },
  },
  {
    id: "html-duplicate-id",
    severity: "warn",
    title: "Duplicate id",
    hint: "An id must be unique; getElementById only ever finds the first.",
    langs: ["html"],
    check(ctx) {
      const seen = new Map();
      const issues = [];
      for (const match of matches(ctx.code, /\bid\s*=\s*["']([^"']+)["']/gi)) {
        const id = match[1];
        if (seen.has(id)) issues.push({ line: lineOf(ctx.code, match.index), message: `id="${id}" is already used on line ${seen.get(id)}.` });
        else seen.set(id, lineOf(ctx.code, match.index));
      }
      return issues;
    },
  },
  {
    id: "html-unclosed-tag",
    severity: "warn",
    title: "Tag not closed",
    hint: "Every opened element needs its closing tag (or be self-closing).",
    langs: ["html"],
    check(ctx) {
      const stack = [];
      const issues = [];
      for (const match of matches(ctx.code, /<(\/?)([a-zA-Z][\w-]*)\b[^>]*?(\/?)>/g)) {
        const [, closing, rawName, selfClosing] = match;
        const name = rawName.toLowerCase();
        if (VOID_TAGS.has(name) || selfClosing === "/") continue;
        if (closing) {
          const top = stack.pop();
          if (!top) issues.push({ line: lineOf(ctx.code, match.index), message: `</${name}> has no opening tag.` });
          else if (top.name !== name) {
            issues.push({ line: lineOf(ctx.code, match.index), message: `</${name}> closes <${top.name}> opened on line ${top.line}.` });
          }
        } else {
          stack.push({ name, line: lineOf(ctx.code, match.index) });
        }
      }
      for (const leftover of stack.slice(-4)) {
        issues.push({ line: leftover.line, message: `<${leftover.name}> is never closed.` });
      }
      return issues.slice(0, 8);
    },
  },
  {
    id: "html-inline-style",
    severity: "info",
    title: "Inline style",
    hint: "Inline styles beat every stylesheet. Move them into a class.",
    langs: ["html"],
    check(ctx) {
      return matches(ctx.code, /\bstyle\s*=\s*["'][^"']+["']/i).map((match) => ({
        line: lineOf(ctx.code, match.index),
        message: "Inline style attribute.",
      }));
    },
  },
];

/* -------------------------------------------------------------------- css */

const cssRules = [
  {
    id: "css-important",
    severity: "warn",
    title: "!important",
    hint: "Usually a sign of a specificity fight. Fix the selector order instead.",
    langs: ["css"],
    check(ctx) {
      return matches(ctx.masked, /!\s*important/).map((match) => ({ line: lineOf(ctx.masked, match.index), message: "!important override." }));
    },
  },
  {
    id: "css-zero-unit",
    severity: "info",
    title: "Unit on zero",
    hint: "0 is 0 in every unit — the unit is just noise.",
    langs: ["css"],
    fixable: true,
    check(ctx) {
      return matches(ctx.masked, /(?<![\w.-])0(px|em|rem|vh|vw|pt|pc|ch)\b/).map((match) => ({
        line: lineOf(ctx.masked, match.index),
        message: `Write 0, not 0${match[1]}.`,
      }));
    },
    fix(code, ctx) {
      const edits = matches(ctx.masked, /(?<![\w.-])0(px|em|rem|vh|vw|pt|pc|ch)\b/g).map((match) => ({
        start: match.index,
        end: match.index + match[0].length,
        text: "0",
      }));
      return edits.length ? replaceAt(code, edits) : null;
    },
  },
  {
    id: "css-duplicate-property",
    severity: "info",
    title: "Property declared twice",
    hint: "The last one wins — usually a copy-paste accident.",
    langs: ["css"],
    check(ctx) {
      const issues = [];
      const blocks = matches(ctx.masked, /\{[^{}]*\}/g);
      for (const block of blocks) {
        const names = new Map();
        for (const declaration of matches(block[0], /([-\w]+)\s*:/g)) {
          const name = declaration[1].toLowerCase();
          if (names.has(name)) {
            issues.push({ line: lineOf(ctx.masked, block.index + declaration.index), message: `“${name}” is set twice in one rule.` });
          }
          names.set(name, true);
        }
      }
      return issues.slice(0, 8);
    },
  },
];

/* ------------------------------------------------------------- json / sql */

const dataRules = [
  {
    id: "json-parse",
    severity: "error",
    title: "Invalid JSON",
    hint: "Trailing commas and comments are not valid in .json files.",
    langs: ["json"],
    check(ctx) {
      try {
        JSON.parse(ctx.code);
        return [];
      } catch (error) {
        const position = /position (\d+)/.exec(String(error.message))?.[1];
        const index = position ? Number(position) : 0;
        return [{ line: lineOf(ctx.code, index), message: String(error.message).replace(/\s*in JSON at position \d+/, "") }];
      }
    },
  },
  {
    id: "sql-delete-without-where",
    severity: "error",
    title: "DELETE without WHERE",
    hint: "This empties the table. Add a WHERE clause — or be very sure.",
    langs: ["sql"],
    check(ctx) {
      return matches(ctx.masked, /\bdelete\s+from\s+[\w."`]+\s*(?!where\b)[;)]?/gi)
        .filter((match) => !/\bwhere\b/i.test(match[0]))
        .map((match) => ({ line: lineOf(ctx.masked, match.index), message: "Every row will be deleted." }));
    },
  },
  {
    id: "sql-update-without-where",
    severity: "warn",
    title: "UPDATE without WHERE",
    hint: "Every row gets the new value.",
    langs: ["sql"],
    check(ctx) {
      return matches(ctx.masked, /\bupdate\s+[\w."`]+\s+set\b[^;]*/gi)
        .filter((match) => !/\bwhere\b/i.test(match[0]))
        .map((match) => ({ line: lineOf(ctx.masked, match.index), message: "Updates every row." }));
    },
  },
  {
    id: "sql-select-star",
    severity: "info",
    title: "SELECT *",
    hint: "Name the columns — it survives schema changes and transfers less data.",
    langs: ["sql"],
    check(ctx) {
      return matches(ctx.masked, /\bselect\s+\*/gi).map((match) => ({ line: lineOf(ctx.masked, match.index), message: "Selects every column." }));
    },
  },
];

const RULES = [
  ...commonRules,
  ...pythonRules,
  ...jsRules,
  ...cRules,
  ...managedRules,
  ...systemsRules,
  ...otherRules,
  ...htmlRules,
  ...cssRules,
  ...dataRules,
];

export function rulesFor(language) {
  return RULES.filter((rule) => {
    if (rule.langs === "*") return true;
    if (typeof rule.langs === "function") return rule.langs(language);
    return rule.langs.includes(language.id);
  });
}

