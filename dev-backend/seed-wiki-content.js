// Q위키 (Q Wiki) 초기 콘텐츠 시드 — 실제 PlanQ 사용법 (production 콘텐츠, mock 아님).
// 설계: docs/Q_WIKI_DESIGN.md §5. 멱등 — slug upsert. node seed-wiki-content.js
require('dotenv').config();
const { sequelize } = require('./config/database');
const HelpCategory = require('./models/HelpCategory');
const HelpArticle = require('./models/HelpArticle');
const { indexArticle } = require('./services/wikiSearch');

const t = (ko, en) => ({ ko, en });

// body 블록 헬퍼
const h = (ko, en) => ({ type: 'heading', text_ko: ko, text_en: en });
const p = (ko, en) => ({ type: 'text', text_ko: ko, text_en: en });
const s = (ko, en) => ({ type: 'step', text_ko: ko, text_en: en });
const note = (ko, en) => ({ type: 'callout', text_ko: ko, text_en: en });

const CATEGORIES = [
  { slug: 'getting-started', icon: 'rocket', sort: 1, title: t('시작하기', 'Getting Started'),
    summary: t('워크스페이스 만들기부터 팀·고객 초대까지 첫 걸음', 'From creating a workspace to inviting your team and clients') },
  { slug: 'qtalk', icon: 'chat', sort: 2, title: t('Q Talk (대화)', 'Q Talk (Chat)'),
    summary: t('고객·팀과 대화하고 대화에서 업무를 자동 추출', 'Chat with clients and teams, auto-extract tasks from conversations') },
  { slug: 'qtask', icon: 'check', sort: 3, title: t('Q Task (할일)', 'Q Task (Tasks)'),
    summary: t('업무 만들기·담당자 배정·확인 요청·진행 추적', 'Create tasks, assign owners, request confirmation, track progress') },
  { slug: 'qbill', icon: 'invoice', sort: 4, title: t('Q Bill (청구)', 'Q Bill (Billing)'),
    summary: t('청구서 발행·결제 확인·세금계산서·현금영수증', 'Issue invoices, confirm payments, tax invoices and cash receipts') },
  { slug: 'qnote', icon: 'mic', sort: 5, title: t('Q Note (음성·메모)', 'Q Note (Voice & Notes)'),
    summary: t('회의 녹음·실시간 받아쓰기·요약, 빠른 메모', 'Record meetings, live transcription, summaries, quick notes') },
  { slug: 'qdocs', icon: 'doc', sort: 6, title: t('Q docs (문서)', 'Q docs (Documents)'),
    summary: t('견적·계약·제안서 작성과 외부 서명 받기', 'Create quotes, contracts, proposals and collect external signatures') },
  { slug: 'qfile', icon: 'folder', sort: 7, title: t('파일·자료', 'Files & Knowledge'),
    summary: t('파일 보관·공유, 대화 자료(지식) 관리', 'Store and share files, manage conversation knowledge') },
  { slug: 'settings', icon: 'gear', sort: 8, title: t('설정·권한', 'Settings & Permissions'),
    summary: t('워크스페이스·멤버 권한·개인 연동 설정', 'Workspace, member permissions and personal integrations') },
];

// article 정의 — visibility: 'public' 은 게스트/랜딩 노출, 'authenticated' 는 로그인 사용자만.
const ARTICLES = [
  // ── 시작하기 ──
  { cat: 'getting-started', slug: 'create-workspace', visibility: 'public', linked_route: null, est: 2,
    title: t('워크스페이스 만들기', 'Create a workspace'),
    summary: t('PlanQ 가입 후 첫 워크스페이스를 만드는 방법', 'How to create your first workspace after signing up for PlanQ'),
    body: [
      p('워크스페이스는 회사·팀의 업무 공간입니다. 고객, 대화, 업무, 청구가 모두 한 워크스페이스 안에서 관리됩니다.',
        'A workspace is the hub for your company or team. Clients, chats, tasks, and billing all live inside one workspace.'),
      s('가입 후 워크스페이스 이름(회사명)을 입력합니다.', 'After signing up, enter your workspace name (company name).'),
      s('업종·기본 정보를 입력하면 첫 화면으로 이동합니다.', 'Fill in your industry and basic info to land on the home screen.'),
      note('한 계정으로 여러 워크스페이스에 참여할 수 있고, 좌측 상단에서 전환합니다.',
        'One account can belong to multiple workspaces — switch between them from the top-left selector.'),
    ] },
  { cat: 'getting-started', slug: 'invite-team', visibility: 'authenticated', linked_route: '/business/members', est: 2,
    title: t('팀 멤버 초대하기', 'Invite team members'),
    summary: t('직원을 워크스페이스에 초대하고 권한을 부여', 'Invite staff to your workspace and grant permissions'),
    body: [
      s('설정 > 멤버에서 "멤버 초대"를 누릅니다.', 'Go to Settings > Members and click "Invite member".'),
      s('이메일을 입력하면 초대 메일이 발송됩니다.', 'Enter their email and an invitation is sent.'),
      s('멤버별로 메뉴 권한(읽기/쓰기)을 조정할 수 있습니다.', 'You can adjust each member’s menu permissions (read/write).'),
      note('관리자(admin) 역할은 청구를 제외한 대부분의 메뉴에 자동 접근됩니다.',
        'The admin role automatically gets access to most menus except owner-only billing actions.'),
    ] },
  { cat: 'getting-started', slug: 'invite-client', visibility: 'authenticated', linked_route: '/clients', est: 2,
    title: t('고객 초대하기', 'Invite a client'),
    summary: t('고객을 초대해 대화·문서·청구를 공유', 'Invite clients to share chats, documents, and billing'),
    body: [
      p('고객은 이메일·이름만으로 즉시 초대됩니다. 가입 전에도 청구서·문서를 공유할 수 있습니다.',
        'Clients are invited with just an email and name. You can share invoices and documents even before they sign up.'),
      s('고객 메뉴에서 "고객 초대"를 눌러 이름과 이메일을 입력합니다.', 'In Clients, click "Invite client" and enter their name and email.'),
      s('고객은 웹 링크 클릭만으로 즉시 접속합니다.', 'Clients join instantly by clicking the web link.'),
    ] },

  // ── Q Talk ──
  { cat: 'qtalk', slug: 'start-conversation', visibility: 'authenticated', linked_route: '/qtalk', est: 2,
    title: t('대화 시작하기', 'Start a conversation'),
    summary: t('고객·팀과 새 대화방을 열고 메시지를 주고받기', 'Open a new chat with clients or team and exchange messages'),
    body: [
      s('Q Talk 좌측에서 대화 상대(고객·팀)를 선택하거나 새 대화를 만듭니다.', 'In Q Talk, pick a client/team on the left or create a new chat.'),
      s('메시지를 입력하면 실시간으로 전달됩니다. 파일도 함께 보낼 수 있습니다.', 'Type a message to send in real time — you can attach files too.'),
      note('메시지는 수정(수정됨 표시)·삭제(삭제된 메시지로 마스킹)가 가능합니다.',
        'Messages can be edited (marked “edited”) or deleted (masked as “deleted message”).'),
    ] },
  { cat: 'qtalk', slug: 'auto-task-extract', visibility: 'authenticated', linked_route: '/qtalk', est: 3,
    title: t('대화에서 업무 자동 추출', 'Auto-extract tasks from chat'),
    summary: t('대화 내용에서 해야 할 일을 업무 후보로 자동 정리', 'Turn conversation content into suggested task candidates'),
    body: [
      p('대화에서 합의된 할 일을 PlanQ 가 업무 후보로 정리해 줍니다. 확인 후 실제 업무로 등록합니다.',
        'PlanQ collects agreed action items from a chat as task candidates. Review and register them as real tasks.'),
      s('대화 우측 패널에서 업무 후보 카드를 확인합니다.', 'Check the task candidate cards in the right panel of the chat.'),
      s('필요한 후보를 선택해 담당자·마감을 정하고 업무로 등록합니다.', 'Pick the candidates you want, set owner/due date, and create tasks.'),
    ] },
  { cat: 'qtalk', slug: 'translation', visibility: 'authenticated', linked_route: '/qtalk', est: 2,
    title: t('메시지 번역', 'Message translation'),
    summary: t('한국어·영어 메시지를 자동 번역해서 보기', 'Auto-translate messages between Korean and English'),
    body: [
      p('상대가 다른 언어로 보내면 번역을 켜서 내 언어로 볼 수 있습니다.',
        'When the other side writes in another language, enable translation to read it in yours.'),
      s('메시지의 번역 아이콘을 누르면 번역문이 함께 표시됩니다.', 'Tap the translate icon on a message to show its translation.'),
    ] },

  // ── Q Task ──
  { cat: 'qtask', slug: 'create-task', visibility: 'authenticated', linked_route: '/qtask', est: 3,
    title: t('업무 만들고 담당자 정하기', 'Create a task and assign an owner'),
    summary: t('업무를 만들고 담당자·마감·예상시간을 설정', 'Create a task and set owner, due date, and estimated time'),
    body: [
      s('Q Task 에서 "업무 추가"를 눌러 업무명을 입력합니다.', 'In Q Task, click "Add task" and enter a task name.'),
      p('업무명은 결과물이 분명한 형태로 쓰면 좋습니다. 예: "시장조사" 대신 "경쟁사 비교분석표 작성".',
        'Name tasks by their deliverable. e.g. instead of “market research”, write “Create competitor comparison sheet”.'),
      s('담당자와 마감일을 지정합니다. 예상 시간·진행률은 담당자가 입력합니다.', 'Assign an owner and due date. Estimated time and progress are entered by the owner.'),
      note('마감이 지나면 빨간 뱃지로 표시되고, 마감 연장은 담당자 이상만 가능합니다.',
        'Overdue tasks show a red badge; only the owner or above can extend a due date.'),
    ] },
  { cat: 'qtask', slug: 'confirm-review', visibility: 'authenticated', linked_route: '/qtask', est: 3,
    title: t('확인 요청(컨펌) 워크플로우', 'Confirmation (review) workflow'),
    summary: t('결과물을 확인자에게 보내 승인·반려 받기', 'Send your deliverable to reviewers for approval or revision'),
    body: [
      p('업무에 확인자(리뷰어)를 지정하면 "확인 요청 보내기"로 검토를 요청할 수 있습니다.',
        'Assign reviewers to a task, then use “Send for review” to request a check.'),
      s('담당자가 결과물을 작성하고 확인 요청을 보냅니다.', 'The owner writes the deliverable and sends it for review.'),
      s('확인자는 승인하거나 수정 요청(반려)합니다. 모두 승인되면 자동 완료됩니다.', 'Reviewers approve or request changes. Once all approve, the task auto-completes.'),
      note('확인자가 없으면 검토 상태로 보낼 수 없습니다 — 먼저 확인자를 지정하세요.',
        'You can’t move to review without reviewers — assign one first.'),
    ] },
  { cat: 'qtask', slug: 'focus-weekly', visibility: 'authenticated', linked_route: '/qtask', est: 2,
    title: t('포커스와 주간 업무 진척', 'Focus and weekly progress'),
    summary: t('업무에 집중한 실제 시간을 측정하고 주간 그래프로 확인', 'Measure real focus time and review it on the weekly graph'),
    body: [
      p('업무를 진행 중으로 두면 집중한 시간이 자동으로 누적되어 실제 소요 시간에 반영됩니다.',
        'While a task is in progress, focus time accrues automatically and feeds into actual hours.'),
      s('주간 업무 진척 그래프에서 예측·실측 시간을 비교합니다.', 'Compare estimated vs. actual time on the weekly progress graph.'),
    ] },

  // ── Q Bill ──
  { cat: 'qbill', slug: 'issue-invoice', visibility: 'authenticated', linked_route: '/qbill', est: 3,
    title: t('청구서 발행하기', 'Issue an invoice'),
    summary: t('고객에게 청구서를 만들고 발행', 'Create and send an invoice to a client'),
    body: [
      s('Q Bill 에서 "청구서 작성"을 눌러 고객과 항목을 입력합니다.', 'In Q Bill, click "New invoice" and enter the client and line items.'),
      s('통화·마감일은 워크스페이스 청구 설정에서 자동 채워집니다.', 'Currency and due date prefill from your workspace billing settings.'),
      s('내용을 확인하고 발행하면 고객에게 결제 안내가 전달됩니다.', 'Review and issue — the client receives payment instructions.'),
      note('발행·결제 마킹·세금계산서 등 재무 작업은 소유자(owner)만 가능합니다.',
        'Financial actions like issuing, marking paid, and tax invoices are owner-only.'),
    ] },
  { cat: 'qbill', slug: 'confirm-payment', visibility: 'authenticated', linked_route: '/qbill', est: 2,
    title: t('결제 확인(입금 마킹)', 'Confirm payment (mark as paid)'),
    summary: t('계좌이체 입금을 확인하고 결제 완료로 표시', 'Confirm a bank transfer and mark the invoice as paid'),
    body: [
      p('계좌이체는 입금을 확인한 뒤 직접 결제 완료로 표시합니다.',
        'For bank transfers, mark the invoice as paid after you confirm the deposit.'),
      s('청구서를 열어 "결제 완료로 표시"를 누릅니다.', 'Open the invoice and click "Mark as paid".'),
      note('결제가 확인되어야 세금계산서·현금영수증 발행 큐가 열립니다.',
        'The tax-invoice / cash-receipt queue opens only after payment is confirmed.'),
    ] },
  { cat: 'qbill', slug: 'tax-cash-receipt', visibility: 'authenticated', linked_route: '/qbill', est: 3,
    title: t('세금계산서·현금영수증', 'Tax invoices & cash receipts'),
    summary: t('발행 큐에서 증빙을 챙기고 발행을 마킹', 'Track receipts in the queue and mark them issued'),
    body: [
      p('결제가 확인된 건은 증빙 발행 큐에 모입니다. 세금계산서는 익월 10일, 현금영수증은 결제 후 7일이 법정 기한입니다.',
        'Paid items collect in the receipt queue. Tax invoices are due by the 10th of next month; cash receipts within 7 days of payment.'),
      s('대시보드 인박스 또는 Q Bill 증빙 큐에서 발행 대상을 확인합니다.', 'Check items in the dashboard inbox or the Q Bill receipt queue.'),
      s('외부에서 발행한 뒤 PlanQ 에 발행 완료로 마킹합니다.', 'Issue externally, then mark it as issued in PlanQ.'),
      note('PlanQ 는 홈택스/팝빌 자동 발행을 하지 않습니다 — 발행 추적·기한 관리 도구입니다.',
        'PlanQ does not auto-file with Hometax/Popbill — it tracks issuance and deadlines.'),
    ] },

  // ── Q Note ──
  { cat: 'qnote', slug: 'record-meeting', visibility: 'authenticated', linked_route: '/qnote', est: 3,
    title: t('회의 녹음과 요약', 'Record and summarize a meeting'),
    summary: t('회의를 녹음하며 실시간 받아쓰기와 요약을 받기', 'Record a meeting with live transcription and a summary'),
    body: [
      s('Q Note 에서 회의를 시작하고 목적·참여자를 입력합니다.', 'Start a meeting in Q Note and enter its purpose and participants.'),
      s('녹음 중 실시간으로 받아쓰기가 진행되고, 종료 후 요약이 생성됩니다.', 'Transcription runs live during recording; a summary is generated when you stop.'),
      note('Q Note 는 기본적으로 개인 공간입니다 — 명시적으로 공유하기 전까지 다른 사람이 볼 수 없습니다.',
        'Q Note is private by default — no one else sees it until you explicitly share.'),
    ] },
  { cat: 'qnote', slug: 'quick-memo', visibility: 'authenticated', linked_route: '/qnote', est: 2,
    title: t('빠른 메모', 'Quick notes'),
    summary: t('회의가 아니어도 텍스트·음성 메모를 빠르게 남기기', 'Capture text or voice notes quickly, even outside meetings'),
    body: [
      p('회의 외에도 떠오른 생각을 텍스트나 음성으로 즉시 기록하고, 필요하면 요약·업무로 연결합니다.',
        'Capture thoughts as text or voice anytime, then turn them into summaries or tasks if needed.'),
    ] },

  // ── Q docs ──
  { cat: 'qdocs', slug: 'create-document', visibility: 'authenticated', linked_route: '/qdocs', est: 3,
    title: t('견적·계약·제안서 작성', 'Create quotes, contracts, proposals'),
    summary: t('템플릿으로 문서를 빠르게 작성', 'Create documents quickly from templates'),
    body: [
      s('Q docs 에서 문서 유형(견적·계약·제안서)을 선택합니다.', 'In Q docs, choose a document type (quote, contract, proposal).'),
      s('내용을 작성하고 고객·프로젝트에 연결합니다.', 'Write the content and link it to a client or project.'),
    ] },
  { cat: 'qdocs', slug: 'collect-signature', visibility: 'authenticated', linked_route: '/qdocs', est: 3,
    title: t('서명 받기', 'Collect a signature'),
    summary: t('문서에 외부 고객의 서명을 OTP 인증으로 받기', 'Collect external signatures with OTP verification'),
    body: [
      s('문서에서 "서명 요청"을 눌러 고객 이메일을 입력합니다.', 'Click "Request signature" on a document and enter the client email.'),
      s('고객은 받은 링크에서 OTP 인증 후 서명합니다.', 'The client verifies via OTP from the link and signs.'),
      note('받은 서명은 인박스에서 모아 볼 수 있고, 모든 단계가 감사 로그로 남습니다.',
        'Received signatures collect in the inbox, and every step is recorded in the audit log.'),
    ] },

  // ── 파일·자료 ──
  { cat: 'qfile', slug: 'upload-share-file', visibility: 'authenticated', linked_route: '/qfile', est: 2,
    title: t('파일 올리고 공유하기', 'Upload and share files'),
    summary: t('파일을 보관하고 링크로 공유', 'Store files and share them via link'),
    body: [
      s('Q File 에서 파일을 끌어다 놓거나 업로드합니다.', 'Drag and drop or upload files in Q File.'),
      s('공유가 필요하면 공유 링크를 만들어 전달합니다.', 'Create a share link when you need to send a file.'),
      note('같은 파일을 다시 올리면 자동으로 중복 제거되어 저장 공간을 절약합니다.',
        'Re-uploading the same file is automatically de-duplicated to save storage.'),
    ] },
  { cat: 'qfile', slug: 'knowledge-base', visibility: 'authenticated', linked_route: '/knowledge', est: 3,
    title: t('대화 자료(지식) 관리', 'Manage conversation knowledge'),
    summary: t('자주 쓰는 자료를 등록해 Cue 답변의 근거로 활용', 'Register reference material so Cue can ground its answers'),
    body: [
      p('정책·FAQ·소개 같은 자료를 등록해 두면 Cue 가 답변할 때 근거로 사용합니다.',
        'Register material like policies, FAQs, and intros so Cue uses them as grounding when answering.'),
    ] },

  // ── 설정·권한 ──
  { cat: 'settings', slug: 'member-permissions', visibility: 'authenticated', linked_route: '/business/members', est: 3,
    title: t('멤버 메뉴 권한', 'Member menu permissions'),
    summary: t('멤버별로 메뉴 접근(없음/읽기/쓰기)을 조정', 'Adjust each member’s menu access (none/read/write)'),
    body: [
      p('멤버마다 메뉴별 권한을 없음·읽기·쓰기로 지정할 수 있습니다. 기본값은 열린 문화에 맞춰 쓰기입니다.',
        'Set per-menu access to none, read, or write for each member. The default is write, reflecting an open culture.'),
      s('설정 > 멤버에서 멤버를 선택해 메뉴 권한을 조정합니다.', 'In Settings > Members, select a member to adjust menu permissions.'),
    ] },
  { cat: 'settings', slug: 'personal-integrations', visibility: 'authenticated', linked_route: '/settings/integrations', est: 2,
    title: t('개인 연동 설정', 'Personal integrations'),
    summary: t('구글 캘린더·드라이브 등 개인 외부 연동 연결', 'Connect personal integrations like Google Calendar and Drive'),
    body: [
      p('개인 설정에서 구글 캘린더·드라이브 등을 연결해 일정·파일을 연동합니다.',
        'Connect Google Calendar, Drive, and more from personal settings to sync events and files.'),
    ] },
];

async function run() {
  await sequelize.authenticate();
  console.log('Connected. Seeding Q위키 콘텐츠...');

  const catBySlug = {};
  for (const c of CATEGORIES) {
    const [row] = await HelpCategory.findOrCreate({
      where: { slug: c.slug },
      defaults: {
        slug: c.slug, icon: c.icon, sort_order: c.sort,
        title_ko: c.title.ko, title_en: c.title.en,
        summary_ko: c.summary.ko, summary_en: c.summary.en,
      },
    });
    // 기존 row 도 최신 내용으로 업데이트 (멱등)
    await row.update({
      icon: c.icon, sort_order: c.sort,
      title_ko: c.title.ko, title_en: c.title.en,
      summary_ko: c.summary.ko, summary_en: c.summary.en,
    });
    catBySlug[c.slug] = row.id;
  }
  console.log(`카테고리 ${CATEGORIES.length}건 업서트`);

  let count = 0;
  const articleIds = [];
  for (let i = 0; i < ARTICLES.length; i++) {
    const a = ARTICLES[i];
    const categoryId = catBySlug[a.cat];
    if (!categoryId) { console.warn('카테고리 없음:', a.cat); continue; }
    const payload = {
      slug: a.slug, category_id: categoryId,
      title_ko: a.title.ko, title_en: a.title.en,
      summary_ko: a.summary.ko, summary_en: a.summary.en,
      body_ko: a.body.map((b) => ({ type: b.type, text_ko: b.text_ko })),
      body_en: a.body.map((b) => ({ type: b.type, text_en: b.text_en })),
      visibility: a.visibility,
      linked_route: a.linked_route || null,
      est_minutes: a.est || null,
      sort_order: i,
      is_published: true,
    };
    const existing = await HelpArticle.findOne({ where: { slug: a.slug } });
    let row;
    if (existing) { row = await existing.update(payload); }
    else { row = await HelpArticle.create(payload); }
    articleIds.push(row.id);
    count++;
  }
  console.log(`article ${count}건 업서트`);

  // 임베딩 인덱싱 (OPENAI_API_KEY 있을 때만 임베딩, 없으면 청크만)
  console.log('임베딩 인덱싱 중...');
  for (const id of articleIds) {
    try { const r = await indexArticle(id); process.stdout.write(`#${id}:${r.chunks} `); }
    catch (e) { console.warn('index fail', id, e.message); }
  }
  console.log('\n완료.');
  process.exit(0);
}

run().catch((err) => { console.error('seed 실패:', err); process.exit(1); });
