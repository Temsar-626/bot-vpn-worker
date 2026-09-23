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
} from "./engine.js";
import { createPayment, attachReceipt, paymentView } from "./payments.js";
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
  };
  return (
    map[code]?.[lang === "en" ? 1 : 0] ||
    tr(
      "عملیات انجام نشد؛ از مینی‌اپ وضعیت را بررسی کنید یا با پشتیبانی تماس بگیرید.",
      "Operation failed. Check the Mini App status or contact support.",
      lang,
    )
  );
}
async function say(env, user, text, rows) {
  const token = await resolveToken(env),
    settings = await serviceSettings(env);
  const decorated = rows?.map((row) =>
    row.map((b) => ({
      ...b,
      ...(settings.buttonStyle ? { style: settings.buttonStyle } : {}),
      ...(settings.premiumEmojiId
        ? { icon_custom_emoji_id: settings.premiumEmojiId }
        : {}),
    })),
  );
  let result = await sendToUser(token, user.id, text, {
    ...(rows ? { reply_markup: { inline_keyboard: decorated } } : {}),
    disable_web_page_preview: true,
  });
  if (
    !result.ok &&
    result.error_code === 400 &&
    rows &&
    (settings.buttonStyle || settings.premiumEmojiId)
  )
    result = await sendToUser(token, user.id, text, {
      reply_markup: { inline_keyboard: rows },
      disable_web_page_preview: true,
    });
  return result;
}
export async function serviceHome(env, user, lang = "fa") {
  const a = await account(env, user.id),
    s = await serviceSettings(env);
  return say(
    env,
    user,
    `${s.brand.name}\n\n💰 ${tr("اعتبار قابل استفاده", "Available credit", lang)}: ${amount(available(a), lang)}`,
    [
      [
        btn(tr("🛍 خرید سرویس", "🛍 Buy service", lang), "vpn:plans:0"),
        btn(tr("📡 سرویس‌های من", "📡 My services", lang), "vpn:mine:0"),
      ],
      [
        btn(tr("💳 کیف پول", "💳 Wallet", lang), "vpn:wallet"),
        btn(tr("🌐 مینی‌اپ", "🌐 Mini App", lang), "vpn:portal"),
      ],
      [
        btn(tr("🧪 تست سرویس", "🧪 Trial", lang), "vpn:trial"),
        btn(tr("🎁 کد هدیه", "🎁 Gift code", lang), "vpn:gift"),
      ],
      [
        btn(
          tr("🤝 درخواست نمایندگی", "🤝 Reseller request", lang),
          "vpn:agent",
        ),
        btn(tr("🎡 گردونه", "🎡 Rewards", lang), "vpn:wheel"),
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
    tr(
      "شماره خود را با دکمه زیر به اشتراک بگذارید. شماره تایپ‌شده تأیید محسوب نمی‌شود.",
      "Share your own contact using the button. A typed number is not verified.",
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
  const slice = plans.slice(page * 8, page * 8 + 8);
  const rows = slice.map((p) => [
    btn(
      `${p.title.slice(0, 32)} · ${amount(p.price, lang)}`,
      `vpn:plan:${p.id}`,
    ),
  ]);
  if (page > 0) rows.push([btn("‹", "vpn:plans:" + (page - 1))]);
  if (plans.length > (page + 1) * 8)
    rows.push([btn("›", "vpn:plans:" + (page + 1))]);
  rows.push([btn(tr("⬅️ منوی خدمات", "⬅️ Services", lang), "vpn:home")]);
  return say(
    env,
    user,
    plans.length
      ? tr("پلن مورد نظر را انتخاب کنید:", "Choose a plan:", lang)
      : tr("هنوز پلنی در دسترس نیست.", "No plans are available yet.", lang),
    rows,
  );
}
async function showServices(env, user, lang, page = 0) {
  const services = (await list(env, "service"))
    .filter((s) => s.userId === String(user.id))
    .sort((a, b) => b.createdAt - a.createdAt);
  const rows = services
    .slice(page * 8, page * 8 + 8)
    .map((s) => [
      btn(
        `${s.title.slice(0, 30)} · ${s.username.slice(0, 20)}`,
        `vpn:service:${s.id}`,
      ),
    ]);
  if (page > 0) rows.push([btn("‹", "vpn:mine:" + (page - 1))]);
  if (services.length > (page + 1) * 8)
    rows.push([btn("›", "vpn:mine:" + (page + 1))]);
  rows.push([btn(tr("⬅️ بازگشت", "⬅️ Back", lang), "vpn:home")]);
  return say(
    env,
    user,
    services.length
      ? tr("سرویس‌های شما:", "Your services:", lang)
      : tr("هنوز سرویسی ثبت نشده است.", "You have no services yet.", lang),
    rows,
  );
}
async function showService(env, user, lang, serviceId) {
  const s = await ownedService(env, user.id, serviceId);
  return say(
    env,
    user,
    `📡 ${s.title}\n${s.username}\n${s.status}\n${tr("حجم", "Quota", lang)}: ${s.dataLimit ? (s.dataLimit / 1073741824).toFixed(2) + " GB" : "∞"}\n${tr("زمان", "Expiry", lang)}: ${s.expiresAt ? new Date(s.expiresAt * 1000).toISOString().slice(0, 10) : "—"}\n${s.lastSyncError ? "⚠️ " + tr("بروزرسانی اطلاعات پنل ناموفق بوده است.", "Provider refresh failed.", lang) : ""}`,
    [
      [
        btn(
          tr("🔑 کانفیگ و لینک", "🔑 Configs & link", lang),
          "vpn:content:" + s.id,
        ),
      ],
      [
        btn(tr("🔄 تمدید", "🔄 Renew", lang), "vpn:renew:" + s.id),
        btn(tr("🌐 مدیریت کامل", "🌐 Manage", lang), "vpn:portal"),
      ],
      [btn(tr("📋 فهرست سرویس‌ها", "📋 My services", lang), "vpn:mine:0")],
    ],
  );
}
async function showQuote(env, user, lang, q) {
  await say(
    env,
    user,
    `🧾 ${q.planTitle}\n${q.volumeGB} GB · ${q.days} ${tr("روز", "days", lang)}\n${tr("مبلغ نهایی", "Total", lang)}: ${amount(q.amount, lang)}\n${tr("اعتبار قابل استفاده", "Available", lang)}: ${amount(q.available, lang)}${q.shortfall ? "\n" + tr("کسری موجودی", "Shortfall", lang) + ": " + amount(q.shortfall, lang) : ""}`,
    [
      [
        btn(
          tr("✅ تأیید خرید از کیف پول", "✅ Pay from wallet", lang),
          "vpn:confirm:" + q.id,
        ),
      ],
      [btn(tr("💳 شارژ کیف پول", "💳 Top up", lang), "vpn:wallet")],
    ],
  );
}
export async function serviceCallback(env, user, lang, data) {
  if (!data.startsWith("vpn:")) return false;
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
    const o = await purchase(env, user.id, value);
    await say(
      env,
      user,
      tr(
        "✅ سفارش ثبت شد. ساخت سرویس در صف سرور انجام می‌شود؛ نتیجه را همین‌جا دریافت می‌کنید.",
        "✅ Order queued. Provisioning runs on the server; delivery will arrive here.",
        lang,
      ) +
        "\n#" +
        o.id,
      [[btn(tr("📡 سرویس‌های من", "📡 My services", lang), "vpn:mine:0")]],
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
      for (let i = 0; i < item.length; i += 3800)
        await say(env, user, item.slice(i, i + 3800));
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
  } else if (act === "portal") await openPortal(env, user, lang);
  else if (act === "wallet") {
    const a = await account(env, user.id),
      gateways = (await list(env, "gateway")).filter((g) => g.enabled);
    await say(
      env,
      user,
      `💰 ${tr("مانده کیف پول", "Wallet balance", lang)}: ${amount(a.balance, lang)}\n${tr("رزرو سفارش‌ها", "Reserved", lang)}: ${amount(a.held, lang)}\n${tr("قابل استفاده", "Available", lang)}: ${amount(available(a), lang)}`,
      gateways
        .map((g) => [btn("➕ " + g.title, "vpn:topup:" + g.id)])
        .concat([
          [
            btn(
              tr("🌐 تاریخچه و پرداخت‌ها", "🌐 Transactions", lang),
              "vpn:portal",
            ),
          ],
        ]),
    );
  } else if (act === "topup") {
    user.flow = { type: "svc_topup", gatewayId: value };
    user.supportOpen = false;
    await putUser(env, user);
    const s = await serviceSettings(env);
    await say(
      env,
      user,
      tr(
        "مبلغ شارژ به تومان را بفرستید:",
        "Send the top-up amount in toman:",
        lang,
      ) +
        `\n${amount(s.topupMin, lang)} — ${amount(s.topupMax, lang)}\n/cancel`,
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
      tr(
        "عکس یا PDF رسید را بفرستید. رسید فقط پس از بررسی مدیر تأیید می‌شود.",
        "Send a receipt photo or PDF. An administrator must verify it.",
        lang,
      ),
    );
  } else if (act === "gift") {
    user.flow = { type: "svc_gift" };
    user.supportOpen = false;
    await putUser(env, user);
    await say(
      env,
      user,
      tr("کد هدیه را بفرستید. /cancel", "Send your gift code. /cancel", lang),
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
      tr("هزینه هر چرخش", "Cost per spin", lang) +
        ": " +
        amount(s.wheel.fee, lang),
      [
        [
          btn(
            tr("🎡 تأیید و چرخش", "🎡 Confirm spin", lang),
            "vpn:spin:" + id() + ":" + s.wheel.fee,
          ),
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
