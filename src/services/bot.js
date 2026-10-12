import { playDice } from "./engagement.js";
import { getSettings, putUser } from "../kv.js";
import { enabled, text as tr } from "../config.js";
import { tgApi, sendToUser, resolveToken } from "../bot-api.js";
import { get, list, assert, id, str, limited, publicHTTPS } from "./common.js";
import { serviceSettings } from "./settings.js";
import {
  account,
  available,
  initializeAccount,
  redeemGift,
  requestAgent,
  spinWheel,
  enterRaffle,
} from "./wallet.js";
import {
  catalogue,
  quote,
  purchase,
  ownedService,
  serviceContent,
  simpleServiceAction,
  bpbRefundQuote,
} from "./engine.js";
import { bpbDailyEstimate } from "./bpb/service.js";
import { createPayment, attachReceipt, paymentView } from "./payments.js";
import { pageIndicator, progressBar } from "./ux.js";
import {
  customerGate,
  portalTicket,
  verifyPhone,
  acceptRules,
} from "./customer-auth.js";

const btn = (text, data) => ({ text, callback_data: data });
const digits = (s) =>
  String(s).replace(/[۰-۹٠-٩]/g, (c) =>
    "۰۱۲۳۴۵۶۷۸۹".includes(c)
      ? "۰۱۲۳۴۵۶۷۸۹".indexOf(c)
      : "٠١٢٣٤٥٦٧٨٩".indexOf(c),
  );
const amount = (n, lang) =>
  Number(n).toLocaleString(lang === "en" ? "en-US" : "fa-IR") +
  " " +
  tr("تومان", "toman", lang);
export function serviceError(code, lang = "fa") {
  const map = {
    insufficient_balance: [
      "موجودی یا اعتبار قابل استفاده کافی نیست؛ ابتدا کیف پول را شارژ کنید.",
      "Insufficient available balance. Top up your wallet first.",
    ],
    quote_expired: [
      "پیش‌فاکتور منقضی شده است؛ دوباره انتخاب کنید.",
      "Quote expired. Choose the plan again.",
    ],
    quote_changed: [
      "قیمت یا تنظیمات تغییر کرده؛ دوباره پیش‌فاکتور بگیرید.",
      "Price or settings changed; request a new quote.",
    ],
    stock_empty: [
      "موجودی کانفیگ این پلن تمام شده است.",
      "This plan is out of stock.",
    ],
    bpb_no_free_slot: [
      "ظرفیت BPB این پلن تمام شده است؛ لطفاً بعداً تلاش کنید.",
      "BPB capacity for this plan is sold out. Try again later.",
    ],
    trial_limit_reached: [
      "سهمیه تست شما تمام شده است.",
      "Your trial allowance has been used.",
    ],
    test_plan_unavailable: [
      "مدیر هنوز پلن تست را تنظیم نکرده است.",
      "No trial plan is configured.",
    ],
    panel_unavailable: [
      "این موقعیت فعلاً در دسترس نیست.",
      "This location is currently unavailable.",
    ],
    phone_verification_required: [
      "ابتدا شماره خود را در ربات تأیید کنید.",
      "Verify your phone in the bot first.",
    ],
    phone_must_belong_to_user: [
      "مخاطب ارسالی باید شماره خودتان باشد.",
      "Share your own Telegram contact.",
    ],
    iran_phone_required: [
      "شماره ایرانی لازم است.",
      "An Iranian mobile number is required.",
    ],
    gift_unavailable: [
      "کد هدیه معتبر نیست یا ظرفیت آن تمام شده است.",
      "Gift code is unavailable.",
    ],
    gift_already_used: [
      "قبلاً از این کد استفاده کرده‌اید.",
      "You already used this gift code.",
    ],
    daily_spin_limit: [
      "سهمیه امروز شما تمام شده است.",
      "Daily spin limit reached.",
    ],
    wheel_budget_exhausted: [
      "بودجه هدیه امروز تمام شده است.",
      "Today’s reward budget is exhausted.",
    ],
    service_operation_pending: [
      "یک عملیات دیگر برای این سرویس در حال انجام است.",
      "Another operation is pending for this service.",
    ],
    provider_network_error: [
      "ارتباط با پنل قطع است؛ نتیجه عملیات در صف بررسی می‌ماند.",
      "The provider is unreachable; inspect the operation status.",
    ],
    public_url_required: [
      "مدیر باید ابتدا نشانی عمومی مینی‌اپ را تنظیم کند.",
      "The administrator must configure the public URL.",
    ],
    vault_key_required: [
      "تنظیم امنیت اتصال هنوز کامل نشده است.",
      "Secure connection settings are incomplete.",
    ],
    rate_limited: [
      "کمی صبر کنید و دوباره تلاش کنید.",
      "Please wait before trying again.",
    ],
    service_shop_unavailable: [
      "فروش خدمات موقتاً متوقف است.",
      "Service sales are temporarily paused.",
    ],
    gateway_unavailable: [
      "روش پرداخت فعال نیست.",
      "This payment method is unavailable.",
    ],
    coupon_unavailable: [
      "کد تخفیف معتبر نیست.",
      "Discount code is unavailable.",
    ],
    panel_action_unsupported: [
      "این عمل در نوع پنل این سرویس پشتیبانی نمی‌شود.",
      "This provider does not support that action.",
    ],
    invalid_amount: ["مبلغ معتبر وارد کنید.", "Enter a valid amount."],
    rentopay_min_amount: [
      "حداقل شارژ با این روش ۱۰۰٬۰۰۰ تومان است.",
      "The minimum top-up with this method is 100,000 toman.",
    ],
    rentopay_max_amount: [
      "حداکثر شارژ با این روش ۵٬۰۰۰٬۰۰۰ تومان است.",
      "The maximum top-up with this method is 5,000,000 toman.",
    ],
    rentopay_amount_step: [
      "مبلغ باید مضربی از ۱٬۰۰۰ تومان باشد (مثلاً ۱۰۰٬۰۰۰).",
      "The amount must be a multiple of 1,000 toman.",
    ],
    gateway_credentials_required: [
      "این روش پرداخت فعلاً تنظیم نشده است؛ به پشتیبانی خبر بدهید.",
      "This payment method is not configured. Please contact support.",
    ],
  };
  return (
    map[code]?.[lang === "en" ? 1 : 0] ||
    tr(
      "عملیات انجام نشد؛ از 📡 سرویس‌های من وضعیت را ببینید یا با پشتیبانی تماس بگیرید.",
      "Operation failed. Check 📡 My services or contact support.",
      lang,
    )
  );
}
function toTelegramButton(b) {
  if (!b || typeof b !== 'object') return null;
  const text = String(b.text || '').trim();
  if (!text) return null;
  const style = ['primary', 'success', 'danger'].includes(b.style) ? b.style : undefined;
  const extras = { ...(style ? { style } : {}), ...(b.disabled === true ? { disabled: true } : {}) };
  if (b.copy_text) return { text, copy_text: b.copy_text, ...extras };
  if (b.type === 'copy') {
    const copyText = String(b.value || '').slice(0, 256);
    if (!copyText) return null;
    return { text, copy_text: { text: copyText }, ...extras };
  }
  if (b.type === 'switch_inline' || b.switch_inline_query !== undefined || b.switch_inline_query_current_chat !== undefined) {
    const q = String(b.value ?? b.switch_inline_query ?? b.switch_inline_query_current_chat ?? '').slice(0, 256);
    if (b.switch_current || b.switch_inline_query_current_chat !== undefined) return { text, switch_inline_query_current_chat: q, ...extras };
    return { text, switch_inline_query: q, ...extras };
  }
  if (b.web_app) return { text, web_app: b.web_app, ...extras };
  if (b.url) return { text, url: b.url, ...extras };
  if (b.callback_data) return { text, callback_data: b.callback_data, ...extras };
  return null;
}
async function say(env, user, text, rows) {
  const token = await resolveToken(env),
    settings = await serviceSettings(env);
  const decorated = rows?.map((row) =>
    row.map((b) => {
      const base = toTelegramButton(b) || b;
      return {
        ...base,
        // Per-button style wins; global buttonStyle is only a fallback for
        // buttons without an explicit semantic color (old clients ignore it).
        ...(!base.style && settings.buttonStyle ? { style: settings.buttonStyle } : {}),
        ...(!base.icon_custom_emoji_id && settings.premiumEmojiId
          ? { icon_custom_emoji_id: settings.premiumEmojiId }
          : {}),
      };
    }).filter(Boolean),
  ).filter((row) => row.length);
  let result = await sendToUser(token, user.id, text, {
    ...(rows ? { reply_markup: { inline_keyboard: decorated } } : {}),
    disable_web_page_preview: true,
  });
  if (
    !result.ok &&
    result.error_code === 400 &&
    rows &&
    (settings.buttonStyle || settings.premiumEmojiId)
  ) {
    // Fallback for old clients: same buttons without style/emoji.
    const plain = rows?.map((row) =>
      row.map((b) => {
        const base = toTelegramButton(b);
        if (!base) return null;
        const { style, icon_custom_emoji_id, disabled, ...rest } = base;
        return rest;
      }).filter(Boolean),
    ).filter((row) => row.length);
    result = await sendToUser(token, user.id, text, {
      reply_markup: { inline_keyboard: plain },
      disable_web_page_preview: true,
    });
  }
  return result;
}
export async function serviceHome(env, user, lang = "fa") {
  const a = await account(env, user.id),
    s = await serviceSettings(env);
  const brand = lang === 'en' ? (s.brand.nameEn || s.brand.name) : s.brand.name;
  // Dashboard hero: 1-line title + credit + 1-line hint (max 5 lines total).
  const text =
    `${brand}\n\n💰 ${tr("اعتبار قابل استفاده", "Available credit", lang)}: ${amount(available(a), lang)}` +
    `\n${tr("خرید، تمدید و مدیریت سرویس از دکمه‌های زیر:", "Buy, renew and manage from the buttons below:", lang)}`;
  return say(
    env,
    user,
    text,
    [
      [
        { text: tr("🛍 خرید سرویس", "🛍 Buy service", lang), callback_data: "vpn:plans:0", style: "success" },
        btn(tr("📡 سرویس‌های من", "📡 My services", lang), "vpn:mine:0"),
      ],
      [
        btn(tr("💳 کیف پول", "💳 Wallet", lang), "vpn:wallet"),
        btn(tr("🧪 تست سرویس", "🧪 Trial", lang), "vpn:trial"),
      ],
      [
        btn(tr("🎁 کد هدیه", "🎁 Gift code", lang), "vpn:gift"),
        btn(tr("🎡 گردونه", "🎡 Rewards", lang), "vpn:wheel"),
      ],
      [
        btn(
          tr("🤝 درخواست نمایندگی", "🤝 Reseller request", lang),
          "vpn:agent",
        ),
        btn(tr("🎲 تاس رایگان", "🎲 Free dice", lang), "vpn:dice:" + id()),
      ],
    ],
  );
}
async function passGate(env, user, lang) {
  const g = await customerGate(env, user),
    settings = await serviceSettings(env);
  if (!g.membership) return false;
  if (g.rulesRequired) {
    await say(
      env,
      user,
      lang === "en" ? settings.rulesEn || settings.rules : settings.rules,
      [
        [
          btn(
            tr("✅ قوانین را می‌پذیرم", "✅ Accept rules", lang),
            "vpn:rules:" + settings.rulesVersion,
          ),
        ],
      ],
    );
    return false;
  }
  if (g.phoneRequired) {
    await requestPhone(env, user, lang);
    return false;
  }
  return true;
}
async function requestPhone(env, user, lang) {
  user.flow = { type: "svc_phone" };
  user.supportOpen = false;
  await putUser(env, user);
  await sendToUser(
    await resolveToken(env),
    user.id,
    `📱 ${tr("تأیید شماره", "Verify phone", lang)} · ${tr("مرحله ۱/۱", "Step 1/1", lang)}\n` +
    tr(
      "دکمه زیر را بزنید تا شماره خودتان ارسال شود. شماره تایپ‌شده قبول نیست.\n/cancel",
      "Tap the button below to share your own contact. A typed number is not accepted.\n/cancel",
      lang,
    ),
    {
      reply_markup: {
        keyboard: [
          [
            {
              text: tr("📱 ارسال شماره من", "📱 Share my phone", lang),
              request_contact: true,
            },
          ],
        ],
        resize_keyboard: true,
        one_time_keyboard: true,
      },
    },
  );
}
async function openPortal(env, user, lang) {
  const s = await serviceSettings(env),
    v2 = await getSettings(env),
    base = s.publicUrl || v2.publicBaseUrl || env.PUBLIC_BASE_URL;
  assert(base && publicHTTPS(base), "public_url_required");
  const ticket = await portalTicket(env, user.id);
  return say(
    env,
    user,
    tr(
      "پنل مشتری را باز کنید. لینک ورود شخصی و یک‌بارمصرف است؛ آن را برای دیگران نفرستید.",
      "Open your customer portal. The login link is private and single-use; do not share it.",
      lang,
    ),
    [
      [
        {
          text: tr("🌐 باز کردن مینی‌اپ", "🌐 Open Mini App", lang),
          web_app: {
            url: base.replace(/\/$/, "") + "/portal/#ticket=" + ticket,
          },
        },
      ],
    ],
  );
}
async function showPlans(env, user, lang, page = 0) {
  const plans = await catalogue(env, user.id);
  const per = 8, totalPages = Math.max(1, Math.ceil(plans.length / per));
  const cur = Math.max(0, Math.min(page, totalPages - 1));
  const slice = plans.slice(cur * per, cur * per + per);
  const rows = slice.map((p) => {
    const soldOut = p.stockLeft !== undefined && Number(p.stockLeft) <= 0;
    const label = `${p.title.slice(0, 20)} · ${amount(p.price, lang)}`;
    if (soldOut) {
      return [{ text: `🔒 ${label}`, callback_data: `vpn:plan:${p.id}`, disabled: true }];
    }
    return [btn(label, `vpn:plan:${p.id}`)];
  });
  if (!plans.length) {
    return say(
      env,
      user,
      tr("هنوز پلنی در دسترس نیست.\nبه‌زودی پلن‌های جدید اضافه می‌شود.", "No plans are available yet.\nNew plans are coming soon.", lang),
      [
        [{ text: tr("🛡 پشتیبانی", "🛡 Support", lang), callback_data: "support:open" }],
        [{ text: tr("🏠 خدمات", "🏠 Services", lang), callback_data: "vpn:home" }],
      ],
    );
  }
  // Pagination in ONE row: prev + ۱/۳ + next (not cryptic ‹ › alone).
  if (totalPages > 1) {
    const nav = [];
    if (cur > 0) nav.push(btn("‹ " + tr("قبلی", "Prev", lang), "vpn:plans:" + (cur - 1)));
    nav.push({ text: `📄 ${pageIndicator(cur, totalPages, lang)}`, callback_data: "vpn:noop" });
    if (cur < totalPages - 1) nav.push(btn(tr("بعدی", "Next", lang) + " ›", "vpn:plans:" + (cur + 1)));
    rows.push(nav);
  }
  rows.push([
    btn(tr("◀ خدمات", "◀ Services", lang), "vpn:home"),
    btn(tr("🏠 اصلی", "🏠 Home", lang), "vpn:home"),
  ]);
  return say(
    env,
    user,
    tr("پلن مورد نظر را انتخاب کنید:", "Choose a plan:", lang) +
      (totalPages > 1 ? `\n${pageIndicator(cur, totalPages, lang)}` : ""),
    rows,
  );
}
async function showServices(env, user, lang, page = 0) {
  const services = (await list(env, "service"))
    .filter((s) => s.userId === String(user.id))
    .sort((a, b) => b.createdAt - a.createdAt);
  const per = 8, totalPages = Math.max(1, Math.ceil(services.length / per));
  const cur = Math.max(0, Math.min(page, totalPages - 1));
  if (!services.length) {
    return say(
      env,
      user,
      tr("هنوز سرویسی ثبت نشده است.\nاولین سرویس را با خرید یک پلن بسازید:", "You have no services yet.\nCreate your first one from a plan:", lang),
      [
        [{ text: tr("🛍 خرید سرویس", "🛍 Buy service", lang), callback_data: "vpn:plans:0", style: "success" }],
        [{ text: tr("🏠 خدمات", "🏠 Services", lang), callback_data: "vpn:home" }],
      ],
    );
  }
  const rows = services
    .slice(cur * per, cur * per + per)
    .map((s) => [
      btn(
        `${s.title.slice(0, 18)} · ${s.username.slice(0, 16)}`,
        `vpn:service:${s.id}`,
      ),
    ]);
  if (totalPages > 1) {
    const nav = [];
    if (cur > 0) nav.push(btn("‹ " + tr("قبلی", "Prev", lang), "vpn:mine:" + (cur - 1)));
    nav.push({ text: `📄 ${pageIndicator(cur, totalPages, lang)}`, callback_data: "vpn:noop" });
    if (cur < totalPages - 1) nav.push(btn(tr("بعدی", "Next", lang) + " ›", "vpn:mine:" + (cur + 1)));
    rows.push(nav);
  }
  rows.push([
    btn(tr("◀ خدمات", "◀ Services", lang), "vpn:home"),
    btn(tr("🏠 اصلی", "🏠 Home", lang), "vpn:home"),
  ]);
  return say(
    env,
    user,
    tr("سرویس‌های شما:", "Your services:", lang) +
      (totalPages > 1 ? `\n${pageIndicator(cur, totalPages, lang)}` : ""),
    rows,
  );
}
async function showService(env, user, lang, serviceId) {
  const s = await ownedService(env, user.id, serviceId);
  const panel = s.panelId ? await get(env, "panel", s.panelId) : null;
  const isBpb = panel?.type === "bpb" && !["deleted", "refunded", "cancelled"].includes(s.status);
  const daily = isBpb ? await bpbDailyEstimate(env, s) : null;
  const statusMap = { active: '✅ ' + tr('فعال', 'Active', lang), pending: '⏳ ' + tr('در صف ساخت', 'Queued', lang), provisioning: '⏳ ' + tr('در حال ساخت', 'Provisioning', lang), expired: '⌛ ' + tr('منقضی', 'Expired', lang), deleted: '❌ ' + tr('حذف‌شده', 'Deleted', lang), refunded: '↩️ ' + tr('مستردشده', 'Refunded', lang), cancelled: '❌ ' + tr('لغوشده', 'Cancelled', lang) };
  const status = statusMap[String(s.status || '').toLowerCase()] || String(s.status || '—');
  const expiry = s.expiresAt ? new Date(s.expiresAt * 1000).toLocaleDateString(lang === 'en' ? 'en-US' : 'fa-IR') : '—';
  const quota = s.dataLimit ? (s.dataLimit / 1073741824).toFixed(2) + ' GB' : '∞';
  let dailyLine = '';
  if (daily && Number(daily.quotaGB) > 0) {
    const pct = Math.min(100, Math.round((Number(daily.usedGB) / Number(daily.quotaGB)) * 100));
    dailyLine = `\n📊 ${tr("مصرف امروز (تخمینی)", "Estimated use today", lang)}: ${daily.usedGB} / ${daily.quotaGB} GB\n${progressBar(pct)}`;
  } else if (daily) {
    dailyLine = `\n📊 ${tr("مصرف امروز (تخمینی)", "Estimated use today", lang)}: ${daily.usedGB} / ${daily.quotaGB} GB`;
  }
  return say(
    env,
    user,
    `📡 ${s.title}\n👤 ${s.username}\n${status}\n💾 ${tr("حجم", "Quota", lang)}: ${quota}\n⏳ ${tr("انقضا", "Expiry", lang)}: ${expiry}${dailyLine}${s.lastSyncError ? "\n⚠️ " + tr("بروزرسانی پنل ناموفق بود؛ قفل نیست، بعدا خودکار تلاش می‌شود.", "Provider refresh failed; will retry automatically.", lang) : ""}`,
    [
      [
        { text: tr("🔑 کانفیگ و لینک", "🔑 Configs & link", lang), callback_data: "vpn:content:" + s.id, style: "primary" },
      ],
      [
        { text: tr("🔄 تمدید", "🔄 Renew", lang), callback_data: "vpn:renew:" + s.id, style: "success" },
        btn(tr("🌐 مدیریت کامل", "🌐 Manage", lang), "vpn:portal"),
      ],
      ...(isBpb
        ? [
            [
              { text: tr("❌ لغو و بازگشت وجه", "❌ Cancel & refund", lang), callback_data: "vpn:cancel:" + s.id, style: "danger" },
            ],
          ]
        : []),
      [
        btn(tr("📋 فهرست سرویس‌ها", "📋 My services", lang), "vpn:mine:0"),
        btn(tr("🏠 خدمات", "🏠 Services", lang), "vpn:home"),
      ],
    ],
  );
}
async function showQuote(env, user, lang, q) {
  await say(
    env,
    user,
    `🧾 ${q.planTitle}\n${q.volumeGB} GB · ${q.days} ${tr("روز", "days", lang)}\n💰 ${tr("مبلغ نهایی", "Total", lang)}: ${amount(q.amount, lang)}\n💳 ${tr("اعتبار قابل استفاده", "Available", lang)}: ${amount(q.available, lang)}${q.shortfall ? "\n⚠️ " + tr("کسری موجودی", "Shortfall", lang) + ": " + amount(q.shortfall, lang) : ""}\n⏳ ${tr("۵ دقیقه برای تایید فرصت دارید.", "You have 5 minutes to confirm.", lang)}`,
    [
      [
        { text: tr("✅ تأیید خرید از کیف پول", "✅ Pay from wallet", lang), callback_data: "vpn:confirm:" + q.id, style: "success" },
      ],
      [btn(tr("💳 شارژ کیف پول", "💳 Top up", lang), "vpn:wallet")],
      [
        btn(tr("◀ پلن‌ها", "◀ Plans", lang), "vpn:plans:0"),
        btn(tr("❌ انصراف", "❌ Cancel", lang), "vpn:home"),
      ],
    ],
  );
}
export async function serviceCallback(env, user, lang, data) {
  if (!data.startsWith("vpn:")) return false;
  if (data === "vpn:noop") return true;
  if (!enabled(await getSettings(env), "services")) return false;
  await limited(env, "bot:" + user.id, 30, 60);
  await initializeAccount(env, user);
  const [, act, value] = data.split(":");
  if (act === "rules") {
    await acceptRules(env, user.id, Number(value));
    if (await passGate(env, user, lang)) await serviceHome(env, user, lang);
    return true;
  }
  if (act === "phone") {
    await requestPhone(env, user, lang);
    return true;
  }
  if (!(await passGate(env, user, lang))) return true;
  if (act === "home") await serviceHome(env, user, lang);
  else if (act === "plans")
    await showPlans(env, user, lang, Number(value) || 0);
  else if (act === "plan") {
    const plan = await get(env, "plan", value);
    assert(plan, "plan_unavailable");
    if (plan.custom) await openPortal(env, user, lang);
    else
      await showQuote(
        env,
        user,
        lang,
        await quote(env, user.id, { planId: value }),
      );
  } else if (act === "confirm") {
    await say(env, user, tr("⏳ در حال ثبت سفارش…", "⏳ Placing order…", lang));
    const o = await purchase(env, user.id, value);
    await say(
      env,
      user,
      tr(
        "✅ سفارش ثبت شد.\nساخت سرویس در صف سرور است؛ لینک و کانفیگ همین‌جا می‌آید.",
        "✅ Order queued.\nProvisioning is running; link and config will arrive here.",
        lang,
      ) +
        "\n#" +
        o.id,
      [
        [{ text: tr("📡 سرویس‌های من", "📡 My services", lang), callback_data: "vpn:mine:0", style: "primary" }],
        [{ text: tr("🏠 خدمات", "🏠 Services", lang), callback_data: "vpn:home" }],
      ],
    );
  } else if (act === "trial") {
    const s = await serviceSettings(env);
    assert(s.testPlanId, "test_plan_unavailable");
    const q = await quote(env, user.id, {
      kind: "trial",
      planId: s.testPlanId,
    });
    const o = await purchase(env, user.id, q.id);
    await say(
      env,
      user,
      tr("🧪 سرویس تست در صف ساخت قرار گرفت.", "🧪 Trial queued.", lang) +
        "\n#" +
        o.id,
    );
  } else if (act === "mine")
    await showServices(env, user, lang, Number(value) || 0);
  else if (act === "service") await showService(env, user, lang, value);
  else if (act === "content") {
    const v = await serviceContent(env, user.id, value);
    const parts = [
      ...new Set(
        [v.proxyUrl || v.subscriptionUrl, ...v.configs].filter(Boolean),
      ),
    ];
    for (const item of parts) {
      for (let i = 0; i < item.length; i += 3800) {
        const chunk = item.slice(i, i + 3800);
        await say(env, user, chunk, [
          [{ text: tr("📋 کپی", "📋 Copy", lang), type: "copy", value: chunk.slice(0, 256) }],
        ]);
      }
    }
    if (!parts.length)
      await say(
        env,
        user,
        tr(
          "کانفیگ هنوز در دسترس نیست؛ با پشتیبانی تماس بگیرید.",
          "Configuration is not available yet; contact support.",
          lang,
        ),
      );
  } else if (act === "renew") {
    const s = await ownedService(env, user.id, value);
    await showQuote(
      env,
      user,
      lang,
      await quote(env, user.id, {
        kind: "renew",
        serviceId: s.id,
        planId: s.planId,
      }),
    );
  } else if (act === "cancel") {
    const s = await ownedService(env, user.id, value);
    const q = await bpbRefundQuote(env, s);
    await say(
      env,
      user,
      `❌ ${tr("لغو سرویس و بازگشت وجه به کیف پول؟", "Cancel the service and refund to wallet?", lang)}\n${s.title}\n${tr("روزهای باقی‌مانده", "Remaining days", lang)}: ${q.remainingDays} / ${q.totalDays}\n${tr("مبلغ بازگشتی", "Refund amount", lang)}: ${amount(q.amount, lang)}\n⚠️ ${tr("پس از لغو، لینک اشتراک از کار می‌افتد و قابل بازگشت نیست.", "The subscription link stops working after cancellation and cannot be restored.", lang)}`,
      [
        [
          btn(tr("◀ بازگشت", "◀ Back", lang), "vpn:service:" + s.id),
          { text: tr("💥 بله، لغو کن", "💥 Yes, cancel it", lang), callback_data: "vpn:cancel_yes:" + s.id, style: "danger" },
        ],
      ],
    );
  } else if (act === "cancel_yes") {
    await simpleServiceAction(env, user.id, value, "cancel_refund");
    await showService(env, user, lang, value);
  } else if (act === "portal") await openPortal(env, user, lang);
  else if (act === "wallet") {
    const a = await account(env, user.id),
      gateways = (await list(env, "gateway")).filter((g) => g.enabled);
    const rows = gateways
      .slice(0, 6)
      .map((g) => [{ text: "➕ " + g.title.slice(0, 20), callback_data: "vpn:topup:" + g.id, style: "success" }])
      .concat([
        [
          btn(
            tr("🌐 تاریخچه و پرداخت‌ها", "🌐 Transactions", lang),
            "vpn:portal",
          ),
        ],
        [
          btn(tr("◀ خدمات", "◀ Services", lang), "vpn:home"),
          btn(tr("🏠 اصلی", "🏠 Home", lang), "vpn:home"),
        ],
      ]);
    await say(
      env,
      user,
      `💰 ${tr("کیف پول", "Wallet", lang)}\n${tr("مانده", "Balance", lang)}: ${amount(a.balance, lang)}\n${tr("رزرو سفارش‌ها", "Reserved", lang)}: ${amount(a.held, lang)}\n✅ ${tr("قابل استفاده", "Available", lang)}: ${amount(available(a), lang)}` +
        (gateways.length ? `\n${tr("روش شارژ را انتخاب کنید:", "Choose a top-up method:", lang)}` : `\n⚠️ ${tr("فعلا روش شارژی فعال نیست؛ با پشتیبانی تماس بگیرید.", "No top-up method is active; contact support.", lang)}`),
      rows,
    );
  } else if (act === "topup") {
    user.flow = { type: "svc_topup", gatewayId: value };
    user.supportOpen = false;
    await putUser(env, user);
    const s = await serviceSettings(env);
    await say(
      env,
      user,
      `💳 ${tr("شارژ کیف پول", "Top up wallet", lang)} · ${tr("مرحله ۱/۲", "Step 1/2", lang)}\n${tr("مبلغ به تومان را بفرستید. مثال: 50000", "Send the amount in toman. Example: 50000", lang)}` +
        `\n${tr("محدوده مجاز", "Allowed range", lang)}: ${amount(s.topupMin, lang)} — ${amount(s.topupMax, lang)}\n/cancel`,
      [
        [{ text: tr("❌ انصراف", "❌ Cancel", lang), callback_data: "vpn:wallet" }],
      ],
    );
  } else if (act === "receipt") {
    const p = await get(env, "payment", value);
    assert(p && p.userId === String(user.id), "payment_not_found");
    user.flow = { type: "svc_receipt", paymentId: value };
    user.supportOpen = false;
    await putUser(env, user);
    await say(
      env,
      user,
      `📎 ${tr("ارسال رسید", "Submit receipt", lang)} · ${tr("مرحله ۲/۲", "Step 2/2", lang)}\n${tr("عکس یا PDF رسید را بفرستید (حداکثر ۱۰ مگ). رسید فقط پس از بررسی مدیر تأیید می‌شود.", "Send a receipt photo or PDF (max 10 MB). An administrator must verify it.", lang)}\n/cancel`,
      [
        [{ text: tr("❌ انصراف", "❌ Cancel", lang), callback_data: "vpn:wallet" }],
      ],
    );
  } else if (act === "gift") {
    user.flow = { type: "svc_gift" };
    user.supportOpen = false;
    await putUser(env, user);
    await say(
      env,
      user,
      `🎁 ${tr("کد هدیه", "Gift code", lang)}\n${tr("کد را دقیق بفرستید. مثال: GIFT-ABC123", "Send the exact code. Example: GIFT-ABC123", lang)}\n/cancel`,
      [
        [{ text: tr("❌ انصراف", "❌ Cancel", lang), callback_data: "vpn:home" }],
      ],
    );
  } else if (act === "agent") {
    await requestAgent(env, user.id, "درخواست از ربات");
    await say(
      env,
      user,
      tr(
        "درخواست نمایندگی برای مدیر ثبت شد.",
        "Reseller request submitted.",
        lang,
      ),
    );
  } else if (act === "wheel") {
    const s = await serviceSettings(env);
    await say(
      env,
      user,
      `🎡 ${tr("گردونه شانس", "Lucky wheel", lang)}\n${tr("هزینه هر چرخش", "Cost per spin", lang)}: ` +
        amount(s.wheel.fee, lang) +
        `\n⚠️ ${tr("پس از چرخش مبلغ برگشت ندارد.", "Spins are non-refundable.", lang)}`,
      [
        [
          btn(tr("◀ بازگشت", "◀ Back", lang), "vpn:home"),
          { text: tr("🎡 تأیید و چرخش", "🎡 Confirm spin", lang), callback_data: "vpn:spin:" + id() + ":" + s.wheel.fee, style: "success" },
        ],
      ],
    );
  } else if (act === "dice") {
    const game = await playDice(env, user.id, value || id());
    if (game.status !== "done")
      await say(
        env,
        user,
        tr(
          "نتیجه قابل تأیید نبود؛ ابتدا ربات را شروع کنید یا با پشتیبانی تماس بگیرید.",
          "The roll could not be verified. Start the bot first or contact support.",
          lang,
        ),
      );
  } else if (act === "spin") {
    const r = await spinWheel(env, user.id, value, Number(data.split(":")[3]));
    await say(env, user, `🎁 ${r.prize}\n${amount(r.amount, lang)}`);
  }
  return true;
}
export async function serviceMessage(env, user, lang, msg) {
  if (!enabled(await getSettings(env), "services")) return false;
  const text = String(msg.text || "").trim(),
    cmd = text.split(/\s/)[0].split("@")[0].toLowerCase();
  const known = [
    "/vpn",
    "/wallet",
    "/vpnservices",
    "/vpnportal",
    "/testvpn",
    "/giftcode",
    "/agent",
    "/wheel",
    "/dice",
  ];
  if (user.flow?.type === "svc_phone" && msg.contact) {
    await verifyPhone(env, user.id, msg.contact);
    user.flow = null;
    await putUser(env, user);
    await sendToUser(
      await resolveToken(env),
      user.id,
      tr("✅ شماره تأیید شد.", "✅ Phone verified.", lang),
      { reply_markup: { remove_keyboard: true } },
    );
    await serviceHome(env, user, lang);
    return true;
  }
  if (!known.includes(cmd) && !user.flow?.type?.startsWith("svc_"))
    return false;
  await initializeAccount(env, user);
  if (!(await passGate(env, user, lang))) return true;
  if (known.includes(cmd)) {
    const action = {
      "/vpn": "home",
      "/wallet": "wallet",
      "/vpnservices": "mine:0",
      "/vpnportal": "portal",
      "/testvpn": "trial",
      "/giftcode": "gift",
      "/agent": "agent",
      "/wheel": "wheel",
      "/dice": "dice",
    }[cmd];
    return serviceCallback(env, user, lang, "vpn:" + action);
  }
  if (user.flow?.type === "svc_topup" && text && !text.startsWith("/")) {
    const n = Number(digits(text).replace(/[,،\s]/g, ""));
    const p = await createPayment(env, user.id, {
      gatewayId: user.flow.gatewayId,
      amount: n,
      requestId: id(),
    });
    user.flow = null;
    await putUser(env, user);
    const rows = p.url
      ? [[{ text: tr("💳 پرداخت", "💳 Pay", lang), url: p.url }]]
      : p.type === "manual"
        ? [
            [
              btn(
                tr("📎 ارسال رسید", "📎 Submit receipt", lang),
                "vpn:receipt:" + p.id,
              ),
            ],
          ]
        : [
            [
              btn(
                tr("🌐 ثبت هش و بررسی پرداخت", "🌐 Submit hash / check", lang),
                "vpn:portal",
              ),
            ],
          ];
    await say(
      env,
      user,
      `#${p.id}\n${amount(p.amount, lang)}${p.cardNumber ? "\n💳 " + p.cardNumber + "\n" + p.cardHolder : ""}${p.address ? "\n" + p.address + "\n" + p.cryptoAmount + " " + p.currency + "\nMemo: " + p.memo : ""}`,
      rows,
    );
    return true;
  }
  if (user.flow?.type === "svc_receipt" && !text.startsWith("/")) {
    const f =
      msg.photo?.at(-1) ||
      (msg.document?.mime_type === "application/pdf" ? msg.document : null);
    assert(
      f && (!f.file_size || f.file_size <= 10 * 1024 * 1024),
      "invalid_receipt_file",
    );
    await attachReceipt(env, user.id, user.flow.paymentId, {
      fileId: f.file_id,
      name: msg.document?.file_name || "receipt.jpg",
    });
    user.flow = null;
    await putUser(env, user);
    await say(
      env,
      user,
      tr(
        "✅ رسید برای بررسی ثبت شد؛ هنوز تأیید پرداخت نیست.",
        "✅ Receipt submitted for review, not yet approved.",
        lang,
      ),
    );
    return true;
  }
  if (user.flow?.type === "svc_gift" && text && !text.startsWith("/")) {
    await redeemGift(env, user.id, text);
    user.flow = null;
    await putUser(env, user);
    await say(
      env,
      user,
      tr(
        "🎁 اعتبار هدیه به کیف پول اضافه شد.",
        "🎁 Gift credit added to your wallet.",
        lang,
      ),
    );
    return true;
  }
  return false;
}
