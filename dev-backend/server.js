// PM2 필수 체크
if (process.env.pm_id === undefined) {
  console.error('This server must be run through PM2.');
  console.error('Usage: pm2 start ecosystem.config.js --only planq-dev-backend');
  process.exit(1);
}

// ROOT 실행 방지 — irene 유저로만 실행
if (process.getuid && process.getuid() === 0) {
  console.error('Do NOT run this server as root! Use irene user via PM2.');
  process.exit(1);
}

require('dotenv').config();

// JWT_SECRET 필수 체크
if (!process.env.JWT_SECRET) {
  console.error('JWT_SECRET environment variable is not set!');
  process.exit(1);
}

const express = require('express');
const http = require('http');
const jwt = require('jsonwebtoken');
const cookieParser = require('cookie-parser');
const { Server } = require('socket.io');
const { setupSecurity } = require('./middleware/security');
const { errorHandler } = require('./middleware/errorHandler');

const app = express();

// nginx 뒤에 있으므로 X-Forwarded-For 1 hop 만 신뢰.
// 설정 없으면 express-rate-limit 이 모든 요청을 nginx IP 로 식별하여 rate-limit 이 실질적으로 동작 안 함.
app.set('trust proxy', 1);

const server = http.createServer(app);

// Socket.IO with authentication
const allowedOrigins = (process.env.ALLOWED_ORIGINS || '').split(',').filter(Boolean);
const io = new Server(server, {
  cors: { origin: allowedOrigins, credentials: true }
});

// Socket.IO 인증 미들웨어
io.use((socket, next) => {
  const token = socket.handshake.auth?.token || socket.handshake.headers?.authorization?.split(' ')[1];
  if (!token) {
    return next(new Error('Authentication required'));
  }
  try {
    const decoded = jwt.verify(token, process.env.JWT_SECRET);
    socket.userId = decoded.userId || decoded.id;
    next();
  } catch (err) {
    return next(new Error('Invalid token'));
  }
});

// 조회 의존성 lazy-load (models/ 에서 Associations 설정 후 접근 보장)
const getModels = () => require('./models');

async function canJoinConversation(userId, conversationId) {
  const { Conversation, ConversationParticipant, BusinessMember } = getModels();
  const conv = await Conversation.findByPk(conversationId, { attributes: ['id', 'business_id'] });
  if (!conv) return false;
  // 1) 해당 워크스페이스 멤버
  const bm = await BusinessMember.findOne({
    where: { business_id: conv.business_id, user_id: userId },
    attributes: ['id'],
  });
  if (bm) return true;
  // 2) 그 대화방 참여자 (client 참여 케이스)
  const part = await ConversationParticipant.findOne({
    where: { conversation_id: conversationId, user_id: userId },
    attributes: ['id'],
  });
  return !!part;
}

async function canJoinProject(userId, projectId) {
  const { Project, ProjectClient, BusinessMember } = getModels();
  const proj = await Project.findByPk(projectId, { attributes: ['id', 'business_id'] });
  if (!proj) return false;
  const bm = await BusinessMember.findOne({
    where: { business_id: proj.business_id, user_id: userId },
    attributes: ['id'],
  });
  if (bm) return true;
  const pc = await ProjectClient.findOne({
    where: { project_id: projectId, contact_user_id: userId },
    attributes: ['id'],
  });
  return !!pc;
}

async function canJoinBusiness(userId, businessId) {
  const { BusinessMember } = getModels();
  const bm = await BusinessMember.findOne({
    where: { business_id: businessId, user_id: userId },
    attributes: ['id'],
  });
  return !!bm;
}

io.on('connection', (socket) => {
  // 대화방 room 참가 — 소유권 재검증 필수 (인증만으로는 부족)
  socket.on('join:conversation', async (conversationId) => {
    if (!conversationId) return;
    try {
      if (await canJoinConversation(socket.userId, conversationId)) {
        socket.join(`conv:${conversationId}`);
      }
    } catch (e) {
      console.warn('[socket] join:conversation check failed', e.message);
    }
  });

  socket.on('leave:conversation', (conversationId) => {
    if (conversationId) socket.leave(`conv:${conversationId}`);
  });

  socket.on('join:project', async (projectId) => {
    if (!projectId) return;
    try {
      if (await canJoinProject(socket.userId, projectId)) {
        socket.join(`project:${projectId}`);
      }
    } catch (e) {
      console.warn('[socket] join:project check failed', e.message);
    }
  });

  socket.on('leave:project', (projectId) => {
    if (projectId) socket.leave(`project:${projectId}`);
  });

  socket.on('join:business', async (businessId) => {
    if (!businessId) return;
    try {
      if (await canJoinBusiness(socket.userId, businessId)) {
        socket.join(`business:${businessId}`);
      }
    } catch (e) {
      console.warn('[socket] join:business check failed', e.message);
    }
  });
  socket.on('leave:business', (businessId) => {
    if (businessId) socket.leave(`business:${businessId}`);
  });

  socket.on('disconnect', () => {
    // 자동으로 모든 room에서 퇴장됨
  });
});

app.set('io', io);

// Body parser + Cookie parser — rate limiter skip 함수가 req.body 에 접근하므로 security 보다 먼저 파싱되어야 함
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true, limit: '10mb' }));
app.use(cookieParser());

// Security
setupSecurity(app);

// Health check
app.get('/api/health', (req, res) => {
  res.json({ status: 'ok', service: 'planq', timestamp: new Date().toISOString() });
});

// Load models (initializes associations)
require('./models');

// Routes
app.use('/api/auth', require('./routes/auth'));
app.use('/api/projects', require('./routes/projects'));
app.use('/api/projects', require('./routes/project_process'));
app.use('/api/users', require('./routes/users'));
app.use('/api/businesses', require('./routes/businesses'));
app.use('/api/notifications', require('./routes/notifications'));
app.use('/api/feedback', require('./routes/feedback'));
app.use('/api/cue', require('./routes/cue'));
app.use('/api/insights', require('./routes/insights'));
app.use('/api/push', require('./routes/push'));
app.use('/api/tasks', require('./routes/task_estimations'));
app.use('/api/clients', require('./routes/clients'));
app.use('/api/invites', require('./routes/invites'));
app.use('/api/conversations', require('./routes/conversations'));
app.use('/api/message-attachments', require('./routes/message_attachments'));
app.use('/api/tasks', require('./routes/tasks'));
app.use('/api/tasks', require('./routes/task_workflow'));
app.use('/api/tasks', require('./routes/task_attachments'));
app.use('/api/calendar', require('./routes/calendar'));
app.use('/api/dashboard', require('./routes/dashboard'));
app.use('/api/files', require('./routes/files'));
app.use('/api/folders', require('./routes/file_folders'));
app.use('/api/cloud', require('./routes/cloud'));
app.use('/api/plan', require('./routes/plan'));
app.use('/api/admin', require('./routes/admin'));
app.use('/api/posts', require('./routes/posts'));
app.use('/api/invoices', require('./routes/invoices'));
app.use('/api/docs', require('./routes/docs'));
// 서명 — /api/posts/:id/signatures, /api/signatures/:id, /api/sign/:token/* (공개)
app.use('/api', require('./routes/signatures'));
app.use('/api/inquiries', require('./routes/inquiries'));
app.use('/api', require('./routes/kb'));

// Error handler
app.use(errorHandler);

// Start server
const PORT = process.env.PORT || 3003;
server.listen(PORT, () => {
  console.log(`PlanQ server running on port ${PORT} (${process.env.NODE_ENV})`);
});

// 매일 00시(서버 로컬) — 업무 스냅샷 + 자체결제 cron (active→past_due→grace→demoted)
const taskSnapshot = require('./services/task_snapshot');
const billing = require('./services/billing');
function scheduleNextMidnight() {
  const now = new Date();
  const next = new Date(now); next.setDate(now.getDate() + 1); next.setHours(0, 0, 0, 0);
  const delay = next.getTime() - now.getTime();
  setTimeout(async () => {
    try {
      const r = await taskSnapshot.snapshotAllTasks();
      console.log('[daily-snapshot]', r);
    } catch (e) { console.warn('[daily-snapshot] failed', e.message); }
    try {
      const r = await billing.runDailyBillingCron();
      console.log('[billing-cron]', r);
    } catch (e) { console.warn('[billing-cron] failed', e.message); }
    scheduleNextMidnight();
  }, delay);
}
scheduleNextMidnight();

// Graceful shutdown
process.on('SIGTERM', () => {
  console.log('Shutting down...');
  server.close(() => process.exit(0));
});
