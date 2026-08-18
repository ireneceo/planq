// conversationLifecycle — 대화 보관/재개 **단일 원천** (운영 #240, Fable 판정 2026-08-18)
//
// 왜 이 파일이 생겼나 — 보관 상태가 **두 축으로 갈라져 있었다**:
//   · `status='archived'`      — 활성 목록(routes/conversations.js:54,93,306)이 거르는 축
//   · `archived_at IS NOT NULL` — 보관함 목록(:548)이 조회하는 축
//   프로젝트 완료 cascade(routes/projects.js)는 **status 만** 세팅하고 archived_at 은 안 건드렸다.
//   → 그 방들은 활성 목록에서도 빠지고 보관함에도 안 나온다. **어디서도 도달 불가**.
//   Irene 이 결정한 "읽기전용 보관(재개 가능)" 의 '재개 가능' 이 코드상 거짓이었다.
//   unarchive 라우트도 archived_at 만 되돌려 status 가 archived 로 잔류했다(세 번째 어긋남).
//
// → 보관/재개는 **두 축을 항상 함께** 움직인다. 그 규칙을 여기 한 곳에만 둔다.
//
// Fable 판정(#240 판단1) — 완료 대화의 글쓰기:
//   · **고객은 절대 차단하지 않는다.** 쓰면 그 순간 자동 재개되어 목록에 복귀한다.
//     ("카톡으로 일하는 고객이 하나도 불편하지 않게" 가 제품의 경계선 가치다)
//   · **직원에게만 읽기전용을 강제한다.** 라벨이 '보관' 인데 내부 잡담이 계속 쌓이면 아카이브가 무의미해진다.
//     재개는 명시 행동(다시 열기)이어야 한다.

/** 이 대화가 보관 상태인가 — 두 축 중 하나라도 서 있으면 보관으로 본다(어긋난 옛 데이터 포함). */
function isArchived(conv) {
  if (!conv) return false;
  return conv.status === 'archived' || !!conv.archived_at;
}

/**
 * 보관 — 두 축을 함께 세운다.
 * @param where  Conversation.update 의 where (프로젝트 cascade 는 여러 건을 한 번에 닫는다)
 */
function archivePatch(actorUserId) {
  return { status: 'archived', archived_at: new Date(), archived_by_user_id: actorUserId || null };
}

/** 재개 — 두 축을 함께 내린다. */
function unarchivePatch() {
  return { status: 'active', archived_at: null, archived_by_user_id: null };
}

/**
 * 보관된 대화에 메시지를 쓰려 할 때의 판정.
 *
 * @returns { action: 'proceed' }            보관 상태가 아님 — 평소대로
 *          { action: 'reactivate' }         고객 발화 — 자동 재개 후 진행
 *          { action: 'block', code, ... }   직원 — 409 로 막고 사유를 말한다
 */
function decideArchivedWrite(conv, { isClient }) {
  if (!isArchived(conv)) return { action: 'proceed' };
  if (isClient) return { action: 'reactivate' };
  return {
    action: 'block',
    code: 'conversation_archived',
    // 막을 때는 왜 막혔는지와 **어떻게 풀 수 있는지**를 같이 말한다.
    message: '완료된 프로젝트의 보관된 대화예요. 이어서 논의하려면 대화를 다시 열어 주세요.',
  };
}

module.exports = { isArchived, archivePatch, unarchivePatch, decideArchivedWrite };
