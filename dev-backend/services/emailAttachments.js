// #215 — 메일 첨부 표시 술어의 단일 원천.
//
// 읽기(email_threads detail 직렬화) · 쓰기(emailImapCron) · 백필 3곳이 같은 함수를 쓴다.
// 술어가 갈라지는 순간 "화면에는 보이는데 컬럼은 아니라고 하는" 상태가 생기고, 그게 #215 그 자체였다.
//
// ★ 권위는 `email_attachments.is_inline` 컬럼이 **아니라** "본문이 실제로 그 cid 를 참조하는가" 다.
//    옛 로직(`!!(att.cid || att.contentId)`)은 Content-ID 가 붙었다는 이유만으로 본문 삽입으로 단정했는데,
//    Apple Mail·국세청 등 다수 발신 시스템이 **일반 첨부에도 Content-ID 를 붙인다**.
//    그 결과 dev 3,221건 중 2,114건(66%)이 화면에서 사라졌고 그 안에 부가가치세 납부서·매입매출장·영수증이 있었다.
//
// ★ 오판정 시 안전 방향 = **보여준다(fail-open)**.
//    숨겨야 할 로고를 보여주는 비용 = 칩 1개. 보여야 할 세금계산서를 숨기는 비용 = 문서 소실(#215).
//    따라서 판단 재료가 없는 모든 분기는 false 로 떨어진다.

// content_id 정규화 — DB 에는 꺾쇠 포함(`<icon.png>`)으로 저장되지만 본문은 `cid:icon.png` 로 참조한다.
function normalizeCid(contentId) {
  if (!contentId) return '';
  return String(contentId).trim().replace(/^</, '').replace(/>$/, '').trim().toLowerCase();
}

// 이 첨부가 본문에 삽입된 것인가 (= 첨부 칩 목록에서 숨겨야 하는가).
//   contentId: email_attachments.content_id 원문 (null 가능)
//   bodyHtml : email_messages.body_html 원문 (null 가능)
//
// 정규식을 쓰지 않는다 — cid 에는 `.` `$` `+` 가 흔해서 메타문자 이스케이프가 곧 사고 표면이다.
// substring 검사라 `src="cid:x"` / `src='cid:x'` / `src=cid:x` / `url(cid:x)` 를 전부 커버한다.
function isEmbedded(contentId, bodyHtml) {
  const cid = normalizeCid(contentId);
  if (!cid || !bodyHtml) return false;          // 판단 재료 없음 → 보여준다
  const body = String(bodyHtml).toLowerCase();
  if (body.indexOf('cid:' + cid) !== -1) return true;
  try {
    // URL 인코딩 변형 (dev 실측 0건이지만 방어)
    const enc = encodeURIComponent(cid);
    if (enc !== cid && body.indexOf('cid:' + enc) !== -1) return true;
  } catch { /* malformed cid — fail-open */ }
  return false;
}

// 기계 파트 노이즈 — 사용자가 첨부로 인식할 수 없는 MIME.
//   rfc822-headers / delivery-status = 반송(바운스) 메일의 헤더·상태 파트 (dev 974건, 전부 filename='attachment')
//   x-amp-html = Gmail AMP 대체 본문 파트
// 칩에서 숨기고 신규 수신 시 File row 도 만들지 않는다. EmailAttachment row 자체는 남겨 원본 재구성 가능성을 보존한다.
const NOISE_MIMES = new Set([
  'text/rfc822-headers',
  'message/delivery-status',
  'text/x-amp-html',
]);

function isNoiseAttachment(mime) {
  return NOISE_MIMES.has(String(mime || '').toLowerCase().split(';')[0].trim());
}

module.exports = { normalizeCid, isEmbedded, isNoiseAttachment, NOISE_MIMES };
