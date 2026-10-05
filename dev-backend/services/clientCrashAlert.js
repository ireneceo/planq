// services/clientCrashAlert.js — 화면 크래시를 **플랫폼 관리자에게 바로** 알린다.
//
// routes/client_errors.js 는 크래시를 로그에만 남겼다. 로그는 누가 열어야 보인다 —
// 2026-10-05 운영 실측: Q Talk 크래시(getBoundingClientRect of null)가 로그에만 있고 아무도 몰랐다.
//
// 설계 (2026-10-05 Irene 승인 «다 해줘»):
//   · 채널은 platformNotify(관리자 메일, notification_prefs `client_crash` email 로 끌 수 있다)
//   · **같은 크래시는 1시간에 한 번** — 지문(메시지 + 첫 프레임 파일, 해시·숫자 제거)으로 묶는다.
//     그 사이 더 온 건수는 다음 알림에 «지난 알림 이후 N건» 으로 싣는다(버리지 않는다).
//   · **전체 상한 시간당 10통** — 사용자 한 명이 메시지를 바꿔 가며 보내면 지문이 매번 달라진다
//     (route 는 인증만 걸린 사용자 입력이다). 상한에 막힌 것은 다음 알림에 «생략 N건» 으로 싣는다.
//   · 청크 로드 실패(배포 직후 옛 해시)는 알리지 않는다 — ErrorBoundary 가 스스로 새로고침해 낫는다.
//     배포 한 번에 접속자 수만큼 메일이 가는 것을 막는다.
//   · 본문에 스택은 싣지 않는다(경로·메시지·빌드·사용자 id·건수). 스택은 로그에 그대로 있다.
//   · 메모리 상태다 — PM2 fork 단일 프로세스(dev·운영 실측). 재시작하면 첫 크래시가 한 번 더 알려질 뿐이다.
//   · 켜짐: NODE_ENV=production 기본 ON. 그 밖(dev)은 CLIENT_CRASH_ALERT=1 일 때만 —
//     dev 의 e2e 검사가 일부러 낸 크래시로 관리자 메일함을 채우지 않는다.

const WINDOW_MS = 60 * 60 * 1000;
const GLOBAL_MAX_PER_WINDOW = 10;

const lastSent = new Map(); // fp → { at, suppressed }
let globalWindowStart = 0;
let globalSent = 0;
let globalDropped = 0;

function enabled() {
  if (process.env.CLIENT_CRASH_ALERT === '0') return false;
  if (process.env.CLIENT_CRASH_ALERT === '1') return true;
  return process.env.NODE_ENV === 'production';
}

function isChunkLoadMessage(msg) {
  return /Failed to fetch dynamically imported module|Loading chunk \d+ failed|Importing a module script failed|ChunkLoadError/i.test(String(msg || ''));
}

// 빌드마다 바뀌는 것(청크 해시·줄:열·숫자 id)을 지워야 같은 결함이 같은 지문이 된다.
function normalize(s) {
  return String(s || '')
    .replace(/https?:\/\/[^\s)|]+\/assets\//g, '')
    .replace(/-[A-Za-z0-9_]{6,12}\.js/g, '.js')
    .replace(/:\d+:\d+/g, '')
    .replace(/\d+/g, '#')
    .replace(/\s+/g, ' ')
    .trim();
}

function fingerprint({ message, stack, component }) {
  const firstFrame = String(stack || component || '').split('|')[0] || '';
  const file = (firstFrame.match(/([A-Za-z0-9_.-]+\.js)/) || [])[1] || '';
  return `${normalize(message).slice(0, 200)}@${normalize(file)}`;
}

function prune(now) {
  for (const [k, v] of lastSent) if (now - v.at > WINDOW_MS * 3) lastSent.delete(k);
}

// 순수 판정 — 보낼지, 보낸다면 함께 실을 건수. 테스트에서 시각을 넣을 수 있게 now 를 받는다.
function decide(crash, now = Date.now()) {
  if (isChunkLoadMessage(crash.message)) return { send: false, reason: 'chunk' };
  const fp = fingerprint(crash);
  const prev = lastSent.get(fp);
  if (prev && now - prev.at < WINDOW_MS) {
    prev.suppressed += 1;
    return { send: false, reason: 'dedup', fp };
  }
  if (now - globalWindowStart >= WINDOW_MS) { globalWindowStart = now; globalSent = 0; }
  if (globalSent >= GLOBAL_MAX_PER_WINDOW) {
    globalDropped += 1;
    return { send: false, reason: 'global_cap', fp };
  }
  globalSent += 1;
  const repeats = prev ? prev.suppressed : 0;
  const dropped = globalDropped;
  globalDropped = 0;
  lastSent.set(fp, { at: now, suppressed: 0 });
  prune(now);
  return { send: true, fp, repeats, dropped };
}

async function alertClientCrash(crash) {
  if (!enabled()) return { sent: false, reason: 'disabled' };
  const d = decide(crash);
  if (!d.send) return { sent: false, reason: d.reason };
  const { notifyPlatformAdmins, APP_URL } = require('./platformNotify');
  // 따옴표·꺾쇠는 경로에 올 일이 없다 — 지운다(메일 링크는 emailService 가 한 번 더 이스케이프한다).
  const route = String(crash.route || '').replace(/["'<>`\\]/g, '').slice(0, 200);
  const lines = [
    `화면: ${route || '(알 수 없음)'}`,
    `오류: ${String(crash.message || '').slice(0, 300)}`,
    `사용자 id: ${crash.user_id || '-'} · 빌드: ${crash.build || '-'}`,
  ];
  if (d.repeats > 0) lines.push(`지난 알림 이후 같은 크래시 ${d.repeats}건 더 발생`);
  if (d.dropped > 0) lines.push(`알림 상한(시간당 ${GLOBAL_MAX_PER_WINDOW}통)으로 생략된 다른 크래시 ${d.dropped}건`);
  lines.push('', '스택·직전 조작은 서버 로그 [client-crash] 에 있습니다.');
  const r = await notifyPlatformAdmins({
    eventKind: 'client_crash',
    title: `화면 오류 — ${route.split('?')[0] || '/'}`,
    body: lines.join('\n'),
    // 사용자 입력 경로다 — 우리 도메인 안의 경로만(`//host` 같은 프로토콜 상대 주소는 버린다).
    link: /^\/(?![\/\\])/.test(route) ? `${APP_URL}${route}` : APP_URL,
    ctaLabel: '그 화면 열기',
  });
  return { sent: true, ...r };
}

function _resetForTest() {
  lastSent.clear(); globalWindowStart = 0; globalSent = 0; globalDropped = 0;
}

module.exports = { alertClientCrash, decide, fingerprint, isChunkLoadMessage, _resetForTest, GLOBAL_MAX_PER_WINDOW };
