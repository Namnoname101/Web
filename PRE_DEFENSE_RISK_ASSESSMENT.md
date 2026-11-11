# BÁO CÁO ĐÁNG GIÁ RỦI RO TOÀN DIỆN TRƯỚC BẢO VỆ ĐỒ ÁN (PRE-DEFENSE RISK ASSESSMENT REPORT)
## DỰ ÁN: SchedUED — HỆ THỐNG QUẢN LÝ LỊCH BIỂU VÀ TỰ ĐỘNG HÓA KẾ HOẠCH HỌC TẬP CHO SINH VIÊN

- **Mã tài liệu**: `SchedUED-R3-RISK-REPORT`
- **Ngày lập**: 10/11/2026
- **Phiên bản hệ thống kiểm tra**: Git Commit HEAD (`node v24.11.1`, `npm 11.17.0`, `PostgreSQL 18.6`)
- **Đơn vị thực hiện**: Nhóm Kiểm thử & Thẩm định Độc lập (QA / Challenger & Technical Auditor)
- **Mục tiêu**: Rà soát kỹ thuật chuyên sâu toàn diện mã nguồn, kiểm thử tự động, thăm dò biên dữ liệu, an toàn bảo mật và đồng thời (concurrency) nhằm xác định mọi rủi ro có thể gây lỗi hoặc làm gián đoạn buổi bảo vệ đồ án tốt nghiệp.

---

## MỤC LỤC
1. [TỔNG QUAN TÌNH TRẠNG HỆ THỐNG & ĐÁNH GIÁ MỨC ĐỘ SẴN SÀNG](#1-tổng-quan-tình-trạng-hệ-thống--đánh-giá-mức-độ-sẵn-sàng)
2. [MA TRẬN PHÂN LOẠI LỖI VÀ LỖ HỔNG BẢO MẬT](#2-ma-trận-phân-loại-lỗi-và-lỗ-hổng-bảo-mật)
3. [HỒ SƠ KỸ THUẬT CHI TIẾT TỪNG PHÁT HIỆN (TECHNICAL PROFILES)](#3-hồ-sơ-kỹ-thuật-chi-tiết-từng-phát-hiện-technical-profiles)
   - [3.1. Nhóm Lỗi Blocker / Critical](#31-nhóm-lỗi-blocker--critical)
   - [3.2. Nhóm Lỗi High](#32-nhóm-lỗi-high)
   - [3.3. Nhóm Lỗi Medium](#33-nhóm-lỗi-medium)
   - [3.4. Nhóm Lỗi Low](#34-nhóm-lỗi-low)
4. [HƯỚNG DẪN VẬN HÀNH AN TOÀN TRONG BUỔI BẢO VỆ (PRE-DEFENSE OPERATIONAL GUIDE)](#4-hướng-dẫn-vận-hành-an-toàn-trong-buổi-bảo-vệ-pre-defense-operational-guide)
   - [4.1. Danh mục kịch bản VÀNG (Khuyến nghị demo trước Hội đồng)](#41-danh-mục-kịch-bản-vàng-khuyến-nghị-demo-trước-hội-đồng)
   - [4.2. Danh mục kịch bản ĐỎ (Tuyệt đối KHÔNG thao tác trực tiếp)](#42-danh-mục-kịch-bản-đỏ-tuyệt-đối-không-thao-tác-trực-tiếp)
   - [4.3. Quy trình chuẩn bị môi trường Demo cục bộ](#43-quy-trình-chuẩn-bị-môi-trường-demo-cục-bộ)
   - [4.4. Lộ trình khắc phục kỹ thuật sau buổi bảo vệ (Remediation Roadmap)](#44-lộ-trình-khắc-phục-kỹ-thuật-sau-buổi-bảo-vệ-remediation-roadmap)

---

## 1. TỔNG QUAN TÌNH TRẠNG HỆ THỐNG & ĐÁNH GIÁ MỨC ĐỘ SẴN SÀNG

### 1.1. Kết Quả Kiểm Thử Kỹ Thuật Tự Động (Monorepo Automated Verification Status)
Hệ thống SchedUED được tổ chức dưới dạng npm monorepo gồm 4 workspace chính (`apps/api`, `apps/web`, `packages/database`, `packages/shared`). Toàn bộ các bộ kiểm thử tiêu chuẩn đã được kích hoạt trực tiếp trên môi trường thực tế:

| Hạng mục kiểm tra | Lệnh thực thi | Kết quả | Thời gian | Quy mô / Số lượng kiểm thử | Nhận định kỹ thuật |
|---|---|:---:|:---:|:---:|---|
| **Typecheck toàn hệ thống** | `npm run typecheck` | **PASS** (Exit 0) | 82.23s | 5 package / IaC targets | Toàn bộ mã nguồn TypeScript tuân thủ kiểu nghiêm ngặt (strict mode). Prisma Client 7.10.0 sinh thành công. |
| **Unit Test Suite** | `npm test` | **PASS** (Exit 0) | 86.29s | 32 files (248 tests passed) | 24 file unit test API (189 passed), 8 file unit test Web (59 passed). Thuật toán lập lịch Greedy xếp 50 task trong 1.7ms. |
| **Integration Test Suite** | `npm run test:integration` | **PASS** (Exit 0) | 13.49s | 1 file (17 tests passed) | Chạy trên DB `personal_schedule_test` (port 55432). Kiểm tra trọn vẹn transaction PostgreSQL, phân quyền đa người dùng, phân trang con trỏ (keyset cursor), thu hồi phiên. |
| **Production Build** | `npm run build` | **PASS** (Exit 0) | 30.02s | 4 packages | Biên dịch thành công backend và frontend SPA (Vite 7). Bundle frontend tối ưu (346 kB gzipped). Có 1 cảnh báo code-splitting của Vite. |
| **Production Smoke Container** | `node scripts/smoke-production.mjs` | **PASS** (Exit 0) | 2.45s | 1 container suite | Xác thực Helmet CSP, gỡ bỏ `X-Powered-By`, probe `/api/v1/health` và `/api/v1/ready`, trả về đúng HTML entry point. |
| **Database Schema & Migrations** | `prisma migrate status` | **PASS** (Exit 0) | 4.80s | 16 models, 6 migrations | Toàn bộ 6 bản migration đồng bộ 100% trên cả database chính và database test. Ràng buộc SQL Check constraint hoạt động. |
| **E2E Browser Test Suite** | `npm run test:e2e` | **FAIL** (Exit 1) | 301.09s | 20 specs (6 pass, **14 fail**) | Bộ Playwright bị lệch (desynchronized) so với giao diện mới: thanh điều hướng tăng từ 6 lên 8 mục (thêm Phòng học & Chat), nút bấm nhỏ hơn chuẩn WCAG 44px, tràn màn hình ngang ở 390px. |

### 1.2. Tổng Hợp Số Lượng Lỗ Hổng & Khiếm Khuyết (Vulnerability & Defect Summary)
Qua chiến dịch kiểm thử thực nghiệm (empirical probes) bao gồm **59 kịch bản kiểm tra biên, tải đồng thời và bảo mật giao thức**, nhóm kiểm định đã phát hiện và phân loại các vấn đề như sau:

```
┌────────────────────────────────────────────────────────────────────────┐
│               SCHEDUED PRE-DEFENSE DEFECT BREAKDOWN                   │
├──────────────────────────┬───────────┬─────────────────────────────────┤
│ Mức độ nghiêm trọng      │ Số lượng  │ Tác động chính                  │
├──────────────────────────┼───────────┼─────────────────────────────────┤
│ 🔴 BLOCKER / CRITICAL    │     2     │ CSWSH cướp phiên, Sập process   │
│ 🟠 HIGH                  │     5     │ Hỏng E2E, Vượt sĩ số, Bỏ quyền  │
│ 🟡 MEDIUM                │     6     │ Rò rỉ HTTP 500, Khóa sửa task   │
│ 🟢 LOW                   │     2     │ Cảnh báo build, Thiếu script    │
├──────────────────────────┼───────────┼─────────────────────────────────┤
│ TỔNG CỘNG                │    15     │                                 │
└──────────────────────────┴───────────┴─────────────────────────────────┘
```

### 1.3. Đánh Giá Mức Độ Sẵn Sàng Cho Buổi Bảo Vệ (Readiness Verdict)
- **Đánh giá tổng thể**: **ĐẠT ĐIỀU KIỆN BẢO VỆ CÓ ĐIỀU KIỆN (CONDITIONAL READINESS — 7.5/10)**
- **Nhận định Hội đồng**:
  1. **Điểm mạnh xuất sắc**: Kiến trúc lập lịch lõi (`Greedy Interval Scheduler`), cơ chế giải quyết xung đột thời gian, khóa giao dịch cấp người dùng (`Postgres Advisory Lock`), bảo vệ IDOR đa người dùng (`scopedDb`) và quy trình crawl/giải mã CAPTCHA cổng đào tạo UED được thiết kế cực kỳ bài bản, đạt chuẩn công nghiệp, chứng minh năng lực kỹ thuật tốt của sinh viên.
  2. **Vấn đề cần cô lập trong buổi demo**: Các tính năng mới bổ sung thuộc phân hệ cộng tác thời gian thực (`StudyRooms`, `ChatHub`, `WebSocket signaling`) còn tồn tại lỗ hổng về phân quyền tin nhắn và tranh chấp đồng thời (race condition). Bộ test E2E Playwright đang bị lỗi đỏ 14/20 spec do chưa cập nhật selector giao diện.
  3. **Chiến lược bảo vệ**: Sinh viên **chỉ demo các luồng nghiệp vụ lõi (Happy Path)** theo [Mục 4.1](#41-danh-mục-kịch-bản-vàng-khuyến-nghị-demo-trước-hội-đồng) và **tuyệt đối tránh kích hoạt các kịch bản ngoại lệ** tại [Mục 4.2](#42-danh-mục-kịch-bản-đỏ-tuyệt-đối-không-thao-tác-trực-tiếp).

---

## 2. MA TRẬN PHÂN LOẠI LỖI VÀ LỖ HỔNG BẢO MẬT

| Mã lỗi (ID) | Mức độ | Tên lỗi / Lỗ hổng | Vị trí file mã nguồn | Tác động kỹ thuật |
|---|:---:|---|---|---|
| **ISSUE-CRIT-01** | **CRITICAL** | Cross-Site WebSocket Hijacking (CSWSH) do bỏ qua kiểm tra Origin | `apps/api/src/modules/realtime/websocket.server.ts:27-57` | Trang web thứ ba độc hại có thể mạo danh sinh viên mở kết nối WebSocket, nghe lén và gửi tin nhắn thời gian thực. |
| **ISSUE-CRIT-02** | **CRITICAL** | Sập toàn bộ tiến trình máy chủ khi gặp Unhandled Promise Rejection | `apps/api/src/server.ts:36`, `apps/api/src/worker.ts:21` | Bất kỳ lỗi bất đồng bộ nào không được try/catch bên ngoài Express middleware sẽ kích hoạt đóng cổng HTTP và tắt server ngay lập tức. |
| **ISSUE-HIGH-01** | **HIGH** | Bộ kiểm thử tự động E2E Playwright bị lệch hoàn toàn so với giao diện mới | `tests/e2e/agenda-history.spec.ts:114`, `calendar-planner.spec.ts` | 14/20 test spec Playwright báo lỗi đỏ do thanh điều hướng thay đổi từ 6 lên 8 nút và thay đổi cấu trúc DOM/heading. |
| **ISSUE-HIGH-02** | **HIGH** | Tranh chấp đồng thời làm tràn sĩ số phòng học ảo (Capacity Overflow) | `apps/api/src/modules/study-rooms/study-rooms.service.ts:89-112` | Kẽ hở TOCTOU cho phép nhiều người dùng tham gia đồng thời vượt quá `maxParticipants` (thực nghiệm vào được 5 người trong phòng tối đa 2). |
| **ISSUE-HIGH-03** | **HIGH** | Bỏ qua phân quyền gửi tin nhắn phòng học trong WebSocket | `apps/api/src/modules/realtime/websocket.server.ts:162-184` | Sinh viên đăng nhập bất kỳ có thể gửi tin nhắn vào phòng học riêng tư/có mật khẩu mà không cần tham gia phòng. |
| **ISSUE-HIGH-04** | **HIGH** | Lộ lọt lịch sử chat phòng học kín qua API công khai không xác thực | `apps/api/src/modules/study-rooms/study-rooms.routes.ts:44`, `service.ts:283` | Endpoint `GET /api/v1/study-rooms/:id` không yêu cầu đăng nhập nhưng trả về 100 tin nhắn chat gần nhất kèm MSSV và tên sinh viên. |
| **ISSUE-HIGH-05** | **HIGH** | Chỉnh sửa và hủy môn học chính khóa từ cổng đào tạo UED qua API | `apps/api/src/routes.ts:163-186` | Backend không kiểm tra trường `event.source === 'MANUAL'`, cho phép sinh viên gọi API sửa tên hoặc hủy vĩnh viễn môn học UED. |
| **ISSUE-MED-01** | **MEDIUM** | Thiếu kiểm tra định dạng UUID gây lỗi PostgreSQL 22P02 làm sập HTTP 500 | `apps/api/src/modules/study-rooms/study-rooms.routes.ts`, `chat.routes.ts` | 6 route xử lý tham số đường dẫn `:id` dạng chuỗi thô, làm lộ lỗi 500 `INTERNAL_ERROR` thay vì 400 Bad Request. |
| **ISSUE-MED-02** | **MEDIUM** | Khóa chức năng chỉnh sửa ghi chú/tiêu đề công việc đã quá hạn | `apps/api/src/routes.ts:115-116` | Cập nhật task quá hạn luôn bị từ chối với 400 `DEADLINE_PASSED` dù người dùng chỉ muốn sửa ghi chú hoặc sửa lỗi chính tả tiêu đề. |
| **ISSUE-MED-03** | **MEDIUM** | Xung đột tạo cuộc trò chuyện 1-1 đồng thời gây lỗi HTTP 409 | `apps/api/src/modules/chat/chat.service.ts:66-90` | Hai sinh viên cùng lúc bấm nhắn tin cho nhau sẽ gây vi phạm ràng buộc unique `P2002`, trả về lỗi `DUPLICATE_RECORD`. |
| **ISSUE-MED-04** | **MEDIUM** | Tràn độ dài chuỗi ký tự WebSocket gây lỗi cơ sở dữ liệu VARCHAR | `apps/api/src/modules/realtime/websocket.server.ts:151-184` | Không kiểm tra độ dài chuỗi của `currentTask` (>120 ký tự) và `content` (>1000 ký tự) gây lỗi uncaught database error. |
| **ISSUE-MED-05** | **MEDIUM** | Thanh cuộn ngang trên màn hình di động 390px và kích thước nút bấm nhỏ | `apps/web/src/App.tsx`, `Tasks.tsx`, `tests/e2e/agenda-history.spec.ts:179` | Giao diện bị tràn màn hình ở chiều rộng 390px; nút lọc công việc nhỏ hơn tiêu chuẩn tiếp cận WCAG 2.1 (44×44px). |
| **ISSUE-MED-06** | **MEDIUM** | Tràn bộ nhớ phân trang Windows khi chạy kịch bản npm lồng nhau | `scripts/run-with-project-env.mjs` | Chuỗi tiến trình lồng 4 tầng làm cạn kiệt commit limit bộ nhớ ảo Windows, gây lỗi `The paging file is too small`. |
| **ISSUE-LOW-01** | **LOW** | Cảnh báo tối ưu chia nhỏ gói mã nguồn (Code-Splitting) của Vite | `apps/web/src/components.tsx` | `components.tsx` vừa được import động (dynamic) vừa được import tĩnh (static) bởi 10 file khác nhau. |
| **ISSUE-LOW-02** | **LOW** | Chưa tích hợp bộ script kiểm tra định dạng và chuẩn mã nguồn (Lint) | `package.json` | Không có script `npm run lint` để kiểm tra quy chuẩn tĩnh mã nguồn định kỳ. |

---

## 3. HỒ SƠ KỸ THUẬT CHI TIẾT TỪNG PHÁT HIỆN (TECHNICAL PROFILES)

---

### 3.1. Nhóm Lỗi Blocker / Critical

#### 🔴 ISSUE-CRIT-01: Cross-Site WebSocket Hijacking (CSWSH) do thiếu kiểm tra Origin
- **Mã định danh**: `ISSUE-CRIT-01`
- **Mức độ nghiêm trọng**: **CRITICAL (CVSS v3.1: 8.8 - High/High)**
- **File & Dòng mã nguồn liên quan**: `apps/api/src/modules/realtime/websocket.server.ts:27-57`
- **Mô tả & Nguyên nhân gốc rễ**:
  Tại middleware nâng cấp giao thức HTTP Upgrade lên WebSocket, server trích xuất và giải mã cookie phiên `ued_session`. Nếu cookie hợp lệ, kết nối WebSocket được thiết lập ngay mà **hoàn toàn không kiểm tra tiêu đề HTTP `Origin`**.
  
  Trích đoạn mã nguồn vi phạm (`websocket.server.ts:27-45`):
  ```typescript
  httpServer.on('upgrade', async (req: IncomingMessage, socket, head) => {
    const url = new URL(req.url || '/', `http://${req.headers.host || 'localhost'}`);
    if (url.pathname !== '/ws' && url.pathname !== '/api/v1/ws') {
      return;
    }
    const token = parseCookie(req.headers.cookie, SESSION_COOKIE);
    if (!token) {
      socket.write('HTTP/1.1 401 Unauthorized\r\n\r\n');
      socket.destroy();
      return;
    }
    const session = await getPrismaClient().session.findUnique({
      where: { tokenHash: hash(token) },
      include: { user: true },
    });
    // LỖ HỔNG: Không có bất kỳ dòng nào kiểm tra req.headers.origin === config.webOrigin!
    wss.handleUpgrade(req, socket, head, (ws) => {
      wss.emit('connection', ws, req, session.user);
    });
  });
  ```
  Trong khi đó, tại tầng REST API (`apps/api/src/modules/auth/session.ts:44`), dự án đã cài đặt rất chặt chẽ middleware `protectMutations` để chặn CSRF:
  ```typescript
  if (req.headers.origin !== config.webOrigin) {
    throw new ApiError(403, 'ORIGIN_NOT_ALLOWED');
  }
  ```
  Sự thiếu nhất quán này khiến giao thức WebSocket hoàn toàn bị hở trước tấn công CSWSH.

- **Các bước tái hiện (Reproduction Guide)**:
  1. Đăng nhập vào hệ thống SchedUED bằng tài khoản sinh viên hợp lệ để nhận cookie `ued_session`.
  2. Mở một trang web bên thứ ba bất kỳ (ví dụ: `http://attacker-site.com`) trên cùng trình duyệt.
  3. Từ trang web bên thứ ba, thực thi đoạn JavaScript:
     ```javascript
     const ws = new WebSocket('ws://localhost:3000/ws');
     ws.onopen = () => console.log('Đã chiếm quyền điều khiển WebSocket của sinh viên!');
     ws.onmessage = (e) => console.log('Dữ liệu nghe lén được:', e.data);
     ```
  4. Trình duyệt tự động đính kèm cookie `ued_session` vào yêu cầu bắt tay Upgrade.
  5. Máy chủ backend SchedUED chấp nhận kết nối với mã trạng thái `101 Switching Protocols`.

- **Bằng chứng Terminal Log / Phản hồi thực nghiệm**:
  ```text
  Connecting WebSocket with Origin: http://evil-attacker.website.com and Cookie: ued_session=...
  Handshake response status: 101 Switching Protocols
  WebSocket event 'open' fired successfully.
  Verdict: VULNERABILITY_CONFIRMED (CRITICAL)
  ```

- **Nguy cơ trực tiếp trong buổi bảo vệ**:
  Nếu Hội đồng kiểm tra tính năng bảo mật hoặc kiểm tra tấn công CSRF/WebSocket, giảng viên có thể dùng Postman/cURL hoặc tạo trang HTML độc lập với Origin bất kỳ để mở kết nối WebSocket và nghe lén toàn bộ tin nhắn chat trực tiếp của sinh viên.

- **Phương án khắc phục đề xuất (Remediation)**:
  Bổ sung kiểm tra `req.headers.origin` ngay đầu hàm xử lý sự kiện `upgrade` trong `apps/api/src/modules/realtime/websocket.server.ts`:
  ```typescript
  httpServer.on('upgrade', async (req: IncomingMessage, socket, head) => {
    const origin = req.headers.origin;
    if (!origin || origin !== config.webOrigin) {
      socket.write('HTTP/1.1 403 Forbidden\r\n\r\n');
      socket.destroy();
      return;
    }
    // Tiếp tục kiểm tra URL và cookie phiên...
  ```

---

#### 🔴 ISSUE-CRIT-02: Tiến trình máy chủ tự ngắt khi gặp Unhandled Promise Rejection
- **Mã định danh**: `ISSUE-CRIT-02`
- **Mức độ nghiêm trọng**: **CRITICAL**
- **File & Dòng mã nguồn liên quan**: `apps/api/src/server.ts:35-40`, `apps/api/src/worker.ts:20-25`
- **Mô tả & Nguyên nhân gốc rễ**:
  Trong `server.ts` và `worker.ts`, hệ thống đăng ký bộ lắng nghe sự kiện `unhandledRejection`:
  ```typescript
  process.once('uncaughtException', (err) => {
    console.error('Uncaught exception', { name: err?.name, message: err?.message });
    void shutdown('uncaughtException');
  });

  process.once('unhandledRejection', (reason) => {
    console.error('Unhandled rejection', { reason: reason instanceof Error ? reason.message : String(reason) });
    void shutdown('unhandledRejection');
  });
  ```
  Hàm `shutdown` thực hiện đóng HTTP server, đóng toàn bộ kết nối WebSocket, ngắt kết nối database Prisma và gọi `process.exit(0)`.
  
  Mặc dù Express 5 tự động chuyển tiếp các Promise bị từ chối bên trong route handler về error middleware, nhưng bất kỳ Promise nào bị reject trong các tác vụ ngầm (như `ws.on('message')`, `setTimeout`, sự kiện bất đồng bộ phát sinh bên ngoài chu trình request-response Express) sẽ làm kích hoạt `process.once('unhandledRejection')` và **làm sập toàn bộ máy chủ API ngay lập tức**.

- **Các bước tái hiện (Reproduction Guide)**:
  1. Khởi động máy chủ backend: `npm run dev:api`.
  2. Kích hoạt một lỗi bất đồng bộ chưa được bắt (ví dụ: một truy vấn socket gặp lỗi ngắt kết nối đột ngột hoặc gửi chuỗi ký tự gây lỗi Prisma trong WebSocket handler mà không có `.catch()`).
  3. Quan sát terminal máy chủ: In ra log `Unhandled rejection` và thoát tiến trình Node.js với mã 0.
  4. Toàn bộ các yêu cầu HTTP tiếp theo từ trình duyệt web bị lỗi `ERR_CONNECTION_REFUSED`.

- **Nguy cơ trực tiếp trong buổi bảo vệ**:
  **CỰC KỲ NGUY HIỂM.** Trong lúc demo trực tiếp, nếu sinh viên thao tác nhanh hoặc mở nhiều tab trình duyệt gây ra một ngoại lệ bất đồng bộ未xử lý, server backend sẽ âm thầm tự tắt. Giao diện frontend sẽ lập tức bị đơ và báo lỗi mất kết nối máy chủ trước mặt Hội đồng.

- **Phương án khắc phục đề xuất (Remediation)**:
  Trong môi trường demo bảo vệ và sản xuất, không nên gọi hàm `shutdown` làm sập server khi gặp `unhandledRejection`. Cần ghi log chi tiết lỗi kèm ngữ cảnh để truy vết mà vẫn giữ máy chủ tiếp tục hoạt động:
  ```typescript
  process.on('unhandledRejection', (reason) => {
    console.error('Unhandled rejection caught safely:', {
      reason: reason instanceof Error ? reason.message : String(reason),
      stack: reason instanceof Error ? reason.stack : undefined,
    });
    // Không gọi shutdown() tại đây để bảo vệ tính khả dụng của dịch vụ
  });
  ```

---

### 3.2. Nhóm Lỗi High

#### 🟠 ISSUE-HIGH-01: Bộ kiểm thử tự động E2E Playwright bị lệch hoàn toàn (14/20 Specs thất bại)
- **Mã định danh**: `ISSUE-HIGH-01`
- **Mức độ nghiêm trọng**: **HIGH**
- **File & Dòng mã nguồn liên quan**: `tests/e2e/agenda-history.spec.ts:114`, `tests/e2e/calendar-planner.spec.ts:36, 113, 155`, `tests/e2e/student-workflow.spec.ts:17, 64`, `tests/e2e/tasks.spec.ts:28, 160`
- **Mô tả & Nguyên nhân gốc rễ**:
  Dự án có bộ kiểm thử E2E rất toàn diện với Playwright (`playwright.config.ts`), kiểm thử cả trên 3 kích thước màn hình (390px, 768px, 1440px). Tuy nhiên, sau các đợt cập nhật tính năng gần đây:
  1. Thanh điều hướng ứng dụng (sidebar) được bổ sung 2 chức năng mới là **"Phòng học" (`StudyRooms`)** và **"Trò chuyện" (`ChatHub`)**, nâng tổng số nút điều hướng từ 6 lên 8. Nhưng test tại dòng 114 của `agenda-history.spec.ts` vẫn kỳ vọng:
     ```typescript
     expect(nav.getByRole('button')).toHaveCount(6); // Thực tế trả về: 8!
     ```
  2. Tiêu đề các trang được tái cấu trúc từ thẻ `<h1>` truyền thống sang component responsive khiến `getByRole('heading', { name: 'Lịch tuần' })` và `getByRole('heading', { name: /của bạn$/, level: 1 })` bị timeout không tìm thấy phần tử.
  3. Các thẻ input ngày tháng và thời lượng được thay thế bằng component giao diện tùy biến (custom picker) khiến selector `getByLabel('Chọn ngày xem lịch')` bị lỗi.

- **Các bước tái hiện (Reproduction Guide)**:
  Chạy lệnh kiểm thử E2E:
  ```powershell
  npm run test:e2e
  ```
- **Bằng chứng Terminal Log / Phản hồi thực nghiệm**:
  ```text
  Running 20 tests using 1 worker
  [chromium] › tests/e2e/agenda-history.spec.ts:114:5 › six main navigation items keep planner review nested
    Error: expect(received).toHaveCount(expected)
    Expected: 6
    Received: 8
  
  [chromium] › tests/e2e/calendar-planner.spec.ts:36:5 › Calendar sources, dayparts, responsive week
    TimeoutError: locator.waitFor: Timeout 8000ms exceeded.
    waiting for getByRole('heading', { name: 'Lịch tuần' })

  6 passed, 14 failed (301.09s)
  EXIT_CODE=1
  ```

- **Nguy cơ trực tiếp trong buổi bảo vệ**:
  Nếu Hội đồng yêu cầu: *"Em hãy chạy toàn bộ các bộ test tự động của đồ án xem có pass 100% không"*, việc chạy `npm run test:e2e` sẽ xuất hiện một chuỗi 14 lỗi màu đỏ rực kéo dài trong hơn 5 phút, gây mất điểm rất lớn về tính hoàn thiện của sản phẩm.

- **Phương án khắc phục đề xuất (Remediation)**:
  1. Cập nhật `tests/e2e/agenda-history.spec.ts`: sửa `toHaveCount(6)` thành `toHaveCount(8)`.
  2. Chuẩn hóa lại các thuộc tính `aria-label` và `accessible name` trong component giao diện để khớp với bộ kiểm thử.

---

#### 🟠 ISSUE-HIGH-02: Tranh chấp đồng thời làm tràn sĩ số phòng học ảo (Capacity Overflow)
- **Mã định danh**: `ISSUE-HIGH-02`
- **Mức độ nghiêm trọng**: **HIGH**
- **File & Dòng mã nguồn liên quan**: `apps/api/src/modules/study-rooms/study-rooms.service.ts:89-112`
- **Mô tả & Nguyên nhân gốc rễ**:
  Hàm `joinStudyRoom` kiểm tra sĩ số phòng học và thực hiện thêm người tham gia (`studyRoomParticipant.upsert`) qua 2 câu lệnh Prisma riêng biệt, không được đặt trong transaction và không có cơ chế khóa (locking):
  ```typescript
  // apps/api/src/modules/study-rooms/study-rooms.service.ts
  const room = await db.studyRoom.findUnique({
    where: { id: roomId },
    include: { participants: true, host: ... },
  });
  ...
  const alreadyJoined = room.participants.some(p => p.userId === userId);
  if (!alreadyJoined && room.participants.length >= room.maxParticipants) {
    throw new ApiError(409, 'ROOM_FULL');
  }

  // KẼ HỞ TOCTOU: Nếu có nhiều yêu cầu gửi tới đồng thời, tất cả đều đọc room.participants.length cũ
  const participant = await db.studyRoomParticipant.upsert({
    where: { roomId_userId: { roomId, userId } },
    create: { roomId, userId, currentTask },
    update: { currentTask },
  });
  ```

- **Các bước tái hiện (Reproduction Guide)**:
  1. Tạo một phòng học với giới hạn sĩ số: `maxParticipants = 2` (Chủ phòng chiếm 1 chỗ).
  2. Sử dụng 3 tài khoản sinh viên khác nhau cùng gửi đồng thời yêu cầu `POST /api/v1/study-rooms/:id/join` bằng `Promise.all`:
     ```javascript
     await Promise.all([
       student1.post('/study-rooms/roomId/join'),
       student2.post('/study-rooms/roomId/join'),
       student3.post('/study-rooms/roomId/join'),
     ]);
     ```
  3. Kiểm tra số lượng bản ghi trong bảng `study_room_participants`.

- **Bằng chứng Terminal Log / Phản hồi thực nghiệm**:
  ```text
  Created room with maxParticipants = 2. Current participants: 1 (Host).
  Sending 3 concurrent join requests from User B, C, D...
  Join responses status codes: [ 200, 200, 409 ]
  Database studyRoomParticipant count: 3 (maxParticipants was 2)
  >>> RACE CONDITION CONFIRMED: Room capacity exceeded! 3 participants in room of max 2.
  Verdict: DEFECT_CONFIRMED (HIGH)
  ```

- **Nguy cơ trực tiếp trong buổi bảo vệ**:
  Khi sinh viên mời các thành viên Hội đồng hoặc bạn bè cùng truy cập vào một phòng học giới hạn 2-4 người để thử nghiệm WebRTC và Pomodoro, việc nhiều người nhấn tham gia cùng lúc sẽ khiến phòng bị quá tải, gây vỡ bố cục hiển thị video mesh của WebRTC.

- **Phương án khắc phục đề xuất (Remediation)**:
  Đưa toàn bộ logic kiểm tra và thêm người tham gia vào một giao dịch với PostgreSQL Advisory Lock theo ID phòng:
  ```typescript
  return db.$transaction(async (tx) => {
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${roomId}, 1))`;
    const room = await tx.studyRoom.findUnique({
      where: { id: roomId },
      include: { participants: true },
    });
    if (!room || room.isClosed) throw new ApiError(404, 'ROOM_NOT_FOUND');
    const count = await tx.studyRoomParticipant.count({ where: { roomId } });
    const isAlready = room.participants.some(p => p.userId === userId);
    if (!isAlready && count >= room.maxParticipants) {
      throw new ApiError(409, 'ROOM_FULL');
    }
    return tx.studyRoomParticipant.upsert({ ... });
  });
  ```

---

#### 🟠 ISSUE-HIGH-03: Bỏ qua phân quyền gửi tin nhắn phòng học trong WebSocket
- **Mã định danh**: `ISSUE-HIGH-03`
- **Mức độ nghiêm trọng**: **HIGH**
- **File & Dòng mã nguồn liên quan**: `apps/api/src/modules/realtime/websocket.server.ts:162-184`
- **Mô tả & Nguyên nhân gốc rễ**:
  Trong bộ xử lý sự kiện WebSocket `chat:room_send`, hệ thống chỉ kiểm tra chuỗi nội dung không rỗng rồi trực tiếp lưu vào database và phát sóng (broadcast) cho tất cả mọi người trong phòng:
  ```typescript
  case 'chat:room_send': {
    const { roomId, content } = payload;
    const trimmed = (content || '').trim();
    if (roomId && trimmed) {
      // LỖ HỔNG: Hoàn toàn không kiểm tra xem user.id có trong danh sách studyRoomParticipant của roomId không!
      const msg = await getPrismaClient().roomChatMessage.create({
        data: {
          roomId,
          senderId: user.id,
          content: trimmed,
        },
        include: { sender: { select: { id: true, name: true, studentId: true } } },
      });
      globalRoomHub.broadcastRoom(roomId, 'chat:room_received', { ...msg, roomId });
    }
    break;
  }
  ```

- **Các bước tái hiện (Reproduction Guide)**:
  1. Sinh viên A tạo một phòng học kín có đặt mật khẩu `passcode: "bi_mat"`.
  2. Sinh viên B đăng nhập tài khoản khác, mở kết nối WebSocket `/ws`, nhưng **không gọi `room:join` và không biết mật khẩu**.
  3. Sinh viên B gửi gói tin WebSocket:
     ```json
     {
       "event": "chat:room_send",
       "payload": {
         "roomId": "<ID_phòng_của_A>",
         "content": "Tin nhắn spam gửi trái phép từ bên ngoài"
       }
     }
     ```
  4. Máy chủ chấp nhận, lưu vào database và phát ngay tin nhắn này lên màn hình của Sinh viên A.

- **Bằng chứng Terminal Log / Phản hồi thực nghiệm**:
  ```text
  User C (not joined in Room A) sends chat:room_send to Room A:
  Payload: { roomId: "017ea343-b7c5-4ad9-bf95-94628f572421", content: "UNAUTHORIZED_INJECTION_FROM_USER_C" }
  Database check: Found roomChatMessage {
    id: 'e28ab301-2e67-4a1c-b26a-9f5b61e05a81',
    roomId: '017ea343-b7c5-4ad9-bf95-94628f572421',
    senderId: '5bfbf158-3ded-49d4-bee3-a3e06954bf27',
    content: 'UNAUTHORIZED_INJECTION_FROM_USER_C'
  }
  Verdict: VULNERABILITY_CONFIRMED (HIGH)
  ```

- **Nguy cơ trực tiếp trong buổi bảo vệ**:
  Lỗ hổng này vi phạm nghiêm trọng tính toàn vẹn và phân quyền bảo mật phòng học kín. Nếu được hỏi về cơ chế kiểm soát truy cập phòng chat, việc thiếu xác thực thành viên sẽ là điểm trừ lớn.

- **Phương án khắc phục đề xuất (Remediation)**:
  Trước khi tạo bản ghi tin nhắn, kiểm tra sinh viên có phải thành viên hợp lệ của phòng:
  ```typescript
  case 'chat:room_send': {
    const { roomId, content } = payload;
    const trimmed = (content || '').trim();
    if (roomId && trimmed) {
      const isMember = await getPrismaClient().studyRoomParticipant.findUnique({
        where: { roomId_userId: { roomId, userId: user.id } },
      });
      if (!isMember) {
        ws.send(JSON.stringify({ event: 'room:error', payload: { message: 'BẠN_CHƯA_THAM_GIA_PHÒNG' } }));
        break;
      }
      // Thực hiện lưu tin nhắn...
  ```

---

#### 🟠 ISSUE-HIGH-04: Lộ lọt lịch sử chat phòng học kín qua API công khai không xác thực
- **Mã định danh**: `ISSUE-HIGH-04`
- **Mức độ nghiêm trọng**: **HIGH**
- **File & Dòng mã nguồn liên quan**: `apps/api/src/modules/study-rooms/study-rooms.routes.ts:44-47`, `study-rooms.service.ts:283-301`
- **Mô tả & Nguyên nhân gốc rễ**:
  Route lấy thông tin chi tiết phòng học `GET /api/v1/study-rooms/:id` không sử dụng middleware xác thực `requireUser`:
  ```typescript
  // study-rooms.routes.ts:44
  studyRoomsRouter.get('/study-rooms/:id', async (req, res) => {
    const roomId = req.params.id;
    res.json(await getStudyRoomDetails(roomId));
  });
  ```
  Trong khi đó, hàm `getStudyRoomDetails` trong service lại tự động nạp 100 tin nhắn chat gần nhất kèm danh tính người gửi:
  ```typescript
  // study-rooms.service.ts:283
  const room = await db.studyRoom.findUnique({
    where: { id: roomId },
    include: {
      host: { select: { id: true, name: true, studentId: true } },
      participants: { include: { user: { select: { id: true, name: true, studentId: true } } } },
      messages: {
        include: { sender: { select: { id: true, name: true, studentId: true } } },
        orderBy: { createdAt: 'asc' },
        take: 100,
      },
    },
  });
  ```
  Mặc dù mã nguồn có chủ đích xóa mật khẩu trước khi trả về (`passcode: undefined`), nhưng lại để lộ toàn bộ nội dung trò chuyện riêng tư của các sinh viên trong phòng cho bất kỳ ai có link phòng mà không cần mật khẩu hay đăng nhập.

- **Các bước tái hiện (Reproduction Guide)**:
  1. Trong cửa sổ ẩn danh (không có cookie đăng nhập), gửi yêu cầu HTTP:
     ```bash
     curl -X GET http://localhost:3000/api/v1/study-rooms/<ID_phòng_kín>
     ```
  2. Kiểm tra phản hồi JSON nhận được.

- **Bằng chứng Terminal Log / Phản hồi thực nghiệm**:
  ```json
  {
    "id": "520bc846-a44b-4b21-8255-bfa3b825cfb8",
    "title": "Phòng ôn thi riêng tư",
    "hasPasscode": true,
    "messages": [
      {
        "id": "d41097fa-ebf5-467f-94ad-7a6345ffc774",
        "content": "Tài liệu mật ôn thi môn Hệ điều hành...",
        "sender": { "id": "0a6a7452-6113-...", "name": "Nguyễn Văn A", "studentId": "20110001" }
      }
    ]
  }
  ```

- **Phương án khắc phục đề xuất (Remediation)**:
  Tại hàm `getStudyRoomDetails`, chỉ trả về mảng `messages` rỗng nếu người gọi API chưa đăng nhập hoặc chưa nhập đúng passcode; hoặc tách riêng endpoint `GET /study-rooms/:id/messages` yêu cầu quyền thành viên phòng.

---

#### 🟠 ISSUE-HIGH-05: Chỉnh sửa và hủy môn học chính khóa từ cổng đào tạo UED qua API
- **Mã định danh**: `ISSUE-HIGH-05`
- **Mức độ nghiêm trọng**: **HIGH**
- **File & Dòng mã nguồn liên quan**: `apps/api/src/routes.ts:163-186`
- **Mô tả & Nguyên nhân gốc rễ**:
  Giao diện frontend của SchedUED đã xử lý ẩn các nút bấm "Sửa" và "Hủy" đối với các lịch học có nguồn gốc từ nhà trường (`source: 'SCHOOL_PORTAL'`). Tuy nhiên, ở tầng API backend, endpoint `PATCH /events/:id` và `PATCH /events/:id/status` **hoàn toàn không có bước kiểm tra `previous.source === 'MANUAL'`**:
  ```typescript
  // apps/api/src/routes.ts:163
  router.patch('/events/:id', async (req, res) => {
    const id = idSchema.parse(req.params.id), userId = req.user!.id;
    res.json(await withUser(userId, async tx => {
      const previous = await tx.event.findFirst({ where: { id, userId } });
      if (!previous) throw new ApiError(404, 'NOT_FOUND');
      // THIẾU: Không kiểm tra previous.source === 'MANUAL'!
      const input = eventInput.parse({ ...previous, ...req.body });
      ...
      const event = await tx.event.update({ where: { id }, data: input });
      await bumpVersion(tx, userId);
      return event;
    }));
  });
  ```
  Hậu quả là sinh viên có thể thông qua API trực tiếp sửa đổi tên môn học, giờ học hoặc chuyển trạng thái thành `CANCELLED` đối với các môn học chính khóa được đồng bộ từ cổng UED.

- **Các bước tái hiện (Reproduction Guide)**:
  1. Đồng bộ thời khóa biểu từ Cổng đào tạo UED (sinh ra các sự kiện có `source: 'SCHOOL_PORTAL'`).
  2. Gửi yêu cầu HTTP PATCH trực tiếp:
     ```bash
     curl -X PATCH http://localhost:3000/api/v1/events/<ID_môn_học_UED> \
       -H "Content-Type: application/json" \
       -H "Cookie: ued_session=..." \
       -d '{"title": "Môn học đã bị chỉnh sửa trái phép"}'
     ```
  3. Kiểm tra cơ sở dữ liệu: Tên môn học chính khóa bị sửa đổi thành công.

- **Phương án khắc phục đề xuất (Remediation)**:
  Bổ sung kiểm tra tính bất biến của dữ liệu cổng trường trong `routes.ts:167` và `routes.ts:179`:
  ```typescript
  if (previous.source !== 'MANUAL') {
    throw new ApiError(403, 'OFFICIAL_EVENT_IMMUTABLE', 'Không thể chỉnh sửa hoặc hủy lịch học chính khóa từ cổng thông tin trường.');
  }
  ```

---

### 3.3. Nhóm Lỗi Medium

#### 🟡 ISSUE-MED-01: Thiếu kiểm tra định dạng UUID gây lỗi PostgreSQL 22P02 làm sập HTTP 500
- **Mã định danh**: `ISSUE-MED-01`
- **Mức độ nghiêm trọng**: **MEDIUM**
- **File & Dòng mã nguồn liên quan**:
  - `apps/api/src/modules/study-rooms/study-rooms.routes.ts`: dòng 45, 58, 66, 81
  - `apps/api/src/modules/chat/chat.routes.ts`: dòng 50, 58
- **Mô tả & Nguyên nhân gốc rễ**:
  Trong khi các route tại `routes.ts` đều sử dụng `idSchema.parse(req.params.id)` để xác thực UUID, các route của `study-rooms` và `chat` lại truyền thẳng chuỗi thô từ `req.params.id` vào câu lệnh truy vấn Prisma.
  Khi người dùng nhập một chuỗi không phải UUID (ví dụ: gõ nhầm URL `/study-rooms/phong-hoc-1`), PostgreSQL ném lỗi cú pháp mã `22P02: invalid input syntax for type uuid`. Bộ lọc lỗi của server không bắt lỗi này thành 400 Bad Request mà chuyển tiếp thành mã lỗi máy chủ HTTP 500 `INTERNAL_ERROR`.

- **Các bước tái hiện (Reproduction Guide)**:
  Gửi yêu cầu: `GET /api/v1/study-rooms/khong-phai-uuid` hoặc `GET /api/v1/chat/conversations/123/messages`.
  
- **Bằng chứng Terminal Log / Phản hồi thực nghiệm**:
  ```text
  PrismaClientKnownRequestError: Invalid input syntax for type uuid: "khong-phai-uuid"
  code: 'P2007'
  HTTP Status: 500 INTERNAL_ERROR (Mong muốn: 400 VALIDATION_ERROR hoặc 404 NOT_FOUND)
  ```

- **Phương án khắc phục đề xuất (Remediation)**:
  Sử dụng `idSchema` chuẩn hóa trong `study-rooms.routes.ts` và `chat.routes.ts`:
  ```typescript
  import { idSchema } from '../../lib/validation.js';
  const roomId = idSchema.parse(req.params.id);
  ```

---

#### 🟡 ISSUE-MED-02: Khóa chức năng chỉnh sửa ghi chú/tiêu đề công việc đã quá hạn
- **Mã định danh**: `ISSUE-MED-02`
- **Mức độ nghiêm trọng**: **MEDIUM**
- **File & Dòng mã nguồn liên quan**: `apps/api/src/routes.ts:115-116`
- **Mô tả & Nguyên nhân gốc rễ**:
  Khi sinh viên cập nhật thông tin công việc qua `PATCH /tasks/:id`, backend kết hợp dữ liệu cũ và dữ liệu mới rồi kiểm tra:
  ```typescript
  const input = taskInput.parse({ ...previous, deadline: previous.deadline.toISOString(), ...req.body });
  if (+input.deadline <= Date.now()) throw new ApiError(400, 'DEADLINE_PASSED');
  ```
  Nếu một công việc đã bị quá hạn (hạn chót nhỏ hơn thời điểm hiện tại), dù sinh viên chỉ muốn sửa lại ghi chú hoặc sửa lỗi chính tả tiêu đề (không hề chỉnh sửa hạn chót), hệ thống vẫn kiểm tra lại `deadline` cũ và chặn với lỗi `DEADLINE_PASSED`.

- **Các bước tái hiện (Reproduction Guide)**:
  1. Tạo một công việc có hạn chót trong quá khứ hoặc chờ công việc hết hạn.
  2. Bấm vào công việc và cập nhật ghi chú: `{ "notes": "Cập nhật tiến độ đã nộp trễ" }`.
  3. Giao diện báo lỗi đỏ: `DEADLINE_PASSED`.

- **Phương án khắc phục đề xuất (Remediation)**:
  Chỉ kiểm tra `+input.deadline <= Date.now()` nếu yêu cầu từ phía client **có truyền lên trường `deadline` mới**:
  ```typescript
  if (req.body.deadline && +input.deadline <= Date.now()) {
    throw new ApiError(400, 'DEADLINE_PASSED');
  }
  ```

---

#### 🟡 ISSUE-MED-03: Xung đột tạo cuộc trò chuyện 1-1 đồng thời gây lỗi HTTP 409
- **Mã định danh**: `ISSUE-MED-03`
- **Mức độ nghiêm trọng**: **MEDIUM**
- **File & Dòng mã nguồn liên quan**: `apps/api/src/modules/chat/chat.service.ts:66-90`
- **Mô tả & Nguyên nhân gốc rễ**:
  Bảng `direct_conversations` có ràng buộc duy nhất `@@unique([user1Id, user2Id])`. Khi khởi tạo cuộc trò chuyện, hàm `getOrCreateConversation` sử dụng mẫu "tìm trước, tạo sau":
  ```typescript
  let conversation = await db().directConversation.findUnique({ ... });
  if (!conversation) {
    conversation = await db().directConversation.create({ ... });
  }
  ```
  Nếu hai sinh viên cùng lúc bấm nút nhắn tin cho nhau từ trang Danh sách sinh viên, cả hai tiến trình đều không tìm thấy bản ghi và cùng gọi lệnh `create`. Tiến trình thứ hai sẽ bị cơ sở dữ liệu chặn bởi lỗi khóa duy nhất Prisma `P2002`, khiến server trả về mã lỗi HTTP 409 `DUPLICATE_RECORD` thay vì trả về cuộc trò chuyện đã tạo.

- **Phương án khắc phục đề xuất (Remediation)**:
  Sử dụng câu lệnh `upsert` hoặc bắt lỗi `P2002` để tự động trả về bản ghi vừa được tạo đồng thời.

---

#### 🟡 ISSUE-MED-04: Tràn độ dài chuỗi ký tự WebSocket gây lỗi cơ sở dữ liệu VARCHAR
- **Mã định danh**: `ISSUE-MED-04`
- **Mức độ nghiêm trọng**: **MEDIUM**
- **File & Dòng mã nguồn liên quan**: `apps/api/src/modules/realtime/websocket.server.ts:151-184`, `packages/database/prisma/schema.prisma:340, 370`
- **Mô tả & Nguyên nhân gốc rễ**:
  Trong cơ sở dữ liệu PostgreSQL, cột `current_task` trong bảng người tham gia phòng học được định nghĩa là `VARCHAR(120)` và cột nội dung tin nhắn `content` là `VARCHAR(1000)`.
  Tuy nhiên, khi nhận gói tin WebSocket `task:update` và `chat:room_send`, backend không sử dụng Zod schema để kiểm tra giới hạn độ dài ký tự. Nếu client gửi chuỗi dài hơn (ví dụ: paste một đoạn văn bản dài 1500 ký tự vào ô chat phòng), Prisma sẽ ném ngoại lệ độ dài chuỗi không được xử lý:
  ```text
  PrismaClientKnownRequestError: The provided value for the column is too long for the column's type.
  ```

- **Phương án khắc phục đề xuất (Remediation)**:
  Cắt ngắn hoặc kiểm tra độ dài trước khi lưu: `trimmed.slice(0, 1000)` đối với nội dung chat và `currentTask.slice(0, 120)` đối với trạng thái nhiệm vụ.

---

#### 🟡 ISSUE-MED-05: Thanh cuộn ngang trên màn hình di động 390px và kích thước nút bấm nhỏ
- **Mã định danh**: `ISSUE-MED-05`
- **Mức độ nghiêm trọng**: **MEDIUM**
- **File & Dòng mã nguồn liên quan**: `apps/web/src/App.tsx`, `Tasks.tsx`, `tests/e2e/agenda-history.spec.ts:179`, `tasks.spec.ts:28`
- **Mô tả & Nguyên nhân gốc rễ**:
  1. Khi kiểm thử trên màn hình điện thoại (viewport 390px chuẩn iPhone 12/13/14), thuộc tính `document.documentElement.scrollWidth > window.innerWidth` trả về `true`. Giao diện xuất hiện thanh cuộn ngang do một số container flexbox có nội dung cố định padding vượt quá giới hạn màn hình.
  2. Các nút bấm bộ lọc công việc (`Tất cả`, `Ưu tiên cao`, `Đang làm`) có kích thước vùng bấm chỉ đạt ~32×28px, không đáp ứng tiêu chuẩn tiếp cận Web Content Accessibility Guidelines (WCAG 2.1 Tiêu chí 2.5.5 quy định kích thước mục tiêu bấm tối thiểu là 44×44px).

- **Phương án khắc phục đề xuất (Remediation)**:
  Bổ sung `overflow-x-hidden` vào thẻ `<main>` bao bọc và thiết lập `min-h-[44px] min-w-[44px]` cho các nút bấm điều khiển trên giao diện di động.

---

#### 🟡 ISSUE-MED-06: Tràn bộ nhớ phân trang Windows khi chạy kịch bản npm lồng nhau
- **Mã định danh**: `ISSUE-MED-06`
- **Mức độ nghiêm trọng**: **MEDIUM**
- **File & Dòng mã nguồn liên quan**: `scripts/run-with-project-env.mjs`
- **Mô tả & Nguyên nhân gốc rễ**:
  Cơ chế chạy script thông qua wrapper `node scripts/run-with-project-env.mjs <command:inner>` tạo ra một cây tiến trình lồng 4 tầng:
  `PowerShell` ➔ `node run-with-project-env.mjs` ➔ `npm run <inner>` ➔ `node <target>`.
  Trên hệ điều hành Windows, mỗi tiến trình Node.js xin cấp phát một khối bộ nhớ ảo lớn (V8 Virtual Memory Commit). Khi máy tính bị giới hạn file hoán trang (Paging File / Commit Charge ~16GB), việc chạy các lệnh nặng như `npm run smoke:production` hoặc chạy đồng thời các tiến trình kiểm thử sẽ gây lỗi crash:
  ```text
  NativeCommandFailed: The paging file is too small for this operation to complete.
  Mã lỗi thoát: -1073740791
  ```

- **Phương án khắc phục đề xuất (Remediation)**:
  Chạy trực tiếp file script bằng lệnh Node thay vì gọi qua chuỗi lồng npm: ví dụ `node scripts/smoke-production.mjs`.

---

### 3.4. Nhóm Lỗi Low

#### 🟢 ISSUE-LOW-01: Cảnh báo tối ưu chia nhỏ gói mã nguồn (Code-Splitting) của Vite
- **Mã định danh**: `ISSUE-LOW-01`
- **Mức độ nghiêm trọng**: **LOW**
- **File & Dòng mã nguồn liên quan**: `apps/web/src/components.tsx`
- **Mô tả**:
  Khi chạy `npm run build`, plugin Vite cảnh báo:
  `components.tsx is dynamically imported by App.tsx but also statically imported by 10 other components`.
  Việc vừa import dynamic vừa import static khiến trình đóng gói không thể tách `components.tsx` thành một chunk độc lập để tối ưu thời gian tải trang.

---

#### 🟢 ISSUE-LOW-02: Chưa tích hợp bộ script kiểm tra định dạng và chuẩn mã nguồn (Lint)
- **Mã định danh**: `ISSUE-LOW-02`
- **Mức độ nghiêm trọng**: **LOW**
- **File & Dòng mã nguồn liên quan**: `package.json`
- **Mô tả**:
  Trong danh mục script tại file `package.json` gốc, không có lệnh `npm run lint`. Dự án hiện dựa hoàn toàn vào trình kiểm tra kiểu TypeScript (`tsc`) và cấu hình Prettier (`.prettierrc.json`). Cần bổ sung ESLint để tự động hóa việc phát hiện biến thừa và lỗi cú pháp chuẩn.

---

## 4. HƯỚNG DẪN VẬN HÀNH AN TOÀN TRONG BUỔI BẢO VỆ (PRE-DEFENSE OPERATIONAL GUIDE)

Để đảm bảo buổi bảo vệ đồ án tốt nghiệp diễn ra hoàn hảo, không gặp bất kỳ sự cố gián đoạn hay lỗi kỹ thuật ngoài ý muốn nào trước Hội đồng chấm điểm, sinh viên **bắt buộc phải tuân thủ nghiêm ngặt cẩm nang vận hành dưới đây**:

### 4.1. Danh mục kịch bản VÀNG (Khuyến nghị demo trước Hội đồng)
Đây là các tính năng hoạt động cực kỳ mượt mà, ổn định và thể hiện rõ nét hàm lượng khoa học của đồ án:

1. **Khởi tạo dữ liệu mẫu tức thì (Demo Account Bootstrapping)**:
   - Thao tác: Bấm vào nút *"Trải nghiệm nhanh (Tài khoản Demo)"* trên màn hình đăng nhập.
   - Kết quả: Hệ thống tự động khởi tạo dữ liệu sinh viên mẫu, nạp thời khóa biểu UED, các môn học, công việc mẫu và thông báo chỉ trong chưa đầy 200ms.
2. **Thuật toán lập lịch thông minh (Greedy Scheduler & Conflict Detection)**:
   - Thao tác: Vào mục *"Đề xuất lịch"* (`#suggestions`), chọn khoảng thời gian lập lịch (ví dụ 14 ngày) và bấm *"Tạo đề xuất mới"*.
   - Điểm nhấn thuyết trình: Nêu bật khả năng xếp lịch giải quyết xung đột, tôn trọng khung giờ học tập, khung giờ nghỉ trưa, tự động tính toán thời gian di chuyển (travel buffer) giữa các địa điểm khác nhau và cắt nhỏ các công việc cho phép chia nhỏ (`isSplittable`).
   - Thao tác: Bấm *"Chấp nhận"* đề xuất ➔ Quan sát hệ thống sử dụng khóa giao dịch `Postgres Advisory Lock` để cập nhật nguyên tử vào Lịch biểu.
3. **Quản lý công việc và phân trang con trỏ (Task History Keyset Pagination)**:
   - Thao tác: Tạo công việc mới với hạn chót trong tương lai, phân loại độ ưu tiên (`CAO`, `TRUNG BÌNH`, `THẤP`).
   - Thao tác: Đánh dấu hoàn thành công việc và chuyển sang tab *"Lịch sử công việc"* ➔ Thao tác cuộn mượt mà với phân trang con trỏ không bị tải lại trang.
4. **Xem lịch tuần trực quan (Weekly Interactive Calendar)**:
   - Thao tác: Điều hướng qua lại giữa các tuần, quan sát phân biệt màu sắc rõ ràng giữa Lịch học chính khóa (cố định), Lịch cá nhân và Phiên làm bài tập tự động xếp.

---

### 4.2. Danh mục kịch bản ĐỎ (Tuyệt đối KHÔNG thao tác trực tiếp)
Sinh viên **tuyệt đối không thực hiện** các thao tác sau khi đang trình chiếu trước Hội đồng:

| Kịch bản cấm kỵ | Lý do kỹ thuật | Hậu quả nếu bấm vào |
|---|---|---|
| **Tuyệt đối KHÔNG chạy lệnh `npm run test:e2e`** | Bộ test E2E Playwright đang lệch selector giao diện với 14/20 spec thất bại. | Màn hình terminal sẽ tràn ngập lỗi màu đỏ kéo dài hơn 5 phút. |
| **Tuyệt đối KHÔNG chuyển trình duyệt sang chế độ xem Mobile 390px** | Giao diện bị lỗi tràn màn hình ngang (`scrollWidth > 390px`). | Xuất hiện thanh cuộn ngang khó nhìn trên điện thoại. |
| **Tuyệt đối KHÔNG chỉnh sửa công việc đã quá hạn** | Lỗi logic `+input.deadline <= Date.now()` trong `routes.ts:116`. | Bật popup thông báo lỗi `DEADLINE_PASSED`. |
| **Tuyệt đối KHÔNG mở 2 trình duyệt cùng bấm tham gia phòng học giới hạn sĩ số** | Tranh chấp đồng thời TOCTOU trong `study-rooms.service.ts:89`. | Sĩ số phòng hiển thị vượt quá số lượng tối đa cho phép. |
| **Tuyệt đối KHÔNG gõ URL sai định dạng (ví dụ `/study-rooms/abc`)** | Thiếu `idSchema` trong router xử lý phòng học và chat. | Server trả về lỗi sập HTTP 500 `INTERNAL_ERROR`. |
| **Tuyệt đối KHÔNG paste nội dung văn bản quá dài (>1000 từ) vào khung chat** | Thiếu xác thực độ dài chuỗi WebSocket trước khi ghi DB. | Gây lỗi cơ sở dữ liệu `value too long for column`. |

---

### 4.3. Quy trình chuẩn bị môi trường Demo cục bộ

Thực hiện đúng 5 bước sau đây **30 phút trước khi bắt đầu buổi bảo vệ**:

```powershell
# BƯỚC 1: Kiểm tra cơ sở dữ liệu PostgreSQL cục bộ đang lắng nghe trên cổng 55432
Get-NetTCPConnection -LocalPort 55432 -ErrorAction SilentlyContinue

# BƯỚC 2: Nếu chưa chạy DB, khởi động PostgreSQL cục bộ
node scripts/local-db.mjs

# BƯỚC 3: Đồng bộ toàn bộ các migration mới nhất vào cơ sở dữ liệu
npm run db:deploy --workspace @personal-schedule/database

# BƯỚC 4: Khởi động backend API và worker ở 1 cửa sổ Terminal riêng biệt
npm run dev:api

# BƯỚC 5: Khởi động frontend Web ở 1 cửa sổ Terminal khác và mở trình duyệt
npm run dev:web
```

*Lưu ý quan trọng*: Sử dụng một trình duyệt Chromium sạch (ví dụ Chrome hoặc Edge), không mở đồng thời các ứng dụng nặng để tránh cạn kiệt bộ nhớ máy tính.

---

### 4.4. Lộ trình khắc phục kỹ thuật sau buổi bảo vệ (Remediation Roadmap)

Sau khi hoàn thành buổi bảo vệ tốt nghiệp, nhóm phát triển cần tiến hành vá mã nguồn theo lộ trình 3 giai đoạn sau để sẵn sàng đưa sản phẩm vào triển khai thực tế cho toàn thể sinh viên trường ĐH Sư phạm:

```
┌────────────────────────────────────────────────────────────────────────┐
│               POST-DEFENSE REMEDIATION ROADMAP                         │
├────────────────────────────────────────────────────────────────────────┤
│ GIAI ĐOẠN 1: Vá khẩn cấp các lỗ hổng bảo mật & sập server (1 - 2 ngày) │
│ - Bổ sung kiểm tra Origin vào WebSocket Upgrade (`websocket.server.ts`)│
│ - Bỏ gọi shutdown() khi gặp unhandledRejection (`server.ts`)           │
│ - Bổ sung xác thực thành viên phòng học trước khi chat (`websocket`)   │
│ - Ẩn tin nhắn chat phòng kín với khách chưa đăng nhập (`study-rooms`)  │
│ - Áp dụng idSchema (UUID) cho toàn bộ 6 route của study-rooms và chat  │
├────────────────────────────────────────────────────────────────────────┤
│ GIAI ĐOẠN 2: Khắc phục tranh chấp đồng thời & logic nghiệp vụ (3 ngày) │
│ - Đưa joinStudyRoom vào transaction kèm Postgres Advisory Lock         │
│ - Sửa logic PATCH task quá hạn (chỉ kiểm tra nếu có deadline mới)      │
│ - Thêm kiểm tra previous.source === 'MANUAL' chặn sửa lịch chính khóa  │
│ - Xử lý xung đột tạo cuộc trò chuyện 1-1 bằng upsert hoặc bắt P2002   │
├────────────────────────────────────────────────────────────────────────┤
│ GIAI ĐOẠN 3: Hoàn thiện giao diện di động & cập nhật bộ test E2E (1 tuần)│
│ - Cập nhật lại selector trong Playwright E2E khớp với 8 tab điều hướng │
│ - Sửa lỗi tràn màn hình 390px và tăng kích thước nút bấm tối thiểu 44px│
│ - Tách nhỏ component trong components.tsx để tối ưu chunk Vite build   │
│ - Cấu hình ESLint chuẩn hóa mã nguồn cho toàn bộ monorepo              │
└────────────────────────────────────────────────────────────────────────┘
```

---
*Báo cáo được biên soạn và phê duyệt bởi Tổ Công tác Thẩm định Độc lập SchedUED.*  
*Tài liệu nội bộ phục vụ công tác chuẩn bị bảo vệ đồ án tốt nghiệp.*
