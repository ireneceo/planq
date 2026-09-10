// services/statsInsights.js — 서버가 만드는 **카드 문구의 단일 원천** (ko/en).
//   ① 통계 탭 인사이트 (`services/stats.js` → CATALOG)
//   ② Cue 능동 카드 (`services/insights.js` → CUE_CATALOG) — 대시보드/인박스 상단
//
// 왜 있는가
//   `services/stats.js` 가 카드 문구를 **한국어 문자열로 완성해서** 응답에 실었다.
//   프론트는 `{ins.title}` 을 그대로 그린다 → 영어 사용자에게 한국어가 그대로 보인다.
//   CLAUDE.md i18n 규칙 위반이면서, i18n 가드(`--category=i18n`)는 `dev-frontend/src` 만
//   walk 하므로 **영영 안 잡히는 사각지대**였다.
//
// 왜 프론트 t() 가 아닌가 — 소비처가 화면 하나가 아니다
//   ① 웹 카드(`pages/Insights/tabs/*`)  ② PDF 리포트(`services/pdfTemplates.js`)
//   ③ **이미 박제된 `reports.insights`·`reports.summary`**(생성 시점에 문자열로 저장된다).
//   ②③ 은 프론트 t() 가 닿지 못한다. `services/notifyTitle.js` 가 같은 이유로 같은 해법을
//   쓰고 있다(알림 제목은 push payload 로 박제된다) — **그 선례를 그대로 따른다**.
//
// 계약 (★ 어기면 반드시 갈라진다)
//   수집부(`stats.js`)는 `ins(code, params)` 로 **코드와 원시값만** 담는다. 문자열 금지.
//   응답부(`routes/stats.js` · `services/report_generator.js`)가 `localizeInsights(list, lang)`
//   를 **한 번** 부른다. 문자열은 이 파일에만 있다.
//
//   모르는 code 는 조용히 버리지 않고 `[code]` 로 **보이게** 렌더한다
//   (CLAUDE.md "상태값 규약 — 알 수 없는 값은 보이게").

function pickLang(lang) {
  const l = String(lang || '').split('-')[0].toLowerCase();
  return l === 'en' ? 'en' : 'ko';
}

// ── 값 포맷 태그 ────────────────────────────────────────────────
//   원시값을 그대로 담고 **해석 시점에** 언어별로 포맷한다.
//   (수집부에서 toLocaleString() 을 부르면 서버 로케일에 묶여 언어를 못 따라간다.
//    옛 코드가 통화를 '원' 으로 하드코딩해 USD 워크스페이스도 '원' 이 붙던 것도 같은 원인이다.)
const money = (v, currency) => ({ __fmt: 'money', v: Number(v) || 0, currency: currency || 'KRW' });
const num = (v, digits = 0) => ({ __fmt: 'num', v: Number(v) || 0, digits });
const hours = (v) => ({ __fmt: 'hours', v: Number(v) || 0 });
const text = (v) => ({ __fmt: 'text', v: String(v == null ? '' : v) });
// 지출 카테고리 코드 — 라벨 해석은 언어를 알아야 하므로 **해석 시점**으로 미룬다
const expenseCat = (v) => ({ __fmt: 'expenseCat', v: String(v == null ? '' : v) });
// 일시·일정목록 — 로케일과 **타임존**을 해석 시점에 받는다.
//   옛 코드는 'ko-KR' + 'Asia/Seoul' 을 박아 둬서 다른 지역 사용자에게 남의 시간이 보였다.
const dateOnly = (v) => ({ __fmt: 'dateOnly', v: String(v == null ? '' : v) });
const eventList = (items) => ({ __fmt: 'eventList', items: Array.isArray(items) ? items : [] });
// 상대방 이름 — 모를 때 **문장이 깨지지 않게** 총칭으로 떨어진다.
//   ko 는 이름 뒤에 '님' 을 붙이고(호칭), en 은 이름 그대로. 총칭은 'the client'.
//   ★ 이 빈칸 처리를 호출부에 맡기면 거기서 또 한국어를 만들게 된다.
const party = (v) => ({ __fmt: 'party', v: v == null ? '' : String(v) });

// 지출 카테고리 코드 → 라벨. OverheadItem.category ENUM 7종 + ProjectExpense 는 `project_` 접두.
//   목록/표도 같은 라벨을 써야 하므로 `expenseCategoryLabel()` 로 내보낸다 —
//   프론트가 별도 목록을 또 적어 두면 그 순간 갈라진다.
const EXPENSE_CATEGORIES = {
  payroll:   { ko: '인건비',   en: 'Payroll' },
  rent:      { ko: '임대료',   en: 'Rent' },
  saas:      { ko: '구독·SaaS', en: 'SaaS' },
  legal:     { ko: '법무·회계', en: 'Legal & accounting' },
  benefits:  { ko: '복리후생', en: 'Benefits' },
  marketing: { ko: '마케팅',   en: 'Marketing' },
  other:     { ko: '기타',     en: 'Other' },
};

function expenseCategoryLabel(code, lang) {
  const L = pickLang(lang);
  const raw = String(code || '');
  const isProject = raw.startsWith('project_');
  const key = isProject ? raw.slice('project_'.length) : raw;
  const base = EXPENSE_CATEGORIES[key]?.[L];
  if (!base) return raw;   // 자유 입력 카테고리는 사용자가 쓴 말 그대로 — 번역하지 않는다
  return isProject ? (L === 'en' ? `Project · ${base}` : `프로젝트 · ${base}`) : base;
}

// ── 문구 카탈로그 ───────────────────────────────────────────────
//   severity / action_link 는 문구가 아니라 **성격**이라 여기 같이 둔다
//   (수집부가 매번 다시 적으면 탭마다 색이 갈라진다).
const CATALOG = {
  // ── Tasks 탭 ────────────────────────────────────────────
  task_accuracy_spread: {
    // ★ 옛 링크는 '/insights?tab=people' 이었다 — 그 경로는 앱 화면이 아니라
    //   **공개 마케팅 블로그**(App.tsx: /insights → LandingBlog)다. 누르면 로그인 화면 밖으로
    //   튕겨 나갔다. 통계 탭의 실제 경로는 /stats/:tab 이고 'people' 탭은 없다(team).
    //   같은 계열: '/qbill' → '/bills' (아래 overview_overdue 주석).
    severity: 'warning', action_link: '/stats/team',
    ko: { title: '공수 정확도 편차 큼', value: '{{top}} {{topPct}}% · {{bottom}} {{bottomPct}}%',
          hint: '카테고리별 강점·약점 분석으로 배정 최적화', action_label: '팀 생산성 탭에서 보기' },
    en: { title: 'Wide estimate-accuracy gap', value: '{{top}} {{topPct}}% · {{bottom}} {{bottomPct}}%',
          hint: 'Review strengths per category to balance assignments', action_label: 'Open Team productivity' },
  },
  task_ai_accuracy_up: {
    severity: 'info',
    ko: { title: 'AI 추정 정확도 향상', value: 'MAPE {{from}}% → {{to}}%',
          hint: '신규 업무 견적 시 AI 추정값 신뢰도 ↑' },
    en: { title: 'AI estimates getting better', value: 'MAPE {{from}}% → {{to}}%',
          hint: 'AI estimates are more trustworthy for new tasks' },
  },
  task_from_chat: {
    severity: 'info', action_link: '/talk',
    ko: { title: '대화 추출 업무', value: '{{count}}건 자동 등록',
          hint: 'Q Talk 메시지에서 자동 추출된 업무', action_label: '대화 보기' },
    en: { title: 'Tasks extracted from chat', value: '{{count}} added automatically',
          hint: 'Extracted from Q Talk messages', action_label: 'Open Q Talk' },
  },
  task_collecting: {
    severity: 'info',
    ko: { title: '데이터 누적 중', value: '30일 이상 누적되면 인사이트가 더 정확해져요',
          hint: '업무를 5건 이상 등록·완료하시면 분석이 시작됩니다' },
    en: { title: 'Collecting data', value: 'Insights sharpen after about 30 days of history',
          hint: 'Analysis starts once 5 or more tasks are created and completed' },
  },

  // ── Overview 탭 ─────────────────────────────────────────
  overview_overdue: {
    severity: 'urgent', action_link: '/bills',   // SPA 라우트는 /bills — '/qbill' 은 존재하지 않는다
    ko: { title: '연체 청구', value: '{{amount}}', hint: '미수금 회수 우선', action_label: '청구서 보기' },
    en: { title: 'Overdue invoices', value: '{{amount}}', hint: 'Collect receivables first', action_label: 'Open invoices' },
  },
  overview_over_utilization: {
    severity: 'warning', action_link: '/stats/team',
    ko: { title: '가동률 초과', value: '{{pct}}%', hint: '초과 근무 누적 위험', action_label: '팀 보기' },
    en: { title: 'Utilization over capacity', value: '{{pct}}%', hint: 'Overtime is accumulating', action_label: 'Open team' },
  },
  overview_new_clients: {
    severity: 'info', action_link: '/business/clients',
    ko: { title: '신규 고객', value: '{{count}}건', hint: '관계 강화 시점', action_label: '고객 보기' },
    en: { title: 'New clients', value: '{{count}}', hint: 'Good moment to deepen the relationship', action_label: 'Open clients' },
  },
  overview_collecting: {
    severity: 'info',
    ko: { title: '데이터 누적 중', value: '30일 이상 누적 시 더 정확',
          hint: '청구서/업무를 등록하시면 분석이 시작됩니다' },
    en: { title: 'Collecting data', value: 'More accurate after about 30 days',
          hint: 'Analysis starts once invoices and tasks are recorded' },
  },

  // ── Profit 탭 ───────────────────────────────────────────
  profit_internal_investment: {
    severity: 'info',
    ko: { title: '내부 투자 시간', value: '{{hours}}',
          hint: '{{count}}개 내부 프로젝트 · 원가 {{cost}}' },
    en: { title: 'Internal investment', value: '{{hours}}',
          hint: '{{count}} internal projects · cost {{cost}}' },
  },
  profit_no_internal: {
    severity: 'info',
    ko: { title: '내부 프로젝트 없음', value: '자체 투자 업무를 내부 프로젝트로 표시',
          hint: '프로젝트 설정에서 "내부 프로젝트" 토글' },
    en: { title: 'No internal projects', value: 'Mark self-invested work as an internal project',
          hint: 'Toggle "Internal project" in project settings' },
  },
  profit_negative_margin: {
    severity: 'urgent', action_link: '/stats/profit',
    ko: { title: '마진 음수 프로젝트', value: '{{count}}건', hint: '즉시 검토 필요', action_label: '아래 표 확인' },
    en: { title: 'Projects with negative margin', value: '{{count}}', hint: 'Needs review now', action_label: 'See table below' },
  },
  profit_estimate_overrun: {
    severity: 'warning',
    ko: { title: '견적 초과', value: '{{name}} +{{ratio}}%', hint: '{{est}} → {{actual}}' },
    en: { title: 'Over estimate', value: '{{name}} +{{ratio}}%', hint: '{{est}} → {{actual}}' },
  },
  profit_per_hour_good: {
    severity: 'info',
    ko: { title: 'Profit per Hour 평균', value: '{{amount}}/h', hint: '목표 달성' },
    en: { title: 'Average profit per hour', value: '{{amount}}/h', hint: 'On target' },
  },
  profit_per_hour_low: {
    severity: 'info',
    ko: { title: 'Profit per Hour 평균', value: '{{amount}}/h', hint: '단가 인상 검토' },
    en: { title: 'Average profit per hour', value: '{{amount}}/h', hint: 'Consider raising rates' },
  },
  profit_labor_cost_incomplete: {
    severity: 'warning', action_link: '/business/members',
    ko: { title: '인건비가 불완전합니다', value: '{{hours}} 제외',
          hint: '단가가 입력되지 않은 멤버 {{count}}명의 시간이 인건비에서 빠졌습니다. 실제 이익은 이보다 낮습니다.',
          action_label: '단가 입력' },
    en: { title: 'Labor cost is incomplete', value: '{{hours}} excluded',
          hint: 'Hours from {{count}} members without an hourly rate are missing from labor cost. Real profit is lower than shown.',
          action_label: 'Set hourly rates' },
  },
  profit_collecting: {
    severity: 'info',
    ko: { title: '데이터 누적 중', value: '프로젝트 수금·비용 기록 후 표시', hint: '청구서·비용 입력하시면 분석 시작' },
    en: { title: 'Collecting data', value: 'Shown once payments and costs are recorded', hint: 'Analysis starts after invoices and expenses are entered' },
  },
  profit_no_projects: {
    severity: 'info',
    ko: { title: '프로젝트 없음', value: '신규 프로젝트 등록 후 분석 시작' },
    en: { title: 'No projects', value: 'Analysis starts once a project is created' },
  },

  // ── Team 탭 ─────────────────────────────────────────────
  team_top_revenue: {
    severity: 'info',
    ko: { title: '인당 매출 1위', value: '{{name}} {{amount}}', hint: '시간 비중 가중 분배' },
    en: { title: 'Top revenue per person', value: '{{name}} {{amount}}', hint: 'Weighted by share of hours' },
  },
  team_over_utilization: {
    severity: 'urgent',
    ko: { title: '가동률 초과 직원', value: '{{names}} ({{pct}}%)', hint: '초과근무 위험 — 업무 재배정 검토' },
    en: { title: 'Members over capacity', value: '{{names}} ({{pct}}%)', hint: 'Overtime risk — consider reassigning work' },
  },
  team_top_accuracy: {
    severity: 'info',
    ko: { title: '추정 정확도 1위', value: '{{name}} {{pct}}%', hint: 'Bias {{bias}}%' },
    en: { title: 'Most accurate estimates', value: '{{name}} {{pct}}%', hint: 'Bias {{bias}}%' },
  },
  team_collecting: {
    severity: 'info',
    ko: { title: '데이터 누적 중', value: '완료 업무가 쌓이면 직원 비교 분석' },
    en: { title: 'Collecting data', value: 'Member comparison starts once tasks are completed' },
  },

  // ── Finance 탭 ──────────────────────────────────────────
  finance_negative_margin: {
    severity: 'urgent',
    ko: { title: '마진 음수', value: '{{pct}}%', hint: '비용 > 매출 — 즉시 검토' },
    en: { title: 'Negative margin', value: '{{pct}}%', hint: 'Costs exceed revenue — review now' },
  },
  finance_low_margin: {
    severity: 'warning',
    ko: { title: '낮은 마진', value: '{{pct}}%', hint: '비용 절감 또는 단가 인상 검토' },
    en: { title: 'Low margin', value: '{{pct}}%', hint: 'Consider cutting costs or raising rates' },
  },
  finance_receivable: {
    severity: 'warning', action_link: '/bills',
    ko: { title: '미수금', value: '{{amount}}', hint: '{{count}}건 미결제', action_label: '청구서 보기' },
    en: { title: 'Receivables', value: '{{amount}}', hint: '{{count}} unpaid', action_label: 'Open invoices' },
  },
  finance_top_expense: {
    severity: 'info',
    ko: { title: '지출 1위', value: '{{category}} {{amount}}' },
    en: { title: 'Largest expense', value: '{{category}} {{amount}}' },
  },
  finance_collecting: {
    severity: 'info',
    ko: { title: '데이터 누적 중', value: '청구서·비용 등록 후 분석 시작' },
    en: { title: 'Collecting data', value: 'Analysis starts after invoices and expenses are entered' },
  },
};

/**
 * 수집부가 쓰는 생성자 — **문자열을 만들지 않는다.**
 *   ins('overview_overdue', { amount: money(123456, 'KRW') })
 */
function ins(code, params) {
  return { code, params: params || {} };
}

function fmtValue(p, L, tz) {
  if (p == null) return '';
  if (typeof p !== 'object' || !p.__fmt) return String(p);
  const locale = L === 'en' ? 'en-US' : 'ko-KR';
  switch (p.__fmt) {
    case 'money':
      try {
        return new Intl.NumberFormat(locale, {
          style: 'currency', currency: p.currency, maximumFractionDigits: 0,
        }).format(p.v);
      } catch {
        // 알 수 없는 통화 코드여도 숫자는 보여준다 (카드가 통째로 비는 것보다 낫다)
        return `${Math.round(p.v).toLocaleString(locale)} ${p.currency}`;
      }
    case 'num':
      return p.v.toLocaleString(locale, { minimumFractionDigits: p.digits, maximumFractionDigits: p.digits });
    case 'hours':
      return `${p.v.toLocaleString(locale)}h`;
    case 'expenseCat':
      return expenseCategoryLabel(p.v, L);
    case 'party':
      if (!p.v) return L === 'en' ? 'the client' : '고객';
      return L === 'en' ? p.v : `${p.v} 님`;
    case 'dateOnly':
      return String(p.v).slice(0, 10);
    case 'eventList':
      return p.items.map((e) => {
        let when = '';
        try {
          when = new Date(e.start_at).toLocaleString(locale, {
            timeZone: tz || 'Asia/Seoul', dateStyle: 'short', timeStyle: 'short',
          });
        } catch { when = String(e.start_at || ''); }
        return `· ${e.title}${when ? ` (${when})` : ''}`;
      }).join('\n');
    case 'text':
    default:
      return String(p.v);
  }
}

function interpolate(tpl, params, L, tz) {
  return String(tpl).replace(/\{\{(\w+)\}\}/g, (_, k) => fmtValue(params[k], L, tz));
}

/**
 * 응답 경계에서 **한 번** 부른다. 구조체 → 화면 문자열.
 * @param {Array} list  ins() 로 만든 항목들 (옛 형태의 문자열 항목도 그대로 통과시킨다)
 * @param {string} lang 수신자 언어 (User.language)
 */
function localizeInsights(list, lang) {
  const L = pickLang(lang);
  return (list || []).map((item) => {
    if (!item) return item;
    if (!item.code) return item;   // 이 파일을 거치지 않은 옛 항목 — 손대지 않는다
    const entry = CATALOG[item.code];
    if (!entry) {
      // 조용히 기본값으로 떨어뜨리지 않는다 — 화면에 코드가 보여야 고칠 수 있다
      console.warn('[statsInsights] unknown insight code:', item.code);
      return { code: item.code, severity: 'info', title: `[${item.code}]`, value: '' };
    }
    const s = entry[L] || entry.ko;
    const p = item.params || {};
    const out = {
      code: item.code,
      severity: entry.severity || 'info',
      title: interpolate(s.title, p, L),
      value: interpolate(s.value, p, L),
    };
    if (s.hint) out.hint = interpolate(s.hint, p, L);
    if (s.action_label) out.action_label = interpolate(s.action_label, p, L);
    if (entry.action_link) out.action_link = entry.action_link;
    return out;
  });
}

/**
 * 탭 응답 하나를 통째로 해석한다.
 *   - insights: 코드 → 문구
 *   - expenses_by_category: 코드에 라벨을 **덧붙인다**(`category` 는 그대로 둔다 —
 *     CSV·차트 키·기존 소비처가 코드를 쓰고 있다). 여태 화면에 `project_saas` 같은
 *     내부 코드가 그대로 그려지고 있었다.
 */
function localizeTab(data, lang) {
  if (!data || typeof data !== 'object') return data;
  let out = data;
  if (Array.isArray(data.insights)) {
    out = { ...out, insights: localizeInsights(data.insights, lang) };
  }
  if (Array.isArray(data.expenses_by_category)) {
    out = {
      ...out,
      expenses_by_category: data.expenses_by_category.map((r) => ({
        ...r, category_label: expenseCategoryLabel(r.category, lang),
      })),
    };
  }
  return out;
}

// ── Cue 능동 카드 카탈로그 (services/insights.js) ───────────────
//   모양이 다르다: { id, kind, severity, title, body, action: { label, link } }.
//   severity 가 값에 따라 달라지는 카드가 있어 항목이 override 할 수 있게 둔다.
const CUE_CATALOG = {
  cue_overdue_tasks: {
    severity: 'warning', link: '/tasks',
    ko: { title: '지연 업무 {{count}}건이 쌓여 있어요',
          body: '마감이 지난 미완료 업무 {{count}}건. Q Task 의 지연 뱃지 클릭으로 빠르게 갱신할 수 있어요.',
          label: 'Q Task 열기' },
    en: { title: '{{count}} overdue tasks are piling up',
          body: '{{count}} tasks are past due and still open. Use the overdue badge in Q Task to update them quickly.',
          label: 'Open Q Task' },
  },
  cue_upcoming_event_one: {
    severity: 'today', link: '/calendar',
    ko: { title: '다가오는 일정: {{name}}', body: '{{list}}', label: '캘린더 열기' },
    en: { title: 'Coming up: {{name}}', body: '{{list}}', label: 'Open calendar' },
  },
  cue_upcoming_events: {
    severity: 'today', link: '/calendar',
    ko: { title: '24시간 안에 일정 {{count}}건', body: '{{list}}', label: '캘린더 열기' },
    en: { title: '{{count}} events within 24 hours', body: '{{list}}', label: 'Open calendar' },
  },
  cue_pending_reviews: {
    severity: 'warning', link: '/inbox',
    ko: { title: '컨펌 대기 {{count}}건',
          body: '내가 컨펌해야 할 업무가 쌓이고 있어요. 인박스에서 빠르게 처리하세요.',
          label: '확인 필요 열기' },
    en: { title: '{{count}} approvals waiting on you',
          body: 'Tasks you need to approve are piling up. Clear them from your inbox.',
          label: 'Open inbox' },
  },
  cue_overdue_invoice_one: {
    severity: 'urgent', link: '/bills?tab=invoices',
    ko: { title: '미입금 청구서 1건 (미수금)',
          body: '{{who}}에게 청구한 {{amount}}이 결제 기한({{due}})을 지났는데 아직 입금되지 않았어요. 입금을 확인했다면 입금 처리하고, 아니면 결제 독촉을 보내세요. (워크스페이스 구독료가 아니라 고객에게 청구한 금액이에요.)',
          label: '미수금 관리' },
    en: { title: '1 unpaid invoice (receivable)',
          body: '{{amount}} billed to {{who}} passed its due date ({{due}}) and has not been paid. Mark it paid if the money arrived, otherwise send a reminder. (This is money you billed a client — not your workspace subscription.)',
          label: 'Manage receivables' },
  },
  cue_overdue_invoices: {
    severity: 'urgent', link: '/bills?tab=invoices',
    ko: { title: '미입금 청구서 {{count}}건 (미수금)',
          body: '고객에게 청구한 금액 중 결제 기한이 지난 미입금 청구서가 {{count}}건 있어요. 입금 확인 또는 결제 독촉이 필요해요. (워크스페이스 구독료와는 별개예요.)',
          label: '미수금 관리' },
    en: { title: '{{count}} unpaid invoices (receivables)',
          body: '{{count}} invoices you billed to clients are past due and unpaid. Confirm the payments or send reminders. (Separate from your workspace subscription.)',
          label: 'Manage receivables' },
  },
  cue_signature_expiring: {
    severity: 'urgent', link: '/docs?tab=received-signatures',
    ko: { title: '서명 만료 임박 {{count}}건',
          body: '24시간 안에 만료되는 서명 요청이 있어요. 즉시 서명하지 않으면 다시 보내달라고 요청해야 합니다.',
          label: '받은 서명 보기' },
    en: { title: '{{count}} signature requests expiring soon',
          body: 'Signature requests expire within 24 hours. Sign now, or you will have to ask for a new request.',
          label: 'View received signatures' },
  },
};

/**
 * Cue 카드 생성자 — 문자열을 만들지 않는다.
 *   cueCard('cue_overdue_tasks', { count: num(7) }, { id: 'overdue_tasks_7', severity: 'urgent' })
 */
function cueCard(code, params, extra) {
  return { code, params: params || {}, ...(extra || {}) };
}

/** Cue 카드 해석 — routes/insights.js 가 응답 직전에 한 번 부른다. */
function localizeCueCards(list, lang, tz) {
  const L = pickLang(lang);
  return (list || []).map((item) => {
    if (!item || !item.code) return item;
    const entry = CUE_CATALOG[item.code];
    if (!entry) {
      console.warn('[statsInsights] unknown cue card code:', item.code);
      return { id: item.id || item.code, kind: item.code, severity: 'info', title: `[${item.code}]`, body: '' };
    }
    const s = entry[L] || entry.ko;
    const p = item.params || {};
    return {
      id: item.id || item.code,
      kind: item.kind || item.code,
      severity: item.severity || entry.severity || 'info',
      title: interpolate(s.title, p, L, tz),
      body: interpolate(s.body, p, L, tz),
      action: entry.link ? { label: interpolate(s.label, p, L, tz), link: entry.link } : undefined,
    };
  });
}

module.exports = {
  ins, money, num, hours, text, expenseCat, dateOnly, eventList, party,
  cueCard, localizeCueCards, CUE_CATALOG,
  localizeInsights, localizeTab,
  expenseCategoryLabel, EXPENSE_CATEGORIES,
  CATALOG, pickLang,
};
