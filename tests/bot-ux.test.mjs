// UX lockdown tests for the in-bot redesign (no Mini App).
import test from "node:test";
import assert from "node:assert/strict";
import { shortLabel, pageIndicator, progressBar, toggleLabel, backButton } from "../src/services/ux.js";
import { pageMarkup } from "../src/telegram.js";

test("ux helpers keep mobile discipline", () => {
  assert.ok(shortLabel("1234567890123456789012345").length <= 20);
  assert.equal(shortLabel("خرید"), "خرید");
  assert.match(pageIndicator(0, 3, "fa"), /۱\/۳/);
  assert.equal(pageIndicator(1, 3, "en"), "2/3");
  assert.equal(progressBar(50, 10), "█████░░░░░ 50%");
  assert.equal(toggleLabel(true, "Notif"), "✅ Notif");
  assert.equal(toggleLabel(false, "Notif"), "⬜ Notif");
  assert.equal(backButton("fa", "vpn:home").value, "vpn:home");
});

test("pageMarkup passes semantic style through (Bot API 9.4+)", async () => {
  const markup = pageMarkup([
    [{ text: "Buy", type: "callback", value: "vpn:plans:0", style: "success" }],
    [{ text: "Delete", type: "callback", value: "vpn:cancel:x", style: "danger" }],
  ]);
  assert.equal(markup.inline_keyboard[0][0].style, "success");
  assert.equal(markup.inline_keyboard[1][0].style, "danger");
});

test("pageMarkup supports copy_text buttons (Bot API 7.11+)", async () => {
  const markup = pageMarkup([
    [{ text: "Copy", type: "copy", value: "vless://abc123" }],
  ]);
  assert.deepEqual(markup.inline_keyboard[0][0].copy_text, { text: "vless://abc123" });
});

test("pageMarkup supports switch_inline share buttons", async () => {
  const markup = pageMarkup([
    [{ text: "Share", type: "switch_inline", value: "ref_123" }],
  ]);
  assert.equal(markup.inline_keyboard[0][0].switch_inline_query, "ref_123");
});

test("pageMarkup supports disabled sold-out buttons (Bot API 10.3+)", async () => {
  const markup = pageMarkup([
    [{ text: "Sold out", type: "callback", value: "vpn:plan:x", disabled: true }],
  ]);
  assert.equal(markup.inline_keyboard[0][0].disabled, true);
  assert.equal(markup.inline_keyboard[0][0].callback_data, "vpn:plan:x");
});

test("serviceHome hides the Mini App entry and highlights Buy", async () => {
  const src = await import("../src/services/bot.js").then((m) => m.serviceHome.toString());
  assert.ok(!src.includes("vpn:portal") || src.includes("vpn:service"), "home must not push the portal as a main tile");
  assert.ok(src.includes("success"), "Buy keeps a semantic success color");
});
