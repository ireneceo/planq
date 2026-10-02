// saleMailCriteria — "이 메일을 영업 상담으로 **자동으로** 들일 것인가"
//
// Irene 2026-09-16: *"Q sale에서 상담리스트에서 메일이 너무 쓸데없이 많이 들어와.
//   그냥 신청하라는 홍보메일도 가져오면 어떻게 해? 영업 상담으로 가져오는 기준설정 좀 잡아봐."*
//
// ★ 키워드로 가르지 않는다. 그 길은 이미 두 번 걸었고 두 번 다 샜다 —
//   발송전용 주소 패턴(`AUTOMATED_SENDER`)을 늘리고, 광고 표기·List-* 헤더를 보탰는데도
//   운영 실측(2026-09-16, 고객 미연결 `triage='human'` 32건)에서 상담 목록에 오른 것은:
//     · `[With Min]: New order #3162~3171` 쇼핑몰 주문 알림 10건 (`help@withmin.info`)
//     · 11번가 개인정보 통지 · 롯데카드 약관 · MS 약관 · 삼성생명 안내 · Tripadvisor 광고
//     · **[한국무역협회] 수출상담회 참가 신청** ← Irene 이 말한 "신청하라는 홍보메일" 바로 그것
//   진짜 문의는 7건뿐이었고, 그중 5건이 **우리가 이미 회신했거나 개인 주소**였다.
//   패턴을 더 늘리면 진짜 문의를 떨어뜨린다(2026-09-12 실측: 과한 기준이 903 → 10 으로 잘랐다).
//
// 그래서 축을 **관계**로 바꾼다. 자동으로 들어오는 것은 관계가 증명된 것뿐이고,
// 나머지는 버리지 않고 **「후보」** 로 모아 사람이 한 번 눌러 올린다(routes/sale_save.js `inbox/promote`).
// 좁힌 기준의 대가를 갚을 문이 있어야 기준을 좁힐 수 있다 — 둘은 한 벌이다.
//
// ★ 판정은 여기 한 곳이다. `saleInbox` 는 목록과 **집계**를 각각 도는데(공식이 두 벌이면 이미
//   갈라져 있다 — memory feedback_same_value_multiple_formulas) 둘 다 이 함수를 부른다.

// «보낸 사람이 사람인가» 는 services/contactRelation 한 곳이다(#449·#450 — 메일 답변필요와 같은 부품).
const { isPersonalSender, ROLE_WORD } = require('./contactRelation');

/**
 * 한 메일 스레드의 판정.
 * @param {object} p
 * @param {string} p.email            바깥 사람의 주소
 * @param {number} p.outboundCount    이 스레드에서 **우리가 보낸** 메일 수
 * @param {boolean} p.promoted        사람이 [상담으로 보내기] 를 눌렀는가
 * @param {boolean} p.archived         Q mail 에서 **[확인완료]** 를 누른 스레드인가
 * @returns {{kind:'inquiry'|'candidate', reason:string}}
 */
function mailThreadVerdict({ email = null, outboundCount = 0, promoted = false, archived = false } = {}) {
  // 사람의 판단이 기계보다 위다 — 올린 것은 기준을 다시 묻지 않는다.
  if (promoted) return { kind: 'inquiry', reason: 'promoted' };
  // 우리가 한 번이라도 답했다 = 이미 관계다. (상대가 우리 메일에 회신한 경우도 이 스레드에
  //   우리 발신이 있으므로 여기서 함께 걸린다 — 축을 둘로 나누지 않는다.)
  if (Number(outboundCount) > 0) return { kind: 'inquiry', reason: 'replied' };

  // ★ **확인완료한 것에는 «개인 주소» 추정을 쓰지 않는다** (2026-09-17, Fable 15차 차단).
  //   «확인완료 + 우리 답 없음» 은 사람이 **보고 무시했다**는 가장 강한 신호다.
  //   그런데 주소 모양만 보고 관계로 읽으면, Q mail 에서 치운 은행 거래 알림·몰 회람·콜드 스팸이
  //   전부 상담으로 되살아난다 — 운영 실측(owner 계정 2개 합산) **4 → 48**, 그중 32건이 그 모양이었다.
  //   확인완료한 것은 **행위로 증명된 관계**(우리가 답했다 / 사람이 올렸다)일 때만 들인다.
  //   그래도 놓친 것은 Q mail 우클릭 [상담으로 보내기] 로 올린다 — 문은 그대로다.
  if (archived) return { kind: 'candidate', reason: 'handled_no_reply' };

  if (isPersonalSender(email)) return { kind: 'inquiry', reason: 'personal' };
  return { kind: 'candidate', reason: 'no_relationship' };
}

module.exports = { mailThreadVerdict, isPersonalSender, ROLE_WORD };
