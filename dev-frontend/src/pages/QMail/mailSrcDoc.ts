// 메일 본문 srcDoc 빌더 — MailPage.tsx 에서 절출 (god-file 래칫).
//
// 여기서 만드는 문자열은 sandbox iframe 의 srcDoc 이다. **호출은 반드시 useMemo 뒤에서** 한다 —
// DOMPurify 정화가 49KB~2MB 문서에 대해 돌기 때문에, 렌더마다 호출하면 높이 postMessage →
// setState → 재렌더 → 재정화 의 자기유발 루프가 된다 (2R-1 이전의 실제 병목).
//
// 인용 접기(2R-1)도 여기에 있다. 서버가 저장한 body_html 은 권위 데이터라 한 글자도 바꾸지 않고,
// **화면에서만** 접는다 — 그래서 옛 메일에도 백필 없이 즉시 적용된다.
import { sanitizeMailHtml } from '../../utils/sanitizeHtml';

export interface QuoteFoldLabels { show: string; hide: string }

// 인용 접기 스크립트 — 정화 **이후** 우리가 주입하는 코드다(정화기는 건드리지 않는다).
//
// 왜 필요한가: 받은 메일의 59%(운영 실측, 답변필요 39건 중 23건)가 본문 안에 지난 대화를 통째로
//   담고 있다. 접지 않으면 새로 온 몇 줄이 옛 대화 수십 KB 에 묻힌다
//   (Irene: "최신 메일 내용은 어디인지 보이지도 않아. 맨 아래는 답변한 내용이 붙어서 나오네").
//
// 판정은 2단이다:
//   Tier 1 — 인용 전용 클래스/구조(gmail_quote·planq_quote·blockquote[type=cite]·Outlook divRplyFwdMsg).
//            메일 클라이언트가 "이건 인용" 이라고 스스로 표시한 것이라 무조건 접는다.
//   Tier 2 — 맨 blockquote. **바로 앞에 머리말 라인이 있을 때만** 접는다. 인용부호로 강조한 본문
//            blockquote 를 접어버리면 그것이 사고라서, 머리말 없는 blockquote 는 절대 접지 않는다.
//
// ★ 백지 방지 스토퍼 — 접고 남는 본문이 20자 미만이면 접기를 **전면 취소**한다. 순수 전달 메일처럼
//   본문이 인용뿐인 경우 화면이 백지가 되는 사고를 막는다.
//
// 머리말 정규식은 services/emailBodyClean.js 의 CUT_MARKERS 포팅본이다 (서버는 줄 기반 텍스트,
//   여기는 DOM textContent 라 직접 재사용이 불가능하다). **CUT_MARKERS 를 고치면 여기도 같이 고칠 것.**
//   services/emailQuote.js 의 buildAttribution 이 이 마커에 매치되도록 만들어져 있어, 우리가 보낸
//   인용이 되돌아와도 잡힌다.
/** 속성값 이스케이프 — 라벨은 i18n 문자열이라 따옴표가 들어올 수 있다. */
function escAttr(v: string): string {
  return String(v || '').replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;');
}

// #215-H — cidMap: { 정규화된 cid → data: URI }. 본문의 `cid:xxx` 를 실제 이미지로 치환한다.
//   ★ 제약: sanitizeMailHtml 은 **한 글자도 건드리지 않는다**. 치환은 정화 **이후**의 순수 문자열 연산이다.
//     이 렌더러는 2026-07-31 에 #226(DOMPurify ALLOWED_URI_REGEXP 가 모든 속성값에 적용되어
//     align/width/colspan 전멸)·#200(img height 강제)로 막 고친 곳이라, 정화기나 guard CSS 를
//     건드리면 메일 본문 레이아웃 전체가 무너진다. cidMap 미전달 시 출력은 옛 코드와 완전히 동일해야 한다.
//   정규식을 쓰지 않는 이유는 cid 에 `.` `$` `+` 가 흔해서다 (services/emailAttachments.js 와 같은 판단).
export function buildMailSrcDoc(
  id: number,
  html: string,
  cidMap?: Record<string, string>,
  foldLabels?: QuoteFoldLabels,
): string {
  let safe = sanitizeMailHtml(html);
  if (cidMap && Object.keys(cidMap).length > 0) {
    // 본문의 원문 표기(대소문자)를 찾아 치환한다 — cidMap 의 키는 소문자 정규화된 값.
    for (const [cid, dataUri] of Object.entries(cidMap)) {
      // safe 가 매 회차 바뀌므로 소문자 사본도 매번 다시 뜬다 (한 번만 뜨면 2번째 cid 부터 인덱스가 밀린다)
      const lower = safe.toLowerCase();
      const needle = 'cid:' + cid;
      let from = 0;
      const spans: number[] = [];
      for (;;) {
        const at = lower.indexOf(needle, from);
        if (at === -1) break;
        from = at + needle.length;
        // ★ 경계 검사 — 단순 substring 이면 `cid:planq-embed-1` 이 `cid:planq-embed-10` 의
        //   **접두어**로 걸린다. 그러면 이미지 10번부터 엉뚱한 그림이 붙거나 깨진다.
        //   (Fable A-1 검증에서 잡힌 잠복 버그. 지금 실데이터는 메시지당 최대 8장이라 미발현이었다.)
        //   cid 는 토큰이므로 바로 뒤에 이어질 수 있는 문자는 cid 문자가 아니어야 한다.
        const next = lower.charCodeAt(from);
        const isCidChar = (next >= 48 && next <= 57)      // 0-9
          || (next >= 97 && next <= 122)                  // a-z (lower 사본이라 소문자만)
          || next === 45 || next === 46 || next === 95;    // - . _
        if (isCidChar) continue;                           // 더 긴 cid 의 일부다 — 건너뛴다
        spans.push(at);
      }
      // 뒤에서부터 잘라 붙여야 앞쪽 인덱스가 밀리지 않는다
      for (let i = spans.length - 1; i >= 0; i--) {
        safe = safe.slice(0, spans[i]) + dataUri + safe.slice(spans[i] + needle.length);
      }
    }
  }
  // ★ 2026-09-07 — 높이 보고와 인용문 접기를 **외부 파일**(/mail-frame.js)로 옮겼다.
  //   srcdoc iframe 은 부모 CSP 를 물려받는데 2026-09-02 정책이 `script-src 'self'` 라
  //   **인라인 스크립트가 전부 차단**됐다(실측). 그래서 높이 보고가 한 번도 안 나갔고,
  //   부모는 글자 수 추정치(본문 텍스트 없으면 200px)에 iframe 을 고정한 채 뒀다 —
  //   내용 636px 이 200px 상자에 담겨 **아래가 텅 빈 것처럼** 보였다
  //   (Irene: "이 내용 아래에 130-135px 정도 빈 여백", "첨부파일 있는 것만 이런 것 같아"
  //    — 알림 메일은 본문 텍스트가 비어 추정치가 최소값 200 으로 떨어져 가장 크게 어긋났다).
  //   CSP 를 푸는 것은 오답이다. 파일로 빼면 'self' 로 통과한다 — 정책은 그대로다.
  const attrs = foldLabels
    ? ` data-fold-show="${escAttr(foldLabels.show)}" data-fold-hide="${escAttr(foldLabels.hide)}"`
    : '';
  const resize = `<script src="/mail-frame.js" data-frame-id="${id}"${attrs}><\/script>`;
  // 가로 넘침만 최소 보정 (고정폭 템플릿이 패널보다 넓을 때 잘리지 않고 스크롤되게)
  // 최상위 고정폭 블록(뉴스레터 table/div/center)을 가운데 정렬 — Gmail 등 타 클라이언트와 동일.
  //   width 없는(=full) 콘텐츠는 margin:auto 영향 없이 그대로 풀폭. 고정폭만 중앙으로 모인다(Irene).
  // ★ img 규칙 — 전역 `height:auto` 는 발신자가 지정한 HTML height 속성(presentational hint)을 무효화해서,
  //   보낸 사람이 썸네일 크기로 줄여 넣은 이미지가 원본 크기로 부풀어 올랐다(#200). Gmail 은 이런 override 를
  //   하지 않는다. 크기 지정이 **없는** 이미지에만 height:auto 를 주고, 지정된 것은 발신자 의도를 존중한다.
  //   추가로 초대형 원본이 화면을 삼키지 않게 max-height 캡만 둔다(링크는 새 탭에서 원본).
  const guard = '<style>html,body{margin:0;padding:0;height:auto;}body{overflow-x:auto;display:flow-root;}'
    + 'img{max-width:100%;max-height:60vh;object-fit:contain;}'
    + 'img:not([height]):not([width]):not([style*="height"]):not([style*="width"]){height:auto;}'
    + 'body>table,body>div,body>center,body>a{margin-left:auto;margin-right:auto;}</style>';
  // 메일 본문 링크는 iframe 안이 아니라 **새 브라우저 탭**으로 — Gmail 등 타 클라이언트와 동일.
  //   <base target="_blank"> 로 모든 <a> 가 새 탭. sandbox 에 allow-popups(+escape) 를 줘야 실제로 열린다.
  //   (sanitizeMailHtml 이 **위험 스킴**(javascript:·vbscript:·data:text/html 등)을 차단한다. 스킴 없는
  //    상대값은 통과하는데, 그건 URI 가 아닌 속성값(align="center" 등)을 살리기 위한 것이다 — #226.
  //    최신 브라우저는 _blank 에 자동 noopener 적용.)
  const base = '<base target="_blank" rel="noopener noreferrer">';
  // 접기는 /mail-frame.js 안에서 **높이 보고보다 먼저** 한다(첫 보고가 접힌 높이여야
  //   120px → 풀높이 → 접힘 의 3단 점프가 없다). 여기서 따로 넣지 않는다.
  const fold = '';
  // ★ #272 — 조각(fragment) 판정은 **정화 전 원문**으로 한다.
  //   sanitizeMailHtml 은 DOMPurify WHOLE_DOCUMENT 라 조각을 넣어도 <html><body>…</body></html> 로
  //   감싸 돌려준다. 정화 결과로 판정하면 모든 메일이 "문서" 가 되어 아래 분기가 죽은 코드가 된다.
  const isFragment = !/<body[\s>]/i.test(html);
  // 조각 = 우리 컴포저에서 나간 답장이나 Gmail 발 답장 본문. 문서가 아니라 <style> 이 없으니
  //   iframe 기본 serif(명조) 로 렌더되고 여백 없이 가장자리에 붙었다
  //   (Irene: "이상한 명조체가 답변 내용에 적용", "우측이랑 아래는 여백이 없이 다 들러붙어서").
  //   ★ 완성 문서(뉴스레터 템플릿)에는 절대 적용하지 않는다 — 발신자 디자인을 덮으면 레이아웃이 깨진다.
  const fragStyle = isFragment
    ? "<style>body{font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,'Noto Sans KR',sans-serif;"
      + 'font-size:0.875rem;line-height:1.6;color:#0F172A;padding:2px 14px 12px 0;}</style>'
    : '';
  const hasDoc = /<body[\s>]/i.test(safe);
  if (hasDoc) {
    // <head> 있으면 그 안에, 없으면 최상단에 base 주입
    const withBase = /<head[^>]*>/i.test(safe) ? safe.replace(/<head[^>]*>/i, `$&${base}`) : `${base}${safe}`;
    if (/<\/body>/i.test(withBase)) return withBase.replace(/<\/body>/i, `${guard}${fragStyle}${fold}${resize}</body>`);
    return `${withBase}${guard}${fragStyle}${fold}${resize}`;
  }
  return `<!DOCTYPE html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">${base}${guard}${fragStyle}</head><body>${safe}${fold}${resize}</body></html>`;
}
