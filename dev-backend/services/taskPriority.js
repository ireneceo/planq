// 우선순위(priority_order) 재인덱스 — **쓰기 경로 단일 원천** (#250 ②청크, Fable 설계 게이트 2026-08-08)
//
// 왜 이 파일이 생겼나:
//   재인덱스가 프론트에 있었다. `QTaskPage.togglePriority` 가 낙관적 state 를 만들고
//   **task 마다 개별 PUT** 을 쐈다(비원자적 — 중간 실패 시 1,2,4,5 로 깨진다). 진입 시 갭 정리
//   effect 도 같은 방식이었다. 그래서:
//     ① 팝아웃(TaskPopoutView)은 번호를 **보기만** 할 수 있었다 — #250 "우선순위 관리도 여기서도 해야 해"
//     ② 두 화면이 tie-break 사슬을 **각자 사본**으로 갖고 갈라졌다(2026-07-28 실사고: 팝아웃 번호가 메인과 어긋남)
//     ③ 내 정본 집합에 들어온 **남의 업무**(pending 컨펌자·관여완료 분기)는 PATCH /time 이 403 을 내
//        프론트 재인덱스가 **조용히 부분 실패**하고 있었다
//
// ★ 동작 변경 고지(Fable 조건 10-ii): 서버측 reindex 는 위 ③의 행도 쓴다. 옛 동작(부분 실패)보다
//   철저해지는 방향이지만 "달라졌다" 는 사실 자체를 감추지 않는다.
//
// ★ 잔존 비대칭(Fable 조건 10-i): "완료 시 우선순위 해제" 는 메인 리스트의 완료 토글에만 있다.
//   팝아웃 퀵액션 `/complete`, workflow approve, progress=100 자동완료는 해제하지 않는다.
//   두 화면이 같은 DB 를 읽으므로 화면 간 번호 불일치는 안 생기지만, "어느 버튼으로 완료했느냐" 에 따라
//   번호 유지/해제가 갈린다. 백엔드 전이 착지점(taskTransition)까지 손대는 건 이 청크의 절단면 밖이라
//   **후속 결정 항목**으로 남긴다.
//
// ★ 후속안(Fable 조건 10-iii): `priority_order` 는 task **전역 컬럼**인데 정본 집합은 **사용자별**이다.
//   두 사용자 집합이 겹치면 서로 덮어쓴다(현행과 동일). 정석은 `task_user_priorities` 별도 테이블이지만
//   스키마·마이그레이션·양화면 이관이 얽혀 이 청크(쓰기 경로 단일화)와 섞으면 검증 불가 덩어리가 된다.
//
const { Op } = require('sequelize');
const { Task, Business } = require('../models');
const { myWeekWhere } = require('./weekTaskSet');
const { todayInTz, mondayOfDateStr, addDaysStr } = require('../utils/datetime');

const CLOSED = ['completed', 'canceled'];
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const MAX_RANGE_DAYS = 370;   // 임의 기간 상한 (Fable 조건 4)

/**
 * 정본 tie-break 사슬 — 프론트 두 비교자(QTaskPage.byPriorityChain, TaskPopoutView.prioMap)와
 * **문자 그대로 같아야 한다**. 하나라도 어긋나면 두 화면의 번호가 갈린다(실사고 이력).
 *
 *   priority(asc) → 완료 뒤로 → 마감(null last) → 제목(localeCompare) → id(맨 끝 절대 tie-break)
 *
 * ★ id 를 **앞에 두지 말 것.** 이 저장소가 "옛 실버그" 로 주석에 박제한 패턴이다 —
 *   id tie-break 을 위로 올리면 두 화면 번호가 갈릴 뿐 아니라 같은 팝아웃 안에서도
 *   행 순서와 칩 번호가 역전됐다(TaskPopoutView.tsx 주석 참조).
 *   맨 끝의 id 는 "완전히 동률일 때 순서를 결정론적으로 고정" 하는 용도뿐이다.
 */
function cmpNullLastStr(a, b) {
  if (!a && !b) return 0;
  if (!a) return 1;
  if (!b) return -1;
  return a < b ? -1 : a > b ? 1 : 0;
}

function byPriorityChain(a, b) {
  const p = (a.priority_order || 0) - (b.priority_order || 0);
  if (p !== 0) return p;
  const doneRank = (t) => (CLOSED.includes(t.status) ? 1 : 0);
  const d = doneRank(a) - doneRank(b);
  if (d !== 0) return d;
  const due = cmpNullLastStr(dueStr(a), dueStr(b));
  if (due !== 0) return due;
  const title = String(a.title || '').localeCompare(String(b.title || ''));
  if (title !== 0) return title;
  return a.id - b.id;   // ★ 맨 끝 절대 tie-break
}

// due_date 는 DATEONLY 라 드라이버에 따라 문자열/Date 가 섞여 온다 — 비교 전 'YYYY-MM-DD' 로 정규화.
function dueStr(t) {
  const v = t.due_date;
  if (!v) return null;
  if (typeof v === 'string') return v.slice(0, 10);
  return new Date(v).toISOString().slice(0, 10);
}

/** 기간 파라미터 검증 + 미전달 시 이번 주(월~일) 기본값. `/my-week` 과 같은 계산. */
async function resolvePeriod(businessId, from, to) {
  if (from === undefined && to === undefined) {
    const biz = await Business.findByPk(businessId, { attributes: ['timezone'] });
    const monday = mondayOfDateStr(todayInTz(biz?.timezone || 'Asia/Seoul'));
    return { from: monday, to: addDaysStr(monday, 6) };
  }
  if (!DATE_RE.test(String(from)) || !DATE_RE.test(String(to))) {
    return { error: 'from/to 는 YYYY-MM-DD 형식이어야 합니다' };
  }
  if (from > to) return { error: 'from 이 to 보다 늦습니다' };
  const days = Math.round((Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / 86400000) + 1;
  if (!(days > 0) || days > MAX_RANGE_DAYS) return { error: `기간은 최대 ${MAX_RANGE_DAYS}일입니다` };
  return { from, to };
}

/**
 * 정본 집합 — `services/weekTaskSet.js myWeekWhere()` **재사용**. 사본 금지(그 파일 헤더 원칙).
 * 프론트 `inWeekCanonical(t, true)` 와 미러다.
 */
async function loadCanonicalSet(uid, businessId, from, to, tx) {
  return Task.findAll({
    where: myWeekWhere(Number(uid), businessId, from, to),
    attributes: ['id', 'business_id', 'project_id', 'title', 'status', 'due_date', 'priority_order'],
    transaction: tx,
    lock: tx ? tx.LOCK.UPDATE : undefined,   // 동시 toggle 직렬화
  });
}

/**
 * 정본 집합 안에서 priority_order 가 있는 것들을 사슬 정렬 후 1..N 으로 재작성.
 * **멱등** — 이미 1..N 이면 UPDATE 0 건.
 * ★ UPDATE 는 id ASC 고정 순서 (두 사용자 집합이 겹칠 때의 데드락 차단 — Fable 조건 6).
 *
 * @returns {{ changed: Array<{id, priority_order, business_id, project_id}> }}
 */
async function reindexInTx(uid, businessId, from, to, tx) {
  const all = await loadCanonicalSet(uid, businessId, from, to, tx);
  const ranked = all.filter(t => t.priority_order != null).sort(byPriorityChain);
  const desired = new Map();
  ranked.forEach((t, i) => desired.set(t.id, i + 1));

  const changed = [];
  const targets = all
    .filter(t => desired.has(t.id) && t.priority_order !== desired.get(t.id))
    .sort((a, b) => a.id - b.id);   // ★ 고정 순서
  for (const t of targets) {
    await t.update({ priority_order: desired.get(t.id) }, { transaction: tx });
    changed.push(t);
  }
  return { all, ranked, changed };
}

/** 갭 정리 전용 — 프론트 진입 effect 를 대체한다. */
async function reindexPriorities(uid, businessId, from, to) {
  const tx = await Task.sequelize.transaction();
  try {
    const { all, changed } = await reindexInTx(uid, businessId, from, to, tx);
    await tx.commit();
    return { changed, priorities: serializeMap(all) };
  } catch (e) { await tx.rollback(); throw e; }
}

/**
 * 부여/해제 토글.
 *   부여 — **기존 집합을 먼저 1..N 으로 재인덱스한 뒤 신규 = N+1**.
 *     ★ "현재 개수+1" 은 갭이 있으면 틀린다: {1,2,9} 에서 count+1=4 를 주면 사슬 정렬 시
 *       신규(4)가 옛 9 **앞**에 서서 최종 3번이 된다 — 사용자가 "맨 끝에 추가" 를 기대한 것과 어긋난다.
 *       현행 프론트도 기존을 밀어 정리한 뒤 맨 끝에 붙인다. 동치를 유지한다.
 *   해제 — null 로 만든 뒤 나머지를 1..N 으로 재인덱스.
 */
async function togglePriority(uid, businessId, taskId, from, to) {
  const tx = await Task.sequelize.transaction();
  try {
    const all = await loadCanonicalSet(uid, businessId, from, to, tx);
    const target = all.find(t => t.id === Number(taskId));
    if (!target) { await tx.rollback(); return { error: 'not_in_week_set' }; }

    const assigning = target.priority_order == null;
    if (!assigning) {
      // 해제 먼저 — 그래야 아래 재인덱스가 이 행을 빼고 센다.
      await target.update({ priority_order: null }, { transaction: tx });
    }
    // 기존(해제 대상 제외) 을 1..N 으로 정리
    const { ranked, changed } = await reindexInTx(uid, businessId, from, to, tx);
    const touched = new Map(changed.map(t => [t.id, t]));
    if (assigning) {
      const next = ranked.filter(t => t.id !== target.id).length + 1;
      await target.update({ priority_order: next }, { transaction: tx });
    }
    touched.set(target.id, target);
    await tx.commit();

    const fresh = await loadCanonicalSet(uid, businessId, from, to, null);
    return {
      assigning,
      changed: [...touched.values()],
      priorities: serializeMap(fresh),
    };
  } catch (e) { await tx.rollback(); throw e; }
}

function serializeMap(tasks) {
  return tasks.map(t => ({ id: t.id, priority_order: t.priority_order }));
}

module.exports = {
  byPriorityChain,
  resolvePeriod,
  loadCanonicalSet,
  reindexPriorities,
  togglePriority,
  MAX_RANGE_DAYS,
};
