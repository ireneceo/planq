// services/postLinkedPublic.js — 문서 공유 링크에 «연결 문서» 를 싣는다 (2026-11-03).
//
//   Irene: "문서에 다른 문서를 연결했는데 그 문서 다운로드가 안나와. 파일 연결한 것만 나와."
//   운영 실측 — 계약서(133)에 견적 제안서(131)를 연결했는데 공개 페이지는 파일 첨부만 실었다.
//
//   ★ 새 공개 표면을 만들지 않는다. 연결 문서가 **자기 공유 링크로 이미 열리는 것**만 싣고,
//     주소도 그 문서 자기 공개 주소(/public/posts/<그 문서 토큰>)를 쓴다. 판정은 공개 라우트와
//     같은 함수(shareOpenable.shareOpenReason) + 밖으로 내보내는 문의 보안등급 게이트(blocksExternalShare).
//     링크가 없거나 닫힌 연결 문서는 제목조차 내보내지 않는다(존재 자체가 정보다 — 첨부와 같은 선).
//   ★ 비밀번호가 걸린 연결 문서는 PDF 주소를 주지 않는다 — 자기 공개 페이지가 비밀번호를 묻는다.
const { shareOpenReason } = require('./shareOpenable');
const { blocksExternalShare } = require('./securityLevel');
const postLinks = require('./postLinks');

/** 공개 링크가 지금 열리는 문서인가 — 공개 라우트와 같은 열림 판정 + 보안등급. */
function isLinkPublic(p) {
  return !!p && shareOpenReason('post', p) === null && !blocksExternalShare(p);
}

/**
 * @param {object} post  Post 인스턴스(공개 라우트가 이미 열기로 한 문서)
 * @param {object} Post  모델
 * @returns {Promise<Array<{id:number,title:string,kind:string,url:string,pdf_url:string|null}>>}
 */
async function publicLinkedDocs(post, Post) {
  const ids = await postLinks.effectiveLinkIds(post);
  if (!ids.length) return [];
  const rows = await Post.findAll({ where: { id: ids, business_id: post.business_id } });
  const byId = new Map(rows.map((r) => [r.id, r]));
  const out = [];
  for (const id of ids) {
    const p = byId.get(id);
    if (!isLinkPublic(p)) continue;
    out.push({
      id: p.id,
      title: p.title,
      kind: p.kind,
      url: `/public/posts/${p.share_token}`,
      pdf_url: p.share_password_hash ? null : `/api/posts/public/${p.share_token}/pdf`,
    });
  }
  return out;
}

module.exports = { publicLinkedDocs, isLinkPublic };
