/**
 * Guards the code engine: every language in the picker must be covered by rules,
 * every safe fix must actually fix, and a fix must never break working code.
 *
 * The engine is pure, so these tests need no network and no compiler.
 */
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { applyFixes, review } from "../server/code/engine.mjs";
import { catalog, detectLanguage, getLanguage, LANGUAGES } from "../server/code/languages.mjs";
import { listWorkspace, readCodeFile, writeCodeFile } from "../server/code/files.mjs";

let failures = 0;

function check(name, run) {
  try {
    run();
    console.log(`PASS  ${name}`);
  } catch (error) {
    failures += 1;
    console.log(`FAIL  ${name}\n      ${error.message.split("\n")[0]}`);
  }
}

const rules = (code, language) => review(code, language).issues.map((issue) => issue.rule);

/* ------------------------------------------------------------- languages -- */

check("every advertised language has a description", () => {
  for (const id of catalog().map((entry) => entry.id)) {
    const language = getLanguage(id);
    assert.ok(language, `${id} is missing from LANGUAGES`);
    assert.ok(language.label.trim().length >= 1, `${id} needs a label`);
  }
});

check("the requested languages are all present", () => {
  const ids = LANGUAGES.map((language) => language.id);
  for (const id of ["python", "java", "html", "css", "rust", "go", "ruby", "c", "cpp", "csharp", "javascript", "typescript", "swift"]) {
    assert.ok(ids.includes(id), `missing ${id}`);
  }
});

check("files are detected from their extension", () => {
  assert.equal(detectLanguage("a/b/main.py").id, "python");
  assert.equal(detectLanguage("Main.java").id, "java");
  assert.equal(detectLanguage("index.html").id, "html");
  assert.equal(detectLanguage("app.tsx").id, "typescript");
  assert.equal(detectLanguage("lib.rs").id, "rust");
  assert.equal(detectLanguage("server.go").id, "go");
  assert.equal(detectLanguage("Rakefile.rb").id, "ruby");
  assert.equal(detectLanguage("main.c").id, "c");
  assert.equal(detectLanguage("main.cpp").id, "cpp");
  assert.equal(detectLanguage("Program.cs").id, "csharp");
  assert.equal(detectLanguage("App.swift").id, "swift");
  assert.equal(detectLanguage("styles.css").id, "css");
  assert.equal(detectLanguage("notes.unknown").id, "text");
});

/* ------------------------------------------------------------ error rules -- */

check("unbalanced brackets are an error on line 1", () => {
  const result = review("function f() {\n  return (1 + 2;\n}", "javascript");
  const issue = result.issues.find((entry) => entry.rule === "unbalanced-delimiters");
  assert.ok(issue, "no bracket issue found");
  assert.equal(issue.severity, "error");
});

check("merge conflict markers are caught", () => {
  assert.ok(rules("<<<<<<< HEAD\nx = 1\n=======\nx = 2\n>>>>>>> branch\n", "python").includes("conflict-markers"));
});

check("an unterminated string is caught", () => {
  assert.ok(rules('const a = "never closed\n', "javascript").includes("unterminated-string"));
});

check("broken JSON names the problem", () => {
  const issue = review('{"a": 1,}', "json").issues.find((entry) => entry.rule === "json-parse");
  assert.ok(issue);
  assert.equal(issue.severity, "error");
});

/* --------------------------------------------------------- language rules -- */

const fixtures = {
  python: ["def f(a=[]):\n    if a == None:\n        pass\n    try:\n        pass\n    except:\n        pass\n", ["py-mutable-default", "py-none-compare", "py-bare-except"]],
  javascript: ['var x = 1\nif (x == "1") { console.log(x) }\ndebugger\n', ["js-var", "js-loose-equality", "js-console", "js-debugger"]],
  typescript: ["const v: any = 1\nexport const f = () => v == 2\n", ["ts-any", "js-loose-equality"]],
  java: ['class A { void f(String s){ if (s == "x") {} } }', ["java-string-equality"]],
  csharp: ["class A { void F(){ Console.WriteLine(1); } }", ["cs-console"]],
  cpp: ["using namespace std;\nint main(){ cout << 1; }", ["cpp-using-namespace", "cpp-missing-include"]],
  c: ['#include <stdio.h>\nint main(){char b[4]; gets(b); strlen(b); return 0;}', ["c-gets", "c-missing-include"]],
  rust: ["fn main() { let x = a().unwrap(); todo!(); }", ["rust-unwrap", "rust-unimplemented"]],
  go: ['package main\nfunc main() { panic("x") }', ["go-panic"]],
  ruby: ['if x == nil then puts "a" end', ["rb-nil-compare", "rb-puts-debug"]],
  swift: ["let x = try! f()\nprint(x)\n", ["swift-force-try", "swift-print"]],
  html: ['<html><head><img src="a.png"></head><body><div></body></html>', ["html-lang", "html-img-alt", "html-unclosed-tag"]],
  css: ["a { color: red; color: blue; margin: 0px !important; }", ["css-duplicate-property", "css-zero-unit", "css-important"]],
  sql: ["DELETE FROM users;", ["sql-delete-without-where"]],
};

for (const [language, [code, expected]] of Object.entries(fixtures)) {
  check(`${language}: finds ${expected.join(", ")}`, () => {
    const found = rules(code, language);
    for (const rule of expected) assert.ok(found.includes(rule), `missing ${rule} (found ${found.join(", ") || "none"})`);
  });
}

/* ------------------------------------------------------------------ fixes -- */

check("safe fixes rewrite Python correctly", () => {
  const before = "def f(a):\n    if a == None:\n        pass\n    try:\n        pass\n    except:\n        pass";
  const after = applyFixes(before, "python");
  assert.equal(after.ok, true);
  assert.equal(after.changed, true);
  assert.ok(after.code.includes("if a is None:"), after.code);
  assert.ok(after.code.includes("except Exception:"), after.code);
  assert.ok(after.code.endsWith("\n"), "final newline not added");
});

check("safe fixes turn == into === for JavaScript", () => {
  const after = applyFixes('if (a == "1" && b != 2) {}\n', "javascript");
  assert.ok(after.code.includes('a === "1"'), after.code);
  assert.ok(after.code.includes("b !== 2"), after.code);
});

check("== null is left alone (it is idiomatic)", () => {
  const after = applyFixes("if (a == null) {}\n", "javascript");
  assert.ok(after.code.includes("a == null"), after.code);
});

check("var becomes let, debugger is removed", () => {
  const after = applyFixes("var a = 1\ndebugger;\n", "javascript");
  assert.ok(after.code.includes("let a = 1"), after.code);
  assert.ok(!after.code.includes("debugger"), after.code);
});

check("CSS zero units are dropped", () => {
  const after = applyFixes("a { margin: 0px; }\n", "css");
  assert.ok(after.code.includes("margin: 0;"), after.code);
});

check("HTML gets a doctype and a lang", () => {
  const after = applyFixes('<html><head></head><body><h1>hi</h1></body></html>', "html");
  assert.ok(after.code.startsWith("<!DOCTYPE html>"), after.code);
  assert.ok(after.code.includes('<html lang="en">'), after.code);
});

check("trailing whitespace and CRLF are cleaned", () => {
  const after = applyFixes("const a = 1;   \r\n", "javascript");
  assert.ok(!after.code.includes("\r"), "CRLF left behind");
  assert.ok(!/[ \t]+\n/.test(after.code), "trailing whitespace left behind");
});

check("fixes are idempotent", () => {
  const once = applyFixes('var a = 1\nif (a == null) {}\ndebugger\n', "javascript");
  const twice = applyFixes(once.code, "javascript");
  assert.equal(twice.changed, false, "a second run still changed the file");
});

check("a fix never breaks a file it cannot improve", () => {
  const clean = "export const add = (a: number, b: number): number => a + b;\n";
  const after = applyFixes(clean, "typescript");
  assert.equal(after.code, clean);
});

check("a broken file is refused, with the line named", () => {
  const broken = "function f() {\n  return (1 + 2;\n}\n";
  const after = applyFixes(broken, "javascript");
  assert.equal(after.ok, false);
  assert.equal(after.code, broken, "the broken file must come back untouched");
  assert.match(after.message, /Line \d+/);
});

check("scoring falls as issues grow", () => {
  const clean = review("export const a = 1;\n", "javascript").score;
  const messy = review('var a = 1\nif (a == "1") { console.log(a); debugger }\n', "javascript").score;
  assert.ok(clean > messy, `${clean} should be greater than ${messy}`);
});

/* ------------------------------------------------------------- file layer -- */

const workspace = fs.mkdtempSync(path.join(os.tmpdir(), "max-code-"));

check("a new file is created inside the workspace", () => {
  const target = path.join(workspace, "hello.py");
  const result = writeCodeFile(target, "print('hi')\n", workspace);
  assert.equal(result.ok, true, result.message);
  assert.equal(result.created, true);
  assert.equal(fs.readFileSync(target, "utf8"), "print('hi')\n");
});

check("reading it back returns the code and language", () => {
  const result = readCodeFile(path.join(workspace, "hello.py"), workspace);
  assert.equal(result.ok, true, result.message);
  assert.equal(result.language, "python");
  assert.equal(result.inWorkspace, true);
});

check("the workspace listing finds it", () => {
  const files = listWorkspace(workspace);
  assert.ok(files.some((file) => file.name === "hello.py"));
});

check("new files cannot be created outside the workspace", () => {
  const result = writeCodeFile(path.join(os.tmpdir(), "not-allowed-xyz.py"), "x = 1\n", workspace);
  assert.equal(result.ok, false);
  assert.match(result.message, /workspace/);
});

check("unsupported types are refused", () => {
  const result = writeCodeFile(path.join(workspace, "run.exe"), "x", workspace);
  assert.equal(result.ok, false);
});

check("hidden and secret files are refused", () => {
  assert.equal(readCodeFile(path.join(workspace, ".env"), workspace).ok, false);
  assert.equal(writeCodeFile(path.join(workspace, ".env"), "A=1", workspace).ok, false);
});

check("system folders are refused", () => {
  const result = readCodeFile(path.join(workspace, "node_modules", "x.js"), workspace);
  assert.equal(result.ok, false);
  assert.match(result.message, /system|belongs/);
});

check("a missing file says so plainly", () => {
  const result = readCodeFile(path.join(workspace, "nope.py"), workspace);
  assert.equal(result.ok, false);
  assert.match(result.message, /couldn't find/);
});

fs.rmSync(workspace, { recursive: true, force: true });

if (failures) {
  console.log(`\n${failures} code-engine check(s) failed`);
  process.exit(1);
}
console.log("\nthe code engine behaves");
