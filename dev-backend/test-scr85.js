// #85 E2E — SCR executive summary 생성. 임시 draft unit → 생성 → 삭제. 실행 후 삭제.
const BASE = 'http://localhost:3003';
const { ReportUnit } = require('./models');
async function j(m, p, t, b) {
  const r = await fetch(BASE + p, { method: m, headers: { 'Content-Type': 'application/json', ...(t ? { Authorization: 'Bearer ' + t } : {}) }, body: b ? JSON.stringify(b) : undefined });
  let d = null; try { d = await r.json(); } catch {}
  return { status: r.status, data: d };
}
const BIZ = 5;
(async () => {
  const snapshot = {
    schema_version: 1,
    kpi: { total_tasks: 12, completed_tasks: 7, in_progress_count: 3, overdue_count: 2, completed_in_period: 7 },
    highlights: [{ title: '랜딩 페이지 리뉴얼 배포' }, { title: '결제 모듈 1차 연동 완료' }, { title: '고객 온보딩 문서 작성' }],
    in_progress: [{ title: '모바일 반응형 개선' }, { title: 'Q Bill 세금계산서 자동화' }],
    risks: [{ title: 'iOS 푸시 미도착 (외부 의존)' }, { title: 'Google OAuth 검증 지연' }],
    blockers: [{ title: '디자인 시안 컨펌 대기' }],
    next: [{ title: '모바일 반응형 QA' }, { title: '구독 결제 베타 오픈' }],
  };
  let unit = null;
  try {
    unit = await ReportUnit.create({
      business_id: BIZ, scope: 'member', scope_ref_id: 5,
      period_type: 'weekly', period_start: '2020-01-06', status: 'draft',
      auto_snapshot: snapshot,
    });
    const lg = await j('POST', '/api/auth/login', null, { email: 'health-check@planq.kr', password: 'HealthCheck2026!' });
    const tk = lg.data?.data?.token || lg.data?.token;

    const gen = await j('POST', `/api/reports/${BIZ}/unit/${unit.id}/generate-narrative`, tk, { lang: 'ko' });
    console.log('status:', gen.status);
    const d = gen.data?.data || {};
    console.log('headline:', d.headline);
    console.log('--- narrative ---\n' + (d.narrative || '(none)'));
    const hasSCR = (d.narrative || '').includes('상황') && (d.narrative || '').includes('문제') && (d.narrative || '').includes('해결');
    console.log('\nSCR 구조 포함:', hasSCR, '| headline 있음:', !!d.headline, '| 200:', gen.status === 200);

    // 권한 검증 — 미인증
    const noauth = await j('POST', `/api/reports/${BIZ}/unit/${unit.id}/generate-narrative`, null, {});
    console.log('미인증:', noauth.status, '(401 기대)');

    const pass = gen.status === 200 && hasSCR && !!d.headline && noauth.status === 401;
    process.exitCode = pass ? 0 : 1;
    console.log('\n결과:', pass ? 'PASS' : 'FAIL');
  } finally {
    if (unit) await unit.destroy();
    console.log('임시 unit 삭제 완료');
  }
})().catch(e => { console.error('ERR', e.message); process.exit(1); });
