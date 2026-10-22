#!/usr/bin/env node
// close-deployed-feedback — 배포된 피드백을 장부에서 닫는다 (운영 #276). 멱등.
//
// 왜 이게 필요한가 (2026-08-18 실측):
//   운영 피드백 67건 중 **29건이 이미 고쳐져 배포까지 끝났는데 status='pending'** 이었다.
//   그래서 같은 것이 반복 신고됐다 — 팝아웃 핀은 #258 → #280 → #286 으로 **세 번**.
//   사용자 입장에선 "말해도 아무 반응이 없다" 이고, 개발 입장에선 이미 고친 걸 또 조사한다.
//   고친 사실이 사용자에게 **도달**해야 비로소 처리된 것이다.
//
// 무엇을 하는가
//   커밋 메시지에서 `#숫자` 를 긁어 그 피드백을 done 으로 닫고 답글을 단다.
//   답글은 사람이 쓴다 — 이 스크립트는 **답글이 이미 있는 건만** 닫는다.
//   ★ 2026-10-22 승인 체계 — 닫는 판정은 services/feedbackStatus.deployCloseDecision 한 곳:
//     반영중(in_progress ∧ 승인) 만 닫는다. 승인 전(접수·검토중)은 건너뛰고 «승인 전» 으로 보고한다.
//     예외(시한부): 승인 체계 전에 «고쳤지만 배포 전» 으로 단 옛 검토중(답글 ∧ 승인 기록 없음 ∧ approval_since 이전)은 옛 규칙대로 닫는다.
//   답글 없이 status 만 바꾸면 사용자는 여전히 "왜 닫혔는지" 를 모른다.
//
// 사용 — **2단**이다. 운영 서버엔 git 저장소가 없다(rsync 배포)이고, 장부는 운영 DB 에 있다.
//   ① dev 에서 번호 뽑기:
//        node scripts/close-deployed-feedback.js --range 6b3f4590..HEAD
//      → 커밋 메시지의 `#숫자` 를 긁어 목록을 출력한다 (DB 접속 없음).
//   ② 운영에서 닫기:
//        ssh irene@87.106.78.146 'cd /opt/planq/backend && node /tmp/cdf.js --ids 274,239 --apply'
//      (스크립트를 /tmp 로 복사해 쓴다. --ids 모드는 git 을 쓰지 않는다.)
//   기본은 **dry-run**. --apply 를 줘야 실제로 쓴다.
//   자동 실행하지 않는다 — "무엇이 닫히는지" 를 눈으로 본 뒤 닫는 게 이 기능의 목적이다.
const { execSync } = require('child_process');

const args = process.argv.slice(2);
const APPLY = args.includes('--apply');
const rangeIdx = args.indexOf('--range');
const RANGE = rangeIdx >= 0 ? args[rangeIdx + 1] : null;
const idsIdx = args.indexOf('--ids');
const IDS = idsIdx >= 0 ? String(args[idsIdx + 1] || '').split(',').map(Number).filter(Boolean) : null;

if (!RANGE && !IDS) {
  console.error('사용: --range <git-range>  (dev, 번호 뽑기)  |  --ids 274,239 [--apply]  (운영, 닫기)');
  process.exit(1);
}

function feedbackIdsFromCommits(range) {
  const log = execSync(`git log --format=%B ${range}`, { cwd: '/opt/planq', encoding: 'utf8' });
  const ids = new Set();
  // `#123` 형태만. 3자리 이상으로 좁혀 이슈번호 오탐(#1 같은 것)을 줄인다.
  for (const m of log.matchAll(/#(\d{3,4})\b/g)) ids.add(Number(m[1]));
  return [...ids].sort((a, b) => a - b);
}

async function main() {
  // ① 번호 뽑기 모드 — git 만 쓰고 끝난다(dev 에서 실행).
  if (RANGE) {
    const ids = feedbackIdsFromCommits(RANGE);
    if (ids.length === 0) {
      console.log(`[close-deployed-feedback] ${RANGE} 에서 피드백 번호를 찾지 못했습니다.`);
      process.exit(0);
    }
    console.log(`[close-deployed-feedback] 범위 ${RANGE} · 후보 ${ids.length}건`);
    console.log(`  번호: ${ids.map((i) => '#' + i).join(' ')}`);
    console.log(`\n운영에서 닫기:\n  --ids ${ids.join(',')} --apply`);
    process.exit(0);
  }

  // ② 닫기 모드 — DB 만 쓴다(운영에서 실행). git 을 부르지 않는다.
  const ids = IDS;
  console.log(`[close-deployed-feedback] 대상 ${ids.length}건: ${ids.map((i) => '#' + i).join(' ')}`);

  // dev(/opt/planq/dev-backend) 와 운영(/opt/planq/backend) 양쪽에서 돌아야 한다.
  const fs = require('fs');
  const base = fs.existsSync('/opt/planq/backend/models') ? '/opt/planq/backend' : '/opt/planq/dev-backend';
  const { FeedbackItem } = require(`${base}/models`);
  const { sequelize } = require(`${base}/config/database`);
  const { deployCloseDecision, approvalSince } = require(`${base}/services/feedbackStatus`);
  const since = await approvalSince(sequelize);
  const rows = await FeedbackItem.findAll({ where: { id: ids } });
  const byId = new Map(rows.map((r) => [r.id, r]));

  const toClose = [];
  const skipped = [];
  const legacy = [];
  for (const id of ids) {
    const r = byId.get(id);
    if (!r) { skipped.push(`#${id} DB에 없음`); continue; }
    // ★ 답글 없이 닫지 않는다. 닫힌 이유를 모르는 사용자에게는 무시당한 것과 같다(판정 함수 안).
    const d = deployCloseDecision(r, since);
    if (!d.close) { skipped.push(`#${id} ${d.reason}`); continue; }
    if (d.legacy) legacy.push(id);
    toClose.push(r);
  }

  console.log(`\n닫을 건 ${toClose.length}: ${toClose.map((r) => '#' + r.id + (legacy.includes(r.id) ? '(옛 규칙)' : '')).join(' ') || '(없음)'}`);
  {
    // 시한부 호환이 얼마나 남았나 — 0 이 되면 deployCloseDecision 의 옛 규칙 분기를 지운다
    const [[n]] = await sequelize.query(`SELECT COUNT(*) n FROM feedback_items WHERE parent_id IS NULL AND status = 'reviewing'
      AND approved_at IS NULL AND admin_response IS NOT NULL AND TRIM(admin_response) <> ''${since ? ' AND responded_at < :since' : ''}`,
    { replacements: { since } });
    console.log(`옛 규칙 대상(승인 체계 전 답글 달린 검토중) 남은 수: ${n.n}${since ? '' : ' (approval_since 없음 — 마이그레이션 전)'}`);
  }
  if (skipped.length) console.log(`건너뜀 ${skipped.length}:\n  ${skipped.join('\n  ')}`);

  if (!APPLY) {
    console.log('\n(dry-run — 실제로 닫으려면 --apply)');
    process.exit(0);
  }
  for (const r of toClose) {
    await r.update({ status: 'done', responded_at: r.responded_at || new Date() });
  }
  console.log(`\n✅ ${toClose.length}건 done 처리 완료`);
  process.exit(0);
}

main().catch((e) => { console.error('[close-deployed-feedback] 오류:', e.message); process.exit(1); });
