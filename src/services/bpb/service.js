// BPB orchestration: install / assign / revoke / settings / tick.
// One Cloudflare account = exactly one Worker = one concurrent sale slot.

import { assert, epoch } from "../common.js";
import {
  verifyToken,
  createKvNamespace,
  ensureWorkersDevSubdomain,
  workerNameTaken,
  deployWorker,
  enableWorkerSubdomain,
  deleteWorker,
  kvWrite,
} from "./cloudflare.js";
import {
  downloadWorkerJs,
  buildBpbScript,
  buildSubLinks,
  sanitizeBpbSettings,
  randSubdomain,
  randSecurePath,
  randTrojanPass,
} from "./script.js";
import {
  getBpbAccount,
  listBpbAccounts,
  getBpbToken,
  updateBpbAccount,
  getBpbDefaults,
  setBpbPanelPassword,
  bpbCounts,
} from "./store.js";

const PANEL_PASS_CHARSET = "ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnpqrstuvwxyz23456789";

export function randPanelPassword(length = 16) {
  const arr = crypto.getRandomValues(new Uint8Array(length));
  let out = "";
  for (let i = 0; i < length; i++) out += PANEL_PASS_CHARSET[arr[i] % PANEL_PASS_CHARSET.length];
  return out;
}

export async function installBpbOnAccount(env, accountId, deps = {}) {
  const fetchFn = deps.fetchFn || globalThis.fetch;
  const row = await getBpbAccount(env, accountId);
  assert(row, "bpb_account_not_found", 404);
  assert(row.status !== "sold", "bpb_slot_sold", 400);
  assert(env.VAULT_KEY && String(env.VAULT_KEY).length >= 32, "vault_key_required", 503);
  const token = await getBpbToken(env, row);
  try {
    // 1) Verify + account identity.
    const { accountId: cfAccountId, email } = await verifyToken(token, fetchFn);
    // 2) Enforce one Worker per CF account: this slot owns the account.
    const siblings = (await listBpbAccounts(env)).filter(
      (r) => r.id !== row.id && r.cf_account_id === cfAccountId && r.status !== "disabled",
    );
    assert(siblings.length === 0, "bpb_account already_claimed", 409);

    // 3) Unique worker name.
    let workerName = row.worker_name;
    if (!workerName) {
      for (let i = 0; i < 5; i++) {
        const candidate = randSubdomain().slice(0, 24);
        if (!(await workerNameTaken(token, cfAccountId, candidate, fetchFn))) {
          workerName = candidate;
          break;
        }
      }
      assert(workerName, "bpb_worker_name_failed", 502);
    }

    // 4) KV namespace.
    const kvNamespaceId = row.kv_namespace_id || (await createKvNamespace(token, cfAccountId, `${workerName}-workers-${new Date().toISOString()}`, fetchFn));

    // 5) workers.dev subdomain.
    const subdomainFull =
      row.workers_dev_subdomain || (await ensureWorkersDevSubdomain(token, cfAccountId, randSubdomain, fetchFn));
    const subdomain = subdomainFull.replace(/\.workers\.dev$/, "");

    // 6) Download + build script (Wizard parity). Install defaults apply
    // first, per-account settings override them.
    const workerJs = deps.workerJs || (await downloadWorkerJs(fetchFn));
    const defaults = await getBpbDefaults(env);
    const built = buildBpbScript({
      workerJs,
      accountId: cfAccountId,
      email,
      apiToken: token,
      workerName,
      subdomain: subdomainFull,
      overrides: { ...defaults, ...(row.settings || {}), securePath: row.secure_path || undefined },
    });

    // 7) Deploy + enable subdomain.
    await deployWorker(token, cfAccountId, workerName, built.script, kvNamespaceId, fetchFn);
    await enableWorkerSubdomain(token, cfAccountId, workerName, fetchFn);

    // 8) First-open panel password: BPB gates the panel behind KV key "pwd"
    // with username = account email. Pre-seed it so first open goes straight
    // to login; on failure the admin sets it manually on first open.
    const panelPassword = randPanelPassword();
    let seeded = false;
    try {
      await kvWrite(token, cfAccountId, kvNamespaceId, "pwd", panelPassword, fetchFn);
      seeded = true;
    } catch {}
    await setBpbPanelPassword(env, row.id, panelPassword, seeded);

    const updated = await updateBpbAccount(env, row.id, {
      cf_account_id: cfAccountId,
      cf_email: email,
      worker_name: workerName,
      workers_dev_subdomain: subdomainFull,
      kv_namespace_id: kvNamespaceId,
      secure_path: built.securePath,
      panel_url: built.panelUrl,
      vl_uuid: built.vlUuid,
      tr_pass: "***",
      status: "free",
      last_error: "",
      settings: row.settings || {},
    });
    // Store rotation secrets only as presence flag — real secrets live inside
    // the deployed worker + CF account, never in our DB in plaintext.
    return { account: updated, panelUrl: built.panelUrl, subBase: built.subBase, panelPassSeeded: seeded };
  } catch (e) {
    await updateBpbAccount(env, row.id, {
      status: "error",
      last_error: String(e.message || e).slice(0, 300),
    });
    throw e;
  }
}

/** Assign a free slot to a buyer. No CF call (fast) — links derive from stored metadata. */
export async function assignBpbSlot(env, { userId, orderId, serviceId = "", durationDays = 30 }) {
  assert(userId, "bpb_user_required");
  const free = (await listBpbAccounts(env))
    .filter((r) => r.status === "free" && r.panel_url && r.worker_name)
    .sort((a, b) => (a.updated_at || 0) - (b.updated_at || 0));
  assert(free.length > 0, "bpb_no_free_slot", 409);
  const slot = free[0];
  const days = Number(durationDays) || 30;
  const expireAt = epoch() + days * 86400;
  const links = buildSubLinks({
    workerName: slot.worker_name,
    subdomain: slot.workers_dev_subdomain,
    securePath: slot.secure_path,
  });
  const updated = await updateBpbAccount(env, slot.id, {
    status: "sold",
    sold_order_id: String(orderId || ""),
    sold_service_id: String(serviceId || ""),
    sold_user_id: String(userId),
    sold_at: Date.now(),
    expire_at: expireAt,
  });
  return {
    account: updated,
    subUrl: links.subUrl,
    panelUrl: slot.panel_url,
    links: links.links,
    expireAt,
  };
}

/**
 * Revoke a sold slot: rotate securePath + credentials and redeploy,
 * then mark free. Old sub links die with the rotation.
 */
export async function revokeBpbSlot(env, accountId, deps = {}) {
  const fetchFn = deps.fetchFn || globalThis.fetch;
  const row = await getBpbAccount(env, accountId);
  assert(row, "bpb_account_not_found", 404);
  const token = await getBpbToken(env, row);
  assert(row.cf_account_id && row.worker_name && row.kv_namespace_id, "bpb_not_installed", 400);
  assert(row.workers_dev_subdomain, "bpb_not_installed", 400);

  const workerJs = deps.workerJs || (await downloadWorkerJs(fetchFn));
  const subdomainFull = row.workers_dev_subdomain;
  const subdomain = subdomainFull.replace(/\.workers\.dev$/, "");
  const built = buildBpbScript({
    workerJs,
    accountId: row.cf_account_id,
    email: row.cf_email,
    apiToken: token,
    workerName: row.worker_name,
    subdomain: subdomainFull,
    overrides: {
      ...(row.settings || {}),
      securePath: randSecurePath(),
      vlUuid: crypto.randomUUID(),
      trPass: randTrojanPass(),
    },
  });
  await deployWorker(token, row.cf_account_id, row.worker_name, built.script, row.kv_namespace_id, fetchFn);
  // Best-effort KV flag so the old path stops resolving even before redeploy propagates.
  try {
    await kvWrite(token, row.cf_account_id, row.kv_namespace_id, `revoked:${Date.now()}`, "1", fetchFn);
  } catch {}

  const freed = await updateBpbAccount(env, row.id, {
    secure_path: built.securePath,
    panel_url: built.panelUrl,
    status: "free",
    last_error: "",
    sold_order_id: "",
    sold_service_id: "",
    sold_user_id: "",
    expire_at: 0,
  });
  void subdomain;
  return { account: freed, panelUrl: built.panelUrl, subBase: built.subBase };
}

/** Find the sold slot backing a service (by predicted service id). */
export async function findBpbSlotForService(env, serviceId) {
  const rows = await listBpbAccounts(env);
  return rows.find((s) => s.sold_service_id === String(serviceId) && s.status === "sold") || null;
}

/**
 * Pro-rata refund quote: remaining full days over total days times paid total.
 * Pure math — pass resolved inputs, easy to test.
 */
export function proRataRefund({ paidTotal = 0, totalDays = 0, expireAt = 0, nowSec = epoch() }) {
  const total = Math.max(0, Number(totalDays) || 0);
  const remaining = Math.max(0, Math.ceil((Number(expireAt) - nowSec) / 86400));
  const paid = Math.max(0, Math.floor(Number(paidTotal) || 0));
  if (!total || !remaining || !paid) return { remainingDays: remaining, totalDays: total, amount: 0 };
  const capped = Math.min(remaining, total);
  return { remainingDays: remaining, totalDays: total, amount: Math.floor((paid * capped) / total) };
}

/** Single + bulk settings update (redeploy with merged settings). */
export async function applyBpbSettings(env, accountId, settings, deps = {}) {
  const fetchFn = deps.fetchFn || globalThis.fetch;
  const clean = sanitizeBpbSettings(settings);
  const row = await getBpbAccount(env, accountId);
  assert(row, "bpb_account_not_found", 404);
  assert(row.status !== "sold" || deps.allowSold === true, "bpb_slot_sold", 409);
  assert(row.cf_account_id && row.worker_name && row.kv_namespace_id, "bpb_not_installed", 400);
  const token = await getBpbToken(env, row);
  const workerJs = deps.workerJs || (await downloadWorkerJs(fetchFn));
  const subdomainFull = row.workers_dev_subdomain;
  const subdomain = subdomainFull.replace(/\.workers\.dev$/, "");
  const built = buildBpbScript({
    workerJs,
    accountId: row.cf_account_id,
    email: row.cf_email,
    apiToken: token,
    workerName: row.worker_name,
    subdomain: subdomainFull,
    overrides: {
      ...(row.settings || {}),
      ...clean,
      securePath: row.secure_path,
      // Keep identity secrets stable on settings-only updates.
    },
  });
  await deployWorker(token, row.cf_account_id, row.worker_name, built.script, row.kv_namespace_id, fetchFn);
  void subdomain;
  return updateBpbAccount(env, row.id, {
    settings: { ...(row.settings || {}), ...clean },
    panel_url: built.panelUrl,
  });
}

export async function bulkApplyBpbSettings(env, accountIds, settings, deps = {}) {
  const results = [];
  for (const accountId of accountIds.slice(0, 50)) {
    try {
      const account = await applyBpbSettings(env, accountId, settings, deps);
      results.push({ id: accountId, ok: true, panelUrl: account.panel_url });
    } catch (e) {
      results.push({ id: accountId, ok: false, error: String(e.message).slice(0, 160) });
    }
  }
  return results;
}

/** Cron: revoke expired sold slots. Returns { revoked, errors }. */
export async function bpbTick(env, deps = {}) {
  const now = epoch();
  const rows = await listBpbAccounts(env);
  const expired = rows.filter((r) => r.status === "sold" && r.expire_at && r.expire_at <= now);
  const out = { checked: rows.length, revoked: [], errors: [] };
  for (const slot of expired.slice(0, 10)) {
    try {
      const r = await revokeBpbSlot(env, slot.id, deps);
      out.revoked.push(slot.id);
      // Optional buyer notification hook (engine wires service status separately).
      if (deps.notify) {
        try {
          await deps.notify(slot, r);
        } catch {}
      }
    } catch (e) {
      await updateBpbAccount(env, slot.id, { last_error: String(e.message).slice(0, 300) });
      out.errors.push({ id: slot.id, error: String(e.message).slice(0, 160) });
    }
  }
  return out;
}

export { bpbCounts };
