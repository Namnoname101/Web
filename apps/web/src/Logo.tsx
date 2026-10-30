import type { SVGProps } from 'react';

/**
 * SchedUED Official Logo (Option A):
 * Biểu trưng ngọn lửa tri thức trường ĐH Sư phạm - ĐH Đà Nẵng
 * được cách điệu thành chữ 'S' uyển chuyển trên nền cuốn sách mở.
 */
export function SchedUedIcon({ size = 24, className = '', ...props }: { size?: number } & SVGProps<SVGSVGElement>) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 100 100"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
      className={className}
      aria-hidden="true"
      {...props}
    >
      {/* Open Book Base (Tri thức UED) */}
      <path
        d="M 18 80 C 33 76, 45 80, 50 82 C 55 80, 67 76, 82 80 L 82 86 C 67 82, 55 86, 50 88 C 45 86, 33 82, 18 86 Z"
        fill="currentColor"
        fillOpacity="0.4"
      />
      <path
        d="M 18 73 C 33 69, 45 73, 50 75 C 55 73, 67 69, 82 73 L 82 79 C 67 75, 55 79, 50 81 C 45 79, 33 75, 18 79 Z"
        fill="currentColor"
      />

      {/* Flame Stylized as Letter 'S' (Ngọn lửa tri thức -> chữ S) */}
      <path
        d="M 69 22 C 54 20, 32 25, 32 44 C 32 59, 70 54, 70 70 C 70 79, 58 82, 44 79"
        stroke="#f59e0b"
        strokeWidth="9"
        strokeLinecap="round"
        fill="none"
      />
      {/* Core flame cyan accent */}
      <path
        d="M 60 26 C 48 24, 38 29, 38 41 C 38 48, 62 46, 62 62 C 62 70, 53 72, 46 72"
        stroke="#38bdf8"
        strokeWidth="3.5"
        strokeLinecap="round"
        fill="none"
      />
      {/* Top flame tip spark */}
      <circle cx="72" cy="20" r="3.5" fill="#f59e0b" />
    </svg>
  );
}

export function Brand({ subtitle }: { subtitle?: string }) {
  return (
    <div className="brand">
      <span className="brand-icon">
        <SchedUedIcon size={24} />
      </span>
      <span>
        Sched<span className="brand-accent">UED</span>
        <small>{subtitle || 'THỜI KHÓA BIỂU & KẾ HOẠCH HỌC TẬP'}</small>
      </span>
    </div>
  );
}
