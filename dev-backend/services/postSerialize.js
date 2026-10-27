// 문서(post) 응답 모양 — 한 벌 (2026-10-27, routes/posts.js 에서 옮겼다 · 동작 무변경).
//   문서 목록·상세·PUT 응답(routes/posts.js)과 프로젝트 «연결됨» 문서 행(routes/project_refs.js)이 같은 모양을 쓴다.
//   (옮긴 이유: posts.js god-file 래칫 — 연결 행이 같은 모양을 쓰려면 꺼내야 했다)
const APP_URL = process.env.APP_URL || 'https://dev.planq.kr';

function serialize(p, withContent = false) {
  return {
    id: p.id,
    business_id: p.business_id,
    project_id: p.project_id,
    conversation_id: p.conversation_id,
    title: p.title,
    category: p.category,
    status: p.status,
    visibility: p.visibility,
    is_pinned: p.is_pinned,
    view_count: p.view_count,
    author: p.author ? { id: p.author.id, name: p.author.name } : null,
    editor: p.editor ? { id: p.editor.id, name: p.editor.name } : null,
    project: p.Project ? { id: p.Project.id, name: p.Project.name, color: p.Project.color } : null,
    conversation: p.Conversation ? { id: p.Conversation.id, title: p.Conversation.display_name || p.Conversation.title || null } : null,
    share_token: p.share_token || null,
    share_url: p.share_token ? `${APP_URL}/public/posts/${p.share_token}` : null,
    shared_at: p.shared_at || null,
    // 자료정리 메타 (category='brief' 인 post 만 채워짐). BriefViewer 가 사용
    brief_meta: p.brief_meta || null,
    parent_post_id: p.parent_post_id || null,
    kind: p.kind || 'doc',
    q_record_id: p.q_record_id || null,
    // N+72-7 — serialize 에 vlevel/target_member_ids 빠져 있어 PUT 응답에 안 실리는 회귀 fix
    vlevel: p.vlevel || (p.project_id ? 'L2' : 'L3'),
    security_level: p.security_level || 'general',
    target_member_ids: Array.isArray(p.target_member_ids) ? p.target_member_ids : null,
    linked_post_ids: Array.isArray(p.linked_post_ids) ? p.linked_post_ids : [],
    created_at: p.createdAt,
    updated_at: p.updatedAt,
    content_preview: (p.content_text || '').slice(0, 200),
    ...(withContent ? {
      content_json: p.content_json ? (typeof p.content_json === 'string' ? JSON.parse(p.content_json) : p.content_json) : null,
      attachments: (p.attachments || []).map(a => ({
        id: a.id, file_id: a.file_id, sort_order: a.sort_order,
        file: a.file ? {
          id: a.file.id,
          file_name: a.file.file_name,
          file_size: Number(a.file.file_size),
          mime_type: a.file.mime_type,
          storage_provider: a.file.storage_provider,
          external_url: a.file.external_url,
          // 공유 모달이 "이 첨부가 공개 링크로 나가는가" 를 표시하는 근거(#378 후속).
          //   이 화이트리스트에 없어서 프론트가 늘 undefined 를 읽었고, 그래서 **이미 공개된
          //   첨부까지 "링크로 안 나감" 으로 표시**됐다 — 소유자에게 노출을 과소보고하는 거짓 안내였다.
          //   ※ 공개 응답에는 L4 첨부만 실리므로 여기에 등급이 실려도 새는 정보가 없다.
          vlevel: a.file.vlevel,
          visibility: a.file.visibility,
          // ★ gdrive 라고 external_url 로 직행시키지 않는다 — 수신자에게 구글 401 이다.
          //   서버가 바이트를 흘려주는 API 경로로 통일한다(2026-09-03).
          download_url: `/api/files/${a.file.business_id}/${a.file.id}/download`,
        } : null,
      })),
    } : {}),
  };
}

module.exports = { serialize };
