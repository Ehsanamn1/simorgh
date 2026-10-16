# مدار — چک‌لیست پذیرش

**بازبینی:** ۱۶ اکتبر ۲۰۲۶  
**تغییرات در حال بررسی:** [PR #12 — تکمیل مدل عمومی مزرعه و پایداری ورود](https://github.com/Ehsanamn1/simorgh/pull/12)  
**نسخه‌ی منتشرشده‌ی پایه:** [بررسی استقرار قبلی در GitHub Pages](https://ehsanamn1.github.io/simorgh/)  
**وضعیت انتشار این تغییرات:** منتظر CI و استقرار پس از ادغام

این چک‌لیست بین وجود کد، قبولی تست، استقرار و آمادگی عملیات واقعی تفاوت می‌گذارد. عبور از CI به‌تنهایی به معنی تکمیل ممیزی امنیتی یا آماده‌بودن برای عملیات تجاری نیست.

## A. موارد پیاده‌سازی‌شده در نسخه‌ی جاری

- [x] حفظ معماری React + TypeScript + Vite، React Router و Supabase؛ بدون افزودن سرویس میزبانی جدید.
- [x] هویت بصری «مدار» و رابط راست‌چین فارسی، سازگار با موبایل و حالت روشن/تاریک حفظ شده است.
- [x] ورود امن برای حساب‌های ایجادشده فعال است؛ ثبت‌نام عمومی و انتخاب خودسرانه‌ی نقش باز نیست.
- [x] بررسی عضویت از بررسی نشست جدا شده است تا صفحه‌ی درخواست دسترسی پیش از اتمام اولین خواندن عضویت ظاهر نشود.
- [x] مدل سایت، چرخه، بچ و ثبت روزانه برای بخش‌های مختلف کشاورزی عمومی شده است؛ گزینه‌های لبنیات، زنبورداری، محصولات جنگلی و گلخانه‌ای/باغی در رابط در دسترس هستند.
- [x] مهاجرت `generalize_farm_operations` که در Supabase اعمال شده بود به مخزن اضافه شده تا تاریخچه‌ی schema با دیتابیس مستقر همگام باشد.
- [x] ثبت روزانه‌ی مقدار مصرف، خروجی، مردودی و اتلاف را پشتیبانی می‌کند؛ مقدار مردودی باید صفر یا کمتر/برابر خروجی باشد.
- [x] سایت تنها با مختصات جغرافیایی معتبر و جفت‌شده روی نقشه قرار می‌گیرد؛ مختصات ساختگی تولید نمی‌شود.
- [x] تست‌های مرورگر برای گزینه‌های عمومی مزرعه، محدوده مختصات و اعتبارسنجی مردودی اضافه شده‌اند.
- [ ] CI نهایی PR #12 باید موفق شود و سپس استقرار جدید GitHub Pages تأیید شود.

**وضعیت دیتابیس زنده (۱۶ اکتبر ۲۰۲۶):** یک رکورد شرکت وجود دارد؛ تعداد کاربران Supabase Auth برابر صفر، عضویت‌های فعال برابر صفر و جدول‌های عملیاتی نمونه‌برداری‌شده خالی هستند. بنابراین هنوز نمی‌توان جریان‌های تجاری را با حساب واقعی تأیید کرد.

## B. Required before real operational use

- [ ] Create/invite the trusted first owner through a controlled Supabase Dashboard process.
- [ ] Deliberately grant and verify the first owner membership for شبکه سیمرغ.
- [ ] Reintroduce a deliberate authentication/onboarding path when the owner requests activation; forms are intentionally disabled right now.
- [ ] Verify login/session behavior, sign-out, email verification and password recovery once those UI flows are enabled.
- [ ] Test RLS and API/RPC authorization with separate owner, staff, supplier, driver and customer test accounts.
- [ ] Prove that a customer cannot read another customer's order; a supplier cannot read another farm's private records; a driver cannot access an unassigned trip; and direct ID changes do not bypass access checks.
- [ ] Verify private Storage upload/download and signed access with role-specific test accounts.
- [ ] Inspect and review Supabase security advisor findings concerning guarded SECURITY DEFINER RPCs, RLS planning and indexes.
- [ ] Load operational records only after a controlled non-production test; never use the public previews as operating workspaces.

## C. Core product requirements still missing or partial

### Phase 1 — operational integrity
- [ ] Farm sites, facilities, licenses and versioned partner contracts/amendments.
- [ ] Flock cycles, production batches, incoming birds, daily production, feed consumption, mortality and egg grading records where applicable.
- [ ] Task templates, scheduling, assignees, due dates, required evidence, review and escalation history.
- [ ] Inventory transaction ledger, reservations, goods receipts, purchasing and supplier pricing history.
- [ ] Complete contract-versioned 50/50 partnership financial engine, separating expenses incurred/approved/paid/allocated, invoiced revenue/collected cash, advances, amounts owed, adjustments and actual settlements.
- [ ] Server-validated order/stock/capacity workflows with concurrency and idempotency checks.
- [ ] Source-to-destination traceability joining production lots, quality evidence, orders and delivered shipments.

### Phase 2 — logistics and evidence
- [ ] Carrier/transport agreements, drivers, vehicles and rate schedules.
- [ ] Assigned transport jobs, accept/decline, pickup, in-transit, delivery and authorized state transitions.
- [ ] Proof of pickup/delivery, discrepancies, returns, incidents, transport invoices and freight-cost allocation.
- [ ] Verified device-level GPS observations with timestamp, accuracy, permission handling and stale-location indicators. Browser route UI alone is not proof of GPS integration.
- [ ] Offline-aware mobile capture and safe synchronization where feasible.

### Phase 3 — AI operations
- [ ] Bounded agents for farm operations, production/quality, logistics, finance, procurement and executive intelligence.
- [ ] Explicit tool allowlists with server-side authorization; no arbitrary SQL, unrestricted writes or secret exposure.
- [ ] Agent run logs, structured outputs, errors/retries, source references and execution permissions.
- [ ] Human approval for financial commitments, contract changes and external actions.
- [ ] Idempotent job processing and visible failed-notification/failed-agent states.

### Phase 4 — intelligence and scale
- [ ] Reliable historical data before forecasting or predictive metrics.
- [ ] Exception-first dashboards, exportable reports, capacity planning and procurement optimization backed by source records.
- [ ] Monitoring, backups/recovery drills, role-reviewed audit trails and a security review.

## D. Release scope

The current site is deployed and the public role-screening UI is automated-test verified. The role cards are not operational application sessions. No claim is made that real account authorization, GPS, cameras, banking, SMS/transactional messages, or AI providers are currently working. Do not enter live commercial operations until section B is complete and the applicable section C workflows are built and tested.