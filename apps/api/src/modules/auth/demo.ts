import { randomUUID } from 'node:crypto';
import { getPrismaClient } from '@personal-schedule/database';
import { formatInTimeZone, fromZonedTime } from 'date-fns-tz';

export async function createDemoStudent() {
  const db = getPrismaClient();
  const user = await db.user.create({ data: { email: `demo-${randomUUID()}@example.invalid`, name: 'Sinh viên UED', isDemo: true, studyLocation: 'Thư viện' } });
  const key = formatInTimeZone(new Date(), user.timezone, 'yyyy-MM-dd');
  const day = (offset: number) => new Date(Date.parse(`${key}T12:00:00Z`) + offset * 86_400_000).toISOString().slice(0, 10);
  const at = (offset: number, time: string) => fromZonedTime(`${day(offset)}T${time}:00`, user.timezone);
  await db.event.createMany({ data: [
    { userId: user.id, title: 'Phương pháp nghiên cứu khoa học', startTime: at(1, '07:30'), endTime: at(1, '09:30'), location: 'A5.203', eventType: 'CLASS' },
    { userId: user.id, title: 'Tâm lý học giáo dục', startTime: at(2, '09:00'), endTime: at(2, '11:00'), location: 'B2.102', eventType: 'CLASS' },
    { userId: user.id, title: 'Họp nhóm đồ án', startTime: at(1, '14:00'), endTime: at(1, '15:00'), location: 'Thư viện', eventType: 'PERSONAL' },
    { userId: user.id, title: 'Tiếng Anh chuyên ngành', startTime: at(3, '13:00'), endTime: at(3, '15:00'), location: 'A2.301', eventType: 'CLASS' },
  ] });
  await db.task.createMany({ data: [
    { userId: user.id, title: 'Hoàn thiện đề cương đồ án', durationMinutes: 120, deadline: at(2, '21:00'), priority: 'HIGH', notes: 'Tổng hợp mục tiêu, phạm vi và phương pháp nghiên cứu.' },
    { userId: user.id, title: 'Ôn tập Tâm lý học', durationMinutes: 60, deadline: at(3, '20:00'), priority: 'MEDIUM' },
    { userId: user.id, title: 'Đọc tài liệu tiếng Anh', durationMinutes: 45, deadline: at(5, '21:00'), priority: 'LOW' },
    { userId: user.id, title: 'Chuẩn bị slide thuyết trình', durationMinutes: 90, deadline: at(4, '17:00'), priority: 'MEDIUM', isSplittable: false },
  ] });
  await db.notification.create({ data: { userId: user.id, titleVi: 'Chào mừng đến UED Planner', titleEn: 'Welcome to UED Planner', bodyVi: 'Đây là dữ liệu minh họa riêng của bạn. Thử tạo đề xuất và xác nhận để xem lịch thay đổi.', bodyEn: 'This is your isolated demo data. Generate and accept a suggestion to see your calendar update.' } });
  return user;
}
