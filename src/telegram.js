import { serviceMessage, serviceCallback, serviceHome, serviceError } from './services/bot.js';
import { starsPreCheckout, starsSuccessful } from './services/payments.js';

import {
  getMenu, getSettings, getUser, putUser, bumpStats, pushRecentUser,
  getPoll, putPoll, pollTotals, getPost, putPost,
  getTicket, ticketAppendUser, getStats,
} from './kv.js';
import { getJson, putJson } from './kv.js';
import { tgApi, resolveToken, sendToUser, beginMessageEdit, endMessageEdit } from './bot-api.js';
export { tgApi, resolveToken, sendToUser } from './bot-api.js';
import { membershipGate, sendMembershipLock, joinUrl } from './gate.js';
import { PURPOSES, enabled, text as tr, assert, str, label, cutBytes, httpsUrl } from './config.js';
import { entityKey, allEntities } from './storage.js';
import { commerceMessage, commerceCallback, catalog, showProduct, showCart, myOrders, checkoutError, resumeMemberDeliveries, searchProducts } from './commerce.js';
import { completeSignup, showPoints, progress } from './crm.js';
import { moderateMessage, groupMemberUpdate, captchaCallback, raffleCallback } from './groups.js';
import { channelPost, relayMessage } from './automation.js';
import { engagementCallback } from './engagement.js';
import { ratesHome, ratesCallback } from './rates.js';
import { newsHome, newsCallback } from './news.js';
import { adminCallback, adminFlow, adminHome, isAdminUser } from './admin-bot.js';
export { renderPollText, pollKeyboard, sendPollToChat, reactMarkup } from './engagement.js';

const BOT_T = {
  fa: {
    chooseLang: '🌍 زبان خود را انتخاب کنید:',
    unknown: '🤔 متوجه نشدم. برای دیدن راهنما /help را بزنید.',
    langSet: '✅ زبان به فارسی تغییر کرد.',
    yourId: '🆔 آیدی عددی شما:',
    pong: '🏓 پونگ! ربات فعال است.',
    singleLang: '🌍 این ربات فقط به فارسی پاسخ می‌دهد.',
    lock: '🔒 برای استفاده از ربات، ابتدا در کانال ما عضو شوید:',
    lockOk: '✅ عضویت تایید شد! ربات برای شما فعال شد. /start را بزنید.',
    lockNo: '❌ هنوز عضو کانال نشده‌اید. ابتدا عضو شوید و دوباره بزنید.',
    lockBtn: '📢 عضویت در کانال',
    lockCheck: '✅ عضو شدم',
    supportIntro: '🛡 حالا در حالت گفتگو با پشتیبانی هستید.\nپیام خود را بنویسید؛ کارشناسان ما در اولین فرصت پاسخ می‌دهند.\n\nبرای پایان /end را بزنید.',
    supportSent: '✅ پیام شما به پشتیبانی ارسال شد. پاسخ را همین‌جا دریافت می‌کنید.',
    supportClosed: '✅ گفتگوی پشتیبانی بسته شد. مجدداً نیاز بود /support را بفرستید.',
    supportReply: '💬 پاسخ پشتیبانی:',
    voteDone: '✅ رأی شما ثبت شد',
    voteMoved: '✅ رأی شما تغییر کرد',
    voteSame: ' شما همین گزینه را انتخاب کرده‌اید',
    voteRefresh: '🔄 نتایج بروزرسانی شد',
    voteGone: '⌛ این نظرسنجی منقضی شده است',
    reactDone: '👍 ثبت شد',
    reactOff: 'برداشته شد',
    back: '⬅️ بازگشت',
    refresh: '🔄 بروزرسانی نتایج',
  },
  en: {
    chooseLang: '🌍 Please choose your language:',
    unknown: "🤔 I didn't understand. Send /help for usage.",
    langSet: '✅ Language changed to English.',
    yourId: '🆔 Your numeric ID:',
    pong: '🏓 Pong! The bot is alive.',
    singleLang: '🌍 This bot only responds in English.',
    lock: '🔒 To use this bot, please join our channel first:',
    lockOk: '✅ Membership confirmed! The bot is now active for you. Send /start.',
    lockNo: "❌ You haven't joined the channel yet. Join first, then tap again.",
    lockBtn: '📢 Join the channel',
    lockCheck: '✅ I joined',
    supportIntro: '🛡 You are now chatting with the support team.\nSend your message; our team will reply here as soon as possible.\n\nSend /end to finish.',
    supportSent: '✅ Your message was sent to support. The reply will arrive here.',
    supportClosed: '✅ Support chat closed. Send /support whenever you need us again.',
    supportReply: '💬 Support reply:',
    voteDone: '✅ Your vote was recorded',
    voteMoved: '✅ Your vote was changed',
    voteSame: 'You already picked this option',
    voteRefresh: '🔄 Results updated',
    voteGone: '⌛ This poll has expired',
    reactDone: '👍 Recorded',
    reactOff: 'Removed',
    back: '⬅️ Back',
    refresh: '🔄 Refresh results',
  },
};

export const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

export function withTimeout(promise, ms, fallback = null) {
  return Promise.race([promise, new Promise((r) => setTimeout(() => r(fallback), ms))]);
}

export function effectiveLang(user, settings) {
  const mode = (settings && settings.botLangMode) || 'both';
  if (mode === 'fa') return 'fa';
  if (mode === 'en') return 'en';
  const l = (user && user.lang) || (settings && settings.defaultLang) || 'fa';
  return BOT_T[l] ? l : 'fa';
}

function withSupport(rows, settings, lang) {
  const sb = settings && settings.supportButton;
  if (!sb || !sb.enabled || !enabled(settings, 'support')) return rows || [];
  const has = (rows || []).some((r) => Array.isArray(r) && r.some((b) => b && b.type === 'callback' && b.value === 'support:open'));
  if (has) return rows || [];
  const text = label((lang === 'en' ? sb.en : sb.fa) || sb.fa || '🛡 پشتیبانی', 64);
  return [...(rows || []), [{ text, type: 'callback', value: 'support:open' }]];
}

export function renderTpl(text = '', user = {}) {
  return String(text)
    .replace(/\{name\}/g, user.firstName || '')
    .replace(/\{username\}/g, user.username ? `@${user.username}` : '')
    .replace(/\{id\}/g, String(user.id || ''));
}

// A single malformed button makes Telegram reject the entire sendMessage with a
// 400, which used to look like "the bot is dead" (no reply to /start at all).
// Every keyboard the bot sends is built here, so an unusable button is trimmed
// when it can be and dropped when it cannot — it is never fatal.
function cleanButtonText(value) {
  // Control characters and line breaks make Telegram reject the button, taking
  // the whole keyboard down with it — collapse them so one label can never
  // hide the other buttons. (Persian half-space U+200C is preserved.)
  return label(value, 64).replace(/[\x00-\x20\x7F]+/g, ' ').trim();
}
function cleanButtonUrl(value) {
  const url = String(value || '').trim();
  // A prefix check is not enough: spaces or an unparsable URL make Telegram
  // reject the whole keyboard with BUTTON_URL_INVALID.
  if (!url || /[\s\x00-\x1F\x7F]/.test(url)) return '';
  if (!/^(https?|tg):\/\//i.test(url)) return '';
  try {
    const parsed = new URL(url);
    if (!['http:', 'https:', 'tg:'].includes(parsed.protocol)) return '';
    if (parsed.protocol !== 'tg:' && !parsed.hostname) return '';
  } catch { return ''; }
  return url;
}
function telegramButton(b) {
  if (!b || typeof b !== 'object') return null;
  const text = cleanButtonText(b.text);
  if (!text) return null;
  // Semantic colors (Bot API 9.4+): primary=blue, success=green, danger=red.
  // Old clients ignore `style`, so emoji in the label stays the fallback.
  const style = ['primary', 'success', 'danger'].includes(b.style) ? b.style : undefined;
  const icon = /^\d{5,30}$/.test(String(b.icon_custom_emoji_id || '')) ? String(b.icon_custom_emoji_id) : undefined;
  const extras = { ...(style ? { style } : {}), ...(icon ? { icon_custom_emoji_id: icon } : {}) };
  // Disabled (Bot API 10.3+): greyed out, tap shows toast via handler.
  const disabled = b.disabled === true ? true : undefined;
  if (b.type === 'copy') {
    const copyText = String(b.value || '').slice(0, 256);
    if (!copyText) return null;
    return { text, copy_text: { text: copyText }, ...extras };
  }
  if (b.type === 'switch_inline' || b.switch_inline_query !== undefined || b.switch_inline_query_current_chat !== undefined) {
    const q = String(b.value ?? b.switch_inline_query ?? b.switch_inline_query_current_chat ?? '').slice(0, 256);
    if (b.switch_current || b.switch_inline_query_current_chat !== undefined) {
      return { text, switch_inline_query_current_chat: q, ...extras };
    }
    return { text, switch_inline_query: q, ...extras };
  }
  if (b.type === 'web_app' || b.web_app) {
    const url = String((b.web_app && b.web_app.url) || b.value || '').trim();
    // Web App buttons only accept https; anything else would sink the keyboard.
    return httpsUrl(url) && !/[\s\x00-\x1F\x7F]/.test(url) ? { text, web_app: { url: cutBytes(url, 512) }, ...extras } : null;
  }
  if (b.type === 'url') {
    const url = cleanButtonUrl(b.value);
    return url ? { text, url: cutBytes(url, 512), ...extras } : null;
  }
  if (b.type === 'submenu') {
    const value = cutBytes(String(b.value || '').trim(), 32);
    return value ? { text, callback_data: `sub:${value}`, ...extras } : null;
  }
  if (b.type === 'text') {
    const src = String(b._src || 'root'), r = Number.isFinite(+b._r) ? +b._r : 0, c = Number.isFinite(+b._c) ? +b._c : 0;
    return { text, callback_data: cutBytes(`txt:${src}:${r}:${c}`, 64), ...extras };
  }
  // Callback values are limited to 64 *bytes*, so a long Persian value is cut
  // here instead of taking the whole keyboard down with it.
  const value = cutBytes(String(b.value || '').trim(), 64);
  if (!value && !extras.style && !disabled) return { text, callback_data: 'noop' };
  return { text, callback_data: value || 'noop', ...extras, ...(disabled ? { disabled: true } : {}) };
}

export function pageMarkup(rows, { withBack = false, T = BOT_T.fa } = {}) {
  const kb = [];
  for (const row of Array.isArray(rows) ? rows : []) {
    if (!Array.isArray(row)) continue;
    const line = [];
    for (const b of row) {
      const btn = telegramButton(b);
      if (btn) line.push(btn);
    }
    if (line.length) kb.push(line.slice(0, 8));
  }
  if (withBack) kb.push([{ text: cleanButtonText(T.back) || '⬅️', callback_data: 'sub:root' }]);
  // Never send an empty keyboard: Telegram rejects `{"inline_keyboard":[]}`
  // with a 400, which used to surface as missing buttons on /start.
  if (!kb.length) return undefined;
  return { inline_keyboard: kb };
}

function tagButtons(rows, src) {
  return (Array.isArray(rows) ? rows : [])
    .map((row, r) => (Array.isArray(row) ? row : []).map((b, c) => ({ ...(b || {}), _src: src, _r: r, _c: c })))
    .filter((row) => row.length);
}

export function customButtonsOf(menu) {
  // Buttons the administrator actually defined in the panel. A fresh menu falls
  // back to the stock defaults in storage, but a default-bot home must stay
  // empty until the admin adds its own buttons.
  if (!menu || !Array.isArray(menu.explicitInlineButtons)) return [];
  return menu.explicitInlineButtons.filter((row) => Array.isArray(row) && row.length);
}
// The rows that make up the root (home) screen, shared by the inline markup and
// by the `txt:` popup lookup so both always agree on positions.
export function rootInlineRows(menu, settings, lang, user = null) {
  const adminRows = [];
  if (user && settings.adminId && String(user.id) === String(settings.adminId) && settings.publicBaseUrl) {
    adminRows.push([{ text: '🛠 ' + tr('پنل مدیریت (مینی‌اپ)', 'Admin Mini App', lang || 'fa'), type: 'web_app', web_app: { url: settings.publicBaseUrl } }]);
  }
  // Default/custom bot: the home screen shows ONLY the buttons the administrator
  // added through the panel's menu & button builder — nothing else.
  if (settings.botPurpose === 'custom') return [...adminRows, ...customButtonsOf(menu)];
  // Every other bot shows the stored panel buttons above its module buttons.
  // The stored list is authoritative for every bot type: once the menu is
  // saved the added buttons always render (no longer gated behind the optional
  // "menu" module flag), and an explicitly emptied list stays empty instead of
  // resurrecting the stock defaults.
  const stored = Array.isArray(menu?.explicitInlineButtons)
    ? customButtonsOf(menu)
    : (menu?.customized && Array.isArray(menu.inlineButtons) ? menu.inlineButtons.filter((row) => Array.isArray(row) && row.length) : []);
  return withSupport([...adminRows, ...stored, ...systemRows(settings, lang || 'fa')], settings, lang || 'fa');
}
export function inlineMarkup(menu, settings, lang, user = null) {
  // The news-purpose bot is a focused single-entry bot: one «خبر» button on the
  // home screen; the region (Iran/World) and category pickers live one tap deep.
  // No module buttons leak into its home; administration stays in /admin.
  if (settings.botPurpose === 'news') {
    return pageMarkup([[{
      text: tr('📰 خبر', '📰 News', lang),
      type: 'callback', value: 'news:home',
    }]], { withBack: false });
  }
  // The rates-purpose bot is the same single-entry shape: one button opens the
  // live price tables and their categories.
  if (settings.botPurpose === 'rates') {
    return pageMarkup([[{
      text: tr('📈 قیمت دلار و طلا و تتر', '📈 USD, Gold & Tether Prices', lang),
      type: 'callback', value: 'rates:home',
    }]], { withBack: false });
  }
  return pageMarkup(tagButtons(rootInlineRows(menu, settings, lang || 'fa', user), 'root'), { withBack: false });
}

export async function touchUser(env, from) {
  const now = Date.now();
  const existing = await getUser(env, from.id);
  if (!existing) {
    const user = {
      id: from.id,
      firstName: from.first_name || '',
      username: from.username || '',
      lang: '',
      joinedAt: now,
      lastSeen: now,
      banned: false,
      bannedAt: 0,
      banReason: '',
      blockedBot: false,
      supportOpen: false,
      privateStarted: false,
      chanOk: false,
      chanCheckedAt: 0,
    };
    await putUser(env, user);
    await bumpStats(env, { users: 1 });
    await pushRecentUser(env, user.id);
    return { user, isNew: true };
  }
  const firstName = from.first_name || existing.firstName;
  const username = from.username || existing.username;
  const changed = firstName !== existing.firstName || username !== existing.username;
  if (changed || now - (existing.lastSeen || 0) > 5 * 60 * 1000) {
    existing.firstName = firstName;
    existing.username = username;
    existing.lastSeen = now;
    await putUser(env, existing);
  }
  return { user: existing, isNew: false };
}

export const channelJoinUrl = joinUrl;
export const channelGate = membershipGate;
function systemRows(settings, lang) {
  const rows = [], cb = (label, value) => ({ text: label, type: 'callback', value });
  if (enabled(settings, 'services')) rows.push([cb(tr('📡 خرید و مدیریت سرویس', '📡 VPN services', lang), 'vpn:home'), cb(tr('🌐 مینی‌اپ مشتری', '🌐 Customer portal', lang), 'vpn:portal')]);
  if (enabled(settings, 'catalog')) rows.push([cb(tr('📚 محصولات و دسته‌بندی‌ها', '📚 Catalog & categories', lang), 'cat:all:0')]);
  if (enabled(settings, 'shop')) rows.push([cb(tr('🛒 سبد خرید', '🛒 Cart', lang), 'cart:show'), cb(tr('📦 سفارش‌های من', '📦 My orders', lang), 'orders:mine')]);
  if (settings.botPurpose === 'rates' || settings.botPurpose === 'custom') rows.push([cb(tr('📈 قیمت طلا، دلار و تتر', '📈 Gold, USD & Rates', lang), 'rates:home')]);
  if (settings.botPurpose === 'news' || settings.botPurpose === 'custom') rows.push([
    cb(tr('🇮🇷 اخبار ایران', '🇮🇷 Iran News', lang), 'news:iran'),
    cb(tr('🌍 اخبار کل جهان', '🌍 World News', lang), 'news:world'),
  ]);
  if (enabled(settings, 'learning')) rows.push([cb(tr('🎓 پیشرفت من', '🎓 My progress', lang), 'learn:progress')]);
  if (enabled(settings, 'faq')) rows.push([cb(tr('💡 پرسش‌های متداول', '💡 Frequently asked questions', lang), 'faq:list')]);
  if (enabled(settings, 'crm') && settings.loyalty.enabled) rows.push([cb(tr('⭐ امتیاز و دعوت دوستان', '⭐ Points & referrals', lang), 'crm:points')]);
  if (settings.botLangMode === 'both') rows.push([cb('🌍 فارسی / English', 'setlang:menu')]);
  return rows;
}

export async function sendStart(token, chatId, user, menu, lang, settings) {
  const purpose = PURPOSES[settings.botPurpose] || PURPOSES.custom;
  let welcome;
  const customButtons = customButtonsOf(menu);
  if (settings.botPurpose === 'custom' && !customButtons.length && !menu.customized) {
    // A freshly created default bot has no buttons yet: don't promise a menu.
    welcome = `${tr('سلام', 'Hello', lang)} ${user.firstName || ''} 👋\n${lang === 'en' ? purpose.en : purpose.fa}`;
  } else {
    welcome = settings.botPurpose === 'custom' || menu.customized ? renderTpl(menu.welcome[lang] || menu.welcome.fa, user) : `${tr('سلام', 'Hello', lang)} ${user.firstName || ''} 👋\n${lang === 'en' ? purpose.en : purpose.fa}\n${tr('از گزینه‌های زیر استفاده کنید.', 'Choose an option below.', lang)}`;
  }
  if (settings.botPurpose === 'relay') welcome += '\n\n' + tr('پیام یا فایل خود را بفرستید تا طبق تنظیم مدیر، بدون برچسب فوروارد کپی شود. هویت فرستنده نزد مدیر قابل مشاهده است.', 'Send a message or file to copy it without forward attribution, as configured by the administrator. The administrator can see the sender’s identity.', lang);
  if (settings.botPurpose === 'group') welcome += '\n\n' + tr('ربات را ادمین گروه کنید و گروه را در پنل ثبت و فعال کنید. /id شناسه شما را نشان می‌دهد.', 'Add the bot as a group administrator, then register and enable the group in the panel. /id shows your ID.', lang);
  return sendToUser(token, chatId, welcome, { reply_markup: inlineMarkup(menu, settings, lang, user), disable_web_page_preview: true });
}

function langKeyboard() {
  return {
    inline_keyboard: [
      [{ text: 'فارسی 🇮🇷', callback_data: 'setlang:fa' }, { text: 'English 🇬🇧', callback_data: 'setlang:en' }],
      [{ text: '🔙 بازگشت به منوی اصلی', callback_data: 'sub:root' }],
    ],
  };
}

async function deepStart(env, token, user, settings, lang, param) {
  if (param === 'svc_phone' && enabled(settings, 'services')) { await serviceCallback(env, user, lang, 'vpn:phone'); return true; }
  if (param === 'svc_portal' && enabled(settings, 'services')) { await serviceCallback(env, user, lang, 'vpn:portal'); return true; }
  if (param?.startsWith('p_') && enabled(settings, 'catalog')) { await showProduct(env, token, user, settings, lang, param.slice(2)); return true; }
  if (param?.startsWith('fb_') && enabled(settings, 'broadcast')) {
    const post = await getPost(env, param.slice(3)); if (!post?.feedback) return false;
    user.flow = { type: 'feedback', postId: post.id }; user.supportOpen = false; await putUser(env, user);
    await sendToUser(token, user.id, tr('نظر متنی خود را درباره این پست بفرستید. /cancel برای انصراف', 'Send your feedback about this post. /cancel to stop', lang)); return true;
  }
  return false;
}

async function faqList(env, token, user, lang, fid) {
  if (fid && fid !== 'list') {
    const f = await getJson(env, entityKey('faq', fid));
    if (f && !f.hidden) {
      return sendToUser(token, user.id, ((lang === 'en' && f.answerEn) || f.answer), {
        reply_markup: {
          inline_keyboard: [
            [{ text: tr('⬅️ بازگشت به پرسش‌ها', '⬅️ Back to FAQs', lang), callback_data: 'faq:list' }],
            [{ text: tr('🔙 منوی اصلی', '🔙 Main menu', lang), callback_data: 'sub:root' }],
          ],
        },
      });
    }
  }
  const rows = (await allEntities(env, 'faq')).filter(f => !f.hidden).slice(0, 40).map(f => [{ text: ((lang === 'en' && f.questionEn) || f.question).slice(0, 64), callback_data: `faq:${f.id}` }]);
  rows.push([{ text: tr('🔙 بازگشت به منوی اصلی', '🔙 Back to main menu', lang), callback_data: 'sub:root' }]);
  return sendToUser(token, user.id, rows.length > 1 ? tr('💡 موضوع را انتخاب کنید:', '💡 Choose a topic:', lang) : tr('هنوز پرسشی تعریف نشده است.', 'No FAQ entries yet.', lang), { reply_markup: { inline_keyboard: rows } });
}

export async function handleUpdate(env, update) {
  const duplicateKey = Number.isSafeInteger(update.update_id) ? entityKey('update', update.update_id) : null;
  if (duplicateKey && await getJson(env, duplicateKey)) return;
  const token = await resolveToken(env); if (!token) return;
  const settings = await getSettings(env);
  if (update.pre_checkout_query && await starsPreCheckout(env, update.pre_checkout_query)) {}
  else if (update.message?.successful_payment && await starsSuccessful(env, update.message)) {}
  else if (update.my_chat_member || update.chat_member) await groupMemberUpdate(env, token, update, settings);
  else if (update.channel_post) await channelPost(env, token, update.channel_post, settings);
  else if (update.message || update.edited_message) await onMessage(env, update.message || update.edited_message, token, settings);
  else if (update.callback_query) await onCallback(env, update.callback_query, token, settings);
  if (duplicateKey) await putJson(env, duplicateKey, { at: Date.now() }, { ttl: 7 * 86400 });
}

async function onMessage(env, msg, token, settings) {
  if (['group', 'supergroup'].includes(msg.chat?.type) || Number(msg.chat?.id) < 0) return moderateMessage(env, token, msg, settings);
  const from = msg.from; if (!from || from.is_bot || msg.edit_date) return;
  const { user, isNew } = await touchUser(env, from); if (user.banned) return;
  const text = String(msg.text || '').trim(), chatId = msg.chat.id, lang = effectiveLang(user, settings), T = BOT_T[lang];
  const cmd = text.startsWith('/') ? text.split(/\s+/)[0].split('@')[0].toLowerCase() : '';
  user.privateStarted = true;
  if (cmd === '/start') {
    const param = text.split(/\s+/)[1] || ''; user.pendingStart = param.slice(0, 64);
    if (isNew && /^ref_\d+$/.test(param) && param.slice(4) !== String(user.id)) user.referredBy = param.slice(4);
    user.supportOpen = false; user.flow = null;
  }
  await putUser(env, user);
  const gate = await membershipGate(env, token, user, settings);
  if (!gate.ok) return sendMembershipLock(token, chatId, gate, lang, user.id);
  await completeSignup(env, user, settings); await bumpStats(env, { messages: 1 });
  const menu = await getMenu(env);
  if (cmd === '/cancel' || cmd === '/end') { user.flow = null; user.supportOpen = false; await putUser(env, user); return sendToUser(token, chatId, T.supportClosed); }
  try {
    if (await adminFlow(env, token, user, settings, lang, msg)) return;
    if (await serviceMessage(env, user, lang, msg)) return;
    if (!cmd && await commerceMessage(env, token, user, settings, lang, msg)) return;
    if (!cmd && user.flow?.type === 'feedback' && text && enabled(settings, 'broadcast')) {
      await ticketAppendUser(env, user, `[Post ${user.flow.postId}] ${text}`); user.flow = null; await putUser(env, user); return sendToUser(token, chatId, T.supportSent);
    }
    if (user.supportOpen && !cmd && enabled(settings, 'support')) {
      if (!text) return sendToUser(token, chatId, tr('لطفاً پیام متنی ارسال کنید.', 'Please send a text message.', lang));
      await ticketAppendUser(env, user, text); return sendToUser(token, chatId, T.supportSent);
    }
    if (cmd) {
      switch (cmd) {
        case '/start': {
          const param = user.pendingStart; user.pendingStart = ''; await putUser(env, user);
          refreshCommands(token);
          if (await deepStart(env, token, user, settings, lang, param)) return;
          if (settings.botPurpose === 'vpn') return serviceHome(env, user, lang);
          return sendStart(token, chatId, user, menu, lang, settings);
        }
        case '/admin':
        case '/panel': {
          const isAdminUser = (settings.adminId && String(user.id) === String(settings.adminId)) || (env.ADMIN_ID && String(user.id) === String(env.ADMIN_ID));
          if (!isAdminUser) return sendToUser(token, chatId, tr('⛔ این بخش فقط برای ادمین ربات در دسترس است.', '⛔ This command is only available to the bot administrator.', lang));
          return adminHome(env, token, chatId, settings, lang);
        }
        case '/rates':
        case '/price':
        case '/gold':
        case '/dollar':
        case '/arz':
          return ratesHome(env, token, user, lang);
        case '/news':
        case '/khabar':
          return newsHome(env, token, user, lang);
        case '/search': {
          const q = text.split(/\s+/).slice(1).join(' ').trim();
          return searchProducts(env, token, user, settings, lang, q);
        }
        case '/id': return sendToUser(token, chatId, `${T.yourId} ${user.id}`);
        case '/ping': return sendToUser(token, chatId, T.pong);
        case '/help': return sendToUser(token, chatId, renderTpl(menu.help[lang] || menu.help.fa, user) + '\n\n' + (enabled(settings, 'catalog') ? '/catalog · /search\n' : '') + (enabled(settings, 'shop') ? '/cart · /orders\n' : '') + '/rates · /news\n' + (enabled(settings, 'crm') ? '/ref · /points\n' : '') + (enabled(settings, 'learning') ? '/progress\n' : '') + '/cancel');
        case '/lang': return sendToUser(token, chatId, settings.botLangMode === 'both' ? T.chooseLang : T.singleLang, settings.botLangMode === 'both' ? { reply_markup: langKeyboard() } : {});
        case '/support': if (enabled(settings, 'support')) { user.supportOpen = true; user.flow = null; await putUser(env, user); return sendToUser(token, chatId, T.supportIntro); } break;
        case '/catalog': case '/shop': if (enabled(settings, 'catalog')) return catalog(env, token, user, settings, lang); break;
        case '/cart': if (enabled(settings, 'shop')) return showCart(env, token, user, settings, lang); break;
        case '/orders': if (enabled(settings, 'shop')) return myOrders(env, token, user, lang); break;
        case '/ref': case '/points': if (enabled(settings, 'crm')) return showPoints(env, token, user, settings, lang); break;
        case '/progress': if (enabled(settings, 'learning')) return progress(env, token, user, lang); break;
        case '/faq': if (enabled(settings, 'faq')) return faqList(env, token, user, lang); break;
      }
    }
    if (!cmd && await relayMessage(env, token, msg, user, settings, lang)) return;
    if (!cmd && settings.botPurpose === 'support' && text) { await ticketAppendUser(env, user, text); return sendToUser(token, chatId, T.supportSent); }
  } catch (e) { return sendToUser(token, chatId, (enabled(settings, 'services') && (user.flow?.type?.startsWith('svc_') || /^\/(vpn|wallet|agent|wheel|giftcode|testvpn)/.test(text)) ? serviceError(e.message, lang) : checkoutError(e.message, lang)) + '\n/cancel'); }
  // Human fallback: acknowledge + guess + way out (never bare "invalid command").
  const homeTarget = settings.botPurpose === 'vpn' || enabled(settings, 'services')
    ? { text: tr('🏠 خدمات', '🏠 Services', lang), callback_data: 'vpn:home' }
    : { text: tr('🏠 منوی اصلی', '🏠 Main menu', lang), callback_data: 'sub:root' };
  return sendToUser(token, chatId, T.unknown, { reply_markup: { inline_keyboard: [[homeTarget]] } });
}

async function showPage(token, chatId, messageId, menu, pageId, lang, settings, user) {
  if (pageId === 'root') return sendStart(token, chatId, user, menu, lang, settings);
  const sm = menu.submenus?.[pageId]; if (!sm) return;
  return tgApi(token, 'editMessageText', { chat_id: chatId, message_id: messageId, text: `${sm.title ? sm.title + '\n\n' : ''}${sm.text}`, reply_markup: pageMarkup(tagButtons(withSupport(sm.buttons, settings, lang), pageId), { withBack: true, T: BOT_T[lang] }), disable_web_page_preview: true });
}

// Native command menu (Telegram '/' autocomplete + chat-input menu button).
// Shortcuts only — every command stays reachable by buttons too.
const BOT_COMMANDS = [
  { command: 'start', description: '🏠 Main menu / منوی اصلی' },
  { command: 'vpn', description: '📡 VPN services / خدمات' },
  { command: 'wallet', description: '💳 Wallet / کیف پول' },
  { command: 'help', description: '❓ Help / راهنما' },
  { command: 'support', description: '🛡 Support / پشتیبانی' },
];
function refreshCommands(token) {
  // Fire-and-forget: global per-bot setting, harmless to repeat. Never blocks /start.
  try {
    const p = tgApi(token, 'setMyCommands', { commands: BOT_COMMANDS });
    if (p && typeof p.catch === 'function') p.catch(() => {});
  } catch { /* best-effort */ }
}

async function onCallback(env, cb, token, settings) {
  const source = cb.message;
  const media = !!source && !!(source.photo || source.video || source.document || source.animation || source.audio || source.sticker || source.voice);
  const editable = !!source && !media && Number(source.chat?.id) > 0 && !!source.message_id;
  if (editable) beginMessageEdit(source.chat.id, source.message_id);
  try { return await handleCallback(env, cb, token, settings); }
  finally { if (editable) endMessageEdit(); }
}

async function handleCallback(env, cb, token, settings) {
  if (!cb.from || cb.from.is_bot) return;
  if (await captchaCallback(env, token, cb, settings)) return;
  if (await raffleCallback(env, token, cb)) return;
  const { user } = await touchUser(env, cb.from), lang = effectiveLang(user, settings), T = BOT_T[lang];
  const data = String(cb.data || ''), chatId = cb.message?.chat.id, messageId = cb.message?.message_id;
  const answer = (text = '', alert = false) => tgApi(token, 'answerCallbackQuery', { callback_query_id: cb.id, text, show_alert: alert });
  if (user.banned || !chatId) return answer();
  if (data.startsWith('chan:check:') && data.slice(11) !== String(user.id)) return answer(tr('این دکمه برای شما نیست.', 'This button belongs to another user.', lang), true);
  // Admin controls run before the membership gate: the administrator must always
  // be able to approve/reject relay publishing and manage the bot from Telegram.
  if ((data.startsWith('adm:') || data.startsWith('rl:')) && Number(chatId) > 0) {
    try { if (await adminCallback(env, cb, token, user, settings, lang, { answer })) return answer(); } catch (e) { return answer(str(e.message || 'error', 120), true); }
  }
  try { if (await engagementCallback(env, token, user, settings, lang, cb)) return; } catch { return answer(tr('عملیات انجام نشد؛ دوباره تلاش کنید.', 'Please try again.', lang), true); }
  const gate = await membershipGate(env, token, user, settings);
  if (!gate.ok) { await sendMembershipLock(token, chatId, gate, lang, user.id); return answer(T.lockNo, true); }
  if (data.startsWith('chan:check')) {
    await answer(tr('✅ عضویت تأیید شد.', '✅ Membership confirmed.', lang));
    if (Number(chatId) > 0) {
      await completeSignup(env, user, settings); await resumeMemberDeliveries(env, user.id); const param = user.pendingStart; user.pendingStart = ''; await putUser(env, user);
      if (!await deepStart(env, token, user, settings, lang, param)) await sendStart(token, chatId, user, await getMenu(env), lang, settings);
    }
    return;
  }
  if (Number(chatId) < 0) return answer(tr('این بخش را در گفتگوی خصوصی ربات باز کنید.', 'Open this feature in a private chat with the bot.', lang), true);
  const menu = await getMenu(env);
  try {
    if (await serviceCallback(env, user, lang, data)) return answer();
    if (await commerceCallback(env, token, user, settings, lang, data)) return answer();
    if (await ratesCallback(env, token, user, lang, data)) return answer();
    if (await newsCallback(env, token, user, lang, data)) return answer();
    if (data === 'crm:points' && enabled(settings, 'crm')) { await showPoints(env, token, user, settings, lang); return answer(); }
    if (data.startsWith('learn:') && enabled(settings, 'learning')) {
      if (data === 'learn:progress') await progress(env, token, user, lang);
      else { const pid = data.slice(6); assert(await getJson(env, entityKey('access', `${user.id}:${pid}`)), 'lesson_not_unlocked'); const p = await getJson(env, entityKey('product', pid)); assert(p, 'product_unavailable'); await putJson(env, entityKey('progress', `${user.id}:${pid}`), { userId: String(user.id), productId: pid, title: p.title, titleEn: p.titleEn, at: Date.now() }); await progress(env, token, user, lang); }
      return answer();
    }
    if (data.startsWith('faq:') && enabled(settings, 'faq')) { await faqList(env, token, user, lang, data.slice(4)); return answer(); }
    if (data.startsWith('setlang:')) {
      if (settings.botLangMode !== 'both') return answer(T.singleLang, true);
      if (data === 'setlang:menu') { await sendToUser(token, chatId, T.chooseLang, { reply_markup: langKeyboard() }); return answer(); }
      const l = data.slice(8); if (!['fa', 'en'].includes(l)) return answer();
      user.lang = l; await putUser(env, user); await sendStart(token, chatId, user, menu, l, settings); return answer(BOT_T[l].langSet);
    }
    if (data === 'admin:stats') {
      const isAdminUser = (settings.adminId && String(user.id) === String(settings.adminId)) || (env.ADMIN_ID && String(user.id) === String(env.ADMIN_ID));
      if (!isAdminUser) return answer(tr('دسترسی غیرمجاز', 'Unauthorized', lang), true);
      const stats = await getStats(env);
      const txt = `📊 <b>${tr('آمار کل ربات', 'Bot Stats', lang)}</b>\n\n` +
        `👥 ${tr('تعداد کاربران', 'Users', lang)}: ${stats.users || 0}\n` +
        `💬 ${tr('تعداد پیام‌ها', 'Messages', lang)}: ${stats.messages || 0}\n` +
        `📢 ${tr('ارسال‌های همگانی', 'Broadcasts', lang)}: ${stats.broadcasts || 0}\n` +
        `🚫 ${tr('کاربران مسدود', 'Banned users', lang)}: ${stats.banned || 0}`;
      await sendToUser(token, chatId, txt, { reply_markup: { inline_keyboard: [[{ text: '🔙 ' + tr('بازگشت به منوی اصلی', 'Back to main menu', lang), callback_data: 'sub:root' }]] } });
      return answer();
    }
    if (data === 'admin:orders') {
      const isAdminUser = (settings.adminId && String(user.id) === String(settings.adminId)) || (env.ADMIN_ID && String(user.id) === String(env.ADMIN_ID));
      if (!isAdminUser) return answer(tr('دسترسی غیرمجاز', 'Unauthorized', lang), true);
      const orders = (await allEntities(env, 'order')).sort((a, b) => b.createdAt - a.createdAt).slice(0, 5);
      if (!orders.length) {
        await sendToUser(token, chatId, tr('هنوز سفارشی ثبت نشده است.', 'No orders yet.', lang), { reply_markup: { inline_keyboard: [[{ text: '🔙 ' + tr('بازگشت به منوی اصلی', 'Back to main menu', lang), callback_data: 'sub:root' }]] } });
        return answer();
      }
      let txt = `📦 <b>${tr('آخرین سفارش‌های ثبت‌شده', 'Recent Orders', lang)}</b>\n\n`;
      for (const o of orders) {
        txt += `#${o.id} · ${o.userName || o.userId}\n💰 ${o.total} تومان | ${o.status}\n\n`;
      }
      await sendToUser(token, chatId, txt, { reply_markup: { inline_keyboard: [[{ text: '🔙 ' + tr('بازگشت به منوی اصلی', 'Back to main menu', lang), callback_data: 'sub:root' }]] } });
      return answer();
    }
    // Custom menu buttons belong to the customized menu, not to the optional
    // "menu" module, so they keep working for every bot type/purpose.
    if (data.startsWith('sub:')) { await showPage(token, chatId, messageId, menu, data.slice(4), lang, settings, user); return answer(); }
    if (data.startsWith('txt:')) { const [, src, r, c] = data.split(':'); const rows = src === 'root' ? rootInlineRows(menu, settings, lang, user) : menu.submenus?.[src]?.buttons || []; const btn = rows[+r]?.[+c]; return answer(btn?.type === 'text' ? String(btn.value).slice(0, 200) : '…', true); }
    if (data === 'support:open' && enabled(settings, 'support')) { user.supportOpen = true; user.flow = null; await putUser(env, user); await sendToUser(token, chatId, T.supportIntro); return answer(); }
    // Panel-built callback buttons carry the administrator's own values, which
    // no built-in handler knows. Acknowledge the tap with the button's label
    // so a custom button always "works" instead of reporting a disabled
    // feature. (Legacy over-long values are compared cut, exactly as rendered.)
    const customHit = [...(Array.isArray(menu?.explicitInlineButtons) ? menu.explicitInlineButtons : menu.inlineButtons || []), ...Object.values(menu?.submenus || {}).flatMap((sm) => sm?.buttons || [])]
      .flat()
      .find((b) => b && b.type === 'callback' && cutBytes(String(b.value || '').trim(), 64) === data);
    if (customHit) return answer(label(customHit.text, 200) || '✓');
  } catch (e) { return answer(data.startsWith('vpn:') ? serviceError(e.message, lang) : checkoutError(e.message, lang), true); }
  return answer(tr('این بخش در نوع فعلی ربات فعال نیست.', 'This feature is disabled for this bot type.', lang), true);
}
