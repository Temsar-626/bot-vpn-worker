import { getJson, putJson, getUser, putUser, getSettings } from './kv.js';
import { entityKey, allEntities, commitJson } from './storage.js';
import { enabled, text as tr, assert } from './config.js';
import { sendToUser } from './bot-api.js';

export const pointsAccount = async (env, uid) => (await getJson(env, entityKey('points', uid))) || { userId: String(uid), points: 0, earned: 0, referrals: 0 };
export async function rewardWrites(env, uid, amount, eventId, reason) {
  if (!amount) return [];
  const eventKey = entityKey('reward', eventId);
  if (await getJson(env, eventKey)) return [];
  const account = await pointsAccount(env, uid);
  assert(account.points + amount >= 0, 'insufficient_points');
  account.points += amount; if (amount > 0) account.earned += amount;
  if (reason === 'referral') account.referrals++;
  return [[entityKey('points', uid), account], [eventKey, { userId: String(uid), amount, reason, at: Date.now(), id: eventId }]];
}
export async function reward(env, uid, amount, eventId, reason) {
  return commitJson(env, await rewardWrites(env, uid, amount, eventId, reason));
}
export async function completeSignup(env, user, settings) {
  if (user.signupCompleted) return;
  if (!enabled(settings, 'crm') || !settings.loyalty.enabled) { user.signupCompleted = true; await putUser(env, user); return; }
  await reward(env, user.id, settings.loyalty.signupPoints, `signup:${user.id}`, 'signup');
  if (user.referredBy && String(user.referredBy) !== String(user.id)) {
    const inviter = await getUser(env, user.referredBy);
    if (inviter && !inviter.banned) await reward(env, inviter.id, settings.loyalty.referralPoints, `referral:${user.id}`, 'referral');
  }
  user.signupCompleted = true; await putUser(env, user);
}
export async function showPoints(env, token, user, settings, lang) {
  const acc = await pointsAccount(env, user.id);
  let msg = `${tr('⭐ امتیاز شما', '⭐ Your points', lang)}: ${acc.points}\n${tr('دعوت‌های معتبر', 'Qualified referrals', lang)}: ${acc.referrals}`;
  const refLink = settings.botUsername ? `https://t.me/${settings.botUsername}?start=ref_${user.id}` : '';
  if (refLink) msg += `\n\n${tr('لینک معرفی شما', 'Your referral link', lang)}:\n${refLink}\n\n${tr('امتیاز فقط برای کاربر جدید، پس از ورود و عبور از قفل عضویت ثبت می‌شود؛ شمارش ورود به ربات است، نه اثبات هویت یکتای انسان.', 'Only new users who pass the membership gate count. This tracks bot signups, not verified unique human identities.', lang)}`;
  const rows = [];
  if (refLink) {
    rows.push([{ text: tr('📋 کپی لینک', '📋 Copy link', lang), copy_text: { text: refLink.slice(0, 256) }, style: 'primary' }]);
    rows.push([{ text: tr('📤 اشتراک با دوست', '📤 Share', lang), switch_inline_query: `ref_${user.id}` }]);
  }
  rows.push([{ text: tr('🔙 بازگشت به منوی اصلی', '🔙 Back to main menu', lang), callback_data: 'sub:root' }]);
  return sendToUser(token, user.id, msg, {
    reply_markup: { inline_keyboard: rows },
  });
}
export async function progress(env, token, user, lang) {
  const records = (await allEntities(env, 'progress')).filter(r => r.userId === String(user.id));
  return sendToUser(token, user.id, `${tr('🎓 درس‌های تکمیل‌شده', '🎓 Completed lessons', lang)}: ${records.length}\n${records.slice(-30).map(r => '✓ ' + (lang === 'en' && r.titleEn || r.title)).join('\n')}`.slice(0, 4096), {
    reply_markup: {
      inline_keyboard: [
        [{ text: tr('🔙 بازگشت به منوی اصلی', '🔙 Back to main menu', lang), callback_data: 'sub:root' }],
      ],
    },
  });
}
