<div align="center">

# 🎓 unirhy**thm**
### Personal Automated Schedule for Students
### Lịch học thông minh dành cho sinh viên

<br/>

[![Live Demo](https://img.shields.io/badge/🌐_Live_Demo-namnoname101.github.io/Web-4CAF50?style=for-the-badge)](https://namnoname101.github.io/Web/)
[![GitHub Actions](https://img.shields.io/github/actions/workflow/status/Namnoname101/Web/pages.yml?style=for-the-badge&label=Deploy&logo=github)](https://github.com/Namnoname101/Web/actions)
[![License](https://img.shields.io/badge/License-MIT-blue?style=for-the-badge)](LICENSE)

<br/>

> **🇻🇳 Tiếng Việt** | **🇬🇧 English**

*Một ứng dụng lên lịch thế hệ mới dành riêng cho sinh viên UED — tự động nhập thời khóa biểu, xếp lịch thông minh, và luôn để bạn là người quyết định.*

*A next-generation scheduling app built for UED students — automatically imports timetables, plans your study sessions, and always keeps you in control.*

</div>

---

## ✨ Tính năng nổi bật / Key Features

| 🇻🇳 | 🇬🇧 |
|-----|-----|
| 📅 Nhập thời khóa biểu UED tự động, chính xác từng tiết | 📅 Automatic UED timetable import with exact period mapping |
| 🤖 Planner AI xếp lịch học theo giờ hoạt động, deadline, ưu tiên | 🤖 Smart planner schedules tasks around active hours, deadlines & priorities |
| 📬 Đồng bộ email Outlook để nhận thay đổi lịch từ trường | 📬 Outlook integration to catch schedule changes via school email |
| ✅ Mọi thay đổi đều là **gợi ý** — sinh viên chấp nhận hoặc từ chối | ✅ All changes are **suggestions** — you accept or reject every one |
| 🌐 Giao diện song ngữ Việt/Anh, responsive mobile | 🌐 Full Vietnamese/English UI, mobile responsive |
| 🔒 Mật khẩu UED không bao giờ được lưu lại | 🔒 UED password is **never stored** |
| 🌙 Lịch trình trong ngày theo múi giờ thực tế | 🌙 Timezone-aware daily agenda with past/current/upcoming states |

---

## 🖼️ Giao diện / Screenshots

<div align="center">

> 📸 *Truy cập [Live Demo](https://namnoname101.github.io/Web/) để xem trực tiếp giao diện ứng dụng.*
>
> *Visit the [Live Demo](https://namnoname101.github.io/Web/) to see the app in action.*

</div>

---

## 🏗️ Kiến trúc / Architecture

```
unirhy thm/
├── apps/
│   ├── web/          # React 19 + TailwindCSS — Giao diện người dùng
│   └── api/          # Express + TypeScript — API Server & Background Worker
├── packages/
│   ├── database/     # Prisma ORM + PostgreSQL — Schema & Migrations
│   └── shared/       # DTOs, Schemas, Types dùng chung
├── tests/
│   └── e2e/          # Playwright — Kiểm thử End-to-End
└── docs/             # Tài liệu yêu cầu, API, triển khai
```

### 🔧 Công nghệ / Tech Stack

<div align="center">

| Layer | Technology |
|-------|-----------|
| **Frontend** | React 19, TailwindCSS, TypeScript, Vite |
| **Backend** | Express.js, TypeScript, Node.js |
| **Database** | PostgreSQL, Prisma ORM |
| **Auth** | Session-based (UED), Microsoft OAuth PKCE |
| **Testing** | Vitest, Playwright |
| **Deploy** | Docker, Railway, GitHub Pages |

</div>

---

## 🚀 Cài đặt & Chạy Local / Local Setup

### Yêu cầu / Prerequisites
- Node.js 20+
- PostgreSQL (hoặc Docker)

### Các bước / Steps

```bash
# 1. Clone project
git clone https://github.com/Namnoname101/Web.git
cd Web

# 2. Tạo file môi trường / Create environment file
cp .env.example .env
# Sinh khóa mã hóa / Generate encryption key:
node -e "console.log(require('crypto').randomBytes(32).toString('base64'))"
# Dán vào .env / Paste into .env

# 3. Khởi động PostgreSQL
docker compose up -d postgres
# hoặc / or: npm run db:local   (Windows local PostgreSQL)

# 4. Cài đặt & migrate database
npm run setup
npm run db:generate
npm run db:migrate

# 5. Chạy ứng dụng (3 terminal riêng biệt / 3 separate terminals)
npm run dev:api       # API Server  → http://localhost:3000
npm run dev:worker    # Background Worker
npm run dev:web       # Frontend   → http://localhost:5173
```

---

## 🧪 Kiểm thử / Testing

```bash
npm test                  # Unit tests (144 tests)
npm run test:integration  # Integration tests (15 tests)
npm run test:e2e          # Browser E2E tests (Playwright)
npm run typecheck         # TypeScript type check toàn monorepo
npm run build             # Production build
```

> ✅ Toàn bộ test chạy trên database `_test` độc lập — không bao giờ dùng dữ liệu thật của sinh viên.
>
> ✅ All tests run on an isolated `_test` database — never touching real student records.

---

## 📊 Tiến độ / Progress

| Milestone | 🇻🇳 Mô tả | 🇬🇧 Description | Status |
|-----------|-----------|----------------|--------|
| **M0** | Phạm vi & kiến trúc | Scope & architecture | ✅ Done |
| **M1** | Nền tảng dữ liệu & API | Data foundation & CRUD APIs | ✅ Done |
| **M2** | Xếp lịch & đề xuất | Auto-planner & suggestions | ✅ Done |
| **M3** | Giao diện hoàn chỉnh | Full responsive UI | ✅ Done |
| **M4** | Đồng bộ Outlook thật | Real Outlook OAuth & sync | 🔄 Needs app registration |
| **M5** | UED đầy đủ | Full UED integration | 🔄 Needs smoke on past term |
| **M6** | Phát hành | Production release | 🔄 Needs Docker smoke & deploy |

> Chi tiết xem tại / See details at: [`docs/PROGRESS.md`](docs/PROGRESS.md)

---

## 🔐 Bảo mật / Security

- 🔒 **Mật khẩu UED không bao giờ được lưu lại** — chỉ dùng session token mã hóa
- 🔑 **Microsoft refresh token** được mã hóa AES-256-GCM trước khi lưu vào database
- 👤 Mọi API đều giới hạn theo người dùng — không thể xem dữ liệu của người khác
- 🚫 Không có dữ liệu sinh viên thật trong code, test fixtures hay tài liệu

<br/>

- 🔒 **UED password is never stored** — only encrypted session tokens
- 🔑 **Microsoft refresh tokens** are AES-256-GCM encrypted before storage
- 👤 All APIs are user-scoped — no cross-user data access
- 🚫 No real student data in code, test fixtures, or documentation

---

## 🌐 Deploy / Deployment

### GitHub Pages (Frontend Demo)
Frontend được tự động deploy lên GitHub Pages qua GitHub Actions khi push lên nhánh `main`.

*Frontend is automatically deployed to GitHub Pages via GitHub Actions on every push to `main`.*

```
🌐 https://namnoname101.github.io/Web/
```

### Production (Full Stack)
Xem hướng dẫn chi tiết tại / See full guide at: [`docs/DEPLOYMENT.md`](docs/DEPLOYMENT.md)

- **Railway**: IaC config có sẵn tại `.railway/`
- **Fly.io**: Dockerfile có sẵn tại root
- Cần cấu hình: `DATABASE_URL`, `ENCRYPTION_KEY`, `SESSION_SECRET`

---

## 📁 Tài liệu / Documentation

| Tài liệu | Mô tả |
|---------|-------|
| [`docs/API.md`](docs/API.md) | Toàn bộ route contract của API |
| [`docs/PROGRESS.md`](docs/PROGRESS.md) | Chi tiết tiến độ từng milestone |
| [`docs/DEPLOYMENT.md`](docs/DEPLOYMENT.md) | Hướng dẫn deploy Railway/Fly |
| [`docs/REQUIREMENTS.md`](docs/REQUIREMENTS.md) | Yêu cầu chức năng gốc |
| [`docs/UED.md`](docs/UED.md) | Ghi chú tích hợp UED |

---

## 🧑‍💻 Tác giả / Author

<div align="center">

**Sinh viên UED — Đại học Sư phạm · Đại học Đà Nẵng**

*"Small steps. A meaningful journey."*

*"Từng bước nhỏ. Một hành trình ý nghĩa."*

<br/>

[![GitHub](https://img.shields.io/badge/GitHub-Namnoname101-181717?style=for-the-badge&logo=github)](https://github.com/Namnoname101)

</div>

---

<div align="center">
<sub>Built with ❤️ for UED students · Được xây dựng với ❤️ dành cho sinh viên UED</sub>
</div>
