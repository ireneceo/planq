// 파일 보존 판정 — "이 파일의 바이트를 지워도 되는가" (2026-08-25).
//
// 문서 버전 기록이 참조하는 파일을 지우면, 옛 버전으로 되돌려도 이미지가 깨진다.
// 버전 기록이 "되돌릴 수 있다" 고 약속해 놓고 못 지키는 셈이 되므로 보존한다.
// (Notion 도 이력이 참조하는 파일을 보관한다. 목록에서는 soft-delete 로 사라진다.)
//
// ★ 판정에 실패하면 **보존 쪽으로 기운다** — 되살릴 수 없는 삭제보다 남는 편이 낫다.
const path = require('path');
const { Op } = require('sequelize');

/**
 * 문서 버전 기록이 이 파일을 참조하는가.
 * 본문 인라인 이미지는 content_json 안 URL(`/api/posts/editor-image/<파일명>`),
 * 하단 첨부는 리비전의 attachment_file_ids 에 있다.
 */
async function isReferencedByPostRevision(file, transaction = undefined) {
  try {
    const { PostRevision } = require('../models');
    const basename = path.basename(file.file_path || '');
    if (!basename) return true;                      // 경로를 모르면 판단 불가 → 보존
    const hit = await PostRevision.findOne({
      where: {
        business_id: file.business_id,
        [Op.or]: [
          { content_json: { [Op.like]: `%${basename}%` } },
          { attachment_file_ids: { [Op.like]: `%${file.id}%` } },
        ],
      },
      attributes: ['id'],
      transaction,
    });
    return !!hit;
  } catch (e) {
    console.warn('[fileRetention] 참조 확인 실패 — 물리 삭제 보류:', e.message);
    return true;
  }
}

module.exports = { isReferencedByPostRevision };
