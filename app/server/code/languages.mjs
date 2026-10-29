/**
 * Languages MAX understands.
 *
 * Nothing here calls a compiler, a service or a model: each language is a small
 * description of how it writes comments, strings and files. The rules then work
 * on that description.
 */

export const LANGUAGES = [
  {
    id: "python",
    label: "Python",
    extensions: [".py", ".pyw", ".pyi"],
    lineComment: ["#"],
    stringQuotes: ['"""', "'''", '"', "'"],
    indent: "spaces",
    indentWidth: 4,
  },
  {
    id: "javascript",
    label: "JavaScript",
    extensions: [".js", ".mjs", ".cjs", ".jsx"],
    lineComment: ["//"],
    blockComment: ["/*", "*/"],
    stringQuotes: ['"', "'", "`"],
    indent: "spaces",
    indentWidth: 2,
  },
  {
    id: "typescript",
    label: "TypeScript",
    extensions: [".ts", ".tsx", ".mts", ".cts"],
    lineComment: ["//"],
    blockComment: ["/*", "*/"],
    stringQuotes: ['"', "'", "`"],
    indent: "spaces",
    indentWidth: 2,
  },
  {
    id: "java",
    label: "Java",
    extensions: [".java"],
    lineComment: ["//"],
    blockComment: ["/*", "*/"],
    stringQuotes: ['"', "'"],
    indent: "spaces",
    indentWidth: 4,
  },
  {
    id: "csharp",
    label: "C#",
    extensions: [".cs", ".csx"],
    lineComment: ["//"],
    blockComment: ["/*", "*/"],
    stringQuotes: ['"', "'"],
    indent: "spaces",
    indentWidth: 4,
  },
  {
    id: "cpp",
    label: "C++",
    extensions: [".cpp", ".cc", ".cxx", ".hpp", ".hxx", ".h"],
    lineComment: ["//"],
    blockComment: ["/*", "*/"],
    stringQuotes: ['"', "'"],
    indent: "spaces",
    indentWidth: 4,
  },
  {
    id: "c",
    label: "C",
    extensions: [".c"],
    lineComment: ["//"],
    blockComment: ["/*", "*/"],
    stringQuotes: ['"', "'"],
    indent: "spaces",
    indentWidth: 4,
  },
  {
    id: "rust",
    label: "Rust",
    extensions: [".rs"],
    lineComment: ["//"],
    blockComment: ["/*", "*/"],
    stringQuotes: ['"', "'"],
    indent: "spaces",
    indentWidth: 4,
  },
  {
    id: "go",
    label: "Go",
    extensions: [".go"],
    lineComment: ["//"],
    blockComment: ["/*", "*/"],
    stringQuotes: ['"', "`"],
    indent: "tabs",
    indentWidth: 1,
  },
  {
    id: "ruby",
    label: "Ruby",
    extensions: [".rb", ".rake", ".gemspec"],
    lineComment: ["#"],
    stringQuotes: ['"', "'"],
    indent: "spaces",
    indentWidth: 2,
  },
  {
    id: "swift",
    label: "Swift",
    extensions: [".swift"],
    lineComment: ["//"],
    blockComment: ["/*", "*/"],
    stringQuotes: ['"', "'"],
    indent: "spaces",
    indentWidth: 4,
  },
  {
    id: "html",
    label: "HTML",
    extensions: [".html", ".htm", ".xhtml"],
    lineComment: [],
    blockComment: ["<!--", "-->"],
    stringQuotes: ['"', "'"],
    indent: "spaces",
    indentWidth: 2,
  },
  {
    id: "css",
    label: "CSS",
    extensions: [".css", ".scss", ".sass", ".less"],
    lineComment: [],
    blockComment: ["/*", "*/"],
    stringQuotes: ['"', "'"],
    indent: "spaces",
    indentWidth: 2,
  },
  {
    id: "json",
    label: "JSON",
    extensions: [".json", ".jsonc"],
    lineComment: ["//"],
    stringQuotes: ['"'],
    indent: "spaces",
    indentWidth: 2,
  },
  {
    id: "sql",
    label: "SQL",
    extensions: [".sql"],
    lineComment: ["--"],
    blockComment: ["/*", "*/"],
    stringQuotes: ["'", '"'],
    indent: "spaces",
    indentWidth: 2,
  },
  {
    id: "text",
    label: "Plain text",
    extensions: [".txt", ".md", ".log", ".env"],
    lineComment: [],
    stringQuotes: [],
    indent: "spaces",
    indentWidth: 2,
  },
];

const BY_ID = new Map(LANGUAGES.map((language) => [language.id, language]));
const BY_EXTENSION = new Map(
  LANGUAGES.flatMap((language) => language.extensions.map((extension) => [extension.toLowerCase(), language])),
);

export function getLanguage(id) {
  if (!id) return null;
  return BY_ID.get(String(id).toLowerCase()) ?? null;
}

/** `app/src/App.tsx` → the TypeScript description. Unknown extensions fall back to text. */
export function detectLanguage(filePath) {
  const name = String(filePath ?? "");
  const extension = name.includes(".") ? `.${name.split(".").pop().toLowerCase()}` : "";
  return BY_EXTENSION.get(extension) ?? BY_ID.get("text");
}

export const catalog = () =>
  LANGUAGES.filter((language) => language.id !== "text").map(({ id, label, extensions }) => ({ id, label, extensions }));
