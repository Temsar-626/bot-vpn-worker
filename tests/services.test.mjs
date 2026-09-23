import test, { beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import { setup, telegramMock } from "./helpers.mjs";
import { getUser, getSettings, putUser } from "../src/kv.js";
import {
  get,
  put,
  key,
  list,
  hash,
  hex,
  hmac,
  seal,
  unseal,
  decimalUnits,
  decimalString,
} from "../src/services/common.js";
import {
  account,
  available,
  adjustWallet,
  walletWrites,
  updateAccount,
  spinWheel,
  drawRaffles,
} from "../src/services/wallet.js";
import {
  quote,
  purchase,
  processOperation,
  reconcileOperation,
  serviceContent,
  manualStockSale,
  decideServiceRequest,
} from "../src/services/engine.js";
import {
  validateInitData,
  portalTicket,
  verifyPhone,
  acceptRules,
} from "../src/services/customer-auth.js";
import { saveServiceSettings } from "../src/services/settings.js";
import {
  createPayment,
  settlePayment,
  verifyPayment,
  starsPreCheckout,
  starsSuccessful,
} from "../src/services/payments.js";
import {
  tonAddress,
  tronAddress,
  transactionHash,
  verifyCrypto,
  USDT_TON,
} from "../src/services/crypto-pay.js";
import {
  exportBackup,
  restoreBackup,
  xlsx,
  csv,
} from "../src/services/reports.js";
import { unzipSync, strFromU8 } from "fflate";
let h, tg;
const oldFetch = globalThis.fetch;
beforeEach(async () => {
  tg = telegramMock();
  globalThis.fetch = tg.fetcher;
  h = await setup();
  h.env.VAULT_KEY = "test-encryption-key-32-characters-long";
  h.env.PUBLIC_BASE_URL = "https://panel.example.com";
});
afterEach(() => (globalThis.fetch = oldFetch));
const api = (m, p, b) => h.api(m, "/services" + p, b);
async function user(id = 42, credit = 0) {
  await h.msg(id, "/start");
  if (credit)
    await adjustWallet(h.env, id, credit, "Test credit", "seed_" + id);
  return getUser(h.env, id);
}
async function stockPlan(extra = {}) {
  const shelf = (await api("POST", "/shelves", { title: "Shelf" })).data.shelf;
  const p = (
    await api("POST", "/panels", {
      title: "Stock",
      type: "stock",
      enabled: true,
      options: { shelfId: shelf.id },
    })
  ).data.panel;
  const planRes = await api("POST", "/plans", {
    title: "20 GB",
    panelId: p.id,
    days: 30,
    volumeGB: 20,
    price: 1000,
    stockShelfId: shelf.id,
    roles: ["customer", "agent", "credit_agent"],
    ...extra,
  });
  assert.equal(planRes.status, 200, JSON.stringify(planRes));
  const plan = planRes.data.plan;
  await api("POST", "/stock/import", {
    shelfId: shelf.id,
    items: [
      "vless://first@example.org:443#one",
      "vless://second@example.org:443#two",
      "vless://third@example.org:443#three",
    ],
  });
  return { shelf, panel: p, plan };
}
async function marzbanPlan() {
  const p = await api("POST", "/panels", {
    title: "Remote",
    type: "marzban",
    url: "https://vpn.example.org",
    enabled: true,
    secret: { username: "operator", password: "secret-provider-password" },
    options: { proxies: { vless: {} } },
  });
  assert.equal(p.status, 200, JSON.stringify(p));
  const plan = (
    await api("POST", "/plans", {
      title: "API plan",
      panelId: p.data.panel.id,
      days: 30,
      volumeGB: 10,
      price: 2500,
      roles: ["customer", "agent", "credit_agent"],
      extraGB: 100,
      extraDay: 50,
    })
  ).data.plan;
  return { panel: p.data.panel, plan };
}
function providerMock({ uncertain = false, reject = false } = {}) {
  const users = new Map();
  let creations = 0;
  tg.setOverride(async (url, method, p) => {
    if (!url.startsWith("https://vpn.example.org")) return undefined;
    const path = new URL(url).pathname;
    if (path === "/api/admin/token") return { access_token: "provider-jwt" };
    if (path === "/api/system") return { version: "0.8" };
    if (path === "/api/user" && method === "user") {
      creations++;
      if (reject)
        return new Response(JSON.stringify({ detail: "bad" }), { status: 400 });
      users.set(p.username, {
        ...p,
        used_traffic: 0,
        status: p.status || "active",
        subscription_url: "https://vpn.example.org/sub/" + p.username,
        links: ["vless://" + p.username + "@node.example.org:443"],
      });
      if (uncertain) {
        uncertain = false;
        throw new Error("lost response");
      }
      return users.get(p.username);
    }
    if (path.startsWith("/api/user/")) {
      const name = decodeURIComponent(path.split("/")[3]);
      const row = users.get(name);
      if (!row) return new Response("{}", { status: 404 });
      if (Object.keys(p).length) {
        Object.assign(row, p);
      }
      return row;
    }
    return {};
  });
  return {
    users,
    get creations() {
      return creations;
    },
  };
}
async function initData(id = 42, age = 0) {
  const data = new URLSearchParams({
    user: JSON.stringify({ id, first_name: "Customer", language_code: "fa" }),
    auth_date: String(Math.floor(Date.now() / 1000) - age),
    query_id: "query-" + id,
  });
  const check = [...data.entries()]
    .sort(([a], [b]) => (a < b ? -1 : 1))
    .map(([k, v]) => k + "=" + v)
    .join("\n");
  data.set(
    "hash",
    hex(await hmac(await hmac("WebAppData", "123:TEST_TOKEN"), check)),
  );
  return data.toString();
}
async function customer(id = 42) {
  const res = await h.raw("POST", "/api/portal/login", {
    body: { initData: await initData(id) },
  });
  const r = await res.json();
  assert.equal(res.status, 200, JSON.stringify(r));
  return r.data.token;
}
async function portal(token, method, path, body) {
  const r = await h.raw(method, "/api/portal" + path, { token, body });
  return { status: r.status, ...(await r.json()) };
}

test("services admin API requires admin authentication and credentials are encrypted", async () => {
  assert.equal((await h.raw("GET", "/api/services/panels")).status, 401);
  const { panel } = await marzbanPlan();
  assert(!("credentials" in panel));
  assert.equal(panel.hasCredentials, true);
  const stored = await get(h.env, "panel", panel.id);
  assert.equal(
    JSON.stringify(stored).includes("secret-provider-password"),
    false,
  );
  assert.equal(
    (await unseal(h.env, stored.credentials)).password,
    "secret-provider-password",
  );
});
test("native provider registration rejects unsafe URLs and works without vault key", async () => {
  assert.equal(
    (
      await api("POST", "/panels", {
        title: "X",
        type: "marzban",
        url: "http://127.0.0.1",
        secret: { token: "x" },
      })
    ).status,
    400,
  );
  delete h.env.VAULT_KEY;
  const res = await api("POST", "/panels", {
    title: "Y",
    type: "marzban",
    url: "https://vpn.example.org",
    secret: { token: "x" },
  });
  assert.equal(res.status, 200);
  const stored = await get(h.env, "panel", res.data.panel.id);
  assert.equal(stored.credentials.version, 0);
  assert.equal((await unseal(h.env, stored.credentials)).token, "x");
  h.env.VAULT_KEY = "test-encryption-key-32-characters-long";
});
test("Telegram initData verifies HMAC, freshness, and duplicate fields", async () => {
  const valid = await initData();
  assert.equal((await validateInitData(valid, "123:TEST_TOKEN")).id, 42);
  await assert.rejects(
    () =>
      validateInitData(valid.replace("Customer", "Attacker"), "123:TEST_TOKEN"),
    /signature/,
  );
  await assert.rejects(
    () => validateInitData(valid + "&auth_date=1", "123:TEST_TOKEN"),
    /duplicate/,
  );
  const expired = await initData(42, 900);
  await assert.rejects(
    () => validateInitData(expired, "123:TEST_TOKEN"),
    /expired/,
  );
});
test("customer session cannot access admin APIs or another user service", async () => {
  const token = await customer(42);
  assert.equal(
    (await h.raw("GET", "/api/services/accounts", { token })).status,
    401,
  );
  const other = await customer(43);
  await put(h.env, "service", "private", {
    id: "private",
    userId: "42",
    configs: ["secret"],
    panelId: "x",
  });
  assert.equal(
    (await portal(other, "GET", "/services/private/content")).status,
    404,
  );
  assert.equal((await portal(token, "GET", "/wallet")).status, 200);
});
test("single-use portal tickets cannot be replayed", async () => {
  await user();
  const ticket = await portalTicket(h.env, 42);
  let r = await h.raw("POST", "/api/portal/login", { body: { ticket } });
  assert.equal(r.status, 200);
  r = await h.raw("POST", "/api/portal/login", { body: { ticket } });
  assert.equal(r.status, 401);
});
test("rules and contact gates require the exact rules version and the user’s own contact", async () => {
  await saveServiceSettings(h.env, {
    rules: "Rules",
    phoneRequired: true,
    iranPhonesOnly: true,
  });
  const token = await customer();
  assert.equal((await portal(token, "POST", "/quote", {})).status, 403);
  await assert.rejects(
    () => verifyPhone(h.env, 42, { user_id: 43, phone_number: "989121234567" }),
    /belong/,
  );
  await verifyPhone(h.env, 42, { user_id: 42, phone_number: "+989121234567" });
  const config = (await api("GET", "/settings")).data.settings;
  await acceptRules(h.env, 42, config.rulesVersion);
  assert.equal((await portal(token, "GET", "/bootstrap")).data.gate.ok, true);
});
test("wallet holds/debits/duplicate references obey available credit", async () => {
  await user(42, 1000);
  let w = await walletWrites(h.env, 42, {
    holdDelta: 700,
    eventId: "hold-one",
    reason: "test",
  });
  await h.env.BOT_KV.batch(
    w.writes.map(([key, value]) => ({ key, value: JSON.stringify(value) })),
  );
  assert.equal(available(await account(h.env, 42)), 300);
  await assert.rejects(
    () =>
      walletWrites(h.env, 42, {
        delta: -301,
        eventId: "overspend",
        reason: "test",
      }),
    /insufficient/,
  );
  w = await walletWrites(h.env, 42, {
    holdDelta: 700,
    eventId: "hold-one",
    reason: "test",
  });
  assert.equal(w.duplicate, true);
  await assert.rejects(
    () =>
      walletWrites(h.env, 42, {
        holdDelta: 701,
        eventId: "hold-one",
        reason: "test",
      }),
    /reference_conflict/,
  );
});
test("expired reseller debt can be repaid without reopening credit", async () => {
  await user();
  await updateAccount(h.env, 42, { role: "credit_agent", creditLimit: 1000 });
  await adjustWallet(h.env, 42, -800, "credit purchase", "debt");
  let a = await account(h.env, 42);
  a.agentExpiresAt = 1;
  await put(h.env, "account", 42, a);
  await adjustWallet(h.env, 42, 100, "partial repayment", "repay");
  assert.equal((await account(h.env, 42)).balance, -700);
  assert.equal(available(await account(h.env, 42)), -700);
});
test("stock reservations are atomic and one item is never delivered twice", async () => {
  await user(42, 10000);
  const { plan } = await stockPlan();
  const q = await quote(h.env, 42, { planId: plan.id, quantity: 2 });
  const op = await purchase(h.env, 42, q.id);
  assert.equal(op.status, "queued");
  assert.equal((await account(h.env, 42)).held, 2000);
  await processOperation(h.env, q.id);
  assert.equal((await account(h.env, 42)).balance, 8000);
  assert.equal((await account(h.env, 42)).held, 0);
  assert.equal(
    (await list(h.env, "stock")).filter((s) => s.status === "delivered").length,
    2,
  );
  assert.equal((await list(h.env, "service")).length, 2);
  await purchase(h.env, 42, q.id);
  await processOperation(h.env, q.id);
  assert.equal((await account(h.env, 42)).balance, 8000);
});
test("insufficient funding cannot reserve configurations", async () => {
  await user();
  const { plan } = await stockPlan();
  const q = await quote(h.env, 42, { planId: plan.id });
  await assert.rejects(() => purchase(h.env, 42, q.id), /insufficient/);
  assert.equal(
    (await list(h.env, "stock")).filter((s) => s.status === "available").length,
    3,
  );
});
test("stock duplicate imports are ignored and manual bulk sales consume only available items", async () => {
  const { shelf } = await stockPlan();
  let r = await api("POST", "/stock/import", {
    shelfId: shelf.id,
    items: ["vless://first@example.org:443#one"],
  });
  assert.equal(r.data.duplicates, 1);
  const sale = await manualStockSale(h.env, {
    shelfId: shelf.id,
    buyer: "Offline customer",
    count: 2,
    amount: 5000,
    confirmPaid: true,
  });
  assert.equal(sale.contents.length, 2);
  await assert.rejects(
    () =>
      manualStockSale(h.env, {
        shelfId: shelf.id,
        buyer: "Other",
        count: 2,
        amount: 5000,
        confirmPaid: true,
      }),
    /stock_empty/,
  );
});
test("changed plan prices invalidate a quote, and custom prices are server-calculated", async () => {
  await user(42, 20000);
  const { plan } = await stockPlan({
    custom: true,
    perGB: 100,
    perDay: 50,
    minGB: 1,
    maxGB: 100,
    minDays: 1,
    maxDays: 365,
  });
  const q = await quote(h.env, 42, {
    planId: plan.id,
    volumeGB: 10,
    days: 20,
    price: 1,
  });
  assert.equal(q.amount, 2000);
  await api("PUT", "/plans/" + plan.id, { ...plan, price: 9000, perGB: 200 });
  await assert.rejects(() => purchase(h.env, 42, q.id), /quote_changed/);
});
test("gift codes credit once and honour total redemption limits", async () => {
  await user(42);
  await user(43);
  await api("POST", "/gifts", {
    code: "GIFT01",
    amount: 1000,
    maxUses: 1,
    enabled: true,
  });
  const a = await import("../src/services/wallet.js");
  await a.redeemGift(h.env, 42, "GIFT01");
  assert.equal((await account(h.env, 42)).balance, 1000);
  await assert.rejects(() => a.redeemGift(h.env, 43, "GIFT01"));
  await assert.rejects(() => a.redeemGift(h.env, 42, "GIFT01"));
});
test("uncertain remote creation keeps the hold and reconciles without another create", async () => {
  await user(42, 10000);
  const { plan } = await marzbanPlan();
  const remote = providerMock({ uncertain: true });
  const q = await quote(h.env, 42, { planId: plan.id });
  await purchase(h.env, 42, q.id);
  await processOperation(h.env, q.id);
  assert.equal((await get(h.env, "operation", q.id)).status, "review");
  assert.equal((await account(h.env, 42)).held, 2500);
  assert.equal(remote.creations, 1);
  await reconcileOperation(h.env, q.id);
  assert.equal((await get(h.env, "operation", q.id)).status, "done");
  assert.equal(remote.creations, 1);
  assert.equal((await account(h.env, 42)).balance, 7500);
});
test("definitive remote rejection releases reserved money", async () => {
  await user(42, 10000);
  const { plan } = await marzbanPlan();
  providerMock({ reject: true });
  const q = await quote(h.env, 42, { planId: plan.id });
  await purchase(h.env, 42, q.id);
  await processOperation(h.env, q.id);
  assert.equal((await get(h.env, "operation", q.id)).status, "failed");
  assert.equal((await account(h.env, 42)).balance, 10000);
  assert.equal((await account(h.env, 42)).held, 0);
});
test("renewal and extra quota use absolute remote targets rather than repeated increments", async () => {
  await user(42, 10000);
  const { plan } = await marzbanPlan();
  providerMock();
  let q = await quote(h.env, 42, { planId: plan.id });
  await purchase(h.env, 42, q.id);
  await processOperation(h.env, q.id);
  let service = (await list(h.env, "service"))[0];
  q = await quote(h.env, 42, {
    kind: "volume",
    serviceId: service.id,
    units: 2,
  });
  await purchase(h.env, 42, q.id);
  await processOperation(h.env, q.id);
  service = await get(h.env, "service", service.id);
  assert.equal(service.dataLimit, 12 * 1073741824);
  assert.equal((await account(h.env, 42)).balance, 7300);
});
test("manual receipts do not count as paid until administrator approval, once only", async () => {
  await user();
  const g = (
    await api("POST", "/gateways", {
      title: "Bank",
      type: "manual",
      cardNumber: "6037991234567890",
      enabled: true,
    })
  ).data.row;
  const p = await createPayment(h.env, 42, {
    amount: 10000,
    gatewayId: g.id,
    requestId: "pay_manual_1",
  });
  const payments = await import("../src/services/payments.js");
  await payments.attachReceipt(h.env, 42, p.id, {
    fileId: "receipt-file",
    name: "receipt.jpg",
  });
  assert.equal((await account(h.env, 42)).balance, 0);
  await payments.decideReceipt(h.env, p.id, true);
  assert.equal((await account(h.env, 42)).balance, 10000);
  await assert.rejects(() => payments.decideReceipt(h.env, p.id, true));
});
test("Stars pre-checkout verifies owner/currency/amount and success credits once", async () => {
  await user();
  await saveServiceSettings(h.env, { starToman: 1000 });
  const g = (
    await api("POST", "/gateways", {
      title: "Stars",
      type: "stars",
      enabled: true,
    })
  ).data.row;
  tg.setOverride((u, m) =>
    m === "createInvoiceLink"
      ? { ok: true, result: "https://t.me/$invoice" }
      : undefined,
  );
  const view = await createPayment(h.env, 42, {
    amount: 10000,
    gatewayId: g.id,
    requestId: "stars_0001",
  });
  const p = await get(h.env, "payment", view.id);
  await starsPreCheckout(h.env, {
    id: "pc",
    from: { id: 43 },
    invoice_payload: p.payload,
    currency: "XTR",
    total_amount: 10,
  });
  assert.equal(tg.calls.at(-1).payload.ok, false);
  const msg = {
    from: { id: 42 },
    successful_payment: {
      invoice_payload: p.payload,
      currency: "XTR",
      total_amount: 10,
      telegram_payment_charge_id: "charge-123",
    },
  };
  await starsSuccessful(h.env, msg);
  await starsSuccessful(h.env, msg);
  assert.equal((await account(h.env, 42)).balance, 10000);
});
test("funding references cannot be reused for another invoice or wallet", async () => {
  await user();
  const g = (
    await api("POST", "/gateways", {
      title: "Bank",
      type: "manual",
      cardNumber: "6037991234567890",
    })
  ).data.row;
  const a = await createPayment(h.env, 42, {
      amount: 10000,
      gatewayId: g.id,
      requestId: "ref_0001",
    }),
    b = await createPayment(h.env, 42, {
      amount: 10000,
      gatewayId: g.id,
      requestId: "ref_0002",
    });
  await settlePayment(
    h.env,
    await get(h.env, "payment", a.id),
    "chain:tx1",
    "test",
  );
  const second = await get(h.env, "payment", b.id);
  await assert.rejects(
    () => settlePayment(h.env, second, "chain:tx1", "test"),
    /reused/,
  );
});
test("crypto units avoid floating point rounding and validate known token/address formats", async () => {
  assert.equal(decimalUnits("1.000000001", 9), 1000000001n);
  assert.equal(decimalString(1000000001n, 9), "1.000000001");
  assert.equal(
    tonAddress("EQCxE6mUtQJKFnGfaROTKOt1lZbDiiX1kCixRv7Nw2Id_sDs"),
    USDT_TON,
  );
  assert.equal(
    await tronAddress("TR7NHqjeKQxGTCi8q8ZY4pL8otSzgjLj6t"),
    "41a614f803b6fd780986a42c78ec9c7f77e6ded13c",
  );
});
test("TON token verification checks the official jetton, destination, memo and success", async () => {
  const address = "0:" + "1".repeat(64),
    tx = "a".repeat(64),
    invoice = {
      currency: "USDT_TON",
      address,
      txHash: tx,
      cryptoAmount: "1.000000",
      memo: "invoice123",
      createdAt: Date.now() - 10000,
      expiresAt: Date.now() + 10000,
    };
  let master = "0:" + "2".repeat(64);
  tg.setOverride((u) =>
    u.startsWith("https://tonapi.io")
      ? {
          in_progress: false,
          timestamp: Math.floor(Date.now() / 1000),
          actions: [
            {
              type: "JettonTransfer",
              status: "ok",
              JettonTransfer: {
                recipient: { address },
                jetton: { address: master },
                amount: "1000000",
                comment: "invoice123",
              },
            },
          ],
        }
      : undefined,
  );
  await assert.rejects(
    () => verifyCrypto(invoice, {}, {}),
    /recipient_or_token/,
  );
  master = USDT_TON;
  assert.equal((await verifyCrypto(invoice, {}, {})).reference, "TON:" + tx);
  invoice.memo = "other";
  await assert.rejects(() => verifyCrypto(invoice, {}, {}), /memo_mismatch/);
});
test("reward wheel uses idempotency, daily limits, budget and exact displayed fee", async () => {
  await user(42, 1000);
  await saveServiceSettings(h.env, {
    wheel: {
      enabled: true,
      dailySpins: 1,
      fee: 100,
      budget: 1000,
      prizes: [
        { title: "A", amount: 200, weight: 1 },
        { title: "B", amount: 200, weight: 1 },
      ],
    },
  });
  await assert.rejects(
    () => spinWheel(h.env, 42, "spin0001", 0),
    /fee_changed/,
  );
  await spinWheel(h.env, 42, "spin0001", 100);
  await spinWheel(h.env, 42, "spin0001", 100);
  assert.equal((await account(h.env, 42)).balance, 1100);
  await assert.rejects(() => spinWheel(h.env, 42, "spin0002", 100), /daily/);
});
test("raffle draws cannot reward the same entry twice", async () => {
  await user(42);
  const r = (
    await api("POST", "/raffles", {
      title: "Free draw",
      closesAt: Date.now() + 120000,
      maxEntries: 10,
      prizes: [1000],
    })
  ).data.raffle;
  r.entries = ["42"];
  r.closesAt = Date.now() - 1;
  await put(h.env, "raffle", r.id, r);
  await drawRaffles(h.env);
  await drawRaffles(h.env);
  assert.equal((await account(h.env, 42)).balance, 1000);
});
test("encrypted backups require the password and refuse overwriting existing finances", async () => {
  await user(42, 1000);
  const backup = await exportBackup(h.env, "a-long-backup-password");
  assert.equal(JSON.stringify(backup).includes("seed_42"), false);
  await assert.rejects(
    () =>
      restoreBackup(
        h.env,
        backup,
        "a-long-backup-password",
        "RESTORE-EMPTY-SERVICES",
      ),
    /empty/,
  );
  const fresh = await setup();
  fresh.env.VAULT_KEY = h.env.VAULT_KEY;
  await assert.rejects(
    () =>
      restoreBackup(
        fresh.env,
        backup,
        "incorrect-password",
        "RESTORE-EMPTY-SERVICES",
      ),
    /decryption/,
  );
  await restoreBackup(
    fresh.env,
    backup,
    "a-long-backup-password",
    "RESTORE-EMPTY-SERVICES",
  );
  assert.equal((await account(fresh.env, 42)).balance, 1000);
  assert.equal((await get(fresh.env, "config", "main")).maintenance, true);
});
test("finance exports neutralize spreadsheet formulas and create valid OOXML", () => {
  assert(csv([["=SUM(1,2)"]]).includes("'=SUM"));
  const files = unzipSync(
    xlsx([
      ["User", "Balance"],
      ["=malicious", 1000],
    ]),
  );
  assert(files["xl/workbook.xml"]);
  const sheet = strFromU8(files["xl/worksheets/sheet1.xml"]);
  assert(sheet.includes('t="inlineStr"'));
  assert.equal(sheet.includes("<f>"), false);
});

test("reconciliation cannot adopt a same-name same-quota account without its ownership marker", async () => {
  await user(42, 10000);
  const { plan } = await marzbanPlan();
  const remote = providerMock({ uncertain: true });
  const q = await quote(h.env, 42, { planId: plan.id, name: "chosen_name" });
  await purchase(h.env, 42, q.id);
  await processOperation(h.env, q.id);
  remote.users.get("chosen_name").note = "Foreign application";
  await assert.rejects(
    () => reconcileOperation(h.env, q.id),
    /remote_creation_not_confirmed/,
  );
  assert.equal((await account(h.env, 42)).balance, 10000);
  assert.equal((await account(h.env, 42)).held, 2500);
});
test("combined subscriptions contain only owned services and rotation invalidates the old bearer link", async () => {
  await user(42, 10000);
  const { plan } = await stockPlan();
  const q = await quote(h.env, 42, { planId: plan.id, quantity: 2 });
  await purchase(h.env, 42, q.id);
  await processOperation(h.env, q.id);
  const ct = await customer(42);
  const first = await portal(ct, "POST", "/combined-subscription", {});
  assert.equal(first.status, 200);
  const path = new URL(first.data.url).pathname;
  let r = await h.raw("GET", path);
  assert.equal(r.status, 200);
  assert.equal(
    Buffer.from(await r.text(), "base64")
      .toString()
      .split("\n").length,
    2,
  );
  const other = await customer(43);
  const otherLink = await portal(other, "POST", "/combined-subscription", {});
  r = await h.raw("GET", new URL(otherLink.data.url).pathname);
  assert.equal(r.status, 404);
  await portal(ct, "POST", "/combined-subscription", { rotate: true });
  r = await h.raw("GET", path);
  assert.equal(r.status, 404);
});
