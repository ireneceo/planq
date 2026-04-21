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

io.on('connection', (socket) => {
  // 대화방 room 참가
  socket.on('join:conversation', (conversationId) => {
    if (conversationId) {
      socket.join(`conv:${conversationId}`);
    }
  });

  // 대화방 room 퇴장
  socket.on('leave:conversation', (conversationId) => {
    if (conversationId) {
      socket.leave(`conv:${conversationId}`);
    }
  });

  // 프로젝트 room 참가
  socket.on('join:project', (projectId) => {
    if (projectId) {
      socket.join(`project:${projectId}`);
    }
  });

  socket.on('leave:project', (projectId) => {
    if (projectId) {
      socket.leave(`project:${projectId}`);
    }
  });

  // 워크스페이스 room 참가 — Q Task 같은 전역 뷰가 사용
  socket.on('join:business', (businessId) => {
    if (businessId) socket.join(`business:${businessId}`);
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
app.use('/api/clients', require('./routes/clients'));
app.use('/api/conversations', require('./routes/conversations'));
app.use('/api/tasks', require('./routes/tasks'));
app.use('/api/tasks', require('./routes/task_workflow'));
app.use('/api/tasks', require('./routes/task_attachments'));
app.use('/api/calendar', require('./routes/calendar'));
app.use('/api/files', require('./routes/files'));
app.use('/api/folders', require('./routes/file_folders'));
app.use('/api/invoices', require('./routes/invoices'));
app.use('/api', require('./routes/kb'));

// Error handler
app.use(errorHandler);

// Start server
const PORT = process.env.PORT || 3003;
server.listen(PORT, () => {
  console.log(`PlanQ server running on port ${PORT} (${process.env.NODE_ENV})`);
});

// 매일 00시(서버 로컬) 업무 스냅샷
const taskSnapshot = require('./services/task_snapshot');
function scheduleNextMidnight() {
  const now = new Date();
  const next = new Date(now); next.setDate(now.getDate() + 1); next.setHours(0, 0, 0, 0);
  const delay = next.getTime() - now.getTime();
  setTimeout(async () => {
    try {
      const r = await taskSnapshot.snapshotAllTasks();
      console.log('[daily-snapshot]', r);
    } catch (e) { console.warn('[daily-snapshot] failed', e.message); }
    scheduleNextMidnight();
  }, delay);
}
scheduleNextMidnight();

// Graceful shutdown
process.on('SIGTERM', () => {
  console.log('Shutting down...');
  server.close(() => process.exit(0));
});
