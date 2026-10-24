import { getPrismaClient } from '@personal-schedule/database';
import { ApiError } from '../../lib/errors.js';

export interface CreateStudyRoomInput {
  title: string;
  description?: string;
  passcode?: string;
  maxParticipants?: number;
  focusMinutes?: number;
  breakMinutes?: number;
}

export async function createStudyRoom(userId: string, data: CreateStudyRoomInput) {
  const db = getPrismaClient();

  const title = (data.title || '').trim();
  if (!title || title.length > 120) {
    throw new ApiError(400, 'INVALID_ROOM_TITLE', 'Tiêu đề phòng phải từ 1 đến 120 ký tự');
  }

  const maxParticipants = data.maxParticipants ?? 6;
  if (maxParticipants < 2 || maxParticipants > 8) {
    throw new ApiError(400, 'INVALID_CAPACITY', 'Số lượng người tham gia phải từ 2 đến 8');
  }

  const focusMinutes = data.focusMinutes ?? 25;
  const breakMinutes = data.breakMinutes ?? 5;
  const passcode = data.passcode?.trim() || null;

  const room = await db.studyRoom.create({
    data: {
      title,
      description: data.description?.trim() || null,
      passcode,
      maxParticipants,
      focusMinutes,
      breakMinutes,
      hostId: userId,
      pomodoroState: 'IDLE',
    },
  });

  // Creator joins as first participant
  await db.studyRoomParticipant.upsert({
    where: {
      roomId_userId: {
        roomId: room.id,
        userId,
      },
    },
    create: {
      roomId: room.id,
      userId,
      isCamOn: false,
      isMicOn: false,
    },
    update: {
      lastSeenAt: new Date(),
    },
  });

  return room;
}

export async function joinStudyRoom(userId: string, roomId: string, passcode?: string, currentTask?: string) {
  const db = getPrismaClient();

  const room = await db.studyRoom.findUnique({
    where: { id: roomId },
    include: {
      participants: true,
      host: {
        select: { id: true, name: true, studentId: true },
      },
    },
  });

  if (!room || room.isClosed) {
    throw new ApiError(404, 'ROOM_NOT_FOUND', 'Phòng học không tồn tại hoặc đã đóng');
  }

  // Check passcode if room is locked and user is not host
  if (room.passcode && room.hostId !== userId) {
    if (!passcode || passcode.trim() !== room.passcode) {
      throw new ApiError(403, 'INVALID_PASSCODE');
    }
  }

  const alreadyJoined = room.participants.some(p => p.userId === userId);
  if (!alreadyJoined && room.participants.length >= room.maxParticipants) {
    throw new ApiError(409, 'ROOM_FULL');
  }

  const participant = await db.studyRoomParticipant.upsert({
    where: {
      roomId_userId: {
        roomId: room.id,
        userId,
      },
    },
    create: {
      roomId: room.id,
      userId,
      currentTask: currentTask?.trim() || null,
      isCamOn: false,
      isMicOn: false,
    },
    update: {
      currentTask: currentTask !== undefined ? currentTask.trim() || null : undefined,
      lastSeenAt: new Date(),
    },
  });

  return { room, participant };
}

export async function leaveStudyRoom(userId: string, roomId: string) {
  const db = getPrismaClient();

  await db.studyRoomParticipant.deleteMany({
    where: {
      roomId,
      userId,
    },
  });

  const remaining = await db.studyRoomParticipant.findMany({
    where: { roomId },
    orderBy: { joinedAt: 'asc' },
  });

  const room = await db.studyRoom.findUnique({ where: { id: roomId } });
  if (room && room.hostId === userId) {
    if (remaining.length > 0) {
      // Transfer host to oldest remaining participant
      await db.studyRoom.update({
        where: { id: roomId },
        data: { hostId: remaining[0].userId },
      });
    } else {
      // Auto close empty room
      await db.studyRoom.update({
        where: { id: roomId },
        data: { isClosed: true, pomodoroState: 'IDLE', timerEndsAt: null },
      });
    }
  }
}

export async function inviteStudentToRoom(userId: string, roomId: string, targetStudentId: string) {
  const db = getPrismaClient();

  const room = await db.studyRoom.findUnique({ where: { id: roomId } });
  if (!room || room.isClosed) {
    throw new ApiError(404, 'ROOM_NOT_FOUND', 'Phòng học không tồn tại');
  }

  if (room.hostId !== userId) {
    throw new ApiError(403, 'FORBIDDEN');
  }

  const student = await db.user.findUnique({
    where: { studentId: targetStudentId.trim() },
  });

  if (!student) {
    throw new ApiError(404, 'STUDENT_NOT_FOUND');
  }

  return await db.studyRoomInvite.create({
    data: {
      roomId,
      invitedByUserId: userId,
      targetStudentId: targetStudentId.trim(),
      status: 'PENDING',
    },
  });
}

export async function getMyInvites(studentId?: string | null) {
  if (!studentId) return [];
  const db = getPrismaClient();

  return await db.studyRoomInvite.findMany({
    where: {
      targetStudentId: studentId,
      status: 'PENDING',
      room: { isClosed: false },
    },
    include: {
      room: {
        select: {
          id: true,
          title: true,
          description: true,
          passcode: true,
          maxParticipants: true,
          host: { select: { id: true, name: true, studentId: true } },
          participants: { select: { id: true } },
        },
      },
      inviter: {
        select: { id: true, name: true, studentId: true },
      },
    },
    orderBy: { createdAt: 'desc' },
  });
}

export async function closeStudyRoom(userId: string, roomId: string) {
  const db = getPrismaClient();

  const room = await db.studyRoom.findUnique({ where: { id: roomId } });
  if (!room) throw new ApiError(404, 'ROOM_NOT_FOUND');

  if (room.hostId !== userId) {
    throw new ApiError(403, 'FORBIDDEN');
  }

  await db.studyRoom.update({
    where: { id: roomId },
    data: {
      isClosed: true,
      pomodoroState: 'IDLE',
      timerEndsAt: null,
    },
  });
}

export async function listActiveStudyRooms() {
  const db = getPrismaClient();

  const rooms = await db.studyRoom.findMany({
    where: { isClosed: false },
    include: {
      host: { select: { id: true, name: true, studentId: true } },
      participants: {
        include: {
          user: { select: { id: true, name: true, studentId: true } },
        },
      },
    },
    orderBy: { createdAt: 'desc' },
    take: 50,
  });

  return rooms.map(room => ({
    id: room.id,
    title: room.title,
    description: room.description,
    hasPasscode: !!room.passcode,
    maxParticipants: room.maxParticipants,
    participantCount: room.participants.length,
    participants: room.participants.map(p => ({
      userId: p.userId,
      name: p.user.name,
      studentId: p.user.studentId,
      currentTask: p.currentTask,
      isCamOn: p.isCamOn,
      isMicOn: p.isMicOn,
    })),
    host: room.host,
    pomodoroState: room.pomodoroState,
    focusMinutes: room.focusMinutes,
    breakMinutes: room.breakMinutes,
    timerEndsAt: room.timerEndsAt,
    createdAt: room.createdAt,
  }));
}

export async function getStudyRoomDetails(roomId: string) {
  const db = getPrismaClient();

  const room = await db.studyRoom.findUnique({
    where: { id: roomId },
    include: {
      host: { select: { id: true, name: true, studentId: true } },
      participants: {
        include: {
          user: { select: { id: true, name: true, studentId: true } },
        },
      },
      messages: {
        include: {
          sender: { select: { id: true, name: true, studentId: true } },
        },
        orderBy: { createdAt: 'asc' },
        take: 100,
      },
    },
  });

  if (!room || room.isClosed) {
    throw new ApiError(404, 'ROOM_NOT_FOUND', 'Phòng học không tồn tại hoặc đã đóng');
  }

  return {
    ...room,
    hasPasscode: !!room.passcode,
    passcode: undefined, // Don't expose passcode in public details
  };
}
