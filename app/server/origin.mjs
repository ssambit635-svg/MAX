/**
 * Who is allowed to talk to the island.
 *
 * The service listens on the loopback interface, which is not the same thing as
 * being private: every web page in the user's browser can POST to 127.0.0.1, and
 * a hostile domain can point its own name at loopback (DNS rebinding). Both are
 * refused here, before a route ever runs:
 *
 *   - the Host header must be a loopback name (or the LAN names MAX itself uses),
 *   - a browser request that carries an Origin must come from the island itself.
 *
 * Requests with no Origin at all (the Electron shell, curl, the tests, the SSE
 * client) are allowed: they cannot be produced by another web page.
 */

/** Extra hostnames this copy is told to trust (a dev proxy, a tunnel). "*" trusts any. */
const trusted = () =>
  new Set(
    String(process.env.MAX_TRUSTED_HOSTS ?? "")
      .split(",")
      .map((entry) => entry.trim().toLowerCase())
      .filter(Boolean),
  );

const LOOPBACK_HOSTS = new Set(["127.0.0.1", "localhost", "[::1]", "::1", "0.0.0.0"]);
const LOOPBACK_ORIGINS = new Set(["null"]);

/** `127.0.0.1:7999` -> `127.0.0.1`; `[::1]:7999` -> `[::1]`. */
function hostName(hostHeader) {
  const value = String(hostHeader ?? "").trim().toLowerCase();
  if (!value) return "";
  if (value.startsWith("[")) return value.slice(0, value.indexOf("]") + 1);
  return value.split(":")[0];
}

function originHost(origin) {
  try {
    return new URL(origin).hostname.toLowerCase().replace(/^\[|\]$/g, "");
  } catch {
    return "";
  }
}

/**
 * @returns {string | null} a plain sentence when the caller is not welcome.
 */
export function rejectForeignCaller(req, { port } = {}) {
  const host = hostName(req.headers?.host);
  if (!host) return "That request had no address.";
  const bare = host.replace(/^\[|\]$/g, "");
  const allow = trusted();
  const wildcard = allow.has("*");
  const trustedHost = wildcard || allow.has(bare);
  if (!LOOPBACK_HOSTS.has(host) && !bare.startsWith("127.") && bare !== "::1" && !wildcard && !allow.has(bare)) {
    // A name that is not loopback means something is pretending to be us.
    return "I only answer on this machine.";
  }
  // A trusted proxy owns its own port numbers, so only enforce the port for
  // loopback callers (where a different port means a forwarder in between).
  if (port && req.headers?.host && !trustedHost) {
    const declared = hostName(req.headers.host);
    const declaredPort = String(req.headers.host).includes(":")
      ? String(req.headers.host).slice(String(req.headers.host).lastIndexOf(":") + 1)
      : "";
    // A port that is not ours is a port-forward or a proxy in between.
    if (declaredPort && /^\d+$/.test(declaredPort) && Number(declaredPort) !== Number(port)) {
      return "That request arrived on the wrong door.";
    }
    if (!declared) return "That request had no address.";
  }

  const origin = req.headers?.origin;
  if (typeof origin === "string" && origin && !LOOPBACK_ORIGINS.has(origin.toLowerCase())) {
    const name = originHost(origin);
    if (!LOOPBACK_HOSTS.has(name) && !name.startsWith("127.") && name !== "::1" && !wildcard && !allow.has(name)) {
      return "That page is not part of the island.";
    }
  }
  return null;
}
