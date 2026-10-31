/**
 * Module loader hook: "electron" resolves to the stub, and "electron-updater" to a
 * stub that never phones home. Used only by `verify-shell.test.mjs`.
 */

const STUB = new URL("./electron-stub.mjs", import.meta.url).href;

export async function resolve(specifier, context, nextResolve) {
  if (specifier === "electron") return { url: STUB, shortCircuit: true, format: "module" };
  if (specifier === "electron-updater") {
    return { url: new URL("./updater-stub.mjs", import.meta.url).href, shortCircuit: true, format: "module" };
  }
  // The shell imports node built-ins and its own files; leave those alone.
  return nextResolve(specifier, context);
}
