// services/cueMenus.js — LLM 에게 알려 주는 **메뉴 이름의 단일 원천**
//
// 왜 파일을 따로 뒀나 (2026-09-03 운영 신고):
//   Cue 가 "Q knowledge 메뉴에서 직접 확인하실 수 있어요" 라고 답했는데 **그런 메뉴가 없다.**
//   지식베이스는 예전에 Q knowledge → Q info 로 이름이 바뀌었고(경로 /knowledge → /info),
//   화면 i18n 은 고쳤지만 **LLM 에게 주는 텍스트만 옛 이름으로 남아 있었다.**
//   Irene: *"Q knowledge는 메뉴가 아예 없어. 이게 왜 나와?"*
//   LLM 은 우리가 준 이름을 그대로 믿는다 — 여기 적힌 것이 곧 사용자가 찾아갈 곳이다.
//
//   ★ 이름을 손으로 두 곳에 적으면 반드시 갈라진다. 실제로 이 파일을 만들면서 손으로 적은
//     첫 목록이 이미 **Q project 를 빠뜨렸다.** 그래서 목록은 여기 한 벌만 두고,
//     화면 라벨과 같은지는 사람이 아니라 가드가 본다:
//       node scripts/guard-invariants.js --category=menuname
//     (정본 = dev-frontend/src/config/navMenus.ts 의 features 메뉴 + locales/ko/layout.json 의 nav.*)
//
//   memory: feedback_new_behavior_makes_copy_lie · feedback_comment_lies_predicate_drifts

// navKey — locales/{ko,en}/layout.json 의 nav.<navKey>. 가드가 이 키로 라벨을 대조한다.
const CUE_MENUS = [
  { navKey: 'talk',     name: 'Q talk',     desc: '대화' },
  { navKey: 'qmail',    name: 'Q mail',     desc: '메일' },
  { navKey: 'task',     name: 'Q task',     desc: '할일' },
  { navKey: 'project',  name: 'Q project',  desc: '프로젝트' },
  { navKey: 'calendar', name: 'Q calendar', desc: '일정' },
  { navKey: 'note',     name: 'Q note',     desc: '음성·요약' },
  { navKey: 'docs',     name: 'Q docs',     desc: '문서·서명' },
  { navKey: 'qinfo',    name: 'Q info',     desc: '회사 자료·지식' },
  { navKey: 'file',     name: 'Q file',     desc: '파일' },
  { navKey: 'qbill',    name: 'Q bill',     desc: '청구' },
];

// Q 로 시작하지 않는 메뉴 — 이름이 자유로워 가드 대조 대상이 아니다(오탐 방지).
const EXTRA_MENUS = ['고객 관리', '대시보드'];

/** "Q talk (대화) · Q mail (메일) · …" — 설명까지 붙은 긴 형태 */
function menuListWithDesc() {
  return CUE_MENUS.map((m) => `${m.name} (${m.desc})`).join(' · ')
    + ' · ' + EXTRA_MENUS.join(' · ') + '.';
}

/** "Q talk · Q mail · … · 고객 관리 · 대시보드" — 이름만 나열한 짧은 형태 */
function menuListNames() {
  return CUE_MENUS.map((m) => m.name).join(' · ') + ' · ' + EXTRA_MENUS.join(' · ');
}

/** 프롬프트에 그대로 붙이는 규칙 블록 — 문구를 한 곳에서만 고치도록 */
function menuRuleBlock() {
  return `메뉴 이름은 **실제로 있는 것만** 댄다. 이 워크스페이스의 메뉴는 이게 전부다:
  ${menuListNames()}.
  여기 없는 이름을 지어내지 말 것 — 특히 "Q knowledge" 는 **없는 메뉴다**(지식베이스는 Q info).
  어느 메뉴인지 확실하지 않으면 메뉴 이름을 대지 말고, 무엇을 못 봤는지만 말한다.`;
}

/** navKey → 표시 이름. 문장 안에 메뉴 이름을 끼워 넣을 때 쓴다 (문자열 직접 타이핑 금지). */
const M = Object.fromEntries(CUE_MENUS.map((m) => [m.navKey, m.name]));

module.exports = { CUE_MENUS, EXTRA_MENUS, M, menuListWithDesc, menuListNames, menuRuleBlock };
