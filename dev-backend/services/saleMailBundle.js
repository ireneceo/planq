// saleMailBundle — 상담 목록의 미등록 메일을 **사람(바깥 주소) 한 줄**로 묶는다 (2026-10-23)
//
// Irene: *"같은 고객인데 메일이 여러 개 있다고 각각 다 리스트업되는게 맞아? … 답변보낸 것도 나오고 있는 거고
//   이게 그룹핑이 되어야 상담 건건이 고객별로 관리가 되는 거 아니야?"*
// Fable 설계 판정(2026-10-23): 고객으로 등록하면 그 주소의 스레드가 전부 고객 한 줄로 모이는데
//   (clientLinkSource.attachSourceToClient · mailLink.linkThread), 등록 **전**만 스레드마다 한 줄이었다 — 그 비대칭이 신고의 정체.
//   그래서 등록 전도 같은 단위로 묶는다. 판정 기준(saleMailCriteria)은 그대로 — 바뀌는 것은 **표시 단위**다.
//   «대응 끝» 상태는 만들지 않는다(qsale.md 09-18 계약 유지): 답장을 보낸 스레드는 그 사람 줄의 이력으로 들어가고
//   줄의 «답할 차례» 가 꺼진다. 새 메일이 오면 최신 스레드가 바뀌어 다시 켜진다(상태가 없어야 저절로 성립한다).
//
// ★ 묶음 키 = 화면 `inboxPersonRemove.personKeyOf` 의 이메일 갈래와 같은 술어(소문자·공백 제거).
//   주소가 없거나 웹폼 릴레이(사람이 아니다 — 묶으면 다른 사람 문의가 한 줄이 된다)는 스레드 한 줄 그대로.
// ★ 목록·숫자·보관함이 **이 파일 한 벌**을 읽는다. 각자 묶으면 칩 숫자와 행 수가 갈라진다.

/** 묶음 키 — email 은 이미 릴레이를 걸러 낸 값(릴레이면 null)을 넘긴다 */
function bundleKeyOf(email, threadId) {
  const e = String(email || '').trim().toLowerCase();
  return e ? `e:${e}` : `t:${threadId}`;
}

/** 분류 결과(ids + meta)를 묶음 수로 센다 — 숫자 칩용. 목록의 bundleItems 와 같은 키를 쓴다. */
function countBundles(ids, meta, emailOf) {
  const keys = new Set();
  const needs = new Set();
  for (const id of ids) {
    const k = bundleKeyOf(emailOf(id), id);
    keys.add(k);
    if (meta && meta.get(id)?.reply_needed) needs.add(k);
  }
  return { bundles: keys.size, needsReply: needs.size };
}

/** 스레드 행들을 사람 한 줄로 — 대표 = 가장 최근 스레드(ref·id 가 대표 것이라 기존 문이 그대로 작동한다).
 *  needs_reply = 하나라도 · handled = 전부 · 이유 칩은 답할 차례인 스레드 중 최신(없으면 대표). */
function bundleItems(rows) {
  const sorted = [...rows].sort((a, b) => new Date(b.at || 0) - new Date(a.at || 0));
  const groups = new Map();
  for (const it of sorted) {
    const k = bundleKeyOf(it.email, it.ref.id);
    if (!groups.has(k)) groups.set(k, []);
    groups.get(k).push(it);
  }
  const out = [];
  for (const list of groups.values()) {
    const rep = list[0];
    const needy = list.find((x) => x.needs_reply);
    out.push({
      ...rep,
      needs_reply: !!needy,
      handled: list.every((x) => x.handled),
      meta: {
        ...rep.meta,
        ...(needy && needy !== rep ? {
          verdict: needy.meta?.verdict, mail_folder: needy.meta?.mail_folder, reason: needy.meta?.reason,
        } : {}),
        thread_ids: list.map((x) => x.ref.id),
        thread_count: list.length,
        // 패널이 그 사람의 스레드를 고르는 목록(최신순) — 행이 이미 가진 값만(새 조회 없음)
        threads: list.map((x) => ({
          id: x.ref.id, title: x.title, at: x.at, direction: x.meta?.direction || null,
          handled: !!x.handled, needs_reply: !!x.needs_reply,
        })),
      },
    });
  }
  return out;
}

module.exports = { bundleKeyOf, countBundles, bundleItems };
