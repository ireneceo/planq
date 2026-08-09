// routes/voice.js — 말로 추가 (음성 → 의도 분류 → 미리보기)
//
// 설계: docs/MAIL_ALIAS_AND_VOICE_DESIGN.md §B
//   마이크(우측 하단 퀵버튼) → 30초 이내 발화 → STT(Deepgram) → 의도 분류(LLM 1회)
//   → **미리보기 카드** → 사람이 확인해야 저장된다.
//
// 자동 저장하지 않는 이유: 잘못 들은 말이 그대로 업무가 되면 그 기능은 두 번 다시 안 쓴다.
// 이 라우트는 "무엇을 만들지 제안" 까지만 하고, 실제 생성은 기존 경로(tasks/ai-create, calendar 등)가 한다.
//
// 오디오는 저장하지 않는다 — 전사 후 즉시 폐기 (개인정보 최소 수집).
const express = require('express');
const multer = require('multer');
const router = express.Router();

const { authenticateToken, checkBusinessAccess } = require('../middleware/auth');
const { successResponse, errorResponse } = require('../middleware/errorHandler');
const { perUserDaily } = require('../middleware/costGuard');
const { callLLM } = require('../services/llm');
const { matchMemberByName } = require('../services/aiTaskPlanner');
const { todayInTz, addDaysStr } = require('../utils/datetime');
const plan = require('../services/plan');
const { CueUsage, Business, BusinessMember, User } = require('../models');

const DEEPGRAM_API_KEY = process.env.DEEPGRAM_API_KEY;
const MAX_AUDIO_BYTES = 3 * 1024 * 1024;   // 30초 opus ≈ 300KB. 3MB 면 넉넉하고 폭주는 막는다

// 메모리 저장 — 디스크에 남기지 않는다
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: MAX_AUDIO_BYTES, files: 1 },
});

// 외부 quota·비용이 드는 라우트 → per-user rate-limit 필수 (운영 안정성 1번, costGuard 공유 헬퍼)
const voiceGuards = perUserDaily('voice', { perMin: 5, perDay: 100 });

// 사용량 기록 — cue_usage 월 집계 (다른 AI 기능과 같은 원장)
async function recordVoiceUsage(businessId, inTok, outTok) {
  const ym = new Date().toISOString().slice(0, 7);
  const [row, created] = await CueUsage.findOrCreate({
    where: { business_id: businessId, year_month: ym, action_type: 'voice_capture' },
    defaults: { action_count: 1, token_input: inTok, token_output: outTok, cost_usd: 0 },
  });
  if (!created) {
    await row.update({
      action_count: (row.action_count || 0) + 1,
      token_input: (row.token_input || 0) + inTok,
      token_output: (row.token_output || 0) + outTok,
    });
  }
}

// ── STT (Deepgram prerecorded) — 짧은 발화는 실시간 WS 보다 싸고 단순하다
async function transcribe(buffer, mimeType) {
  if (!DEEPGRAM_API_KEY) return { text: '', unavailable: true };
  const params = new URLSearchParams({
    model: 'nova-2',
    language: 'ko',            // 한국어 우선 (영어 섞여도 nova-2 가 처리)
    smart_format: 'true',
    punctuate: 'true',
  });
  const r = await fetch(`https://api.deepgram.com/v1/listen?${params}`, {
    method: 'POST',
    headers: {
      Authorization: `Token ${DEEPGRAM_API_KEY}`,
      'Content-Type': mimeType || 'audio/webm',
    },
    body: buffer,
    signal: AbortSignal.timeout(30_000),
  });
  if (!r.ok) {
    const body = (await r.text()).slice(0, 200);
    console.warn('[voice] deepgram', r.status, body);
    return { text: '', error: `stt_${r.status}` };
  }
  const j = await r.json();
  const text = j?.results?.channels?.[0]?.alternatives?.[0]?.transcript || '';
  return { text: String(text).trim() };
}

// ── 의도 분류 — 무엇을 만들지 사람이 먼저 고르지 않는다. 말하면 AI 가 판단하고 사람이 확인한다.
//
// 해석(담당자·시각)은 **여기 서버에서 이 한 번의 호출로** 끝낸다. 프론트에서 한국어 상대날짜를
// 다시 파싱하거나 두 번째 LLM 을 부르지 않는다 (memory feedback_ai_minimal_usage).
function intentSystemPrompt(todayLocal, tz) {
  return `너는 업무 비서다. 사용자가 말한 한 문장을 읽고 무엇을 만들려는지 판단한다.
반드시 아래 JSON 만 출력한다.

오늘은 ${todayLocal} (타임존 ${tz}) 이다. 상대적 날짜 표현은 이 날짜를 기준으로 계산한다.

{
  "kind": "task" | "event" | "memo" | "mail",
  "title": "핵심 제목 (한 줄)",
  "detail": "부가 설명 (없으면 빈 문자열)",
  "assignee_name": "사용자가 특정 사람을 지목했으면 그 이름, 아니면 null",
  "when": "날짜/시간 표현이 있으면 원문 그대로 (예: '다음 주 화요일 3시'), 없으면 null",
  "when_start": "when 을 계산한 결과. 'YYYY-MM-DDTHH:mm' 형식. 시각 표현이 없으면 null",
  "when_all_day": true | false,
  "confidence": 0.0~1.0
}

when_start 규칙:
- 타임존 표기(Z, +09:00)를 **붙이지 않는다**. 위 타임존의 벽시계 시각 그대로 쓴다.
- 날짜만 있고 시각이 없으면 (예: "내일", "다음 주 금요일") 시각은 09:00, when_all_day 는 true
- 시각이 있으면 (예: "3시", "오후 2시 반") when_all_day 는 false. "3시" 처럼 오전/오후가 없으면 업무 시간대로 해석한다
- 과거를 가리키는 표현("어제 회의에서")은 기록이지 예정이 아니다 — when_start 를 null 로 둔다

판단 기준:
- task: 누가 무엇을 해야 함 ("~하기", "~요청해줘", "~까지 정리")
- event: 시각이 있는 약속·회의 ("3시 미팅", "내일 방문")
- memo: 기록해 둘 사실·정보 ("~라고 하더라", "예산이 빠듯함")
- mail: 메일 답장·발송 의도 ("~라고 답장해줘", "메일 보내줘")
애매하면 memo 로 한다 — 잘못된 업무를 만드는 것보다 메모가 안전하다.`;
}

// LLM 날짜 산술은 틀릴 수 있다. 착지점이 전부 사람이 보고 저장하는 폼이라 조용한 오생성은 없지만,
// 명백히 쓸 수 없는 값(형식 불량·과거·1년 초과)은 여기서 버린다 — 폼에 이상한 날짜를 심지 않는다.
function sanitizeWhenStart(raw, todayLocal) {
  if (!raw) return null;
  const m = /^(\d{4}-\d{2}-\d{2})T(\d{2}):(\d{2})$/.exec(String(raw).trim());
  if (!m) return null;
  const [, dateStr, hh, mm] = m;
  if (Number(hh) > 23 || Number(mm) > 59) return null;
  // 문자열 비교로 충분하다 — 둘 다 워크스페이스 tz 기준 'YYYY-MM-DD'
  if (dateStr < todayLocal) return null;
  if (dateStr > addDaysStr(todayLocal, 365)) return null;
  return `${dateStr}T${hh}:${mm}`;
}

async function classifyIntent(text, opts = {}) {
  const todayLocal = opts.todayLocal || todayInTz('Asia/Seoul');
  const tz = opts.tz || 'Asia/Seoul';
  const r = await callLLM({
    purpose: 'task_plan',
    json: true,
    // 이 호출의 출력은 짧은 JSON 한 덩어리다 — task_plan 의 기본 상한(업무 분해용, 2000)을 물려받지 않는다.
    //   레지스트리 기본값이 바뀌어도 여기 비용 상한은 흔들리지 않게 명시한다.
    maxTokens: 380,
    messages: [
      { role: 'system', content: intentSystemPrompt(todayLocal, tz) },
      { role: 'user', content: text.slice(0, 1000) },
    ],
    fallback: JSON.stringify({ kind: 'memo', title: text.slice(0, 80), detail: '', assignee_name: null, when: null, when_start: null, when_all_day: false, confidence: 0.3 }),
  });
  // 사용량 원장(cue_usage)이 여태 0 으로만 기록되던 원인 — 이 반환에 토큰이 안 실려 있었다.
  const tokens = { input_tokens: r.input_tokens || 0, output_tokens: r.output_tokens || 0 };
  try {
    const j = JSON.parse(r.content);
    const kind = ['task', 'event', 'memo', 'mail'].includes(j.kind) ? j.kind : 'memo';
    return {
      kind,
      title: String(j.title || text).slice(0, 200),
      detail: String(j.detail || '').slice(0, 1000),
      assignee_name: j.assignee_name ? String(j.assignee_name).slice(0, 50) : null,
      when: j.when ? String(j.when).slice(0, 60) : null,
      when_start: sanitizeWhenStart(j.when_start, todayLocal),
      when_all_day: j.when_all_day === true,
      confidence: Number(j.confidence) || 0.5,
      fallback: r.fallback,
      ...tokens,
    };
  } catch {
    return { kind: 'memo', title: text.slice(0, 200), detail: '', assignee_name: null, when: null, when_start: null, when_all_day: false, confidence: 0.3, fallback: true, ...tokens };
  }
}

// ── 담당자 해석 — 지목된 이름을 워크스페이스 멤버로 확정한다.
//
// ★ 정확 일치만 쓴다(exactOnly). aiTaskPlanner 의 2단계 포함 일치는 여기서 위험하다 —
//   멤버 '김지원' 이 있는 워크스페이스에서 LLM 이 assignee_name 을 '지원' 으로 뽑으면
//   포함 일치가 김지원으로 확정하고, 업무 생성이 그 사람에게 알림까지 쏜다.
//   음성은 사용자가 오타를 눈으로 고칠 기회가 없는 입력이라 부분 일치의 편의보다 오배정 비용이 크다.
//
// 메뉴 권한(requireMenu) 은 여기서 보지 않는다 — 이 라우트는 "무엇을 만들지 제안" 만 하고
//   실제 생성은 착지 화면의 기존 라우트가 각자 자기 권한으로 막는다. 권한 없는 멤버가
//   해당 화면에 착지하면 그 화면의 기존 안내를 그대로 본다(이 라우트가 판단을 앞당기지 않는다).
async function resolveAssignee(assigneeName, businessId) {
  if (!assigneeName) return { assignee_user_id: null, assignee_display_name: null };
  const rows = await BusinessMember.findAll({
    where: { business_id: businessId, removed_at: null },
    attributes: ['user_id', 'name'],
    include: [{ model: User, as: 'user', attributes: ['id', 'name'] }],
  });
  const members = rows.map((m) => ({
    user_id: m.user_id,
    name: m.name || m.user?.name || '',
    account_name: m.user?.name || '',
  }));
  const id = matchMemberByName(assigneeName, members, { exactOnly: true });
  if (!id) return { assignee_user_id: null, assignee_display_name: null };
  const hit = members.find((m) => m.user_id === id);
  return { assignee_user_id: id, assignee_display_name: hit?.name || hit?.account_name || null };
}

// ─────────────────────────────────────────────
// POST /api/voice/capture — 오디오 → 전사 → 의도 (저장하지 않는다)
//   multipart: audio (file), business_id, context(json, 선택)
// ─────────────────────────────────────────────
router.post('/capture',
  authenticateToken,
  ...voiceGuards,
  // ★ multer 를 격리 게이트보다 **먼저** 태운다 — checkBusinessAccess 는 `req.body.business_id` 를 읽는데
  //   multipart 는 파싱 전까지 req.body 가 비어 있어, 순서를 뒤집으면 모든 정상 호출이 400 이 된다.
  upload.single('audio'),
  // 멤버십 격리 — 여태 plan.can 만 있었다. 남의 워크스페이스 id 로도 호출이 통했고,
  //   이번에 담당자 해석(assignee_user_id)이 붙으면서 그 구멍이 사용자 식별자 노출이 된다.
  checkBusinessAccess,
  async (req, res, next) => {
    try {
      const businessId = Number(req.body.business_id);
      if (!Number.isFinite(businessId)) return errorResponse(res, 'business_id required', 400);
      if (!req.file || !req.file.buffer?.length) return errorResponse(res, 'audio required', 400);

      // 플랜 게이트 — LLM/STT 는 비용이다 (운영 안정성 1번: rate-limit + plan.can + 입력 캡 3종 세트)
      const can = await plan.can(businessId, 'use_cue');
      if (!can.ok) return res.status(422).json(plan.buildQuotaError(can, businessId));

      const stt = await transcribe(req.file.buffer, req.file.mimetype);
      if (stt.unavailable) return errorResponse(res, 'stt_unavailable', 503);
      if (!stt.text) {
        // 무음·잡음 — 빈 업무를 만들지 않는다. 사용자에게 다시 말하라고만 한다.
        return successResponse(res, { text: '', intent: null, empty: true });
      }

      // 상대 날짜의 기준은 워크스페이스 타임존이다 (/api/tasks/ai-create 와 동일 규칙)
      const biz = await Business.findByPk(businessId, { attributes: ['timezone'] });
      const tz = biz?.timezone || 'Asia/Seoul';
      const intent = await classifyIntent(stt.text, { todayLocal: todayInTz(tz), tz });

      // 지목된 이름 → 멤버 확정. 멤버 풀은 이 business_id 스코프라 타 워크스페이스 이름은 매칭되지 않는다.
      const resolved = await resolveAssignee(intent.assignee_name, businessId);
      intent.assignee_user_id = resolved.assignee_user_id;
      // 미리보기 카드가 "누구로 해석됐는지" 를 보여줄 수 있게 확정된 표시명을 같이 준다 —
      //   사용자가 확인 전에 오배정을 잡을 유일한 지점이다.
      intent.assignee_display_name = resolved.assignee_display_name;

      // 사용량 기록 (cue_usage) — 실패해도 응답은 준다
      try { await recordVoiceUsage(businessId, intent.input_tokens || 0, intent.output_tokens || 0); } catch (e) { console.warn('[voice] usage', e.message); }

      return successResponse(res, { text: stt.text, intent });
    } catch (err) {
      if (err.code === 'LIMIT_FILE_SIZE') return errorResponse(res, 'audio_too_large', 413);
      next(err);
    }
  }
);

module.exports = router;
// 검증·재사용용 export (라우터는 default)
module.exports.classifyIntent = classifyIntent;
module.exports.transcribe = transcribe;
module.exports.sanitizeWhenStart = sanitizeWhenStart;
module.exports.resolveAssignee = resolveAssignee;
