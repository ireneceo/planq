// 드래그로 OS 에 꺼낼 대상을 **출처별로** 찾고 권한을 판정한다 — 단일 원천.
//
// Irene 2026-09-20: *"나머지도 고쳐."* (드래그 다운로드가 «직접 올린 파일» 에만 되던 것)
//
// ★ 왜 조건만 풀면 안 됐나 — 화면의 합성 id 는 표마다 다른 번호다:
//     `direct-12` → files.id · `chat-45` → message_attachments.id · `task-7` → task_attachments.id
//   옛 라우트는 `files` 만 봤으므로 조건만 풀면 **엉뚱한 파일이 나간다.**
//
// ★ 무인증 서명 URL 의 표면이 넓어지는 일이다(CLAUDE.md R=1). 그래서 세 가지를 못으로 박는다:
//   ① 서명에 **출처를 넣는다**(v2). chat id 를 direct 로 상환할 수 없다.
//   ② 권한은 **각 출처의 다운로드 라우트와 같은 술어**를 쓴다. 여기서 새로 만들지 않는다:
//      direct=canDownloadFile · chat=canAccessConversation · task=canAccessTask
//   ③ 발급 때와 **상환 때 모두** 판정한다. 발급 시점 권한을 신뢰하지 않는다(5분 사이에 바뀐다).
// ★ 우리 디스크에 바이트가 있는 것만(`storage_provider='planq'`). Drive 는 리다이렉트라
//   Content-Disposition 을 보장할 수 없어 드래그 결과물이 뷰어 HTML 이 될 수 있다.
const { TaskAttachment, Task, MessageAttachment, Message, Conversation, File } = require('../models');

const RE = /^(?:(direct|chat|task)-)?(\d+)$/;

/** `direct-12` · `chat-45` · `task-7` · `12`(=direct) 를 가른다. */
function parseDragId(raw) {
  const m = RE.exec(String(raw || ''));
  if (!m) return null;
  return { source: m[1] || 'direct', id: Number(m[2]) };
}

/**
 * 이 사람이 이것을 밖으로 꺼낼 수 있는가. 되면 서빙에 필요한 것만 돌려준다.
 * 실패는 `{ error, code }` — 존재 여부를 흘리지 않도록 권한 실패는 403, 없는 것은 404.
 */
async function resolveDragTarget({ businessId, raw, userId, platformRole }) {
  const parsed = parseDragId(raw);
  if (!parsed) return { error: 'invalid_id', code: 400 };
  const { source, id } = parsed;
  // ★ 술어를 새로 만들지 않는다. `canDownloadFile`(routes/files.js)의 실체는 `canAccessFileByLevel`
  //   이고, 그 함수는 access_scope 가 내보낸다. 여기서 같은 것을 부른다 —
  //   라우트 안의 지역 함수를 복사하면 한쪽만 고쳐져 갈라진다.
  const { getUserScope, canDownloadFile, canAccessTask, canAccessConversation } = require('../middleware/access_scope');

  if (source === 'direct') {
    const f = await File.findOne({ where: { id, business_id: businessId, deleted_at: null } });
    if (!f) return { error: 'not_found', code: 404 };
    if (f.storage_provider !== 'planq') return { error: 'external_file_not_draggable', code: 400 };
    if (f.security_level && f.security_level !== 'general') return { error: 'security_level_blocks_drag', code: 403 };
    const scope = await getUserScope(userId, businessId, platformRole);
    if (!(await canDownloadFile(scope, userId, f))) return { error: 'forbidden', code: 403 };
    return { source, file_path: f.file_path, file_name: f.file_name, mime_type: f.mime_type };
  }

  if (source === 'task') {
    const att = await TaskAttachment.findOne({ where: { id, business_id: businessId } });
    if (!att) return { error: 'not_found', code: 404 };
    if (att.storage_provider !== 'planq') return { error: 'external_file_not_draggable', code: 400 };
    const task = await Task.findByPk(att.task_id);
    if (!task) return { error: 'not_found', code: 404 };
    const scope = await getUserScope(userId, businessId, platformRole);
    if (!(await canAccessTask(userId, task, scope))) return { error: 'forbidden', code: 403 };
    return { source, file_path: att.file_path, file_name: att.original_name, mime_type: att.mime_type };
  }

  // chat — message_attachments 에는 business_id 가 없다. 대화방으로 이어 붙여 **워크스페이스까지** 확인한다.
  const att = await MessageAttachment.findByPk(id);
  if (!att) return { error: 'not_found', code: 404 };
  if (att.storage_provider !== 'planq') return { error: 'external_file_not_draggable', code: 400 };
  const msg = await Message.findByPk(att.message_id);
  if (!msg) return { error: 'not_found', code: 404 };
  const conv = await Conversation.findByPk(msg.conversation_id);
  // ★ 워크스페이스 대조를 빼면 남의 테넌트 첨부를 내 워크스페이스 번호로 꺼낼 수 있다.
  if (!conv || Number(conv.business_id) !== Number(businessId)) return { error: 'not_found', code: 404 };
  if (!(await canAccessConversation(userId, conv))) return { error: 'forbidden', code: 403 };
  return { source, file_path: att.file_path, file_name: att.file_name, mime_type: att.mime_type };
}

module.exports = { parseDragId, resolveDragTarget };
