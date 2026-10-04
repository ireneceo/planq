// «써 보면 놀라는 디테일» 카드 목록 — 순서·영역·도움말 slug·앱 경로의 **정본 한 곳**.
//   공개 페이지(/details/)와 홈 「놀라는 디테일 6」 이 같이 읽는다. 문구는 locales landing.json detailsPage.items.<id>.
//   ★ 새 카드는 코드로 확인된 기능만(docs/marketing/DETAIL_FEATURES.md) · help 는 실제 있는 도움말 slug 만.
export type DetailArea = 'ai' | 'client' | 'work' | 'docs' | 'files' | 'bill';
export interface Detail { id: string; area: DetailArea; help?: string; app?: string }

// 순서 = 화면 순서. help = 도움말 글 slug(있는 글만) · app = 로그인 시 [바로 써 보기] 경로.
export const DETAILS: Detail[] = [
  { id: 'chatgpt', area: 'ai', help: 'connect-chatgpt-claude', app: '/profile/integrations' },
  { id: 'replyDraft', area: 'ai', help: 'cue-in-chat-and-mail', app: '/mail' },
  { id: 'noteAnswer', area: 'ai', help: 'record-meeting', app: '/notes' },
  { id: 'estimate', area: 'ai', app: '/tasks' },
  { id: 'guestLink', area: 'client', help: 'project-external-view-link', app: '/projects' },
  { id: 'booking', area: 'client', help: 'customer-entry-booking' },
  { id: 'realInquiry', area: 'client', help: 'sale-inbox-criteria', app: '/sale' },
  { id: 'oneClient', area: 'client', help: 'save-to-consult', app: '/sale' },
  { id: 'chatTranslate', area: 'client', help: 'translation', app: '/talk' },
  { id: 'popout', area: 'work', help: 'popout-pin', app: '/tasks' },
  { id: 'approveDone', area: 'work', help: 'confirm-review', app: '/tasks' },
  { id: 'responsibility', area: 'work', app: '/tasks' },
  { id: 'autoHours', area: 'work', app: '/tasks' },
  { id: 'duplicate', area: 'work', help: 'duplicate-document' },
  { id: 'toc', area: 'docs', app: '/docs' },
  { id: 'pinTab', area: 'docs', help: 'project-notes-tab', app: '/projects' },
  { id: 'autosave', area: 'docs' },
  { id: 'drafts', area: 'docs' },
  { id: 'history', area: 'docs', app: '/docs' },
  { id: 'liveShare', area: 'docs' },
  { id: 'privateNote', area: 'docs', help: 'record-meeting', app: '/notes' },
  { id: 'infoTable', area: 'files', app: '/info' },
  { id: 'driveImport', area: 'files', app: '/files' },
  { id: 'trash', area: 'files', help: 'file-trash-restore', app: '/files' },
  { id: 'dedup', area: 'files' },
  { id: 'export', area: 'files' },
  { id: 'signField', area: 'bill', help: 'collect-signature', app: '/docs' },
  { id: 'invoiceLink', area: 'bill', help: 'issue-invoice', app: '/bills' },
  { id: 'installments', area: 'bill', help: 'issue-invoice', app: '/bills' },
  { id: 'autoAttend', area: 'bill', help: 'clock-in-out', app: '/attendance' },
  { id: 'profitHour', area: 'bill', help: 'project-profitability', app: '/insights' },
  { id: 'badgeSum', area: 'bill', app: '/inbox' },
];


/** 홈에 먼저 보일 6장 — 가장 강한 것부터(조사 «가장 강한 10개») */
export const HOME_DETAIL_IDS = ['chatgpt', 'guestLink', 'noteAnswer', 'popout', 'signField', 'profitHour'];
