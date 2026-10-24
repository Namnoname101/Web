import { describe, expect, it, vi, beforeEach } from 'vitest';
import {
  createStudyRoom,
  joinStudyRoom,
  inviteStudentToRoom,
  closeStudyRoom,
  listActiveStudyRooms,
  getStudyRoomDetails
} from '../../src/modules/study-rooms/study-rooms.service.js';
import { ApiError } from '../../src/lib/errors.js';

vi.mock('@personal-schedule/database', () => {
  const mDb = {
    studyRoom: {
      create: vi.fn(),
      findUnique: vi.fn(),
      findMany: vi.fn(),
      update: vi.fn(),
    },
    studyRoomParticipant: {
      create: vi.fn(),
      findUnique: vi.fn(),
      findMany: vi.fn(),
      upsert: vi.fn(),
      delete: vi.fn(),
    },
    studyRoomInvite: {
      create: vi.fn(),
      findMany: vi.fn(),
      update: vi.fn(),
    },
    user: {
      findUnique: vi.fn(),
    },
  };
  return {
    getPrismaClient: () => mDb,
  };
});

import { getPrismaClient } from '@personal-schedule/database';

describe('Study Rooms Service', () => {
  const db = getPrismaClient() as any;

  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('createStudyRoom', () => {
    it('creates a study room and adds creator as host participant', async () => {
      const mockRoom = {
        id: 'room-1',
        title: 'Ôn thi An toàn thông tin',
        description: 'Cùng làm bài tập',
        passcode: '1234',
        maxParticipants: 6,
        hostId: 'user-1',
        pomodoroState: 'IDLE',
        focusMinutes: 25,
        breakMinutes: 5,
        isClosed: false,
      };

      db.studyRoom.create.mockResolvedValue(mockRoom);
      db.studyRoomParticipant.upsert.mockResolvedValue({
        id: 'part-1',
        roomId: 'room-1',
        userId: 'user-1',
      });

      const result = await createStudyRoom('user-1', {
        title: 'Ôn thi An toàn thông tin',
        description: 'Cùng làm bài tập',
        passcode: '1234',
        maxParticipants: 6,
        focusMinutes: 25,
        breakMinutes: 5,
      });

      expect(result.id).toBe('room-1');
      expect(result.hostId).toBe('user-1');
      expect(db.studyRoom.create).toHaveBeenCalled();
    });

    it('rejects invalid room capacity (less than 2 or more than 8)', async () => {
      await expect(createStudyRoom('user-1', {
        title: 'Test Room',
        maxParticipants: 10,
      })).rejects.toThrow(ApiError);
    });
  });

  describe('joinStudyRoom', () => {
    it('rejects join when passcode is incorrect', async () => {
      db.studyRoom.findUnique.mockResolvedValue({
        id: 'room-1',
        passcode: '9999',
        isClosed: false,
        maxParticipants: 6,
        participants: [],
      });

      await expect(joinStudyRoom('user-2', 'room-1', '0000')).rejects.toThrow('INVALID_PASSCODE');
    });

    it('rejects join when room is full', async () => {
      db.studyRoom.findUnique.mockResolvedValue({
        id: 'room-1',
        passcode: null,
        isClosed: false,
        maxParticipants: 2,
        participants: [
          { userId: 'user-1' },
          { userId: 'user-2' },
        ],
      });

      await expect(joinStudyRoom('user-3', 'room-1')).rejects.toThrow('ROOM_FULL');
    });

    it('succeeds and registers participant when passcode matches', async () => {
      db.studyRoom.findUnique.mockResolvedValue({
        id: 'room-1',
        passcode: '1234',
        isClosed: false,
        maxParticipants: 6,
        participants: [{ userId: 'user-1' }],
      });
      db.studyRoomParticipant.upsert.mockResolvedValue({
        id: 'part-2',
        roomId: 'room-1',
        userId: 'user-2',
        currentTask: 'Giải đề',
      });

      const res = await joinStudyRoom('user-2', 'room-1', '1234', 'Giải đề');
      expect(res.participant.userId).toBe('user-2');
    });
  });

  describe('inviteStudentToRoom', () => {
    it('only allows the host to send room invites', async () => {
      db.studyRoom.findUnique.mockResolvedValue({
        id: 'room-1',
        hostId: 'user-1',
        isClosed: false,
      });

      await expect(inviteStudentToRoom('user-2', 'room-1', '3120224099')).rejects.toThrow('FORBIDDEN');
    });

    it('throws if invited student does not exist', async () => {
      db.studyRoom.findUnique.mockResolvedValue({
        id: 'room-1',
        hostId: 'user-1',
        isClosed: false,
      });
      db.user.findUnique.mockResolvedValue(null);

      await expect(inviteStudentToRoom('user-1', 'room-1', '3120224099')).rejects.toThrow('STUDENT_NOT_FOUND');
    });

    it('creates invite when student exists', async () => {
      db.studyRoom.findUnique.mockResolvedValue({
        id: 'room-1',
        hostId: 'user-1',
        isClosed: false,
      });
      db.user.findUnique.mockResolvedValue({
        id: 'user-target',
        studentId: '3120224099',
        name: 'Nguyen Van A',
      });
      db.studyRoomInvite.create.mockResolvedValue({
        id: 'inv-1',
        roomId: 'room-1',
        targetStudentId: '3120224099',
        status: 'PENDING',
      });

      const res = await inviteStudentToRoom('user-1', 'room-1', '3120224099');
      expect(res.targetStudentId).toBe('3120224099');
      expect(res.status).toBe('PENDING');
    });
  });

  describe('closeStudyRoom', () => {
    it('only host can close room', async () => {
      db.studyRoom.findUnique.mockResolvedValue({
        id: 'room-1',
        hostId: 'user-1',
      });

      await expect(closeStudyRoom('user-2', 'room-1')).rejects.toThrow('FORBIDDEN');
    });

    it('marks room as closed', async () => {
      db.studyRoom.findUnique.mockResolvedValue({
        id: 'room-1',
        hostId: 'user-1',
      });
      db.studyRoom.update.mockResolvedValue({
        id: 'room-1',
        isClosed: true,
      });

      await closeStudyRoom('user-1', 'room-1');
      expect(db.studyRoom.update).toHaveBeenCalledWith(expect.objectContaining({
        where: { id: 'room-1' },
        data: expect.objectContaining({ isClosed: true }),
      }));
    });
  });
});
