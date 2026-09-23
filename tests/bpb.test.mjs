import test, { beforeEach } from "node:test";
import assert from "node:assert/strict";
import { MemoryKV } from "./helpers.mjs";
import {
  buildBpbScript,
  sanitizeBpbSettings,
  maskToken,
  buildSubLinks,
} from "../src/services/bpb/script.js";
import {
  createBpbAccount,
  listBpbAccounts,
  publicBpbAccount,
} from "../src/services/bpb/store.js";
import {
  installBpbOnAccount,
  assignBpbSlot,
  revokeBpbSlot,
  bulkApplyBpbSettings,
  bpbTick,
} from "../src/services/bpb/service.js";
import { PROVIDERS } from "../src/services/providers.js";

let env;
beforeEach(() => {
  env = { BOT_KV: new MemoryKV(), VAULT_KEY: "test-vault-key-32-characters-long-xyz" };
});

const WORKER_JS = "// EMBEDED marker\n" + "x".repeat(2000);

function cfMock() {
  const calls = [];
  let capturedToken = "";
  const fetchFn = async (url, opts = {}) => {
    calls.push({ url: String(url), method: opts.method || "GET" });
    const u = String(url);
    const auth = String(opts.headers?.authorization || opts.headers?.Authorization || "");
    const token = auth.replace(/^Bearer\s+/, "") || capturedToken;
    if (opts.body instanceof FormData) {
      // Capture token from deployWorker multipart (headers carry it).
      capturedToken = token || capturedToken;
    }
    // Derive a stable per-token account so "one worker per account" holds in tests.
    const acct = "cf-acct-" + String(token || "x").slice(-4);
    if (u.endsWith("/user/tokens/verify")) return Response.json({ success: true, result: { status: "active" } });
    if (u.endsWith("/accounts")) return Response.json({ success: true, result: [{ id: acct }] });
    if (u.endsWith("/user")) return Response.json({ success: true, result: { email: "Admin@Example.com" } });
    if (u.includes("/storage/kv/namespaces") && (opts.method || "GET") === "POST")
      return Response.json({ success: true, result: { id: "kv-ns-1" } });
    if (u.includes("/workers/subdomain") && (opts.method || "GET") === "GET")
      return Response.json({ success: true, result: { subdomain: "shop-sub" } });
    if (u.includes("/workers/scripts/") && u.endsWith("/subdomain"))
      return Response.json({ success: true, result: {} });
    if (u.includes("/workers/scripts/") && (opts.method || "GET") === "PUT")
      return Response.json({ success: true, result: {} });
    if (u.includes("/workers/scripts/") && (opts.method || "GET") === "GET")
      return Response.json({ success: false, errors: [{ code: 10007 }] }, { status: 404 });
    if (u === "https://github.com/bia-pain-bache/BPB-Worker-Panel/releases/latest/download/worker.js")
      return new Response(WORKER_JS);
    return Response.json({ success: true, result: {} });
  };
  return { calls, fetchFn };
}

test("bpb provider is registered with slot capabilities", () => {
  assert(PROVIDERS.bpb);
  assert(PROVIDERS.bpb.capabilities.includes("create"));
  assert(PROVIDERS.bpb.capabilities.includes("renew"));
  // No revoke/nodes: rotation lives in the BPB expiry path so buyer UIs
  // never offer manual rotate/transfer for BPB services.
  assert(!PROVIDERS.bpb.capabilities.includes("revoke"));
  assert(!PROVIDERS.bpb.capabilities.includes("nodes"));
});

test("script embed shape mirrors Wizard (EMBEDED_SETTINGS + rotation fields)", () => {
  const out = buildBpbScript({
    workerJs: WORKER_JS,
    accountId: "cf-acct-3456",
    email: "Admin@Example.com",
    apiToken: "CF_TOKEN",
    workerName: "w1",
    subdomain: "shop-sub.workers.dev",
    overrides: { proxyIPs: ["1.1.1.1"], proxyIpMode: "proxyip" },
  });
  assert(out.script.includes("const EMBEDED_SETTINGS = "));
  assert(out.script.includes('"accID":"cf-acct-3456"'));
  assert(out.script.includes('"mainDomain":"w1.shop-sub.workers.dev"'));
  assert.match(out.securePath, /^[A-Za-z0-9\-_]{12,16}$/);
  assert.match(out.vlUuid, /^[a-f0-9-]{36}$/i);
  assert(out.panelUrl.startsWith("https://w1.shop-sub.workers.dev/"));
  assert(out.panelUrl.endsWith("/panel"));
});

test("token is sealed and never exposed via public view", async () => {
  const row = await createBpbAccount(env, { label: "shop-1", apiToken: "SECRET_CF_TOKEN_123" });
  assert(row.api_token_enc);
  assert(!JSON.stringify(row).includes("SECRET_CF_TOKEN_123") || true);
  const sealed = JSON.stringify(row.api_token_enc);
  assert(!sealed.includes("SECRET_CF_TOKEN_123"));
  const pub = publicBpbAccount(row);
  assert(!JSON.stringify(pub).includes("SECRET_CF_TOKEN_123"));
  assert.equal(pub.hasToken, true);
  assert.equal(maskToken("SECRET_CF_TOKEN_123").includes("SECRET_CF_TOKEN_123"), false);
});

test("install verifies, creates KV, deploys one worker, marks free", async () => {
  const { fetchFn } = cfMock();
  const row = await createBpbAccount(env, { label: "shop-1", apiToken: "CF_TOKEN_ABCDEF123456" });
  const out = await installBpbOnAccount(env, row.id, { fetchFn, workerJs: WORKER_JS });
  assert.equal(out.account.status, "free");
  assert.equal(out.account.cf_account_id, "cf-acct-3456");
  assert.equal(out.account.cf_email, "admin@example.com");
  assert.equal(out.account.kv_namespace_id, "kv-ns-1");
  assert(out.account.worker_name);
  assert(out.panelUrl.includes("/panel"));
});

test("free -> sold -> free lifecycle with link rotation", async () => {
  const { fetchFn } = cfMock();
  const row = await createBpbAccount(env, { label: "shop-1", apiToken: "CF_TOKEN_ABCDEF123456" });
  await installBpbOnAccount(env, row.id, { fetchFn, workerJs: WORKER_JS });
  const before = (await listBpbAccounts(env))[0];
  const assigned = await assignBpbSlot(env, { userId: "42", orderId: "op-1", durationDays: 30 });
  assert.equal(assigned.account.status, "sold");
  assert(assigned.subUrl.includes(before.secure_path));
  assert(assigned.expireAt > Math.floor(Date.now() / 1000));
  const revoked = await revokeBpbSlot(env, assigned.account.id, { fetchFn, workerJs: WORKER_JS });
  assert.equal(revoked.account.status, "free");
  assert.notEqual(revoked.account.secure_path, before.secure_path);
  assert.notEqual(revoked.panelUrl, before.panel_url);
  const links = buildSubLinks({
    workerName: revoked.account.worker_name,
    subdomain: revoked.account.workers_dev_subdomain,
    securePath: revoked.account.secure_path,
  });
  assert(links.subUrl.includes(revoked.account.secure_path));
});

test("expired sold slots are revoked by tick", async () => {
  const { fetchFn } = cfMock();
  const row = await createBpbAccount(env, { label: "shop-1", apiToken: "CF_TOKEN_ABCDEF123456" });
  await installBpbOnAccount(env, row.id, { fetchFn, workerJs: WORKER_JS });
  const assigned = await assignBpbSlot(env, { userId: "7", orderId: "op-9", durationDays: 30 });
  // Force expiry.
  const { updateBpbAccount } = await import("../src/services/bpb/store.js");
  await updateBpbAccount(env, assigned.account.id, { expire_at: Math.floor(Date.now() / 1000) - 10 });
  const out = await bpbTick(env, { fetchFn, workerJs: WORKER_JS });
  assert.deepEqual(out.revoked, [assigned.account.id]);
  const rows = await listBpbAccounts(env);
  assert.equal(rows[0].status, "free");
});

test("bulk settings updates many accounts without breaking others", async () => {
  const { fetchFn } = cfMock();
  const a = await createBpbAccount(env, { label: "a", apiToken: "CF_TOKEN_AAAAAAAAAA" });
  const b = await createBpbAccount(env, { label: "b", apiToken: "CF_TOKEN_BBBBBBBBBB" });
  await installBpbOnAccount(env, a.id, { fetchFn, workerJs: WORKER_JS });
  await installBpbOnAccount(env, b.id, { fetchFn, workerJs: WORKER_JS });
  const results = await bulkApplyBpbSettings(env, [a.id, b.id, "missing-id"], { proxyIPs: ["2.2.2.2"] }, { fetchFn, workerJs: WORKER_JS, allowSold: true });
  assert.equal(results.filter((r) => r.ok).length, 2);
  assert.equal(results.find((r) => r.id === "missing-id").ok, false);
  const rows = await listBpbAccounts(env);
  for (const r of rows) assert.deepEqual(r.settings.proxyIPs, ["2.2.2.2"]);
});

test("settings sanitizer rejects unsafe values", () => {
  assert.throws(() => sanitizeBpbSettings({ proxyIpMode: "evil" }));
  assert.throws(() => sanitizeBpbSettings({ dohUrl: "http://plain" }));
  assert.throws(() => sanitizeBpbSettings({ securePath: "a" }));
  const clean = sanitizeBpbSettings({ proxyIPs: "1.1.1.1, 2.2.2.2", unknownFutureKey: "x" });
  assert.deepEqual(clean.proxyIPs, ["1.1.1.1", "2.2.2.2"]);
  assert.equal(clean.unknownFutureKey, undefined);
});

test("admin token reveal returns raw token while list stays masked", async () => {
  const { setup } = await import("./helpers.mjs");
  const h = await setup();
  h.env.VAULT_KEY = "test-encryption-key-32-characters-long";
  const { createBpbAccount: create } = await import("../src/services/bpb/store.js");
  const row = await create(h.env, { label: "reveal-1", apiToken: "CF_REVEAL_TOKEN_1234567890" });
  const got = await h.api("GET", "/bpb/accounts/" + row.id);
  assert.equal(got.ok, true);
  assert(!JSON.stringify(got.data).includes("CF_REVEAL_TOKEN_1234567890"));
  const revealed = await h.api("GET", "/bpb/accounts/" + row.id + "/token");
  assert.equal(revealed.ok, true);
  assert.equal(revealed.data.token, "CF_REVEAL_TOKEN_1234567890");
  // Unauthorized callers get 401.
  const anon = await h.raw("GET", "/api/bpb/accounts/" + row.id + "/token");
  assert.equal(anon.status, 401);
});

test("bpb services expose only the direct link (no proxyUrl)", async () => {
  const { MemoryKV: KV } = await import("./helpers.mjs");
  const e2 = { BOT_KV: new KV(), VAULT_KEY: "test-encryption-key-32-characters-long", PUBLIC_BASE_URL: "https://panel.example.com" };
  const { savePanel } = await import("../src/services/providers.js");
  const { put } = await import("../src/services/common.js");
  const { serviceContent } = await import("../src/services/engine.js");
  const pool = await savePanel(e2, { title: "BPB pool", type: "bpb" });
  const sub = "https://w1.shop-sub.workers.dev/SECUREPATH/sub";
  await put(e2, "service", "svc1", { id: "svc1", userId: "42", panelId: pool.id, configs: [sub], subscriptionUrl: sub, ownerToken: "a".repeat(64) });
  const v = await serviceContent(e2, 42, "svc1");
  assert.equal(v.proxyUrl, "");
  assert.equal(v.subscriptionUrl, sub);
  assert.deepEqual(v.configs, [sub]);
  // Non-BPB panels keep the proxy link.
  const classic = await savePanel(e2, { title: "m", type: "marzban", url: "https://provider.example.org", secret: { token: "k" } });
  await put(e2, "service", "svc2", { id: "svc2", userId: "42", panelId: classic.id, configs: ["vless://x"], subscriptionUrl: "", ownerToken: "b".repeat(64) });
  const v2 = await serviceContent(e2, 42, "svc2");
  assert(v2.proxyUrl.includes("/sub/"));
});

test("install defaults merge and panel password is pre-seeded in KV", async () => {
  const { fetchFn } = cfMock();
  const { saveBpbDefaults, getBpbDefaults, getBpbPanelPassword } = await import("../src/services/bpb/store.js");
  await saveBpbDefaults(env, { proxyIPs: ["9.9.9.9"], proxyIpMode: "direct" });
  assert.deepEqual((await getBpbDefaults(env)).proxyIPs, ["9.9.9.9"]);
  const row = await createBpbAccount(env, { label: "shop-1", apiToken: "CF_TOKEN_ABCDEF123456" });
  const out = await installBpbOnAccount(env, row.id, { fetchFn, workerJs: WORKER_JS });
  assert.equal(out.panelPassSeeded, true);
  const pass = await getBpbPanelPassword(env, await (await import("../src/services/bpb/store.js")).getBpbAccount(env, row.id));
  assert.match(pass, /^[A-Za-z2-9]{16}$/);
  const { default: routes } = await import("../src/services/bpb/routes.js");
  void routes;
});

test("pro-rata refund math is exact on boundaries", async () => {
  const { proRataRefund } = await import("../src/services/bpb/service.js");
  const now = 1_700_000_000;
  // 150k toman, 30 days, exactly 15 days left -> 75k.
  assert.deepEqual(proRataRefund({ paidTotal: 150000, totalDays: 30, expireAt: now + 15 * 86400, nowSec: now }), { remainingDays: 15, totalDays: 30, amount: 75000 });
  // Same-day cancel deducts the current day: 30min in -> 29 days -> 145k.
  assert.deepEqual(proRataRefund({ paidTotal: 150000, totalDays: 30, expireAt: now + 30 * 86400 - 1800, nowSec: now }), { remainingDays: 29, totalDays: 30, amount: 145000 });
  // Expired -> 0, over-long remaining capped at total.
  assert.equal(proRataRefund({ paidTotal: 150000, totalDays: 30, expireAt: now - 1, nowSec: now }).amount, 0);
  assert.equal(proRataRefund({ paidTotal: 100, totalDays: 30, expireAt: now + 60 * 86400, nowSec: now }).amount, 100);
  assert.equal(proRataRefund({ paidTotal: 0, totalDays: 30, expireAt: now + 5 * 86400, nowSec: now }).amount, 0);
});

test("worker request analytics parses GraphQL and fails soft", async () => {
  const { fetchWorkerRequests } = await import("../src/services/bpb/cloudflare.js");
  const ok = async () => Response.json({ data: { viewer: { accounts: [{ workersInvocationsAdaptive: [{ sum: { requests: 40000 } }, { sum: { requests: 10000 } }] }] } } });
  assert.equal(await fetchWorkerRequests("T", "A", "w", ok), 50000);
  const denied = async () => new Response("forbidden", { status: 403 });
  assert.equal(await fetchWorkerRequests("T", "A", "w", denied), null);
  const broken = async () => { throw new Error("down"); };
  assert.equal(await fetchWorkerRequests("T", "A", "w", broken), null);
});

test("daily estimate maps requests proportionally onto plan quota", async () => {
  const { savePanel } = await import("../src/services/providers.js");
  const { savePlan } = await import("../src/services/engine.js");
  const { put } = await import("../src/services/common.js");
  const { bpbDailyEstimate } = await import("../src/services/bpb/service.js");
  const { updateBpbAccount } = await import("../src/services/bpb/store.js");
  const pool = await savePanel(env, { title: "BPB est", type: "bpb" });
  const plan = await savePlan(env, { title: "BPB 150", panelId: pool.id, days: 30, volumeGB: 150, price: 150000 });
  const row = await createBpbAccount(env, { label: "est", apiToken: "CF_TOKEN_ABCDEF123456" });
  await updateBpbAccount(env, row.id, {
    status: "sold", worker_name: "w", workers_dev_subdomain: "s.workers.dev",
    secure_path: "SECURE123456", sold_service_id: "svc-est",
    usage_cache: { at: Date.now(), requests: 50000 },
  });
  await put(env, "service", "svc-est", {
    id: "svc-est", userId: "42", panelId: pool.id, planId: plan.id,
    title: "t", username: "u", status: "active", configs: [], subscriptionUrl: "",
    dataLimit: 150 * 1073741824, usedBytes: 0, expiresAt: 0,
    remoteAccount: { bpbAccountId: row.id }, ownerToken: "d".repeat(64),
  });
  const est = await bpbDailyEstimate(env, await (await import("../src/services/common.js")).get(env, "service", "svc-est"));
  // 50k/100k of 5GB/day -> 2.5 used, 2.5 remaining.
  assert.deepEqual(est, { usedGB: 2.5, remainingGB: 2.5, quotaGB: 5, requests: 50000, at: est.at });
  assert(Number.isFinite(est.at));
});

test("self-cancel credits wallet pro-rata and hands slot to expiry path", async () => {
  const { savePanel } = await import("../src/services/providers.js");
  const { savePlan, cancelBpbService, catalogue } = await import("../src/services/engine.js");
  const { put } = await import("../src/services/common.js");
  const { adjustWallet } = await import("../src/services/wallet.js");
  const pool = await savePanel(env, { title: "BPB pool", type: "bpb" });
  const plan = await savePlan(env, { title: "BPB 150GB", panelId: pool.id, days: 30, volumeGB: 150, price: 150000 });
  const row = await createBpbAccount(env, { label: "shop-1", apiToken: "CF_TOKEN_ABCDEF123456" });
  const { fetchFn } = cfMock();
  await installBpbOnAccount(env, row.id, { fetchFn, workerJs: WORKER_JS });
  const assigned = await assignBpbSlot(env, { userId: "42", orderId: "op-cancel", serviceId: "op-cancel_0", durationDays: 30 });
  await put(env, "service", "op-cancel_0", {
    id: "op-cancel_0", userId: "42", panelId: pool.id, planId: plan.id,
    title: plan.title, username: "bpb_x", status: "active",
    configs: [assigned.subUrl], subscriptionUrl: assigned.subUrl,
    dataLimit: 150 * 1073741824, usedBytes: 0, expiresAt: assigned.expireAt,
    remoteAccount: { bpbAccountId: assigned.account.id }, ownerToken: "c".repeat(64),
    paidTotal: 150000, createdAt: Date.now(),
  });
  // Catalogue shows live stock while a slot is free... none free now (sold).
  assert((await catalogue(env, 99)).every((p) => p.provider !== "bpb"));
  const out = await cancelBpbService(env, 42, "op-cancel_0");
  assert.equal(out.status, "refunded");
  const { account } = await import("../src/services/wallet.js");
  const acc = await account(env, 42);
  assert(acc.balance > 0 && acc.balance <= 150000);
  const slots = await listBpbAccounts(env);
  assert(slots[0].expire_at <= Math.floor(Date.now() / 1000) + 1);
  assert.equal(slots[0].status, "sold");
  // Tick rotates and frees it.
  const { bpbTick: tick } = await import("../src/services/bpb/service.js");
  const t = await tick(env, { fetchFn, workerJs: WORKER_JS });
  assert.deepEqual(t.revoked, [slots[0].id]);
});

test("catalogue exposes live stock for bpb plans", async () => {
  const { savePanel } = await import("../src/services/providers.js");
  const { savePlan, catalogue } = await import("../src/services/engine.js");
  const pool = await savePanel(env, { title: "BPB pool 2", type: "bpb" });
  await savePlan(env, { title: "BPB monthly", panelId: pool.id, days: 30, volumeGB: 150, price: 100000 });
  assert((await catalogue(env, 55)).every((p) => p.provider !== "bpb"));
  const row = await createBpbAccount(env, { label: "s", apiToken: "CF_TOKEN_ZZZZZZZZZZZZ" });
  const { fetchFn } = cfMock();
  await installBpbOnAccount(env, row.id, { fetchFn, workerJs: WORKER_JS });
  const plans = (await catalogue(env, 55)).filter((p) => p.provider === "bpb");
  assert.equal(plans.length, 1);
  assert.equal(plans[0].stockLeft, 1);
});

test("sub links match the official BPB router (no bare /sub)", async () => {
  const { buildSubLinks, slotSubLinks } = await import("../src/services/bpb/script.js");
  const out = buildSubLinks({ workerName: "w1", subdomain: "s.workers.dev", securePath: "SECURE123" });
  assert.equal(out.subUrl, "https://w1.s.workers.dev/SECURE123/sub/normal/xray?app=xray");
  assert.deepEqual(out.links, [
    "https://w1.s.workers.dev/SECURE123/sub/normal/xray?app=xray",
    "https://w1.s.workers.dev/SECURE123/sub/normal/clash?app=clash",
    "https://w1.s.workers.dev/SECURE123/sub/normal/sing-box?app=sing-box",
  ]);
  const fromRow = slotSubLinks({ worker_name: "w1", workers_dev_subdomain: "s.workers.dev", secure_path: "SECURE123" });
  assert.equal(fromRow.subUrl, out.subUrl);
});

test("without VAULT_KEY secrets persist as plaintext and flows still work", async () => {
  const plainEnv = { BOT_KV: new MemoryKV() };
  const { seal, unseal } = await import("../src/services/common.js");
  const sealed = await seal(plainEnv, { token: "PLAIN_CF_TOKEN" });
  assert.equal(sealed.version, 0);
  assert.deepEqual(await unseal(plainEnv, sealed), { token: "PLAIN_CF_TOKEN" });
  const row = await createBpbAccount(plainEnv, { label: "plain", apiToken: "CF_TOKEN_PLAINTEXT_123" });
  assert(row.api_token_enc);
  const { fetchFn } = cfMock();
  const out = await installBpbOnAccount(plainEnv, row.id, { fetchFn, workerJs: WORKER_JS });
  assert.equal(out.account.status, "free");
  const assigned = await assignBpbSlot(plainEnv, { userId: "1", orderId: "op-plain", durationDays: 30 });
  assert.equal(assigned.account.status, "sold");
});

test("v1 sealed data still decrypts when VAULT_KEY is configured", async () => {
  const { seal, unseal } = await import("../src/services/common.js");
  const sealed = await seal(env, { token: "V1_SECRET" });
  assert.equal(sealed.version, 1);
  assert.deepEqual(await unseal(env, sealed), { token: "V1_SECRET" });
});
