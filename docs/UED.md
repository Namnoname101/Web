# Tích hợp cổng sinh viên UED

Tài liệu mô tả tích hợp với [cổng UED](https://qlht.ued.udn.vn/) theo cấu trúc
trang đã quan sát và mã nguồn hiện tại. Luồng thật trong môi trường local đã
được kiểm chứng tới bước: đăng nhập qua ứng dụng, xác minh hồ sơ, đọc thời khóa
biểu của học kỳ hiện tại, lưu PostgreSQL, hiển thị dữ liệu và đồng bộ lần hai
bằng phiên mã hóa mà không nhập lại mật khẩu. Ngày 14/09/2026, luồng xác thực
lại và hai lần đồng bộ liên tiếp cũng đã được chạy thành công sau khi chính
sách sản phẩm đổi sang nhập thời khóa biểu gốc thành lịch cố định.

## Phạm vi hiện có

Mapping mặc định hiện chỉ đồng bộ danh mục `SCHEDULE`: dòng thời khóa biểu,
thông tin học kỳ, phạm vi ngày từng tuần và Event buổi học cố định có giờ cụ thể.
Hồ sơ được đọc để xác minh danh tính; đây chưa phải chức năng đồng bộ toàn bộ
hồ sơ học tập.

Các danh mục `EXAM`, `COURSE`, `GRADE`, `ATTENDANCE`, `ANNOUNCEMENT` và `OTHER`
có trong schema cấu hình nhưng chưa có mapping mặc định được xác minh. Tên
môn/giảng viên trong thời khóa biểu không đồng nghĩa đã đồng bộ danh mục môn,
điểm hay điểm danh. Trang nghỉ dạy/học bù đã được nhận diện nhưng chưa có bộ
đọc tạo thay đổi lịch từ trang này.

## Danh tính và phiên đăng nhập

UED dùng mã sinh viên cùng mật khẩu cổng trường. Outlook là kết nối riêng qua
Microsoft OAuth với email trường. Ứng dụng không dùng mật khẩu UED cho Outlook
và không coi email chưa xác minh là căn cứ ghép tài khoản.

Trình duyệt gửi đăng nhập tới form `POST /login/login` đã quan sát. Ứng dụng
xác minh kết quả bằng `GET /sinhvien/thongtinsinhvien`:

| Dữ liệu | Nguồn đã xác minh |
| --- | --- |
| Dấu hiệu đăng nhập | Input `#txt_Sua_ma_sinh_vien:disabled` hiển thị |
| Mã sinh viên | Thuộc tính `value` của `#txt_Sua_ma_sinh_vien` |
| Họ tên | Thuộc tính `value` của `#txt_Sua_ho_ten_sinh_vien` |

Danh tính portal trả về phải khớp mã dùng khi đăng nhập. HTTP 200, chuyển trang
hoặc biến mất ô mật khẩu không đủ để xác nhận thành công. Form sửa hồ sơ
không được gửi.

Mật khẩu không được ghi vào database, file cấu hình, log hay fixture kiểm thử.
Ứng dụng lưu Playwright storage state, bao gồm cookie/phiên, trong trường bí
mật được mã hóa AES-256-GCM. Dữ liệu xác thực bổ sung gắn bản mã với người dùng
và provider `UED` nhằm ngăn tráo phiên giữa tài khoản. Crawler tiếp tục dùng
phiên này; không lưu mật khẩu để tự đăng nhập lại.

Challenge có hạn mười phút, gắn với trình duyệt và tài khoản ứng dụng khởi tạo,
tối đa năm lần gửi. Khi phiên hết hạn hoặc không còn khớp danh tính, kết nối
chuyển sang `REAUTH_REQUIRED`; sinh viên xác thực lại. Backend có cơ chế gửi
riêng ảnh CAPTCHA và nhận mã sinh viên nhập, nhưng lần đăng nhập thật đã kiểm
tra **không xuất hiện CAPTCHA**. Vì vậy CAPTCHA thực tế và các selector tương
ứng vẫn chưa được quan sát/xác minh. Cấu hình mặc định chưa khai báo selector
CAPTCHA; không được báo rằng luồng CAPTCHA thật đã đạt.

## Chọn học kỳ

Yêu cầu hiện tại là **mặc định học kỳ hiện tại của portal**. Không mặc định
học kỳ cũ chỉ vì học kỳ đó có dữ liệu để thử. Học kỳ trước chỉ được tải khi
sinh viên chủ động chọn. Năm học và học kỳ phải là lựa chọn thực sự xuất hiện
trên cổng, không suy đoán từ tháng hiện tại.

Trang chủ `/sinhvien` mở thời khóa biểu bằng menu `#thoikhoabieu`. Portal gửi
một document POST read-only tới `/sinhvien/thoikhoabieu` trước khi hiển thị
trang. Các điều khiển đã quan sát trên trang đích:

| Thành phần | Selector / hành vi |
| --- | --- |
| Năm học | `#cmb_sr_ds_nam_hoc` |
| Học kỳ | `#cmb_sr_ds_hoc_ky` |
| Form tìm kiếm | `#frmMain`, `POST /sinhvien/thoikhoabieu/index` |
| Nút Tìm | `#cmb_s_sr`, tên `btnSearch`, kiểu `button` |
| Kiểu hiển thị | `#cmbkieuin`: `1` ghép tuần; `2` tách theo tuần |
| Tuần được xem | Option của `#cmbtuan` trong chế độ theo tuần |

Chế độ mặc định `CURRENT` đọc banner toàn cổng dạng
`Hệ: … NH: yyyy-yyyy HK: n` để xác định học kỳ hiện tại, độc lập với bộ lọc
thời khóa biểu mà sinh viên từng chọn. Nếu bộ lọc hiển thị khác banner, bộ
đọc chọn lại học kỳ hiện tại và gửi Tìm. Banner phải cho đúng một kết quả
hợp lệ; cấu trúc không xác định được sẽ báo `UED_CURRENT_TERM_MAPPING_FAILED`.

`PATCH /api/v1/integrations/ued/term` nhận `academicYear` và `semester` để
chuyển sang chế độ `SELECTED`. Gửi `{ "mode": "CURRENT" }` để trở về theo
học kỳ hiện tại. Route lưu chế độ/lựa chọn rồi xếp lần đồng bộ tiếp theo.
`cursor.uedTermChoices` chứa `current` từ banner và `selected` đã đọc, cùng
các option có sẵn. Chế độ `CURRENT` đọc lại banner mỗi lần, không biến lần
quan sát trước thành lựa chọn cố định. Cơ chế này đã được triển khai; hành vi
`CURRENT` đã được kiểm tra với banner portal thật `NH: 2026-2027 HK: 1`. Chế
độ `SELECTED` giữ riêng học kỳ sinh viên chọn và đã có kiểm thử tự động, nhưng
việc tải một học kỳ cũ qua toàn bộ ứng dụng thật còn trong phạm vi nghiệm thu.

Nếu portal hiển thị chính xác `Không có dữ liệu.`, bộ đọc trả danh sách trống
của học kỳ đó. Không âm thầm đổi học kỳ; cũng không xem sự vắng mặt của dòng
cũ là bằng chứng lớp đã bị hủy.

## Đọc thời khóa biểu và ngày của từng buổi

Bảng tổng hợp là `#tb_index`. Dòng dữ liệu có mười ô: ô đầu là `th`, chín ô
còn lại là `td`. Bộ đọc dùng thứ tự ô chung, không giả định đều là `td`.

| Vị trí | Nội dung portal | Trường ứng dụng |
| --- | --- | --- |
| 1 | Thứ | `weekday` |
| 2 | Mã học phần | `courseCode` |
| 3 | Nhóm học phần | `group` |
| 4 | Sĩ số | `capacity` |
| 5 | Tên học phần | `title` |
| 6 | Buổi | `session` |
| 7 | Tiết học | `periods` |
| 8 | Tên cán bộ | `teacher` |
| 9 | Tên phòng | `location` |
| 10 | Tuần học | `weeks` |

Tiết và tuần là chuỗi đánh dấu theo **vị trí ký tự**, không phải danh sách số
để tách trực tiếp. Chữ số ở vị trí 10 là `0`, vị trí 11 là `1`; dấu gạch biểu
thị vị trí không học. Bộ giải mã kiểm tra chữ số có khớp vị trí và từ chối
chuỗi không hợp lệ. Khoảng trắng không tạo thêm tiết/tuần.

Bộ đọc lấy dòng tổng hợp rồi chuyển sang hiển thị theo tuần để đọc option
dạng `Tuần n (dd-mm-yyyy đến dd-mm-yyyy)`. Phạm vi ngày phải hợp lệ, số tuần
khớp giá trị option và không bị trùng. Ngày cụ thể được tính từ thứ trong tuần
tương ứng; kiểm tra tuần bắt đầu thứ Hai và buổi học không vượt ngày kết thúc.
Không suy đoán ngày đầu học kỳ từ năm học, tín chỉ hay lịch trường khác. Tuần
đi qua năm mới vẫn dùng đúng hai năm trong option.

Luồng portal thật đã xác minh chuyển `#cmbkieuin` sang giá trị `2` (tách theo
tuần), đọc được 19 phạm vi tuần của học kỳ hiện tại và dùng các phạm vi đó để
đổi thứ/tuần/tiết thành ngày giờ cụ thể. Đây là dữ liệu quan sát của lần smoke
test, không phải một hằng số được viết cứng trong mã.

Chỉ tuần được đánh dấu mới sinh buổi học. Tiết liền nhau được nhóm thành một
buổi, gồm các khoảng nghỉ ngắn nội bộ. Tiết không liền nhau thành buổi riêng.
Tiết 6 và 7 luôn tách để giữ khoảng nghỉ trưa 12:15–13:00. Lịch trường dùng
`Asia/Ho_Chi_Minh`, chuyển sang timestamp UTC khi tạo đề xuất.

## Giờ tiết học do chủ dự án xác nhận

Bảng này do người dùng cung cấp và xác nhận; chưa được mô tả là lịch chuông
đã đối chiếu độc lập với văn bản chính thức của trường. Mã nguồn dùng đúng
các mốc này, không giả định tiết học dài một giờ.

| Tiết | Bắt đầu | Kết thúc |
| --- | --- | --- |
| 1 | 07:00 | 07:50 |
| 2 | 07:50 | 08:40 |
| 3 | 08:45 | 09:35 |
| 4 | 09:40 | 10:30 |
| 5 | 10:35 | 11:25 |
| 6 | 11:25 | 12:15 |
| 7 | 13:00 | 13:50 |
| 8 | 13:50 | 14:40 |
| 9 | 14:45 | 15:35 |
| 10 | 15:40 | 16:30 |
| 11 | 16:35 | 17:25 |
| 12 | 17:25 | 18:15 |

Chuỗi portal có thể chứa đến mười lăm vị trí tiết. Giờ tiết 13–15 chưa được
xác nhận: gặp những tiết đó, bộ mở rộng báo `UED_PERIOD_TIMES_REQUIRED`, không
tự đặt giờ. Thiếu ngày của tuần học hoặc buổi học trùng cũng làm lần đồng bộ
thất bại thay vì tạo lịch không chắc chắn.

## Lưu dữ liệu và lịch học cố định

Dòng gốc lưu trong `AcademicRecord`, kèm học kỳ và phạm vi tuần làm bằng chứng.
Danh tính dòng gồm học kỳ cùng trường phân biệt lần học; danh tính buổi học
gồm học kỳ, mã/nhóm học phần, ngày và vị trí đoạn học trong dòng nguồn. Đổi
phòng hoặc sửa mốc tiết không tạo một buổi thứ hai bên cạnh buổi cũ. Hai đoạn
không liền nhau trong cùng dòng vẫn có danh tính riêng. Nhập học kỳ khác không
ghi đè thành cùng bản ghi.

Ở **ảnh chụp thời khóa biểu thành công đầu tiên của từng học kỳ**, `syncUed`
đưa toàn bộ buổi học đang có, không bị hủy, vào thẳng `Event` với
`source=SCHOOL_PORTAL`, `status=SCHEDULED` và metadata `fixed=true`. Đây là
dữ liệu lịch cố định: planner luôn coi nó là thời gian bận, không di chuyển,
chia nhỏ hoặc xếp task đè lên. Việc nhập ảnh chụp gốc, đánh dấu học kỳ đã có
baseline và tăng phiên bản lịch diễn ra trong cùng transaction; mọi đề xuất
`CREATE` cũ của chính buổi đó được hết hạn để không thể tạo trùng.

Các lần đồng bộ sau của học kỳ đã có baseline **không tự nhập một buổi hoàn
toàn mới**. Buổi đó trở thành đề xuất `EVENT_CHANGE/CREATE` để sinh viên kiểm
tra và chấp nhận hoặc từ chối. Danh sách học kỳ đã có baseline được lưu có
giới hạn trong `cursor.uedTimetableBaselineTerms`; cursor sai cấu trúc được xử
lý theo hướng an toàn (coi học kỳ đã có baseline), không biến dữ liệu mới
thành “lần đầu”. Khi nâng cấp dữ liệu cũ, AcademicRecord UED hoặc dấu vết một
lần sync thành công của học kỳ cũng được dùng để nhận diện baseline cũ.

Sau khi Event đã tồn tại, `syncUed` so sánh dữ liệu portal để tạo đề xuất
`EVENT_CHANGE` cho đổi giờ, đổi phòng, khôi phục hoặc hủy. Sinh viên xem và
quyết định; đồng bộ không âm thầm sửa buổi học cố định đã có. Thay đổi giống
hệt đề xuất đã chấp nhận/từ chối không lặp lại mỗi lần chạy. Hủy lớp chỉ phát
sinh từ bằng chứng trạng thái hủy được mapping rõ ràng, không từ một dòng bị
thiếu trong lần đọc mới.

Trong smoke test local bằng phiên thật trước khi đổi chính sách nhập lịch, bộ
đọc nhận 10 dòng thời khóa biểu gốc, mở rộng thành 72 buổi học riêng biệt và
tạo 72 đề xuất đang chờ. Lần đồng bộ kế tiếp tái dùng storage state đã mã hóa,
không yêu cầu nhập lại mật khẩu và không nhân đôi số đề xuất. Các con số này
chỉ là bằng chứng cho dữ liệu/học kỳ đã thử tại thời điểm nghiệm thu, không
phải kỳ vọng cố định cho mọi sinh viên.

Sau khi chính sách đổi, công cụ tương thích đã kiểm tra lại toàn bộ payload và
chuyển đúng 72/72 buổi đã xác minh thành Event cố định của HK1 năm học
2026–2027 (17/08/2026–27/11/2026 theo giờ Việt Nam). Không có mã nguồn trùng,
khoảng giờ sai hoặc xung đột với block task đã xác nhận; 72 đề xuất `CREATE`
gần nhất được hết hạn để không thể tạo trùng. Lần chạy dry-run kế tiếp trả về
0 candidate, chứng minh thao tác có tính lặp an toàn trên trạng thái hiện tại.

Khoảng bốn giờ sau lần đăng nhập smoke test, portal không còn chấp nhận storage
state cũ. Worker đã chuyển tích hợp sang `REAUTH_REQUIRED`, giữ nguyên 10 dòng
gốc và 72 đề xuất, đồng thời giao diện yêu cầu sinh viên xác thực lại. Đây là
bằng chứng live cho nhánh hết phiên; ứng dụng không thử đăng nhập lại bằng mật
khẩu vì mật khẩu chưa bao giờ được lưu.

Sau khi chủ tài khoản xác nhận, luồng xác thực lại ngày 14/09/2026 đã thành
công qua chính giao diện ứng dụng, danh tính portal khớp và không xuất hiện
CAPTCHA. Hai lần sync `CURRENT` liên tiếp đều đọc lại 10 dòng, giữ nguyên 72
Event cố định, không tạo Event/đề xuất trùng, không tăng failure và kết nối ở
trạng thái `CONNECTED`. Lần thứ hai tái dùng storage state mới đã mã hóa, không
gửi lại mật khẩu.

Trước khi ghi, transaction kiểm tra lại phiên mã hóa, kết nối, lựa chọn học kỳ
và lease worker. Lần crawl cũ không được ghi đè sau khi sinh viên ngắt/kết nối
lại, đổi học kỳ hoặc worker khác tiếp quản. Storage state sau crawl được mã
hóa lại.

## Giới hạn truy cập cổng trường

Tích hợp chỉ đọc dữ liệu sinh viên được phép xem. Nó không đăng ký học phần,
đóng học phí, đổi mật khẩu hay sửa hồ sơ. Navigation/XHR/fetch chỉ được đến
đường dẫn cùng origin đã xét duyệt. Request ngoài origin, WebSocket, download
và thao tác ghi bị chặn.

Có ba ngoại lệ POST cụ thể: gửi đăng nhập; nhấn menu thời khóa biểu để mở trang
read-only; và form **Tìm** thời khóa biểu. POST mở trang chỉ được phép một lần,
tới đúng `/sinhvien/thoikhoabieu`, là document navigation và chỉ chứa hai
trường portal đã quan sát (`pu`, `sskey`) theo định dạng hợp lệ. Filter POST
chỉ được phép một lần trong lúc chọn học kỳ, tới đúng
`/sinhvien/thoikhoabieu/index`, với năm/học kỳ dự kiến và tập trường form đã
quan sát. Trường hành động phải trống; nút lưu, tham số hành động mới hoặc
năm/học kỳ mâu thuẫn không được chấp nhận. Token ẩn portal chỉ tồn tại trong
phiên trình duyệt, không được ghi vào dữ liệu học tập hay log.

Đường dẫn đọc danh sách nghỉ dạy/học bù đã xác minh là
`/sinhvien/thoikhoabieu/dangkynghidaybu`. Ngoại lệ tên đường dẫn này không mở
quyền đăng ký, action con hay query ghi dữ liệu; cũng không tự thêm trang đó
vào danh sách đang đồng bộ.

## Cấu hình và bằng chứng kiểm thử

`UED_ADAPTER_JSON` cho phép thay mapping theo cấu trúc portal đã quan sát;
schema kiểm tra trước khi mở trình duyệt. Readiness chỉ phản ánh cấu hình có
hợp lệ/có mapping, không chứng minh đăng nhập hoặc crawl thật hoạt động.
Chromium của Playwright phải có sẵn ở môi trường chạy API/worker. Khóa mã hóa
phải cấp bằng secret môi trường và giữ ổn định giữa các lần khởi động.

Unit test `apps/api/tests/unit/ued-timetable.test.ts` bao phủ giờ chính xác đủ
12 tiết, tuần qua năm mới, Chủ nhật, khoảng nghỉ trưa, tuần 10/20, tiết không
liên tục và dữ liệu mâu thuẫn. Test adapter/service còn bao phủ current/selected
term, POST read-only, danh tính buổi học ổn định, baseline theo từng học kỳ,
buổi mới sau baseline phải chờ xác nhận và chống crawl cũ ghi đè. Đây là bằng
chứng ở cấp mã; smoke test thật nêu trên bổ sung bằng chứng cho học kỳ hiện tại
và tái dùng phiên.

Nghiệm thu UED còn cần kiểm tra học kỳ cũ ở chế độ `SELECTED`, CAPTCHA khi
portal thật sự đưa ra challenge và mapping các danh mục học tập còn thiếu.
Nhập buổi học gốc cố định và reconcile thay đổi UED đã có unit test. Luồng
accept/reject cho thay đổi UED vẫn được kiểm tra bằng bản sao cấu trúc trong
database `_test`: accept tạo event nguồn `SCHOOL_PORTAL`, reject không tạo
event. Fixture, tài liệu và log trong repo chỉ chứa cấu trúc đã khử dữ liệu
riêng; không lưu mật khẩu, mã sinh viên thật, cookie, token hay ảnh hồ sơ.

Với database nâng cấp từ chính sách cũ, chạy
`npm run ued:materialize-legacy` để chỉ xem số candidate. Chỉ sau khi kiểm tra
phạm vi mới chạy `npm run ued:materialize-legacy -- --apply`. Công cụ chỉ nhận
đề xuất `EVENT_CHANGE/PENDING/CREATE` có bằng chứng nguồn UED, kiểm tra lại
schema sự kiện/học kỳ, khóa theo người dùng và rollback cả transaction nếu có
payload không hợp lệ.
