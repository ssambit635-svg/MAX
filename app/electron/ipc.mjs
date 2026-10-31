/**
 * Every way into the shell, wrapped.
 *
 * An uncaught throw inside an `ipcMain` handler becomes a modal "A JavaScript
 * error occurred in the main process" box — the window is frozen behind it and
 * the pet stops answering. That is exactly what a user sees as "it opens but
 * with this error, and I can't drag it".
 *
 * So handlers are registered through these helpers. A handler that throws is
 * logged, reported to the island as a sentence, and the app keeps running.
 */

/**
 * @param {object} options
 * @param {(channel: string, error: unknown) => void} options.onError
 * @param {(level: string, message: string, detail?: unknown) => void} [options.log]
 * @param {{on: Function, handle: Function}} [options.bus] injected in tests
 */
export function createChannelRegistrar({ onError, log, bus }) {
  if (!bus || typeof bus.on !== "function" || typeof bus.handle !== "function") {
    throw new TypeError("createChannelRegistrar needs the ipcMain bus");
  }
  /** Channels registered during this session, for diagnostics and for tests. */
  const registered = new Set();

  const announce = (channel, error) => {
    try {
      onError?.(channel, error);
    } catch {
      /* reporting a failure must not become one */
    }
  };

  /**
   * `ipcMain.on(channel, handler)` with a net underneath it.
   * @param {string} channel
   * @param {(...args: any[]) => any} handler
   */
  function on(channel, handler) {
    registered.add(channel);
    bus.on(channel, (event, ...args) => {
      try {
        const result = handler(event, ...args);
        // A handler may be async; a rejection is just as fatal as a throw.
        if (result && typeof result.catch === "function") {
          result.catch((error) => {
            log?.("error", `${channel} failed`, error);
            announce(channel, error);
          });
        }
        return result;
      } catch (error) {
        log?.("error", `${channel} threw`, error);
        announce(channel, error);
        return undefined;
      }
    });
  }

  /**
   * `ipcMain.handle(channel, handler)` that answers with a failure object instead
   * of rejecting into the renderer, where it would surface as an unhandled error.
   */
  function handle(channel, handler) {
    registered.add(channel);
    bus.handle(channel, async (event, ...args) => {
      try {
        return await handler(event, ...args);
      } catch (error) {
        log?.("error", `${channel} threw`, error);
        announce(channel, error);
        return { ok: false, message: "That didn't work. Try again." };
      }
    });
  }

  return { on, handle, channels: () => [...registered] };
}
