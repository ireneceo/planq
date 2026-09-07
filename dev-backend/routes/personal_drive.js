// routes/personal_drive.js — Google Drive 파일 고르기: 목록 + 가져오기
//
// 두 축이 있고 **섞이면 안 된다** (Irene 2026-09-07):
//   *"나는 팀 드라이브 중심으로 계속 요구한거고 … 개인 구글드라이브는 개인 것만이니까"*
//
//   scope=workspace (기본) — 워크스페이스가 연결한 **팀/공용 Drive**(`BusinessCloudToken`).
//       프로젝트·업무·문서·메일 첨부는 전부 이쪽이다. memory `project_gdrive_policy` 옵션 B 정합:
//       "워크스페이스 공용 파일만 Drive, 개인 파일은 PlanQ 자체".
//   scope=personal — 개인이 연결한 **본인 Drive**(`ExternalConnection` owner_scope='user').
//       개인 보관함처럼 **개인 자리에서만** 쓴다. 공용 첨부에 개인 Drive 를 붙이면
//       멤버 사적 파일이 워크스페이스로 새는 그 사고다(같은 memory 가 경계한 것).
//
// ★ drive.file scope — 앱이 만들었거나 사용자가 앱으로 연 파일만 보인다.
//   전체 열람(drive.readonly)은 제한 권한·유료 심사라 채택 안 함(Irene 결정 2026-06-01).
const express = require('express');
const router = express.Router();
const { BusinessMember, ExternalConnection, BusinessCloudToken, Business } = require('../models');
const { authenticateToken } = require('../middleware/auth');
const { successResponse, errorResponse } = require('../middleware/errorHandler');
const { perUserDaily } = require('../middleware/costGuard');
const personalOauth = require('../services/personalOauth');
const gdrive = require('../services/gdrive');
const { importDriveFile } = require('../services/driveImport');

// external_connections 의 같은 이름 헬퍼와 **같은 술어**여야 한다.
//   (여기서 느슨해지면 목록은 막히는데 가져오기는 열리는 식으로 갈라진다.)
async function assertBusinessMember(req, bizId) {
  if (req.user.platform_role === 'platform_admin') return true;
  const bm = await BusinessMember.findOne({ where: { user_id: req.user.id, business_id: bizId, removed_at: null } });
  return !!bm;
}

/**
 * 요청의 scope 로 Drive 클라이언트를 만든다. 목록과 가져오기가 **같은 함수**를 부른다 —
 * 두 곳이 갈라지면 "목록엔 보이는데 가져오면 없다" 가 된다.
 * @returns {{ ok:true, drive, scope, label } | { ok:false, code, status }}
 */
async function resolveDrive(req, bizId, scope) {
  if (scope === 'personal') {
    const conn = await ExternalConnection.findOne({
      where: {
        owner_scope: 'user', user_id: req.user.id, business_id: bizId,
        provider: 'google_drive', is_active: true,
      },
    });
    if (!conn) return { ok: false, code: 'personal_drive_not_connected', status: 400 };
    const auth = await personalOauth.getAuthedClient(conn);
    return {
      ok: true, scope: 'personal', label: conn.account_email || null,
      drive: require('googleapis').google.drive({ version: 'v3', auth }),
    };
  }

  // workspace — 워크스페이스가 연결한 팀/공용 Drive
  const token = await BusinessCloudToken.findOne({ where: { business_id: bizId, provider: 'gdrive' } });
  if (!token) return { ok: false, code: 'workspace_drive_not_connected', status: 400 };
  const drive = await gdrive.getDriveClient(token);
  // ★ 루트 폴더를 보장한다 — 저장된 id 가 낡으면 그 아래 전부 404 가 나고
  //   화면에는 "연동이 끊겼다" 로 보인다(2026-09-07 실사례: 폴더는 멀쩡했고 id 만 옛것이었다).
  try {
    const biz = await Business.findByPk(bizId, { attributes: ['name'] });
    await gdrive.ensureRootFolder(drive, token, biz && biz.name);
  } catch (e) {
    console.warn('[drive] 루트 폴더 보장 실패:', e.message);
  }
  return { ok: true, scope: 'workspace', label: token.account_email || null, drive, token };
}

function parseScope(v) {
  return String(v || '').toLowerCase() === 'personal' ? 'personal' : 'workspace';
}

// ─── 목록 ───────────────────────────────────────────────
// GET /api/drive/files?business_id=&scope=workspace|personal&q=&page_token=
// GET /api/me/drive/files  (별칭 — 개인 고정. 개인 보관함 화면이 쓰던 경로를 그대로 둔다)
async function listHandler(req, res, next, forcedScope) {
  try {
    const bizId = parseInt(req.query.business_id, 10);
    if (!bizId) return errorResponse(res, 'business_id_required', 400);
    if (!(await assertBusinessMember(req, bizId))) return errorResponse(res, 'no_business_access', 403);

    const scope = forcedScope || parseScope(req.query.scope);
    const r = await resolveDrive(req, bizId, scope);
    // 연결이 없는 것은 오류가 아니다 — 화면이 "연결해 주세요" 를 말할 수 있게 200 으로 알린다.
    if (!r.ok) return successResponse(res, { connected: false, scope, reason: r.code, files: [], next_page_token: null });

    try {
      const out = await gdrive.listDriveFiles(r.drive, { q: req.query.q, pageToken: req.query.page_token });
      return successResponse(res, { connected: true, scope, account_email: r.label, ...out });
    } catch (e) {
      console.error(`[drive/files] ${scope} fetch failed biz=${bizId}`, e.message);
      return errorResponse(res, `drive_fetch_failed: ${e.message}`, 502);
    }
  } catch (err) { next(err); }
}

router.get('/drive/files', authenticateToken, (req, res, next) => listHandler(req, res, next, null));
router.get('/me/drive/files', authenticateToken, (req, res, next) => listHandler(req, res, next, 'personal'));

// ─── 가져오기 ───────────────────────────────────────────
// POST /api/drive/import  { business_id, file_id, scope?, project_id?, folder_id? }
//
// 목록만 있고 **가져오는 문이 없어서** 원본을 새 탭에서 여는 것이 전부였다(Irene: 노션처럼).
// 바이트를 우리가 쥐어야 미리보기·공유·보존이 된다 — Drive 링크(external_url)는
// **연결한 구글 계정 본인에게만** 열리기 때문이다(2026-09-03 공유 링크 사고와 같은 구조).
//
// ★ 외부 API 를 부르고 저장공간을 쓰는 라우트다 — per-user rate-limit 필수(운영 안정성 규칙 1).
async function importHandler(req, res, next, forcedScope) {
  try {
    const bizId = parseInt(req.body.business_id, 10);
    const fileId = String(req.body.file_id || '').trim();
    if (!bizId) return errorResponse(res, 'business_id_required', 400);
    if (!fileId) return errorResponse(res, 'file_id_required', 400);
    if (!(await assertBusinessMember(req, bizId))) return errorResponse(res, 'no_business_access', 403);

    const scope = forcedScope || parseScope(req.body.scope);
    const projectId = req.body.project_id ? Number(req.body.project_id) : null;
    const folderId = req.body.folder_id ? Number(req.body.folder_id) : null;

    // 개인 Drive 에서 가져온 것을 **프로젝트로** 넣지 않는다 — 개인 것은 개인 자리에만 둔다
    //   (memory project_gdrive_policy: 멤버 사적 파일이 워크스페이스에 섞이는 것을 막는 것이 정책의 이유).
    if (scope === 'personal' && projectId) {
      return errorResponse(res, 'personal_drive_cannot_target_project', 400);
    }

    // ★ 형제 라우트(routes/files.js 업로드)와 **같은 판정**을 쓴다 — 여기만 빠져 있어
    //   남의 워크스페이스 프로젝트 id 로도 들어왔다(Fable 사후 감사 2026-09-07).
    const { isProjectInBusiness, isFolderInBusiness } = require('../services/fileScope');
    if (!(await isProjectInBusiness(projectId, bizId))) return errorResponse(res, 'invalid_project_id', 400);
    if (!(await isFolderInBusiness(folderId, bizId, projectId))) return errorResponse(res, 'invalid_folder_id', 400);

    const r = await resolveDrive(req, bizId, scope);
    if (!r.ok) return errorResponse(res, r.code, r.status);

    let meta;
    try {
      const g = await r.drive.files.get(
        { fileId, fields: 'id, name, mimeType, size, webViewLink, md5Checksum', supportsAllDrives: true },
        { timeout: 10000 });
      meta = g.data;
    } catch (e) {
      // drive.file scope 라 PlanQ 가 만들지 않은 파일은 404 로 온다.
      //   "권한이 없다" 가 아니라 "이 앱이 못 보는 파일" 이므로 그대로 말한다.
      return errorResponse(res, `drive_file_unavailable: ${String(e.message).slice(0, 120)}`, 404);
    }

    const out = await importDriveFile(
      { drive: r.drive, businessId: bizId, uploaderId: req.user.id },
      meta,
      {
        folderId,
        projectId,
        // 개인 Drive 에서 온 것은 개인 등급(L1). 팀 Drive 는 프로젝트면 L2, 아니면 워크스페이스 공용(L3).
        visibility: scope === 'personal' ? 'L1' : (projectId ? 'L2' : 'L3'),
        actor: 'user',
      },
    );
    if (!out.ok) {
      const status = out.reason === 'storage_quota_exceeded' || out.reason === 'file_size_exceeded' ? 413
        : out.reason === 'extension_not_allowed' || out.reason === 'google_native' ? 415
          : 502;
      return errorResponse(res, out.reason, status);
    }
    return successResponse(res, {
      file_id: out.file.id,
      composite_id: `direct-${out.file.id}`,
      file_name: out.file.file_name,
      file_size: out.file.file_size,
      mime_type: out.file.mime_type,
      scope,
      already: out.reason === 'already_ingested',
    });
  } catch (err) { next(err); }
}

router.post('/drive/import', authenticateToken, ...perUserDaily('drive-import', { perMin: 20, perDay: 500 }),
  (req, res, next) => importHandler(req, res, next, null));
router.post('/me/drive/import', authenticateToken, ...perUserDaily('drive-import', { perMin: 20, perDay: 500 }),
  (req, res, next) => importHandler(req, res, next, 'personal'));

module.exports = router;
