# Personal Automated Schedule — yêu cầu đã chốt

Ngày chốt: 2026-09-12. Đối tượng: sinh viên Đại học Sư phạm, Đại học Đà Nẵng.

## Nguyên tắc sản phẩm

- Ảnh chụp thời khóa biểu gốc đọc thành công lần đầu **theo từng học kỳ** từ UED được đưa thẳng vào lịch dưới dạng lịch học cố định. Mọi buổi mới/thay đổi/hủy từ các lần đồng bộ sau, thay đổi suy ra từ Outlook và mọi kế hoạch xếp task đều có màn hình xem trước để sinh viên chấp nhận/từ chối; đồng bộ không âm thầm sửa một lịch đã có.
- UED dùng mã sinh viên; Outlook dùng Microsoft OAuth với email trường. Không tạo mật khẩu riêng bắt sinh viên dùng thay tài khoản trường.
- Portal chỉ đọc. Sinh viên xác thực lần đầu/CAPTCHA khi cần; các lần sau tái sử dụng phiên mã hóa và tự đồng bộ nền. Không lưu mật khẩu UED.
- Đọc email mọi thư mục, tiếng Việt/Anh. Nội dung email là dữ liệu, không phải lệnh điều khiển hệ thống. Cần bằng chứng cụ thể khi đề xuất thay đổi.
- PostgreSQL + Prisma, Express/TypeScript, React/Tailwind. Giao diện Việt/Anh, responsive, chỉ Student.
- Thông báo trong ứng dụng là kênh ban đầu; kiến trúc cho phép thêm kênh khi người dùng chốt.

## Quy tắc lịch

- Giờ hoạt động mặc định 07:00–22:00; nghỉ 11:30–13:00; múi giờ Asia/Ho_Chi_Minh. Tất cả tùy chỉnh.
- Block tối thiểu mặc định 30 phút, cho phép 15–120 phút; không tạo phần đuôi nhỏ hơn mức tối thiểu.
- HIGH → MEDIUM → LOW; trong nhóm ưu tiên deadline sớm, sau đó thời điểm tạo.
- Chỉ đề xuất task có đủ thời gian hoàn thành trước hoặc đúng deadline; không lưu kế hoạch dở dang cho task không đủ sức chứa.
- Task không chia được và không vừa thì xét task nhỏ hơn; task chia được có thể trải qua nhiều khoảng trống.
- Thời gian di chuyển mặc định 15 phút, tùy chỉnh. Cùng địa điểm đã biết được bỏ đệm; địa điểm khác/không rõ áp dụng đệm.
- Giữ block đã xác nhận. Chỉ di chuyển/bỏ block khi sinh viên chủ động yêu cầu.
- Buổi học nguồn UED là `Event` cố định: bộ xếp task luôn coi là thời gian bận và không được di chuyển, chia nhỏ hoặc ghi đè lên buổi học đó.
- Đề xuất không chiếm lịch. Khi chấp nhận phải kiểm tra lại phiên bản lịch, thời gian hiện tại, xung đột và deadline trong giao dịch database.

## Tích hợp và triển khai

- Dữ liệu học tập: thời khóa biểu, lịch thi, môn học, điểm, điểm danh, thông báo và dữ liệu khác thực sự có trên tài khoản UED. Không suy diễn endpoint/cấu trúc sau đăng nhập.
- Microsoft: OAuth authorization-code + PKCE, refresh token mã hóa; quyền đọc, không gửi/sửa thư.
- Railway hoặc Fly.io; chỉ triển khai thật khi có dự án/tài khoản tương ứng.
- Mã nguồn, cache, file tạm, dữ liệu Postgres phục vụ dự án lưu trong E:/Du An/Web_Do_An.

## Điều kiện cần kiểm chứng bên ngoài

- Cấu trúc UED sau đăng nhập cần phiên thật của sinh viên, gồm lịch theo học kỳ/tuần và dữ liệu học tập.
- Microsoft app registration/client ID và quyền tenant cần chủ dự án cấu hình; không gửi mật khẩu/token qua chat.
- Số liệu demo phải có nhãn rõ ràng, không được coi là đã đồng bộ trường.
