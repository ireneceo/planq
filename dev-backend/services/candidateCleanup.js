// N+36 옵션 D — 업무 후보 만료 정책 cron.
//
// 30년차 분석가 결정 (사용자 호소: "오래된 업무 후보 자동 정리"):
//   - 30일 이전 pending 후보 → hidden_at 마크 (기본 list 에서 숨김, "이전 후보 보기" 토글로 회복 가능)
//   - 90일 이전 rejected 또는 60일 이전 hidden 후보 → hard delete (DB 위생)
//
// 매일 03:00 (워크스페이스 영업 시간 외) 1회 실행.

const cron = require('node-cron');
const { Op } = require('sequelize');
const { TaskCandidate } = require('../models');

const HIDE_AFTER_DAYS = 30;       // pending 후보 hide
const DELETE_REJECTED_AFTER_DAYS = 90;  // rejected 영구 삭제
const DELETE_HIDDEN_AFTER_DAYS = 60;    // hidden + 60일 이상 → 영구 삭제

async function runCleanup() {
  try {
    const now = Date.now();
    const hideCutoff = new Date(now - HIDE_AFTER_DAYS * 24 * 3600 * 1000);
    const deleteRejectedCutoff = new Date(now - DELETE_REJECTED_AFTER_DAYS * 24 * 3600 * 1000);
    const deleteHiddenCutoff = new Date(now - DELETE_HIDDEN_AFTER_DAYS * 24 * 3600 * 1000);

    // 1) 30일 이전 pending → hidden_at 마크
    const [hiddenCount] = await TaskCandidate.update(
      { hidden_at: new Date() },
      { where: { status: 'pending', hidden_at: null, extracted_at: { [Op.lt]: hideCutoff } } }
    );

    // 2) 90일 이전 rejected → hard delete
    const rejectedDeleted = await TaskCandidate.destroy({
      where: { status: 'rejected', resolved_at: { [Op.lt]: deleteRejectedCutoff } },
    });

    // 3) hidden 60일 이상 → hard delete
    const hiddenDeleted = await TaskCandidate.destroy({
      where: { hidden_at: { [Op.lt]: deleteHiddenCutoff } },
    });

    console.log(`[candidateCleanup] hidden:${hiddenCount} rejected_deleted:${rejectedDeleted} hidden_deleted:${hiddenDeleted}`);
  } catch (e) {
    console.warn('[candidateCleanup] failed:', e.message);
  }
}

function initCandidateCleanupCron() {
  // 매일 03:00 KST (서버는 UTC, cron 은 서버 시각 기준 — 'Asia/Seoul' 옵션 지원하면 명시)
  cron.schedule('0 3 * * *', runCleanup, { timezone: 'Asia/Seoul' });
  console.log('[candidateCleanup] cron registered (daily 03:00 KST)');
}

module.exports = { initCandidateCleanupCron, runCleanup };
