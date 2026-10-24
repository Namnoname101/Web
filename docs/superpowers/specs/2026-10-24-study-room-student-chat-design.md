# Đặc tả Thiết kế: Phòng học chung Online (Focus Room) & Chat Sinh viên

- **Ngày tạo**: 24/10/2026
- **Trạng thái**: Chờ duyệt (Pending Review)
- **Tác giả**: Antigravity & lehop (Dai99133)
- **Dự án**: UniRhythm (Web_Do_An)

---

## 1. Mục tiêu & Phạm vi (Goals & Scope)

### 1.1 Mục tiêu
Cung cấp không gian học tập trực tuyến tập trung (Study With Me / Virtual Co-study Room) và cổng trò chuyện trực tiếp giữa các sinh viên, giúp:
- Tăng tính tương tác và động lực học tập (body-doubling effect) thông qua đồng hồ Pomodoro đồng bộ và bật cam học cùng nhau.
- Sinh viên chủ động kết nối, nhắn tin trực tiếp 1-1 qua MSSV để trao đổi bài tập hoặc mời nhau vào phòng học.
- Đảm bảo tính riêng tư, bảo mật bằng mã vào phòng (passcode) và quyền quản trị của Host (người tạo phòng).

### 1.2 Giới hạn phạm vi (Scope Boundaries)
- **Có hỗ trợ**:
  - Sinh viên chủ động tạo phòng học (tối đa 2 – 8 người).
  - Người tạo phòng là Host (quản lý Pomodoro đếm ngược, cấu hình phòng, mời thành viên).
  - Khóa phòng bằng mật khẩu/PIN (passcode) hoặc gửi lời mời trực tiếp theo MSSV.
  - Video & Mic ngang hàng (WebRTC P2P Mesh) bật/tắt cam học chung.
  - Âm thanh tập trung tùy chọn (Lofi beats, tiếng mưa rơi).
  - Hiển thị mục tiêu học tập (task) đang làm của từng sinh viên trong phòng.
  - Chat phòng học và Chat trực tiếp 1-1 giữa các sinh viên.
- **Không thực hiện trong giai đoạn này**:
  - Không tự động can thiệp gom nhóm lớp học phần từ cổng UED (giữ nguyên tính chủ động cá nhân giữa sinh viên với nhau).
  - Không ghi hình / lưu trữ video cuộc gọi (chỉ truyền stream thời gian thực P2P).

---

## 2. Mô hình Dữ liệu (Prisma Schema)

Bổ sung các model mới vào `packages/database/prisma/schema.prisma`:

```prisma
enum RoomPomodoroState {
  IDLE
  FOCUS
  BREAK

  @@map("room_pomodoro_state_enum")
}

enum InviteStatus {
  PENDING
  ACCEPTED
  DECLINED

  @@map("invite_status_enum")
}

model StudyRoom {
  id              String            @id @default(uuid()) @db.Uuid
  title           String            @db.VarChar(120)
  description     String?           @db.VarChar(255)
  passcode        String?           @db.VarChar(32) // Mật khẩu tham gia phòng (nếu có)
  maxParticipants Int               @default(6) @map("max_participants")
  isClosed        Boolean           @default(false) @map("is_closed")
  hostId          String            @map("host_id") @db.Uuid
  host            User              @relation("HostedRooms", fields: [hostId], references: [id], onDelete: Cascade)

  // Trạng thái Pomodoro đồng bộ
  pomodoroState   RoomPomodoroState @default(IDLE) @map("pomodoro_state")
  focusMinutes    Int               @default(25) @map("focus_minutes")
  breakMinutes    Int               @default(5) @map("break_minutes")
  timerEndsAt     DateTime?         @map("timer_ends_at") @db.Timestamptz(6)

  createdAt       DateTime          @default(now()) @map("created_at") @db.Timestamptz(6)
  updatedAt       DateTime          @updatedAt @map("updated_at") @db.Timestamptz(6)

  participants    StudyRoomParticipant[]
  invites         StudyRoomInvite[]
  messages        RoomChatMessage[]

  @@map("study_rooms")
}

model StudyRoomParticipant {
  id              String    @id @default(uuid()) @db.Uuid
  roomId          String    @map("room_id") @db.Uuid
  userId          String    @map("user_id") @db.Uuid
  currentTask     String?   @map("current_task") @db.VarChar(120)
  isCamOn         Boolean   @default(false) @map("is_cam_on")
  isMicOn         Boolean   @default(false) @map("is_mic_on")
  joinedAt        DateTime  @default(now()) @map("joined_at") @db.Timestamptz(6)
  lastSeenAt      DateTime  @default(now()) @map("last_seen_at") @db.Timestamptz(6)

  room            StudyRoom @relation(fields: [roomId], references: [id], onDelete: Cascade)
  user            User      @relation(fields: [userId], references: [id], onDelete: Cascade)

  @@unique([roomId, userId])
  @@map("study_room_participants")
}

model StudyRoomInvite {
  id              String       @id @default(uuid()) @db.Uuid
  roomId          String       @map("room_id") @db.Uuid
  invitedByUserId String       @map("invited_by_user_id") @db.Uuid
  targetStudentId String       @map("target_student_id") @db.VarChar(64)
  status          InviteStatus @default(PENDING)
  createdAt       DateTime     @default(now()) @map("created_at") @db.Timestamptz(6)

  room            StudyRoom    @relation(fields: [roomId], references: [id], onDelete: Cascade)
  inviter         User         @relation(fields: [invitedByUserId], references: [id], onDelete: Cascade)

  @@index([targetStudentId, status])
  @@map("study_room_invites")
}

model RoomChatMessage {
  id        String    @id @default(uuid()) @db.Uuid
  roomId    String    @map("room_id") @db.Uuid
  senderId  String    @map("sender_id") @db.Uuid
  content   String    @db.VarChar(1000)
  createdAt DateTime  @default(now()) @map("created_at") @db.Timestamptz(6)

  room      StudyRoom @relation(fields: [roomId], references: [id], onDelete: Cascade)
  sender    User      @relation(fields: [senderId], references: [id], onDelete: Cascade)

  @@index([roomId, createdAt])
  @@map("room_chat_messages")
}

model DirectConversation {
  id          String                 @id @default(uuid()) @db.Uuid
  user1Id     String                 @map("user1_id") @db.Uuid
  user2Id     String                 @map("user2_id") @db.Uuid
  createdAt   DateTime               @default(now()) @map("created_at") @db.Timestamptz(6)
  updatedAt   DateTime               @updatedAt @map("updated_at") @db.Timestamptz(6)

  user1       User                   @relation("DirectConversations1", fields: [user1Id], references: [id], onDelete: Cascade)
  user2       User                   @relation("DirectConversations2", fields: [user2Id], references: [id], onDelete: Cascade)
  messages    DirectChatMessage[]

  @@unique([user1Id, user2Id])
  @@map("direct_conversations")
}

model DirectChatMessage {
  id             String             @id @default(uuid()) @db.Uuid
  conversationId String             @map("conversation_id") @db.Uuid
  senderId       String             @map("sender_id") @db.Uuid
  content        String             @db.VarChar(2000)
  isRead         Boolean            @default(false) @map("is_read")
  createdAt      DateTime           @default(now()) @map("created_at") @db.Timestamptz(6)

  conversation   DirectConversation @relation(fields: [conversationId], references: [id], onDelete: Cascade)
  sender         User               @relation(fields: [senderId], references: [id], onDelete: Cascade)

  @@index([conversationId, createdAt])
  @@map("direct_chat_messages")
}
```

---

## 3. Kiến trúc Realtime & WebRTC Signaling (WebSocket)

### 3.1 WebSocket Server
- Tích hợp module `ws` gắn trực tiếp vào `http.Server` (Express) ở đường dẫn `/ws`.
- Xác thực handshake dựa trên phiên đăng nhập hiện tại (`cookie`).

### 3.2 Nhóm sự kiện (Event Types)
1. **Phòng học & Hiện diện (Room & Presence)**:
   - `room:join` `{ roomId, passcode?, currentTask? }`
   - `room:leave` `{ roomId }`
   - `room:peer_joined` `{ participantId, user, currentTask, isCamOn, isMicOn }`
   - `room:peer_left` `{ participantId }`
   - `room:task_updated` `{ participantId, taskTitle }`
   - `room:media_state` `{ isCamOn, isMicOn }`

2. **WebRTC Video Signaling**:
   - `webrtc:offer` `{ targetUserId, sdp }`
   - `webrtc:answer` `{ targetUserId, sdp }`
   - `webrtc:ice_candidate` `{ targetUserId, candidate }`
   - Cấu hình STUN: `stun:stun.l.google.com:19302`

3. **Đồng bộ Pomodoro**:
   - `pomodoro:start` `{ roomId, state: 'FOCUS' | 'BREAK', durationMinutes }` (chỉ Host có quyền phát)
   - `pomodoro:pause` `{ roomId }`
   - `pomodoro:reset` `{ roomId }`
   - Server phát quảng bá `pomodoro:tick` hoặc `pomodoro:sync` `{ state, timerEndsAt }`

4. **Chat thời gian thực**:
   - `chat:room_send` / `chat:room_received`
   - `chat:direct_send` / `chat:direct_received`

---

## 4. API Endpoints (RESTful)

### Phòng học chung:
- `GET /api/v1/study-rooms`: Danh sách phòng đang hoạt động (kèm số người hiện tại, có pass hay không).
- `POST /api/v1/study-rooms`: Tạo phòng mới (chủ phòng là Host).
- `GET /api/v1/study-rooms/:id`: Thông tin chi tiết phòng & danh sách người tham gia.
- `POST /api/v1/study-rooms/:id/join`: Kiểm tra passcode và xác nhận vào phòng.
- `POST /api/v1/study-rooms/:id/invite`: Host mời sinh viên theo MSSV.
- `GET /api/v1/study-rooms/invites/my`: Danh sách lời mời nhận được của sinh viên đang đăng nhập.
- `DELETE /api/v1/study-rooms/:id`: Host đóng phòng học.

### Nhắn tin trực tiếp 1-1:
- `GET /api/v1/chat/users/search?q=mssv_or_name`: Tìm kiếm sinh viên theo MSSV hoặc tên.
- `GET /api/v1/chat/conversations`: Danh sách các cuộc hội thoại 1-1 gần nhất.
- `GET /api/v1/chat/conversations/:id/messages`: Lịch sử tin nhắn giữa 2 sinh viên.
- `POST /api/v1/chat/conversations/:targetStudentId/messages`: Gửi tin nhắn mới.

---

## 5. Thiết kế Giao diện (UI/UX Specification)

### 5.1 Trang Phòng học chung (Study Rooms Dashboard)
- **Danh sách phòng**:
  - Thẻ phòng (Room card): Tên phòng, tên Host, số thành viên (`3/6`), biểu tượng ổ khóa (nếu có pass), badge trạng thái Pomodoro (`Đang tập trung: 18:24` hoặc `Nghỉ ngơi`).
  - Nút **"Tạo phòng mới"** (mở Modal cài đặt: Tên, Mô tả, Mật khẩu PIN 4 số, Giới hạn 2-8 người).
  - Nút **"Vào bằng mã PIN"**.
  - Khu vực hiển thị **"Lời mời vào phòng"** gửi đến sinh viên.

### 5.2 Không gian Tập trung trong phòng (Focus Room Canvas)
- **Đồng hồ Pomodoro ở trung tâm phía trên**:
  - Vòng tròn SVG đếm ngược phong cách hiện đại.
  - Chuông kết thúc phiên (Web Audio API âm thanh chuông Tây Tạng nhẹ nhàng, không giật mình).
  - Host có bảng điều khiển: [Bắt đầu 25p] [Nghỉ 5p] [Tạm dừng] [Cài đặt thời gian].
- **Lưới Video / Avatar (Responsive Grid)**:
  - 1 đến 8 ô hiển thị video (hoặc avatar nếu tắt cam) của các thành viên.
  - Mỗi ô có thanh trạng thái: Tên, MSSV, Icon Mic (màu đỏ nếu mute, sóng âm khi đang nói), và thẻ task: *"Luyện giải đề"* hoặc *"Làm báo cáo"*.
- **Thanh công cụ đáy phòng (Bottom Floating Bar)**:
  - [Mic ON/OFF] [Cam ON/OFF] [Chọn Task đang làm] [Nhạc nền Lofi / Mưa] [Mời bạn bè (Host)] [Rời phòng].
- **Cột chat bên phải**: Khung chat nội bộ phòng, hiển thị tin nhắn thời gian thực và icon reaction.

### 5.3 Trung tâm Tin nhắn Trực tiếp 1-1 (Direct Chat)
- Thanh tìm kiếm sinh viên bằng MSSV.
- Danh sách hội thoại bên trái, khung chat bên phải với bong bóng tin nhắn, thời gian gửi, và đánh dấu đã xem.

---

## 6. Kế hoạch Kiểm thử & Đảm bảo Chất lượng (Testing & Verification)
1. **Unit Tests**:
   - Kiểm tra logic bảo mật passcode phòng.
   - Kiểm tra giới hạn số người tham gia tối đa (`maxParticipants`).
   - Kiểm tra phân quyền Host (chỉ Host mới được điều khiển Pomodoro và cấu hình phòng).
2. **Integration Tests**:
   - Kiểm tra WebSocket connection, room joining và WebRTC signaling handshake.
   - Kiểm tra gửi/nhận tin nhắn chat 1-1 và tin nhắn phòng.
3. **Manual Verification**:
   - Mở 2 tab trình duyệt ẩn danh với 2 tài khoản sinh viên khác nhau.
   - Host tạo phòng có pass, mời sinh viên thứ 2.
   - Sinh viên thứ 2 vào phòng, kiểm tra kết nối Video/Mic, Pomodoro timer đếm ngược đồng bộ giữa 2 tab và chat tức thì.
