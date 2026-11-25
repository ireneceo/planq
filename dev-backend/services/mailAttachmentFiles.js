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

// ─── 검색에서 쓰는 조각 (2026-11-25, Irene «문서/파일 검색할 때 메일에 있는 게 나오네 … 메일파일까지 검색하기 체크» · Fable 설계 A) ───
//   id 목록 `NOT IN` 은 워크스페이스마다 수천 개라(dev ws5 2,180) 검색에 쓰지 않고 **서브쿼리**로 판정한다.
//   ★ 컬럼에 모델 자격(`File`.)을 붙인다 — 폴더 조인이 있는 쿼리에서 id 가 ambiguous 로 500 이 된다(access_scope 전례).
//   ★ files.business_id 는 바깥 where(fileListWhereByLevel)가 건다 — email_attachments 는 같은 file_id 를 남의 테넌트와 나누지 않는다.
const MAIL_ATTACHMENT_SQL = (alias) => `EXISTS (SELECT 1 FROM email_attachments ea WHERE ea.file_id = \`${alias}\`.\`id\`)`;

/** «메일 첨부 보관분이다» — where 의 Op.and 에 그대로 넣는다. */
function mailAttachmentLiteral(alias = 'File') { return sequelize.literal(MAIL_ATTACHMENT_SQL(alias)); }
/** «메일 첨부 보관분이 아니다». 검색 기본값. */
function notMailAttachmentLiteral(alias = 'File') { return sequelize.literal(`NOT ${MAIL_ATTACHMENT_SQL(alias)}`); }

// 서명·아이콘·배너 — «메일 첨부 포함» 을 골라도 검색에는 안 낸다(메일 화면에서는 그대로 보인다).
//   판정은 수집 때 쓰는 본문 장식 규칙(emailImapCron.isBodyDecoration)과 같은 선: 20KB 미만 이미지 또는 inline.
//   is_inline 은 수신 서버가 cid 를 치환해 거의 늘 거짓이라(dev 4,927건 중 6건) 크기가 주 판정이다.
const MAIL_NOISE_MAX_BYTES = 20 * 1024;
function notMailNoiseLiteral(alias = 'File') {
  return sequelize.literal(`NOT (${MAIL_ATTACHMENT_SQL(alias)} AND \`${alias}\`.\`mime_type\` LIKE 'image/%' AND (\`${alias}\`.\`file_size\` < ${MAIL_NOISE_MAX_BYTES} OR EXISTS (SELECT 1 FROM email_attachments ea2 WHERE ea2.file_id = \`${alias}\`.\`id\` AND ea2.is_inline = 1)))`);
}
/** 화면(Q file)이 같은 선으로 거를 수 있게 같은 숫자를 싣는다. */
function isMailNoise({ mime_type, file_size }) {
  return String(mime_type || '').startsWith('image/') && Number(file_size || 0) < MAIL_NOISE_MAX_BYTES;
}

/** 메일 첨부 파일을 이 사람에게 보여 줄 수 있는가 — **메일을 읽을 수 있는 사람만**(Fable 설계 A-③).
 *  회사 메일함 첨부는 L3 라 파일 술어만으로는 Q mail 메뉴가 «숨김» 인 멤버에게도 보였다(권한 구멍).
 *  메일 목록 라우트의 requireMenu('qmail') 와 같은 축(menuAllows). 고객은 언제나 false.
 *  개인 메일함 첨부는 L1(주인만)이라 파일 술어가 이미 막는다. */
async function mailFilesAllowed(businessId, user, isClient) {
  if (isClient || !user) return false;
  return require('../middleware/menu_permission').menuAllows(businessId, user, 'qmail', 'read');
}

/** 첨부 파일 id → 그 메일 스레드 id (검색 결과를 누르면 원 메일로 간다). 파일 하나가 여러 메일에 걸리면 가장 최근 것. */
async function mailThreadOfFiles(businessId, fileIds) {
  const ids = (fileIds || []).map(Number).filter(Boolean);
  if (!ids.length) return new Map();
  const [rows] = await sequelize.query(
    `SELECT ea.file_id AS file_id, MAX(em.thread_id) AS thread_id
       FROM email_attachments ea
       JOIN email_messages em ON em.id = ea.message_id
       JOIN files f ON f.id = ea.file_id
      WHERE ea.file_id IN (:ids) AND f.business_id = :biz
      GROUP BY ea.file_id`,
    { replacements: { ids, biz: Number(businessId) } },
  );
  return new Map(rows.map((r) => [Number(r.file_id), Number(r.thread_id) || null]));
}

module.exports = {
  mailAttachmentFileIds, excludeMailAttachmentsWhere,
  mailAttachmentLiteral, notMailAttachmentLiteral, notMailNoiseLiteral, isMailNoise, MAIL_NOISE_MAX_BYTES,
  mailFilesAllowed, mailThreadOfFiles,
};
