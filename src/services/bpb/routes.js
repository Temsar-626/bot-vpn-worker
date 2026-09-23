import { Hono } from "hono";
import { requireAuth } from "../../auth.js";
import { getSettings } from "../../kv.js";
import { enabled } from "../../config.js";
import { get, assert, str, integer } from "../common.js";
import {
  createBpbAccount,
  getBpbAccount,
  listBpbAccounts,
  publicBpbAccount,
  updateBpbAccount,
  deleteBpbAccount,
  setBpbToken,
  getBpbDefaults,
  saveBpbDefaults,
  getBpbPanelPassword,
  bpbCounts,
} from "./store.js";
import {
  installBpbOnAccount,
  assignBpbSlot,
  revokeBpbSlot,
  applyBpbSettings,
  bulkApplyBpbSettings,
} from "./service.js";
import { deleteWorker, verifyToken } from "./cloudflare.js";
import { getBpbToken } from "./store.js";
import { readJson } from "../../body.js";

const result = (c, data) => c.json({ ok: true, data });
const body = (c) => readJson(c);

const admin = new Hono();
admin.use("*", requireAuth);
admin.use("*", async (c, next) => {
  assert(enabled(await getSettings(c.env), "services"), "module_disabled", 403);
  await next();
});

admin.get("/accounts", async (c) => {
  const rows = await listBpbAccounts(c.env);
  rows.sort((a, b) => (b.updated_at || 0) - (a.updated_at || 0));
  return result(c, { rows: rows.map(publicBpbAccount), counts: bpbCounts(rows) });
});

admin.post("/accounts", async (c) => {
  const b = await body(c);
  const row = await createBpbAccount(c.env, { label: b.label, apiToken: b.apiToken });
  return result(c, { account: publicBpbAccount(row) });
});

admin.get("/accounts/:id", async (c) => {
  const row = await getBpbAccount(c.env, c.req.param("id"));
  assert(row, "bpb_account_not_found", 404);
  return result(c, { account: publicBpbAccount(row) });
});

admin.post("/accounts/:id/install", async (c) => {
  const out = await installBpbOnAccount(c.env, c.req.param("id"));
  return result(c, { account: publicBpbAccount(out.account), panelUrl: out.panelUrl, subBase: out.subBase, panelPassSeeded: out.panelPassSeeded });
});

admin.post("/accounts/:id/revoke", async (c) => {
  const out = await revokeBpbSlot(c.env, c.req.param("id"));
  return result(c, { account: publicBpbAccount(out.account), panelUrl: out.panelUrl });
});

admin.post("/accounts/:id/token", async (c) => {
  const b = await body(c);
  const row = await setBpbToken(c.env, c.req.param("id"), b.apiToken);
  return result(c, { account: publicBpbAccount(row) });
});

// Reveal the raw CF token on demand (admin-only). The list endpoints stay
// masked; call this only when the admin explicitly asks to see it.
admin.get("/accounts/:id/token", async (c) => {
  const row = await getBpbAccount(c.env, c.req.param("id"));
  assert(row, "bpb_account_not_found", 404);
  return result(c, { token: await getBpbToken(c.env, row) });
});

// First-open BPB panel password (username = CF account email).
admin.get("/accounts/:id/panel-password", async (c) => {
  const row = await getBpbAccount(c.env, c.req.param("id"));
  assert(row, "bpb_account_not_found", 404);
  assert(row.panel_pass_enc, "bpb_panel_pass_missing", 404);
  return result(c, {
    password: await getBpbPanelPassword(c.env, row),
    seeded: !!row.panel_pass_seeded,
    username: row.cf_email || "",
  });
});

// Install-time defaults applied to every new deployment.
admin.get("/defaults", async (c) => {
  return result(c, { settings: await getBpbDefaults(c.env) });
});

admin.put("/defaults", async (c) => {
  const b = await body(c);
  return result(c, { settings: await saveBpbDefaults(c.env, b.settings || b) });
});

admin.put("/accounts/:id/settings", async (c) => {
  const b = await body(c);
  // Settings-only update redeploys with merged settings (sold slots need explicit allow).
  const account = await applyBpbSettings(c.env, c.req.param("id"), b.settings || b, {
    allowSold: b.allowSold === true,
  });
  return result(c, { account: publicBpbAccount(account) });
});

admin.post("/accounts/bulk-settings", async (c) => {
  const b = await body(c);
  const ids = Array.isArray(b.ids) ? b.ids.map((x) => str(x, 32)).filter(Boolean) : [];
  assert(ids.length > 0 && ids.length <= 50, "bpb_bulk_ids_required");
  const results = await bulkApplyBpbSettings(c.env, ids, b.settings || {}, {
    allowSold: b.allowSold === true,
  });
  return result(c, { results });
});

admin.put("/accounts/:id", async (c) => {
  const b = await body(c);
  const row = await getBpbAccount(c.env, c.req.param("id"));
  assert(row, "bpb_account_not_found", 404);
  const patch = {};
  if (b.label !== undefined) patch.label = str(b.label, 100);
  if (b.status !== undefined) {
    assert(["disabled", "free", "pending_install"].includes(b.status) || row.status === b.status, "bpb_status_transition");
    patch.status = b.status;
  }
  if (b.settings !== undefined && typeof b.settings === "object") patch.settings = b.settings;
  const updated = await updateBpbAccount(c.env, row.id, patch);
  return result(c, { account: publicBpbAccount(updated) });
});

admin.delete("/accounts/:id", async (c) => {
  const row = await getBpbAccount(c.env, c.req.param("id"));
  assert(row, "bpb_account_not_found", 404);
  // Best-effort remote cleanup; row deletion still proceeds if CF is unreachable.
  if (row.cf_account_id && row.worker_name) {
    try {
      const token = await getBpbToken(c.env, row);
      await deleteWorker(token, row.cf_account_id, row.worker_name);
    } catch {}
  }
  await deleteBpbAccount(c.env, row.id);
  return result(c, {});
});

// Internal helper for engine/tests: assign preview (admin only).
admin.post("/assign-preview", async (c) => {
  const b = await body(c);
  const out = await assignBpbSlot(c.env, {
    userId: str(b.userId, 20),
    orderId: str(b.orderId, 64),
    durationDays: integer(b.durationDays ?? 30, 1, 3650),
  });
  // Roll back immediately — preview must not consume inventory.
  await updateBpbAccount(c.env, out.account.id, {
    status: "free",
    sold_order_id: "",
    sold_service_id: "",
    sold_user_id: "",
    expire_at: 0,
  });
  return result(c, { subUrl: out.subUrl, panelUrl: out.panelUrl, expireAt: out.expireAt });
});

export default admin;
export { verifyToken };
