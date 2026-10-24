# Phòng học chung Online (Focus Room) & Chat Sinh viên Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Xây dựng hệ thống phòng học chung online (Study With Me / Focus Room) với đồng hồ Pomodoro đồng bộ, video/mic WebRTC P2P học chung, âm thanh tập trung, và hệ thống chat trực tiếp 1-1 giữa các sinh viên qua MSSV.

**Architecture:** Sử dụng PostgreSQL + Prisma cho quản lý phòng, lời mời và lịch sử tin nhắn; tích hợp máy chủ WebSocket chuẩn (`ws`) trên cùng HTTP server Express để xử lý tin nhắn realtime, đồng bộ Pomodoro timer và signaling WebRTC P2P; xây dựng giao diện React dạng bảng điều khiển phòng học tập trung và trung tâm tin nhắn.

**Tech Stack:** Node.js, Express, WebSocket (`ws`), WebRTC (MediaStream, RTCPeerConnection, STUN Google), Prisma, PostgreSQL, React 19, TypeScript, CSS Variables (UniRhythm theme).

**Spec:** [docs/superpowers/specs/2026-10-24-study-room-student-chat-design.md](file:///e:/Du%20An/Web_Do_An/docs/superpowers/specs/2026-10-24-study-room-student-chat-design.md)

---

## Global Constraints

- Không can thiệp hoặc thay đổi các luồng đồng bộ UED / Outlook hiện có.
- Mọi kết nối WebSocket phải được xác thực bằng cookie phiên đăng nhập (`sid`).
- Host là người tạo phòng: có toàn quyền điều khiển Pomodoro timer, đổi passcode, mời thành viên và giải tán phòng.
- Giới hạn người tham gia tối đa mỗi phòng từ 2 đến 8 người để đảm bảo hiệu năng WebRTC P2P mesh.
- Tin nhắn và phòng học phải đảm bảo phân quyền: chỉ thành viên trong phòng mới nhận được tin nhắn phòng; chỉ người tham gia hội thoại 1-1 mới đọc được tin nhắn 1-1.

---

## Review Focus

1. **Host rời phòng đột ngột**: Khi Host ngắt kết nối WebSocket hoặc rời phòng, server tự động chỉ định người tham gia lâu nhất kế tiếp làm Host tạm thời hoặc tạm dừng Pomodoro timer để phòng không bị treo.
2. **Sai passcode hoặc phòng đã đủ người**: Khi phòng đạt `maxParticipants` hoặc sinh viên nhập sai mã passcode, server phải từ chối rõ ràng với mã lỗi `ROOM_FULL` hoặc `INVALID_PASSCODE`.
3. **WebRTC Peer renegotiation / disconnect**: Khi một peer tắt cam/mic hoặc rời phòng, các client còn lại phải dọn dẹp track video và `RTCPeerConnection` tương ứng mà không làm đứt kết nối của các peer khác trong phòng.
4. **Xung đột thời gian Pomodoro**: Khi sinh viên mới tham gia giữa chừng khi phiên Pomodoro đang chạy, client mới phải nhận được mốc `timerEndsAt` chính xác để đồng bộ ngay lập tức.
5. **Tin nhắn rác / tin nhắn rỗng**: Kiểm tra độ dài nội dung tin nhắn (`content` từ 1 đến 2000 ký tự) và rate-limiting tin nhắn để tránh spam.

---

## File Structure

```
packages/database/prisma/
  schema.prisma                                    # Thêm models: StudyRoom, StudyRoomParticipant, StudyRoomInvite, RoomChatMessage, DirectConversation, DirectChatMessage

apps/api/src/
  modules/
    study-rooms/
      study-rooms.service.ts                       # Logic tạo phòng, join, passcode, invite, pomodoro
      study-rooms.routes.ts                        # REST endpoints cho phòng học
    chat/
      chat.service.ts                              # Logic tìm bạn, tạo hội thoại 1-1, gửi/lấy tin nhắn
      chat.routes.ts                               # REST endpoints cho chat 1-1
    realtime/
      room-hub.ts                                  # Quản lý state in-memory phòng, peer, timer
      websocket.server.ts                          # WebSocket server, auth, dispatching signaling & chat
  server.ts                                        # Gắn WebSocket server vào HTTP server

apps/web/src/
  StudyRooms.tsx                                   # Danh sách phòng học, tạo phòng, modal nhập passcode
  StudyRoomFocus.tsx                               # Không gian học tập trung: Pomodoro timer, Video grid, Chat phòng, Control bar
  ChatHub.tsx                                      # Trung tâm tin nhắn 1-1: Tìm bạn theo MSSV, danh sách hội thoại, khung chat
  study-room.css                                   # Styles cho phòng học chung, video grid, pomodoro
  chat.css                                         # Styles cho trung tâm tin nhắn 1-1
  lib/
    webrtc.ts                                      # Quản lý RTCPeerConnection mesh & MediaStreams
    websocket-client.ts                            # Quản lý kết nối WSS, tự động reconnect và dispatch events
    use-pomodoro.ts                                # Hook tính toán thời gian Pomodoro, âm thanh chuông
```

---

## Tasks

### Task 1: Prisma Schema Migration cho Phòng học chung & Chat

**Files:**
- Modify: `packages/database/prisma/schema.prisma`
- Output: Migration SQL trong `packages/database/prisma/migrations/`
- Test: `packages/database/src/__tests__/schema.test.ts` hoặc script kiểm tra Prisma generate

**Interfaces:**
- Produces: Prisma Client types (`StudyRoom`, `StudyRoomParticipant`, `StudyRoomInvite`, `RoomChatMessage`, `DirectConversation`, `DirectChatMessage`).

- [ ] **Step 1: Thêm models vào `packages/database/prisma/schema.prisma`**
  Thêm enum `RoomPomodoroState`, `InviteStatus` và 6 model theo đúng đặc tả:
  `StudyRoom`, `StudyRoomParticipant`, `StudyRoomInvite`, `RoomChatMessage`, `DirectConversation`, `DirectChatMessage`.

- [ ] **Step 2: Chạy migration và generate Prisma client**
  Run: `npm run db:generate --workspace @personal-schedule/database`
  Expected: Generated Prisma Client thành công không có lỗi type.

- [ ] **Step 3: Tạo migration SQL**
  Run: `npx prisma migrate dev --name add_study_room_and_chat --create-only --schema packages/database/prisma/schema.prisma`
  Expected: File migration được tạo trong `packages/database/prisma/migrations/`.

- [ ] **Step 4: Commit**
  ```bash
  git add packages/database/prisma/
  git commit -m "feat(db): add study rooms, invites, and direct chat schema"
  ```

---

### Task 2: Service & API Endpoints cho Phòng học chung (Study Rooms)

**Files:**
- Create: `apps/api/src/modules/study-rooms/study-rooms.service.ts`
- Create: `apps/api/src/modules/study-rooms/study-rooms.routes.ts`
- Modify: `apps/api/src/routes.ts`
- Test: `apps/api/tests/unit/study-rooms.service.test.ts`

**Interfaces:**
- Consumes: Prisma Client (`db.studyRoom`, `db.studyRoomParticipant`, `db.studyRoomInvite`)
- Produces:
  - `createStudyRoom(userId: string, data: CreateRoomInput): Promise<StudyRoom>`
  - `joinStudyRoom(userId: string, roomId: string, passcode?: string): Promise<{ room: StudyRoom; participant: StudyRoomParticipant }>`
  - `inviteStudent(userId: string, roomId: string, targetStudentId: string): Promise<StudyRoomInvite>`
  - `listStudyRooms(): Promise<StudyRoomSummary[]>`
  - `closeStudyRoom(userId: string, roomId: string): Promise<void>`

- [ ] **Step 1: Viết test kiểm tra logic tạo phòng, passcode và giới hạn người**
  Tạo `apps/api/tests/unit/study-rooms.service.test.ts` test:
  - Tạo phòng thành công, người tạo là Host.
  - Phòng có passcode: join đúng pass thành công, sai pass ném lỗi `INVALID_PASSCODE`.
  - Phòng đạt `maxParticipants`: ném lỗi `ROOM_FULL`.
  - Chỉ Host mới có quyền đóng phòng (`FORBIDDEN`).

- [ ] **Step 2: Chạy test để xác nhận test fail**
  Run: `npx vitest run apps/api/tests/unit/study-rooms.service.test.ts`
  Expected: FAIL (modules chưa tồn tại).

- [ ] **Step 3: Hiện thực `study-rooms.service.ts` và `study-rooms.routes.ts`**
  - Viết các hàm nghiệp vụ trong `study-rooms.service.ts`.
  - Định nghĩa router trong `study-rooms.routes.ts` và gắn vào `apps/api/src/routes.ts`.

- [ ] **Step 4: Chạy test để xác nhận test pass**
  Run: `npx vitest run apps/api/tests/unit/study-rooms.service.test.ts`
  Expected: PASS toàn bộ tests.

- [ ] **Step 5: Commit**
  ```bash
  git add apps/api/src/modules/study-rooms/ apps/api/src/routes.ts apps/api/tests/unit/study-rooms.service.test.ts
  git commit -m "feat(api): implement study rooms management and invite endpoints"
  ```

---

### Task 3: Service & API Endpoints cho Chat Trực tiếp 1-1 (Direct Chat)

**Files:**
- Create: `apps/api/src/modules/chat/chat.service.ts`
- Create: `apps/api/src/modules/chat/chat.routes.ts`
- Modify: `apps/api/src/routes.ts`
- Test: `apps/api/tests/unit/chat.service.test.ts`

**Interfaces:**
- Consumes: Prisma Client (`db.directConversation`, `db.directChatMessage`, `db.user`)
- Produces:
  - `searchStudents(query: string, currentUserId: string): Promise<StudentPublicProfile[]>`
  - `getOrCreateConversation(user1Id: string, user2Id: string): Promise<DirectConversation>`
  - `sendDirectMessage(senderId: string, conversationId: string, content: string): Promise<DirectChatMessage>`
  - `getConversationMessages(userId: string, conversationId: string, limit?: number): Promise<DirectChatMessage[]>`
  - `listUserConversations(userId: string): Promise<ConversationSummary[]>`

- [ ] **Step 1: Viết test cho Chat 1-1**
  Tạo `apps/api/tests/unit/chat.service.test.ts` test:
  - Tìm kiếm sinh viên theo MSSV hoặc họ tên (không trả về chính mình).
  - Tạo hoặc lấy lại cuộc trò chuyện giữa 2 người (đảm bảo thứ tự cặp ID nhất quán, không trùng lặp).
  - Gửi tin nhắn và kiểm tra phân quyền (người ngoài không xem được tin nhắn).

- [ ] **Step 2: Chạy test để xác nhận test fail**
  Run: `npx vitest run apps/api/tests/unit/chat.service.test.ts`
  Expected: FAIL.

- [ ] **Step 3: Hiện thực `chat.service.ts` và `chat.routes.ts`**
  - Viết logic tìm kiếm, quản lý hội thoại và lưu tin nhắn.
  - Gắn `chatRouter` vào `apps/api/src/routes.ts`.

- [ ] **Step 4: Chạy test để xác nhận test pass**
  Run: `npx vitest run apps/api/tests/unit/chat.service.test.ts`
  Expected: PASS.

- [ ] **Step 5: Commit**
  ```bash
  git add apps/api/src/modules/chat/ apps/api/src/routes.ts apps/api/tests/unit/chat.service.test.ts
  git commit -m "feat(chat): implement direct 1-1 chat service and routes"
  ```

---

### Task 4: Máy chủ WebSocket (Realtime Room Hub, Pomodoro & WebRTC Signaling)

**Files:**
- Create: `apps/api/src/modules/realtime/room-hub.ts`
- Create: `apps/api/src/modules/realtime/websocket.server.ts`
- Modify: `apps/api/src/server.ts`
- Test: `apps/api/tests/unit/websocket.server.test.ts`

**Interfaces:**
- Consumes: `ws` library, session authentication cookie parser, `study-rooms.service.ts`, `chat.service.ts`
- Produces:
  - `setupWebSocketServer(httpServer: http.Server): WebSocketServer`
  - In-memory `RoomHub` tracking connected peers per room, camera/mic states, active Pomodoro timer.
  - Signaling dispatcher for WebRTC (`offer`, `answer`, `ice_candidate`).

- [ ] **Step 1: Viết test mô phỏng kết nối WebSocket**
  Tạo `apps/api/tests/unit/websocket.server.test.ts` kiểm tra:
  - Handshake từ chối khi không có cookie phiên đăng nhập hợp lệ.
  - Client join room nhận thông báo `room:peer_joined`.
  - Truyền tín hiệu WebRTC giữa 2 client trong cùng phòng.
  - Host kích hoạt Pomodoro phát tin hiệu `pomodoro:sync` tới tất cả client trong phòng.

- [ ] **Step 2: Chạy test để xác nhận test fail**
  Run: `npx vitest run apps/api/tests/unit/websocket.server.test.ts`
  Expected: FAIL.

- [ ] **Step 3: Hiện thực `room-hub.ts` và `websocket.server.ts`**
  - Cài đặt `ws` và `@types/ws` nếu chưa có.
  - Xử lý xác thực cookie `sid`.
  - Gắn WebSocket server vào `httpServer` trong `apps/api/src/server.ts`.

- [ ] **Step 4: Chạy test để xác nhận test pass**
  Run: `npx vitest run apps/api/tests/unit/websocket.server.test.ts`
  Expected: PASS.

- [ ] **Step 5: Commit**
  ```bash
  git add apps/api/src/modules/realtime/ apps/api/src/server.ts apps/api/tests/unit/websocket.server.test.ts
  git commit -m "feat(realtime): setup WebSocket server for WebRTC signaling and Pomodoro sync"
  ```

---

### Task 5: Giao diện Trung tâm Tin nhắn Trực tiếp (Frontend Direct Chat)

**Files:**
- Create: `apps/web/src/ChatHub.tsx`
- Create: `apps/web/src/chat.css`
- Modify: `apps/web/src/App.tsx`, `apps/web/src/AppShell.tsx`, `apps/web/src/types.ts`

**Interfaces:**
- Consumes: REST `/api/v1/chat/*`, WebSocket messages (`chat:direct_received`)
- Produces: `ChatHub` component tích hợp vào menu chính ứng dụng.

- [ ] **Step 1: Tạo khung giao diện và CSS cho `ChatHub`**
  - Cột trái: Thanh tìm kiếm MSSV, danh sách cuộc trò chuyện gần nhất, trạng thái online.
  - Cột phải: Khung hội thoại, danh sách tin nhắn, ô nhập tin nhắn kèm nút gửi.

- [ ] **Step 2: Tích hợp WebSocket nhận tin nhắn realtime**
  - Khi có tin nhắn đến từ `chat:direct_received`, tự động cập nhật danh sách tin nhắn và đẩy cuộc hội thoại lên đầu danh sách.

- [ ] **Step 3: Gắn menu "Tin nhắn" vào `AppShell.tsx` và route trong `App.tsx`**
  - Thêm biểu tượng `MessageSquare` vào thanh bên.

- [ ] **Step 4: Kiểm tra typecheck**
  Run: `npm run typecheck --workspace @personal-schedule/web`
  Expected: Code 0 (không lỗi type).

- [ ] **Step 5: Commit**
  ```bash
  git add apps/web/src/ChatHub.tsx apps/web/src/chat.css apps/web/src/App.tsx apps/web/src/AppShell.tsx
  git commit -m "feat(web): add direct student chat UI with realtime updates"
  ```

---

### Task 6: Giao diện Không gian Học tập trung & Video WebRTC P2P (Frontend Study Room)

**Files:**
- Create: `apps/web/src/StudyRooms.tsx` (Danh sách phòng, modal tạo phòng, nhập pass)
- Create: `apps/web/src/StudyRoomFocus.tsx` (Không gian học: Pomodoro, Video mesh, Room chat)
- Create: `apps/web/src/lib/webrtc.ts` (Quản lý RTCPeerConnection, STUN Google)
- Create: `apps/web/src/lib/use-pomodoro.ts` (Đồng hồ đếm ngược, âm thanh chuông kết thúc)
- Create: `apps/web/src/study-room.css`
- Modify: `apps/web/src/App.tsx`, `apps/web/src/AppShell.tsx`

**Interfaces:**
- Consumes: REST `/api/v1/study-rooms/*`, WebSocket signaling (`webrtc:*`, `pomodoro:*`, `room:*`)
- Produces: `StudyRooms` và `StudyRoomFocus` components.

- [ ] **Step 1: Xây dựng module WebRTC P2P mesh (`apps/web/src/lib/webrtc.ts`)**
  - Quản lý `localStream` (Camera/Mic).
  - Tự động tạo `RTCPeerConnection` khi nhận `room:peer_joined`.
  - Xử lý bật/tắt track audio/video mượt mà.

- [ ] **Step 2: Xây dựng Hook Pomodoro đồng bộ (`apps/web/src/lib/use-pomodoro.ts`)**
  - Nhận `timerEndsAt` từ server và đếm ngược từng giây.
  - Phát âm thanh chuông nhẹ qua Web Audio API khi hết giờ.

- [ ] **Step 3: Xây dựng component `StudyRoomFocus.tsx`**
  - Vòng tròn đồng hồ Pomodoro lớn ở trung tâm.
  - Lưới hiển thị camera/avatar (2 đến 8 ô).
  - Bảng điều khiển dưới: Bật/Tắt Mic, Cam, Nhạc Lofi/Mưa, Chọn task đang làm, Nút Host điều khiển Pomodoro.
  - Khung chat phòng bên phải.

- [ ] **Step 4: Xây dựng component `StudyRooms.tsx`**
  - Danh sách thẻ phòng đang mở, modal Tạo phòng (tiêu đề, passcode, max 2-8), modal Nhập mã PIN.

- [ ] **Step 5: Gắn menu "Phòng học chung" vào `AppShell.tsx` và `App.tsx`**
  - Thêm icon `Users` / `Tv` vào thanh bên.

- [ ] **Step 6: Kiểm tra typecheck**
  Run: `npm run typecheck --workspace @personal-schedule/web`
  Expected: Code 0.

- [ ] **Step 7: Commit**
  ```bash
  git add apps/web/src/StudyRooms.tsx apps/web/src/StudyRoomFocus.tsx apps/web/src/lib/webrtc.ts apps/web/src/lib/use-pomodoro.ts apps/web/src/study-room.css apps/web/src/App.tsx apps/web/src/AppShell.tsx
  git commit -m "feat(web): add virtual study focus room with WebRTC video and Pomodoro sync"
  ```

---

### Task 7: Kiểm thử Toàn diện & Xác minh Đa người dùng

**Files:**
- Test scripts: `apps/api/tests/integration/study-rooms-chat.test.ts`
- Verification: Kiểm tra thực tế bằng 2 tab trình duyệt

- [ ] **Step 1: Viết bài test tích hợp E2E backend**
  Kiểm tra toàn bộ chuỗi: User 1 tạo phòng có pass -> User 2 nhập pass vào phòng -> WebSocket đồng bộ danh sách thành viên -> Gửi tin nhắn phòng & tin nhắn 1-1.

- [ ] **Step 2: Chạy toàn bộ test suite dự án**
  Run: `npm run test`
  Expected: Toàn bộ unit và integration tests đều PASS.

- [ ] **Step 3: Chạy build toàn dự án**
  Run: `npm run build`
  Expected: Build API và Web thành công không lỗi.

- [ ] **Step 4: Commit và hoàn tất**
  ```bash
  git add apps/api/tests/integration/
  git commit -m "test(integration): verify end-to-end study room and chat flow"
  ```
