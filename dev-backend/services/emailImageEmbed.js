// services/emailImageEmbed.js — 메일 본문에 넣은 **우리 이미지**를 CID 첨부로 바꾼다.
//
// 운영 #378 (Irene): "통일해서 맞춰서 일반적인 기능으로 해야 해. 파일 동기화랑 이미지나
//   파일 드래그 및 복사해서 넣었을 때나." Q info·Q Task·Q docs 본문에는 이미지를 넣을 수 있는데
//   메일 본문에는 못 넣고 있었다(RichEditor 에 uploadUrl 이 안 넘어가 handleDrop 이 즉시 return false).
//
// ★ 왜 URL 이 아니라 CID 인가 (Fable 설계 판정 2026-09-01):
//   ① `/api/files/public-image/:token` 은 **무인증·무만료·무회수**다(routes/files.js). 게다가
//      security_level·vlevel 을 보지 않는다 — 드래그아웃·Drive 미러는 막는 것을 이 경로만 통과시킨다.
//      메일에 그 주소를 박으면 그 구멍이 **워크스페이스 밖으로 영구히** 나간다. 메일은 전달·인용으로
//      퍼지고 회수 수단이 없다.
//   ② 이 코드베이스는 이미 CID 를 쓴다 — emailSend 의 `attachDataUrls: true` 가 받은 메일의
//      data:URI 를 multipart/related 로 내보내고, 플랫폼 메일 로고도 `cid:planq-logo@platform` 이다.
//      새 표준을 들이는 게 아니라 있는 정공법에 합류하는 것이다.
//   ③ **메일은 기록이다.** URL 이면 나중에 그 파일을 지우는 순간 수신자 메일함과 우리 보낸메일함
//      양쪽에서 그림이 사라진다. CID 는 발송 시점 바이트가 메일에 고정된다.
//   (수신측 "외부 이미지 차단" 에 걸리는 쪽은 원격 URL 이다. CID 는 첨부라 기본 표시된다 —
//    방향을 반대로 알고 있었다.)
//
// ★ 우리 것을 어떻게 알아보나 — **클래스 표식을 쓰지 않는다.**
//   `pq-table` 같은 클래스는 붙여넣은 남의 HTML 도 달고 올 수 있고, RichEditor 의 이미지에는
//   애초에 클래스가 안 붙는다. 대신 **"src 가 우리 public-image 경로이고 그 토큰의 File 행이
//   이 워크스페이스 것"** 으로 판정한다 — File 행은 서버만 만들므로 위조할 수 없다.
//   덕분에 전달(forward)에서 저절로 옳게 갈린다:
//     · 남의 원문 이미지(data: · 원격 https: · cid:) → 우리 판정에 안 걸린다. 손대지 않는다.
//     · 내가 보낸 이미지 메일을 전달 → 진짜 우리 것이라 다시 실린다. 수신자가 본다.
//
// 멱등: 치환하고 나면 src 가 `cid:` 라 정규식에 다시 안 걸린다. 저장본(body_html)은 URL 그대로
//   남으므로 초안 재발송·재전송은 언제나 URL 에서 출발한다. 두 번 불러도 결과가 같다.
const path = require('path');
const { Op } = require('sequelize');
const { File } = require('../models');
const { readAttachmentBody } = require('./attachmentStorage');
const { canAccessFileByLevel } = require('../middleware/access_scope');
const { isRenderableImage } = require('./filePreview');

// 인라인 이미지 총 예산. 메일은 SMTP 쪽 한도가 따로 있다(Gmail 25MB · 네이버 약 10MB).
//   플랜별 파일당 한도(최대 200MB)를 그대로 태우면 받는 쪽에서 반송된다.
const INLINE_BUDGET_BYTES = 8 * 1024 * 1024;

// 우리 public-image 주소만 잡는다. 상대경로·APP_URL 절대경로·`?w=1600` 붙은 것 모두.
const SRC_RE = /^(?:https?:\/\/[^/]+)?\/api\/files\/public-image\/([A-Za-z0-9._-]+)(?:\?[^"']*)?$/;
const IMG_RE = /<img\b[^>]*?\bsrc\s*=\s*(["'])(.*?)\1[^>]*>/gi;

class MailImageError extends Error {
  constructor(code, detail) { super(code); this.code = code; this.detail = detail || null; }
}

// public-image 라우트와 **같은 규칙**으로 File 을 찾는다. 규칙을 갈라 두면 반드시 어긋난다.
//   다만 여기서는 `business_id` 를 하나 더 건다 — 남의 워크스페이스 이미지를 우리 메일에
//   실어 보내지 않는다.
async function findOwnFile(token, businessId) {
  const looksLocal = /^[a-z0-9-]+\.[a-z0-9]+$/i.test(token);
  const looksDriveId = /^[A-Za-z0-9_-]{10,200}$/.test(token);
  if (!looksLocal && !looksDriveId) return null;
  if (looksLocal) {
    const row = await File.findOne({
      where: { business_id: businessId, file_path: { [Op.like]: `%${token}` }, deleted_at: null, storage_provider: 'planq' },
    });
    // LIKE 는 접미사 매칭이라 `e.png` 같은 짧은 값으로도 아무거나 걸린다 — 파일명 전체 일치만 인정.
    return row && path.basename(row.file_path) === token ? row : null;
  }
  return File.findOne({
    where: { business_id: businessId, external_id: token, deleted_at: null, storage_provider: 'gdrive' },
  });
}

function streamToBuffer(stream) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    stream.on('data', (c) => chunks.push(c));
    stream.on('end', () => resolve(Buffer.concat(chunks)));
    stream.on('error', reject);
  });
}

/**
 * 본문 HTML 의 우리 이미지를 `cid:` 로 바꾸고 nodemailer 첨부 목록을 만든다.
 *
 * @returns {{ html: string, attachments: Array }}
 * @throws  {MailImageError} 보안 등급 위반 · 바이트 없음 · 용량 초과.
 *   ★ 조용히 빼지 않는다. "수신자에게만 깨지는" 실패보다 "보내는 사람이 즉시 아는" 실패가 낫다 —
 *     작성 중에는 멀쩡했는데 받은 사람만 못 보는 것이 이 계열에서 가장 나쁜 실패 모양이다.
 */
async function embedOwnImages(html, { businessId, userId } = {}) {
  if (!html || !businessId || !html.includes('/api/files/public-image/')) {
    return { html: html || '', attachments: [] };
  }

  // 1) 어떤 토큰이 몇 번 쓰였는지 모은다 (같은 이미지 2번 참조 → 첨부 1개).
  const tokens = new Set();
  for (const m of String(html).matchAll(IMG_RE)) {
    const hit = SRC_RE.exec(m[2]);
    if (hit) tokens.add(hit[1]);
  }
  if (tokens.size === 0) return { html, attachments: [] };

  // 2) 토큰 → 바이트. 우리 것이 아니면 손대지 않는다(그대로 URL 로 남는다).
  const byToken = new Map();
  let budget = 0;
  for (const token of tokens) {
    const file = await findOwnFile(token, businessId);
    if (!file) continue;   // 남의 것·삭제된 것 — 우리가 실을 대상이 아니다
    // ★ 드래그아웃(/drag)·미리보기(public-image)와 **정말 같은 술어**를 건다.
    //   2026-09-01 Fable 실측: 처음엔 security_level 만 봐서
    //     ① 타 멤버의 **L1 개인 파일**이 메일로 실려 나갔고(/drag 는 403 하는 것)
    //     ② **이미지가 아닌 파일**(pdf 등)도 <img src> 에 넣으면 inline 첨부로 나갔다
    //        (public-image 로는 못 꺼내는 바이트가 메일로 나가는 새 채널이었다).
    //   "같은 술어" 라고 주석에 적어 두고 실제로는 갈라져 있었다 — 세 경로가 한 술어를 쓴다.
    if (file.security_level && file.security_level !== 'general') {
      throw new MailImageError('mail_image_security_level', file.file_name);
    }
    if (!isRenderableImage(file.mime_type)) {
      throw new MailImageError('mail_image_not_image', file.file_name);
    }
    if (userId != null && !(await canAccessFileByLevel(userId, file))) {
      throw new MailImageError('mail_image_forbidden', file.file_name);
    }
    const body = await readAttachmentBody(file);
    if (!body.ok || !body.stream) {
      // s3 redirect 등 스트림이 없는 저장소도 여기로 온다 — 실어 보낼 바이트가 없다.
      throw new MailImageError('mail_image_unavailable', file.file_name);
    }
    const buf = await streamToBuffer(body.stream);
    budget += buf.length;
    if (budget > INLINE_BUDGET_BYTES) throw new MailImageError('mail_image_too_large', file.file_name);
    byToken.set(token, {
      cid: `planq-img-${token}@planq`,   // 토큰에서 결정적으로 — 같은 이미지는 같은 cid
      content: buf,
      contentType: file.mime_type || 'application/octet-stream',
      filename: file.file_name || `${token}`,
      contentDisposition: 'inline',
    });
  }
  if (byToken.size === 0) return { html, attachments: [] };

  // 3) src 만 갈아끼운다. img 태그의 나머지 속성(width·style 등)은 그대로 둔다 —
  //    크기 조절해 넣은 결과가 메일에서도 그대로여야 한다.
  const out = String(html).replace(IMG_RE, (tag, q, src) => {
    const hit = SRC_RE.exec(src);
    if (!hit) return tag;
    const att = byToken.get(hit[1]);
    if (!att) return tag;
    return tag.replace(`${q}${src}${q}`, `${q}cid:${att.cid}${q}`);
  });

  return { html: out, attachments: [...byToken.values()] };
}

module.exports = { embedOwnImages, MailImageError, INLINE_BUDGET_BYTES };
