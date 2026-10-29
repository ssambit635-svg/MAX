/**
 * One place that knows what version this build is and what it is running on, so
 * diagnostics, the health route and the release notes never disagree.
 */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const APP_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

export const VERSION =
  process.env.MAX_VERSION ||
  (() => {
    try {
      return JSON.parse(fs.readFileSync(path.join(APP_ROOT, "package.json"), "utf8")).version ?? "0.0.0";
    } catch {
      return "0.0.0";
    }
  })();

/** Short machine name for logs — never the full hostname in user-facing text. */
export const HOST = os.hostname().split(".")[0];
