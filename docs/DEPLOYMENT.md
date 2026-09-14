# Triển khai production

Ứng dụng được build thành một container: Express phục vụ cả API lẫn bundle
React, còn worker đồng bộ chạy trong cùng tiến trình ở cấu hình MVP. PostgreSQL
là dịch vụ riêng. Container tự chạy `prisma migrate deploy` trước khi mở API.

## Biến môi trường bắt buộc

- `DATABASE_URL`: chuỗi kết nối PostgreSQL có TLS theo yêu cầu nhà cung cấp.
- `ENCRYPTION_KEY`: đúng 32 byte ngẫu nhiên mã hóa base64; dùng để mã hóa phiên
  UED và token Outlook. Không đổi khóa khi còn dữ liệu tích hợp đang lưu.
- `WEB_ORIGIN`: URL HTTPS chính xác của ứng dụng, không có dấu `/` cuối.
- `NODE_ENV=production`, `WORKER_ENABLED=true`, `TRUST_PROXY_HOPS=1`.

Mọi kết nối Prisma/pg của ứng dụng được ép dùng session timezone `UTC`; các
cột `timestamptz` luôn lưu một thời điểm tuyệt đối, còn giao diện mới chuyển
sang múi giờ IANA trong hồ sơ sinh viên. Không đặt `PGTZ` để thay đổi hành vi
của lệnh migration. Migration
`20260914170000_normalize_timestamp_session_utc` sửa dữ liệu của bản cũ từng
kế thừa timezone PostgreSQL không phải UTC; phải sao lưu/PITR trước khi nâng
cấp một database đang có dữ liệu.

Outlook cần thêm `MICROSOFT_CLIENT_ID`, `MICROSOFT_CLIENT_SECRET`,
`MICROSOFT_TENANT_ID`, `MICROSOFT_REDIRECT_URI` và
`MICROSOFT_ALLOWED_EMAIL_DOMAINS`. Redirect URI phải là
`https://<domain>/api/v1/auth/microsoft/callback` và phải trùng tuyệt đối với
app registration. UED dùng adapter mặc định đã kiểm chứng; chỉ đặt
`UED_ADAPTER_JSON` khi form read-only của portal thực sự thay đổi.

## Railway

Railway Config-as-Code (`railway.json`/`railway.toml`) đã deprecated, không cho
project mới opt-in và sẽ ngừng đọc ngày 01/12/2026. Repo dùng API thay thế hiện
hành là `.railway/railway.ts` và package `railway` được khóa trong lockfile.

1. Cài Railway CLI, đăng nhập, chạy `railway link`, rồi xem trước bằng
   `railway config plan`. File IaC tạo PostgreSQL và application service nhưng
   không đoán GitHub repo/domain thuộc tài khoản của chủ dự án.
2. Đặt `WEB_ORIGIN`, `ENCRYPTION_KEY` và các biến Microsoft trong Railway. Các
   giá trị này dùng `preserve()` nên không bao giờ được chép vào source.
3. Chỉ sau khi đọc kỹ plan mới chạy `railway config apply`; sau đó nối source
   repository nếu project chưa có và triển khai `Dockerfile`.
4. Tạo domain HTTPS, cập nhật `WEB_ORIGIN` và Microsoft redirect URI theo domain
   đó, rồi redeploy.
5. Health check phải đạt ở `/api/v1/ready`; `/api/v1/health` chỉ chứng minh tiến
   trình sống, còn `ready` kiểm tra được kết nối database.

Với một replica, worker trong API là cấu hình đơn giản nhất. Nếu tách worker
thành service riêng, đặt `WORKER_ENABLED=false` ở web/API service và dùng
`node apps/api/dist/worker.js` cho worker. Lease trong database ngăn hai worker
xử lý cùng một integration, nhưng một replica vẫn nên là mặc định ban đầu.

## Fly.io

Build cùng `Dockerfile`, gắn PostgreSQL bên ngoài hoặc Fly Postgres, rồi đặt
secrets bằng CLI. Cấu hình HTTP service trỏ `internal_port = 3000`, HTTPS bắt
buộc, health check `/api/v1/ready`, và release command `npm run db:deploy` nếu
muốn tách migration khỏi `CMD`. Tên app/region không được ghi cứng trong repo vì
chúng thuộc tài khoản triển khai.

## Kiểm tra trước và sau phát hành

Trước khi đẩy image: `npm test`, `npm run test:integration`,
`npm run typecheck`, `npm run build`. Sau phát hành, kiểm tra health/readiness,
đăng nhập, CRUD task/event, tạo–chấp nhận–từ chối đề xuất, worker retry, ngắt kết
nối, responsive desktop/mobile, và cả hai ngôn ngữ. UED phải luôn chỉ đọc; dữ
liệu ngoài chỉ tạo đề xuất. Không dùng tài khoản thật trong log, fixture hoặc
ảnh chụp nghiệm thu công khai.

Workflow `.github/workflows/ci.yml` tự tạo PostgreSQL `_test`, kiểm tra audit,
typecheck, unit, integration và Chromium E2E trên mỗi push/pull request. Khóa mã
hóa trong workflow chỉ dành cho dữ liệu test tạm thời, không được dùng ở staging
hay production.

## Sao lưu và vận hành

- Bật backup/PITR cho PostgreSQL trước khi dùng thật.
- Sau migration liên quan thời gian, đối chiếu ít nhất một buổi học đã biết ở
  cả UTC và múi giờ sinh viên trước khi mở traffic.
- Theo dõi tỷ lệ lỗi worker, integration chuyển `REAUTH_REQUIRED`, độ trễ hàng
  đợi và readiness.
- Luân chuyển Microsoft client secret theo quy trình có thời gian chồng lấp.
- Việc đổi `ENCRYPTION_KEY` cần migration giải mã–mã hóa lại có kiểm soát; không
  thay trực tiếp vì sẽ làm mất khả năng đọc các phiên/token hiện có.
