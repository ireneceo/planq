// 월간 보고서 자동 생성 (매월 1일).
//
// 왜 server.js 밖으로 뺐나 — 이 함수는 **한 달에 하루만** 돈다. server.js 안에 있고
// export 도 안 돼 있어서 검증할 방법이 없었고, 그래서 존재하지 않는 컬럼을 참조해
// 매번 throw 하며 **한 번도 돌지 않은 것을 아무도 몰랐다**(운영 reports 0행).
// 서비스로 빼서 언제든 호출·검증할 수 있게 한다.
const reportGenerator = require('./report_generator');

// 매월 1일 — 워크스페이스별 전월 보고서 자동 생성.
//
// ★ 여태 한 번도 돌지 않았다 (2026-08-17 발견). `where: { status: 'active' }` 가
//   **존재하지 않는 컬럼**을 참조해 매번 throw 했고, 호출부 catch 가 그것을 삼켰다.
//   운영 `reports` 테이블이 0행인 것으로 확인됨. 실제 컬럼명은 `subscription_status` 다.
//   (memory feedback_completed_but_dead_features — "완료" 인데 조용히 죽어 있던 계열)
//
// 대상: 삭제되지 않고 잠기지 않은(canceled 아닌) 워크스페이스.
//   canceled = 미결제로 잠긴 상태라 사용자가 열어볼 수도 없다 — 만들어도 못 본다.
//   결제 면제 워크스페이스는 백필/토글이 subscription_status='active' 로 두므로 자연히 포함된다.
//
// today 파라미터: 기본은 오늘. 검증에서 1일을 넘겨 실제 생성 경로를 태우기 위해 열어둔다
//   (안 열어두면 한 달에 하루만 검증 가능해 또 죽어도 모른다).
async function runMonthlyReportsIfDay1(today = new Date()) {
  if (today.getDate() !== 1) return { skipped: true, reason: 'not_day_1' };
  const { Op } = require('sequelize');
  const { Business, Report } = require('../models');
  const businesses = await Business.findAll({
    where: {
      deleted_at: null,
      // ★ Op.ne 만 쓰면 subscription_status 가 NULL 인 행이 **조용히 제외**된다(SQL NULL 비교).
      //   컬럼이 nullable 이라 언젠가 NULL 이 생기면 그 워크스페이스만 보고서가 안 나온다.
      [Op.or]: [
        { subscription_status: { [Op.ne]: 'canceled' } },
        { subscription_status: null },
      ],
    },
    attributes: ['id'],
  });
  const period = reportGenerator.computePeriod('monthly', today);
  let ok = 0, dup = 0, fail = 0, retried = 0;
  for (const biz of businesses) {
    // 동일 기간 monthly 이미 있으면 skip (재시작 안전)
    // ★ **완성된(ready) 보고서만** 중복으로 친다 (Fable 치명).
    //   status 를 안 보면 `generating`(도중에 죽은 행)·`failed`(렌더 실패 행)가 dup 으로 세어져
    //   그 워크스페이스는 그 달 보고서를 **영영 못 받는다**. 이 cron 은 한 달에 한 번만 도니
    //   일시 실패 1회가 곧 영구 결손이다 — 이 수리가 끝내려던 바로 그 질병이다.
    //   재시도 시 옛 미완 행은 지워서 쌓이지 않게 한다.
    const exists = await Report.findOne({
      where: { business_id: biz.id, kind: 'monthly', period_start: period.from, period_end: period.to, status: 'ready' },
      attributes: ['id'],
    });
    if (exists) { dup += 1; continue; }
    const stale = await Report.findAll({
      where: {
        business_id: biz.id, kind: 'monthly', period_start: period.from, period_end: period.to,
        status: { [Op.ne]: 'ready' },
      },
      attributes: ['id'],
    });
    if (stale.length) {
      await Report.destroy({ where: { id: stale.map((r) => r.id) } });
      retried += stale.length;
    }
    try {
      await reportGenerator.generateReport({ businessId: biz.id, kind: 'monthly', period });
      ok += 1;
    } catch (e) {
      console.warn('[monthly-report] business', biz.id, 'failed', e.message);
      fail += 1;
    }
  }
  // 실패가 조용히 묻히지 않게 — 이 cron 이 수개월 죽어 있던 통로가 바로 '경고만 찍고 끝' 이었다.
  if (fail > 0) {
    try {
      const { notifyPlatformAdmins } = require('./platformNotify');
      await notifyPlatformAdmins({
        eventKind: 'system',
        title: `월간 보고서 생성 실패 ${fail}건`,
        body: `${period.from}~${period.to} 월간 보고서 ${fail}건이 생성되지 않았습니다(성공 ${ok} · 재시도 ${retried}). 서버 로그를 확인하세요.`,
      }).catch(() => null);
    } catch { /* noop */ }
  }
  return { ok, dup, fail, retried, period };
}

module.exports = { runMonthlyReportsIfDay1 };
