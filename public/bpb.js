"use strict";
/* BPB — standalone top-level workspace tab for Cloudflare Workers slots.
 * Built for hundreds of accounts: server data is cached once, then searched,
 * filtered, sorted and paginated on the client; mutations run sequentially
 * with a progress modal so long jobs never hit worker time limits. */
const BPB = {
  rows: null,
  counts: null,
  defaults: {},
  at: 0,
  q: "",
  status: "",
  sort: "updated",
  page: 0,
  perPage: 50,
  selected: new Set(),
  bulk: null,
};
const bpbAPI = (path, opts) => api("/bpb" + path, opts);
const BPB_STATUSES = ["pending_install", "free", "sold", "error", "disabled"];
const bpbStatus = (s) =>
  ({
    pending_install: L("در انتظار نصب", "Pending install"),
    free: L("آزاد", "Free"),
    sold: L("فروخته‌شده", "Sold"),
    error: L("خطا", "Error"),
    disabled: L("غیرفعال", "Disabled"),
  })[s] || s;
const bpbBadge = (v) =>
  `<span class="v-badge ${["free"].includes(v) ? "good" : ["sold", "pending_install"].includes(v) ? "warn" : ["error"].includes(v) ? "bad" : ""}">${bpbStatus(v)}</span>`;
const bpbBtn = (label, act, data = "", primary = false) => vButton(label, act, data, primary);

function bpbExpiry(r) {
  if (r.status !== "sold" || !r.expire_at) return "";
  const ms = r.expire_at * 1000 - Date.now();
  if (ms <= 0) return `<span class="text-rose-400">${L("منقضی شده", "Expired")}</span>`;
  const days = Math.floor(ms / 86400000);
  const txt = days > 0 ? `${fmtNum(days)} ${L("روز مانده", "days left")}` : `${fmtNum(Math.max(1, Math.round(ms / 3600000)))} ${L("ساعت مانده", "hours left")}`;
  const hot = ms < 3 * 86400000 ? "text-amber-400" : "";
  return `<span class="${hot}">${txt}</span>`;
}

async function bpbEnsure(force = false) {
  if (!force && BPB.rows && Date.now() - BPB.at < 30000) return;
  const [d, def] = await Promise.all([bpbAPI("/accounts"), bpbAPI("/defaults")]);
  BPB.rows = d.rows || [];
  BPB.counts = d.counts || {};
  BPB.defaults = def.settings || {};
  BPB.at = Date.now();
  // Drop selections for rows that no longer exist.
  const ids = new Set(BPB.rows.map((r) => r.id));
  for (const id of [...BPB.selected]) if (!ids.has(id)) BPB.selected.delete(id);
}

function bpbFiltered() {
  const q = BPB.q.trim().toLowerCase();
  let rows = BPB.rows || [];
  if (BPB.status) rows = rows.filter((r) => r.status === BPB.status);
  if (q)
    rows = rows.filter((r) =>
      [r.label, r.cf_email, r.worker_name, r.panel_url, r.sold_user_id]
        .filter(Boolean)
        .join(" ")
        .toLowerCase()
        .includes(q),
    );
  const by = {
    updated: (a, b) => (b.updated_at || 0) - (a.updated_at || 0),
    label: (a, b) => String(a.label || "").localeCompare(String(b.label || "")),
    expire: (a, b) => (a.expire_at || 9e15) - (b.expire_at || 9e15),
    created: (a, b) => (b.created_at || 0) - (a.created_at || 0),
  }[BPB.sort] || ((a, b) => (b.updated_at || 0) - (a.updated_at || 0));
  return [...rows].sort(by);
}

async function studioBpb() {
  bpbEnsure().then(() => bpbRender(true)).catch((e) => {
    const host = $("bpb-body");
    if (host) host.innerHTML = vNote(esc(vError(e.message)), true);
  });
  return `<div class="sv-workspace"><div class="sv-header"><div><span class="v-eyebrow">BPB / CLOUDFLARE WORKERS</span><h3>${L("مدیریت ورکرهای BPB", "BPB workers")}</h3><p>${L("هر اکانت Cloudflare = یک ورکر = یک اسلات فروش", "One Cloudflare account = one worker = one sale slot")}</p></div><div class="flex items-center gap-2 flex-wrap">${bpbBtn(L("اکانت جدید", "New account"), "bpbNew", "", true)}${bpbBtn(t("refresh"), "bpbRefresh")}</div></div><div id="bpb-body"><div class="v-skeleton"></div></div></div>`;
}

async function bpbRender(forceBody = false) {
  const host = $("bpb-body");
  if (!host) return;
  // Keep the search input focused across re-renders while typing.
  const focusedQ = document.activeElement?.id === "bpb-q" ? document.activeElement.value : null;
  try {
    await bpbEnsure();
    if (!$("bpb-body")) return;
    const c = BPB.counts || {};
    const expiring = (BPB.rows || []).filter(
      (r) => r.status === "sold" && r.expire_at && r.expire_at * 1000 - Date.now() < 3 * 86400000,
    ).length;
    const cards = [
      ["", c.total || (BPB.rows || []).length, L("کل اکانت‌ها", "Total accounts")],
      ["free", c.free || 0, L("آزاد", "Free")],
      ["sold", c.sold || 0, L("فروخته‌شده", "Sold")],
      ["error", c.error || 0, L("خطا", "Errors")],
      ["pending_install", c.pending_install || 0, L("در انتظار نصب", "Pending")],
    ]
      .map(
        ([st, n, label]) =>
          `<button data-act="bpbStatFilter" data-status="${st}" class="${CLS.card} p-5 text-start ${BPB.status === st ? "ring-2 ring-sky-400" : ""}"><strong class="block text-2xl">${fmtNum(n)}</strong><span class="v-meta">${label}</span></button>`,
      )
      .join("");
    const s = BPB.defaults || {};
    const defaultsCard = vSection(
      L("تنظیمات پیش‌فرض نصب", "Default install settings"),
      `<div class="grid sm:grid-cols-2 gap-4">${vField("bpb-def-ips", L("Proxy IP / Clean IP (با کاما)", "Proxy IPs (comma-separated)"), (s.proxyIPs || []).join(", "), 'dir="ltr"')}${vSelect("bpb-def-mode", L("حالت Proxy IP", "Proxy IP mode"), [["proxyip", "proxyip"], ["direct", "direct"], ["none", "none"]], s.proxyIpMode || "proxyip")}${vField("bpb-def-fallback", L("Fallback (اختیاری)", "Fallback (optional)"), s.fallback || "", 'dir="ltr"')}${vField("bpb-def-doh", L("DoH URL (اختیاری)", "DoH URL (optional)"), s.dohUrl || "", 'dir="ltr"')}</div><p class="v-meta mt-2">${L("موقع هر نصب اعمال می‌شود؛ تنظیمات تکی هر اکانت بر آن غلبه می‌کند.", "Applied at install time; per-account settings override them.")}</p>`,
      bpbBtn(t("save"), "bpbDefaultsSave", "", true),
    );
    const sel = BPB.selected.size;
    const     bulkBar = sel
      ? `<div class="v-row !border-sky-500"><div class="v-row-main"><p class="text-sm font-bold">${fmtNum(sel)} ${L("انتخاب شده", "selected")}</p></div><div class="v-actions">${bpbBtn(L("نصب", "Install"), "bpbBulkInstall")}${bpbBtn(L("قطع دسترسی", "Revoke"), "bpbBulkRevoke")}${bpbBtn(L("تنظیمات دیپلوی", "Deploy settings"), "bpbBulkSettings")}${bpbBtn(L("تنظیمات پنل", "Panel settings"), "bpbBulkPanelSettings")}${bpbBtn(L("حذف", "Delete"), "bpbBulkDelete")}${bpbBtn(L("لغو انتخاب", "Clear"), "bpbClearSel")}</div></div>`
      : "";
    const rows = bpbFiltered();
    const pages = Math.max(1, Math.ceil(rows.length / BPB.perPage));
    if (BPB.page >= pages) BPB.page = pages - 1;
    const slice = rows.slice(BPB.page * BPB.perPage, BPB.page * BPB.perPage + BPB.perPage);
    const pageIds = slice.map((r) => r.id);
    const allPage = pageIds.length > 0 && pageIds.every((id) => BPB.selected.has(id));
    const list =
      `<div class="v-row !py-2"><input type="checkbox" data-bpb-check="page" ${allPage ? "checked" : ""} aria-label="${L("انتخاب صفحه", "Select page")}"><div class="v-row-main text-xs v-meta">${fmtNum(rows.length)} ${L("مورد", "records")} · ${fmtNum(sel)} ${L("انتخاب شده", "selected")}${rows.length > pageIds.length ? ` · <button type="button" class="underline" data-act="bpbSelectAll">${L("انتخاب همه نتایج فیلتر", "Select all filtered")}</button>` : ""}</div><div class="v-actions">${bpbBtn(L("خروجی CSV", "Export CSV"), "bpbExport")}</div></div>` +
      (slice.length
        ? slice
            .map(
              (r) =>
                `<div class="v-row"><input type="checkbox" data-bpb-check="${r.id}" ${BPB.selected.has(r.id) ? "checked" : ""} aria-label="${esc(r.label || r.id)}"><span class="v-icon">${vIcon("cloud")}</span><div class="v-row-main"><p class="text-sm font-bold">${esc(r.label)} ${bpbBadge(r.status)}</p><p class="v-meta">${esc(r.cf_email || "")} · ${esc(r.worker_name || "")}${r.panel_url ? `<br><span class="v-code" dir="ltr">${esc(r.panel_url)}</span>` : ""}${r.status === "sold" ? `<br>${L("کاربر", "User")}: ${esc(r.sold_user_id || "")} · ` + bpbExpiry(r) : ""}${r.last_error ? `<br><span class="text-rose-400">${esc(r.last_error)}</span>` : ""}</p></div><div class="v-actions">${["pending_install", "error"].includes(r.status) ? bpbBtn(L("نصب", "Install"), "bpbInstall", `data-id="${r.id}"`) : ""}${r.status === "sold" ? bpbBtn(L("قطع دسترسی", "Revoke"), "bpbRevoke", `data-id="${r.id}"`) : ""}${bpbBtn(L("حذف", "Delete"), "bpbDelete", `data-id="${r.id}"`)}${r.panel_url ? bpbBtn(L("تنظیمات دیپلوی", "Deploy settings"), "bpbSettings", `data-id="${r.id}"`) : ""}${r.panel_url ? bpbBtn(L("تنظیمات پنل", "Panel settings"), "bpbPanelSettings", `data-id="${r.id}"`, true) : ""}${r.hasPanelPass ? bpbBtn(L("پسورد پنل", "Panel password"), "bpbPanelPass", `data-id="${r.id}"`) : ""}${bpbBtn(L("توکن", "Token"), "bpbToken", `data-id="${r.id}"`)}${bpbBtn(L("تعویض توکن", "Replace token"), "bpbTokenReplace", `data-id="${r.id}"`)}</div></div>`,
            )
            .join("")
        : vEmpty(L("موردی با این فیلتر نیست.", "Nothing matches this filter."), "cloud"));
    const pager =
      pages > 1
        ? `<div class="v-actions mt-4"><span class="v-meta me-auto">${L("صفحه", "Page")} ${fmtNum(BPB.page + 1)} / ${fmtNum(pages)}</span>${BPB.page ? bpbBtn("‹", "bpbPage", `data-page="${BPB.page - 1}"`) : ""}${BPB.page < pages - 1 ? bpbBtn("›", "bpbPage", `data-page="${BPB.page + 1}"`) : ""}</div>`
        : "";
    const toolbar = `<div class="grid sm:grid-cols-4 gap-3 mb-4"><input id="bpb-q" class="${CLS.input}" placeholder="${L("جستجو: نام، ایمیل، ورکر…", "Search: label, email, worker…")}" value="${esc(BPB.q)}" dir="auto">${vSelect("bpb-status", L("وضعیت", "Status"), [["", L("همه وضعیت‌ها", "All statuses")], ...BPB_STATUSES.map((st) => [st, bpbStatus(st)])], BPB.status)}${vSelect("bpb-sort", L("مرتب‌سازی", "Sort"), [["updated", L("آخرین تغییر", "Recently updated")], ["label", L("نام", "Label")], ["expire", L("نزدیک‌ترین انقضا", "Expiring first")], ["created", L("جدیدترین", "Newest")]], BPB.sort)}${vSelect("bpb-perpage", L("در صفحه", "Per page"), [["25", "25"], ["50", "50"], ["100", "100"]], String(BPB.perPage))}</div>`;
    const expNote = expiring
      ? vNote(L(`${expiring} اسلات تا ۳ روز آینده منقضی می‌شود.`, `${expiring} slot(s) expire within 3 days.`), true)
      : "";
    host.innerHTML =
      `<div class="v-grid v-stagger">${cards}</div><div class="mt-4">${expNote}${defaultsCard}</div><div class="mt-4">${vSection(L("اکانت‌ها", "Accounts"), toolbar + bulkBar + list + pager, bpbBtn(L("تنظیمات دیپلوی گروهی", "Bulk deploy settings"), "bpbBulkSettingsTop"))}</div><div class="mt-4">${vNote(L("برای فروش، یک پنل از نوع BPB بسازید و پلن را به آن وصل کنید؛ خرید، اسلات آزاد را می‌گیرد. توکن‌ها plaintext ذخیره می‌شوند — دسترسی ادمین را محدود نگه دارید.", "To sell, create a BPB-type provider and attach plans to it; purchases consume a free slot. Tokens are stored in plaintext — keep admin access restricted."), true)}</div>`;
    refreshIcons();
    paintDropdowns(host);
    if (typeof updateSaveBar === "function") updateSaveBar();
    if (focusedQ !== null) {
      const q = $("bpb-q");
      if (q) {
        q.focus();
        q.setSelectionRange(q.value.length, q.value.length);
      }
    }
    void forceBody;
  } catch (e) {
    host.innerHTML = vNote(esc(vError(e.message)), true) + `<div class="mt-4">${bpbBtn(t("refresh"), "bpbRefresh")}</div>`;
  }
}

ACTIONS.bpbRefresh = async () => {
  BPB.rows = null;
  await bpbRender();
};
ACTIONS.bpbStatFilter = async (d) => {
  BPB.status = BPB.status === d.status ? "" : d.status;
  BPB.page = 0;
  await bpbRender();
};
ACTIONS.bpbPage = async (d) => {
  BPB.page = Math.max(0, Number(d.page) || 0);
  await bpbRender();
};
ACTIONS.bpbSelectAll = async () => {
  for (const r of bpbFiltered()) BPB.selected.add(r.id);
  await bpbRender();
};
ACTIONS.bpbClearSel = async () => {
  BPB.selected.clear();
  await bpbRender();
};
document.addEventListener("change", (e) => {
  if (e.target?.dataset?.bpbCheck === "page") {
    const rows = bpbFiltered().slice(BPB.page * BPB.perPage, BPB.page * BPB.perPage + BPB.perPage);
    if (e.target.checked) rows.forEach((r) => BPB.selected.add(r.id));
    else rows.forEach((r) => BPB.selected.delete(r.id));
    bpbRender();
  } else if (e.target?.dataset?.bpbCheck) {
    if (e.target.checked) BPB.selected.add(e.target.dataset.bpbCheck);
    else BPB.selected.delete(e.target.dataset.bpbCheck);
    bpbRender();
  }
  if (e.target?.id === "bpb-status") {
    BPB.status = e.target.value;
    BPB.page = 0;
    bpbRender();
  }
  if (e.target?.id === "bpb-sort") {
    BPB.sort = e.target.value;
    bpbRender();
  }
  if (e.target?.id === "bpb-perpage") {
    BPB.perPage = Number(e.target.value) || 50;
    BPB.page = 0;
    bpbRender();
  }
});
let bpbSearchTimer = null;
document.addEventListener("input", (e) => {
  if (e.target?.id === "bpb-q") {
    clearTimeout(bpbSearchTimer);
    const v = e.target.value;
    bpbSearchTimer = setTimeout(() => {
      // Avoid clobbering the focused input: patch state without full render.
      BPB.q = v;
      BPB.page = 0;
      bpbRender();
    }, 350);
  }
});

/* ---------- single-item actions ---------- */
ACTIONS.bpbNew = () =>
  vModal(
    L("اکانت Cloudflare جدید", "New Cloudflare account"),
    vField("bpb-label", L("نام نمایشی", "Label"), "", 'required maxlength="100"') +
      vField("bpb-token", L("API Token کلادفلر", "Cloudflare API token"), "", 'type="password" required dir="ltr" autocomplete="new-password"') +
      vNote(L("دسترسی پیشنهادی: Edit Workers + خواندن Account Settings + KV.", "Suggested scope: edit Workers, read account settings, KV.")),
    "bpbSave",
  );
ACTIONS.bpbSave = async () => {
  await bpbAPI("/accounts", { method: "POST", body: { label: vVal("bpb-label"), apiToken: vVal("bpb-token") } });
  closeModal();
  toast(t("saved"), "success");
  BPB.rows = null;
  await bpbRender();
};
ACTIONS.bpbInstall = async (d, el) => {
  if (el) el.disabled = true;
  try {
    const r = await bpbAPI("/accounts/" + d.id + "/install", { method: "POST" });
    toast(r.account.panel_url || t("saved"), "success");
    BPB.rows = null;
    await bpbRender();
    if (r.account.hasPanelPass) await ACTIONS.bpbPanelPass({ id: d.id });
  } catch (e) {
    toast(vError(e.message), "error");
  } finally {
    if (el) el.disabled = false;
  }
};
ACTIONS.bpbRevoke = async (d, el) => {
  if (
    !(await confirmDlg(
      L("لینک ساب این اسلات می‌میرد و اسلات آزاد می‌شود. ادامه؟", "The sub link will die and the slot returns to free. Continue?"),
      L("قطع دسترسی", "Revoke"),
    ))
  )
    return;
  if (el) el.disabled = true;
  try {
    await bpbAPI("/accounts/" + d.id + "/revoke", { method: "POST" });
    toast(t("saved"), "success");
    BPB.rows = null;
    await bpbRender();
  } catch (e) {
    toast(vError(e.message), "error");
  } finally {
    if (el) el.disabled = false;
  }
};
ACTIONS.bpbDelete = async (d) => {
  const r = (BPB.rows || []).find((x) => x.id === d.id);
  const sold = r?.status === "sold";
  if (
    !(await confirmDlg(
      sold
        ? L("این اسلات فروخته‌شده حذف شود؟ لینک خریدار می‌میرد و مبلغ برنمی‌گردد. فقط برای ردیف تستی/خراب استفاده کنید.", "Delete this SOLD slot? The buyer link dies with no refund. Only for test/broken rows.")
        : L("این اکانت حذف شود؟ (ورکر هم در صورت امکان پاک می‌شود)", "Delete this account? (The worker is removed if reachable)"),
      t("remove"),
    ))
  )
    return;
  await bpbAPI("/accounts/" + d.id, { method: "DELETE", body: sold ? { force: true } : {} });
  BPB.rows = null;
  await bpbRender();
};
ACTIONS.bpbToken = async (d) => {
  const r = await bpbAPI("/accounts/" + d.id + "/token");
  openModal(
    `<div class="p-6"><h3 class="font-bold mb-4">${L("توکن Cloudflare", "Cloudflare token")}</h3><textarea readonly dir="ltr" rows="3" class="${CLS.input}">${esc(r.token)}</textarea><p class="v-meta mt-2">${L("این توکن را با کسی به اشتراک نگذارید.", "Do not share this token with anyone.")}</p><div class="mt-4 flex gap-2">${bpbBtn(t("copy"), "bpbCopyToken", `data-token="${esc(r.token)}"`)}${bpbBtn(t("close"), "modalClose")}</div></div>`,
  );
};
ACTIONS.bpbCopyToken = async (d) => {
  try {
    await navigator.clipboard.writeText(d.token);
    toast(t("copied"), "success");
  } catch {
    toast(t("errorGeneric"), "error");
  }
};
ACTIONS.bpbTokenReplace = (d) => {
  BPB.editId = d.id;
  vModal(
    L("تعویض توکن Cloudflare", "Replace Cloudflare token"),
    vField("bpb-new-token", L("API Token جدید", "New API token"), "", 'type="password" required dir="ltr" autocomplete="new-password"') +
      vNote(L("توکن قبلی (حتی اگر با VAULT_KEY قدیمی قفل شده باشد) جایگزین می‌شود و اکانت دوباره قابل مدیریت می‌شود.", "Replaces the previous token — even one locked by a lost VAULT_KEY — and makes the account manageable again.")),
    "bpbTokenReplaceSave",
  );
};
ACTIONS.bpbTokenReplaceSave = async () => {
  await bpbAPI("/accounts/" + BPB.editId + "/token", { method: "POST", body: { apiToken: vVal("bpb-new-token") } });
  closeModal();
  toast(t("saved"), "success");
  BPB.rows = null;
  await bpbRender();
};
ACTIONS.bpbSettings = (d) => {
  const r = (BPB.rows || []).find((x) => x.id === d.id) || { settings: {} };
  const s = r.settings || {};
  BPB.editId = d.id;
  vModal(
    L("تنظیمات دیپلوی", "Deploy settings"),
    vField("bpb-proxyips", L("Proxy IP / Clean IP (با کاما)", "Proxy IPs (comma-separated)"), (s.proxyIPs || []).join(", "), 'dir="ltr"') +
      vSelect("bpb-proxymode", L("حالت Proxy IP", "Proxy IP mode"), [["proxyip", "proxyip"], ["direct", "direct"], ["none", "none"]], s.proxyIpMode || "proxyip") +
      vField("bpb-fallback", L("Fallback (اختیاری)", "Fallback (optional)"), s.fallback || "", 'dir="ltr"') +
      vField("bpb-doh", L("DoH URL (اختیاری، https)", "DoH URL (optional, https)"), s.dohUrl || "", 'dir="ltr"'),
    "bpbSettingsSave",
  );
};
ACTIONS.bpbSettingsSave = async () => {
  await bpbAPI("/accounts/" + BPB.editId + "/settings", {
    method: "PUT",
    body: {
      settings: { proxyIPs: vList(vVal("bpb-proxyips")), proxyIpMode: vVal("bpb-proxymode"), fallback: vVal("bpb-fallback"), dohUrl: vVal("bpb-doh") },
      allowSold: true,
    },
  });
  closeModal();
  toast(t("saved"), "success");
  BPB.rows = null;
  await bpbRender();
};
ACTIONS.bpbPanelPass = async (d) => {
  const r = await bpbAPI("/accounts/" + d.id + "/panel-password");
  openModal(
    `<div class="p-6"><h3 class="font-bold mb-4">${L("پسورد پنل BPB", "BPB panel password")}</h3><p class="v-meta mb-2">${L("یوزرنیم", "Username")}: <span class="v-code" dir="ltr">${esc(r.username)}</span></p><textarea readonly dir="ltr" rows="2" class="${CLS.input}">${esc(r.password)}</textarea><p class="v-meta mt-2">${r.seeded ? L("این پسورد موقع نصب داخل پنل ست شده؛ اولین بازدید مستقیم وارد لاگین می‌شوید.", "Pre-seeded at install; first open goes straight to login.") : L("ست خودکار ناموفق بود؛ این پسورد را در اولین بازدید پنل وارد کنید.", "Auto-seed failed; enter this password on first panel open.")}</p><div class="mt-4 flex gap-2">${bpbBtn(t("copy"), "bpbCopyToken", `data-token="${esc(r.password)}"`)}${bpbBtn(t("close"), "modalClose")}</div></div>`,
  );
};
ACTIONS.bpbDefaultsSave = async () => {
  await bpbAPI("/defaults", {
    method: "PUT",
    body: {
      settings: { proxyIPs: vList(vVal("bpb-def-ips")), proxyIpMode: vVal("bpb-def-mode"), fallback: vVal("bpb-def-fallback"), dohUrl: vVal("bpb-def-doh") },
    },
  });
  toast(t("saved"), "success");
  BPB.rows = null;
  await bpbRender();
};

/* ---------- bulk operations (sequential with progress) ---------- */
function bpbBulkIds() {
  return [...BPB.selected].filter((id) => (BPB.rows || []).some((r) => r.id === id));
}
ACTIONS.bpbBulkInstall = (d) =>
  bpbBulkRun(L("نصب گروهی", "Bulk install"), bpbBulkIds(), (id) =>
    bpbAPI("/accounts/" + id + "/install", { method: "POST" }),
  );
ACTIONS.bpbBulkRevoke = async (d) => {
  if (
    !(await confirmDlg(
      L("لینک ساب همه اسلات‌های انتخاب‌شده می‌میرد. ادامه؟", "Sub links of all selected slots will die. Continue?"),
      L("قطع دسترسی", "Revoke"),
    ))
  )
    return;
  bpbBulkRun(L("قطع دسترسی گروهی", "Bulk revoke"), bpbBulkIds(), (id) =>
    bpbAPI("/accounts/" + id + "/revoke", { method: "POST" }),
  );
};
ACTIONS.bpbBulkDelete = async (d) => {
  const ids = bpbBulkIds();
  const sold = ids.filter((id) => (BPB.rows || []).find((r) => r.id === id)?.status === "sold").length;
  if (
    !(await confirmDlg(
      sold
        ? L(`${sold} اسلات فروخته‌شده هم حذف می‌شود (force)؛ لینک خریداران می‌میرد. ادامه؟`, `${sold} SOLD slot(s) will be force-deleted; buyer links die. Continue?`)
        : L(`${ids.length} اکانت حذف شود؟`, `Delete ${ids.length} account(s)?`),
      t("remove"),
    ))
  )
    return;
  const byId = Object.fromEntries((BPB.rows || []).map((r) => [r.id, r.status]));
  bpbBulkRun(L("حذف گروهی", "Bulk delete"), ids, (id) =>
    bpbAPI("/accounts/" + id, { method: "DELETE", body: byId[id] === "sold" ? { force: true } : {} }),
  );
};
ACTIONS.bpbBulkSettings = () =>
  vModal(
    L("تنظیمات گروهی", "Bulk settings"),
    `<p class="v-meta mb-4">${fmtNum(BPB.selected.size)} ${L("اکانت انتخاب شده", "accounts selected")}</p>` +
      vField("bpb-bulk-ips", L("Proxy IPها (خالی = بدون تغییر)", "Proxy IPs (empty = no change)"), "", 'dir="ltr"') +
      vSelect("bpb-bulk-mode", L("حالت Proxy IP", "Proxy IP mode"), [["", L("بدون تغییر", "No change")], ["proxyip", "proxyip"], ["direct", "direct"], ["none", "none"]], "") +
      vField("bpb-bulk-fallback", L("Fallback (خالی = بدون تغییر)", "Fallback (empty = no change)"), "", 'dir="ltr"') +
      vField("bpb-bulk-doh", L("DoH URL (خالی = بدون تغییر)", "DoH URL (empty = no change)"), "", 'dir="ltr"'),
    "bpbBulkSettingsSave",
  );
ACTIONS.bpbBulkSettingsTop = () => {
  if (!BPB.selected.size) {
    toast(L("اول چند اکانت را با چک‌باکس انتخاب کنید.", "Select accounts with checkboxes first."), "warn");
    return;
  }
  ACTIONS.bpbBulkSettings();
};
ACTIONS.bpbBulkSettingsSave = async () => {
  const settings = {};
  if (vVal("bpb-bulk-ips")) settings.proxyIPs = vList(vVal("bpb-bulk-ips"));
  if (vVal("bpb-bulk-mode")) settings.proxyIpMode = vVal("bpb-bulk-mode");
  if (vVal("bpb-bulk-fallback")) settings.fallback = vVal("bpb-bulk-fallback");
  if (vVal("bpb-bulk-doh")) settings.dohUrl = vVal("bpb-bulk-doh");
  if (!Object.keys(settings).length) {
    toast(L("چیزی برای اعمال نیست.", "Nothing to apply."), "warn");
    return;
  }
  closeModal();
  await bpbBulkRun(L("تنظیمات گروهی", "Bulk settings"), bpbBulkIds(), (id) =>
    bpbAPI("/accounts/" + id + "/settings", { method: "PUT", body: { settings, allowSold: true } }),
  );
};
function bpbBulkRun(title, ids, fn) {
  if (!ids.length) {
    toast(L("موردی انتخاب نشده است.", "Nothing selected."), "warn");
    return Promise.resolve();
  }
  BPB.bulk = { title, ids, i: 0, ok: 0, fail: 0, errors: [], cancelled: false };
  openModal(
    `<div class="p-6"><h3 class="font-bold mb-2">${esc(title)}</h3><p class="v-meta"><span id="bpb-bulk-count">0</span> / ${fmtNum(ids.length)}</p><div class="mt-3 rounded-full bg-slate-200 dark:bg-slate-700" style="height:10px;overflow:hidden"><div id="bpb-bulk-bar" style="height:100%;width:0%;background:#38bdf8;transition:width .2s"></div></div><div id="bpb-bulk-log" class="v-meta mt-3 space-y-1" style="max-height:160px;overflow:auto"></div><div class="mt-4 flex gap-2"><span id="bpb-bulk-done" class="hidden">${bpbBtn(t("close"), "modalClose")}</span>${bpbBtn(L("انصراف", "Cancel"), "bpbBulkCancel")}</div></div>`,
  );
  refreshIcons();
  const step = async () => {
    const job = BPB.bulk;
    if (!job || job.cancelled) return bpbBulkFinish(true);
    if (job.i >= job.ids.length) return bpbBulkFinish(false);
    const id = job.ids[job.i++];
    try {
      await fn(id);
      job.ok++;
    } catch (e) {
      job.fail++;
      job.errors.push(`${id.slice(0, 8)}: ${vError(e.message)}`);
    }
    const count = $("bpb-bulk-count"),
      bar = $("bpb-bulk-bar"),
      log = $("bpb-bulk-log");
    if (count) count.textContent = fmtNum(job.i);
    if (bar) bar.style.width = Math.round((job.i / job.ids.length) * 100) + "%";
    if (log) log.innerHTML = job.errors.slice(-5).map((x) => `<p class="text-rose-400">${esc(x)}</p>`).join("");
    setTimeout(step, 50);
  };
  return step();
}
function bpbBulkFinish(cancelled) {
  const job = BPB.bulk;
  BPB.bulk = null;
  const done = $("bpb-bulk-done");
  if (done) done.classList.remove("hidden");
  if (job) {
    toast(
      `${job.title}: ${job.ok} ✓${job.fail ? ` · ${job.fail} ✗` : ""}${cancelled ? " · " + L("متوقف شد", "stopped") : ""}`,
      job.fail ? "error" : "success",
    );
    BPB.rows = null;
    BPB.selected.clear();
    bpbRender();
  }
}
ACTIONS.bpbBulkCancel = () => {
  if (BPB.bulk) BPB.bulk.cancelled = true;
};
ACTIONS.bpbExport = () => {
  const rows = bpbFiltered();
  const head = "id,label,email,worker,subdomain,panel_url,status,expire_at,sold_user_id";
  const line = (r) =>
    [r.id, r.label, r.cf_email, r.worker_name, r.workers_dev_subdomain, r.panel_url, r.status, r.expire_at ? new Date(r.expire_at * 1000).toISOString() : "", r.sold_user_id || ""]
      .map((v) => `"${String(v || "").replace(/"/g, '""')}"`)
      .join(",");
  const blob = new Blob([[head, ...rows.map(line)].join("\n")], { type: "text/csv;charset=utf-8" });
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob);
  a.download = "bpb-accounts.csv";
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 1000);
  toast(`${fmtNum(rows.length)} ✓`, "success");
};

/* ---------- live panel settings editor (all 75 runtime keys) ---------- */
const BPB_PANEL_GROUPS = [
  ["دی‌ان‌اس", "DNS", ["remoteDNS", "remoteDnsHost", "localDNS", "antiSanctionDNS", "enableIPv6", "fakeDNS"]],
  ["عبور تحریمی", "Sanction bypass", ["bypassIran", "bypassChina", "bypassRussia"]],
  ["عبور سرویس‌ها", "Service routing", ["bypassOpenAi", "bypassGoogleAi", "bypassMicrosoft", "bypassOracle", "bypassDocker", "bypassAdobe", "bypassEpicGames", "bypassIntel", "bypassAmd", "bypassNvidia", "bypassAsus", "bypassHp", "bypassLenovo"]],
  ["مسدودسازی", "Blocking", ["blockAds", "blockPorn", "blockUDP443", "blockMalware", "blockPhishing", "blockCryptominers"]],
  ["قوانین سفارشی", "Custom rules", ["customBypassRules", "customBlockRules", "customBypassSanctionRules"]],
  ["فرگمنت", "Fragment", ["fragmentMode", "fragmentLengthMin", "fragmentLengthMax", "fragmentDelayMin", "fragmentDelayMax", "fragmentMaxSplitMin", "fragmentMaxSplitMax", "fragmentPackets"]],
  ["اتصال", "Connection", ["protocols", "ports", "fingerprint", "enableTFO", "enableECH", "echServerName", "bestPingInterval", "allowLANConnection", "logLevel", "customDomain"]],
  ["پروکسی زنجیره‌ای", "Proxy chain", ["upstreamProxy", "upstreamParams", "chainProxy", "chainProxyParams"]],
  ["CDN و IP تمیز", "CDN & clean IPs", ["cleanIPs", "customCdnAddrs", "customCdnHost", "customCdnSni"]],
  ["وارپ", "Warp", ["warpEndpoints", "warpBestPingInterval", "warpReservedBytes", "warpRemoteDNS"]],
  ["نویز", "Noise", ["xrayUdpNoises", "knockerNoiseMode", "knockerNoiseCountMin", "knockerNoiseCountMax", "knockerNoiseSizeMin", "knockerNoiseSizeMax", "knockerNoiseDelayMin", "knockerNoiseDelayMax", "amneziaNoiseCount", "amneziaNoiseSizeMin", "amneziaNoiseSizeMax"]],
  ["ساب", "Subscription", ["customSubs", "remoteSettings", "customConfigs"]],
];
const BPB_KEY_FA = {
  remoteDNS: "دی‌ان‌اس راه دور", remoteDnsHost: "هاست دی‌ان‌اس", localDNS: "دی‌ان‌اس محلی",
  antiSanctionDNS: "دی‌ان‌اس ضدتحریم", enableIPv6: "فعال‌سازی IPv6", fakeDNS: "دی‌ان‌اس جعلی",
  logLevel: "سطح لاگ", allowLANConnection: "اتصال LAN", customDomain: "دامین سفارشی",
  upstreamProxy: "آپ‌استریم پروکسی", upstreamParams: "پارامتر آپ‌استریم", chainProxy: "چین پروکسی",
  chainProxyParams: "پارامتر چین", cleanIPs: "IPهای تمیز", customCdnAddrs: "آدرس‌های CDN",
  customCdnHost: "هاست CDN", customCdnSni: "SNI سفارشی", bestPingInterval: "فاصله بهترین پینگ",
  protocols: "پروتکل‌ها", ports: "پورت‌ها", fingerprint: "فینگرپرینت", enableTFO: "TFO",
  fragmentMode: "حالت فرگمنت", fragmentLengthMin: "حداقل طول", fragmentLengthMax: "حداکثر طول",
  fragmentDelayMin: "حداقل تأخیر", fragmentDelayMax: "حداکثر تأخیر", fragmentMaxSplitMin: "حداقل اسپلیت",
  fragmentMaxSplitMax: "حداکثر اسپلیت", fragmentPackets: "پکت‌های فرگمنت",
  enableECH: "ECH", echServerName: "نام سرور ECH",
  bypassIran: "عبور ایران", bypassChina: "عبور چین", bypassRussia: "عبور روسیه",
  bypassOpenAi: "عبور OpenAI", bypassGoogleAi: "عبور Google AI", bypassMicrosoft: "عبور مایکروسافت",
  bypassOracle: "عبور اوراکل", bypassDocker: "عبور داکر", bypassAdobe: "عبور ادوبی",
  bypassEpicGames: "عبور اپیک", bypassIntel: "عبور اینتل", bypassAmd: "عبور AMD",
  bypassNvidia: "عبور انویدیا", bypassAsus: "عبور ایسوس", bypassHp: "عبور HP", bypassLenovo: "عبور لنوو",
  blockAds: "مسدودیت تبلیغات", blockPorn: "مسدودیت غیراخلاقی", blockUDP443: "مسدودیت UDP/443",
  blockMalware: "مسدودیت بدافزار", blockPhishing: "مسدودیت فیشینگ", blockCryptominers: "مسدودیت ماینر",
  customBypassRules: "قوانین عبور سفارشی", customBlockRules: "قوانین انسداد سفارشی",
  customBypassSanctionRules: "قوانین تحریم سفارشی",
  warpRemoteDNS: "دی‌ان‌اس وارپ", warpEndpoints: "اندپوینت‌های وارپ",
  warpBestPingInterval: "فاصله پینگ وارپ", warpReservedBytes: "بایت رزرو وارپ",
  xrayUdpNoises: "نویز UDP", knockerNoiseMode: "حالت نویز ناکر",
  knockerNoiseCountMin: "حداقل تعداد نویز", knockerNoiseCountMax: "حداکثر تعداد نویز",
  knockerNoiseSizeMin: "حداقل اندازه نویز", knockerNoiseSizeMax: "حداکثر اندازه نویز",
  knockerNoiseDelayMin: "حداقل تأخیر نویز", knockerNoiseDelayMax: "حداکثر تأخیر نویز",
  amneziaNoiseCount: "تعداد نویز آمنزیا", amneziaNoiseSizeMin: "حداقل اندازه نویز آمنزیا",
  amneziaNoiseSizeMax: "حداکثر اندازه نویز آمنزیا",
  customSubs: "ساب‌های سفارشی", remoteSettings: "تنظیمات راه دور", customConfigs: "کانفیگ سفارشی",
};
const BPB_TEXTAREA_KEYS = new Set([
  "customBypassRules", "customBlockRules", "customBypassSanctionRules",
  "customSubs", "remoteSettings", "customConfigs",
]);
const bpbKeyLabel = (k) => BPB_KEY_FA[k] || k;

function bpbPanelField(key, val) {
  const id = "bps-" + key;
  const label = bpbKeyLabel(key);
  if (typeof val === "boolean") return vCheck(id, label, val);
  if (typeof val === "number") return vField(id, label, val, 'type="number" dir="ltr"');
  if (Array.isArray(val)) {
    if (BPB_TEXTAREA_KEYS.has(key)) return vArea(id, label, val.join("\n"), 4, 'dir="ltr"');
    return vField(id, label, val.join(", "), 'dir="ltr"');
  }
  if (typeof val === "string") {
    if (BPB_TEXTAREA_KEYS.has(key) || val.length > 80 || val.includes("\n"))
      return vArea(id, label, val, 3, 'dir="ltr"');
    return vField(id, label, val, 'dir="ltr"');
  }
  return vField(id, label, val == null ? "" : JSON.stringify(val), 'dir="ltr"');
}

function bpbPanelForm() {
  const ed = BPB.panelEdit;
  if (ed.raw)
    return vArea("bps-raw", "JSON", JSON.stringify(ed.settings, null, 2), 22, 'dir="ltr" spellcheck="false"');
  return BPB_PANEL_GROUPS.map(
    ([fa, en, keys]) =>
      `<details class="v-media-details"><summary>${esc(S.lang === "en" ? en : fa)} (${keys.length})</summary><div class="pt-4 grid sm:grid-cols-2 gap-4">${keys
        .filter((k) => k in ed.settings)
        .map((k) => bpbPanelField(k, ed.settings[k]))
        .join("")}</div></details>`,
  ).join("");
}

function bpbPanelModal() {
  const ed = BPB.panelEdit;
  const row = (BPB.rows || []).find((x) => x.id === ed.id);
  openModal(
    `<div class="p-6"><h3 class="font-bold mb-2">${L("تنظیمات پنل", "Panel settings")} · ${esc(row?.label || "")}</h3>` +
      (row?.status === "sold"
        ? vNote(L("اسلات فروخته‌شده — این تنظیمات لینک خریدار را نمی‌کشد.", "Sold slot — these settings keep the buyer link alive."), true)
        : "") +
      `<div class="v-actions my-3">${bpbBtn(ed.raw ? L("فرم", "Form") : L("JSON خام", "Raw JSON"), "bpbPanelRawToggle")}</div><div id="bps-form">${bpbPanelForm()}</div><div class="mt-4 flex gap-2">${bpbBtn(t("save"), "bpbPanelSettingsSave", "", true)}${bpbBtn(t("close"), "modalClose")}</div></div>`,
  );
  refreshIcons();
}

function bpbCollectPanelForm(orig) {
  const out = {};
  for (const [, , keys] of BPB_PANEL_GROUPS) {
    for (const k of keys) {
      if (!(k in orig)) continue;
      const v = orig[k];
      if (typeof v === "boolean") out[k] = vOn("bps-" + k);
      else if (typeof v === "number") out[k] = Number(vVal("bps-" + k));
      else if (Array.isArray(v)) {
        const text = vVal("bps-" + k);
        out[k] = BPB_TEXTAREA_KEYS.has(k)
          ? text.split(/\r?\n/).map((x) => x.trim()).filter(Boolean)
          : text.split(/[,\n]+/).map((x) => x.trim()).filter(Boolean);
      } else if (v !== null && typeof v === "object") {
        const text = vVal("bps-" + k).trim();
        try {
          out[k] = text ? JSON.parse(text) : v;
        } catch {
          out[k] = text;
        }
      } else out[k] = vVal("bps-" + k);
    }
  }
  return out;
}

ACTIONS.bpbPanelSettings = async (d, el) => {
  if (el) el.disabled = true;
  try {
    const r = await bpbAPI("/accounts/" + d.id + "/panel-settings");
    BPB.panelEdit = { id: d.id, settings: r.settings || {}, raw: false };
    bpbPanelModal();
  } catch (e) {
    toast(vError(e.message), "error");
  } finally {
    if (el) el.disabled = false;
  }
};
ACTIONS.bpbPanelRawToggle = () => {
  if (!BPB.panelEdit) return;
  // Persist what is on screen before switching representation.
  try {
    BPB.panelEdit.settings = BPB.panelEdit.raw
      ? JSON.parse(vVal("bps-raw"))
      : bpbCollectPanelForm(BPB.panelEdit.settings);
  } catch {
    toast(L("JSON معتبر نیست.", "Invalid JSON."), "error");
    return;
  }
  BPB.panelEdit.raw = !BPB.panelEdit.raw;
  bpbPanelModal();
};
ACTIONS.bpbPanelSettingsSave = async () => {
  const ed = BPB.panelEdit;
  if (!ed) return;
  let patch;
  if (ed.raw) {
    try {
      patch = JSON.parse(vVal("bps-raw"));
    } catch {
      toast(L("JSON معتبر نیست.", "Invalid JSON."), "error");
      return;
    }
  } else patch = bpbCollectPanelForm(ed.settings);
  try {
    const r = await bpbAPI("/accounts/" + ed.id + "/panel-settings", { method: "PUT", body: { settings: patch } });
    closeModal();
    toast((r.stripped?.length ? L("ذخیره شد (کلیدهای هویتی نادیده گرفته شد).", "Saved (identity keys ignored).") : t("saved")), "success");
    BPB.rows = null;
    await bpbRender();
  } catch (e) {
    toast(vError(e.message), "error");
  }
};
ACTIONS.bpbBulkPanelSettings = () => {
  if (!BPB.selected.size) {
    toast(L("اول چند اکانت را با چک‌باکس انتخاب کنید.", "Select accounts with checkboxes first."), "warn");
    return;
  }
  vModal(
    L("تنظیمات پنل گروهی (JSON)", "Bulk panel settings (JSON)"),
    `<p class="v-meta mb-4">${fmtNum(BPB.selected.size)} ${L("اکانت انتخاب شده", "accounts selected")}</p>` +
      vArea("bps-bulk-raw", "JSON patch", '{\n  "blockAds": true\n}', 10, 'dir="ltr" spellcheck="false"') +
      vNote(L("فقط کلیدهای معتبر runtime اعمال می‌شود؛ کلیدهای هویتی (securePath و...) نادیده گرفته می‌شوند. روی اسلات فروخته‌شده هم امن است.", "Only valid runtime keys apply; identity keys are ignored. Safe on sold slots.")),
    "bpbBulkPanelSettingsSave",
  );
};
ACTIONS.bpbBulkPanelSettingsSave = async () => {
  let patch;
  try {
    patch = JSON.parse(vVal("bps-bulk-raw"));
  } catch {
    toast(L("JSON معتبر نیست.", "Invalid JSON."), "error");
    return;
  }
  closeModal();
  await bpbBulkRun(L("تنظیمات پنل گروهی", "Bulk panel settings"), bpbBulkIds(), (id) =>
    bpbAPI("/accounts/" + id + "/panel-settings", { method: "PUT", body: { settings: patch } }),
  );
};
