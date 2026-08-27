#!/usr/bin/env node
/**
 * App Store 심사용 데모 워크스페이스 시드
 *
 * 애플은 로그인 벽이 있는 앱에 대해 "심사관이 실제로 써볼 수 있는 계정" 을 요구한다.
 * 빈 워크스페이스를 주면 "기능 확인 불가" 로 리젝된다(docs/APPSTORE_SUBMISSION_PREP.md §5).
 *
 * 이 스크립트는 **전부 실 HTTP API 로** 계정·데이터를 만든다. 직접 INSERT 하지 않는다 —
 * 라우트의 훅·감사로그·broadcast 를 그대로 태워야 실제 사용과 같은 상태가 되기 때문이다.
 *
 * 데이터는 전부 가상이다. 실 고객사 이름·금액이 스크린샷에 남으면 그대로 공개된다(§4).
 * 고객 이메일은 example.com — 예약 TLD 라 발송 게이트가 skip 한다(실제 메일이 나가지 않는다).
 *
 * 사용:
 *   node scripts/seed-appstore-demo.js --base=http://localhost:3003 \
 *        --email=appreview@planq.kr --password='...' [--dry]
 *
 * 멱등: 같은 이메일이 이미 있으면 로그인해서 이어 만든다(중복 생성 안 함).
 */

const BASE = (process.argv.find((a) => a.startsWith('--base=')) || '--base=http://localhost:3003').split('=')[1];
const EMAIL = (process.argv.find((a) => a.startsWith('--email=')) || '--email=appreview@planq.kr').split('=')[1];
const PASSWORD = (process.argv.find((a) => a.startsWith('--password=')) || '').split('=')[1];
const ADMIN_EMAIL = (process.argv.find((a) => a.startsWith('--admin-email=')) || '=').split('=')[1];
const ADMIN_PASSWORD = (process.argv.find((a) => a.startsWith('--admin-password=')) || '=').split('=')[1];
const DRY = process.argv.includes('--dry');
const WS_NAME = 'PlanQ 데모';

if (!PASSWORD) {
  console.error('--password=... 필수');
  process.exit(1);
}

let token = null;
const log = (...a) => console.log(...a);

async function api(method, path, body, opts = {}) {
  const res = await fetch(`${BASE}${path}`, {
    method,
    headers: {
      'Content-Type': 'application/json',
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...(opts.headers || {}),
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  let json = null;
  try { json = await res.json(); } catch { /* 본문 없는 응답 */ }
  return { status: res.status, ok: res.ok, json };
}

// 날짜 헬퍼 — 심사 시점에 "지금 돌아가는 워크스페이스" 로 보이도록 상대 날짜로 만든다.
const d = (offsetDays) => {
  const t = new Date();
  t.setDate(t.getDate() + offsetDays);
  return t.toISOString().slice(0, 10);
};
const dt = (offsetDays, hour, min = 0) => {
  const t = new Date();
  t.setDate(t.getDate() + offsetDays);
  t.setHours(hour, min, 0, 0);
  return t.toISOString();
};

async function main() {
  log(`▶ 대상: ${BASE}`);
  log(`▶ 계정: ${EMAIL}`);
  if (DRY) { log('(dry run — 아무것도 만들지 않는다)'); }

  // ─────────────────────────────────────────────── 1. 계정 + 워크스페이스
  let bizId = null;
  let userId = null;

  const login = await api('POST', '/api/auth/login', { email: EMAIL, password: PASSWORD });
  if (login.ok) {
    token = login.json.data.token || login.json.data.access_token;
    userId = login.json.data.user.id;
    log('· 기존 계정으로 로그인');
  } else {
    if (DRY) { log('· (dry) 신규 가입 예정'); return; }
    const reg = await api('POST', '/api/auth/register', {
      email: EMAIL,
      password: PASSWORD,
      name: 'PlanQ Demo',
      workspace_name: WS_NAME,
      default_language: 'ko',
      terms_accepted: true,
      privacy_accepted: true,
    });
    if (!reg.ok) { console.error('가입 실패', reg.status, reg.json); process.exit(1); }
    token = reg.json.data.token || reg.json.data.access_token;
    userId = reg.json.data.user.id;
    log('· 신규 가입 완료');
  }

  const me = await api('GET', '/api/auth/me');
  const u = me.json?.data?.user || me.json?.data || {};
  const businesses = u.workspaces || [];
  bizId = (businesses.find((b) => (b.name || b.business_name) === WS_NAME) || businesses[0])?.id
    || (u.business_name === WS_NAME ? u.business_id : null) || u.business_id;
  if (!bizId) { console.error('워크스페이스를 찾지 못했다', me.json); process.exit(1); }
  log(`· 워크스페이스 id=${bizId}`);

  const created = { clients: [], projects: [], convs: [], tasks: [], events: [], posts: [], invoices: [] };

  // ─────────────────────────────────────────────── 2. 고객 (가상)
  const CLIENTS = [
    { name: '김도윤', email: 'doyun@example.com', company_name: '하나커피', notes: '원두 납품 · 매장 3곳' },
    { name: '박서연', email: 'seoyeon@example.com', company_name: '미래건설', notes: '홈페이지 리뉴얼 진행 중' },
    { name: '이준호', email: 'junho@example.com', company_name: '스튜디오온', notes: '영상 외주 파트너', kind: 'vendor' },
  ];
  for (const c of CLIENTS) {
    const r = await api('POST', `/api/clients/${bizId}/invite`, c);
    if (r.ok) { created.clients.push(r.json.data); log(`· 고객 생성: ${c.company_name}`); }
    else if (r.status === 409) log(`· 고객 이미 있음: ${c.company_name}`);
    else log(`  ! 고객 실패 ${c.company_name}`, r.status, r.json?.message);
  }
  const clientList = (await api('GET', `/api/clients/${bizId}`)).json?.data || [];
  const clientId = (name) => clientList.find((c) => c.company_name === name)?.id || null;

  // ─────────────────────────────────────────────── 3. 프로젝트
  const PROJECTS = [
    { name: '하나커피 브랜드 리뉴얼', description: '로고·패키지·매장 사이니지 전면 개편', client_company: '하나커피', start_date: d(-21), end_date: d(24), kind: 'client', color: '#F43F5E' },
    { name: '미래건설 홈페이지 구축', description: '기업 소개 · 시공 실적 · 문의 폼', client_company: '미래건설', start_date: d(-7), end_date: d(45), kind: 'client', color: '#0EA5E9' },
  ];
  const projList0 = (await api('GET', `/api/projects?business_id=${bizId}`)).json?.data || [];
  for (const p of PROJECTS) {
    if (projList0.some((x) => x.name === p.name)) { log(`· 프로젝트 이미 있음: ${p.name}`); continue; }
    const r = await api('POST', '/api/projects', { business_id: bizId, ...p });
    if (r.ok) { created.projects.push(r.json.data); log(`· 프로젝트 생성: ${p.name}`); }
    else log(`  ! 프로젝트 실패 ${p.name}`, r.status, r.json?.message);
  }
  const projList = (await api('GET', `/api/projects?business_id=${bizId}`)).json?.data || [];
  const projId = (name) => projList.find((p) => p.name === name)?.id || null;

  // ─────────────────────────────────────────────── 4. 대화 + 메시지
  const CONVS = [
    {
      title: '하나커피 — 리뉴얼 진행',
      project: '하나커피 브랜드 리뉴얼',
      client: '하나커피',
      messages: [
        '안녕하세요. 지난주 보내주신 로고 시안 3안 잘 받았습니다.',
        '2안 방향으로 가되 심볼을 조금만 더 단순하게 다듬어 주실 수 있을까요?',
        '네, 확인했습니다. 심볼 단순화 버전으로 금요일까지 정리해서 올리겠습니다.',
        '패키지 적용 목업도 같이 보여주시면 내부 공유가 편할 것 같아요.',
        '목업 2종(원두 250g · 드립백) 함께 준비하겠습니다.',
      ],
    },
    {
      title: '미래건설 — 홈페이지 구축',
      project: '미래건설 홈페이지 구축',
      client: '미래건설',
      messages: [
        '시공 실적 페이지에 들어갈 사진은 몇 장까지 가능한가요?',
        '프로젝트당 최대 12장까지 넣을 수 있게 잡아두었습니다.',
        '좋습니다. 그럼 대표 실적 6건 먼저 정리해서 전달드릴게요.',
        '받는 대로 페이지 초안 만들어서 공유하겠습니다.',
      ],
    },
    {
      title: '내부 — 이번 분기 정리',
      messages: [
        '이번 분기 마감 건 정리해두었습니다. 청구 누락 없는지 같이 봐주세요.',
        '확인했습니다. 하나커피 2차분만 아직 발행 전이네요.',
      ],
    },
  ];
  const convList0 = (await api('GET', `/api/conversations/${bizId}`)).json?.data || [];
  for (const c of CONVS) {
    let conv = convList0.find((x) => x.title === c.title);
    if (!conv) {
      const r = await api('POST', `/api/conversations/${bizId}`, {
        title: c.title,
        project_id: c.project ? projId(c.project) : null,
        client_id: c.client ? clientId(c.client) : null,
      });
      if (!r.ok) { log(`  ! 대화 실패 ${c.title}`, r.status, r.json?.message); continue; }
      conv = r.json.data;
      created.convs.push(conv);
      log(`· 대화 생성: ${c.title}`);
      for (const m of c.messages) {
        const mr = await api('POST', `/api/conversations/${bizId}/${conv.id}/messages`, { content: m });
        if (!mr.ok) log('  ! 메시지 실패', mr.status, mr.json?.message);
      }
    } else log(`· 대화 이미 있음: ${c.title}`);
  }

  // ─────────────────────────────────────────────── 5. 업무
  const TASKS = [
    { title: '로고 심볼 단순화 시안', project: '하나커피 브랜드 리뉴얼', due_date: d(2), status: 'in_progress', progress_percent: 60, estimated_hours: 8, category: '디자인' },
    { title: '패키지 목업 2종 (원두·드립백)', project: '하나커피 브랜드 리뉴얼', due_date: d(4), status: 'not_started', estimated_hours: 6, category: '디자인' },
    { title: '매장 사이니지 실측', project: '하나커피 브랜드 리뉴얼', due_date: d(-3), status: 'completed', progress_percent: 100, estimated_hours: 4, category: '현장' },
    { title: '시공 실적 페이지 초안', project: '미래건설 홈페이지 구축', due_date: d(6), status: 'not_started', estimated_hours: 10, category: '개발' },
    { title: '메인 비주얼 방향 정리', project: '미래건설 홈페이지 구축', due_date: d(1), status: 'in_progress', progress_percent: 35, estimated_hours: 5, category: '디자인' },
    { title: '문의 폼 스팸 필터 적용', project: '미래건설 홈페이지 구축', due_date: d(9), status: 'not_started', estimated_hours: 3, category: '개발' },
    { title: '3분기 미발행 청구 점검', due_date: d(0), status: 'in_progress', progress_percent: 50, estimated_hours: 2, category: '정산' },
    { title: '외주 계약서 갱신 검토', due_date: d(12), status: 'waiting', estimated_hours: 2, category: '계약' },
  ];
  const taskList0 = (await api('GET', `/api/tasks/by-business/${bizId}?limit=200`)).json?.data || [];
  for (const t of TASKS) {
    if (taskList0.some((x) => x.title === t.title)) { log(`· 업무 이미 있음: ${t.title}`); continue; }
    const r = await api('POST', '/api/tasks', {
      business_id: bizId,
      project_id: t.project ? projId(t.project) : null,
      title: t.title,
      description: t.description || null,
      assignee_id: userId,
      due_date: t.due_date,
    });
    if (!r.ok) { log(`  ! 업무 실패 ${t.title}`, r.status, r.json?.message); continue; }
    const id = r.json.data.id;
    created.tasks.push(id);
    const patch = {};
    if (t.status) patch.status = t.status;
    if (t.progress_percent !== undefined) patch.progress_percent = t.progress_percent;
    if (t.estimated_hours) patch.estimated_hours = t.estimated_hours;
    if (t.category) patch.category = t.category;
    if (Object.keys(patch).length) {
      const up = await api('PUT', `/api/tasks/by-business/${bizId}/${id}`, patch);
      if (!up.ok) log(`  ! 업무 상태 실패 ${t.title}`, up.status, up.json?.message);
    }
    log(`· 업무 생성: ${t.title}`);
  }

  // ─────────────────────────────────────────────── 6. 일정
  const EVENTS = [
    { title: '하나커피 시안 리뷰', start_at: dt(1, 10), end_at: dt(1, 11), location: '온라인', category: 'meeting' },
    { title: '미래건설 킥오프', start_at: dt(2, 14), end_at: dt(2, 15, 30), location: '고객사 회의실', category: 'meeting' },
    { title: '주간 업무 정리', start_at: dt(4, 17), end_at: dt(4, 18), category: 'internal' },
    { title: '패키지 인쇄 발주 마감', start_at: dt(5, 9), end_at: dt(5, 9, 30), category: 'deadline' },
  ];
  const evList0 = (await api('GET', `/api/calendar/by-business/${bizId}?start=${d(-30)}&end=${d(60)}`)).json?.data || [];
  for (const e of EVENTS) {
    if ((evList0 || []).some((x) => x.title === e.title)) { log(`· 일정 이미 있음: ${e.title}`); continue; }
    const r = await api('POST', `/api/calendar/by-business/${bizId}`, e);
    if (r.ok) { created.events.push(r.json.data); log(`· 일정 생성: ${e.title}`); }
    else log(`  ! 일정 실패 ${e.title}`, r.status, r.json?.message);
  }

  // ─────────────────────────────────────────────── 7. Q docs
  const para = (text) => ({ type: 'paragraph', content: [{ type: 'text', text }] });
  const POSTS = [
    {
      title: '하나커피 브랜드 리뉴얼 제안서',
      project: '하나커피 브랜드 리뉴얼',
      content_json: { type: 'doc', content: [
        para('1. 배경 — 매장 3곳으로 늘면서 로고·패키지·사이니지가 서로 다른 형태로 쓰이고 있습니다.'),
        para('2. 범위 — 로고 리디자인, 패키지 2종, 매장 사이니지 가이드.'),
        para('3. 일정 — 착수 후 6주. 시안 2주 · 확정 1주 · 적용물 3주.'),
        para('4. 금액 — 아래 청구 항목 참조.'),
      ] },
    },
    {
      title: '미래건설 킥오프 회의록',
      project: '미래건설 홈페이지 구축',
      content_json: { type: 'doc', content: [
        para('참석 — 미래건설 박서연 팀장, PlanQ 데모팀'),
        para('결정 — 시공 실적은 프로젝트당 사진 12장까지. 대표 실적 6건 우선 반영.'),
        para('다음 — 실적 자료 전달(고객) → 페이지 초안 공유(우리, 6일 내).'),
      ] },
    },
    {
      title: '외주 계약서 (스튜디오온)',
      content_json: { type: 'doc', content: [
        para('용역 범위 — 브랜드 필름 1편(60초) 기획·촬영·편집.'),
        para('기간 — 계약일로부터 8주.'),
        para('대금 — 착수 50% · 납품 50%. 세금계산서 발행.'),
      ] },
    },
  ];
  const postList0 = (await api('GET', `/api/posts?business_id=${bizId}&limit=200`)).json?.data || [];
  for (const p of POSTS) {
    if (postList0.some((x) => x.title === p.title)) { log(`· 문서 이미 있음: ${p.title}`); continue; }
    const r = await api('POST', '/api/posts', {
      business_id: bizId,
      project_id: p.project ? projId(p.project) : null,
      title: p.title,
      content_json: p.content_json,
      status: 'published',
    });
    if (r.ok) { created.posts.push(r.json.data); log(`· 문서 생성: ${p.title}`); }
    else log(`  ! 문서 실패 ${p.title}`, r.status, r.json?.message);
  }

  // ─────────────────────────────────────────────── 8. 청구서
  const INVOICES = [
    {
      title: '하나커피 브랜드 리뉴얼 1차', client: '하나커피', project: '하나커피 브랜드 리뉴얼',
      due_date: d(10), vat_rate: 0.1, receipt_type: 'tax_invoice',
      items: [
        { description: '로고 리디자인', quantity: 1, unit_price: 3000000 },
        { description: '패키지 디자인 2종', quantity: 2, unit_price: 900000 },
      ],
    },
    {
      title: '미래건설 홈페이지 착수금', client: '미래건설', project: '미래건설 홈페이지 구축',
      due_date: d(-5), vat_rate: 0.1, receipt_type: 'tax_invoice',
      items: [{ description: '홈페이지 구축 착수금 (50%)', quantity: 1, unit_price: 4500000 }],
    },
  ];
  const invList0 = (await api('GET', `/api/invoices/${bizId}?limit=200`)).json?.data || [];
  for (const inv of INVOICES) {
    if (invList0.some((x) => x.title === inv.title)) { log(`· 청구서 이미 있음: ${inv.title}`); continue; }
    const r = await api('POST', `/api/invoices/${bizId}`, {
      title: inv.title,
      client_id: clientId(inv.client),
      project_id: projId(inv.project),
      due_date: inv.due_date,
      vat_rate: inv.vat_rate,
      receipt_type: inv.receipt_type,
      items: inv.items,
    });
    if (r.ok) { created.invoices.push(r.json.data); log(`· 청구서 생성: ${inv.title}`); }
    else log(`  ! 청구서 실패 ${inv.title}`, r.status, r.json?.message);
  }

  // ─────────────────────────────────────────────── 9. 파일 (실 업로드)
  // 심사관이 Q File 을 열었을 때 빈 화면이면 "기능 확인 불가" 로 읽힌다.
  // 실제 multipart 업로드로 넣는다 — dedup·쿼터 집계 훅을 그대로 태우기 위해서다.
  const FILES = [
    { name: '하나커피_로고시안_v2.txt', project: '하나커피 브랜드 리뉴얼', body: '로고 시안 2안 — 심볼 단순화 방향 정리 메모.\n(데모용 텍스트 파일)' },
    { name: '미래건설_실적자료_목록.txt', project: '미래건설 홈페이지 구축', body: '대표 시공 실적 6건 목록 및 사진 매수.\n(데모용 텍스트 파일)' },
    { name: '외주계약_체크리스트.txt', body: '외주 계약 갱신 시 확인 항목.\n(데모용 텍스트 파일)' },
  ];
  const fileList0 = (await api('GET', `/api/files/${bizId}?limit=500`)).json?.data || [];
  for (const f of FILES) {
    if (fileList0.some((x) => x.file_name === f.name || x.original_name === f.name || x.name === f.name)) { log(`· 파일 이미 있음: ${f.name}`); continue; }
    const form = new FormData();
    form.append('file', new Blob([f.body], { type: 'text/plain' }), f.name);
    if (f.project && projId(f.project)) form.append('project_id', String(projId(f.project)));
    const res = await fetch(`${BASE}/api/files/${bizId}`, {
      method: 'POST', headers: { Authorization: `Bearer ${token}` }, body: form,
    });
    let j = null; try { j = await res.json(); } catch { /* 본문 없음 */ }
    if (res.ok) log(`· 파일 업로드: ${f.name}`);
    else log(`  ! 파일 실패 ${f.name}`, res.status, j?.message);
  }

  // ─────────────────────────────────────────────── 10. 결제 면제 (체험 만료 차단)
  // 신규 가입은 starter + trialing 14일이다. 심사가 그 뒤로 밀리면 심사관이 체험 만료 화면을
  // 만나고, 네이티브에서는 3.1.1 때문에 구매 표면이 아예 렌더되지 않아 막다른 길이 된다.
  // → platform_admin 이 billing_exempt(kind=internal, plan=pro) 를 걸어 잠금을 없앤다.
  //   API 로 건다 — 라우트가 감사로그 기록 + 플랜 캐시 무효화까지 하기 때문이다(직접 UPDATE 금지).
  if (ADMIN_EMAIL && ADMIN_PASSWORD) {
    const ownerToken = token;
    const al = await api('POST', '/api/auth/login', { email: ADMIN_EMAIL, password: ADMIN_PASSWORD });
    if (!al.ok) {
      log('  ! 관리자 로그인 실패 — 면제 미적용', al.status, al.json?.message);
    } else {
      token = al.json.data.token || al.json.data.access_token;
      const ex = await api('PUT', `/api/admin/businesses/${bizId}/billing-exempt`, {
        exempt: true, kind: 'internal', plan: 'pro',
        note: 'App Store 심사용 데모 워크스페이스',
      });
      if (ex.ok) log('· 결제 면제 적용 (internal · pro · 무기한)');
      else log('  ! 면제 실패', ex.status, ex.json?.message);
    }
    token = ownerToken;
  } else {
    log('· (면제 건너뜀 — --admin-email/--admin-password 미지정)');
  }

  // ─────────────────────────────────────────────── 결과
  log('\n── 결과 ─────────────────────────');
  log(`워크스페이스 : ${WS_NAME} (id=${bizId})`);
  log(`로그인       : ${EMAIL}`);
  const counts = await Promise.all([
    api('GET', `/api/clients/${bizId}`),
    api('GET', `/api/projects?business_id=${bizId}`),
    api('GET', `/api/conversations/${bizId}`),
    api('GET', `/api/tasks/by-business/${bizId}?limit=200`),
    api('GET', `/api/posts?business_id=${bizId}&limit=200`),
    api('GET', `/api/invoices/${bizId}?limit=200`),
    api('GET', `/api/calendar/by-business/${bizId}?start=${d(-30)}&end=${d(60)}`),
    api('GET', `/api/files/${bizId}?limit=500`),
  ]);
  const names = ['고객', '프로젝트', '대화', '업무', '문서', '청구서', '일정', '파일'];
  counts.forEach((c, i) => log(`${names[i].padEnd(6)} : ${(c.json?.data || []).length}건`));
  const plan = await api('GET', `/api/plan/${bizId}/status`);
  const pd = plan.json?.data || {};
  log(`플랜     : ${pd.plan?.code || '?'}${pd.exempt ? ' (면제)' : ` (체험 만료 ${String(pd.trial_ends_at || '').slice(0, 10)})`}`);
  log('\n── App Store Connect \"심사 정보\" 에 그대로 입력 ──');
  log(`  사용자 이름 : ${EMAIL}`);
  log('  암호        : (이 스크립트에 넘긴 --password 값)');
  log('  메모        : 로그인하면 데모 워크스페이스가 바로 열립니다. 모든 데이터는 가상입니다.');
  if (!pd.exempt) log('\n  ⚠ 결제 면제가 안 걸려 있다 — 체험이 만료되면 심사관이 잠긴 화면을 본다.');
}

main().catch((e) => { console.error(e); process.exit(1); });
