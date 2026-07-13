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
  { slug: 'qcalendar', icon: 'calendar', sort: 5, title: t('Q Calendar (일정)', 'Q Calendar'),
    summary: t('일정 만들기·구글 캘린더/Meet 연동·공유·나만보기', 'Create events, Google Calendar/Meet sync, sharing, private events') },
  { slug: 'qmail', icon: 'mail', sort: 7, title: t('Q Mail (메일)', 'Q Mail'),
    summary: t('메일 계정 연결·인박스·메일과 대화 통합', 'Connect mail accounts, inbox, unify mail with chat') },
  { slug: 'qproject', icon: 'folder', sort: 8, title: t('Q Project (프로젝트)', 'Q Project'),
    summary: t('프로젝트 만들기·정렬/그룹·거래 시퀀스·내부/고객 구분', 'Create projects, sort/group, deal sequence, client vs internal') },
  { slug: 'insights', icon: 'chart', sort: 12, title: t('Insights (통계)', 'Insights'),
    summary: t('업무·수익성·팀·재무 통계와 내부/고객 구분', 'Tasks, profitability, team, finance stats with client/internal split') },
  { slug: 'cue', icon: 'star', sort: 13, title: t('Cue (AI 팀원)', 'Cue (AI teammate)'),
    summary: t('Cue에게 업무 맡기기·채팅 자동응답·자료 요약', 'Hand off tasks to Cue, auto-reply in chat, summarize material') },
  { slug: 'qinfo', icon: 'info', sort: 14, title: t('Q info (고객·멤버 정보)', 'Q info'),
    summary: t('고객·멤버 360° 정보와 통합 타임라인', 'Client and member 360° profiles with a unified timeline') },
  { slug: 'settings', icon: 'gear', sort: 15, title: t('설정·권한', 'Settings & Permissions'),
    summary: t('워크스페이스·멤버 권한·개인 연동 설정', 'Workspace, member permissions and personal integrations') },
];

// ───────────────────────────────────────────────────────────────
// 랜딩 인사이트(/insights) 발행 매핑 — 단일 소스(Q위키)에서 공개 마케팅 피드로 동기화.
//   여기에 slug → blog_category 만 추가하면 seed 가 해당 글을 자동으로:
//     ① visibility='public' 강제 (blog.js WHERE 가 public 만 노출)
//     ② blog_category 지정 (BlogPage 필터 탭: how-to / insights / cases / guide-video / brand-video)
//     ③ blog_published_at 부여 (멱등 — 이미 있으면 보존, 없으면 결정적 날짜)
//   개발마다 신규 how-to 를 여기 등록 → 배포 후 node seed-wiki-content.js → 인사이트에 즉시 반영.
//   (ko/en 은 아티클 정의에 이미 양쪽 있으므로 인사이트도 자동 이중언어)
const BLOG_MAP = {
  'create-workspace': 'how-to',
  'create-task': 'how-to',
  'issue-invoice': 'how-to',
  'record-meeting': 'how-to',
  'create-document': 'how-to',
  'collect-signature': 'how-to',
  'upload-share-file': 'how-to',
  'create-event': 'how-to',
  'create-project': 'how-to',
  'qmail-inbox': 'how-to',
  'qmail-reply-needed': 'how-to',
  'qmail-sender-rules': 'how-to',
  'qmail-accounts-view': 'how-to',
  'qmail-cue-draft': 'how-to',
  'assign-task-to-cue': 'how-to',
  'what-is-cue': 'insights',
  'insights-overview': 'insights',
  'client-vs-internal': 'insights',
};
// 발행일 결정적 기준 — 배포/재시드마다 동일 (clock 비의존). 리스트 순서대로 하루씩 과거로.
const BLOG_BASE_TS = Date.parse('2026-07-07T00:00:00Z');
const DAY_MS = 86400000;

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
  { cat: 'qtalk', slug: 'message-reactions', visibility: 'authenticated', linked_route: '/qtalk', est: 2,
    title: t('메시지에 이모지로 반응하기', 'React to a message with an emoji'),
    summary: t('답장 대신 이모지로 확인·동의를 빠르게 표시', 'Use an emoji instead of a reply to acknowledge or agree'),
    body: [
      p('"확인했어요", "좋아요" 같은 짧은 답장으로 대화가 길어지는 것을 줄여줍니다. 반응은 상대에게 실시간으로 보입니다.',
        'It keeps threads from filling up with short replies like "got it" or "sounds good". Reactions appear to others in real time.'),
      s('메시지에 마우스를 올리면(모바일은 항상) 나타나는 웃는 얼굴 버튼을 누릅니다.',
        'Hover a message (on mobile it is always visible) and click the smiley button.'),
      s('이모지 8종 중 하나를 고릅니다. 같은 이모지를 다시 누르면 반응이 취소됩니다.',
        'Pick one of eight emojis. Clicking the same emoji again removes your reaction.'),
      note('반응한 사람 수는 이모지 옆 숫자로 보입니다. 삭제된 메시지에는 반응할 수 없습니다.',
        'The number next to an emoji shows how many people reacted. Deleted messages cannot be reacted to.'),
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
      note('카드 결제(Stripe)는 고객이 결제하면 자동으로 결제 완료 처리되고 발행자에게 알림이 갑니다 — 직접 마킹할 필요가 없습니다.',
        'Card payments (Stripe) are confirmed automatically when the customer pays, and the issuer is notified — no manual marking needed.'),
      note('결제가 확인되어야 세금계산서·현금영수증 발행 큐가 열립니다.',
        'The tax-invoice / cash-receipt queue opens only after payment is confirmed.'),
    ] },
  { cat: 'qbill', slug: 'overdue-reminder', visibility: 'authenticated', linked_route: '/qbill', est: 2,
    title: t('결제가 안 될 때 (독촉 보내기)', "When an invoice isn't paid (sending a reminder)"),
    summary: t('마감일이 지나면 알림으로 물어보고, 독촉 메일은 직접 눌러야 나갑니다', 'When the due date passes we ask you first — reminder emails go out only when you send them'),
    body: [
      p('PlanQ 는 고객에게 독촉 메일을 자동으로 보내지 않습니다. 계좌이체 입금은 직접 확인해서 표시하는 방식이라, 이미 입금한 고객에게 시스템이 독촉을 보내는 사고를 막기 위해서입니다.',
        "PlanQ never sends reminder emails on its own. Bank transfers are confirmed by hand, so an automatic reminder could nag a customer who has already paid."),
      s('마감일이 지나면 청구 담당자(소유자·관리자·청구서 담당자)에게 "독촉 메일을 보낼까요?" 알림이 옵니다.',
        'When the due date passes, the billing owners (owner, admin, and the invoice owner) get an alert asking whether to send a reminder.'),
      s('알림을 누르면 청구서가 열립니다. 이미 입금됐으면 "결제 완료"로 표시하고, 아직이면 "결제 독촉 보내기"를 누릅니다.',
        'The alert opens the invoice. If the money already arrived, mark it as paid; if not, click "Send payment reminder".'),
      s('독촉을 보내면 같은 청구서로는 7일간 다시 묻지 않습니다. 그때도 미결제면 다시 알려줍니다.',
        "Once you send a reminder, we won't ask again about that invoice for 7 days. If it's still unpaid after that, we ask again."),
      note('사정을 아는 고객이라 재촉하고 싶지 않다면, 청구서 상세에서 "알림 끄기" 를 누르면 그 청구서는 더 묻지 않습니다. 연체 상태 표시는 그대로 남습니다.',
        'If you\'d rather not chase a particular customer, click "Turn off alerts" on the invoice and we stop asking about it. The overdue status still shows.'),
    ] },
  { cat: 'qbill', slug: 'card-payment', visibility: 'authenticated', linked_route: '/business/settings/billing', est: 3,
    title: t('카드로 결제 받기 (Stripe)', 'Accept card payments (Stripe)'),
    summary: t('워크스페이스 Stripe 계정을 연결해 고객이 청구서를 카드로 결제', 'Connect your Stripe account so clients can pay invoices by card'),
    body: [
      p('워크스페이스에 Stripe 계정을 연결하면 청구서 공개 결제 페이지에 "카드로 결제" 버튼이 켜집니다. 계좌이체와 함께 제공되며, 카드 결제는 결제 즉시 확정됩니다.',
        'Connect a Stripe account to your workspace to turn on a "Pay by card" button on the invoice payment page. It works alongside bank transfer, and card payments confirm instantly.'),
      s('Q Bill 설정 → "카드 결제 (Stripe)" 에서 Secret Key 와 Webhook Secret 을 입력합니다(둘 다 있어야 결제 버튼이 켜집니다 — Webhook 이 없으면 고객이 결제해도 청구서가 자동 확정되지 않기 때문입니다). Publishable Key 는 선택입니다.',
        'In Q Bill settings → "Card Payment (Stripe)", enter the Secret Key and the Webhook Secret. Both are required to turn the button on — without the webhook, a customer could pay and the invoice would never be marked paid. The Publishable Key is optional.'),
      s('Stripe 대시보드 → Developers → Webhooks 에 화면에 표시된 엔드포인트 URL 을 등록하고(checkout.session.completed, payment_intent.succeeded) Signing secret 을 입력합니다.',
        'In the Stripe Dashboard → Developers → Webhooks, register the endpoint URL shown on screen (checkout.session.completed, payment_intent.succeeded) and paste the Signing secret.'),
      s('고객은 청구서 링크에서 "카드로 결제"를 눌러 Stripe 보안 페이지에서 결제합니다. 분할 청구는 회차별로 결제합니다.',
        'Clients click "Pay by card" on the invoice link and pay on Stripe\'s secure page. Split invoices are paid per installment.'),
      note('Secret Key·Webhook Secret 은 암호화되어 저장되며 화면에 다시 표시되지 않습니다. Stripe 설정은 소유자·관리자만 변경할 수 있습니다.',
        'Secret Key and Webhook Secret are stored encrypted and never shown again. Only owners and admins can change Stripe settings.'),
      note('여기 넣는 계정은 이 워크스페이스의 것입니다 — 고객 결제금은 PlanQ 를 거치지 않고 이 계정으로 바로 들어옵니다. Stripe 계정은 도메인과 무관하므로 이미 쓰는 계정을 그대로 써도 됩니다. 다만 Webhook 은 이 화면에 표시된 주소로 하나 더 등록하고 그 Signing secret 을 넣어야 합니다(엔드포인트마다 secret 이 다릅니다).',
        "The account you enter here is this workspace's own — customer payments land in it directly, never passing through PlanQ. Stripe accounts aren't tied to a domain, so you can reuse an existing one. You do need to add one more webhook endpoint (the URL shown on the screen) and paste its signing secret, since each endpoint has its own."),
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
  { cat: 'settings', slug: 'pay-subscription', visibility: 'authenticated', linked_route: '/business/settings/plan', est: 2,
    title: t('구독료 결제하기 (계좌이체·카드)', 'Pay your subscription (bank transfer or card)'),
    summary: t('PlanQ 구독료를 계좌이체 또는 카드로 결제', 'Pay your PlanQ subscription by bank transfer or card'),
    body: [
      p('플랜을 선택하면 결제 창이 열립니다. 계좌이체는 안내 계좌로 송금 후 "입금했어요"로 통보하고, 카드 결제는 Stripe 보안 페이지에서 즉시 결제됩니다.',
        'Choosing a plan opens the checkout. For bank transfer, send to the listed account and click "I\'ve paid"; for card, pay instantly on Stripe\'s secure page.'),
      s('설정 → 플랜에서 플랜과 주기를 고르고 결제 방법을 선택합니다.', 'In Settings → Plan, pick a plan and cycle, then choose a payment method.'),
      note('카드 결제 버튼은 PlanQ 가 카드 결제를 활성화한 경우에만 표시됩니다. 계좌이체는 운영팀이 입금을 확인한 뒤 구독이 활성화됩니다.',
        'The card button appears only when card payment is enabled. Bank transfers activate the subscription after the team confirms the deposit.'),
    ] },
  { cat: 'settings', slug: 'personal-integrations', visibility: 'authenticated', linked_route: '/settings/integrations', est: 2,
    title: t('개인 연동 설정', 'Personal integrations'),
    summary: t('구글 캘린더·드라이브 등 개인 외부 연동 연결', 'Connect personal integrations like Google Calendar and Drive'),
    body: [
      p('개인 설정에서 구글 캘린더·드라이브 등을 연결해 일정·파일을 연동합니다.',
        'Connect Google Calendar, Drive, and more from personal settings to sync events and files.'),
    ] },
  { cat: 'settings', slug: 'connect-mail', visibility: 'authenticated', linked_route: '/business/settings/mail-accounts', est: 3,
    title: t('메일 계정 연결하기 (Gmail · IMAP)', 'Connect a mail account (Gmail · IMAP)'),
    summary: t('Gmail 또는 IMAP 메일 계정을 연결해 Q Mail에서 메일을 함께 보고 답장', 'Connect a Gmail or IMAP account to read and reply to mail inside Q Mail'),
    body: [
      p('메일 계정을 연결하면 받은 메일을 Q Mail에서 함께 보고, 고객 대화·업무와 한 곳에서 답장할 수 있어요. 5분마다 자동으로 동기화됩니다.',
        'Connect a mail account to read incoming mail inside Q Mail and reply alongside client chats and tasks. It syncs automatically every 5 minutes.'),
      h('어디서 연결하나요?', 'Where do I connect?'),
      s('설정 → 메일 계정 (또는 Q Mail 화면의 "메일 계정 연결")으로 들어갑니다.', 'Go to Settings → Mail accounts (or "Connect a mail account" on the Q Mail screen).'),
      s('회사 공용 메일은 관리자가 연결하면 모든 팀원이 인박스에서 함께 봅니다. 개인 메일은 본인에게만 보입니다.', 'A shared company mailbox (connected by an admin) is visible to the whole team; a personal mailbox is visible only to you.'),
      h('Gmail로 연결 (가장 간편)', 'Connect with Gmail (easiest)'),
      s('"Gmail로 연결" 버튼을 누르면 구글 로그인 창이 열립니다. 권한을 허용하면 끝 — 앱 비밀번호가 필요 없습니다.', 'Click "Connect with Gmail" to open the Google sign-in window. Allow access and you are done — no app password needed.'),
      h('IMAP로 직접 연결 (그 외 메일)', 'Connect via IMAP (other providers)'),
      s('"계정 추가"에서 이메일 주소, IMAP 호스트·포트, 비밀번호(또는 앱 비밀번호)를 입력합니다.', 'In "Add account", enter your email address, IMAP host and port, and password (or app password).'),
      note('Gmail·네이버 등 2단계 인증을 쓰는 메일은 일반 비밀번호 대신 "앱 비밀번호"를 발급해 입력해야 합니다. Gmail 사용자는 "Gmail로 연결" 버튼이 가장 간편합니다.',
        'For mailboxes with 2-step verification (Gmail, Naver, etc.), generate and enter an "app password" instead of your normal password. Gmail users should prefer the "Connect with Gmail" button.'),
    ] },

  // ── Q Calendar ──
  { cat: 'qcalendar', slug: 'create-event', visibility: 'authenticated', linked_route: '/calendar', est: 2,
    title: t('일정 만들고 시간 지정하기', 'Create an event and set the time'),
    summary: t('캘린더에서 일정을 만들고 시작·마감 시각을 지정', 'Create an event on the calendar and set start and end times'),
    body: [
      p('Q Calendar는 팀 일정과 업무 마감을 한 화면에서 봅니다. 주/일 뷰의 빈 시간칸을 클릭하면 그 시각으로 바로 일정이 만들어져요.',
        'Q Calendar shows team schedules and task deadlines in one place. In week/day view, click an empty time slot to start a new event at that time.'),
      s('주/일 뷰에서 원하는 시간칸을 클릭하거나 우측 상단 "일정 만들기"를 누릅니다.', 'Click a time slot in week/day view, or use "Create event" at the top right.'),
      s('시작 날짜·시각과 마감 날짜·시각을 각각 지정합니다. 시간은 각 날짜 옆에 붙어 표시돼요.', 'Set the start date/time and end date/time — each time is shown next to its own date.'),
      note('여러 날에 걸친 일정은 시작날짜의 시각과 마감날짜의 시각이 각각 표시됩니다.', 'For multi-day events, the start-date time and end-date time are shown separately.'),
    ] },
  { cat: 'qcalendar', slug: 'calendar-visibility-share', visibility: 'authenticated', linked_route: '/calendar', est: 2,
    title: t('일정 공개 범위와 공유 링크', 'Event visibility and share links'),
    summary: t('나만보기·팀·워크스페이스·외부 공개 범위와 공유 링크', 'Private, team, workspace, and external visibility with share links'),
    body: [
      p('일정마다 공개 범위를 정할 수 있어요. 나만보기·팀 비공개·워크스페이스 전체·외부 공유 4단계입니다.',
        'Each event has a visibility level: private (only me), team-only, whole workspace, or external.'),
      s('일정 상세에서 공개 범위를 선택합니다.', 'Pick the visibility level in the event detail.'),
      s('워크스페이스·외부 일정은 "공유" 버튼으로 공개 링크를 만들 수 있습니다.', 'For workspace or external events you can create a public share link with the "Share" button.'),
      note('나만보기·팀 비공개 일정은 공개 링크를 만들 수 없어요 — 개인·팀 정보가 외부로 새지 않도록 막혀 있습니다.', 'Private and team-only events cannot be shared via a public link — this prevents personal or team info from leaking externally.'),
    ] },
  { cat: 'qcalendar', slug: 'google-calendar-meet', visibility: 'authenticated', linked_route: '/settings/integrations', est: 2,
    title: t('구글 캘린더·Meet 연동', 'Google Calendar & Meet sync'),
    summary: t('구글 캘린더 동기화와 화상회의 링크 자동 발급', 'Sync Google Calendar and auto-create Meet video links'),
    body: [
      p('구글 캘린더를 연동하면 일정이 양방향 동기화되고, 회의에 구글 Meet 링크가 자동으로 붙습니다.',
        'Connect Google Calendar for two-way sync, and meetings automatically get a Google Meet link.'),
      s('내 계정 → 연동에서 구글 캘린더를 연결합니다.', 'Connect Google Calendar in My account → Integrations.'),
      s('일정에 화상회의를 켜면 Meet 링크가 발급됩니다.', 'Turn on video meeting for an event to generate a Meet link.'),
    ] },

  // ── Q Mail ──
  { cat: 'qmail', slug: 'qmail-inbox', visibility: 'authenticated', linked_route: '/mail', est: 2,
    title: t('메일을 대화처럼 보기', 'Read mail like a conversation'),
    summary: t('인박스에서 메일을 확인하고 고객 대화·업무와 함께 답장', 'Read mail in the inbox and reply alongside client chats and tasks'),
    body: [
      p('메일 계정을 연결하면(설정 → 메일 계정) 받은 메일이 Q Mail 인박스에 모입니다. 고객별로 메일·대화·업무가 한 타임라인에서 보여요.',
        'Once you connect a mail account (Settings → Mail accounts), incoming mail collects in the Q Mail inbox. Mail, chat, and tasks appear on one timeline per client.'),
      s('Q Mail 화면에서 메일 스레드를 엽니다.', 'Open a mail thread on the Q Mail screen.'),
      s('답장·전달·임시저장이 대화처럼 동작합니다. 첨부는 Q File에 함께 보관됩니다.', 'Reply, forward, and save drafts like a chat. Attachments are also stored in Q File.'),
      note('메일 계정 연결 방법은 "메일 계정 연결하기" 도움말을 참고하세요.', 'See "Connect a mail account" for how to link your mailbox.'),
    ] },

  { cat: 'qmail', slug: 'qmail-sender-rules', visibility: 'authenticated', linked_route: '/business/settings/mail-accounts', est: 2,
    title: t('메일 분류 규칙 (자동 학습)', 'Mail sorting rules (learned automatically)'),
    summary: t('같은 발신자를 두 번 "답변 불필요" 하면 앞으로 묻지 않습니다', 'Mark the same sender "No reply needed" twice and we stop asking'),
    body: [
      p('결제 영수증이나 시스템 알림처럼 답장할 필요가 없는 메일이 "답변 필요" 에 계속 쌓이면, 정작 챙겨야 할 고객 메일이 묻힙니다. PlanQ 는 여러분이 클릭한 결과로 배웁니다 — AI 를 쓰지 않습니다.',
        'When receipts and system notifications pile up in "Needs reply", the customer emails that actually matter get buried. PlanQ learns from what you click — no AI involved.'),
      s('같은 발신자의 메일을 두 번 "답변 불필요" 하면, 그 발신자는 앞으로 "답변 필요" 에 나타나지 않습니다. 이미 쌓여 있던 그 발신자의 메일도 함께 정리됩니다.',
        'Mark two emails from the same sender as "No reply needed" and that sender stops appearing in "Needs reply" — including the ones already piled up.'),
      s('같은 발신자에게 답장을 보내면 규칙이 즉시 해제됩니다. 사람이 직접 대응하는 상대는 계속 챙겨야 하니까요.',
        'If you reply to that sender, the rule is removed immediately — someone you actually correspond with should keep showing up.'),
      s('설정 → 메일 계정 → "메일 분류 규칙" 에서 학습된 규칙과 그 근거를 모두 볼 수 있고, 언제든 지울 수 있습니다. 직접 추가할 수도 있습니다.',
        'In Settings → Mail accounts → "Mail sorting rules" you can see every learned rule with its reason and delete any of them. You can also add rules yourself.'),
      note('규칙은 분류만 바꿉니다 — 메일 자체는 절대 삭제되지 않습니다. 규칙을 지우면 즉시 원래대로 돌아갑니다. 규칙으로 분류된 메일에는 "규칙으로 자동 분류됨" 표시가 붙습니다.',
        'Rules only change sorting — no email is ever deleted. Delete a rule and everything returns to how it was. Emails sorted by a rule are labelled "Sorted by a rule".'),
    ] },
  { cat: 'qmail', slug: 'qmail-reply-needed', visibility: 'authenticated', linked_route: '/mail', est: 2,
    title: t('답변 필요 메일만 골라 보기', 'See only the mail that needs a reply'),
    summary: t('사람이 보낸 메일만 답변 필요로 모으고, 처리한 메일은 목록에서 내리기', 'Collect only human mail as needs-reply and clear the ones you have handled'),
    body: [
      p('"답변 필요" 에는 확실히 답해야 하는 메일만 모읍니다 — ①고객·팀원처럼 아는 상대가 보낸 메일 ②우리가 주고받던 대화에 대한 회신 ③우리 주소로 직접 온 명확한 요청(문의·견적·회신 부탁). 단, 답장할 상대가 없는 메일 — 뉴스레터·자동 발송·주문/배송/결제 알림·반송 — 은 아는 상대가 보냈더라도 "확인 권장" 으로 갑니다. 애매한 메일도 마찬가지입니다. 사이드바 Q Mail 옆 숫자가 답변 필요 건수입니다.',
        'The "Needs reply" tab collects only mail you clearly have to answer: (1) mail from someone you know — a client or teammate, (2) a reply in a thread you were already in, and (3) a clear request sent directly to your address (an inquiry, a quote, a request to reply). Mail with nobody to reply to — newsletters, automated sends, order/shipping/payment notices, bounces — goes to "Review suggested" even when it comes from someone you know. So does anything ambiguous. The number next to Q Mail in the sidebar is the needs-reply count.'),
      s('Q Mail 좌측에서 "답변 필요" 탭을 엽니다.', 'Open the "Needs reply" tab on the left of Q Mail.'),
      s('"확인 권장" 탭에는 광고·스팸은 아닌데 업무인지 애매한 메일이 모입니다. 한 번 보고 판단하면 됩니다.',
        'The "Review suggested" tab holds mail that is not spam or marketing but may or may not be work. Give it one look and decide.'),
      s('3일 넘게 답장하지 않은 메일에는 "N일 경과" 표시가 붙습니다.', 'Mail waiting more than three days is marked with "N days waiting".'),
      s('답장하지 않아도 되는 메일이면 "답변 불필요"를 누릅니다. 목록에서 내려가 "확인 권장" 으로 갑니다.', 'If the mail needs no reply, press "No reply needed" — it leaves the list and moves to "Review suggested".'),
      note('메일에 답장하면 답변 필요는 자동으로 해제됩니다. 답변 필요 메일은 "확인 필요" 화면의 메일 탭에도 함께 보입니다.',
        'Replying from Q Mail clears the needs-reply flag automatically. Needs-reply mail also appears under the Mail tab of the "Needs attention" screen.'),
    ] },

  { cat: 'qmail', slug: 'qmail-accounts-view', visibility: 'authenticated', linked_route: '/mail', est: 2,
    title: t('회사 메일과 내 메일 나눠 보기', 'View company mail and personal mail separately'),
    summary: t('주소별로 인박스를 나눠 보고, 발신 이름을 정하기', 'Filter the inbox by address and set the name recipients see'),
    body: [
      p('한 인박스에 회사 공용 메일과 내 개인 메일이 함께 모입니다. 검색창 아래 계정 셀렉트로 주소별로 나눠 볼 수 있어요(선택한 탭·계정은 다음에 들어와도 유지됩니다). 개인 메일은 나에게만 보입니다.',
        'One inbox holds both the shared company mailbox and your personal mail. Use the account chips above the list to view them by address. Personal mail is visible only to you.'),
      s('목록 위 칩에서 "전체" 또는 특정 주소를 선택합니다. 상단 폴더 숫자도 선택한 주소 기준으로 바뀝니다.',
        'Pick "All" or a specific address from the chips above the list. The folder counts follow your selection.'),
      s('발신 이름(받는 사람에게 보이는 이름)은 설정 → 메일 계정에서 바꿉니다.', 'Change the sender name recipients see in Settings → Mail accounts.'),
      note('회사 공용 계정의 기본 발신 이름은 워크스페이스 메일 설정을 따릅니다.', 'The shared account uses the workspace mail settings as its default sender name.'),
    ] },

  { cat: 'qmail', slug: 'qmail-cue-draft', visibility: 'authenticated', linked_route: '/mail', est: 1,
    title: t('Cue에게 답장 초안 맡기기', 'Let Cue draft the reply'),
    summary: t('메일 답장 초안을 Cue가 먼저 써주고 사람이 다듬어 보내기', 'Cue writes a first draft and you polish it before sending'),
    body: [
      p('메일을 열면 "답장" 옆에 "Cue 답변 초안" 버튼이 있습니다. 누르면 Cue가 지난 대화와 등록된 FAQ를 참고해 초안을 씁니다.',
        'Open a mail and you will see "Cue draft reply" next to "Reply". Cue writes a draft using the thread history and your registered FAQs.'),
      s('메일 상세 하단에서 "Cue 답변 초안"을 누릅니다.', 'Press "Cue draft reply" at the bottom of the mail detail.'),
      s('초안이 채워진 작성창이 열립니다. 내용을 확인·수정한 뒤 보냅니다.', 'The composer opens with the draft filled in. Review, edit, and send.'),
      note('광고·자동 발송 메일에는 초안을 제안하지 않습니다. 보내기는 항상 사람이 누릅니다.', 'No draft is offered for ads or automated mail. A person always presses send.'),
    ] },

  // ── Q Project ──
  { cat: 'qproject', slug: 'create-project', visibility: 'authenticated', linked_route: '/projects', est: 2,
    title: t('프로젝트 만들고 정렬·그룹 보기', 'Create a project and sort/group the list'),
    summary: t('프로젝트를 만들고 리스트를 정렬·그룹으로 편하게 보기', 'Create projects and organize the list with sort and grouping'),
    body: [
      p('프로젝트는 고객·대화·업무·거래를 묶는 단위입니다. 리스트는 정렬(최근·이름·진행률·마감)과 그룹(상태·고객사·부서·팀·고객/내부)으로 볼 수 있어요.',
        'A project groups clients, chats, tasks, and deals. The list can be sorted (recent, name, progress, deadline) and grouped (status, client, department, team, client/internal).'),
      s('상단 "새 프로젝트"로 프로젝트를 만들고 멤버·고객·채널을 설정합니다.', 'Create a project with "New project" at the top and set members, clients, and channels.'),
      s('리스트 상단의 정렬·그룹 선택으로 원하는 방식으로 봅니다.', 'Use the sort and group selectors above the list to organize your view.'),
      note('부서별·팀별 그룹은 프로젝트 담당자(owner)의 소속을 기준으로 묶습니다.', 'Department and team grouping is based on the project owner’s membership.'),
    ] },
  { cat: 'qproject', slug: 'project-group-tasks', visibility: 'authenticated', linked_route: '/projects', est: 2,
    title: t('프로젝트 업무를 그룹(추진과제)으로', 'Organize project tasks into groups'),
    summary: t('업무를 추진과제(워크스트림) 그룹으로 묶고 그룹별로 추가', 'Group tasks into workstreams and add tasks per group'),
    body: [
      p('프로젝트 업무는 추진과제(워크스트림) 그룹으로 묶어 관리할 수 있어요. 각 그룹에서 바로 업무를 추가합니다.',
        'Project tasks can be organized into workstream groups. Add tasks directly within each group.'),
      s('업무 리스트에서 "추진과제(그룹) 추가"로 그룹을 만듭니다.', 'Create a group with "Add workstream" in the task list.'),
      s('각 그룹의 "업무 추가"로 그 그룹에 바로 업무를 넣습니다. 드래그로 그룹을 옮길 수도 있어요.', 'Use "Add task" in each group to place a task there; you can also drag tasks between groups.'),
    ] },

  // ── Insights ──
  { cat: 'insights', slug: 'insights-overview', visibility: 'authenticated', linked_route: '/stats/overview', est: 2,
    title: t('통계 한눈에 보기', 'Insights at a glance'),
    summary: t('개요·수익성·팀·재무·업무 통계 탭 둘러보기', 'Tour the overview, profitability, team, finance, and task tabs'),
    body: [
      p('Insights는 워크스페이스의 매출·수익성·팀 생산성·업무 현황을 탭으로 보여줍니다. 기간을 바꿔 추이를 볼 수 있어요.',
        'Insights shows revenue, profitability, team productivity, and task status across tabs. Change the range to see trends.'),
      s('좌측 메뉴 Insights에서 개요·수익성·팀·재무·업무 탭을 엽니다.', 'Open the Overview, Profit, Team, Finance, and Tasks tabs under Insights.'),
      s('우측 상단에서 기간(최근 30일·이번 달·분기 등)을 바꿉니다.', 'Change the period (last 30 days, this month, quarter) at the top right.'),
    ] },
  { cat: 'insights', slug: 'client-vs-internal', visibility: 'authenticated', linked_route: '/stats/profit', est: 3,
    title: t('내부 프로젝트 vs 고객 프로젝트 수익성', 'Client vs internal project profitability'),
    summary: t('자체 투자(내부)와 고객 프로젝트를 나눠 수익성 보기', 'Separate own-investment (internal) from client projects in profitability'),
    body: [
      p('프로젝트를 "고객"과 "내부(자체 투자·비청구)"로 구분하면, 수익성 통계에서 내부 프로젝트가 마진을 왜곡하지 않아요. 내부는 매출 없이 시간·원가만 별도로 봅니다.',
        'Marking projects as "client" or "internal" (own investment, non-billable) keeps internal work from distorting margins. Internal work is tracked as time and cost, separately from revenue.'),
      s('프로젝트 설정에서 "내부 프로젝트"로 표시하면 수익성에서 제외됩니다.', 'Mark a project as "Internal" in its settings to exclude it from profitability.'),
      s('수익성(Profit) 탭 상단의 고객·내부·전체 토글로 나눠 봅니다. "내부" 탭은 내부 투자 시간·원가를 보여줍니다.', 'Use the Client / Internal / All toggle atop the Profit tab. The "Internal" view shows internal investment time and cost.'),
      note('내부 프로젝트는 "마진 음수" 경고에서도 제외돼 오탐이 사라집니다.', 'Internal projects are also excluded from "negative margin" alerts, removing false warnings.'),
    ] },

  // ── Cue (AI 팀원) ──
  { cat: 'cue', slug: 'what-is-cue', visibility: 'authenticated', linked_route: null, est: 2,
    title: t('Cue란? — 워크스페이스 AI 팀원', 'What is Cue? — your AI teammate'),
    summary: t('Cue가 무엇을 하는지와 사람 팀원처럼 쓰는 법', 'What Cue does and how to use it like a human teammate'),
    body: [
      p('Cue는 워크스페이스의 AI 팀원입니다. 사람 팀원처럼 업무 담당자로 지정하거나 대화에 부를 수 있어요.',
        'Cue is your workspace AI teammate. Assign it as a task owner or bring it into a conversation, just like a person.'),
      s('업무를 맡기면 결과물을 자동으로 만들어 줍니다.', 'Hand off a task and Cue generates the deliverable.'),
      s('고객 채팅에 자동으로 답안을 제안합니다(내가 확인 후 발송).', 'Cue drafts replies to customer chat (you review before sending).'),
      s('회의 내용·자료를 요약하고 정리합니다.', 'Cue summarizes and organizes meetings and material.'),
      note('Cue는 전 플랜에서 같은 기능을 쓰고, 월 사용 한도(액션 수)만 플랜별로 다릅니다.', 'Cue works the same on every plan; only the monthly action limit differs by plan.'),
    ] },
  { cat: 'cue', slug: 'assign-task-to-cue', visibility: 'authenticated', linked_route: '/tasks', est: 2,
    title: t('Cue에게 업무 맡기기', 'Hand off a task to Cue'),
    summary: t('업무를 Cue에게 배정하고 결과를 받아 검토', 'Assign a task to Cue and review the result'),
    body: [
      p('업무 담당자를 Cue로 지정하거나, Q Task 상단 "Cue에게 말하기"에 한 줄 적으면 Cue가 업무로 정리해 처리합니다.',
        'Assign Cue as the task owner, or type a line into "Talk to Cue" atop Q Task, and Cue turns it into tasks and handles them.'),
      s('업무를 만들고 담당자를 Cue로 선택합니다.', 'Create a task and choose Cue as the owner.'),
      s('Cue가 결과물을 만들면 확인 요청으로 받아 검토하고, 필요하면 코멘트로 수정 방향을 알려줍니다.', 'When Cue produces a result, review it via the confirmation flow and leave a comment to guide revisions.'),
    ] },

  // ── Q info ──
  { cat: 'qinfo', slug: 'client-member-360', visibility: 'authenticated', linked_route: '/clients', est: 2,
    title: t('고객·멤버 360° 정보', 'Client & member 360° profiles'),
    summary: t('고객·멤버의 대화·업무·청구·파일을 한 곳에서', 'See a person’s chats, tasks, billing, and files in one place'),
    body: [
      p('고객이나 멤버를 열면 그 사람과 관련된 대화·업무·청구·파일이 하나의 타임라인으로 모입니다.',
        'Open a client or member to see all related chats, tasks, billing, and files on a single timeline.'),
      s('고객 관리에서 고객을 선택해 상세를 엽니다.', 'Select a client in Clients to open their detail.'),
      s('사업자/개인 정보, 증빙 정보, 연결된 프로젝트를 확인·편집합니다.', 'Review and edit business/personal info, receipt details, and linked projects.'),
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
  let blogCount = 0;
  let blogSeq = 0;
  const articleIds = [];
  for (let i = 0; i < ARTICLES.length; i++) {
    const a = ARTICLES[i];
    const categoryId = catBySlug[a.cat];
    if (!categoryId) { console.warn('카테고리 없음:', a.cat); continue; }
    const blogCat = BLOG_MAP[a.slug] || null;
    const payload = {
      slug: a.slug, category_id: categoryId,
      title_ko: a.title.ko, title_en: a.title.en,
      summary_ko: a.summary.ko, summary_en: a.summary.en,
      body_ko: a.body.map((b) => ({ type: b.type, text_ko: b.text_ko })),
      body_en: a.body.map((b) => ({ type: b.type, text_en: b.text_en })),
      // 인사이트 발행분은 게스트에게도 보여야 하므로 public 강제 (그 외는 아티클 정의값 유지)
      visibility: blogCat ? 'public' : a.visibility,
      linked_route: a.linked_route || null,
      est_minutes: a.est || null,
      sort_order: i,
      is_published: true,
    };
    const existing = await HelpArticle.findOne({ where: { slug: a.slug } });
    if (blogCat) {
      payload.blog_category = blogCat;
      // 멱등: 기존 발행일(관리자 수동 발행 포함) 보존, 없으면 결정적 날짜 부여 → 배포마다 동일
      payload.blog_published_at = (existing && existing.blog_published_at)
        ? existing.blog_published_at
        : new Date(BLOG_BASE_TS - (blogSeq * DAY_MS));
      blogSeq += 1;
      blogCount += 1;
    }
    let row;
    if (existing) { row = await existing.update(payload); }
    else { row = await HelpArticle.create(payload); }
    articleIds.push(row.id);
    count++;
  }
  console.log(`article ${count}건 업서트 (인사이트 발행 ${blogCount}건)`);

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
