// 메일 헤더 읽기·정규화 — **분류의 입력을 한 벌로 만든다.**
//
// 왜 별도 모듈인가: `emailTriage` 는 이미 `emailSpamFilter` 를 require 한다. 스팸 필터가 헤더 리더를
// 거꾸로 가져오면 순환 require 가 된다. 두 모듈이 같은 리더를 쓰려면 아래로 내려야 한다.
//
// ★ 이 모듈이 존재하는 진짜 이유 (#221):
//   인입 경로(IMAP 수집)는 mailparser 의 **Map** 을, 재판정 경로는 DB 에서 복원한 **평문 객체**를 넘긴다.
//   `hget` 을 거치는 술어는 둘 다 읽지만, 직접 프로퍼티 접근(`headers.to`)을 하던 술어 두 개는
//   Map 에서 **항상 undefined** 였다 → 수집 시점에 "우리 주소로 직접 왔는가"·"우리 대화에 대한 회신인가"
//   판정이 영구 미발동. 실측으로 22 스레드가 뒤집혔고 그중 11건이 사용자에게 안 보이고 있었다
//   (세무사 납부서·청구서 전달 포함).
//   → 술어를 하나씩 고치는 대신 **입력을 같게 만든다.** 술어가 늘어도 같은 사고가 재발하지 않는다.

/** mailparser Map · 평문 객체 · 둘 다에서 헤더 한 개를 문자열로 읽는다. */
function hget(headers, key) {
  if (!headers) return null;
  try {
    let v = null;
    if (typeof headers.get === 'function') {
      v = headers.get(key);
      // mailparser 는 List-* 헤더를 'list' 키 하나로 접는다 — get('list-unsubscribe') 는 **항상 undefined**.
      //   접힌 값은 객체다: { unsubscribe: {url, mail}, id: {name, id} }.
      if (v == null && /^list-/i.test(key)) {
        const list = headers.get('list');
        if (list && typeof list === 'object') v = list[key.slice(5).toLowerCase()];
      }
    } else if (typeof headers === 'object') {
      const lower = String(key).toLowerCase();
      const hit = Object.keys(headers).find((k) => k.toLowerCase() === lower);
      v = hit ? headers[hit] : null;
    }
    if (v == null) return null;
    if (typeof v === 'string') return v;
    if (typeof v === 'object') return JSON.stringify(v); // List-Unsubscribe 등은 객체로 파싱될 수 있음
    return String(v);
  } catch { return null; }
}

/** 주소 목록을 평문 문자열로. mailparser 는 `{value:[{address,name}]}` 객체를, DB 는 `[{email,name}]` 을 준다.
 *  ★ 주소만 뽑는다 — 객체를 통째로 stringify 하면 **표시 이름까지 substring 매칭 대상**이 되어
 *    "우리 주소로 왔는가" 판정에 오탐 경로가 생긴다. */
function addrList(v) {
  if (!v) return '';
  if (typeof v === 'string') return v;
  if (Array.isArray(v)) {
    return v.map((x) => (typeof x === 'string' ? x : (x && (x.email || x.address)) || '')).filter(Boolean).join(', ');
  }
  if (typeof v === 'object' && Array.isArray(v.value)) {
    return v.value.map((x) => (x && (x.address || x.email)) || '').filter(Boolean).join(', ');
  }
  return '';
}

// 판정에 쓰는 헤더 (이것만 저장·정규화한다). 판정에 안 쓰는 값까지 쌓을 이유가 없다.
const TRIAGE_HEADER_KEYS = [
  'list-unsubscribe', 'list-id', 'precedence',            // 대량 발송 (RFC 2369)
  'auto-submitted', 'x-auto-response-suppress',           // 자동 발송 (RFC 3834)
  'feedback-id', 'x-mailgun-sid', 'x-sg-eid', 'x-campaign', 'x-csa-complaints', // ESP(대량발송기)
  // 외부 스팸 필터 점수 — 여태 저장하지 않아 **재판정 경로에선 스팸 점수가 눈을 감고** 자체 규칙으로만
  //   판정했다. 인입 경로를 평문 객체로 정규화하면 이 키들을 같이 옮겨야 그 신호가 죽지 않는다.
  'x-spam-score', 'x-spamd-bar', 'x-spam-status', 'x-spam-flag',
];

/** 수집 시점 — mailparser 헤더에서 판정용 키만 골라 평문 객체로. 없으면 null (빈 객체 X:
 *  "헤더 없는 옛 메일" 과 "헤더를 봤는데 아무 신호도 없던 메일" 은 다른 상태다). */
function pickTriageHeaders(headers) {
  if (!headers) return null;
  const out = {};
  for (const k of TRIAGE_HEADER_KEYS) {
    const v = hget(headers, k);
    if (v != null && v !== '') out[k] = String(v).slice(0, 500);
  }
  return out;   // {} 도 유효한 값 — "헤더를 봤고 신호가 없었다"
}

/**
 * 분류기에 넘길 **평문 객체 한 벌**을 만든다. 인입·재판정 두 경로가 이 함수 하나로 수렴한다.
 *
 * @param headers    mailparser Map 또는 저장된 triage_headers 평문 객체
 * @param toEmails   수신자 (mailparser `parsed.to` 또는 DB `to_emails` 배열)
 * @param inReplyTo  In-Reply-To
 * @param references References (배열 또는 공백 구분 문자열)
 */
function normalizeHeaders({ headers, toEmails, inReplyTo, references } = {}) {
  const out = { ...(pickTriageHeaders(headers) || {}) };
  const to = addrList(toEmails) || addrList(hget(headers, 'to'));
  if (to) out.to = to;
  const irt = inReplyTo || hget(headers, 'in-reply-to');
  if (irt) out['in-reply-to'] = String(irt);
  const refs = Array.isArray(references) ? references.join(' ') : (references || hget(headers, 'references'));
  if (refs) out.references = String(refs);
  return out;
}

/** In-Reply-To / References 에서 Message-ID 들을 뽑는다 (`<...>` 포함/미포함 모두).
 *  콜드메일 발송기가 **가짜 In-Reply-To** 를 달아 "우리 대화에 대한 회신" 으로 위장하는 것을
 *  가려내려면, 참조된 ID 가 실제로 우리 DB 에 있는지 봐야 한다. */
function referencedMessageIds(headers) {
  const raw = `${hget(headers, 'in-reply-to') || ''} ${hget(headers, 'references') || ''}`;
  const ids = (raw.match(/<[^<>\s]+>/g) || []).map((s) => s.trim());
  if (ids.length) return [...new Set(ids)];
  // 꺾쇠 없이 오는 발송기도 있다
  return [...new Set(raw.split(/\s+/).map((s) => s.trim()).filter((s) => s.includes('@')))];
}

module.exports = { hget, addrList, normalizeHeaders, pickTriageHeaders, referencedMessageIds, TRIAGE_HEADER_KEYS };
