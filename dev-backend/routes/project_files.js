// 파일 집계 라우트 — 프로젝트 파일 탭(:id/files). 워크스페이스 전체(all-files)는 routes/workspace_files.js(같은 직렬화 짝 — 한쪽을 고치면 다른 쪽도).
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

// ─── 프로젝트 파일 집계 (direct + chat + task + meeting) ───
router.get('/:id/files', authenticateToken, async (req, res, next) => {
  try {
    const { project, error } = await loadProjectOrForbidden(Number(req.params.id), req.user.id);
    if (error) return errorResponse(res, error.message, error.code);

    const bizId = project.business_id;
    const projId = project.id;
    const results = [];
    // 메일에서 들어온 첨부를 «메일» 칸으로 분류한다 (워크스페이스 all-files 와 같은 규칙).
    const mailIds = new Set(await require('../services/mailAttachmentFiles').mailAttachmentFileIds(bizId));

    // ★ 가시성 게이트 — loadProjectOrForbidden 은 "워크스페이스 멤버면 통과" 라, 프로젝트 비멤버도
    //   여기까지 들어온다. 그대로 전체를 내려주면 L2(프로젝트 멤버 전용) 파일의 이름·크기·업로더,
    //   그리고 preview_url(무인증 조회 가능)까지 비멤버에게 샌다.
    //   VISIBILITY_VOCABULARY.md §1 — L2 = 프로젝트 멤버. 워크스페이스 전체가 보는 건 L3.
    //   필터는 files 목록과 같은 단일 원천(fileListWhereByLevel)을 재사용한다.
    const { getUserScope, fileListWhereByLevel } = require('../middleware/access_scope');
    const scope = await getUserScope(req.user.id, bizId, req.user.platform_role);
    // 볼 수 있는 프로젝트면(참여 ∪ 전체 공개 · 고객은 참여 고객) 그 대화·업무 첨부도 본다 — access_scope 한 곳(2026-10-16)
    const isProjectMember = require('../middleware/access_scope').canSeeProject(scope, projId);
    const levelWhere = fileListWhereByLevel(scope);

    // 1) direct 파일
    // 메일 첨부는 메일을 읽을 수 있는 사람에게만 — 워크스페이스 all-files 와 같은 판정(services/mailAttachmentFiles).
    const MF = require('../services/mailAttachmentFiles');
    const mailOk = await MF.mailFilesAllowed(bizId, req.user, scope.isClient);
    const directFiles = await File.findAll({
      // 권한 술어를 펼치지 않고 Op.and 안에 둔다 — 술어가 최상위 Op.and 를 갖게 되면 펼친 쪽이 조용히 덮어쓴다(Fable N4).
      where: { [Op.and]: [levelWhere, { project_id: projId, deleted_at: null }, ...(mailOk ? [] : [MF.notMailAttachmentLiteral('File')])] },
      include: [
        { model: User, as: 'uploader', attributes: ['id', 'name'] },
        { model: FileFolder, as: 'folder', attributes: ['id', 'name'] }
      ],
      order: [['created_at', 'DESC']]
    });
    for (const f of directFiles) {
      // 미리보기 규칙은 services/filePreview 단일 원천 (Drive 저장분 포함).
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
        preview_url: previewUrlForFile(f),
        external_id: f.external_id,
        external_url: f.external_url,
        folder_id: f.folder_id,
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
        visibility: f.visibility,
        // «특정 멤버» 명단 — 파일 상세 공개 범위 칸이 고른 멤버를 그대로 보여 준다(2026-11-27)
        target_member_ids: (f.vlevel || f.visibility) === 'L2' ? require('../middleware/access_scope').fileMemberList(f) : null,
        hide_existence: !!f.hide_existence,   // «검색에서 숨기기»(services/lockedDiscovery) — 파일 상세의 숨김 칸이 읽는다
        project_id: f.project_id,
        description: f.description,
        tags: f.tags || [],
        cue_read: cueReadOf(f),
      });
    }

    // 2) chat 첨부 — 프로젝트 연결된 대화의 메시지 첨부
    //    프로젝트 비멤버에게는 대화 첨부를 노출하지 않는다 (대화 참여자 범위 밖)
    //    ★ 고객은 **자기가 볼 수 있는 대화방**(conversationListWhere — 참여 ∪ 내 고객 방)의 **고객에게 보이는 메시지**
    //      (CLIENT_VISIBLE_MESSAGE_WHERE — 내부 메모·삭제·미승인 초안 제외) 첨부만. 2026-10-29 Irene «내부채팅에서 올린
    //      파일이 고객에게 프로젝트>파일에 다 보여» — 프로젝트를 볼 수 있다는 이유로 내부 논의방 첨부까지 내려갔다.
    //      내려받기(message_attachments)도 같은 두 술어를 본다.
    const convScopeWhere = isProjectMember
      ? await require('../middleware/access_scope').conversationListWhere(req.user.id, bizId, scope) : null;
    // platformroom-exempt: 프로젝트에 묶인 대화방(project_id 지정)만 고른다 — PlanQ 안내방은 프로젝트가 없다(projects.js 에서 옮긴 그대로)
    const conversations = convScopeWhere ? await Conversation.findAll({
      where: { [Op.and]: [convScopeWhere, { business_id: bizId, project_id: projId }] },
      attributes: ['id', 'title', 'channel_type']
    }) : [];
    const convMap = new Map(conversations.map(c => [c.id, c]));
    if (conversations.length > 0) {
      const chatFiles = await MessageAttachment.findAll({
        include: [{
          model: Message,
          where: scope.isClient
            ? { [Op.and]: [{ conversation_id: { [Op.in]: conversations.map(c => c.id) } }, CLIENT_VISIBLE_MESSAGE_WHERE] }
            : { conversation_id: { [Op.in]: conversations.map(c => c.id) } },
          attributes: ['id', 'conversation_id', 'sender_id'],
          include: [{ model: User, as: 'sender', attributes: ['id', 'name', 'name_localized', 'is_guest'] }]
        }],
        order: [['created_at', 'DESC']]
      });
      for (const a of chatFiles) {
        const conv = convMap.get(a.Message.conversation_id);
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
          // 판정은 services/filePreview 단일 원천 — 파일명까지 본다(mime 을 모르고 올라온 PNG 구제).
          preview_url: (isRenderableImage(a.mime_type, a.file_name) && a.file_path)
            ? `/api/message-attachments/public/${a.storage_provider === 'gdrive' ? (a.external_id || a.file_path) : path.basename(a.file_path)}`
            : undefined,
          context: conv ? { kind: 'conversation', id: conv.id, label: conv.title || '대화방' } : undefined,
          folder_id: null,
          deletable: false,
          storage_provider: 'planq'
        });
      }
    }

    // 3) task 첨부 — 프로젝트의 업무에 첨부된 파일 (비멤버 제외 — 위와 동일 이유)
    const tasks = isProjectMember ? await Task.findAll({
      where: { business_id: bizId, project_id: projId, [Op.and]: [await taskVisAnd(req.user.id, bizId)] },
      attributes: ['id', 'title']
    }) : [];
    const taskMap = new Map(tasks.map(t => [t.id, t]));
    if (tasks.length > 0) {
      const taskFiles = await TaskAttachment.findAll({
        where: { task_id: { [Op.in]: tasks.map(t => t.id) } },
        include: [{ model: User, as: 'uploader', attributes: ['id', 'name'] }],
        order: [['created_at', 'DESC']]
      });
      // 고객에게 숨긴 댓글의 첨부는 고객에게 안 보인다 — 업무 첨부 목록·내려받기(task_attachments)와 같은 술어.
      const hiddenByTask = new Map();
      const { clientHiddenCommentIds } = require('../services/taskAttachmentAccess');
      for (const a of taskFiles) {
        if (scope.isClient && a.comment_id) {
          if (!hiddenByTask.has(a.task_id)) hiddenByTask.set(a.task_id, await clientHiddenCommentIds(a.task_id));
          if (hiddenByTask.get(a.task_id).has(a.comment_id)) continue;
        }
        const task = taskMap.get(a.task_id);
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
          preview_url: (isRenderableImage(a.mime_type, a.original_name) && a.stored_name)
            ? `/api/tasks/public/attach/${a.stored_name}`
            : undefined,
          external_id: a.external_id || null,
          external_url: a.external_url || null,
          context: task ? { kind: 'task', id: task.id, label: task.title } : undefined,
          folder_id: null,
          deletable: false,
          storage_provider: 'planq'
        });
      }
    }

    // 4) 문서(포스트) 첨부 — 운영 #378 "프로젝트 > 파일에도 그렇고. 첨부된 것만 남아?"
    //
    //   ★ 이 블록이 **없었다.** 워크스페이스 전체 파일(all-files)에는 post 소스가 있는데
    //     프로젝트 파일에는 direct/chat/task 만 있었다 — 같은 파일 탭인데 화면마다 다르게 보였다.
    //     그래서 프로젝트 문서에 붙인 첨부 중 **File.project_id 가 비어 있는 것**(프로젝트 없이
    //     올린 뒤 문서를 프로젝트에 붙인 경우 등)은 프로젝트 탭에서 영영 안 보였다.
    //     direct 소스는 파일 행의 project_id 만 보기 때문이다.
    //   기준은 **문서가 이 프로젝트 것인가** — 파일 행이 프로젝트를 가리키는지가 아니다.
    //   direct 와 중복 노출되는 것은 all-files 와 같은 의도(좌측 "문서" 필터에서 모아 보기).
    {
      const { Post, PostAttachment } = require('../models');
      // 문서도 보는 사람 기준 — 파일은 등급으로 걸렀지만 문서 제목(context.label)은 L1 이어도 나갔다(2026-09-27 점검).
      const { postListWhereByLevel: plw, postListWhere: plwClient } = require('../middleware/access_scope');
      const postScopeWhere = scope.isClient ? await plwClient(req.user.id, bizId, scope) : plw(scope);
      const projPosts = await Post.findAll({
        where: { [Op.and]: [postScopeWhere || { id: -1 }, { business_id: bizId, project_id: projId }] },
        attributes: ['id', 'title'],
      });
      if (projPosts.length > 0) {
        const postMap = new Map(projPosts.map((p) => [p.id, p]));
        const postAtts = await PostAttachment.findAll({
          where: { post_id: { [Op.in]: projPosts.map((p) => p.id) } },
          order: [['created_at', 'DESC']],
          limit: 2000,
        });
        if (postAtts.length > 0) {
          // ★ 노출 등급은 direct 와 **같은 단일 원천**(fileListWhereByLevel)으로 거른다.
          //   첨부라는 이유로 게이트를 건너뛰면 L1(본인만) 파일이 이름·크기·미리보기까지 샌다
          //   — 이 라우트 앞부분의 가시성 게이트 주석과 같은 이유다.
          const attFiles = await File.findAll({
            where: { ...levelWhere, id: { [Op.in]: [...new Set(postAtts.map((a) => a.file_id))] }, deleted_at: null },
            include: [{ model: User, as: 'uploader', attributes: ['id', 'name'] }],
          });
          const fileMap = new Map(attFiles.map((f) => [f.id, f]));
          for (const a of postAtts) {
            const f = fileMap.get(a.file_id);
            if (!f) continue;                      // 등급 밖이거나 삭제됨
            const post = postMap.get(a.post_id);
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
              external_id: f.external_id,
              external_url: f.external_url,
              context: post ? { kind: 'post', id: post.id, label: post.title } : undefined,
              folder_id: null,
              deletable: false,                    // 원본은 문서에서 관리한다
              storage_provider: f.storage_provider,
              // 이 직렬화는 all-files 쪽과 짝이다 — 한쪽만 고치면 화면마다 다르게 보인다.
              gdrive_mirror_id: f.gdrive_mirror_id || null,
              gdrive_unmirrored: f.storage_provider === 'planq' && !f.gdrive_mirror_id && !!f.gdrive_mirrored_at,
        // 2026-11-18 — Drive 사본이 PlanQ 와 다른데 반영 못 한 이유(gdriveMirrorSync §4.2 B-5). 세 직렬화가 같이 싣는다.
        drive_sync_issue: f.drive_sync_issue || null,
              visibility: f.visibility,
              project_id: f.project_id,
              tags: f.tags || [],
            });
          }
        }
      }
    }

    // 4-b) 다른 프로젝트 소속인데 이 프로젝트에 «연결» 한 파일 (2026-10-27, docs/PROJECT_REFS_DESIGN.md)
    //   원본 등급 술어(fileListWhereByLevel)로 거른다 — 연결은 볼 수 있는 사람을 넓히지 않는다. 원본은 소속 쪽에서 관리(deletable false).
    {
      const { rows: linkedFiles, homes } = await require('../services/projectRefs').linkedFilesForProject(
        req.user, project, [{ model: User, as: 'uploader', attributes: ['id', 'name'] }]);
      for (const f of linkedFiles) {
        results.push({
          id: `linked-${f.id}`,
          source: 'linked',
          file_path_key: f.file_path || null,
          file_name: f.file_name,
          file_size: Number(f.file_size),
          mime_type: f.mime_type,
          uploader_id: f.uploader_id,
          uploader_name: f.uploader ? f.uploader.name : null,
          uploaded_at: (f.createdAt || f.created_at || new Date()).toISOString(),
          download_url: `/api/files/${bizId}/${f.id}/download`,
          preview_url: previewUrlForFile(f),
          external_id: f.external_id,
          external_url: f.external_url,
          linked_file_id: f.id,
          home_project: homes.get(Number(f.project_id)) || null,
          folder_id: null,
          deletable: false,
          storage_provider: f.storage_provider,
          visibility: f.visibility,
          project_id: f.project_id,
          tags: f.tags || [],
        });
      }
    }

    // 5) meeting (Q Note) 자료는 별도 스토리지 — 현재 연동 미구현, 빈 배열 (추후 확장)

    results.sort((a, b) => new Date(b.uploaded_at) - new Date(a.uploaded_at));
    // 워크스페이스 all-files 와 **같은 술어**로 접는다(사본 금지 — 두 화면이 다르게 보이면 안 된다).
    const merged = dedupeFileRows(results);
    // 업로더/발신자 이름 = 워크스페이스 표시명 (flat uploader_name 계정명 누출 fix, 2026-07-06)
    const nameMap = await getMemberNameMap(bizId, merged.map((r) => r.uploader_id));
    for (const r of merged) { const dn = r.uploader_id && nameMap.get(Number(r.uploader_id)); if (dn && dn.name) r.uploader_name = dn.name; }
    successResponse(res, merged);
  } catch (error) {
    next(error);
  }
});

module.exports = router;
