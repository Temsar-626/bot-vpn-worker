// BPB accounts store (DO/SQLite via svc-bpb-account entities).
// The CF token is sealed when VAULT_KEY is configured, otherwise kept as
// plaintext (v0 envelope). Raw token never hits logs, API lists, or UI.
// Status: pending_install | free | sold | error | disabled

import { get, put, list, key, assert, id, str } from "../common.js";
import { seal, unseal } from "../common.js";
import { maskToken } from "./script.js";

export const BPB_STATUS = ["pending_install", "free", "sold", "error", "disabled"];

const TYPE = "bpb-account";

export async function createBpbAccount(env, { label, apiToken }) {
  const cleanLabel = str(label, 100);
  assert(cleanLabel, "bpb_label_required");
  assert(apiToken && String(apiToken).trim().length >= 10, "bpb_token_required");
  const now = Date.now();
  const row = {
    id: id(),
    label: cleanLabel,
    cf_account_id: "",
    cf_email: "",
    api_token_enc: await seal(env, { token: String(apiToken).trim() }),
    worker_name: "",
    workers_dev_subdomain: "",
    kv_namespace_id: "",
    secure_path: "",
    panel_url: "",
    panel_pass_enc: null,
    panel_pass_seeded: false,
    vl_uuid: "",
    tr_pass: "",
    status: "pending_install",
    last_error: "",
    sold_order_id: "",
    sold_service_id: "",
    sold_user_id: "",
    sold_at: 0,
    expire_at: 0,
    settings: {},
    created_at: now,
    updated_at: now,
  };
  await put(env, TYPE, row.id, row);
  return row;
}

export const getBpbAccount = (env, accountId) => get(env, TYPE, accountId);

export const listBpbAccounts = (env) => list(env, TYPE);

export async function getBpbToken(env, row) {
  const secret = await unseal(env, row.api_token_enc);
  assert(secret?.token, "bpb_token_missing", 503);
  return secret.token;
}

export async function setBpbPanelPassword(env, accountId, password, seeded) {
  const row = await getBpbAccount(env, accountId);
  assert(row, "bpb_account_not_found", 404);
  row.panel_pass_enc = await seal(env, { password: String(password) });
  if (seeded !== undefined) row.panel_pass_seeded = !!seeded;
  row.updated_at = Date.now();
  await put(env, TYPE, row.id, row);
  return row;
}

export async function getBpbPanelPassword(env, row) {
  const secret = await unseal(env, row.panel_pass_enc);
  assert(secret?.password, "bpb_panel_pass_missing", 503);
  return secret.password;
}

// Install-time defaults (proxy IPs, DoH, fallback...). Applied to every new
// deployment unless the account overrides them.
export async function getBpbDefaults(env) {
  const { sanitizeBpbSettings } = await import("./script.js");
  const row = await get(env, "bpb-defaults", "main", { settings: {} });
  try {
    return sanitizeBpbSettings(row.settings || {});
  } catch {
    return {};
  }
}

export async function saveBpbDefaults(env, settings) {
  const { sanitizeBpbSettings } = await import("./script.js");
  const clean = sanitizeBpbSettings(settings || {});
  await put(env, "bpb-defaults", "main", { settings: clean, updated_at: Date.now() });
  return clean;
}

export function publicBpbAccount(row) {
  if (!row) return null;
  const { api_token_enc, tr_pass, vl_uuid, panel_pass_enc, ...rest } = row;
  return {
    ...rest,
    hasToken: !!api_token_enc,
    tokenMask: "****",
    // Never expose secrets; UI shows only that rotation happened.
    hasSecrets: !!(tr_pass || vl_uuid),
    hasPanelPass: !!panel_pass_enc,
  };
}

// Backfill mask for rows created before hasToken existed (tests use maskToken).
export function tokenMaskFor() {
  return "****";
}

export async function updateBpbAccount(env, accountId, patch) {
  const row = await getBpbAccount(env, accountId);
  assert(row, "bpb_account_not_found", 404);
  const next = { ...row, ...patch, id: row.id, updated_at: Date.now() };
  if (next.status) assert(BPB_STATUS.includes(next.status), "bpb_invalid_status");
  await put(env, TYPE, next.id, next);
  return next;
}

export async function setBpbToken(env, accountId, apiToken) {
  assert(apiToken && String(apiToken).trim().length >= 10, "bpb_token_required");
  const row = await getBpbAccount(env, accountId);
  assert(row, "bpb_account_not_found", 404);
  row.api_token_enc = await seal(env, { token: String(apiToken).trim() });
  row.updated_at = Date.now();
  await put(env, TYPE, row.id, row);
  return row;
}

export async function deleteBpbAccount(env, accountId, { force = false } = {}) {
  const row = await getBpbAccount(env, accountId);
  assert(row, "bpb_account_not_found", 404);
  // Sold slots are protected (a buyer owns the link); force is the explicit
  // admin override for test rows or dead slots (e.g. undecryptable token).
  assert(force || row.status !== "sold", "bpb_slot_sold");
  await env.BOT_KV.delete(key(TYPE, accountId));
  return true;
}

export function bpbCounts(rows) {
  const c = { total: rows.length, free: 0, sold: 0, error: 0, pending_install: 0, disabled: 0 };
  for (const r of rows) {
    if (r.status === "free") c.free++;
    else if (r.status === "sold") c.sold++;
    else if (r.status === "error") c.error++;
    else if (r.status === "pending_install") c.pending_install++;
    else if (r.status === "disabled") c.disabled++;
  }
  return c;
}

export { maskToken };
