// Q Mail 폴더 정의 — 폴더 키 → Sequelize where 절 (Q_MAIL_SPEC §4.1 폴더 트리 정합).
//
// routes/email_threads.js 에서 절출 (god-file 래칫). 폴더의 "의미"는 리스트 라우트와 벌크 처리
// 양쪽이 같은 정의를 써야 하므로 단일 원천으로 둔다 — 한쪽만 고치면 "화면엔 있는데 일괄 처리에선
// 빠지는" 어긋남이 생긴다.
const { Op } = require('sequelize');
const { sequelize } = require('../config/database');

// 폴더 → where 매핑 (Q_MAIL_SPEC §4.1 폴더 트리 정합)
//
// ★ businessId 인자는 'sent' 분기의 서브쿼리 격리에 쓰인다 (#262). 없으면 sent 는 빈 집합을 준다 —
//   fail-closed. 다른 워크스페이스의 메시지가 후보 집합에 섞이는 것보다 안 보이는 편이 안전하다.
function folderWhere(folder, userId, businessId) {
  switch (folder) {
    case 'reply_needed': return { reply_needed: true, status: { [Op.in]: ['open', 'uncertain'] } };
    // assigned/following 은 EmailThreadParticipant 조인 필요 → 리스트 라우트에서 thread_id 필터로 처리. 여기선 status 기준만.
    case 'assigned':
    case 'following': return { status: { [Op.in]: ['open', 'uncertain'] } };
    // 확인 권장 = "한 번 보고 판단할 것" — 처리 완료(옛 inbox)를 여기에 합쳤다.
    //   ① 애매한 메일 (status='uncertain'): 스팸·광고는 아닌데 업무인지 모르겠는 것,
    //      그리고 자동 발송이지만 내용이 업무인 것(결제 완료·보고서·시스템 업무 안내)
    //   ② (2026-09-01 #402 로 철회) 여기엔 더 이상 "내가 답장한 메일" 이 담기지 않는다 —
    //      답장하면 확인 권장에서도 빠지고 전체·보낸메일에만 남는다. 아래 조건 참조.
    //   두 개가 사실상 같은 성격("답장할 건 아닌데 봐야 하는 것")이라 탭을 나눌 이유가 없다 (Irene).
    //   ★ 2026-08-27 운영 #386 — `reply_needed: false` 는 **두 갈래 모두**에 걸려야 한다.
    //     여태 아래 open 갈래에만 있어서, status='uncertain' 인 메일을 "답변 필요" 로 표시하면
    //     답변필요 폴더에 더해지면서 **확인 권장에서 빠지지 않았다** — 한 메일이 두 곳에 동시에.
    //     (Irene: "확인권장에서 리스트 답변필요 누르면 확인권장 숫자가 안바뀌고")
    //     mark-reply-needed 라우트가 status 를 'uncertain' 그대로 두는 것은 의도된 동작이고
    //     (답변필요 폴더 정의가 uncertain 을 포함해야 하므로), 고칠 곳은 여기 폴더 정의다.
    //     실측(dev, business 5): 스레드 하나를 답변필요로 표시 → 확인권장 2657→2657(안 빠짐),
    //     이 조건을 걸면 2657→2656(빠짐). 겹침 0→1 이 0 으로.
    //   ★ 2026-09-01 운영 #402 — **내가 답장한 메일은 확인 권장에서 뺀다.**
    //     (Irene: "답변필요에 들어온 메일에 답변을 했는데 확인권장에도 있어.
    //      답변필요와 확인권장에는 겹쳐서 리스팅되지 않아야 해. 전체메일에 다 나오면 되는거고.")
    //     위 ② 는 원래 "답변이 끝난 메일도 여기 담는다" 는 설계였는데, 실제로 써 보니
    //     답장하자마자 답변필요 → 확인권장으로 **자리만 옮겨 앉아** 목록이 비지 않았다.
    //     두 폴더의 공통 의미는 "내가 아직 뭔가 해야 하는 것" 이다. 내가 마지막에 답장했다면
    //     공은 상대에게 넘어갔으므로 둘 다 아니다 — 전체·보낸메일에서 계속 보인다.
    //
    //     ※ status 를 archived 로 내리지 않는 이유: services/mailFollowUp.js 의
    //       INACTIVE_STATUS 가 archived 를 제외해, 그러면 "답장했는데 답이 없다"(awaiting_reply)
    //       추적이 통째로 죽는다. 답장은 대화를 닫는 것이 아니라 공을 넘기는 것이다.
    //       (사용자가 명시적으로 누르는 "확인 완료" 만 archived 로 간다.)
    //     ※ NULL 안전 — last_message_direction 이 NULL 인 옛 스레드가 있다.
    //       SQL 에서 NULL != 'outbound' 는 NULL(=거짓)이라 그냥 Op.ne 만 쓰면 그것들이 통째로
    //       사라진다. 명시적으로 NULL 을 포함시킨다.
    //     ※ services/mailNotify.js classify() 는 **inbound 한 통**을 분류하는 자리라
    //       last_message_direction 이 정의상 'inbound' 다 — 이 조건과 어긋나지 않는다.
    case 'uncertain':
    case 'inbox':
      return {
        reply_needed: false,
        [Op.and]: [
          {
            [Op.or]: [
              { status: 'uncertain' },
              { status: 'open', triage: { [Op.notIn]: ['automated', 'marketing'] } },
            ],
          },
          {
            [Op.or]: [
              { last_message_direction: { [Op.ne]: 'outbound' } },
              { last_message_direction: null },
            ],
          },
        ],
      };
    case 'spam': return { status: 'spam' };
    case 'archived': return { status: 'archived' };
    // 자동·마케팅 — 광고·뉴스레터·기계 알림. 단, 내용이 업무라 확인 권장으로 올라간 건 제외
    //   (같은 메일이 두 폴더에 겹쳐 보이면 어느 쪽이 진짜인지 알 수 없다).
    case 'marketing': return { status: 'open', triage: { [Op.in]: ['automated', 'marketing'] } };
    // 전체 — **스팸만 뺀 모든 메일**. 이름 그대로 전부다.
    //
    //   ★ 2026-08-31 (Irene): "답변을 하면 보낸메일에만 저장이 되어버려. 왜 전체탭에 안나와?
    //     검색이 안되서 문제야."
    //   옛 정의는 archived 도 뺐다("처리 완료가 전체 탭을 오염시킨다"는 이유로). 그런데
    //   **검색이 폴더 안에서만 돈다**(routes/email_threads.js:110 이 folderWhere 를 깔고
    //   검색 조건을 AND 로 얹는다). 그래서 "전체" 에서 검색해도 처리한 메일은 안 나왔다.
    //   운영 실측 — 내가 보낸 메시지가 있는 스레드 13개 중 **12개가 archived**,
    //   전체 스레드 2,512개 중 전체 탭에 보이는 것은 1,248개(절반이 안 보였다).
    //   "다 어디 갔지" 를 없애려고 만든 안전망이 정작 절반을 감추고 있었다.
    //   정렬은 최신순이라 오래된 처리 메일은 자연히 아래로 내려간다 — 담는 것과 순서는 다른 문제다.
    case 'all': return { status: { [Op.ne]: 'spam' } };
    // 보낸메일 = **내가 보낸 메시지가 1건이라도 있는 스레드** (#262).
    //
    //   옛 정의(#186)는 `last_message_direction='outbound'` — 스레드의 *마지막* 방향이었다.
    //   그래서 상대가 답장하는 순간 내 보낸 메일이 보낸메일함에서 사라졌다. 운영 실측(2026-08-12):
    //   outbound 메시지 6건/5스레드인데 보낸메일함 **0건** — 3건은 답장으로 뒤집혔고 2건은 archived 였다.
    //
    //   ★ status 는 spam 만 제외한다. 보낸메일함은 "내가 무엇을 보냈나" 하는 **발신 기록 뷰**라
    //     수신함 처리 상태(archived = 처리 완료의 착지점)와 독립이어야 한다. 일반 메일 클라이언트도
    //     보낸편지함을 보관 여부와 무관하게 보여준다.
    //   ★ 그 결과 sent ⊄ all 이다 (all 은 archived 를 의도적으로 뺀 "다 어디 갔지" 안전망이라
    //     archived 를 되돌리면 처리 완료 메일이 전체 탭을 오염시킨다). 의도된 비포함이다.
    //   ★ 격리: 서브쿼리는 business_id 로 잠그고, 외곽 where 의 account_id IN (접근 가능 계정)
    //     조건이 그대로 살아 있다 (개인 메일 격리). 서브쿼리는 후보를 넓힐 뿐 그 필터를 우회 못 한다.
    case 'sent': {
      const bid = Number(businessId);
      if (!Number.isInteger(bid) || bid <= 0) return { id: null };   // fail-closed
      return {
        status: { [Op.ne]: 'spam' },
        id: {
          [Op.in]: sequelize.literal(
            `(SELECT DISTINCT em_sent.thread_id FROM email_messages em_sent
                WHERE em_sent.business_id = ${bid} AND em_sent.direction = 'outbound')`
          ),
        },
      };
    }
    default:
      return { status: { [Op.notIn]: ['spam', 'archived'] } };
  }
}
// 보낸메일함 정렬 — 내가 보낸 시각 기준 (#262). 상관 서브쿼리로 푼다(파생 컬럼 X):
//   outbound 쓰기 경로가 reply·compose·forward 3곳 + 향후 IMAP Sent 동기화까지 있어 컬럼은
//   조용히 어긋난다 (memory feedback_dual_column_authority_write_side).
//   인덱스 email_messages_thread_time(thread_id, sent_at) 이 받쳐 준다.
function sentOrder() {
  return [[sequelize.literal(
    `(SELECT MAX(em_ord.sent_at) FROM email_messages em_ord
        WHERE em_ord.thread_id = \`EmailThread\`.\`id\` AND em_ord.direction = 'outbound')`
  ), 'DESC']];
}

module.exports = { folderWhere, sentOrder, BULK_FOLDERS: new Set(['reply_needed', 'uncertain', 'all']) };
