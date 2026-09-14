# Tiến độ triển khai

## Mục tiêu

Hoàn thiện phiên bản dùng được, kiểm thử từng luồng và ghi rõ giới hạn tích hợp
thật. Goal được kích hoạt ngày 13/09/2026. File này phân biệt rõ tính năng đã có
trong mã với tính năng đã được nghiệm thu bằng dịch vụ thật.

## Các mốc

- [x] **M0 — Phạm vi và kiến trúc.** Đã chốt yêu cầu, cấu trúc monorepo,
  PostgreSQL + Prisma, mô hình đề xuất để sinh viên luôn là người quyết định.
- [x] **M1 — Nền tảng dữ liệu và API.** Schema/migration có User, Event, Task,
  TaskScheduleBlock, Session, Suggestion, Notification, Integration và
  AcademicRecord; API CRUD và transaction đều giới hạn theo người dùng.
- [x] **M2 — Xếp lịch và đề xuất.** Planner tôn trọng giờ hoạt động, giờ nghỉ,
  block tối thiểu, ưu tiên/deadline, tách task, thời gian di chuyển và các block
  đã được sinh viên giữ lại; accept/reject kiểm tra phiên bản và xung đột lại.
- [x] **M3 — Giao diện lõi hoàn chỉnh.** Dashboard, Calendar, Tasks,
  Suggestions, Integrations, Notifications và Settings Việt/Anh đã chạy trong
  trình duyệt. Danh sách UED hiển thị/sắp xếp/lọc theo ngày, giờ, phòng và học
  kỳ; trang nhiều dữ liệu đã được nghiệm thu ở desktop và viewport 390×844.
- [ ] **M4 — Outlook thật.** OAuth PKCE, quét toàn mailbox có phân trang,
  parser Việt/Anh, worker, thông báo và đề xuất đã có trong mã/test; chưa có
  cấu hình Microsoft thật để nghiệm thu đăng nhập và mailbox end-to-end.
- [ ] **M5 — UED đầy đủ.** Kết nối, lưu phiên mã hóa, current/selected term,
  đọc thời khóa biểu theo tuần và nhập Event lịch học cố định đã triển khai. Phiên
  thật đã chứng minh xác thực lại, học kỳ hiện tại và tái dùng session; còn thiếu smoke học
  kỳ cũ, CAPTCHA và mapping các trang học tập read-only khác. Accept/reject đã
  được nghiệm thu riêng trên bản sao bằng database `_test`.
- [ ] **M6 — Phát hành.** Build/typecheck và các suite unit/integration chính
  đã chạy đạt trong quá trình phát triển; đã có Dockerfile, Railway IaC hiện
  hành và runbook Railway/Fly. Còn cần build/smoke image trên máy có Docker,
  cấu hình tài khoản/domain/secrets và nghiệm thu bản triển khai thật.

## Bằng chứng UED thật gần nhất

Smoke test local ngày 13/09/2026 đã đi qua giao diện ứng dụng, không thao tác
ghi trên cổng trường:

- Xác minh đăng nhập bằng hồ sơ trả về từ UED; không tin riêng dữ liệu người
  dùng gửi lên.
- Nhận diện đúng banner `NH: 2026-2027 HK: 1` ở chế độ `CURRENT`.
- Đọc 10 dòng thời khóa biểu gốc và 19 khoảng tuần bằng chế độ “Tách theo
  tuần”; ánh xạ thành 72 buổi học/đề xuất riêng biệt theo bảng giờ 12 tiết.
- Đồng bộ lần hai bằng storage state mã hóa, không nhập lại mật khẩu và không
  tạo trùng đề xuất; kết nối không báo lỗi.
- Sau khoảng bốn giờ, phiên UED hết hạn thật đã chuyển đúng sang
  `REAUTH_REQUIRED`; 10 dòng gốc và 72 đề xuất đang chờ vẫn được giữ nguyên.
- Lần smoke diễn ra trước thay đổi chính sách nhập lịch: giữ toàn bộ đề xuất
  ở trạng thái chờ. Sau thay đổi chính sách, đã chuyển 72/72 buổi đã xác minh
  thành Event cố định, khớp nguồn, không trùng/sai khoảng giờ/xung đột task;
  72 đề xuất CREATE gần nhất đã hết hạn an toàn.
- Ngày 14/09/2026, xác thực lại qua giao diện thành công, danh tính UED khớp và
  không có CAPTCHA. Hai sync `CURRENT` liên tiếp đọc 10 dòng, giữ đúng 72 Event
  cố định, tạo 0 Event/đề xuất trùng; integration vẫn `CONNECTED`, failure=0.
- Hai request `bootstrap` có xác thực trả đủ 72 Event với metadata cố định.
  Planner chạy chỉ đọc trên 9 Event UED thật trong một cửa sổ 30 ngày đã xếp
  11 block kiểm chứng giả lập mà không block nào chồng UED, ra ngoài giờ hoạt
  động hoặc lọt vào giờ nghỉ.
- Smoke UI headless trên tuần có lớp gần nhất hiển thị 6 thẻ lớp, mở chi tiết
  thấy nhãn “Cố định từ UED” cùng giải thích planner giữ nguyên buổi học; trang
  desktop không tràn ngang. Phiên ứng dụng tạm được xóa sau kiểm thử.
- Lần đăng nhập này không xuất hiện CAPTCHA, nên chưa có bằng chứng live cho
  nhánh CAPTCHA. Chế độ học kỳ `SELECTED` đã có mã và test nhưng chưa smoke
  bằng một học kỳ cũ trên portal thật.

Regression gần nhất ngày 14/09/2026: 116 unit test đạt (105 API + 11 web),
8 integration test đạt, typecheck toàn monorepo (kể cả Railway IaC) đạt,
2 browser E2E đạt trên database `_test` cô lập (luồng tạo task → xem trước →
accept và viewport 390×844), production build đạt và `npm audit --omit=dev`
báo 0 lỗ hổng đã biết.

Không đưa mã sinh viên, mật khẩu, cookie, token, họ tên hoặc dữ liệu lớp cụ thể
của người thử vào tài liệu hay fixture.

## Nguồn nghiên cứu

- UED: https://qlht.ued.udn.vn/ — đã kiểm tra cả trang đăng nhập, hồ sơ và thời
  khóa biểu sau đăng nhập bằng phiên được chủ tài khoản cho phép.
- Microsoft OAuth/PKCE: https://learn.microsoft.com/en-us/entra/identity-platform/v2-oauth2-auth-code-flow
- Đọc thư toàn mailbox/phân trang: https://learn.microsoft.com/en-us/graph/api/user-list-messages?view=graph-rest-1.0
- Playwright lưu phiên: https://playwright.dev/docs/auth
