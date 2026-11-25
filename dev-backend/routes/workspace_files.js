// 파일 집계 라우트 — 워크스페이스 전체(GET /api/projects/workspace/:bizId/all-files). 프로젝트 파일 탭은 routes/project_files.js(같은 직렬화 짝 — 한쪽을 고치면 다른 쪽도).
// ★ 2026-11-25 routes/projects.js 에서 **동작 그대로** 옮겼다(god-file 래칫 — 메일 첨부 게이트를 더하며 그 파일을 키운 방이 나눈다).
//   server.js 에서 같은 접두(/api/projects)로 projects 라우터 **바로 앞**에 붙는다. projects.js 에는 이 두 경로를 가로챌
//   경로(`/:id/:x` · `/workspace/:b/:x`)가 없었으므로 앞에 붙여도 응답이 바뀌지 않는다.
const express = require('express');
const path = require('path');
const { Op } = require('sequelize');
const router = express.Router();
const {
  Business, BusinessMember, Conversation, File, FileFolder, Message, MessageAttachment, Post, Project, Task, TaskAttachment, User,
} = require('../models');
const { successResponse, errorResponse, parsePagination, paginatedResponse } = require('../middleware/errorHandler');
const { previewUrlForFile, isRenderableImage } = require('../services/filePreview');
const { dedupeFileRows } = require('../utils/dedupeFileRows');
const { CLIENT_VISIBLE_MESSAGE_WHERE } = require('../utils/messageVisibility');
const { authenticateToken } = require('../middleware/auth');
const { getMemberNameMap } = require('../services/displayName');
const { loadProjectOrForbidden } = require('../services/projectAccess');

// Cue 가 이 파일 **내용**을 읽는가 — 판정은 `services/fileIndex.indexability` **한 함수**다.
//   화면이 따로 계산하면 반드시 갈라진다(같은 값의 공식이 두 벌이면 이미 갈라져 있다).
//   화면은 이 값으로 "Cue가 내용을 읽습니다 / 이 형식은 못 읽습니다" 한 줄을 말한다 —
//   안 그러면 "왜 이 파일은 못 찾아?" 가 다음 신고가 된다.
function cueReadOf(f) {
  try {
    const can = require('../services/fileIndex').indexability(f);
    return can.ok ? { ok: true } : { ok: false, reason: can.reason };
  } catch { return undefined; }
}

// 업무 공개 범위 조각 — 판정은 access_scope.taskListWhere 한 곳(routes/projects.js taskVisAnd 와 같은 한 줄 감싸기).
async function taskVisAnd(userId, businessId) {
  const w = await require('../middleware/access_scope').taskListWhere(userId, businessId);
  return w || { id: -1 };
}

// ─── 워크스페이스 전역 파일 집계 (모든 프로젝트) ───
router.get('/workspace/:bizId/all-files', authenticateToken, async (req, res, next) => {
  try {
    const bizId = Number(req.params.bizId);
    // checkBusinessAccess 로직 인라인 — 멤버/오너만
    const isMember = req.user.platform_role === 'platform_admin'
      || await BusinessMember.findOne({ where: { business_id: bizId, user_id: req.user.id } })
      || await Business.findOne({ where: { id: bizId, owner_id: req.user.id } });
    if (!isMember) return errorResponse(res, 'Access denied', 403);
    // #106 fix — visibility(L1~L4) 필터 필수. 옛 버그: 필터 없어 L1(나만보기) 파일이 전 멤버에게 노출.
    const { getUserScope, fileListWhereByLevel } = require('../middleware/access_scope');
    const fileScope = await getUserScope(req.user.id, bizId, req.user.platform_role);

    // 사이클 N+50 — UNION-style 집계 (direct + chat + task + post). 정식 pagination 은 SQL UNION refactor 필요.
    // 임시: 각 source 최대 2000 cap + 최종 merge 결과 limit/offset 인메모리 슬라이스.
    // 운영 워크스페이스 source 별 2000 초과 드물 — 초과 시 후속 사이클에 SQL UNION 으로 전환.
    const MAX_PER_SOURCE = 2000;
    const { limit, page, offset } = parsePagination(req, { defaultLimit: 500, maxLimit: 1000 });

    const projects = await Project.findAll({
      where: { business_id: bizId },
      attributes: ['id', 'name', 'color']
    });
    const projMap = new Map(projects.map(p => [p.id, p]));
    const projIds = projects.map(p => p.id);
    // 프로젝트가 없어도 "내 파일"(project_id NULL) 은 조회 필요 — 아래 로직 진행

    // ★ chat·task 첨부는 direct 파일과 달리 vlevel 컬럼이 없어 fileListWhereByLevel 로 못 거른다.
    //   프로젝트 산출물이므로 **내가 속한 프로젝트만** 대상으로 좁힌다. 안 그러면 프로젝트 비멤버가
    //   대화 첨부·업무 첨부의 파일명과 무인증 public download_url 까지 받아간다.
    //   owner/admin/platform_admin 은 워크스페이스 전권이라 기존대로 전체.
    const fullView = fileScope.isPlatformAdmin || fileScope.isOwner || fileScope.isAdmin;
    const { canSeeProject } = require('../middleware/access_scope');
    const myProjIds = fullView
      ? projIds
      : projIds.filter((id) => canSeeProject(fileScope, id));   // 참여 ∪ 전체 공개 · 고객은 참여 고객(2026-10-16)

    const results = [];

    // 1) direct 파일 — 프로젝트 소속 + "내 파일"(project_id NULL) 둘 다 포함
    // ★ 2026-09-20 (Irene: *"메일이 빠졌네. 메일에서도 지금 가져오잖아. … 전체 = 직접업로드 +
    //   나머지 채팅, 업무, 회의, 문서, 메일 에서 자동으로 가져오는 거."*) —
    //   메일 첨부를 **목록에서 빼던 것**을 그만두고 «메일» 출처로 **분류**한다.
    //   빼 버리면 어디에도 안 보여 «없어졌다» 가 되고, 그대로 섞으면 «쓸데없는 파일이 너무 많아» 가 된다.
    //   답은 제3의 것 — 보이되 **자기 칸**에 있게 한다(채팅·업무·회의·문서와 같은 취급).
    const MF = require('../services/mailAttachmentFiles');
    const mailIds = new Set(await MF.mailAttachmentFileIds(bizId));
    // ★ 메일 첨부는 메일을 읽을 수 있는 사람에게만(2026-11-25 Fable 설계 A-③) — 회사 메일함 첨부는 L3 라
    //   Q mail 메뉴가 숨겨진 멤버에게도 «메일» 칸으로 보였다. 판정 services/mailAttachmentFiles 한 곳.
    const mailOk = await MF.mailFilesAllowed(bizId, req.user, fileScope.isClient);
    const directFiles = await File.findAll({
      where: {
        [Op.and]: [
          fileListWhereByLevel(fileScope),   // #106 — L1 개인파일은 소유자만, L2 프로젝트/지정멤버, L3/L4 전체
          { deleted_at: null },
          ...(mailOk ? [] : [MF.notMailAttachmentLiteral('File')]),
          { [Op.or]: [
            { project_id: { [Op.in]: projIds } },
            { project_id: null }
          ] },
        ],
      },
      include: [
        { model: User, as: 'uploader', attributes: ['id', 'name'] },
        { model: FileFolder, as: 'folder', attributes: ['id', 'name'] }
      ],
      order: [['created_at', 'DESC']],
      limit: MAX_PER_SOURCE,
    });
    for (const f of directFiles) {
      const proj = projMap.get(f.project_id);
      // 미리보기 규칙은 services/filePreview 단일 원천 (Drive 저장분 포함).
      // 미리보기 규칙은 services/filePreview 단일 원천 — Drive 저장분도 여기서 처리된다.
      const previewUrl = previewUrlForFile(f);
      results.push({
        id: `direct-${f.id}`,
        source: 'direct',
        // 메일에서 들어온 첨부는 «메일» 칸에도 선다 — 출처는 배타적 폴더가 아니라 **태그**다.
        ...(mailIds.has(f.id) ? { sources: ['direct', 'mail'] } : {}),
        file_path_key: f.file_path || null,   // 중복 접기 기준(실제 파일)
        file_name: f.file_name,
        file_size: Number(f.file_size),
        mime_type: f.mime_type,
        uploader_id: f.uploader_id,
        uploader_name: f.uploader ? f.uploader.name : null,
        uploaded_at: (f.createdAt || f.created_at || new Date()).toISOString ? (f.createdAt || f.created_at).toISOString() : new Date().toISOString(),
        // ★ gdrive 라고 구글로 직행시키지 않는다 — 수신자에게 401 이다 (2026-09-03)
          download_url: `/api/files/${bizId}/${f.id}/download`,
        preview_url: previewUrl,
        external_id: f.external_id,
        external_url: f.external_url,
        folder_id: f.folder_id,
        project_context: proj ? { id: proj.id, name: proj.name, color: proj.color } : null,
        deletable: true,
        storage_provider: f.storage_provider,
        // #379 — Drive 사본이 삭제되면 gdriveApply 가 미러만 해제한다(원본은 보존).
        //   그 사실을 사용자가 알아야 "왜 드라이브에 없지" 를 스스로 설명할 수 있다.
        //   ★ 이 직렬화는 **두 군데**(워크스페이스 all-files · 프로젝트 files)에 있다 —
        //     한쪽만 고치면 같은 파일이 화면마다 다르게 보인다.
        gdrive_mirror_id: f.gdrive_mirror_id || null,
        gdrive_unmirrored: f.storage_provider === 'planq' && !f.gdrive_mirror_id && !!f.gdrive_mirrored_at,
        // 2026-11-18 — Drive 사본이 PlanQ 와 다른데 반영 못 한 이유(gdriveMirrorSync §4.2 B-5). 세 직렬화가 같이 싣는다.
        drive_sync_issue: f.drive_sync_issue || null,
        // N+67 — visibility 노출 (frontend file detail drawer 에 표시 + 변경 UI)
        visibility: f.visibility,
        project_id: f.project_id,
        // 검색용 메타 — 이 둘이 빠지면 편집해도 목록·검색에는 옛 값만 남는다
        description: f.description,
        tags: f.tags || [],
        cue_read: cueReadOf(f),
      });
    }

    // 2) chat 첨부 — 내가 속한 프로젝트만 (위 myProjIds 주석 참조)
    // platformroom-exempt: 프로젝트에 묶인 대화방(project_id 지정)만 고른다 — PlanQ 안내방은 프로젝트가 없다(projects.js 에서 옮긴 그대로)
    const conversations = await Conversation.findAll({
      where: { business_id: bizId, project_id: { [Op.in]: myProjIds } },
      attributes: ['id', 'title', 'project_id']
    });
    const convMap = new Map(conversations.map(c => [c.id, c]));
    if (conversations.length > 0) {
      const chatFiles = await MessageAttachment.findAll({
        include: [{
          model: Message,
          where: { conversation_id: { [Op.in]: conversations.map(c => c.id) } },
          attributes: ['id', 'conversation_id', 'sender_id'],
          include: [{ model: User, as: 'sender', attributes: ['id', 'name', 'name_localized', 'is_guest'] }]
        }],
        order: [['created_at', 'DESC']],
        limit: MAX_PER_SOURCE,
      });
      for (const a of chatFiles) {
        const conv = convMap.get(a.Message.conversation_id);
        const proj = conv ? projMap.get(conv.project_id) : null;
        // 채팅 첨부 미리보기 — 로컬은 UUID 파일명, Drive 는 Drive 파일 ID.
        //   ★ 순차 정수 id 경로(`/:id/raw`)는 쓰지 않는다 — 무인증 + 1,2,3… 열거가 가능하다(Fable 실측).
        //   둘 다 `/public/:token` 한 경로로 보낸다(추측 불가능한 토큰 계약).
        // 판정은 services/filePreview 단일 원천 — 파일명까지 본다(mime 을 모르고 올라온 PNG 구제).
        const isImage = isRenderableImage(a.mime_type, a.file_name);
        const chatToken = a.storage_provider === 'gdrive' ? (a.external_id || a.file_path)
          : a.file_path ? path.basename(a.file_path) : null;
        const previewUrl = (isImage && chatToken)
          ? `/api/message-attachments/public/${chatToken}` : undefined;
        results.push({
          id: `chat-${a.id}`,
          source: 'chat',
          file_path_key: a.file_path || null,   // 중복 접기 기준(실제 파일)
          file_name: a.file_name,
          file_size: Number(a.file_size),
          mime_type: a.mime_type,
          uploader_id: a.Message.sender_id,
          uploader_name: a.Message.sender ? a.Message.sender.name : null,
          uploaded_at: (a.createdAt || a.created_at || new Date()).toISOString ? (a.createdAt || a.created_at).toISOString() : new Date().toISOString(),
          // download_url 은 인증 내려받기 라우트 — `/uploads/` 는 서빙되지 않는다(nginx 가 앱 index.html 을 줘 «열 수 없는 형식»·html 내려받기, Irene 10-29)
          download_url: `/api/message-attachments/${a.id}/download`,
          preview_url: previewUrl,
          context: conv ? { kind: 'conversation', id: conv.id, label: conv.title || '대화방' } : undefined,
          project_context: proj ? { id: proj.id, name: proj.name, color: proj.color } : null,
          folder_id: null,
          deletable: false,
          storage_provider: 'planq'
        });
      }
    }

    // 3) task 첨부 — 내가 속한 프로젝트만 (위 myProjIds 주석 참조)
    const tasks = await Task.findAll({
      where: { business_id: bizId, project_id: { [Op.in]: myProjIds }, [Op.and]: [await taskVisAnd(req.user.id, bizId)] },
      attributes: ['id', 'title', 'project_id']
    });
    const taskMap = new Map(tasks.map(t => [t.id, t]));
    if (tasks.length > 0) {
      const taskFiles = await TaskAttachment.findAll({
        where: { task_id: { [Op.in]: tasks.map(t => t.id) } },
        include: [{ model: User, as: 'uploader', attributes: ['id', 'name'] }],
        order: [['created_at', 'DESC']],
        limit: MAX_PER_SOURCE,
      });
      for (const a of taskFiles) {
        const task = taskMap.get(a.task_id);
        const proj = task ? projMap.get(task.project_id) : null;
        // 이미지면 task 첨부 public 엔드포인트로 썸네일 노출 (direct/chat 소스와 동일 규칙)
        const previewUrl = (isRenderableImage(a.mime_type, a.original_name) && a.stored_name)
          ? `/api/tasks/public/attach/${a.stored_name}`
          : undefined;
        results.push({
          id: `task-${a.id}`,
          source: 'task',
          file_name: a.original_name || a.stored_name,
          file_size: Number(a.file_size),
          mime_type: a.mime_type,
          uploader_id: a.uploaded_by,
          uploader_name: a.uploader ? a.uploader.name : null,
          uploaded_at: (a.createdAt || a.created_at || new Date()).toISOString ? (a.createdAt || a.created_at).toISOString() : new Date().toISOString(),
          // 라우터 마운트 경로 포함 — `/public/attach/...` 는 존재하지 않는 경로라 404 였다
          // ★ /api/tasks/public/attach 는 이미 Drive 를 서버가 받아 흘려준다(readAttachmentBody).
          //   external_url 로 직행시키면 수신자가 구글 401 을 만난다 (2026-09-03).
          // 공개 attach 문은 이미지 전용(403) — 문서·PDF 는 인증 라우트로. 문서 연결(post_id)은 내려받을 바이트가 없다
          download_url: a.post_id ? null : `/api/tasks/attachments/${a.id}/download`,
          preview_url: previewUrl,
          external_id: a.external_id || null,
          external_url: a.external_url || null,
          context: task ? { kind: 'task', id: task.id, label: task.title } : undefined,
          project_context: proj ? { id: proj.id, name: proj.name, color: proj.color } : null,
          folder_id: null,
          deletable: false,
          storage_provider: 'planq'
        });
      }
    }

    // 4) 문서(포스트) 첨부 — File 참조 기반. 좌측 "문서" 필터에서 모아 볼 수 있도록
    //    direct 와 중복되더라도 post source 로 별도 등록 (의도된 이중 노출)
    const { Post, PostAttachment } = require('../models');
    // ★ 보는 사람이 **볼 수 있는 문서**의 첨부만, 그리고 첨부 파일도 그 사람이 볼 수 있는 것만(2026-09-27 점검 —
    //   남의 «나만 보기» 문서 제목과 거기 붙은 개인 파일명·미리보기가 멤버 전원에게 나갔다). 문서 목록과 같은 술어.
    const { postListWhereByLevel, canAccessFileByLevel } = require('../middleware/access_scope');
    const postsInBiz = await Post.findAll({
      where: postListWhereByLevel(fileScope),
      attributes: ['id', 'title', 'project_id']
    });
    if (postsInBiz.length > 0) {
      const postMap = new Map(postsInBiz.map(p => [p.id, p]));
      const postAtts = await PostAttachment.findAll({
        where: { post_id: { [Op.in]: postsInBiz.map(p => p.id) } },
        include: [{ model: File, as: 'file', include: [{ model: User, as: 'uploader', attributes: ['id', 'name'] }] }],
        order: [['created_at', 'DESC']],
        limit: MAX_PER_SOURCE,
      });
      for (const a of postAtts) {
        const f = a.file;
        if (!f || f.deleted_at) continue;
        if (!(await canAccessFileByLevel(req.user.id, f, fileScope))) continue;
        const post = postMap.get(a.post_id);
        const proj = post && post.project_id ? projMap.get(post.project_id) : null;
        results.push({
          id: `post-${a.id}`,
          source: 'post',
          file_name: f.file_name,
          file_size: Number(f.file_size),
          mime_type: f.mime_type,
          uploader_id: f.uploader_id,
          uploader_name: f.uploader ? f.uploader.name : null,
          uploaded_at: (f.createdAt || f.created_at || new Date()).toISOString
            ? (f.createdAt || f.created_at).toISOString() : new Date().toISOString(),
          download_url: `/api/files/${bizId}/${f.id}/download`,
          preview_url: previewUrlForFile(f),
          external_id: f.external_id, external_url: f.external_url,
          context: post ? { kind: 'post', id: post.id, label: post.title } : undefined,
          project_context: proj ? { id: proj.id, name: proj.name, color: proj.color } : null,
          folder_id: null, deletable: false, storage_provider: f.storage_provider
        });
      }
    }

    results.sort((a, b) => new Date(b.uploaded_at) - new Date(a.uploaded_at));
    // 채팅으로 올린 파일은 File·MessageAttachment 양쪽에 행이 생겨 두 줄로 보였다 — 접는다.
    const merged = dedupeFileRows(results);
    // 사이클 N+50 — merged results 인메모리 슬라이스 (pagination 응답 형식 정합)
    const total = merged.length;
    const sliced = merged.slice(offset, offset + limit);
    // 업로더/발신자 이름 = 워크스페이스 표시명 (flat uploader_name 은 helper 대상 밖이라 계정명 누출 → 표시명 맵으로 후처리. 카나리 크롤 검출 2026-07-06)
    const nameMap = await getMemberNameMap(bizId, sliced.map((r) => r.uploader_id));
    for (const r of sliced) { const dn = r.uploader_id && nameMap.get(Number(r.uploader_id)); if (dn && dn.name) r.uploader_name = dn.name; }
    return paginatedResponse(res, sliced, total, { limit, page, offset });
  } catch (error) {
    next(error);
  }
});

module.exports = router;
