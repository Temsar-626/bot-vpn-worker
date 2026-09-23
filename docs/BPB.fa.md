# راه‌اندازی BPB (پنل روی Cloudflare Worker)

این ماژول برای هر اکانت Cloudflare دقیقاً **یک Worker از BPB-Worker-Panel** می‌سازد
(منطق نصب مشابه [BPB-Wizard](https://github.com/bia-pain-bache/BPB-Wizard)):
verify توکن → ساخت KV → دانلود `worker.js` رسمی → embed تنظیمات → دیپلوی → فعال‌سازی ساب‌دامین.

## ۱) پیش‌نیازها

- `VAULT_KEY` با حداقل ۳۲ کاراکتر در سکرت‌های ورکر (توکن‌های CF فقط رمزنگاری‌شده ذخیره می‌شوند).
- توکن Cloudflare هر فروش با دسترسی: **Edit Workers** + خواندن **Account Settings** + **KV**.
  ساخت مقدار تصادفی امن:
  ```bash
  node -e "console.log(require('crypto').randomBytes(24).toString('base64url'))"
  ```
- هرگز توکن خام (`ghp_` یا CF API Token) را در کد، `wrangler.toml` یا کامیت نگذارید.

## ۲) افزودن اکانت

۱. پنل ادمین → **سرویس / VPN** → تب **BPB** → «اکانت جدید» (label + API Token).
۲. دکمه **نصب**: سیستم توکن را verify می‌کند، KV می‌سازد، آخرین `worker.js`
   ([دانلود رسمی](https://github.com/bia-pain-bache/BPB-Worker-Panel/releases/latest/download/worker.js))
   را می‌گیرد و یک Worker دیپلوی می‌کند. وضعیت `free` یعنی آماده فروش.
۳. قانون: هر اکانت CF فقط یک Worker. نصب دوم روی همان اکانت با خطای `already_claimed` رد می‌شود.

## ۳) فروش

۱. در تب **پنل‌ها** یک پنل از نوع **BPB (Cloudflare Workers)** بسازید (URL/credentials لازم نیست؛ فقط عنوان/ظرفیت).
۲. پلن را به آن پنل وصل کنید. خرید موفق، قدیمی‌ترین اسلات `free` را `sold` می‌کند،
   `expire_at` می‌گذارد و لینک ساب (`https://{worker}.{sub}/{securePath}/sub/...`) را در تلگرام می‌دهد.
۳. موجودی = تعداد اسلات‌های `free`.

## ۴) انقضا و قطع دسترسی

کرون هر دقیقه (`* * * * *`) اسلات‌های `sold` با `expire_at` گذشته را با **چرخاندن
securePath + UUID ولیس / پسورد Trojan و redeploy** باطل می‌کند و اسلات را `free` می‌کند.
سرویس linked هم در `sync` بعدی `expired` می‌شود.

## ۵) تنظیمات تکی و گروهی

تب BPB → «تنظیمات» (تکی) یا «تنظیمات گروهی» (bulk روی حداکثر ۵۰ اکانت):
`proxyIPs` ،`proxyIpMode` (`proxyip|direct|none`) ،`fallback` ،`dohUrl`.
کلیدهای ناشناس drop می‌شوند تا با نسخه‌های بعدی BPB سازگار بماند.

## API ادمین (پیشوند `/api/bpb`, نیازمند لاگین)

| متد | مسیر | توضیح |
|-----|------|-------|
| GET | `/api/bpb/accounts` | لیست + شمارنده‌ها (توکن فقط ماسک) |
| POST | `/api/bpb/accounts` | `{ label, apiToken }` |
| GET | `/api/bpb/accounts/:id` | جزئیات یک اکانت |
| POST | `/api/bpb/accounts/:id/install` | verify + KV + deploy |
| POST | `/api/bpb/accounts/:id/revoke` | چرخش سکرت + آزادسازی |
| PUT | `/api/bpb/accounts/:id/settings` | تنظیمات تکی (redeploy) |
| POST | `/api/bpb/accounts/bulk-settings` | `{ ids[], settings }` |
| DELETE | `/api/bpb/accounts/:id` | حذف ورکر + ردیف (اسلات sold حذف نمی‌شود) |
| GET | `/api/bpb/accounts/:id/token` | نمایش توکن خام (فقط ادمین لاگین‌شده، فقط روی درخواست صریح) |

> توجه: لیست اکانت‌ها همیشه توکن را ماسک برمی‌گرداند. نمایش کامل توکن فقط با
> دکمه «توکن» روی هر ردیف انجام می‌شود؛ هرکس به پنل ادمین دسترسی دارد می‌تواند
> آن را ببیند، پس دسترسی ادمین را محدود نگه دارید.

## لینک تحویلی به خریدار

برای سرویس‌های BPB فقط **لینک مستقیم ورکر** (`https://{worker}.{sub}/{securePath}/sub`)
به خریدار داده می‌شود؛ لینک پروکسی `/sub` روی دامین خودمان برای BPB مخفی است
(پیام‌های تکراری هم حذف می‌شوند).

## عیب‌یابی

- `vault_key_required`: `VAULT_KEY` را در Cloudflare ست کنید.
- `provider_auth_failed`: توکن CF نامعتبر است.
- `bpb_no_free_slot`: همه اسلات‌ها sold هستند؛ اکانت جدید نصب کنید.
- جریان‌های Marzban/Marzneshin بدون تغییر باقی می‌مانند (تست‌ها: `npm test`).
