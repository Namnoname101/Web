import { Router } from 'express';
import { z } from 'zod';
import {
  searchStudents,
  getOrCreateConversation,
  sendDirectMessage,
  getConversationMessages,
  listUserConversations,
} from './chat.service.js';
import { ApiError } from '../../lib/errors.js';

export const chatRouter = Router();

const startConversationSchema = z.object({
  targetUserId: z.string().uuid(),
}).strict();

const sendMessageSchema = z.object({
  content: z.string().min(1).max(2000),
}).strict();

// Tìm kiếm sinh viên
chatRouter.get('/chat/students/search', async (req, res) => {
  if (!req.user) throw new ApiError(401, 'AUTH_REQUIRED');
  const q = String(req.query.q || '');
  const students = await searchStudents(q, req.user.id);
  res.json(students);
});

// Lấy danh sách hội thoại của sinh viên hiện tại
chatRouter.get('/chat/conversations', async (req, res) => {
  if (!req.user) throw new ApiError(401, 'AUTH_REQUIRED');
  const convs = await listUserConversations(req.user.id);
  res.json(convs);
});

// Mở hoặc tạo hội thoại với một sinh viên
chatRouter.post('/chat/conversations', async (req, res) => {
  if (!req.user) throw new ApiError(401, 'AUTH_REQUIRED');
  const parsed = startConversationSchema.safeParse(req.body);
  if (!parsed.success) throw new ApiError(400, 'INVALID_INPUT', 'targetUserId không hợp lệ');

  const conv = await getOrCreateConversation(req.user.id, parsed.data.targetUserId);
  res.json(conv);
});

// Lấy tin nhắn của một cuộc hội thoại
chatRouter.get('/chat/conversations/:id/messages', async (req, res) => {
  if (!req.user) throw new ApiError(401, 'AUTH_REQUIRED');
  const convId = req.params.id;
  const messages = await getConversationMessages(req.user.id, convId);
  res.json(messages);
});

// Gửi tin nhắn trực tiếp
chatRouter.post('/chat/conversations/:id/messages', async (req, res) => {
  if (!req.user) throw new ApiError(401, 'AUTH_REQUIRED');
  const convId = req.params.id;
  const parsed = sendMessageSchema.safeParse(req.body);
  if (!parsed.success) throw new ApiError(400, 'INVALID_INPUT', 'Nội dung tin nhắn không hợp lệ');

  const message = await sendDirectMessage(req.user.id, convId, parsed.data.content);
  res.status(201).json(message);
});
