# Kế hoạch cải tổ UI/UX toàn diện - Chuẩn Pro Max (Loại bỏ triệt để AI Smells)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Chuyển đổi toàn bộ giao diện từ phong cách demo AI (gradient lòe loẹt, bo góc phồng to, sparkles rải rác) sang sản phẩm phần mềm giáo dục chuyên nghiệp, sắc nét, chân thực chuẩn Swiss Modern / Linear & Notion design system cho sinh viên ĐH Sư Phạm Đà Nẵng.

**Architecture:** Sử dụng CSS variables và design tokens chuẩn mực từ `ui-ux-pro-max-skill` (Minimalism & Swiss Style, Density 7/10), tái cấu trúc `index.css`, `shell.css`, `dashboard.css`, `calendar.css`, `tasks.css`, tích hợp ngữ cảnh sinh viên thực tế (MSSV, phòng học, mã môn học, học kỳ) và loại bỏ hoàn toàn các anti-pattern của AI.

**Tech Stack:** React 19, TypeScript, Vite, CSS Modules / Pure CSS, Lucide Icons (SVG).

**Spec:** Áp dụng bộ quy tắc thiết kế từ `nextlevelbuilder/ui-ux-pro-max-skill`:
- Typography: Inter/System UI với modular scale, `font-variant-numeric: tabular-nums` cho thời gian/con số.
- Colors: Slate neutral base (`#f8fafc`, `#ffffff`, `#e2e8f0`), Sapphire Blue primary (`#1d4ed8`), Emerald accent (`#059669`), Crimson destructive (`#dc2626`).
- Density: 7/10 (tiêu chuẩn SaaS chuyên nghiệp, không làm card phồng rỗng vô ích).
- Zero AI smells: Không gradient tím/hồng chói, không icon Sparkles vô tội vạ, không bo góc dị dạng >20px cho card thường.

## Global Constraints
- Bảo toàn 100% tính năng logic và API hiện tại của monorepo.
- 0 lỗi typecheck TypeScript trên toàn bộ repo.
- Toàn bộ unit tests (221 tests) phải tiếp tục pass 100%.
- Giữ vững hỗ trợ đa ngôn ngữ (tiếng Việt / English) và chuẩn responsive (375px - 1440px).

## Review Focus
- Sự tinh tế, chỉn chu của các đường viền 1px, trạng thái hover/focus mượt mà (150-200ms).
- Ngữ cảnh thực tế của sinh viên ĐH Sư Phạm Đà Nẵng hiện diện tự nhiên, thuyết phục giảng viên rằng đây là sản phẩm thực tế được đầu tư công phu.

---

### Task 1: Thiết lập Hệ thống Design Tokens & Typography Chuẩn Mực (`index.css`)

**Files:**
- Modify: `apps/web/src/index.css`
- Verify: Chạy typecheck và kiểm tra visual variables

**Checklist:**
- [ ] Định nghĩa lại bộ biến CSS chuẩn Swiss Modern: `--bg-canvas: #f8fafc`, `--bg-card: #ffffff`, `--border-subtle: #e2e8f0`, `--border-focus: #2563eb`, `--text-main: #0f172a`, `--text-muted: #64748b`, `--primary: #1d4ed8`, `--primary-hover: #1e40af`.
- [ ] Bật `tabular-nums` cho toàn bộ hiển thị ngày giờ, thời lượng, số liệu để thẳng hàng tuyệt đối.
- [ ] Chuẩn hóa bán kính bo góc: `border-radius: 8px` cho nút/input, `12px` cho card/panel, `16px` cho modal (thay vì bo 20-24px phồng AI).
- [ ] Loại bỏ các gradient lòe loẹt, thay bằng bóng đổ thanh lịch tự nhiên (`box-shadow: 0 1px 3px 0 rgba(0, 0, 0, 0.05), 0 1px 2px -1px rgba(0, 0, 0, 0.05)`).

---

### Task 2: Nâng cấp Header & App Shell với Thông tin Sinh viên Thực tế (`AppShell.tsx`, `shell.css`)

**Files:**
- Modify: `apps/web/src/AppShell.tsx`
- Modify: `apps/web/src/shell.css`

**Checklist:**
- [ ] Thêm dải thông tin sinh viên chân thực trên TopBar: `Trương Công Quảng Đại · 24CNTT3` kèm badge trường `ĐH Sư Phạm - ĐHĐN` và học kỳ `HK2 (2025-2026)`.
- [ ] Tinh chỉnh Sidebar: icon Lucide sắc nét, thanh active chỉ báo xanh sapphire tinh tế, phím tắt nhanh trực quan.
- [ ] Làm đẹp menu điều hướng, breadcrumb và responsive mobile drawer.

---

### Task 3: Tái thiết kế Dashboard Chuẩn SaaS Chuyên nghiệp (`Dashboard.tsx`, `dashboard.css`)

**Files:**
- Modify: `apps/web/src/Dashboard.tsx`
- Modify: `apps/web/src/dashboard.css`

**Checklist:**
- [ ] Thay banner gradient "Sparkles" kiểu AI bằng Widget **"Tiến độ thiết lập lịch học"** (Onboarding Checklist) phong cách Linear/Notion: nhỏ gọn, viền 1px sắc nét, tick xanh chuẩn mực.
- [ ] Thiết kế lại thẻ "LỊCH TIẾP THEO / ĐANG DIỄN RA": phong cách card công việc chuyên nghiệp, có thẻ tag phòng học (ví dụ: `Phòng A1-203`), mã môn học, thời gian countdown chính xác.
- [ ] Chuẩn hóa 4 thẻ thống kê (`StatCard`): hiển thị số to, font rõ ràng, nhãn phụ ngữ cảnh sinh viên, không gradient màu mè.
- [ ] Tối ưu danh sách lịch hôm nay (Sáng - Chiều - Tối) với card timeline phẳng, đường kẻ giờ chuẩn.

---

### Task 4: Nâng cấp Giao diện Lịch Tuần & Công việc (`Calendar.tsx`, `calendar.css`, `Tasks.tsx`)

**Files:**
- Modify: `apps/web/src/Calendar.tsx`
- Modify: `apps/web/src/calendar.css`
- Modify: `apps/web/src/Tasks.tsx`

**Checklist:**
- [ ] Lịch tuần: Đường kẻ giờ tinh tế `border-slate-100`, khối tiết học UED hiển thị mã môn + phòng học + giảng viên rõ nét, vạch báo giờ hiện tại màu đỏ mỏng sắc sảo.
- [ ] Trang Công việc: Bảng danh sách bài tập gọn gàng, badge ưu tiên phẳng thanh lịch, deadline tương đối (`còn 2 ngày`, `quá hạn`).
- [ ] Xác nhận mọi nút bấm đều có `cursor: pointer`, hiệu ứng hover nhẹ nhàng (150ms).

---

### Task 5: Kiểm thử Toàn diện & Xác thực (Verification)

**Files:**
- Verify: Toàn bộ codebase qua Typecheck, Unit Tests và Build

**Checklist:**
- [ ] Chạy `npm run typecheck` (0 errors).
- [ ] Chạy `npx vitest run --fileParallelism=false` (221 tests passing).
- [ ] Kiểm tra giao diện trên trình duyệt tại `http://localhost:5173`.
- [ ] Commit và push lên nhánh `main`.
