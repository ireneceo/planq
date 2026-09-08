// services/fileIndex.js — 업로드한 파일의 **본문을 Cue 가 찾을 수 있게** 색인한다.
//
// Irene 2026-09-07·08 (세 번 요청): *"큐는 다 읽고 답해야지. 워크스페이스에서 어떤 파일을 찾거나
//   관련 내용들 찾으면 답변 해야지. 업무지원 능력 기본 아니야?"* /
//   *"cue가 파일들 검토해서 답변주고 파일도 찾아서 알려주는 것도 되어야 하는 거 아니야?
//    워크스페이스에 최적화된 모든 걸 아는 직원이어야지"*
//
// 여태 Cue 는 **파일 이름이 질문과 겹칠 때만** 상위 3건의 본문을 읽었다(`cue_context.getWorkspaceMatches`).
// 이름을 모르면 못 찾고, 내용으로는 아예 못 찾는다. 내용으로 찾으려면 색인이 필요하다.
//
// ★ 스키마를 늘리지 않는다. `kb_documents.source_type` 에 이미 `'file'` 이 있고
//   `source_file_id` 컬럼도 있다(수동 "파일 → Q info" 경로가 쓰던 모양 그대로다).
//   그래서 검색(`kb_service.hybridSearch`)·권한(`kbDocumentsListWhereByLevel`)·삭제가 전부 공짜로 붙는다.
//
// ★ 가시성은 **파일의 것을 그대로 옮긴다.** 색인은 자료를 옮기는 일이지 공개하는 일이 아니다.
//     프로젝트 파일 → scope 'project' (그 프로젝트 멤버 + owner/admin)
//     워크스페이스 파일 → scope 'workspace'
//     개인(L1) 파일 → **색인하지 않는다.** `hybridSearch` 의 스코프 OR 에 'private' 가 없어서
//       (kb_service.js: "private 는 검색 제외") 넣어도 영영 안 읽힌다 — 넣으면 비용만 나가고
//       "색인했다" 는 거짓 표시만 남는다.
//     기밀·대외비(security_level ≠ general) → **아예 색인하지 않는다**
//   회귀는 `node scripts/e2e/run.js --suite fileindex` 가 막는다(양성/음성 대조군 포함).
const { File, KbDocument, Project } = require('../models');
const kbService = require('./kb_service');
const { extractability, extractFileText } = require('./fileText');

// 본문 색인 상한. 이보다 크면 건너뛴다 — 임베딩 비용과 응답 지연이 곧바로 사용자에게 간다.
const INDEX_MAX_BYTES = 8 * 1024 * 1024;
// 한 파일에서 색인할 최대 글자 수. 청크로 잘려 저장되므로 이 값이 곧 청크 수를 정한다.
const INDEX_MAX_CHARS = 40_000;

/** 이 파일을 색인해도 되는가. 안 되면 **왜 안 되는지**를 같이 준다(화면·로그가 설명할 수 있게). */
function indexability(file) {
  if (!file) return { ok: false, reason: 'not_found' };
  if (file.deleted_at) return { ok: false, reason: 'deleted' };
  // 기밀·대외비는 AI 컨텍스트에 넣지 않는다 (Drive 미러와 같은 정책 — services/gdriveMirror.isEligible)
  if (file.security_level && file.security_level !== 'general') return { ok: false, reason: 'restricted' };
  if (Number(file.file_size || 0) > INDEX_MAX_BYTES) return { ok: false, reason: 'too_large' };
  // 개인 파일은 검색 스코프에 없다 — 색인해도 읽히지 않으므로 만들지 않는다.
  const level = file.vlevel || file.visibility || 'L3';
  if (level === 'L1') return { ok: false, reason: 'personal' };
  const can = extractability(file);
  if (!can.ok) return { ok: false, reason: can.reason };   // 'unsupported_type' | 'no_path'
  return { ok: true, kind: can.kind };
}

/** 파일의 가시성을 KbDocument 의 scope 로 옮긴다. */
function scopeForFile(file) {
  if (file.project_id) return { scope: 'project', project_id: file.project_id, client_id: null };
  return { scope: 'workspace', project_id: null, client_id: null };
}

/** 이 파일에 딸린 색인 문서(있으면). 파일 하나 = 문서 하나. */
function findDocFor(fileId, businessId) {
  return KbDocument.findOne({
    where: { business_id: businessId, source_type: 'file', source_file_id: fileId },
  });
}

/**
 * 파일 하나를 색인한다. 실패해도 **예외를 던지지 않는다** — 색인은 부가 기능이고,
 * 업로드가 색인 때문에 실패하면 안 된다. 무엇을 했는지는 반환값으로 알린다.
 * @returns {{ indexed: boolean, reason?: string, doc_id?: number }}
 */
async function indexFile(fileId, opts = {}) {
  try {
    const file = await File.findByPk(fileId);
    if (!file) return { indexed: false, reason: 'not_found' };

    const can = indexability(file);
    if (!can.ok) {
      // 자격을 잃은 파일에 옛 색인이 남아 있으면 지운다(기밀로 바뀐 파일이 계속 검색되면 안 된다).
      await removeFileIndex(fileId, file.business_id);
      return { indexed: false, reason: can.reason };
    }

    // 물리 파일은 UUID + content_hash 라 **불변**이다 — 이미 색인했으면 다시 하지 않는다.
    //   (옮기거나 프로젝트를 바꾼 경우는 scope 만 고쳐야 하므로 아래에서 따로 본다.)
    const existing = await findDocFor(file.id, file.business_id);
    const want = scopeForFile(file);
    if (existing && !opts.force) {
      const drifted = existing.scope !== want.scope
        || String(existing.project_id || '') !== String(want.project_id || '')
        || existing.title !== file.file_name;
      if (!drifted) return { indexed: true, reason: 'already', doc_id: existing.id };
      // 자리만 바뀌었으면 본문을 다시 뽑지 않는다 — 청크도 그대로 두고 메타만 맞춘다.
      await existing.update({ ...want, title: String(file.file_name || `File #${file.id}`).slice(0, 300) });
      return { indexed: true, reason: 'rescoped', doc_id: existing.id };
    }

    // 비용이 나가는 지점 — 플랜 게이트를 여기서 본다(임베딩은 Cue 월 한도와 같은 카운터를 쓴다).
    const plan = require('./plan');
    const allowed = await plan.can(file.business_id, 'use_cue').catch(() => ({ allowed: true }));
    if (allowed && allowed.allowed === false) return { indexed: false, reason: 'plan_blocked' };

    const text = await extractFileText(file, { maxChars: INDEX_MAX_CHARS });
    if (!text || !text.trim()) return { indexed: false, reason: 'empty_text' };

    let doc = existing;
    if (doc) {
      await doc.update({ ...want, body: text, title: String(file.file_name || `File #${file.id}`).slice(0, 300), status: 'pending' });
    } else {
      doc = await KbDocument.create({
        business_id: file.business_id,
        title: String(file.file_name || `File #${file.id}`).slice(0, 300),
        body: text,
        source_type: 'file',
        source_file_id: file.id,
        file_name: file.file_name,
        file_size: file.file_size,
        category: 'manual',   // ENUM 에 'file' 이 없다 — 분류는 categories 로 남긴다
        categories: ['file'],
        ...want,
        uploaded_by: file.uploader_id || null,
        // ★ 자동 색인 표식. 이게 없으면 Q info 목록이 파일로 도배된다 —
        //   사람이 고른 "파일 → Q info" 는 목록에 있어야 하고, 검색을 위해 자동으로 넣은 것은
        //   목록에 없어야 한다. 둘은 같은 테이블에 있지만 **성격이 다른 자료**다.
        custom_values: { auto_indexed: true },
        status: 'pending',
      });
    }
    // 임베딩은 시간이 걸린다 — 기다리지 않는다. 실패해도 문서는 남아 LIKE 폴백으로 검색된다.
    kbService.indexDocument(doc.id).catch((e) => {
      console.warn('[fileIndex] indexDocument 실패 (file', fileId, '):', e.message);
    });
    return { indexed: true, reason: existing ? 'reindexed' : 'created', doc_id: doc.id };
  } catch (e) {
    console.warn('[fileIndex] indexFile 실패 (file', fileId, '):', e.message);
    return { indexed: false, reason: 'error' };
  }
}

/**
 * 파일이 지워졌거나 자격을 잃었을 때 색인을 걷는다.
 * ★ 목록에서 지운 파일이 **답변에는 남아 있는 것**은 지우지 않은 것과 같다
 *   (memory: feedback_delete_needs_all_surfaces).
 */
async function removeFileIndex(fileId, businessId = null) {
  try {
    const where = { source_type: 'file', source_file_id: fileId };
    if (businessId) where.business_id = businessId;
    const docs = await KbDocument.findAll({ where });
    for (const d of docs) {
      // 청크는 KbDocument FK 로 매달려 있다 — 문서를 지우면 같이 정리된다(kb_service 와 같은 경로).
      await require('../models').KbChunk.destroy({ where: { kb_document_id: d.id } }).catch(() => {});
      await d.destroy();
    }
    return docs.length;
  } catch (e) {
    console.warn('[fileIndex] removeFileIndex 실패 (file', fileId, '):', e.message);
    return 0;
  }
}

/** 업로드/가져오기 직후 호출 — 응답을 막지 않는다. */
function indexOnUpload(fileId) {
  setImmediate(() => { indexFile(fileId).catch(() => {}); });
}

module.exports = {
  indexFile, removeFileIndex, indexOnUpload, indexability, scopeForFile, findDocFor,
  INDEX_MAX_BYTES, INDEX_MAX_CHARS,
};
