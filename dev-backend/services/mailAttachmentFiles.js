// 메일 첨부로 들어온 `files` 행은 **Q file 목록에 넣지 않는다.**
//
// Irene 2026-09-20: *"메일 본문에서 자료 가져올 필요없어. 첨부하는 파일들만 관리하자.
// 메일에 첨부된것도 굳이 따로 저장할 필요 없어. 다운로드나 이 워크스페이스에 저장하기가 있으면 어때?"*
//
// 운영 실측(2026-09-20): Q file 1,151건 중 **891건(77%)이 메일에서 온 것**이고, 그 중 이미지
// 605건의 **79%가 20KB 미만**(서명·아이콘·배너)이었다. `icon.png` 가 219회, 아웃룩 서명 59회.
// 자료를 찾으러 온 사람이 장식 이미지를 헤집게 된다.
//
// ★ **바이트는 계속 보관한다.** `email_attachments` 에는 저장 필드가 없어서 첨부의 실체는
//   `files` 행 하나뿐이다 — 그 행을 없애면 **메일에서 첨부를 못 받는다.** 그래서 지우지 않고
//   «목록에서 숨긴다». 되돌릴 수 있는 방향이다(지우는 것은 되돌릴 수 없다).
// ★ 컬럼을 더하지 않고 **파생으로 판정한다** — "그 File 이 email_attachments 에 걸려 있는가".
//   [이 워크스페이스에 저장] 은 **새 File 행**을 만들므로(같은 물리 파일·ref_count 증가)
//   그 행은 email_attachments 에 없고, 따라서 자연스럽게 목록에 나타난다.
const { Op } = require('sequelize');
const { sequelize } = require('../config/database');

/** 이 워크스페이스에서 «메일 첨부 보관분» 인 files.id 집합.
 *  ★ 워크스페이스로 범위를 건다 — 전역으로 긁으면 남의 테넌트 id 가 섞이고,
 *    그 id 가 우연히 겹치면 이쪽 파일이 사라진다. */
async function mailAttachmentFileIds(businessId) {
  const [rows] = await sequelize.query(
    `SELECT DISTINCT ea.file_id AS id
       FROM email_attachments ea
       JOIN files f ON f.id = ea.file_id
      WHERE ea.file_id IS NOT NULL AND f.business_id = :biz`,
    { replacements: { biz: Number(businessId) } },
  );
  return rows.map((r) => Number(r.id)).filter(Boolean);
}

/** File 조회 where 에 끼울 조각. 빈 집합이면 `null` 을 돌려주니 호출부가 그때만 건너뛴다.
 *  (빈 배열을 `{ [Op.notIn]: [] }` 로 넣으면 MySQL 이 전부 거짓으로 읽는 판이 있다.) */
async function excludeMailAttachmentsWhere(businessId) {
  const ids = await mailAttachmentFileIds(businessId);
  return ids.length ? { id: { [Op.notIn]: ids } } : null;
}

module.exports = { mailAttachmentFileIds, excludeMailAttachmentsWhere };
