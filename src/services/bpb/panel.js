// BPB panel session client — the panel's own cookie API (NOT Cloudflare).
// Reverse-engineered from the official worker.js:
//   POST {base}/{securePath}/login/authenticate {username, password}
//     username = CF account email (lowercased), password = KV "pwd"
//     → Set-Cookie: jwtToken=... (24h)
//   GET  {base}/{securePath}/panel/settings            (cookie)
//     → { proxySettings: {...75 keys...}, ... }
//   PUT  {base}/{securePath}/panel/update-settings     (cookie, partial JSON OK)
// Works on any installed slot, including sold ones: panel settings never
// rotate identity secrets, so the buyer link stays alive.

import { assert } from "../common.js";
import { getBpbAccount, getBpbPanelPassword } from "./store.js";

// Authoritative proxySettings keys (merge list of de() in worker.js).
export const PANEL_SETTINGS_KEYS = [
  "remoteDNS", "remoteDnsHost", "localDNS", "antiSanctionDNS", "enableIPv6",
  "fakeDNS", "logLevel", "allowLANConnection", "customDomain", "upstreamProxy",
  "upstreamParams", "chainProxy", "chainProxyParams", "cleanIPs",
  "customCdnAddrs", "customCdnHost", "customCdnSni", "bestPingInterval",
  "protocols", "ports", "fingerprint", "enableTFO", "fragmentMode",
  "fragmentLengthMin", "fragmentLengthMax", "fragmentDelayMin",
  "fragmentDelayMax", "fragmentMaxSplitMin", "fragmentMaxSplitMax",
  "fragmentPackets", "enableECH", "echServerName", "bypassIran",
  "bypassChina", "bypassRussia", "bypassOpenAi", "bypassGoogleAi",
  "bypassMicrosoft", "bypassOracle", "bypassDocker", "bypassAdobe",
  "bypassEpicGames", "bypassIntel", "bypassAmd", "bypassNvidia", "bypassAsus",
  "bypassHp", "bypassLenovo", "blockAds", "blockPorn", "blockUDP443",
  "blockMalware", "blockPhishing", "blockCryptominers", "customBypassRules",
  "customBlockRules", "customBypassSanctionRules", "warpRemoteDNS",
  "warpEndpoints", "warpBestPingInterval", "warpReservedBytes",
  "xrayUdpNoises", "knockerNoiseMode", "knockerNoiseCountMin",
  "knockerNoiseCountMax", "knockerNoiseSizeMin", "knockerNoiseSizeMax",
  "knockerNoiseDelayMin", "knockerNoiseDelayMax", "amneziaNoiseCount",
  "amneziaNoiseSizeMin", "amneziaNoiseSizeMax", "customSubs",
  "remoteSettings", "customConfigs",
];

// Identity/env keys live in our deploy flow (install/revoke/redeploy), NOT in
// the panel editor: sending them would trigger a worker self-redeploy.
const IDENTITY_KEYS = new Set([
  "securePath", "vlUUID", "trPass", "proxyIpMode", "proxyIPs", "prefixes",
  "fallback", "dohUrl", "accID", "accEmail", "apiToken", "mainDomain",
]);

export function panelBase(slot) {
  assert(slot?.worker_name && slot?.workers_dev_subdomain && slot?.secure_path, "bpb_not_installed", 400);
  return `https://${slot.worker_name}.${slot.workers_dev_subdomain}`;
}

function err(code, status = 502) {
  const e = new Error(code);
  e.status = status;
  return e;
}

function extractCookie(res) {
  const all = res.headers.getSetCookie?.() || [res.headers.get("set-cookie") || ""];
  const jwt = all.map((c) => String(c).split(";")[0].trim()).find((c) => c.startsWith("jwtToken="));
  if (!jwt) throw err("bpb_panel_auth_failed");
  return jwt;
}

function serverMessage(data, fallback) {
  const msg =
    data?.message || data?.msg || data?.error || (typeof data === "string" ? data : "");
  let text = String(msg || "").trim();
  if (!text || /^(success|true)$/i.test(text)) text = "";
  const details = Array.isArray(data?.body)
    ? data.body
        .slice(0, 3)
        .map((b) => `${b?.field || "?"}: ${(b?.message || []).join("; ")}`)
        .filter(Boolean)
    : [];
  const combined = [text, ...details].filter(Boolean).join(" | ");
  return (combined || fallback).slice(0, 300);
}

export async function bpbPanelLogin(base, securePath, email, password, fetchFn = globalThis.fetch) {
  assert(email && password, "bpb_panel_credentials_missing", 400);
  let res;
  try {
    res = await fetchFn(`${base}/${securePath}/login/authenticate`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ username: String(email).toLowerCase(), password }),
      signal: AbortSignal.timeout(15000),
    });
  } catch {
    throw err("provider_network_error");
  }
  if (res.status === 401 || res.status === 403) throw err("bpb_panel_auth_failed");
  if (!res.ok) throw err(`provider_http_${res.status}`);
  return extractCookie(res);
}

export async function bpbPanelGetSettings(base, securePath, cookie, fetchFn = globalThis.fetch) {
  let res;
  try {
    res = await fetchFn(`${base}/${securePath}/panel/settings`, {
      headers: { cookie },
      signal: AbortSignal.timeout(15000),
    });
  } catch {
    throw err("provider_network_error");
  }
  if (res.status === 401 || res.status === 403) throw err("bpb_panel_auth_failed");
  if (!res.ok) throw err(`provider_http_${res.status}`);
  const data = await res.json().catch(() => null);
  const settings = data?.proxySettings && typeof data.proxySettings === "object" ? data.proxySettings : null;
  assert(settings, "bpb_panel_bad_response");
  return settings;
}

export async function bpbPanelUpdateSettings(base, securePath, cookie, patch, fetchFn = globalThis.fetch) {
  let res;
  try {
    res = await fetchFn(`${base}/${securePath}/panel/update-settings`, {
      method: "PUT",
      headers: { "content-type": "application/json", cookie },
      body: JSON.stringify(patch),
      signal: AbortSignal.timeout(30000),
    });
  } catch {
    throw err("provider_network_error");
  }
  const data = await res.json().catch(() => null);
  if (res.status === 401 || res.status === 403) throw err("bpb_panel_auth_failed");
  if (!res.ok || data?.success === false) {
    throw new Error(serverMessage(data, `provider_http_${res.status}`));
  }
  return true;
}

/** Keep only known runtime keys; identity keys are stripped (reported back). */
export function sanitizePanelPatch(input) {
  assert(input && typeof input === "object" && !Array.isArray(input), "bpb_patch_object_required", 400);
  const allowed = new Set(PANEL_SETTINGS_KEYS);
  const patch = {};
  const stripped = [];
  const unknown = [];
  for (const [k, v] of Object.entries(input)) {
    if (IDENTITY_KEYS.has(k)) {
      stripped.push(k);
      continue;
    }
    if (!allowed.has(k)) {
      unknown.push(k);
      continue;
    }
    patch[k] = v;
  }
  assert(unknown.length === 0, `bpb_unknown_keys:${unknown.slice(0, 5).join(",")}`, 400);
  assert(Object.keys(patch).length > 0, "bpb_patch_empty", 400);
  return { patch, stripped };
}

async function panelSession(env, row, fetchFn) {
  assert(row.cf_email, "bpb_not_installed", 400);
  const password = await getBpbPanelPassword(env, row);
  const base = panelBase(row);
  const cookie = await bpbPanelLogin(base, row.secure_path, row.cf_email, password, fetchFn);
  return { base, cookie };
}

/** Read live panel settings. Allowed on any installed slot, incl. sold. */
export async function readBpbPanelSettings(env, accountId, deps = {}) {
  const fetchFn = deps.fetchFn || globalThis.fetch;
  const row = await getBpbAccount(env, accountId);
  assert(row, "bpb_account_not_found", 404);
  const { base, cookie } = await panelSession(env, row, fetchFn);
  const settings = await bpbPanelGetSettings(base, row.secure_path, cookie, fetchFn);
  return { settings, email: row.cf_email, status: row.status };
}

/** Apply a partial patch to live panel settings. Safe on sold slots. */
export async function writeBpbPanelSettings(env, accountId, input, deps = {}) {
  const fetchFn = deps.fetchFn || globalThis.fetch;
  const row = await getBpbAccount(env, accountId);
  assert(row, "bpb_account_not_found", 404);
  const { patch, stripped } = sanitizePanelPatch(input);
  const { base, cookie } = await panelSession(env, row, fetchFn);
  await bpbPanelUpdateSettings(base, row.secure_path, cookie, patch, fetchFn);
  const settings = await bpbPanelGetSettings(base, row.secure_path, cookie, fetchFn);
  return { settings, stripped };
}
