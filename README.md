# AF Fabworks — نظام الحضور والمرتبات (Supabase)

## التشغيل (حوالي 15 دقيقة)

1. **Supabase:** اعمل مشروع جديد ← SQL Editor ← New query ← الصق محتوى `schema.sql` كله ← Run.
2. **حساب الأدمن:** Authentication ← Users ← Add user (إيميل + كلمة سر، وفعّل Auto Confirm).
   بعدها في SQL Editor شغّل السطر ده (بإيميلك):
   `insert into public.admins (user_id) select id from auth.users where email = 'YOUR-EMAIL@example.com';`
   وكمان: Authentication ← Sign In / Providers ← اقفل **Allow new users to sign up**.
3. **config.js:** من Project Settings ← API انسخ الـ Project URL والـ anon public key وحطهم في `config.js`.
4. **GitHub:** ارفع كل الملفات في ريبو (`index.html` في الجذر) ← Settings ← Pages ← Deploy from branch (main / root).
5. **أول استخدام:** ادخل بحساب الأدمن ← الإعدادات ← "استخدم موقعي الحالي" وانت في الشركة ← ضيف الموظفين من تبويب الموظفين.

## ملاحظات
- الأرقام السرية للموظفين متشفّرة على السيرفر ومش بتظهر تاني (لو موظف نسي رقمه: تبويب الموظفين ← PIN).
- التحقق من الموقع والـ QR بيتم على السيرفر مش على الموبايل.
- لو التعديل مش ظاهر بعد رفع ملفات جديدة: اقفل التطبيق وافتحه تاني.
