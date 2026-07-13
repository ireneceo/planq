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

const { authenticateToken } = require('../middleware/auth');
const { successResponse, errorResponse } = require('../middleware/errorHandler');
const { perUserDaily } = require('../middleware/costGuard');
const { callLLM } = require('../services/llm');
const plan = require('../services/plan');
const { CueUsage } = require('../models');

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
const INTENT_SYSTEM = `너는 업무 비서다. 사용자가 말한 한 문장을 읽고 무엇을 만들려는지 판단한다.
반드시 아래 JSON 만 출력한다.

{
  "kind": "task" | "event" | "memo" | "mail",
  "title": "핵심 제목 (한 줄)",
  "detail": "부가 설명 (없으면 빈 문자열)",
  "assignee_name": "사용자가 특정 사람을 지목했으면 그 이름, 아니면 null",
  "when": "날짜/시간 표현이 있으면 원문 그대로 (예: '다음 주 화요일 3시'), 없으면 null",
  "confidence": 0.0~1.0
}

판단 기준:
- task: 누가 무엇을 해야 함 ("~하기", "~요청해줘", "~까지 정리")
- event: 시각이 있는 약속·회의 ("3시 미팅", "내일 방문")
- memo: 기록해 둘 사실·정보 ("~라고 하더라", "예산이 빠듯함")
- mail: 메일 답장·발송 의도 ("~라고 답장해줘", "메일 보내줘")
애매하면 memo 로 한다 — 잘못된 업무를 만드는 것보다 메모가 안전하다.`;

async function classifyIntent(text) {
  const r = await callLLM({
    purpose: 'task_plan',
    json: true,
    messages: [
      { role: 'system', content: INTENT_SYSTEM },
      { role: 'user', content: text.slice(0, 1000) },
    ],
    fallback: JSON.stringify({ kind: 'memo', title: text.slice(0, 80), detail: '', assignee_name: null, when: null, confidence: 0.3 }),
  });
  try {
    const j = JSON.parse(r.content);
    const kind = ['task', 'event', 'memo', 'mail'].includes(j.kind) ? j.kind : 'memo';
    return {
      kind,
      title: String(j.title || text).slice(0, 200),
      detail: String(j.detail || '').slice(0, 1000),
      assignee_name: j.assignee_name ? String(j.assignee_name).slice(0, 50) : null,
      when: j.when ? String(j.when).slice(0, 60) : null,
      confidence: Number(j.confidence) || 0.5,
      fallback: r.fallback,
    };
  } catch {
    return { kind: 'memo', title: text.slice(0, 200), detail: '', assignee_name: null, when: null, confidence: 0.3, fallback: true };
  }
}

// ─────────────────────────────────────────────
// POST /api/voice/capture — 오디오 → 전사 → 의도 (저장하지 않는다)
//   multipart: audio (file), business_id, context(json, 선택)
// ─────────────────────────────────────────────
router.post('/capture',
  authenticateToken,
  ...voiceGuards,
  upload.single('audio'),
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

      const intent = await classifyIntent(stt.text);

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
