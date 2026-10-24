import { Router } from 'express';
import { z } from 'zod';
import {
  createStudyRoom,
  joinStudyRoom,
  leaveStudyRoom,
  inviteStudentToRoom,
  getMyInvites,
  closeStudyRoom,
  listActiveStudyRooms,
  getStudyRoomDetails,
} from './study-rooms.service.js';
import { ApiError } from '../../lib/errors.js';

export const studyRoomsRouter = Router();

const createRoomSchema = z.object({
  title: z.string().min(1).max(120),
  description: z.string().max(255).optional(),
  passcode: z.string().max(32).optional(),
  maxParticipants: z.number().int().min(2).max(8).default(6),
  focusMinutes: z.number().int().min(10).max(60).default(25),
  breakMinutes: z.number().int().min(1).max(30).default(5),
}).strict();

const joinRoomSchema = z.object({
  passcode: z.string().max(32).optional(),
  currentTask: z.string().max(120).optional(),
}).strict();

const inviteSchema = z.object({
  targetStudentId: z.string().trim().min(3).max(64),
}).strict();

studyRoomsRouter.get('/study-rooms', async (_req, res) => {
  res.json(await listActiveStudyRooms());
});

studyRoomsRouter.get('/study-rooms/invites/my', async (req, res) => {
  if (!req.user) throw new ApiError(401, 'AUTH_REQUIRED');
  res.json(await getMyInvites(req.user.studentId));
});

studyRoomsRouter.get('/study-rooms/:id', async (req, res) => {
  const roomId = req.params.id;
  res.json(await getStudyRoomDetails(roomId));
});

studyRoomsRouter.post('/study-rooms', async (req, res) => {
  if (!req.user) throw new ApiError(401, 'AUTH_REQUIRED');
  const input = createRoomSchema.parse(req.body);
  const room = await createStudyRoom(req.user.id, input);
  res.status(201).json(room);
});

studyRoomsRouter.post('/study-rooms/:id/join', async (req, res) => {
  if (!req.user) throw new ApiError(401, 'AUTH_REQUIRED');
  const roomId = req.params.id;
  const input = joinRoomSchema.parse(req.body);
  const result = await joinStudyRoom(req.user.id, roomId, input.passcode, input.currentTask);
  res.json(result);
});

studyRoomsRouter.post('/study-rooms/:id/leave', async (req, res) => {
  if (!req.user) throw new ApiError(401, 'AUTH_REQUIRED');
  const roomId = req.params.id;
  await leaveStudyRoom(req.user.id, roomId);
  res.json({ success: true });
});

studyRoomsRouter.post('/study-rooms/:id/invite', async (req, res) => {
  if (!req.user) throw new ApiError(401, 'AUTH_REQUIRED');
  const roomId = req.params.id;
  const input = inviteSchema.parse(req.body);
  const invite = await inviteStudentToRoom(req.user.id, roomId, input.targetStudentId);
  res.status(201).json(invite);
});

studyRoomsRouter.delete('/study-rooms/:id', async (req, res) => {
  if (!req.user) throw new ApiError(401, 'AUTH_REQUIRED');
  const roomId = req.params.id;
  await closeStudyRoom(req.user.id, roomId);
  res.json({ success: true });
});
