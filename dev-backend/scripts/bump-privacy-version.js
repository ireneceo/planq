// 개인정보처리방침 버전 올리기 — 배포 슬롯에서 돈다. 멱등.
//   2026-10-07 Irene: "배포할 때 전달되게 해야지." — 방침 문구를 바꾼 배포에서 버전을 손으로 올리는 단계가
//   빠지면, 사용자는 바뀐 방침에 다시 동의할 기회를 받지 못한다(재동의 창은 platform_settings.privacy_version 이 바뀔 때 뜬다).
//
//   이번 변경(1.3): Cue 질문 기록 보관(90일)·주제 통계·가명 원문 30일(opt-in) · 구글 캘린더 «구독 캘린더 목록(읽기)».
//   ★ 버전을 낮추지 않는다 — 운영 값이 이미 같거나 높으면 아무것도 안 한다(관리자 화면에서 먼저 올렸을 수 있다).
//   롤백: 관리자 화면(플랫폼 설정)에서 예전 값으로 되돌린다. 단 이미 재동의한 사용자의 기록은 그대로 남는다.
const TARGET = '1.3';
const { sequelize } = require('../config/database');

const cmp = (a, b) => {
  const pa = String(a || '0').split('.').map((x) => Number(x) || 0);
  const pb = String(b || '0').split('.').map((x) => Number(x) || 0);
  for (let i = 0; i < Math.max(pa.length, pb.length); i += 1) {
    const d = (pa[i] || 0) - (pb[i] || 0);
    if (d) return d;
  }
  return 0;
};

(async () => {
  try {
    const [rows] = await sequelize.query('SELECT id, privacy_version FROM platform_settings ORDER BY id LIMIT 1');
    if (!rows.length) { console.log('[bump-privacy-version] platform_settings 행 없음 — 건너뜀'); process.exit(0); }
    const cur = rows[0].privacy_version;
    if (cmp(cur, TARGET) >= 0) {
      console.log(`[bump-privacy-version] 현재 ${cur} ≥ ${TARGET} — 변경 없음`);
    } else {
      await sequelize.query('UPDATE platform_settings SET privacy_version = ?, updated_at = NOW() WHERE id = ?', { replacements: [TARGET, rows[0].id] });
      // 감사는 공용 writeAudit 한 곳으로 — 보관 스탬프(retain_until)를 그 함수가 붙인다(손으로 INSERT 하면 빠진다).
      await require('../services/auditService').writeAudit({
        action: 'platform.privacy_version_bump', targetType: 'platform_settings', targetId: rows[0].id,
        oldValue: { privacy_version: cur }, newValue: { privacy_version: TARGET, by: 'deploy' },
      }).catch((e) => console.warn('[bump-privacy-version] 감사 기록 실패:', e.message));
      console.log(`[bump-privacy-version] ${cur} → ${TARGET}`);
    }
    const [after] = await sequelize.query('SELECT privacy_version FROM platform_settings ORDER BY id LIMIT 1');
    if (cmp(after[0].privacy_version, TARGET) < 0) { console.error('[bump-privacy-version] 올라가지 않음'); process.exit(1); }
    await sequelize.close(); process.exit(0);
  } catch (e) { console.error('[bump-privacy-version] 실패:', e.message); process.exit(1); }
})();
