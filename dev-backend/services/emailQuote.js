// services/emailQuote.js — 답장에 원문 인용 붙이기.
//
// Irene: "답장인데 받은 메일이 안붙어서 가서 어디에 대한 답장인지 모르겠네"
//
// 여태 답장은 스레딩 헤더(In-Reply-To/References)만 붙이고 본문에는 원문을 넣지 않았다.
// 스레드로 묶어주는 클라이언트가 아니면 수신자는 무슨 메일에 대한 답인지 알 수 없다.
//
// ★ 인용은 **보내는 편지(wire)에만** 넣는다. 저장본(outbound row)에는 넣지 않는다 —
//   PlanQ 스레드 화면은 이미 전체 맥락을 보여주므로 중복이고, 미리보기·전달 원문·AI 입력이
//   인용으로 오염되며 답장마다 누적된다.
//
// ★ attribution 은 emailBodyClean 의 CUT_MARKERS 정규식에 **반드시 매치되어야** 한다.
//   그래야 상대가 우리 메일을 다시 인용해 보내와도 우리가 새 본문만 골라낼 수 있다.
//     ko: /^\d{4}년\s.+작성(자)?\s*:/im
//     en: /^On\b.{0,200}?\bwrote:\s*$/im   ← 'wrote:' 뒤에 아무것도 오면 안 된다(줄 끝 앵커)
//   그리고 HTML 만 보내면 수신측이 본문을 텍스트로 만들 때 태그가 공백이 되어 줄머리가 밀리고
//   `^` 앵커가 빗나간다 → **text 파트를 함께 만든다.**

const { htmlToText } = require('./emailBodyClean');

const esc = (s) => String(s == null ? '' : s)
  .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

const KO_DAYS = ['일', '월', '화', '수', '목', '금', '토'];

/** 인용 머리말 — 두 언어 모두 CUT_MARKERS 에 걸리는 형태로 만든다. */
function buildAttribution(date, name, email, locale = 'ko') {
  const d = date ? new Date(date) : new Date();
  const who = name ? `${name} <${email || ''}>` : `<${email || ''}>`;
  if (locale === 'en') {
    const s = d.toLocaleString('en-US', {
      weekday: 'short', month: 'short', day: 'numeric', year: 'numeric',
      hour: 'numeric', minute: '2-digit', hour12: true, timeZone: 'Asia/Seoul',
    });
    return `On ${s}, ${who} wrote:`;
  }
  const kst = new Date(d.toLocaleString('en-US', { timeZone: 'Asia/Seoul' }));
  const h = kst.getHours();
  const ampm = h < 12 ? '오전' : '오후';
  const h12 = h % 12 === 0 ? 12 : h % 12;
  const mm = String(kst.getMinutes()).padStart(2, '0');
  return `${kst.getFullYear()}년 ${kst.getMonth() + 1}월 ${kst.getDate()}일 (${KO_DAYS[kst.getDay()]}) ${ampm} ${h12}:${mm}, ${who} 님이 작성:`;
}

/** 원문 HTML 에서 인용에 쓸 부분만 — <body> 안쪽 + <style> 제거(문서 전역 스타일 누출 차단). */
function extractQuotableHtml(html) {
  let s = String(html || '');
  const m = /<body[^>]*>([\s\S]*?)<\/body>/i.exec(s);
  if (m) s = m[1];
  return s.replace(/<(script|style)[^>]*>[\s\S]*?<\/\1>/gi, '');
}

const MAX_QUOTE_BYTES = 200 * 1024;

/**
 * 답장 인용 블록 생성. 원문이 없거나 지나치게 크면 null (그 경우 인용 없이 발송 — 헤더 스레딩은 유지).
 * 반환 { html, text }.
 */
function buildQuote({ date, fromName, fromEmail, bodyHtml, bodyText, locale = 'ko' }) {
  const rawHtml = extractQuotableHtml(bodyHtml);
  const rawText = bodyText || (rawHtml ? htmlToText(rawHtml) : '');
  if (!rawHtml && !rawText) return null;
  if (Buffer.byteLength(rawHtml || rawText, 'utf8') > MAX_QUOTE_BYTES) return null;

  const attr = buildAttribution(date, fromName, fromEmail, locale === 'en' ? 'en' : 'ko');
  // gmail_quote 를 사칭하지 않는다 — 우리 표식을 쓴다.
  const html = `<br><div class="planq_quote"><div>${esc(attr)}</div>`
    + `<blockquote style="margin:0 0 0 8px;padding-left:12px;border-left:2px solid #E2E8F0;color:#475569;">`
    + `${rawHtml || esc(rawText).replace(/\n/g, '<br>')}</blockquote></div>`;
  // 텍스트 파트 — attribution 은 **줄 맨 앞**(열 0)이어야 ^ 앵커가 잡는다.
  const quotedLines = String(rawText || '').split('\n').map((l) => `> ${l}`).join('\n');
  const text = `\n\n${attr}\n${quotedLines}`;
  return { html, text };
}

/**
 * 전달(Forward) 인용 헤더 — 원문 위에 붙는 "---------- 전달된 메시지 ----------" 블록.
 *
 * ★ 2026-08-27 — 옛 라우트는 이것을 자기 안에서 조립하면서 두 가지가 틀렸다:
 *   ① `toISOString()` = **UTC 표기** — 한국 사용자에게 9시간 어긋난 시각이 찍혔다.
 *   ② "Forwarded message" **영어 고정** — 한국 수신자에게 어색하다.
 *   답장 인용(buildAttribution)이 이미 ko/en + Asia/Seoul 을 하고 있으므로 같은 방식으로 맞춘다.
 *   로케일 결정도 답장과 같은 규칙(quote_locale > 원문 detectLang) — 영어 고객에게 한국어
 *   머리말이 가는 사고를 답장에서 이미 한 번 겪었다.
 */
function buildForwardHeader({ date, fromName, fromEmail, to, cc, subject, locale = 'ko' } = {}) {
  const en = locale === 'en';
  const d = date ? new Date(date) : new Date();
  const when = en
    ? d.toLocaleString('en-US', { weekday: 'short', month: 'short', day: 'numeric', year: 'numeric', hour: 'numeric', minute: '2-digit', hour12: true, timeZone: 'Asia/Seoul' })
    : (() => {
      const kst = new Date(d.toLocaleString('en-US', { timeZone: 'Asia/Seoul' }));
      const h = kst.getHours();
      const ampm = h < 12 ? '오전' : '오후';
      const h12 = h % 12 === 0 ? 12 : h % 12;
      return `${kst.getFullYear()}년 ${kst.getMonth() + 1}월 ${kst.getDate()}일 (${KO_DAYS[kst.getDay()]}) ${ampm} ${h12}:${String(kst.getMinutes()).padStart(2, '0')}`;
    })();
  const L = en
    ? { title: '---------- Forwarded message ----------', from: 'From', date: 'Date', subject: 'Subject', to: 'To', cc: 'Cc' }
    : { title: '---------- 전달된 메시지 ----------', from: '보낸사람', date: '날짜', subject: '제목', to: '받는사람', cc: '참조' };
  const who = fromName ? `${esc(fromName)} &lt;${esc(fromEmail || '')}&gt;` : `&lt;${esc(fromEmail || '')}&gt;`;
  const rows = [
    `${L.from}: ${who}`,
    `${L.date}: ${esc(when)}`,
    `${L.subject}: ${esc(subject || '')}`,
    to ? `${L.to}: ${esc(to)}` : '',
    cc ? `${L.cc}: ${esc(cc)}` : '',
  ].filter(Boolean).join('<br>');
  return '<div style="border-top:1px solid #e2e8f0;padding-top:10px;margin-top:16px;color:#64748b;font-size:13px;line-height:1.6">'
    + `${L.title}<br>${rows}</div>`;
}

module.exports = { buildQuote, buildAttribution, buildForwardHeader, extractQuotableHtml, MAX_QUOTE_BYTES };
