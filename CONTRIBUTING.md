# 👥 Hướng dẫn Làm Việc Nhóm & Quy Trình Git (Team Collaboration Guide)

Tài liệu này quy định chuẩn hoá quy trình làm việc trên GitHub cho nhóm đồ án **SchedUED**, đảm bảo mô hình hoạt động chuyên nghiệp như một dự án thực tế trong doanh nghiệp.

---

## 1. Mô hình Phân Nhánh (Branching Strategy)

Dự án áp dụng mô hình **GitHub Flow có kiểm soát**:

```
main (Bảo vệ: không push trực tiếp, chỉ merge qua Pull Request)
 │
 ├── feat/#12-focus-room      (Tính năng mới gắn với Issue #12)
 ├── fix/#15-oauth-redirect    (Sửa lỗi gắn với Issue #15)
 └── docs/deployment-guide    (Tài liệu)
```

### Quy ước đặt tên nhánh:
* **Tính năng mới**: `feat/#<mã-issue>-<tên-ngắn-gọn>` (ví dụ: `feat/#1-login-ui`)
* **Sửa lỗi**: `fix/#<mã-issue>-<tên-lỗi>` (ví dụ: `fix/#3-date-picker-bug`)
* **Tài liệu**: `docs/<chủ-đề>` (ví dụ: `docs/api-guide`)
* **Tái cấu trúc**: `refactor/<khu-vực>` (ví dụ: `refactor/auth-service`)

---

## 2. Quy chuẩn Commit (Conventional Commits)

Mỗi commit cần mang thông điệp rõ ràng theo định dạng:
```
<loại>: <mô tả ngắn bằng tiếng Việt không dấu hoặc tiếng Anh>
```

| Loại | Ý nghĩa | Ví dụ |
| :--- | :--- | :--- |
| `feat` | Thêm tính năng mới | `feat: them trang chi tiet phong hoc` |
| `fix` | Sửa lỗi | `fix: sua loi khong dong bo lich outlook` |
| `docs` | Thêm/sửa tài liệu | `docs: cap nhat huong dan cai dat database` |
| `style` | Căn chỉnh format, css, không đổi logic | `style: chinh lai padding navbar mobile` |
| `refactor` | Tối ưu mã nguồn, không đổi tính năng | `refactor: tach ham xu ly websocket hub` |
| `test` | Thêm hoặc sửa test | `test: them unit test cho helper date-parser` |
| `chore` | Cấu hình, nâng cấp thư viện | `chore: cap nhat dependencies package.json` |

---

## 3. Quy trình làm việc từng bước (Step-by-Step Workflow)

### Bước 1: Nhận nhiệm vụ trên GitHub
1. Vào tab **Projects** trên GitHub repo $\rightarrow$ xem các thẻ trong cột `Todo`.
2. Kéo thẻ Issue bạn đảm nhận sang cột `In Progress`.
3. Gán tên mình vào mục **Assignee** trên Issue.

### Bước 2: Tạo nhánh và viết code
1. Kéo code mới nhất từ nhánh `main`:
   ```bash
   git checkout main
   git pull origin main
   ```
2. Tạo nhánh làm việc riêng theo mã Issue đã nhận:
   ```bash
   git checkout -b feat/#1-login-ui
   ```
3. Viết code và commit từng phần rõ ràng:
   ```bash
   git add .
   git commit -m "feat: xay dung giao dien dang nhap sinh vien"
   ```

### Bước 3: Kiểm tra chất lượng trước khi push
Chạy các lệnh sau tại máy cá nhân để đảm bảo không lỗi:
```bash
npm run typecheck    # Kiểm tra kiểu dữ liệu TypeScript
npm test             # Chạy bộ Unit Tests
```

### Bước 4: Đẩy nhánh lên GitHub & Mở Pull Request (PR)
1. Đẩy nhánh lên GitHub:
   ```bash
   git push -u origin feat/#1-login-ui
   ```
2. Lên GitHub, nhấn **Compare & pull request**.
3. Điền theo mẫu có sẵn trong template:
   * Ghi rõ `Closes #1` ở phần mô tả để tự động đóng Issue khi merge.
   * Chọn người đồng đội làm **Reviewers**.

### Bước 5: Code Review & Hợp nhất (Merge)
* **Người được tag Review:** Đọc mã nguồn, để lại nhận xét nếu cần sửa hoặc bấm **Approve** nếu đạt yêu cầu.
* Khi đã đủ duyệt và vượt qua quy trình CI tự động, người phụ trách tiến hành **Squash and merge** hoặc **Merge pull request**, sau đó xóa nhánh phụ.
* Kéo thẻ trên GitHub Projects sang cột `Done`.

---

## 4. Thiết lập bảo vệ nhánh `main` (Dành cho Trưởng nhóm)
Vào **Settings** $\rightarrow$ **Branches** $\rightarrow$ **Add branch protection rule**:
1. **Branch name pattern**: `main`
2. Tích chọn: **Require a pull request before merging**
   * Tích chọn: **Require approvals** (Đặt tối thiểu 1 người duyệt).
3. Tích chọn: **Require status checks to pass before merging** (Chọn workflow `CI / verify`).
4. Bấm **Create** / **Save changes**.
