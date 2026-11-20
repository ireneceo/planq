// 근태 «그날 마지막으로 뭔가 한 시각» — **사람이 직접 한 쓰기**만 (docs/ATTENDANCE_CHECKIN_PROMPT_DESIGN.md §4.2)
//
// ★ 전역 훅이 아니다 — 아래 목록(메서드+경로)에 맞는 요청이 **성공(2xx)** 했을 때만 센다.
//   모든 요청을 세면 숨은 탭의 주기 호출·토큰 갱신·업무 측정 heartbeat·읽음 표시가 활동으로 잡혀 자동 마감 퇴근이 자정으로 밀린다.
//   AI 앱(MCP)·에이전트 쓰기는 다른 경로라 여기 걸리지 않는다(사람이 자리에 있었다는 증거가 아님).
// 워크스페이스는 창이 싣는 X-Workspace-Id(같은 출처 apiFetch) — 그 워크스페이스 멤버일 때만 남긴다.
//   라우트 본문을 고치지 않고 여기 한 곳에 목록을 둔다(라우트 9곳에 한 줄씩 흩으면 하나가 빠진다).
const { BusinessMember } = require('../models');
const { touch } = require('../services/attendancePrompt');

const RULES = [
  ['POST', /^\/api\/conversations\/\d+\/\d+\/messages\/?$/],          // Q talk 메시지 보내기
  ['POST', /^\/api\/projects\/conversations\/\d+\/messages\/?$/],      // 프로젝트 대화 메시지
  ['POST', /^\/api\/businesses\/\d+\/email-threads\/\d+\/messages\/?$/], // 메일 답장
  ['POST', /^\/api\/businesses\/\d+\/email-compose\/?$/],              // 새 메일 보내기
  ['POST', /^\/api\/tasks\/?$/],                                        // 업무 만들기
  ['PUT', /^\/api\/tasks\/by-business\/\d+\/\d+\/?$/],                 // 업무 고치기
  ['POST', /^\/api\/tasks\/\d+\/(ack|submit-review|cancel-review|hold|resume|complete|revert-status|reviewers\/me\/(approve|revision|revert))\/?$/], // 업무 상태
  ['POST', /^\/api\/tasks\/\d+\/comments\/?$/],                         // 업무 댓글
  ['POST', /^\/api\/posts\/?$/],                                        // 문서 만들기
  ['PUT', /^\/api\/posts\/\d+\/?$/],                                    // 문서 저장
  ['POST', /^\/api\/focus\/start\/?$/],                                 // 업무 측정 시작
];

function matches(method, path) {
  for (const [m, re] of RULES) if (m === method && re.test(path)) return true;
  return false;
}

const memberCache = new Map();   // `${biz}:${user}` → { ok, at } (5분)
async function isStaff(businessId, userId) {
  const key = `${businessId}:${userId}`;
  const hit = memberCache.get(key);
  if (hit && Date.now() - hit.at < 5 * 60 * 1000) return hit.ok;
  const bm = await BusinessMember.findOne({
    where: { business_id: businessId, user_id: userId, removed_at: null },
    attributes: ['role'],
  });
  const ok = !!bm && ['owner', 'admin', 'member'].includes(bm.role);
  if (memberCache.size > 20000) memberCache.clear();
  memberCache.set(key, { ok, at: Date.now() });
  return ok;
}

function attendanceTouch(req, res, next) {
  if (req.method === 'GET' || !matches(req.method, req.path)) return next();
  res.on('finish', () => {
    if (res.statusCode < 200 || res.statusCode >= 300) return;
    const userId = req.user?.id;
    const businessId = Number(req.headers['x-workspace-id']);
    if (!userId || !Number.isInteger(businessId) || businessId <= 0) return;
    isStaff(businessId, userId)
      .then((ok) => { if (ok) touch(businessId, userId); })
      .catch((e) => console.warn('[attendance touch mw]', e.message));
  });
  return next();
}

module.exports = { attendanceTouch, matches, RULES };
