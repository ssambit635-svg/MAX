// Exercises verifyIntegration() against stubbed HTTP responses (sandbox TLS proxy blocks real calls).
const realFetch = globalThis.fetch;
let scenario = {};
globalThis.fetch = async (url, init = {}) => {
  const key = Object.keys(scenario).find((k) => String(url).includes(k));
  if (!key) return new Response("{}", { status: 500 });
  const { status = 200, body } = scenario[key];
  return new Response(JSON.stringify(body ?? {}), { status, headers: { "content-type": "application/json" } });
};

const { verifyIntegration } = await import(new URL("../server/integrations.mjs", import.meta.url).href);
const cases = [];
const check = async (name, provider, input, stub, expect) => {
  scenario = stub;
  const r = await verifyIntegration(provider, input);
  const pass = r.ok === expect.ok && (expect.includes ? r.message.includes(expect.includes) : true);
  cases.push({ name, pass, msg: r.message.slice(0, 88) });
};

// GitHub
await check("github: valid username", "github", { username: "torvalds" },
  { "api.github.com/users/torvalds": { body: { login: "torvalds", name: "Linus", public_repos: 8 } } },
  { ok: true, includes: "@torvalds" });
await check("github: username 404", "github", { username: "ghost" },
  { "api.github.com/users/ghost": { status: 404 } },
  { ok: false, includes: "has no user called" });
await check("github: valid token", "github", { token: "ghp_ok" },
  { "api.github.com/user": { body: { login: "ssambit635-svg", name: "Sambit" } } },
  { ok: true, includes: "@ssambit635-svg" });
await check("github: token 401", "github", { token: "ghp_bad" },
  { "api.github.com/user": { status: 401 } },
  { ok: false, includes: "rejected that token" });
await check("github: nothing entered", "github", {}, {}, { ok: false, includes: "username first" });

// LeetCode
await check("leetcode: valid", "leetcode", { username: "neal_wu" },
  { "leetcode.com/graphql": { body: { data: { matchedUser: { username: "neal_wu", submitStatsGlobal: { acSubmissionNum: [{ difficulty: "All", count: 1234 }] } } } } } },
  { ok: true, includes: "1234 problems solved" });
await check("leetcode: unknown handle", "leetcode", { username: "nobody" },
  { "leetcode.com/graphql": { body: { data: { matchedUser: null } } } },
  { ok: false, includes: "has no user called" });

// Render
await check("render: valid key", "render", { apiKey: "rnd_ok" },
  { "api.render.com": { body: [{ service: { name: "max-api" } }, { service: { name: "site" } }] } },
  { ok: true, includes: "services found" });
await check("render: rejected key", "render", { apiKey: "rnd_bad" },
  { "api.render.com": { status: 401 } },
  { ok: false, includes: "rejected that key" });
await check("render: empty", "render", {}, {}, { ok: false, includes: "API key first" });

globalThis.fetch = realFetch;
let failed = 0;
for (const c of cases) {
  if (!c.pass) failed++;
  console.log(`${c.pass ? "PASS" : "FAIL"}  ${c.name.padEnd(28)} ${c.msg}`);
}
console.log(failed === 0 ? "\nall verify paths behave" : `\n${failed} failing`);
process.exit(failed === 0 ? 0 : 1);
