import test, { afterEach } from "node:test";
import assert from "node:assert/strict";
import { bootPanel } from "./panel-dom.mjs";

let panel;
afterEach(() => {
  panel?.close();
  panel = null;
});

function run(code) {
  panel.inject(
    `(async () => { try { window.__r = { ok: true, v: await (${code}) }; } catch (e) { window.__r = { ok: false, e: String((e && e.message) || e) }; } window.__done = true; })();`,
  );
}
async function result() {
  for (let i = 0; i < 300 && !panel.win.__done; i++)
    await new Promise((r) => setTimeout(r, 10));
  assert(panel.win.__done, "ui roundtrip timed out");
  const r = panel.win.__r;
  panel.win.__done = false;
  panel.win.__r = undefined;
  assert(r.ok, "ui error: " + r.e);
  return r.v;
}
const fakeRows = (n) =>
  Array.from({ length: n }, (_, i) => ({
    id: "id-" + i,
    label: "shop-" + (i % 10),
    cf_email: `owner${i}@example.com`,
    worker_name: "w" + i,
    panel_url: `https://w${i}.sub.workers.dev/PATH${i}/panel`,
    status: ["free", "sold", "error", "pending_install", "disabled"][i % 5],
    expire_at: i % 5 === 1 ? Math.floor(Date.now() / 1000) + (i + 1) * 86400 : 0,
    sold_user_id: i % 5 === 1 ? "42" : "",
    updated_at: Date.now() - i * 1000,
    created_at: Date.now() - i * 2000,
  }));

test("bpb is a top-level studio tab gated by the services module", async () => {
  panel = bootPanel();
  const tabs = await (run(`V_TABS.map((t) => t[0])`), result());
  assert(tabs.includes("bpb"));
  const entry = await (run(`V_TABS.find((t) => t[0] === "bpb")`), result());
  assert.deepEqual([entry[1], entry[2]], ["cloud", "services"]);
  assert.equal(await (run(`typeof studioBpb`), result()), "function");
});

test("bpb workspace renders toolbar, stats and empty state", async () => {
  panel = bootPanel();
  await (run(`(async () => { document.body.innerHTML = await studioBpb(); return true; })()`), result());
  await (run(`new Promise((r) => setTimeout(r, 50))`), result());
  const doc = panel.doc;
  await (run(`bpbEnsure(true).then(() => bpbRender())`), result());
  assert(doc.querySelector("#bpb-body"), "workspace body renders");
  assert(doc.querySelector("#bpb-q"), "search box renders");
  assert(doc.querySelector("#bpb-status"), "status filter renders");
});

test("bpb list filters, paginates and bulk-selects at scale", async () => {
  panel = bootPanel();
  await (run(`(async () => { document.body.innerHTML = await studioBpb(); return true; })()`), result());
  await (
    run(`(async () => {
      BPB.rows = ${JSON.stringify(fakeRows(120)).replace(/</g, "\\u003c")};
      BPB.at = Date.now();
      BPB.counts = { total: 120, free: 24, sold: 24, error: 24, pending_install: 24, disabled: 24 };
      BPB.perPage = 50; BPB.page = 0; BPB.q = ""; BPB.status = ""; BPB.sort = "updated";
      await bpbRender();
      return document.querySelectorAll('#bpb-body [data-bpb-check]').length;
    })()`),
    result()
  ).then((n) => assert.equal(n, 51, "page checkbox + 50 rows"));
  // Status filter narrows to 24 sold rows on a single page.
  await (
    run(`(async () => { BPB.status = "sold"; BPB.page = 0; await bpbRender();
      return document.querySelectorAll('#bpb-body [data-bpb-check]').length; })()`),
    result()
  ).then((n) => assert.equal(n, 25, "page checkbox + 24 sold rows"));
  // Search narrows further (shop-1 matches 12 of 120).
  await (
    run(`(async () => { BPB.status = ""; BPB.q = "shop-1"; BPB.page = 0; await bpbRender();
      return document.querySelectorAll('#bpb-body [data-bpb-check]').length; })()`),
    result()
  ).then((n) => assert.equal(n, 13, "page checkbox + 12 matches"));
  // Bulk select-all captures the filtered set.
  await (
    run(`(async () => { await ACTIONS.bpbSelectAll(); return BPB.selected.size; })()`),
    result()
  ).then((n) => assert.equal(n, 12, "select-all captures filtered rows"));
});
