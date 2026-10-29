/**
 * The code engine.
 *
 * Pure functions over text: `review()` finds issues, `applyFixes()` rewrites the
 * text for the rules marked fixable. No network, no compiler, no model — so it
 * works offline, stays fast, and can never send your code anywhere.
 */

import { detectLanguage, getLanguage } from "./languages.mjs";
import { rulesFor } from "./rules.mjs";
import { maskCode, splitLines } from "./syntax.mjs";

const SEVERITY_WEIGHT = { error: 12, warn: 5, info: 1.5 };

function buildContext(code, language) {
  const { masked, unterminated } = maskCode(code, language);
  return { code, language, masked, syntax: { unterminated } };
}

/**
 * @returns {{ ok: true, language: string, score: number, stats: object, issues: object[] }}
 */
export function review(code, languageId) {
  const language = getLanguage(languageId) ?? detectLanguage("");
  const source = String(code ?? "");

  if (!source.trim()) {
    return {
      ok: true,
      language: language.id,
      score: 100,
      stats: { lines: 0, characters: 0, errors: 0, warnings: 0, hints: 0 },
      issues: [],
    };
  }

  const context = buildContext(source, language);
  const issues = [];
  const seen = new Set();

  for (const rule of rulesFor(language)) {
    let found = [];
    try {
      found = rule.check(context) ?? [];
    } catch {
      // A rule must never break the review; skip the one that did.
      found = [];
    }
    for (const issue of found) {
      const key = `${rule.id}:${issue.line}:${issue.message}`;
      if (seen.has(key)) continue;
      seen.add(key);
      issues.push({
        rule: rule.id,
        severity: rule.severity,
        title: rule.title,
        hint: rule.hint,
        fixable: Boolean(rule.fixable),
        line: Math.max(1, Number(issue.line) || 1),
        message: issue.message,
      });
    }
  }

  issues.sort((a, b) => {
    const order = { error: 0, warn: 1, info: 2 };
    if (order[a.severity] !== order[b.severity]) return order[a.severity] - order[b.severity];
    return a.line - b.line;
  });

  const penalty = issues.reduce((sum, issue) => sum + (SEVERITY_WEIGHT[issue.severity] ?? 0), 0);
  const stats = {
    lines: splitLines(source).length,
    characters: source.length,
    errors: issues.filter((issue) => issue.severity === "error").length,
    warnings: issues.filter((issue) => issue.severity === "warn").length,
    hints: issues.filter((issue) => issue.severity === "info").length,
  };

  return {
    ok: true,
    language: language.id,
    score: Math.max(0, Math.round(100 - Math.min(100, penalty))),
    stats,
    issues,
  };
}

/**
 * Apply every safe fix, in an order that keeps later rules valid.
 * @returns {{ ok: true, code: string, applied: {rule,title,count}[], review: object, changed: boolean }}
 */
export function applyFixes(code, languageId) {
  const language = getLanguage(languageId) ?? detectLanguage("");
  const source = String(code ?? "");

  // Never tidy a file that is structurally broken: the whitespace rules would hide
  // the real problem behind a "fixed" badge.
  const firstError = review(source, language.id).issues.find((issue) => issue.severity === "error");
  if (firstError) {
    return {
      ok: false,
      code: source,
      applied: [],
      changed: false,
      review: review(source, language.id),
      message: `Line ${firstError.line}: ${firstError.message} Fix that first — then I'll clean up the rest.`,
    };
  }

  let current = source;
  const applied = [];

  // Two passes: a fix can expose another one (indentation after whitespace trim).
  for (let pass = 0; pass < 2; pass += 1) {
    const context = buildContext(current, language);
    for (const rule of rulesFor(language)) {
      if (!rule.fixable || typeof rule.fix !== "function") continue;
      let next = null;
      try {
        next = rule.fix(current, context);
      } catch {
        next = null;
      }
      if (typeof next === "string" && next !== current) {
        const existing = applied.find((entry) => entry.rule === rule.id);
        if (existing) existing.count += 1;
        else applied.push({ rule: rule.id, title: rule.title, count: 1 });
        current = next;
      }
    }
  }

  // A fix must never break what was already balanced.
  const after = buildContext(current, language);
  const before = buildContext(source, language);
  const damage = (context) =>
    rulesFor(language)
      .filter((rule) => rule.id === "unbalanced-delimiters")
      .flatMap((rule) => rule.check(context) ?? []).length;
  if (damage(after) > damage(before)) {
    return {
      ok: false,
      code: source,
      applied: [],
      review: review(source, language.id),
      changed: false,
      message: "The automatic fix would have broken the brackets, so I left the file alone.",
    };
  }

  return {
    ok: true,
    code: current,
    applied,
    changed: current !== String(code ?? ""),
    review: review(current, language.id),
  };
}

/** What the engine knows, for the UI's language picker. */
export function engineInfo() {
  return {
    rules: rulesFor({ id: "javascript", stringQuotes: ['"'] }).length,
    offline: true,
  };
}
