// 상황판 «들어온 문의» 칸 줄 만들기 — 판정 한 곳 (순수 함수 · DB·네트워크 없음)
//
// Irene 2026-11-15: «해야할 일 중 내 컨펌이 필요하던 안하던 여기 서버 상황판으로 가져와서 리스트업 하는 거 연결해줘.»
// 설계 docs/FEEDBACK_AUTOREPLY_BOARD_DESIGN.md §2 (Fable DESIGN: READY). 부르는 곳 scripts/feedback-board.js.
//
// ★ 목록은 보여 주기만 한다 — 개발 대상은 여전히 진행대기(승인)뿐, 결정은 맨 위 질문으로만.
// ★ needsIrene = «다음 한 걸음이 플랫폼관리자 손(승인·보류·답·회신)에서만 나오는가». 방은 이 값을 고치지 못한다(--post 가 되돌린다).

const VERDICTS = ['이미 해결', '개발 필요', '결정 필요', '답장만 필요', '확인 중'];
const MAX_ITEMS = 100;
const APP = 'https://planq.kr';
const DAY = 24 * 3600 * 1000;

const STATUS_KO = { pending: '접수', reviewing: '검토중', queued: '진행대기(승인)', in_progress: '반영중', new: '새 문의' };

const ts = (v) => { const n = Date.parse(v || ''); return Number.isFinite(n) ? n : null; };
const mmdd = (v) => { const n = ts(v); if (n == null) return ''; const d = new Date(n); return `${String(d.getUTCMonth() + 1).padStart(2, '0')}-${String(d.getUTCDate()).padStart(2, '0')}`; };
const day = (v) => { const n = ts(v); return n == null ? '' : new Date(n).toISOString().slice(0, 10); };

/** 피드백·문의(feedback_items 최상위) 한 줄 — 표 §2-2 */
function fbRow(r, now) {
  const triage = r.triage_verdict || null;
  const st = r.status;
  const isInquiry = r.kind === 'inquiry';
  let verdict; let needsIrene; let next; let queueRef = '';
  if (st === 'pending' || st === 'reviewing') {
    if (triage === 'needs_fix') { verdict = '개발 필요'; needsIrene = true; next = '승인하면 대기열로 — 관리자 > 사용자 피드백'; }
    else if (triage === 'already_fixed') { verdict = '이미 해결'; needsIrene = true; next = '답하고 닫기 — 관리자 화면'; }
    else if (triage === 'needs_decision') { verdict = '결정 필요'; needsIrene = true; next = '결정 후 승인/보류'; }
    else if (triage === 'not_dev' || isInquiry) { verdict = '답장만 필요'; needsIrene = true; next = '답글 달기 — 관리자 화면'; }
    else {
      verdict = '확인 중';
      const young = ts(r.created_at) != null && now - ts(r.created_at) < DAY;
      needsIrene = !young;
      next = young ? 'AI 조사 기다림' : '조사 없이 승인 판단';
    }
  } else if (st === 'queued') {
    verdict = triage === 'already_fixed' ? '이미 해결' : '개발 필요';
    needsIrene = false; queueRef = `fb#${r.id}`; next = `대기열 fb#${r.id} 에서 진행`;
  } else if (st === 'in_progress') {
    verdict = '개발 필요'; needsIrene = false; next = '배포되면 닫힘';
  } else {
    return null; // 닫힌 상태(done·wontfix) — 조회가 거르지만 한 번 더
  }
  const answered = Number(r.answered) === 1 || r.answered === true;
  // 이미 답했는데 접수·검토중에 머문 줄 = 답하기는 끝났고 닫기만 남음(Fable 2026-11-15 «닫기 대기»).
  //   «조사 없이 승인 판단» 은 답이 없는 줄에만 쓴다. 닫는 손은 관리자 화면뿐 → needsIrene 예.
  let closeWait = false;
  if ((st === 'pending' || st === 'reviewing') && answered && !(Number(r.open_followups) > 0)) {
    closeWait = true; needsIrene = true; next = '답함 — 완료로 닫기 또는 승인 · 관리자 > 사용자 피드백';
    if (verdict === '답장만 필요') verdict = '이미 해결'; // 답장이 필요한 줄이었는데 답했다 — 남은 건 닫기
  }
  // 답 없는 후속 글 — 무엇이든 Irene 필요
  if (Number(r.open_followups) > 0) { needsIrene = true; next = `추가 글에 답 필요 · ${next}`; }

  const replied = answered ? `답함(${mmdd(r.responded_at)})`
    : (r.ack_sent_at ? `접수 확인 나감(${mmdd(r.ack_sent_at)})` : '아직');
  const basis = [STATUS_KO[st] || st,
    triage ? `AI 조사 ${triage}${r.triage_at ? `(${mmdd(r.triage_at)})` : ''}` : 'AI 조사 없음',
    Number(r.followups) > 0 ? `후속 글 ${r.followups}` : ''].filter(Boolean).join(' · ');
  return {
    ref: `fb#${r.id}`, kind: isInquiry ? 'inquiry' : 'feedback', at: day(r.created_at),
    who: `로그인 사용자${r.ws ? ` · ${String(r.ws).slice(0, 60)}` : ''}`,
    title: '', verdict, basis, replied, next, needsIrene,
    link: `${APP}/admin/feedback?id=${r.id}`, queueRef, draft: '',
    _orig: { title: String(r.title || ''), head: String(r.body || '').slice(0, 40) },
    _status: st, _closeWait: closeWait,
  };
}

/** 손님 문의(contact_inquiries, 랜딩) 한 줄 */
function landingRow(r) {
  // 회신함 = PlanQ 직접 회신 sent 가 있거나(contact_inquiry_replies) 옛 내부 노트 replied_at 이 있음.
  //   직접 회신은 replied_at 을 건드리지 않는다(org-feedback 규칙) — replied_at 만 보면 보낸 뒤에도 «회신 아직» 으로 남았다.
  const sentAt = r.last_reply_at || null;
  const repliedAt = sentAt || r.replied_at || null;
  const replied = Number(r.replies_sent) > 0 || !!r.replied_at;
  let verdict; let needsIrene; let next; let closeWait = false;
  if (!replied) { verdict = '답장만 필요'; needsIrene = true; next = '관리자 > 문의에서 메일로 회신'; }
  // 회신했으면 닫기만 남는다 — 닫는 손은 관리자뿐이라 Irene 필요(Fable 2026-11-15, 옛 «아니오 · 닫기만» 은 정의와 어긋났다).
  else { verdict = '이미 해결'; needsIrene = true; closeWait = true; next = '회신함 · 완료로 닫기 — 관리자 > 문의'; }
  return {
    ref: `landing#${r.id}`, kind: 'landing', at: day(r.created_at), who: '손님(랜딩)',
    title: '', verdict, basis: `${STATUS_KO[r.status] || r.status}${r.kind ? ` · ${r.kind}` : ''}`,
    replied: `자동 접수 메일 · ${replied ? `회신함${repliedAt ? `(${mmdd(repliedAt)})` : ''}` : '회신 아직'}`,
    // 화면은 탭(status) 목록에서만 상세를 찾는다 — 회신하면 대개 «처리중» 이라 status 를 같이 실어야 열린다(Fable 검증 B1, adminTodo 와 같은 모양)
    next, needsIrene, link: `${APP}/admin/inquiries?status=${encodeURIComponent(r.status || 'new')}&inquiry=${r.id}`, queueRef: '', draft: '',
    _orig: { title: '', head: String(r.body || '').slice(0, 40) },
    _status: r.status, _closeWait: closeWait,
  };
}

/** 조회 행들 → 줄 뼈대 (Irene 필요[답·판단 먼저 → 닫기 대기] → 그 밖, 각 묶음 안 최근 순, 100건) */
function buildItems(rows, { now = Date.now() } = {}) {
  const items = [];
  for (const r of rows || []) {
    if (!r || typeof r !== 'object') continue;
    const it = r.src === 'landing' ? landingRow(r) : r.src === 'fb' ? fbRow(r, now) : null;
    if (it) items.push(it);
  }
  const tier = (x) => (x.needsIrene ? (x._closeWait ? 1 : 0) : 2);
  items.sort((a, b) => (tier(a) - tier(b)) || String(b.at).localeCompare(String(a.at)));
  const total = items.length;
  return { items: items.slice(0, MAX_ITEMS), total };
}

const EMAIL_RE = /[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/;
const SECRET_RE = /(sk-[A-Za-z0-9_-]{16,}|AKIA[0-9A-Z]{16}|ghp_[A-Za-z0-9]{20,}|xox[abp]-[A-Za-z0-9-]{10,}|-----BEGIN [A-Z ]*PRIVATE KEY|eyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\.)/;
const norm = (s) => String(s || '').replace(/\s+/g, ' ').trim();

/**
 * 올리기 전 검사 — 방이 채운 뼈대(filled)와 기계가 만든 뼈대(base)를 비교.
 * needsIrene·ref·link·queueRef 는 기계 값으로 되돌린다(방이 못 고친다).
 * @returns {{ok:boolean, errors:string[], items:object[]}}
 */
function checkForPost(filled, base) {
  const errors = [];
  const byRef = new Map((base || []).map((b) => [b.ref, b]));
  const out = [];
  for (const x of filled || []) {
    const b = byRef.get(x && x.ref);
    if (!b) { errors.push(`${x && x.ref}: 뼈대에 없는 줄`); continue; }
    const title = norm(x.title);
    if (!title) errors.push(`${b.ref}: title 비어 있음`);
    const o = b._orig || {};
    const head = norm(o.head);
    const copied = title && ((o.title && title === norm(o.title))
      || (head.length >= 8 && (title.includes(head.slice(0, 15)) || (title.length >= 8 && head.startsWith(title)))));
    if (copied) {
      errors.push(`${b.ref}: title 이 고객 원문 그대로 — 우리 말로 요약`);
    }
    const verdict = String(x.verdict || '').trim();
    if (!VERDICTS.includes(verdict)) errors.push(`${b.ref}: 판단 낱말 «${verdict}» 는 5종 밖`);
    const it = {
      ref: b.ref, kind: b.kind, at: b.at, who: b.who, title, verdict,
      basis: norm(x.basis || b.basis), replied: b.replied, next: norm(x.next || b.next),
      needsIrene: b.needsIrene, link: b.link, queueRef: b.queueRef, draft: String(x.draft || '').trim(),
    };
    for (const [k, v] of Object.entries(it)) {
      if (typeof v !== 'string') continue;
      if (EMAIL_RE.test(v)) errors.push(`${b.ref}: ${k} 에 메일 주소 무늬`);
      if (SECRET_RE.test(v)) errors.push(`${b.ref}: ${k} 에 비밀값 무늬`);
    }
    out.push(it);
  }
  // 기계 순서(답·판단 → 닫기 대기 → 그 밖)를 지킨다 — 상황판은 needsIrene 만 정렬하고 같으면 올린 순서(Fable 검증 N3)
  const rank = new Map((base || []).map((b, i) => [b.ref, i]));
  out.sort((a, b) => rank.get(a.ref) - rank.get(b.ref));
  if ((filled || []).length !== (base || []).length) errors.push(`줄 수가 뼈대(${(base || []).length})와 다름(${(filled || []).length})`);
  return { ok: errors.length === 0, errors, items: out };
}

module.exports = { buildItems, checkForPost, VERDICTS, MAX_ITEMS, _internal: { fbRow, landingRow } };
