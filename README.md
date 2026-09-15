<p align="center">
  <img src="https://img.shields.io/badge/stack-React%20%2B%20Express%20%2B%20PostgreSQL-4CAF50?style=flat-square" />
  <img src="https://img.shields.io/github/actions/workflow/status/Namnoname101/Web/pages.yml?style=flat-square&label=deploy" />
  <img src="https://img.shields.io/badge/license-MIT-blue?style=flat-square" />
</p>

# unirhy**thm**

Ứng dụng quản lý lịch học cá nhân dành cho sinh viên UED. Tự động kéo thời khóa biểu từ cổng thông tin trường về, rồi xếp lịch học/làm bài xung quanh những buổi học đó. Mọi thứ planner gợi ý — bạn chọn chấp nhận hay bỏ qua.

*A personal schedule manager for UED students. It pulls your timetable from the university portal, then fits your study sessions around it. Everything the planner suggests, you decide.*

**→ [Xem demo / Live preview](https://namnoname101.github.io/Web/)**

---

## Nó làm được gì

- Đăng nhập bằng mã sinh viên UED, không lưu mật khẩu
- Nhập thời khóa biểu học kỳ hiện tại (hoặc học kỳ khác tự chọn)
- Planner tự tính: giờ hoạt động, giờ nghỉ, deadline, ưu tiên, thời gian di chuyển
- Đề xuất lịch học → sinh viên accept hoặc reject từng cái
- Đồng bộ email Outlook để bắt thay đổi lịch từ trường
- Giao diện Việt/Anh, chạy được trên điện thoại

## Stack

```
Frontend   React 19 + TailwindCSS + Vite
Backend    Express + TypeScript
Database   PostgreSQL + Prisma
Auth       UED session  ·  Microsoft OAuth PKCE
Test       Vitest + Playwright  (144 unit · 15 integration · 3 E2E)
```

## Chạy local

```bash
# 1. Clone và cài
git clone https://github.com/Namnoname101/Web.git
cd Web
cp .env.example .env

# Sinh encryption key rồi dán vào .env
node -e "console.log(require('crypto').randomBytes(32).toString('base64'))"

# 2. Khởi động database
docker compose up -d postgres

# 3. Setup
npm run setup
npm run db:generate
npm run db:migrate

# 4. Chạy (3 terminal)
npm run dev:api       # → localhost:3000
npm run dev:worker
npm run dev:web       # → localhost:5173
```

## Test

```bash
npm test                   # unit tests
npm run test:integration   # integration tests
npm run test:e2e           # browser tests (Playwright)
npm run typecheck
npm run build
```

Tất cả test dùng database `_test` riêng, không đụng dữ liệu thật.

## Tiến độ

| | |
|---|---|
| ✅ Nền tảng API + Database | ✅ Planner + đề xuất |
| ✅ Giao diện đầy đủ Việt/Anh | ✅ UED login + nhập thời khóa biểu |
| 🔄 Outlook OAuth (cần app registration thật) | 🔄 Deploy production (cần server) |

Chi tiết: [`docs/PROGRESS.md`](docs/PROGRESS.md) · API contract: [`docs/API.md`](docs/API.md)

## Deploy

Frontend tự động lên GitHub Pages mỗi khi push vào `main`.

Backend cần server riêng — xem [`docs/DEPLOYMENT.md`](docs/DEPLOYMENT.md) để biết cách deploy lên Railway hoặc Fly.io. Config Railway có sẵn ở `.railway/`, Dockerfile có ở root.

---

Làm bởi **Daitruong** — sinh viên UED, Đại học Đà Nẵng.
