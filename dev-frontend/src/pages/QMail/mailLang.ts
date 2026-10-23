// 메일 원문 언어 추정 · 번역 대상 고르기 — MailPage 에서 나눔(동작 그대로)
// ─────────────────────────────────────────────────────────────
// 번역 대상 언어 자동 선택 (운영: Irene 2026-08-28)
// ─────────────────────────────────────────────────────────────
//   "메일이 한국어인데 번역하기 디폴트가 왜 한국어야? 영어로 하던가 해야지."
//   옛 기본값은 **UI 언어** 였다. 한국어 UI 에서 한국어 메일을 열면 한→한 번역이라 아무 의미가 없고,
//   백엔드도 `unsupported_or_same_language` 로 떨어뜨린다(services/translation_service.js).
//   원문 언어를 글자로 추정해 **원문과 다른 언어**를 기본값으로 준다.
//   ★ LLM 호출 전이라 서버의 detected_language 를 쓸 수 없다 — 문자 종류로 충분히 갈린다.
//     정확한 판별이 목적이 아니라 "같은 언어로 번역하기" 를 막는 것이 목적이다.
// ★ 2026-09-09 (Irene: "메일 내용이 영어인데 번역 선택에 영어로 나오고 있어. 메일내용이 영어면
//   한국어(유저설정언어), 한국어면 영어를 기본으로 해달라고 했는데.")
//   규칙(pickTranslateTarget)은 맞았는데 **원문 판별이 틀렸다.** 옛 구현의 두 구멍:
//   ① **첫 문자 종류가 이긴다** — 앞 400자 안에 한글이 한 글자만 있어도(서명·인용·"안녕하세요")
//      영어 본문이 'ko' 로 판정돼, 기본 대상이 **영어**로 뒤집혔다. 그게 이 신고의 모양이다.
//   ② **HTML 전용 메일은 body_text 가 비어** '' 를 내고 UI 언어로 떨어졌다.
//   → 첫 일치가 아니라 **글자 수를 센다**, 그리고 본문이 비면 HTML 에서 글자를 꺼낸다.
//   목적은 정밀 판별이 아니라 "같은 언어로 번역하기" 와 "뒤집힌 기본값" 을 막는 것이다.
// ★ 2026-10-22 (Irene: *"프로필 선택 언어라면 숨김처리 … 설정된 언어랑 다른 언어일 때만 보이게"*) — 이 판별이
//   이제 번역 줄을 **보일지**까지 정한다. 한국어 답장 323자 + 아래 인용 이력·링크·파일 이름의 영문 948자가 'en' 으로
//   판정됐다(dev 메시지 2692 실측). 그래서 ① 인용 이력 앞(새로 쓴 부분)만 읽고 ② 링크·주소·[image: …] 를 빼고
//   ③ 한·중·일 한 글자는 영문 여러 글자에 해당하므로 무게를 준다.
function stripHtmlToText(html?: string | null): string {
  return String(html || '')
    .replace(/<(script|style|head)[\s\S]*?<\/\1>/gi, ' ')
    // 인용 이력(blockquote·Gmail/Outlook 인용 상자)은 원문 언어가 아니다
    .replace(/<blockquote[\s\S]*?<\/blockquote>/gi, ' ')
    .replace(/<div[^>]*class="[^"]*(gmail_quote|divRplyFwdMsg|planq_quote)[^"]*"[\s\S]*$/i, ' ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&[a-z#0-9]+;/gi, ' ');
}
// 새로 쓴 부분 — 첫 인용 줄('>')이나 인용 머리(On … wrote: · …님이 작성: · Original Message · From:/보낸 사람:) 앞까지.
function newPartOf(text: string): string {
  const lines = text.split(/\r?\n/);
  const out: string[] = [];
  for (const line of lines) {
    const l = line.trim();
    if (/^>/.test(l) || /^-{2,}\s*(Original Message|원본 메시지|Forwarded message|전달된 메시지)/i.test(l)
      || /^(From|보낸 사람|보낸사람)\s*:/i.test(l) || /wrote:\s*$/i.test(l) || /작성:\s*$/.test(l)) break;
    out.push(line);
  }
  // 인용 머리가 «… 님이» / «작성:» 두 줄로 갈린 경우 앞줄(날짜·이름)도 뺀다
  while (out.length && /님이\s*$|^\s*$/.test(out[out.length - 1])) out.pop();
  return out.join('\n');
}
export function guessLangFromText(text?: string | null, html?: string | null): string {
  // 본문이 비면 HTML 에서 꺼낸다. 2,000자면 서명 한 줄에 휘둘리지 않는다.
  //   새로 쓴 부분이 비면(덧붙인 말 없이 전달·인용만) 전체를 읽는다.
  const full = String(text || '').trim() ? String(text) : stripHtmlToText(html);
  const fresh = String(text || '').trim() ? newPartOf(full) : full;
  const base = /[A-Za-z\uAC00-\uD7A3\u3040-\u30FF\u4E00-\u9FFF]/.test(fresh) ? fresh : full;
  const raw = base
    .replace(/https?:\/\/\S+|www\.\S+/gi, ' ')
    .replace(/\S+@\S+\.\S+/g, ' ')
    .replace(/\[(image|이미지)[^\]]*\]/gi, ' ')
    .slice(0, 2000);
  if (!raw.trim()) return '';
  const count = (re: RegExp) => (raw.match(re) || []).length;
  // 한글 한 음절·한자·가나 한 글자 ≈ 영문 서너 글자. 무게 없이 세면 한국어 본문 옆 영문 이름·회사명이 이긴다.
  const scores: Array<[string, number]> = [
    ['ko', count(/[\uAC00-\uD7A3]/g) * 3],
    ['ja', count(/[\u3040-\u309F\u30A0-\u30FF]/g) * 3],
    ['zh', count(/[\u4E00-\u9FFF]/g) * 3],
    ['en', count(/[A-Za-z]/g)],
  ];
  scores.sort((a, b) => b[1] - a[1]);
  const [topLang, topN] = scores[0];
  if (topN === 0) return '';
  // 일본어는 한자를 섞어 쓰므로, 가나가 조금이라도 있으면 zh 가 아니라 ja 다.
  const kana = scores.find(([l]) => l === 'ja')?.[1] || 0;
  if (topLang === 'zh' && kana > 0) return 'ja';
  return topLang;
}
// 원문 언어와 UI 언어를 보고 "번역할 만한" 대상을 고른다.
//   원문 ≠ UI 언어면 UI 언어로(내가 읽으려는 것). 같으면 영어로, 원문이 영어면 UI 언어로.
export function pickTranslateTarget(sourceLang: string, uiLang: string): string {
  const ui = uiLang?.startsWith('en') ? 'en' : 'ko';
  if (!sourceLang) return ui;
  if (sourceLang !== ui) return ui;
  return ui === 'en' ? 'ko' : 'en';
}
