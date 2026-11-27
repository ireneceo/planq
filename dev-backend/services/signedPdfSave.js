// 서명 완료 문서 «파일로 저장» — 서명본 PDF 를 그 프로젝트의 파일로 (2026-11-27, Fable 설계 DESIGN-OK).
//
// Irene: «서명이 완료된 문서의 경우 pdf 다운로드만 나오는게 아니라 … 파일로 저장이 있어서 프로젝트>파일에 저장되게 해줘.
//   보안은 기본 이상 등급으로, 그래서 구글드라이브에 연결된 경우 이중백업이 되는 개념이야.»
//
// 계약(설계 판정 그대로 — 바꾸려면 Fable 설계를 다시 받는다):
//   · 공개 범위 = 프로젝트(L2, 문서의 project_id) · 보안 등급 = 문서 것 그대로(바닥 «일반»). 저장이 등급을 낮추는 문이 되면 안 된다.
//     일반이면 Drive 미러 정책(gdriveMirror.isEligible)을 그대로 통과해 프로젝트 폴더로 — 이중 백업. 내부·기밀은 Drive 에 안 간다(정책 불변).
//   · 저장본에는 **증명서 장(서명자 이메일·IP)을 넣지 않는다** — 프로젝트 파일은 그 프로젝트 고객·공유 링크·Drive 로 나가는 문이다.
//     증명서 포함본은 종전대로 멤버의 «PDF 다운로드» 에만.
//   · 프로젝트 없는 문서는 저장하지 않는다(409 project_required) — L3 로 넓히지도, 특정 멤버 L2(Drive 안 됨)로 두지도 않는다.
//   · 회차당 1건 — 열쇠 `signed-post:<post_id>:<회차 지문>` 을 files.source_key 에. 살아 있는 행이 있으면 새로 만들지 않는다.
//     재서명(새 회차)은 새 파일, 옛 서명본은 그대로(증빙이라 덮어쓰지도 지우지도 않는다). 휴지통에 넣은 뒤 다시 누르면 새로.
//   · 동시 클릭은 GET_LOCK 한 줄로 — 못 잡으면 409 save_in_progress.
//   · 바이트 → File 은 driveImport.ingestDownloadedFile 한 벌(쿼터·해시·사용량·신호·색인·감사). File.create 를 여기 쓰지 않는다.
//   · 문서 본문·첨부·서명 요청은 한 글자도 바꾸지 않는다(PostAttachment 도 만들지 않는다).
const crypto = require('crypto');
const fs = require('fs');
const { sequelize } = require('../config/database');

const KEY_PREFIX = 'signed-post:';

/** 이번 회차의 요청들(취소·닫힌 회차 제외) — 서명본·진행 칩과 같은 술어(signRoundWhere). */
async function roundRequests(postId) {
  const { SignatureRequest } = require('../models');
  const { signRoundWhere } = require('./signedDocument');
  return SignatureRequest.findAll({
    where: signRoundWhere('post', Number(postId)),
    attributes: ['id', 'status', 'signed_at', 'title_snapshot', 'required_items'],
    order: [['id', 'ASC']],
  });
}

/** 회차 지문 — 요청 id 를 오름차순으로 이어 붙인 문자열의 sha256 앞 16자. 재서명이면 id 가 바뀌어 지문도 바뀐다. */
function roundFingerprint(reqs) {
  const ids = reqs.map((r) => Number(r.id)).sort((a, b) => a - b).join(',');
  return crypto.createHash('sha256').update(ids).digest('hex').slice(0, 16);
}

function sourceKeyOf(postId, reqs) {
  return `${KEY_PREFIX}${Number(postId)}:${roundFingerprint(reqs)}`;
}

/** 파일 이름 — `<고정본 제목> (서명 완료 YYYY-MM-DD).pdf`. 날짜 = 회차의 마지막 서명일(서명 칸과 같은 signDate). */
function fileNameOf(post, reqs, lang) {
  const { signDate } = require('./signedDocument');
  const { toNFC } = require('./filename');
  const base = reqs.find((r) => r.title_snapshot);
  const title = String((base && base.title_snapshot) || post.title || 'document').replace(/[\\/:*?"<>|\r\n\t]+/g, ' ').trim() || 'document';
  const last = reqs.filter((r) => r.signed_at).sort((a, b) => new Date(b.signed_at) - new Date(a.signed_at))[0];
  let ri = last && last.required_items;
  if (typeof ri === 'string') { try { ri = JSON.parse(ri); } catch { ri = null; } }
  const date = last ? signDate(last.signed_at, { ...(ri && typeof ri === 'object' ? ri : {}), date_format: 'ymd' }) : '';
  const tail = lang === 'en' ? ` (signed ${date}).pdf` : ` (서명 완료 ${date}).pdf`;
  const name = `${title.slice(0, 255 - tail.length)}${tail}`;
  return toNFC ? toNFC(name) : name;
}

/** Drive 백업 상태 — 응답·화면 안내 한 줄용. 판정은 미러 정책 그대로(isEligible). */
async function driveBackupState(file) {
  if (file.gdrive_mirror_id) return 'done';
  if (file.security_level && file.security_level !== 'general') return 'excluded_security';
  let token = null;
  try { token = await require('./gdrive').getTokenForBusiness(file.business_id); } catch { token = null; }
  if (!token || !token.root_folder_id) return 'not_connected';
  return require('./gdriveMirror').isEligible(file, token) ? 'queued' : 'excluded_security';
}

const fail = (status, code, extra) => ({ ok: false, status, code, ...(extra || {}) });

const LEVEL_RANK = { general: 0, internal: 1, confidential: 2 };
/** 서명 사본인가 — source_key 열쇠로만 가른다(이 서비스가 만든 것) */
function isSignedCopy(file) {
  return !!(file && typeof file.source_key === 'string' && file.source_key.startsWith(KEY_PREFIX));
}
/**
 * 서명 사본의 보안 등급을 **내릴** 수 있는가 (Fable 완료 검증 FAIL 1 · 2026-11-27).
 *   저장한 사람이 올린 사람(uploader)이 되므로, 그냥 두면 문서 등급을 못 바꾸는 멤버가 사본 등급은 내려
 *   «내부» 계약서를 고객·Drive 로 내보낼 수 있었다. 저장이 등급을 낮추는 문이 되면 안 된다.
 *   · 내리기(rank 감소)만 본다 — 올리기는 누구든 지금 규칙대로.
 *   · 원본 문서의 등급을 바꿀 수 있는 사람(작성자 · 대표 · 관리자 — routes/posts.js PUT /:id/security-level 과 같은 술어)만.
 *   · 그래도 원본 문서의 **지금** 등급 아래로는 못 내린다. 원본이 없어졌으면 대표·관리자만.
 * @returns null(허용) | { status, code }
 */
async function signedCopyDowngradeBlock(file, nextLevel, user, scope) {
  if (!isSignedCopy(file)) return null;
  const cur = LEVEL_RANK[file.security_level] ?? 0;
  const next = LEVEL_RANK[nextLevel] ?? 0;
  if (next >= cur) return null;
  const isAdmin = !!(scope && (scope.isOwner || scope.isPlatformAdmin || scope.isAdmin));
  const postId = Number(String(file.source_key).slice(KEY_PREFIX.length).split(':')[0]) || 0;
  const { Post } = require('../models');
  const post = postId ? await Post.findOne({ where: { id: postId, business_id: file.business_id }, attributes: ['id', 'author_id', 'security_level'] }) : null;
  if (!post) return isAdmin ? null : { status: 403, code: 'signed_copy_level_locked' };
  if (!isAdmin && post.author_id !== user.id) return { status: 403, code: 'signed_copy_level_locked' };
  if (next < (LEVEL_RANK[post.security_level] ?? 0)) return { status: 409, code: 'signed_copy_below_document' };
  return null;
}

/**
 * @param user   req.user
 * @param post   Post 인스턴스(author 포함이면 PDF 작성자 표시명)
 * @param opts   { buildPdf: () => Promise<Buffer> (증명서 없는 서명본), lang: 'ko'|'en' }
 * @returns {{ok:true, data}} | {{ok:false, status, code, quota?}}
 */
async function saveSignedPdf(user, post, { buildPdf, lang } = {}) {
  const { File } = require('../models');
  const { userCanSeeProject, getUserScope, canDownloadFile } = require('../middleware/access_scope');
  const businessId = post.business_id;

  // 완료 판정 — 청구서 초안과 같은 함수(새 술어를 만들지 않는다)
  if (!(await require('./contractBilling').isRoundFullySigned(post.id))) return fail(409, 'signature_not_complete');
  if (!post.project_id) return fail(409, 'project_required');
  const { Project } = require('../models');
  const prj = await Project.findOne({ where: { id: post.project_id, business_id: businessId }, attributes: ['id'] });
  if (!prj) return fail(400, 'invalid_project');
  if (!(await userCanSeeProject(user.id, businessId, post.project_id, user.platform_role))) return fail(403, 'forbidden');

  const reqs = await roundRequests(post.id);
  if (!reqs.length || !reqs.every((r) => r.status === 'signed')) return fail(409, 'signature_not_complete');
  const sourceKey = sourceKeyOf(post.id, reqs);
  const lockName = `signed-save:${businessId}:${sourceKey}`.slice(0, 64);

  return sequelize.transaction(async (t) => {
    const [[row]] = await sequelize.query('SELECT GET_LOCK(:n, 0) AS got', { replacements: { n: lockName }, transaction: t });
    if (!row || Number(row.got) !== 1) return fail(409, 'save_in_progress');
    try {
      const shape = async (file, already) => {
        const scope = await getUserScope(user.id, businessId, user.platform_role);
        const canOpen = await canDownloadFile(scope, user.id, file);
        return {
          ok: true,
          data: {
            already,
            file_id: canOpen ? file.id : null,
            file_name: canOpen ? file.file_name : null,
            project_id: file.project_id,
            security_level: file.security_level,
            drive_backup: await driveBackupState(file),
            download_url: canOpen ? `/api/files/${businessId}/${file.id}/download` : null,
          },
        };
      };

      // 같은 회차의 «계약대로인» 사본이 있으면 그것(id 가 가장 작은 것) — 이 문서의 지금 프로젝트 · 프로젝트 공개(L2).
      //   ★ 열쇠만 보면 안 된다(Fable 완료 검증 FAIL 2): 저장한 사람이 사본을 «나만 보기» 로 바꾸거나 다른 프로젝트로 옮기면
      //   프로젝트에는 서명본이 없는데 다른 사람은 다시 만들 수도 없었다. 그런 사본은 그대로 두고 새로 만든다.
      const existing = await File.findOne({
        where: { business_id: businessId, source_key: sourceKey, deleted_at: null, project_id: post.project_id, vlevel: 'L2' },
        order: [['id', 'ASC']],
      });
      if (existing) return shape(existing, true);

      const pdf = await buildPdf();
      const planEngine = require('./plan');
      const pre = await planEngine.can(businessId, 'upload_file', { size: pdf.length, external: false });
      if (!pre.ok) return fail(pre.reason === 'file_size_exceeded' || pre.reason === 'storage_quota_exceeded' ? 413 : 403, pre.reason, { quota: planEngine.buildQuotaError(pre, businessId) });

      const { uploadPathFor, ingestDownloadedFile } = require('./driveImport');
      const temp = uploadPathFor(businessId);
      fs.writeFileSync(temp, pdf);
      const level = ['general', 'internal', 'confidential'].includes(post.security_level) ? post.security_level : 'general';
      const ing = await ingestDownloadedFile({ businessId, uploaderId: user.id }, temp, {
        projectId: post.project_id,
        visibility: 'L2',
        securityLevel: level,
        sourceKey,
        fileName: fileNameOf(post, reqs, lang),
        mimeType: 'application/pdf',
        auditValue: { source: 'signed_pdf', post_id: post.id, source_key: sourceKey },
      });
      if (!ing.ok) {
        if (ing.reason === 'storage_quota_exceeded') {
          return fail(413, 'storage_quota_exceeded', { quota: planEngine.buildQuotaError({ reason: 'storage_quota_exceeded', ...(ing.detail || {}) }, businessId) });
        }
        throw new Error(`signed pdf ingest failed: ${ing.reason}`);
      }
      // Drive 사본 — best-effort, 응답을 막지 않는다. 일반 등급·프로젝트 L2 만 미러가 스스로 고른다.
      setImmediate(() => require('./gdriveMirror').mirrorOnUpload(ing.file.id, businessId));
      return shape(ing.file, false);
    } finally {
      await sequelize.query('SELECT RELEASE_LOCK(:n)', { replacements: { n: lockName }, transaction: t });
    }
  });
}

module.exports = { saveSignedPdf, sourceKeyOf, roundFingerprint, fileNameOf, driveBackupState, isSignedCopy, signedCopyDowngradeBlock, KEY_PREFIX };
