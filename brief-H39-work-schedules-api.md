# H39 — Work schedules: the model + API (phase 1 of 2)

## الحالة المؤكدة (متحقق منها ✓)
صفحة **إعدادات المؤسسة** (`/admin` → تبويب «إعدادات المؤسسة») فيها كارت
**«جدول دوام المؤسسة»** بيقول نصًّا:
> «جدول عمل المؤسسة غير متاح لعدم وجود واجهة (endpoint) للجداول على الخادم
> للقراءة أو الكتابة؛ لذلك لا يوجد جدول مؤكّد ولا سجل إصدارات.»

**اتأكدت بنفسي** ✓:
- مفيش موديل `WorkSchedule` في أي `models.py`
- مفيش أي مسار `schedule` في أي `urls.py`

يعني الميزة **مش مكسورة — مش موجودة**. المطلوب في المرحلة دي: **الموديل + الـAPI**.
الواجهة (الزرار + النموذج) مرحلة تانية لمهندس الفرونت.

## المطلوب

### 1. الموديل (في `accounts/models.py` أو تطبيق مناسب)
```
WorkSchedule
  company        FK → Company        (إلزامي — كل صف لازم يكون تابع لشركة)
  name           CharField           ("الدوام الرسمي", "رمضان" …)
  effective_from DateField           (من امتى الجدول ساري)
  effective_to   DateField  nullable (لو مفتوح)
  is_active      BooleanField        (واحد فقط نشط لكل شركة في أي وقت)
  created_by     FK → User  nullable
  + created_at / updated_at

WorkScheduleDay                     (صف لكل يوم في الجدول)
  schedule       FK → WorkSchedule   (related_name="days")
  weekday        IntegerField        0=الأحد … 6=السبت
  is_working_day BooleanField
  start_time     TimeField  nullable (مطلوب لو is_working_day)
  end_time       TimeField  nullable
  break_minutes  IntegerField default 0
  unique_together: (schedule, weekday)
```

### 2. الـAPI (تحت `/api/v1/`)
```
GET    /work-schedules            → كل جداول الشركة (+ الجدول النشط)
POST   /work-schedules            → إنشاء جدول + أيامه في طلب واحد (atomic)
GET    /work-schedules/<id>       → جدول واحد بأيامه
PATCH  /work-schedules/<id>       → تعديل (بما فيها الأيام)
DELETE /work-schedules/<id>       → حذف (أو soft delete لو الأنسب للموديل)
```
- **الصلاحية**: HR فقط (`IsHR`) — المدير/الموظف بيقرأوا الجدول النشط من نقطة
  قراءة مخصّصة إن احتجت، لكن الكتابة HR بس.
- **الرد بنفس شكل باقي الـAPI**: `{"data": …}` و`{"error": {...}}` — نفس
  الـserializers/الأخطاء المستخدمة في `accounts/department_views.py`.

### 3. ⚠️ الشرط الأمني (مهم — ده كان بج حقيقي اتصلّح النهاردة)
**كل استعلام لازم يكون مربوط بالشركة** — `filter(company=request.user.company)`.
كان في `department_views.py` أربع استعلامات من غير ربط بالشركة، وأي HR كان
بيشوف أقسام كل الشركات (اتصلّح في `cb74a25`). **متكررهاش** — اكتب التستات
اللي تمنعها (تحت).

### 4. التستات (إلزامية)
- إنشاء جدول + أيامه ✓
- `GET /work-schedules` كـ HR شركة (أ) → **مفيش أي جدول من شركة (ب)** ✓
- `GET /work-schedules/<id>` لجدول شركة تانية → **404** ✓
- `PATCH` على جدول شركة تانية → **404** ✓
- مدير/موظف يحاول ينشئ → **403** ✓

**مكانها**: `backend/tenants/test_isolation.py` (الأقسام ناقصة هناك —
ضيف تستات الجداول جنبها) أو ملف تست جديد للتطبيق.

### 5. القيود
- **مفيش فرونت إند** في المرحلة دي (لا تعدّل `frontend/`).
- **مفيش تغيير في ملفات مش متعلقة** بالميزة.
- اتبع أسلوب المشروع: facade + siblings، تعليقات تشرح **ليه** مش **إيه**،
  مفيش defensive clutter.
- شغّل التستات: `DJANGO_USE_SQLITE=1 PYTHONPATH=<proj>/.venv/lib/python3.11/site-packages /usr/bin/python3.11 manage.py test <app>`.
- المهمة تخلص لما التستات كلها تعدّي، وقوللي **أسماء الملفات + نتيجة التستات + أي commit**.

## البيئة
- المشروع: `/home/menisy/Desktop/Me/tracking_system_project`
- الباك إند: `backend/` — Django + SQLite (`DJANGO_USE_SQLITE=1`)
- venv: `backend/.venv` (استخدم `PYTHONPATH=<proj>/.venv/lib/python3.11/site-packages` + `/usr/bin/python3.11`)
- **متلمسش** الـDB الحيّة ولا تشغّل migrations على `db.sqlite3` من غير ما تقوللي.
- الفرونت بيقرأ الـAPI من نفس السيرفر (Django بيخدم الـbuild) — عشان كده
  الـJSON shape مهم.

## التسليم
1. الموديل + migration
2. الـviews + الـurls + الـserializers
3. التستات (مع تشغيلها وإظهار النتيجة)
4. commit واحد واضح
5. تقرير قصير: الملفات ✓ التستات ✓ القرارات ✓ أي حاجة سيبتها
