// services/guestHistory.js — 고객 프로젝트 링크가 **어떤 주요 이슈를 볼 수 있는가** 한 술어.
//   docs/GUEST_PROJECT_VIEW_DECISIONS.md §I-2. 원천은 `project_history_entries` 하나이고,
//   **항목마다 사람이 «고객에게 보이기» 를 켠 것만** 나간다(기본 꺼짐).
//   로그인 고객 앱 화면이 생기면 같은 함수를 부른다 — 베끼면 한쪽만 넓어진다.

/** 응답에 싣는 키 — 작성자·적은 시각은 고객 정보가 아니다. */
const CLIENT_HISTORY_ATTRS = ['id', 'occurred_at', 'title', 'body'];

function clientVisibleHistoryWhere(project) {
  return {
    business_id: project.business_id,
    project_id: project.id,
    deleted_at: null,
    client_visible: true,
  };
}

module.exports = { clientVisibleHistoryWhere, CLIENT_HISTORY_ATTRS };
