# Hướng dẫn sử dụng — Madam Yen IMS

App quản lý hoá đơn cho nhà hàng (OCR + duyệt + xuất CSV + Credit Note).

---

## 1) Mở app

- Vào trang `…/dashboard` (Vercel Production).
- Bạn sẽ thấy:
  - Thống kê tổng chi tiêu / GST / số hoá đơn / chờ duyệt
  - Ô tìm kiếm + bộ lọc trạng thái + bộ lọc ngày
  - Danh sách hoá đơn

---

## 2) Thêm hoá đơn bằng OCR (chụp ảnh)

1. Bấm **“Thêm hoá đơn”**.
2. Chọn/chụp ảnh hoá đơn.
3. App hiển thị **preview ảnh tối ưu** → kiểm tra ảnh rõ, không bị xoay sai.
4. Bấm **Xác nhận/Chạy OCR** (app sẽ tự retry tối đa 3 lần).
5. OCR xong → ảnh được upload lên Storage → dữ liệu được lưu vào database → hoá đơn vào danh sách ở trạng thái **“Chờ duyệt”**.

Lưu ý:
- OCR dùng **Gemini Flash** (không dùng fallback model).
- Thứ tự mặt hàng được giữ theo OCR nhờ cột `sort_order` trong `invoice_items`.

---

## 3) Xử lý lỗi OCR thường gặp

### 3.1 “Gemini đang quá tải / 503 high demand”
- Đây là lỗi tạm thời do model quá tải.
- App đã tự retry tối đa 3 lần.
- Nếu vẫn lỗi: **đợi 1 phút rồi bấm “Thử lại”**.

### 3.2 “Unexpected token… not valid JSON / OCR trả về không đúng định dạng”
- Thường do OCR trả text lẫn với JSON hoặc upstream trả lỗi dạng text.
- Cách xử lý:
  - Bấm **“Thử lại”**
  - Nếu vẫn lỗi: chụp lại ảnh rõ hơn (đủ sáng, không mất góc, không nghiêng nhiều)

---

## 4) Duyệt / Từ chối / Sửa hoá đơn

1. Click vào 1 dòng hoá đơn trong danh sách để mở popup.
2. Kiểm tra ảnh và dữ liệu.

### Duyệt / Từ chối
- Nếu hoá đơn đang **“Chờ duyệt”**:
  - Bấm **“Duyệt”** hoặc **“Từ chối”**

### Sửa (để sửa OCR sai trước khi duyệt)
- Bấm **“Sửa”**
- Trong chế độ sửa:
  - Các trường text có thể bấm vào để sửa (UI gần như giữ nguyên)
  - **Amount (thành tiền)** luôn **tự tính**, không nhập tay
  - **Standard** chỉ hiển thị sau tên sản phẩm (không cần nhập/sửa)
- Bấm **“Lưu”** để lưu thay đổi

---

## 5) Thêm hoá đơn thủ công (Manual)

1. Bấm **“✍️ Thêm thủ công”**
2. Thông tin bắt buộc:
   - **Nhà cung cấp**
   - **Ngày**
3. Mặt hàng:
   - Bấm **“+ Thêm dòng”** để thêm dòng **ở đầu** (nhập nhanh)
   - Nhập **Tên sản phẩm**, **Số lượng**, **Đơn vị**, **Đơn giá**
   - **Thành tiền / Subtotal / GST / Total** sẽ **tự tính**

Gợi ý nhập:
- Có gợi ý nhà cung cấp / đơn vị / tên sản phẩm từ catalog (tự sinh ra từ các hoá đơn trước).

---

## 6) Credit Note (tạo từ hoá đơn có sẵn)

Credit Note dùng để trừ tiền cho những mặt hàng sai/hàng thiếu.

### Tạo Credit Note từ 1 hoá đơn
1. Mở hoá đơn (không phải Credit Note).
2. Bấm **“🧾 Credit”**
3. Chọn các mặt hàng cần credit (mặc định **không chọn**).
4. Nhập số lượng credit (dương trong form) → app sẽ tính ra Credit Note.
5. Bấm **“Tạo Credit Note”**

### Quy tắc quan trọng
- Credit Note lưu trong DB:
  - `type = "Credit Note"`
  - `parent_invoice_id` trỏ tới hoá đơn gốc
  - Tất cả line item:
    - `quantity` và `amount_excl_gst` **luôn âm**
    - `price` **luôn dương**
  - Totals **luôn âm** và UI hiển thị màu đỏ.
- **Không thể tạo Credit Note từ một Credit Note** (UI đã ẩn nút và API cũng chặn).

---

## 7) Bộ lọc & tìm kiếm

### Trạng thái
- **Tất cả / Chờ duyệt / Đã duyệt / Từ chối**

### Ngày
- **Hôm nay**
- **Tháng này**
- **Tuỳ chọn**: chọn từ ngày → đến ngày → bấm **Áp dụng**

### Tìm kiếm
- Tìm theo **Nhà cung cấp** hoặc **Mã hoá đơn**

---

## 8) Xuất CSV

- Bấm nút **CSV** trên dashboard để tải file tổng hợp danh sách hoá đơn.

---

## 9) Xoá hoá đơn

- Trong popup hoá đơn, bấm **“Xoá”**
- Hệ thống sẽ xoá:
  - Record hoá đơn + line items (cascade)
  - Ảnh trong Storage (nếu có)

---

## 10) Ghi chú kỹ thuật (cho admin/dev)

### Chạy local
```bash
npm install
npm run dev
```

### Biến môi trường thường dùng
- `GEMINI_API_KEY`
- `NEXT_PUBLIC_SUPABASE_URL`
- `NEXT_PUBLIC_SUPABASE_ANON_KEY`
- `SUPABASE_SERVICE_ROLE_KEY` (chỉ server, không đưa lên client)
- `DATABASE_URL` (Postgres connection string)

### Setup / migrate database
Chạy 1 lần (idempotent):
```bash
node scripts/db-setup.mjs
```

Migrate này sẽ tạo/alter schema cần thiết (catalog + triggers + `invoice_items.sort_order` + backfill).

