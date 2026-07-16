'use strict';

// 수신 메일 본문 정리 — 공용 유틸 (#153 언어감지 · #164 미리보기 공통 상류).
//   parsed.text 는 인용 이전대화·전달 헤더블록·서명·뉴스레터 프리헤더를 통째로 담는다.
//   그걸 날것으로 소비하면 (a) 언어감지가 "한글 한 글자라도 있으면 ko" 로 편향되고
//   (b) 미리보기가 "From: a@b / Sent: ..." 같은 헤더 영어조각·원본주소로 시작한다.
//   여기서 "새로 쓴 본문"만 남긴다. LLM 답장 입력 품질도 같이 올라간다.

// 인용/전달/서명 블록 시작 마커 — 이 지점부터 아래는 새 본문이 아니다 (가장 이른 지점에서 자른다).
//   주의: From:/보낸사람: 헤더 라인은 하드컷 마커로 두지 않는다 — 메일이 전달 헤더블록으로
//   "시작"하면(뉴스레터·순수 전달) index 0 에서 본문 전체가 날아간다. 선두 헤더 라인은
//   아래 HEADER_LINE 로 줄 단위 스킵한다. 하드컷은 명확한 구분선/인용 마커만.
const CUT_MARKERS = [
  /^-{2,}\s*Original Message\s*-{2,}/im,
  /^-{2,}\s*원본 메일\s*-{2,}/im,
  /^-{3,}\s*Forwarded message\s*-{3,}/im,
  /^On\b.{0,200}?\bwrote:\s*$/im,          // On Mon, Jul 16, 2026 ... <a@b> wrote:
  /^\d{4}년\s.+작성(자)?\s*:/im,           // 2026년 7월 16일 ... 님이 작성:
  /^_{5,}\s*$/m,                           // Outlook 구분선
  /^--\s*$/m,                              // RFC 3676 서명 구분선 (-- 또는 -- )
];

// 선두(본문 시작 전)에서만 스킵하는 헤더성 라인.
const HEADER_LINE = /^(from|to|cc|bcc|sent|date|subject|reply-to|보낸\s*사람|받는\s*사람|참조|날짜|제목)\s*:/i;

// HTML → 평문 (태그/엔티티 제거). body_text 가 비었을 때 폴백.
function htmlToText(html) {
  return String(html || '')
    .replace(/<(script|style)[^>]*>[\s\S]*?<\/\1>/gi, ' ')
    .replace(/<\/(p|div|br|li|tr|h[1-6])>/gi, '\n')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>')
    .replace(/&#39;/g, "'").replace(/&quot;/g, '"')
    .replace(/[ \t]+/g, ' ');
}

// "새로 쓴 본문"만 남긴다 — 인용/전달/헤더/선두 서명 제거.
function cleanVisibleBody(text, html) {
  let body = (text && String(text).trim()) ? String(text) : htmlToText(html);
  if (!body) return '';
  // 1) 인용/전달 마커에서 자른다 (가장 이른 지점)
  let cutAt = body.length;
  for (const re of CUT_MARKERS) {
    const m = body.match(re);
    if (m && m.index != null && m.index < cutAt) cutAt = m.index;
  }
  body = body.slice(0, cutAt);
  // 2) 인용 줄(>...) 제거 + 선두 헤더성/빈 줄 제거 (본문 시작 뒤엔 유지)
  const kept = [];
  let sawContent = false;
  for (const raw of body.split(/\r?\n/)) {
    const line = raw.trim();
    if (/^>/.test(line)) continue;                       // 인용 줄
    if (!sawContent && (!line || HEADER_LINE.test(line))) continue; // 선두 헤더/빈 줄
    if (line) sawContent = true;
    kept.push(raw);
  }
  return kept.join('\n').replace(/[ \t]+/g, ' ').replace(/\n{3,}/g, '\n\n').trim();
}

// 지배적 문자 비율로 언어 판정 — "한글 한 글자라도 있으면 ko" 편향 제거.
//   ko/en 문자 수를 세어 많은 쪽. 둘 다 0 이면 fallback.
function detectLang(text, fallback = 'ko') {
  const s = String(text || '');
  const ko = (s.match(/[가-힣]/g) || []).length;
  const en = (s.match(/[A-Za-z]/g) || []).length;
  if (ko === 0 && en === 0) return fallback;
  return ko >= en ? 'ko' : 'en';
}

// 리스트 미리보기 — 정리된 본문에서 maxLen 자.
function buildPreview(text, html, maxLen = 500) {
  return cleanVisibleBody(text, html).replace(/\s+/g, ' ').trim().slice(0, maxLen);
}

module.exports = { cleanVisibleBody, detectLang, buildPreview, htmlToText };
