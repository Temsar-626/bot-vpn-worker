// BPB script builder — mirrors BPB-Wizard web/src/script.ts + random.ts.
// Downloads the official worker.js release, embeds EMBEDED_SETTINGS (BPB v5),
// and prepends light obfuscation for uniqueness. No secrets are logged.

export const BPB_WORKER_URL =
  "https://github.com/bia-pain-bache/BPB-Worker-Panel/releases/latest/download/worker.js";

const PATH_CHARSET = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456780-_";
const PASS_CHARSET = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789!@$&*_-+;:,.";
const SUB_CHARSET = "abcdefghijklmnopqrstuvwxyz0123456789-";
const CODE_CHARSET = "abcdefghijklmnopqrstuvwxyz0123456789";

export function randString(charset, minLen, maxLen, rand = Math.random) {
  const length = Math.floor(rand() * (maxLen - minLen + 1)) + minLen;
  const arr = crypto.getRandomValues(new Uint8Array(length));
  let out = "";
  for (let i = 0; i < length; i++) out += charset[arr[i] % charset.length];
  return out;
}

function randInt(min, max) {
  return Math.floor(Math.random() * (max - min + 1)) + min;
}

export function randSubdomain() {
  let sub;
  do {
    sub = randString(SUB_CHARSET, 16, 32);
  } while (sub.startsWith("-") || sub.endsWith("-"));
  return sub;
}

export function randSecurePath() {
  return randString(PATH_CHARSET, 12, 16);
}

export function randTrojanPass() {
  return randString(PASS_CHARSET, 16, 20);
}

// Light uniqueness filler (same idea as Wizard randCode — NOT security).
export function randCode() {
  const varCount = randInt(50, 120);
  const funcCount = randInt(50, 120);
  let vars = "";
  for (let i = 0; i < varCount; i++) {
    vars += `let __var_${randString(CODE_CHARSET, 8, 12)}_${i} = ${randInt(0, 99999)};\n`;
  }
  let funcs = "";
  for (let i = 0; i < funcCount; i++) {
    funcs += `function __func_${randString(CODE_CHARSET, 8, 12)}_${i}() { return ${randInt(0, 999)}; }\n`;
  }
  return vars + funcs;
}

export function maskToken(token) {
  const t = String(token || "");
  if (t.length <= 8) return "****";
  return `${t.slice(0, 4)}…${t.slice(-4)}`;
}

export async function downloadWorkerJs(fetchFn = globalThis.fetch, url = BPB_WORKER_URL) {
  const res = await fetchFn(url);
  if (!res.ok) throw new Error(`bpb_worker_download_failed_${res.status}`);
  const text = await res.text();
  if (!text || text.length < 1000 || !text.includes("EMBEDED")) {
    // Upstream file shape may change; keep a sanity gate without being brittle.
    if (!text || text.length < 1000) throw new Error("bpb_worker_download_invalid");
  }
  return text;
}

/**
 * Build a deployable BPB worker script.
 * @param {object} opts { workerJs, accountId, email, apiToken, workerName, subdomain, overrides }
 * overrides: { proxyIPs, proxyIpMode, fallback, dohUrl, ... } — only allow-listed keys survive.
 */
export function buildBpbScript(opts) {
  const { workerJs, accountId, email, apiToken, workerName, subdomain } = opts;
  if (!workerJs || typeof workerJs !== "string") throw new Error("bpb_worker_js_required");
  if (!accountId || !email || !apiToken || !workerName || !subdomain) {
    throw new Error("bpb_build_params_required");
  }
  const overrides = sanitizeBpbSettings(opts.overrides || {});
  const securePath = overrides.securePath || randSecurePath();
  const vlUuid = overrides.vlUuid || crypto.randomUUID();
  const trPass = overrides.trPass || randTrojanPass();

  const embededSettings = {
    accID: accountId,
    accEmail: String(email).toLowerCase(),
    apiToken,
    vlUUID: vlUuid,
    trPass,
    securePath,
    proxyIpMode: overrides.proxyIpMode || "proxyip",
    proxyIPs: overrides.proxyIPs || [],
    prefixes: overrides.prefixes || [],
    fallback: overrides.fallback || "",
    dohUrl: overrides.dohUrl || "",
    mainDomain: `${workerName}.${subdomain}`,
    ...(overrides.extra || {}),
  };

  const header = [`// ${embededSettings.accEmail}`, `// Build: ${new Date().toISOString()}`, "// @ts-nocheck"].join("\n");
  const script = [header, `${randCode()}const EMBEDED_SETTINGS = ${JSON.stringify(embededSettings)};${workerJs}`].join("\n");
  const base = `https://${workerName}.${subdomain}/${securePath}`;
  return {
    script,
    securePath,
    vlUuid,
    trPass,
    panelUrl: `${base}/panel`,
    // Exact sub paths vary by BPB version; the base prefix is stable and the
    // full link list is produced by buildSubLinks().
    subBase: `${base}/sub`,
    embededSettings,
  };
}

const ALLOWED_SETTINGS_KEYS = new Set([
  "proxyIPs",
  "proxyIpMode",
  "fallback",
  "dohUrl",
  "prefixes",
  "securePath",
  "vlUuid",
  "trPass",
]);

export function sanitizeBpbSettings(input) {
  const out = {};
  if (!input || typeof input !== "object") return out;
  if (input.proxyIPs !== undefined) {
    const arr = Array.isArray(input.proxyIPs) ? input.proxyIPs : String(input.proxyIPs).split(/[,\n]+/);
    out.proxyIPs = arr.map((s) => String(s).trim()).filter(Boolean).slice(0, 50);
  }
  if (input.proxyIpMode !== undefined) {
    const m = String(input.proxyIpMode);
    if (!["proxyip", "direct", "none"].includes(m)) throw new Error("invalid_proxy_ip_mode");
    out.proxyIpMode = m;
  }
  if (input.fallback !== undefined) out.fallback = String(input.fallback).slice(0, 512);
  if (input.dohUrl !== undefined) {
    const u = String(input.dohUrl).trim();
    if (u && !/^https:\/\//.test(u)) throw new Error("invalid_doh_url");
    out.dohUrl = u.slice(0, 512);
  }
  if (input.prefixes !== undefined) {
    const arr = Array.isArray(input.prefixes) ? input.prefixes : String(input.prefixes).split(/[,\n]+/);
    out.prefixes = arr.map((s) => String(s).trim()).filter(Boolean).slice(0, 50);
  }
  if (input.securePath !== undefined) {
    const p = String(input.securePath);
    if (!/^[A-Za-z0-9\-_]{8,32}$/.test(p)) throw new Error("invalid_secure_path");
    out.securePath = p;
  }
  if (input.vlUuid !== undefined) {
    const u = String(input.vlUuid);
    if (!/^[a-f0-9-]{36}$/i.test(u)) throw new Error("invalid_vl_uuid");
    out.vlUuid = u;
  }
  if (input.trPass !== undefined) {
    const t = String(input.trPass);
    if (t.length < 8 || t.length > 64) throw new Error("invalid_tr_pass");
    out.trPass = t;
  }
  for (const k of Object.keys(input)) {
    if (!ALLOWED_SETTINGS_KEYS.has(k) && !k.startsWith("_")) {
      // Silently drop unknown keys to stay forward-compatible with BPB.
    }
  }
  return out;
}

/** Sub links handed to the buyer (FA/EN message uses these). */
export function buildSubLinks({ workerName, subdomain, securePath }) {
  const base = `https://${workerName}.${subdomain}/${securePath}`;
  return {
    panelUrl: `${base}/panel`,
    subUrl: `${base}/sub`,
    links: [`${base}/sub`],
  };
}
