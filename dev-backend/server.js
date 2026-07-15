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

// connection 직후 — user 의 실시간 room 자동 join (모든 역할 커버).
//   ★ 회귀 근본 차단 (사용자 호소 "소리만 나고 숫자 안 오름"):
//   unread 뱃지 hook(useUnreadTotal) 의 싱글톤 socket 이 join:business 를 emit 하지 않아
//   message:new 를 실시간으로 못 받던 회귀. client 가 join 을 '잊어버려도' 서버가 connection
//   시점에 보장 → 모든 socket(뱃지/토스터/리스트/미래코드)이 자동 수신.
//
//   범위 (역할별 프라이버시 유지):
//    (1) 멤버 워크스페이스 → business room (워크스페이스 전체 unread 실시간, canJoinBusiness 와 동일 범위)
//    (2) 비멤버(고객) 대화 → conv room 만 (남의 대화 노출 차단 — business room 에 넣지 않음)
//        → 멤버 워크스페이스의 conv 는 이미 business room 으로 커버되므로 제외(중복 전달 방지)
async function autoJoinUserBusinesses(socket) {
  if (!socket.userId) return;
  const { BusinessMember, ConversationParticipant, Conversation } = getModels();

  // (1) 멤버 워크스페이스 business room
  const bms = await BusinessMember.findAll({
    where: { user_id: socket.userId },
    attributes: ['business_id'],
  });
  const memberBizIds = new Set(bms.map((b) => b.business_id).filter(Boolean));
  for (const bid of memberBizIds) socket.join(`business:${bid}`);

  // (2) 고객(비멤버) 대화 conv room — 멤버가 아닌 워크스페이스의 대화만
  const parts = await ConversationParticipant.findAll({
    where: { user_id: socket.userId },
    attributes: ['conversation_id'],
  });
  const convIds = parts.map((p) => p.conversation_id).filter(Boolean);
  if (convIds.length) {
    const convs = await Conversation.findAll({
      where: { id: convIds },
      attributes: ['id', 'business_id'],
    });
    for (const cv of convs) {
      if (!memberBizIds.has(cv.business_id)) socket.join(`conv:${cv.id}`);
    }
  }
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
  // [진단 2026-06-15] 알림 미수신 회귀 — socket 연결/인증/room join 가시화
  console.log(`[socket-diag] connection id=${socket.id} userId=${socket.userId || 'NONE(인증실패)'} transport=${socket.conn?.transport?.name}`);
  // 연결 직후 — 현재 빌드 ID 알림 (클라가 자기 build 와 다르면 reload 배너)
  const id = getBuildId();
  if (id) socket.emit('server:build', { build_id: id });

  // user 별 room 자동 join — 다중 디바이스 동기화용 (핀, 알림 등 같은 user 의 모든 socket).
  // socket.userId 는 socket 인증 미들웨어가 채워 둠. 없으면 skip (인증 실패 socket).
  if (socket.userId) {
    socket.join(`user:${socket.userId}`);
    // ★ 전 워크스페이스 business room 자동 join — 숫자 뱃지(useUnreadTotal) 실시간 회귀 근본 차단.
    autoJoinUserBusinesses(socket)
      .then(() => console.log(`[socket-diag] user ${socket.userId} rooms=${JSON.stringify([...socket.rooms])}`))
      .catch((e) => console.warn('[socket] autoJoinUserBusinesses', e.message));
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

  // 실시간 가드용 — socket 자신이 들어가 있는 room 목록 ack 반환 (자기 정보만, read-only).
  //   health-check 'realtime' 카테고리가 business room auto-join 회귀를 자동 검출하는 데 사용.
  //   (숫자 뱃지 실시간 회귀 영구 차단 — memory feedback_unread_badge_socket_room_join)
  socket.on('debug:rooms', (cb) => {
    if (typeof cb === 'function') cb(Array.from(socket.rooms || []));
  });

  socket.on('disconnect', () => {
    // 자동으로 모든 room에서 퇴장됨
  });
});

app.set('io', io);
// N+63 — cron 등 req.app context 없는 곳에서 notify() 의 inbox socket emit 위해 global ref.
global.__planqIo = io;

// Stripe webhook — ⚠️ express.json() 前에 마운트해야 함. 서명 검증에 raw body(Buffer) 필요.
//   json 파서가 먼저 삼키면 req.body 가 객체가 되어 constructEvent 서명 검증 실패. (마운트 순서 = Fable 게이트)
//   이 경로만 raw, 나머지 라우트는 아래 express.json 그대로. 분리: SAAS_BILLING_VS_QBILL_SEPARATION.md (payments 만)
// 워크스페이스별(Q Bill) webhook 먼저 — 더 구체적 경로. business webhook secret 으로 서명검증.
app.use('/api/stripe/webhook/ws/:businessId', express.raw({ type: 'application/json' }), require('./routes/stripeWorkspaceWebhook'));
app.use('/api/stripe/webhook', express.raw({ type: 'application/json' }), require('./routes/stripeWebhook'));

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
  // LLM 게이트웨이 관측 — 여태 "한 달에 LLM 을 몇 번 불렀고 몇 번 실패했는지" 아무도 몰랐다.
  //   프로세스 재시작 시 0 으로 리셋되는 in-memory 카운터 (신규 테이블 없음 — Fable D-1).
  try {
    const { getStats } = require('./services/llm');
    const s = getStats();
    out.llm = {
      enabled: s.enabled,
      calls: s.calls, ok: s.ok, failed: s.failed, fallback: s.fallback, retries: s.retries,
      fail_rate: s.fail_rate, avg_ms: s.avg_ms,
      input_tokens: s.input_tokens, output_tokens: s.output_tokens,
      by_purpose: s.by_purpose,
      last_error: s.last_error,
    };
  } catch { /* best-effort */ }
  res.json(out);
});

// Load models (initializes associations)
require('./models');

// Routes
app.use('/api/auth', require('./routes/auth'));
app.use('/api/app-download', require('./routes/app_download')); // 공개 — 모바일 앱 다운로드 링크
app.use('/api/platform', require('./routes/platform_public')); // 공개 — 랜딩 푸터 사업자 정보 (전자상거래법 표시의무)
app.use('/api/projects', require('./routes/projects'));
app.use('/api/projects', require('./routes/project_process'));
app.use('/api/users', require('./routes/users'));
app.use('/api/businesses', require('./routes/businesses'));
// KNOWLEDGE_LOOP 축1 — Cue 워크스페이스 지식 카드
app.use('/api/businesses', require('./routes/cue_knowledge'));
// Q Mail (Phase 9 — M1)
app.use('/api/businesses', require('./routes/email_accounts'));
// N+75-D — Q Mail M2 인박스 read-only API (email_threads list/detail/mark-read/mark-spam)
app.use('/api/businesses', require('./routes/email_threads'));
app.use('/api/businesses', require('./routes/mail_rules'));   // 메일 발신자 분류 규칙(학습형)
app.use('/api/businesses', require('./routes/mail_aliases'));  // 발신 별칭 (Send-as)
app.use('/api/voice', require('./routes/voice'));              // 말로 추가 (음성 → 의도 → 미리보기)
// N+88 — Q Note ↔ Q Task 브릿지 (cross-DB 업무 추출/등록)
app.use('/api/businesses', require('./routes/qnote_bridge'));
// OAuth 로그인 (Google / Microsoft)
app.use('/api/auth', require('./routes/auth_oauth'));
// 외부 연동 Phase 1 — 통합 (workspace + user scope)
app.use('/api', require('./routes/external_connections'));
app.use('/api/notifications', require('./routes/notifications'));
app.use('/api/feedback', require('./routes/feedback'));
app.use('/api/cue', require('./routes/cue'));
app.use('/api/wiki', require('./routes/wiki'));
app.use('/api/admin/wiki', require('./routes/admin_wiki'));
// KNOWLEDGE_LOOP 축3 — 랜딩 블로그 (Q위키 발행분 public 조회)
app.use('/api/blog', require('./routes/blog'));
app.use('/api/org', require('./routes/org'));
app.use('/api/insights', require('./routes/insights'));
app.use('/api/activity', require('./routes/activity'));
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
app.use('/api/messages', require('./routes/message_reactions'));   // #138 이모지 리액션
app.use('/api/tasks', require('./routes/tasks'));
app.use('/api/tasks', require('./routes/task_workflow'));
app.use('/api/tasks', require('./routes/task_attachments'));
app.use('/api/calendar', require('./routes/calendar'));
// 통합 공유 시스템 alias — ShareModal 의 /api/calendar-events/:id/share 매칭
app.use('/api/calendar-events', require('./routes/calendar'));
app.use('/api/dashboard', require('./routes/dashboard'));
app.use('/api/files', require('./routes/files'));
app.use('/api/export', require('./routes/export'));
app.use('/api/folders', require('./routes/file_folders'));
app.use('/api/cloud', require('./routes/cloud'));
app.use('/api/plan', require('./routes/plan'));
app.use('/api/admin', require('./routes/admin'));
app.use('/api/posts', require('./routes/posts'));
app.use('/api/records', require('./routes/records'));
app.use('/api/search', require('./routes/search'));
app.use('/api/invoices', require('./routes/invoices'));
app.use('/api/client-subscriptions', require('./routes/client_subscriptions'));
app.use('/api/docs', require('./routes/docs'));
app.use('/api/api-tokens', require('./routes/api_tokens'));   // #D-4 — MCP 외부 토큰 관리
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
// 보안 하드닝(C1 트랙A): 127.0.0.1 바인드 — internal API 포트를 인터넷에 노출하지 않는다.
// nginx(localhost:3003 프록시)·q-note(localhost:3003 호출) 내부통신은 무해. 외부IP 직결만 차단.
const PORT = process.env.PORT || 3003;
const BIND_HOST = process.env.BIND_HOST || '127.0.0.1';
server.listen(PORT, BIND_HOST, () => {
  console.log(`PlanQ server running on ${BIND_HOST}:${PORT} (${process.env.NODE_ENV})`);
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
      // N+83 — 고객 정기 구독청구 (프로젝트 무관). next_billing_at 도달분 Invoice 자동 발행.
      const r = await require('./services/clientSubscriptionBilling').runClientSubscriptionBilling();
      console.log('[client-subscription]', { due: r.due, billed: r.billed });
    } catch (e) { console.warn('[client-subscription] failed', e.message); }
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
      const r = await overdueHandler.runDailyOverdueCron(new Date(), io);
      console.log('[overdue]', r);
    } catch (e) { console.warn('[overdue] failed', e.message); }
    try {
      const shareCleanup = require('./services/shareTokenCleanup');
      const r = await shareCleanup.runShareTokenCleanup();
      console.log('[share-token-cleanup]', r);
    } catch (e) { console.warn('[share-token-cleanup] failed', e.message); }
    // N+74-B — 공유 링크 만료 3일 전 author 에게 알림 (사용자 호소 "외부 share 만료 임박 알림")
    try {
      const shareExpiry = require('./services/shareExpiryNotify');
      const r = await shareExpiry.runShareExpiryNotify(io);
      console.log('[share-expiry-notify]', r);
    } catch (e) { console.warn('[share-expiry-notify] failed', e.message); }
    scheduleNextMidnight();
  }, delay);
}
scheduleNextMidnight();

// 주간 보고 자동 박제 cron (매시간 0분)
const { initWeeklyReviewCron } = require('./services/weeklyReviewCron');
initWeeklyReviewCron();
// R3 — 단위 보고서 주/월 경계 자동확정 (직전 기간, 멱등)
const { initReportUnitCron } = require('./services/reportUnitCron');
initReportUnitCron();
// N+63 — 일정 임박 알림 cron (5분 단위)
const { initCalendarReminderCron } = require('./services/calendarReminderCron');
initCalendarReminderCron();
// Q Mail M1 — IMAP fetch cron (5분 단위)
const emailImapCron = require('./services/emailImapCron');
emailImapCron.init();
// N+80 Q Mail M4 — FAQ 자동 클러스터링 cron (매일 04:10 KST)
const { initEmailFaqCron } = require('./services/emailFaqCluster');
initEmailFaqCron();
// KNOWLEDGE_LOOP 축2 — Q위키 미답변 질문 클러스터링 → 초안 제안 cron (월 05:00 KST)
const { initWikiQuestionCron } = require('./services/wikiQuestionCluster');
initWikiQuestionCron();
// KNOWLEDGE_LOOP 축1 — Cue 지식 채굴 cron (월 05:20 KST)
const { initCueKnowledgeCron } = require('./services/cueKnowledge');
initCueKnowledgeCron();
// N+36 옵션 D — 업무 후보 만료 cron (30일 hide / 90일 rejected delete / 60일 hidden delete)
const { initCandidateCleanupCron } = require('./services/candidateCleanup');
initCandidateCleanupCron();
// #63 Phase 3 — 자료 이동/내보내기 job 드레인 cron (30초 단위) + 만료 export 정리(6시간)
const exportJobWorker = require('./services/exportJobWorker');
setInterval(() => { exportJobWorker.runExportJobTick().catch(e => console.warn('[exportJobWorker]', e.message)); }, 30 * 1000);
setInterval(() => { exportJobWorker.cleanupExpiredExports().catch(() => {}); }, 6 * 60 * 60 * 1000);

// 미읽음 알림 이메일 에스컬레이션 — push silent-drop 안전망 (운영: 알림 미수신 미팅 누락 사고)
const { initUnreadEscalationCron } = require('./services/unreadEscalationCron');
initUnreadEscalationCron();

// 채팅 자동 업무 추출 디바운스 트리거 + cron fallback (사이클 N+27)
const taskExtractorScheduler = require('./services/taskExtractorScheduler');
taskExtractorScheduler.setIo(io);
taskExtractorScheduler.initCronFallback();

// Graceful shutdown
process.on('SIGTERM', () => {
  console.log('Shutting down...');
  server.close(() => process.exit(0));
});
