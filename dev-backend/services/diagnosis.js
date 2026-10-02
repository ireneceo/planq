// 무료 업무체계 자가진단 (#426) — 문항 구조·채점의 **한 곳**.
//
//   설계 docs/FREE_DIAGNOSIS_DESIGN.md. 6개 층 × 2문항, 3지선다(0/1/2점). 층 점수 = 두 문항 합(0~4).
//   ★ 점수는 **서버가 센다** — 화면이 보낸 점수를 믿지 않는다(답만 받는다). 화면은 받은 점수를 그린다.
//   ★ 문항 글자는 화면 i18n(landing.json diagnosisPage)이 정본이다. 여기는 id·층·선택지 수만 안다.
//     결과 메일에 쓰는 층 이름만 여기 둔다(메일은 서버가 만든다).
const LAYERS = ['structure', 'workflow', 'information', 'decision', 'automation', 'platform'];
const QUESTIONS = [
  { id: 'S1', layer: 'structure' }, { id: 'S2', layer: 'structure' },
  { id: 'W1', layer: 'workflow' }, { id: 'W2', layer: 'workflow' },
  { id: 'I1', layer: 'information' }, { id: 'I2', layer: 'information' },
  { id: 'D1', layer: 'decision' }, { id: 'D2', layer: 'decision' },
  { id: 'A1', layer: 'automation' }, { id: 'A2', layer: 'automation' },
  { id: 'P1', layer: 'platform' }, { id: 'P2', layer: 'platform' },
];
const INDUSTRIES = ['agency', 'consulting', 'it', 'commerce', 'other'];
const TEAM_SIZES = ['1-5', '6-20', '21-50', '50+'];

const LAYER_NAMES = {
  ko: { structure: '업무구조', workflow: '업무흐름', information: '정보흐름', decision: '의사결정', automation: '자동화', platform: '구현 플랫폼' },
  en: { structure: 'Business Structure', workflow: 'Workflow', information: 'Information', decision: 'Decision', automation: 'Automation', platform: 'Platform' },
};

const band = (s) => (s <= 1 ? 'low' : s <= 3 ? 'mid' : 'high');

/**
 * 답 → 점수. 답은 **12개 전부**, 각 0~2 정수여야 한다. 모르는 키·빠진 키는 거절한다.
 * @returns {{ ok:true, scores, total, weakest, bands } | { ok:false, code }}
 */
function score(answers) {
  if (!answers || typeof answers !== 'object' || Array.isArray(answers)) return { ok: false, code: 'answers_required' };
  const keys = Object.keys(answers);
  if (keys.length !== QUESTIONS.length || !QUESTIONS.every((q) => keys.includes(q.id))) return { ok: false, code: 'answers_incomplete' };
  const scores = Object.fromEntries(LAYERS.map((l) => [l, 0]));
  for (const q of QUESTIONS) {
    const v = answers[q.id];
    if (!Number.isInteger(v) || v < 0 || v > 2) return { ok: false, code: 'answer_invalid' };
    scores[q.layer] += v;
  }
  const total = Object.values(scores).reduce((a, b) => a + b, 0);
  // 가장 먼저 손볼 곳 — 점수가 가장 낮은 층(같으면 층 순서가 앞인 것: 구조가 흐름보다 먼저다)
  const weakest = [...LAYERS].sort((a, b) => scores[a] - scores[b] || LAYERS.indexOf(a) - LAYERS.indexOf(b))[0];
  const bands = Object.fromEntries(LAYERS.map((l) => [l, band(scores[l])]));
  return { ok: true, scores, total, weakest, bands };
}

/**
 * 관리자 통계 — 최근 days 일. **플랫폼 공통 표**다(diagnosis_responses 에 워크스페이스 칸이 없다 — 가입 전 방문자의 응답).
 *   부르는 곳은 platform_admin 전용 라우트 하나뿐이다. 상한 5000행(넘으면 capped).
 */
async function stats(days) {
  const { Op } = require('sequelize');
  const { DiagnosisResponse } = require('../models');
  const d = Math.min(365, Math.max(1, Number(days) || 90));
  const CAP = 5000;
  const rows = await DiagnosisResponse.findAll({
    where: { created_at: { [Op.gte]: new Date(Date.now() - d * 86400000) } },
    attributes: ['scores', 'weakest', 'industry', 'team_size', 'email'], limit: CAP, order: [['id', 'DESC']],
  });
  const count = rows.length;
  const avg = Object.fromEntries(LAYERS.map((l) => [l, count ? Math.round((rows.reduce((a, x) => a + (Number(x.scores?.[l]) || 0), 0) / count) * 10) / 10 : 0]));
  const tally = (key) => rows.reduce((m, x) => { const k = x[key] || 'none'; m[k] = (m[k] || 0) + 1; return m; }, {});
  return {
    days: d, count, with_email: rows.filter((x) => x.email).length, capped: count >= CAP,
    avg, weakest: tally('weakest'), industry: tally('industry'), team_size: tally('team_size'),
  };
}

module.exports = { LAYERS, QUESTIONS, INDUSTRIES, TEAM_SIZES, LAYER_NAMES, score, band, stats };
