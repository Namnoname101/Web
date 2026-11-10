# 📌 Quy Tắc Làm Việc Nhóm & Quy Trình Git (Đồ án SchedUED)

Chào mọi người, để đồ án nhóm mình làm việc trơn tru, không bị đè code lên nhau và đúng chuẩn theo yêu cầu của thầy cô, đây là quy trình bắt buộc mọi người phải tuân thủ từ giờ đến lúc nộp bài nhé.

---

## 1. Phân chia nhánh cho từng người (Bắt buộc)

Nhánh `main` là code chạy chính thức và **đã được bật chế độ khóa push trực tiếp**. Mỗi người chỉ làm việc trên đúng nhánh được phân công:

| Thành viên | Nhiệm vụ chính | Nhánh làm việc |
| :--- | :--- | :--- |
| **Trương Công Quảng Đại** | Lead, Kiến trúc, Bảo mật, Merge & Duyệt code | `lead/core-security-integration` |
| **Nguyễn Văn Khôi** | Frontend Logic, State React, API Client | `feat/frontend-logic` |
| **Phùng Đình Tuấn Kiệt** | UI/UX, CSS Tailwind, Animation, Responsive mobile | `feat/ui-responsive-motion` |
| **Nguyễn Văn Linh** | Backend REST API, Prisma, Database | `feat/backend-api-db` |
| **Nguyễn Anh Tuấn** | Thuật toán xếp lịch, xử lý xung đột, Test thuật toán | `feat/scheduling-engine` |

---

## 2. Quy trình làm việc từng bước (Mọi người làm theo đúng thứ tự này)

### Bước 1: Kéo code mới nhất về máy
Trước khi code hoặc commit, luôn cập nhật code mới từ `main` về máy mình:
```bash
git checkout main
git pull origin main
```

### Bước 2: Chuyển sang nhánh riêng của mình
*(Ví dụ Khôi làm frontend)*:
```bash
git checkout feat/frontend-logic
git merge main
```

### Bước 3: Code xong, kiểm tra lỗi trước khi commit
Làm xong phần nào thì chạy thử ở local để chắc chắn không lỗi:
```bash
npm run typecheck    # Kiểm tra TypeScript có báo đỏ không
npm test             # Chạy bộ test kiểm thử
```

### Bước 4: Commit và đẩy lên GitHub
Viết commit ngắn gọn, rõ ràng theo việc mình vừa làm:
```bash
git add .
git commit -m "feat(web): cap nhat form sua task"
git push origin <ten-nhanh-cua-ban>
```

### Bước 5: Tạo Pull Request (PR)
1. Lên GitHub, bấm vào nút **Compare & pull request** ở nhánh của bạn.
2. Điền mô tả ngắn xem đã sửa/thêm những gì, ghi kèm mã Issue (ví dụ: `Closes #4`).
3. Chọn **Đại** vào mục Reviewers.
4. Báo trên nhóm chat để Đại vào kiểm tra, approve và merge vào `main`.

---

## 3. Quy ước viết Commit Message cho gọn
Viết tiếng Việt không dấu hoặc tiếng Anh, có tiền tố đàng hoàng cho thầy dễ chấm:
* `feat: ...` : Thêm tính năng mới (vd: `feat: them nut chuyen hoc ky`)
* `fix: ...` : Sửa lỗi (vd: `fix: sua loi khong luu duoc deadline`)
* `style: ...` : Chỉnh CSS, màu sắc, responsive giao diện (vd: `style: fix loi vo layout tren dien thoai`)
* `docs: ...` : Sửa tài liệu, readme (vd: `docs: cap nhat huong dan chay local`)

---

## 4. Dặn dò quan trọng khi đi Báo cáo đồ án
Thầy sẽ xem lịch sử commit của từng người trên GitHub và hỏi vấn đáp trực tiếp theo đúng phần việc được chia:
* **Khôi:** Nắm chắc luồng component React, cách state hoạt động và gọi API.
* **Kiệt:** Nắm chắc cách dùng Tailwind, responsive trên màn hình điện thoại (390px) và animation.
* **Linh:** Nắm chắc cấu trúc database Prisma, các bảng và logic API.
* **Tuấn:** Nắm chắc từng bước chạy của thuật toán xếp lịch và cách giải quyết khi bị trùng giờ.

Anh em cố gắng bám sát để đồ án đạt kết quả cao nhất!
