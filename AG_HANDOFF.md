# AG Handoff

## 1. Project Overview
- Đây là web app “Madam Yen IMS” để quản lý hóa đơn nhà hàng.
- Người dùng upload/chụp ảnh hóa đơn → hệ thống OCR trích xuất vendor + invoice metadata + bảng line items → lưu vào Supabase Postgres để admin review/edit/approve/reject/paid và xem báo cáo chi phí.
- Target users:
  - **Staff**: chỉ upload hóa đơn để OCR và theo dõi trạng thái job.
  - **Admin**: quản trị toàn bộ (invoice CRUD, approve/reject/paid, vendor settings, users, reports, maintenance/cleanup).

## 2. Tech Stack
- Frontend: Next.js 16 (App Router) + React 19 + TailwindCSS.
- Backend: Next.js Route Handlers (`src/app/api/**`) chạy trên Vercel.
- Database: Supabase Postgres (truy cập qua `pg`/`DATABASE_URL`), Storage: Supabase Storage (qua `@supabase/supabase-js`).
- Auth: Custom username/password trong Postgres (`public.app_users`) + session cookie `httpOnly` ký JWT (`AUTH_JWT_SECRET`), RBAC `admin`/`staff` qua middleware.
- External services:
  - OCR: Gemini 2.5 Flash qua OpenAI-compatible API (DeepInfra primary + Gemini official fallback) dùng OpenAI SDK (`openai`).
  - Async worker: Supabase Edge Function `ocr-worker` gọi OCR và callback về Next API.

## 3. Architecture (Current Only)
- **UI routes**
  - `/login`: đăng nhập.
  - `/dashboard`: admin dashboard (list/report/settings).
  - `/upload`: staff upload OCR (admin vẫn có thể dùng nhưng staff bị redirect bắt buộc vào đây).
- **API routes (Next.js)**
  - Auth/session: `/api/auth/login`, `/api/auth/logout`, `/api/auth/me`
  - OCR async flow: `/api/process` → tạo `ocr_jobs` + upload ảnh → trigger edge function; polling qua `/api/ocr-jobs/*`
  - Callback từ edge function: `/api/internal/ocr-jobs/complete` (bảo vệ bằng `OCR_WORKER_WEBHOOK_SECRET`)
  - Invoices/admin ops: `/api/invoices`, `/api/credit-notes`, `/api/reports/cost`
  - Vendor + Catalog: `/api/vendor-settings`, `/api/catalog/*`
  - Admin users: `/api/admin/users`
  - Maintenance: `/api/maintenance/cleanup-old-images`, `/api/maintenance/cleanup-orphans`
- **Worker (Supabase Edge Function)**
  - `supabase/functions/ocr-worker/index.ts`: nhận job trigger → claim job → tải ảnh từ Storage → gọi OCR → save invoice/items (qua callback API) → update `ocr_jobs`.
- **Data flow (OCR)**
  1) Client gọi `POST /api/process` với ảnh.
  2) API tối ưu ảnh nhẹ (Sharp), upload lên Supabase Storage, insert row `ocr_jobs`, set `created_by` theo session user.
  3) API trigger Supabase Edge Function `ocr-worker` (không chờ OCR xong) và trả `jobId`.
  4) Client poll `GET /api/ocr-jobs/:id` (và dashboard poll danh sách jobs) cho tới `succeeded/failed`.
  5) Edge function OCR xong sẽ callback `POST /api/internal/ocr-jobs/complete` để lưu `invoices` + `invoice_items` và set `ocr_jobs` trạng thái cuối.

## 4. Key Files / Modules
- `src/lib/auth.ts`: ký/verify session JWT, set/clear cookie, helper `requireSession/requireRole`.
- `src/middleware.ts`: gate toàn bộ UI/API theo session; staff chỉ được `/upload` + `/api/process` + `/api/ocr-jobs*`.
- `src/lib/db-service.ts`: DB layer dùng `pg` (`DATABASE_URL`) để list/get/save/update invoices/items, reports, vendor/catalog queries; có logic normalize/safe insert bằng savepoint.
- `src/lib/ocr-service.ts`: OCR client dùng OpenAI SDK + baseURL (DeepInfra primary + Gemini official), prompt/schema OCR trả JSON; derive category chỉ `Food`/`Beverage`.
- `src/lib/ocr-jobs.ts`: helper cho job polling/list/notifications (UI dùng để hiển thị job đang xử lý).
- `src/app/api/process/route.ts`: upload + create job + trigger worker (async).
- `src/app/api/internal/ocr-jobs/complete/route.ts`: webhook callback để persist kết quả OCR và update job (xác thực bằng secret).
- `src/app/dashboard/page.tsx`: admin dashboard (list invoices + report + settings UI, pagination top-10, filters).
- `src/app/upload/page.tsx`: staff upload UI (mobile-friendly nút chọn/chụp ảnh) + theo dõi jobs của mình.
- `src/app/login/page.tsx`: login UI.
- `supabase/functions/ocr-worker/index.ts`: Supabase Edge Function worker OCR.
- SQL files (manual run on Supabase):
  - `SQL_AUTH_AND_RBAC.sql`: tạo `app_users`, thêm `ocr_jobs.created_by`, index/seed.
  - `SQL_VENDOR_MATCH_ONLY.sql`: thay trigger vendor theo “match-only” (không auto-create vendor).

## 5. Implemented Features
- Async OCR pipeline (job queue trong DB + Supabase Edge Function worker + callback API).
- OCR prompt tập trung invoice metadata + line items (theo thứ tự từ trên xuống).
- Dashboard admin:
  - List invoices + modal xem/sửa, approve/reject/paid.
  - Pagination top 10 + next/prev.
  - Filter nhanh theo ngày (mặc định “This week”, có “Last month”, “Last week”, custom range).
  - Status filter gồm `pending_review`, `approved`, `rejected`, `paid`.
  - Cost report tab (`/api/reports/cost`) theo vendor/product + insight tăng/giảm giá (logic nằm server).
  - Vendor settings + toggle vendor “prices include GST”.
  - Admin Users management (tạo/xóa staff/admin).
  - Maintenance endpoints cho cleanup (orphans + ảnh cũ qua Storage API).
- Staff mode:
  - Chỉ upload OCR, chỉ xem jobs do mình tạo (`ocr_jobs.created_by`).
- Session cache (sessionStorage) cho invoices/report/vendor settings để tránh fetch DB lặp lại khi mở modal/refresh trong cùng session (pattern ở frontend).
- Smart polling: khi có job đang chạy, UI poll theo chu kỳ (để cập nhật cross-device mà không dùng Supabase Realtime).

## 6. Important Flows
### 6.1 Admin login → dashboard
1) Vào `/login`, nhập username/password.
2) `POST /api/auth/login` set cookie session.
3) Redirect vào `/dashboard`.
4) Dashboard gọi APIs admin (invoices/report/settings) theo filters/pagination.

### 6.2 Staff login → upload OCR → theo dõi job
1) Vào `/login`, login role `staff`.
2) Middleware redirect staff vào `/upload`.
3) Staff upload ảnh → `POST /api/process` trả về `jobId`.
4) UI hiển thị job đang xử lý, poll `/api/ocr-jobs/:id` cho tới khi xong.

### 6.3 OCR job async end-to-end
1) `POST /api/process` upload ảnh + create `ocr_jobs` + trigger edge function.
2) `ocr-worker` claim job và chạy OCR.
3) Worker gọi webhook `/api/internal/ocr-jobs/complete` để lưu invoice/items.
4) Worker (hoặc webhook) cập nhật `ocr_jobs` sang `succeeded`/`failed` + retry metadata.

## 7. Current State
- Complete:
  - Auth + RBAC middleware.
  - Async OCR job flow + worker.
  - Admin dashboard list/report/settings.
  - Staff upload flow.
  - Paid status + date presets + pagination.
- Partially implemented:
  - Vendor match-only behavior phụ thuộc việc đã chạy SQL `SQL_VENDOR_MATCH_ONLY.sql` trên Supabase (không tự chạy từ app).
  - Một số DB migrations có “backward compatibility” (ví dụ `sort_order` trong `invoice_items`) — code có fallback khi DB chưa migrate.
- Broken/unstable (đã thấy trong repo/config hiện tại):
  - Supabase Edge Function source dùng import dạng URL (esm.sh) nên **không thể typecheck trong Next build**; repo đã exclude `supabase/functions/**` trong `tsconfig.json` để tránh fail build.

## 8. Known Issues / Technical Debt
- DB schema/migrations đang dựa vào việc chạy SQL thủ công trên Supabase (các file `SQL_*.sql`), không có migration runner tích hợp.
- Worker code nằm trong repo (`supabase/functions/ocr-worker/index.ts`) nhưng deploy Supabase Edge Function phụ thuộc CLI/infra bên ngoài (không có script deploy trong repo).
- Một số logic DB có fallback khi thiếu cột/bảng → có thể che giấu việc môi trường DB chưa đồng bộ (đọc trong `src/lib/db-service.ts`).

## 9. Conventions / Patterns
- Paths alias: `@/*` → `src/*` (tsconfig paths).
- API style: Next.js Route Handlers trả JSON `{ error: ... }` + HTTP status.
- RBAC:
  - Middleware chặn hầu hết; API routes vẫn thường dùng helper `requireSession/requireRole` để guard thêm.
- DB access:
  - Query/transaction qua `pg` (Pool) trong `src/lib/db-service.ts`.
  - Supabase JS dùng chủ yếu cho Storage operations.
- OCR:
  - OpenAI SDK, `chat.completions.create` với system+user prompt, parse JSON strict, có salvage JSON từ output bẩn.

## 10. Constraints / Do Not Break
- Staff phải **không thể** truy cập invoices/reports/vendor/settings/maintenance APIs và UI; chỉ `/upload` + OCR job APIs.
- Webhook `/api/internal/ocr-jobs/complete` phải luôn hoạt động độc lập session và chỉ tin vào `OCR_WORKER_WEBHOOK_SECRET`.
- Async OCR: `POST /api/process` phải trả `jobId` nhanh (không chạy OCR trực tiếp trên Vercel).
- Không xóa trực tiếp Storage bằng SQL (Supabase chặn); cleanup ảnh phải qua Storage API endpoints.
- `AUTH_JWT_SECRET` thay đổi sẽ invalid toàn bộ session cookie hiện tại (user phải login lại).

