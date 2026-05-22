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
const { errorHandler, requestIdMiddleware } = require('./middleware/errorHandler');

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

// 프론트 빌드 ID 캐시 — version.json 한 번 read 후 메모리. socket connection 마다 client 에 emit.
//   클라가 자기 메모리 build_id 와 비교 → 다르면 사용자에게 "업데이트 사용 가능" 배너 표시.
//   (60초 polling 은 안전망으로 5분 간격 유지)
let cachedBuildId = '';
function getBuildId() {
  if (cachedBuildId) return cachedBuildId;
  try {
    const fs = require('fs');
    const path = require('path');
    const candidates = [
      process.env.FRONTEND_BUILD_DIR && path.join(process.env.FRONTEND_BUILD_DIR, 'version.json'),
      path.resolve(__dirname, '..', 'frontend-build', 'version.json'),
      path.resolve(__dirname, '..', 'dev-frontend-build', 'version.json'),
    ].filter(Boolean);
    for (const p of candidates) {
      try {
        const j = JSON.parse(fs.readFileSync(p, 'utf8'));
        if (j.build_id) { cachedBuildId = String(j.build_id); break; }
      } catch { /* try next */ }
    }
  } catch { /* noop */ }
  return cachedBuildId || '';
}
// build_id 변경 broadcast — deploy 직후 cache 강제 무효화 후 호출 (사용자 모두에게 1회 emit)
function invalidateBuildId() {
  cachedBuildId = '';
  const id = getBuildId();
  if (id) io.emit('server:build', { build_id: id });
}
// 외부 호출 (예: deploy hook) 가능하도록 노출
app.locals.invalidatePlanqBuildId = invalidateBuildId;

io.on('connection', (socket) => {
  // 연결 직후 — 현재 빌드 ID 알림 (클라가 자기 build 와 다르면 reload 배너)
  const id = getBuildId();
  if (id) socket.emit('server:build', { build_id: id });

  // user 별 room 자동 join — 다중 디바이스 동기화용 (핀, 알림 등 같은 user 의 모든 socket).
  // socket.userId 는 socket 인증 미들웨어가 채워 둠. 없으면 skip (인증 실패 socket).
  if (socket.userId) {
    socket.join(`user:${socket.userId}`);
  }

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

// 모든 요청에 request_id 부여 — 사용자 신고 → 로그 매칭. response 에 X-Request-Id 헤더.
app.use(requestIdMiddleware);

// 점검 모드 (2026-05-05) — platform_settings.maintenance_mode=true 면 platform_admin 외 503
const { maintenanceMiddleware } = require('./middleware/maintenance');
app.use(maintenanceMiddleware);

// SEO / SNS 공유 봇 OG meta 동적 응답 (사이클 N+23). UA 가 share bot 이면 페이지별 OG 채운 HTML
// 반환. 일반 사용자는 그냥 통과 → SPA index.html. nginx 가 정적 응답하기 전 backend 가 가로챔.
const { ogMetaMiddleware } = require('./middleware/ogMeta');
app.use(ogMetaMiddleware);

// Security
setupSecurity(app);

// 빌드 버전 — 프론트가 5분 polling 으로 새 빌드 감지 시 silent reload (캐시 자동 갱신)
// 운영 (/opt/planq/frontend-build/index.html) 또는 dev (/opt/planq/dev-frontend-build/index.html) mtime epoch
app.get('/api/build-version', (req, res) => {
  const fs = require('fs');
  const path = require('path');
  const candidates = [
    process.env.FRONTEND_INDEX_HTML,
    path.resolve(__dirname, '..', 'frontend-build', 'index.html'),
    path.resolve(__dirname, '..', 'dev-frontend-build', 'index.html'),
  ].filter(Boolean);
  for (const p of candidates) {
    try {
      const st = fs.statSync(p);
      return res.json({ success: true, data: { version: String(Math.floor(st.mtimeMs)) } });
    } catch { /* try next */ }
  }
  return res.json({ success: true, data: { version: '0' } });
});

// Health check — DB pool / q-note / Deepgram 키 만료 잔여일 같이 노출 (운영 모니터링 endpoint)
app.get('/api/health', async (req, res) => {
  const out = { status: 'ok', service: 'planq', timestamp: new Date().toISOString() };
  // DB pool 사용률 (best-effort)
  try {
    const { sequelize } = require('./config/database');
    const pool = sequelize.connectionManager?.pool;
    if (pool) {
      out.db_pool = {
        size: pool.size,
        used: pool.using ?? pool._using ?? null,
        available: pool.available,
        pending: pool.pending,
      };
    }
  } catch { /* best-effort */ }
  // 환경 시그널 (운영 진단 시 빠른 확인)
  out.env = {
    node_env: process.env.NODE_ENV || 'development',
    deepgram_configured: !!process.env.DEEPGRAM_API_KEY,
    openai_configured: !!process.env.OPENAI_API_KEY,
    smtp_configured: !!process.env.SMTP_HOST,
    vapid_configured: !!process.env.VAPID_PUBLIC_KEY,
  };
  res.json(out);
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
app.use('/api/stats', require('./routes/stats'));
app.use('/api/reports', require('./routes/reports'));
app.use('/api/push', require('./routes/push'));
app.use('/api/focus', require('./routes/focus'));
app.use('/api/tasks', require('./routes/task_estimations'));
app.use('/api/task-templates', require('./routes/task_templates'));
app.use('/api/clients', require('./routes/clients'));
app.use('/api/invites', require('./routes/invites'));
app.use('/api/conversations', require('./routes/conversations'));
app.use('/api/message-attachments', require('./routes/message_attachments'));
app.use('/api/tasks', require('./routes/tasks'));
app.use('/api/tasks', require('./routes/task_workflow'));
app.use('/api/tasks', require('./routes/task_attachments'));
app.use('/api/calendar', require('./routes/calendar'));
// 통합 공유 시스템 alias — ShareModal 의 /api/calendar-events/:id/share 매칭
app.use('/api/calendar-events', require('./routes/calendar'));
app.use('/api/dashboard', require('./routes/dashboard'));
app.use('/api/files', require('./routes/files'));
app.use('/api/folders', require('./routes/file_folders'));
app.use('/api/cloud', require('./routes/cloud'));
app.use('/api/plan', require('./routes/plan'));
app.use('/api/admin', require('./routes/admin'));
app.use('/api/posts', require('./routes/posts'));
app.use('/api/records', require('./routes/records'));
app.use('/api/search', require('./routes/search'));
app.use('/api/invoices', require('./routes/invoices'));
app.use('/api/docs', require('./routes/docs'));
// 서명 — /api/posts/:id/signatures, /api/signatures/:id, /api/sign/:token/* (공개)
app.use('/api', require('./routes/signatures'));
app.use('/api/inquiries', require('./routes/inquiries'));
app.use('/api', require('./routes/kb'));
app.use('/api/weekly-reviews', require('./routes/weekly_reviews'));
// 통합 공유 — entity 무관 발송 (사이클 N+4 5차)
app.use('/api/share', require('./routes/share'));
// 개인 보관함 — 본인 L1/private 자산 통합 (사이클 N+9)
app.use('/api/personal-vault', require('./routes/personal_vault'));
// Internal API — Q Note ↔ Node 통신 (사이클 N+14 visibility 검사)
app.use('/api/internal', require('./routes/internal'));

// Error handler
app.use(errorHandler);

// Start server
const PORT = process.env.PORT || 3003;
server.listen(PORT, () => {
  console.log(`PlanQ server running on port ${PORT} (${process.env.NODE_ENV})`);
});

// 매일 00시(서버 로컬) — 업무 스냅샷 + 자체결제 cron (active→past_due→grace→demoted) + 매월 1일 보고서 + 정기청구 + 연체 정지
const taskSnapshot = require('./services/task_snapshot');
const billing = require('./services/billing');
const trial = require('./services/trial');
const reportGenerator = require('./services/report_generator');
const recurringInvoice = require('./services/recurring_invoice');
const recurringTask = require('./services/recurringTaskGenerator');
const uploadCleanup = require('./services/uploadCleanup');
const overdueHandler = require('./services/overdue_handler');

async function runMonthlyReportsIfDay1() {
  const today = new Date();
  if (today.getDate() !== 1) return { skipped: true, reason: 'not_day_1' };
  const { Business, Report } = require('./models');
  const businesses = await Business.findAll({
    where: { status: 'active' },
    attributes: ['id'],
  });
  const period = reportGenerator.computePeriod('monthly', today);
  let ok = 0, dup = 0, fail = 0;
  for (const biz of businesses) {
    // 동일 기간 monthly 이미 있으면 skip (재시작 안전)
    const exists = await Report.findOne({
      where: { business_id: biz.id, kind: 'monthly', period_start: period.from, period_end: period.to },
      attributes: ['id'],
    });
    if (exists) { dup += 1; continue; }
    try {
      await reportGenerator.generateReport({ businessId: biz.id, kind: 'monthly', period });
      ok += 1;
    } catch (e) {
      console.warn('[monthly-report] business', biz.id, 'failed', e.message);
      fail += 1;
    }
  }
  return { ok, dup, fail, period };
}

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
    try {
      const r = await trial.runDailyTrialCron();
      console.log('[trial-cron]', r);
    } catch (e) { console.warn('[trial-cron] failed', e.message); }
    try {
      const r = await runMonthlyReportsIfDay1();
      if (!r.skipped) console.log('[monthly-report]', r);
    } catch (e) { console.warn('[monthly-report] failed', e.message); }
    try {
      const r = await recurringInvoice.runDailyRecurringBilling();
      console.log('[recurring-invoice]', { ok: r.ok, skip: r.skip, fail: r.fail });
    } catch (e) { console.warn('[recurring-invoice] failed', e.message); }
    try {
      // io 주입 — generator 가 새 인스턴스 broadcast (CLAUDE.md 16번)
      const r = await recurringTask.runDailyRecurringTaskGen(new Date(), io);
      console.log('[recurring-task]', { ok: r.ok, skip: r.skip, fail: r.fail });
    } catch (e) { console.warn('[recurring-task] failed', e.message); }
    try {
      const r = await uploadCleanup.runUploadCleanup();
      console.log('[upload-cleanup]', r);
    } catch (e) { console.warn('[upload-cleanup] failed', e.message); }
    try {
      const r = await overdueHandler.runDailyOverdueCron();
      console.log('[overdue]', r);
    } catch (e) { console.warn('[overdue] failed', e.message); }
    try {
      const shareCleanup = require('./services/shareTokenCleanup');
      const r = await shareCleanup.runShareTokenCleanup();
      console.log('[share-token-cleanup]', r);
    } catch (e) { console.warn('[share-token-cleanup] failed', e.message); }
    scheduleNextMidnight();
  }, delay);
}
scheduleNextMidnight();

// 주간 보고 자동 박제 cron (매시간 0분)
const { initWeeklyReviewCron } = require('./services/weeklyReviewCron');
initWeeklyReviewCron();
// N+36 옵션 D — 업무 후보 만료 cron (30일 hide / 90일 rejected delete / 60일 hidden delete)
const { initCandidateCleanupCron } = require('./services/candidateCleanup');
initCandidateCleanupCron();

// 채팅 자동 업무 추출 디바운스 트리거 + cron fallback (사이클 N+27)
const taskExtractorScheduler = require('./services/taskExtractorScheduler');
taskExtractorScheduler.setIo(io);
taskExtractorScheduler.initCronFallback();

// Graceful shutdown
process.on('SIGTERM', () => {
  console.log('Shutting down...');
  server.close(() => process.exit(0));
});
