#!/usr/bin/env node
// 문서 버전이 놓아준 파일 회수 (GC) — 2026-08-25.
//
// 왜 필요한가: 버전 기록이 참조하는 파일은 물리 삭제를 보류한다(routes/files.js softDeleteFile).
//   그 버전이 상한(50개)에 밀려 사라지면 파일은 **아무도 참조하지 않는 고아**로 남는다.
//   정석은 "참조 계수 + 지연 회수" 다 — git 의 gc.pruneExpire, S3 lifecycle 과 같은 모델.
//
// 안전 원칙 (이 스크립트는 파일을 지운다):
//   ① 기본은 **미리보기**. 실제 삭제는 --apply 를 줘야만 한다.
//   ② 유예 기간 — 지운 지 GRACE_DAYS 가 지난 것만 본다(복원·업로드 경합 회피).
//   ③ 참조 검사는 **넓게, 실패하면 보류**. 하나라도 확실하지 않으면 남긴다.
//      되살릴 수 없는 삭제보다 남는 편이 언제나 낫다.
//   ④ 대상은 **포스트에 붙었던 파일**뿐 — 업무·채팅 첨부는 이 스크립트가 건드리지 않는다.
require('dotenv').config();
const fs = require('fs');
const path = require('path');
const { Op } = require('sequelize');
const { File, Post, PostAttachment, PostRevision } = require('../models');

const GRACE_DAYS = 30;
const BATCH = 200;

const apply = process.argv.includes('--apply');
const verbose = process.argv.includes('--verbose');

async function isReferenced(file) {
  const basename = path.basename(file.file_path || '');
  if (!basename) return true;                       // 경로를 모르면 판단 불가 → 보류
  // ① 현재 문서 본문
  //   ★ posts 테이블에는 deleted_at 컬럼이 없다 — 넣으면 쿼리가 예외를 내고,
  //     "실패하면 보류" 규칙 때문에 **모든 파일이 영원히 보류**된다(2026-08-25 반증에서 잡음).
  //     memory feedback_column_reference_must_exist 그대로의 사고였다.
  const inBody = await Post.count({
    where: { business_id: file.business_id, content_json: { [Op.like]: `%${basename}%` } },
  });
  if (inBody > 0) return true;
  // ② 현재 첨부 목록
  const inAttach = await PostAttachment.count({ where: { file_id: file.id } });
  if (inAttach > 0) return true;
  // ③ 버전 기록 (본문 스냅샷 + 첨부 스냅샷)
  const inRev = await PostRevision.count({
    where: {
      business_id: file.business_id,
      [Op.or]: [
        { content_json: { [Op.like]: `%${basename}%` } },
        { attachment_file_ids: { [Op.like]: `%${file.id}%` } },
      ],
    },
  });
  if (inRev > 0) return true;
  // ④ 같은 실물을 가리키는 다른 File row (dedup)
  const siblings = await File.count({
    where: { file_path: file.file_path, deleted_at: null, id: { [Op.ne]: file.id } },
  });
  return siblings > 0;
}

(async () => {
  const cutoff = new Date(Date.now() - GRACE_DAYS * 24 * 60 * 60 * 1000);
  const candidates = await File.findAll({
    where: {
      storage_provider: 'planq',
      deleted_at: { [Op.ne]: null, [Op.lt]: cutoff },
      ref_count: { [Op.lte]: 0 },
    },
    limit: BATCH,
    order: [['deleted_at', 'ASC']],
  });

  let freed = 0; let removed = 0; let kept = 0; let missing = 0;
  for (const f of candidates) {
    let referenced;
    try { referenced = await isReferenced(f); }
    catch (e) { referenced = true; console.warn(`  ! 참조 확인 실패 → 보류 (file ${f.id}): ${e.message}`); }
    if (referenced) { kept += 1; if (verbose) console.log(`  · 보류 file ${f.id} — 아직 참조 중`); continue; }
    if (!f.file_path || !fs.existsSync(f.file_path)) { missing += 1; continue; }
    const size = (() => { try { return fs.statSync(f.file_path).size; } catch { return 0; } })();
    if (apply) {
      try { fs.unlinkSync(f.file_path); removed += 1; freed += size; }
      catch (e) { console.warn(`  ! 삭제 실패 file ${f.id}: ${e.message}`); }
    } else {
      removed += 1; freed += size;
      if (verbose) console.log(`  [dry] 회수 대상 file ${f.id} — ${f.file_name} (${size} bytes)`);
    }
  }

  const mb = (freed / 1024 / 1024).toFixed(2);
  console.log(`\n검사 ${candidates.length}건 (유예 ${GRACE_DAYS}일 경과분)`);
  console.log(`  회수 ${apply ? '완료' : '대상'}: ${removed}건 · ${mb} MB`);
  console.log(`  보류(아직 참조 중): ${kept}건`);
  console.log(`  이미 없음: ${missing}건`);
  if (!apply) console.log('\n※ 미리보기입니다. 실제 삭제하려면 --apply 를 붙이세요.');
  process.exit(0);
})().catch((e) => { console.error('오류:', e.message); process.exit(1); });
