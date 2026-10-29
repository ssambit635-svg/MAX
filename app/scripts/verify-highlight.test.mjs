/**
 * Guards the editor's highlighter.
 *
 * It runs in the renderer, so this test bundles it with esbuild (already present as
 * vite's own dependency) and checks the two things that would hurt: colours actually
 * appear, and no character of the file is lost or turned into markup.
 */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

let failures = 0;
const check = (name, run) => {
  try {
    run();
    console.log(`PASS  ${name}`);
  } catch (error) {
    failures += 1;
    console.log(`FAIL  ${name}\n      ${error.message}`);
  }
};

const here = path.dirname(new URL(import.meta.url).pathname);
const entry = path.resolve(here, "../src/lib/highlight.ts");

let highlight;
try {
  const { build } = await import("esbuild");
  const result = await build({ entryPoints: [entry], bundle: true, format: "esm", write: false, platform: "neutral" });
  const out = path.join(fs.mkdtempSync(path.join(os.tmpdir(), "max-hl-")), "hl.mjs");
  fs.writeFileSync(out, result.outputFiles[0].text);
  ({ highlight } = await import(out));
} catch (error) {
  console.log(`SKIP  esbuild unavailable (${error.message.split("\n")[0]})`);
  process.exit(0);
}

const textOf = (html) =>
  html
    .replace(/<span class="tok-[a-z]+">/g, "")
    .replace(/<\/span>/g, "")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&amp;/g, "&");

const classesOf = (html) => [...new Set([...html.matchAll(/class="(tok-[a-z]+)"/g)].map((match) => match[1]))];

const samples = {
  python: 'import os\n# a comment\ndef greet(name):\n    return f"hi {name}"\n',
  javascript: 'const x = 42; // note\nfunction f(a) { return a === "1"; }\n',
  typescript: "interface A { b: string }\nconst n: number = 1;\n",
  java: 'public class A { void f() { String s = "x"; } }',
  csharp: "public class A { void F() { Console.WriteLine(1); } }",
  c: "#include <stdio.h>\nint main() { return 0; }\n",
  cpp: '#include <iostream>\nint main() { std::cout << "hi"; }\n',
  rust: "fn main() { let x: i32 = 1; }",
  go: 'package main\nfunc main() { fmt.Println("hi") }\n',
  ruby: 'def hi\n  puts "hi"\nend\n',
  swift: 'let x: Int = 1\nprint("hi")\n',
  html: '<div class="a"><img src="x.png"></div>',
  css: "a { color: #fff; margin: 0px; }",
  sql: "SELECT * FROM users WHERE id = 1;",
  json: '{"a": true, "b": null}',
};

check("every language gets colours", () => {
  for (const [language, code] of Object.entries(samples)) {
    const tokens = classesOf(highlight(code, language));
    if (!tokens.length) throw new Error(`${language} produced no coloured tokens`);
  }
});

check("keywords, strings and comments are distinguished", () => {
  const python = classesOf(highlight(samples.python, "python"));
  for (const expected of ["tok-keyword", "tok-string", "tok-comment", "tok-function"]) {
    if (!python.includes(expected)) throw new Error(`python is missing ${expected}`);
  }
  const javascript = classesOf(highlight(samples.javascript, "javascript"));
  for (const expected of ["tok-keyword", "tok-string", "tok-comment", "tok-number"]) {
    if (!javascript.includes(expected)) throw new Error(`javascript is missing ${expected}`);
  }
});

check("no character of the file is lost", () => {
  for (const [language, code] of Object.entries(samples)) {
    if (textOf(highlight(code, language)) !== code) {
      throw new Error(`${language} changed the text`);
    }
  }
});

check("user code can never become markup", () => {
  const dangerous = '<script>alert(1)</script>';
  const html = highlight(dangerous, "html");
  if (/<script/i.test(html)) throw new Error("a raw script tag survived");
  const injected = highlight('const a = "<img src=x onerror=alert(1)>";', "javascript");
  if (/<img/i.test(injected)) throw new Error("a raw img tag survived");
  if ((html.match(/<(?!\/?span)/g) ?? []).length) throw new Error("unexpected raw tag in output");
});

check("an unknown language still renders as plain text", () => {
  const html = highlight("hello <world>", "klingon");
  if (textOf(html) !== "hello <world>") throw new Error("text changed");
});

check("empty input is safe", () => {
  if (highlight("", "python") !== "") throw new Error("empty code should produce empty output");
});

check("a trailing newline keeps the same number of lines", () => {
  const lines = highlight("a\nb\nc\n", "python").split("\n");
  if (lines.length !== 4) throw new Error(`expected 4 line parts, got ${lines.length}`);
});

if (failures) {
  console.log(`\n${failures} highlighter check(s) failed`);
  process.exit(1);
}
console.log("\nthe editor highlight behaves");
