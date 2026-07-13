// Q Mail M2 — 인박스 read-only UI (사이클 N+75-D 박제)
//
// 3컬럼 구조 (Q_MAIL_SPEC §4.1 정합):
//   좌: MailFolderTree (폴더 선택 — 답변필요/인박스/스팸/보관)
//   중: MailThreadList (스레드 리스트 — 필터된 결과 + pagination)
//   우: MailThreadDetail (스레드 상세 — 모든 message + iframe sandbox HTML)
//
// read-only: 답장/전송 X (M3 후속), 라벨/스타/할당 X (M3 후속)
// 가능: 폴더 전환, 스레드 조회, 읽음 처리 (open 시 자동), 스팸 마킹

import React, { useState, useEffect, useCallback, useMemo, useRef } from 'react';
import styled from 'styled-components';
import { useTranslation } from 'react-i18next';
import { useSearchParams, useNavigate } from 'react-router-dom';
import PageShell from '../../components/Layout/PageShell';
import PanelHeader, { PanelTitle, PanelSubTitle, PanelMetaTitle } from '../../components/Layout/PanelHeader';
import { PanelGridLayout, CollapsibleSidebar, SidebarBackdrop, Panel } from '../../components/Layout/PanelLayout';
import { useAuth, apiFetch } from '../../contexts/AuthContext';
import { useTimeFormat } from '../../hooks/useTimeFormat';
import { useVisibilityRefresh } from '../../hooks/useVisibilityRefresh';
import { joinRoom, leaveRoom, onSocket, getSocket } from '../../services/socket';
import RichEditor from '../../components/Common/RichEditor';
import AttachmentField from '../../components/Common/AttachmentField';
import ActionButton from '../../components/Common/ActionButton';
import PlanQSelect from '../../components/Common/PlanQSelect';
import { uploadMyFile } from '../../services/files';
import MailContextPanel from './MailContextPanel';
import PanelEdgeHandle from '../../components/Layout/PanelEdgeHandle';
import EmptyState from '../../components/Common/EmptyState';
import { sanitizeMailHtml } from '../../utils/sanitizeHtml';
import AiActionButton from '../../components/Common/AiActionButton';
import FloatingPanelToggle from '../../components/Common/FloatingPanelToggle';
import { useBodyScrollLock } from '../../hooks/useBodyScrollLock';

type Folder = 'reply_needed' | 'uncertain' | 'all' | 'marketing' | 'following' | 'spam' | 'archived';

// 메일 계정 (회사 공용 / 개인) — 폴더트리 그룹 (외부 연동 Phase 3)
interface MailAccount {
  id: number;
  email: string;
  display_name: string | null;
  is_personal: boolean;
  unread: number;
}

// 답변 대기 일수 — 3일 넘으면 목록에서 강조 (고객 문의를 묵히지 않게)
function waitingDays(iso?: string | null): number {
  if (!iso) return 0;
  const ms = Date.now() - new Date(iso).getTime();
  return ms > 0 ? Math.floor(ms / 86400000) : 0;
}

interface Thread {
  id: number;
  subject: string | null;
  last_message_preview: string | null;
  last_message_at: string;
  status: string;
  reply_needed: boolean;
  reply_needed_at?: string | null;
  rule_id?: number | null;        // 학습 규칙으로 분류된 스레드 (몰래 걸러지지 않도록 화면에 표시)
  is_starred: boolean;
  unread_count: number;
  message_count: number;
  labels: string[];
  account: { id: number; email: string; display_name?: string | null } | null;
  // 상대방(발신자) — 목록의 "보낸 사람" 자리. 내 메일함 이름(account.display_name)이 아니다.
  counterpart?: { name: string | null; email: string | null } | null;
  client: { id: number; display_name?: string; company_name?: string } | null;
  project?: { id: number; name?: string; color?: string } | null;
  uncertain_reason?: string | null;
  triage?: string | null; // human / automated / marketing / spam / unknown (N+83)
}

interface Message {
  id: number;
  direction: 'inbound' | 'outbound';
  from_email: string | null;
  from_name: string | null;
  to_emails: string[];
  subject: string | null;
  body_html: string | null;
  body_text: string | null;
  sent_at: string;
  is_read: boolean;
  attachments: Array<{ id: number; file_name: string; file_size: number; mime_type: string }>;
}

interface ThreadDetail extends Thread {
  messages: Message[];
  assignee_user_id?: number | null;
  assignee_name?: string | null;
  my_following?: boolean;
}

interface MailLabel { name: string; color: string }
interface MailMember { user_id: number; name: string }

// 탭 순서 (Irene 확정 2026-07-12): 할 일 → 애매한 것 → 나머지.
//   '내 담당' 제거 — 이름이 들어갔다는 이유로 따로 뺄 근거가 약하고, 그런 메일은 어차피 답변 필요다.
const FOLDERS: Array<{ key: Folder; defaultLabel: string }> = [
  { key: 'reply_needed', defaultLabel: '답변 필요' },
  // 확인 권장 = 애매한 메일 + 자동이지만 내용이 업무인 것(결제·보고서·업무 안내) + 답변이 끝난 메일.
  // '처리 완료' 탭은 성격이 같아서 여기에 합쳤다 (Irene: "같은 의미 같은데. 확인권장만 남기자").
  { key: 'uncertain', defaultLabel: '확인 권장' },
  { key: 'all', defaultLabel: '전체' },          // 스팸·보관 뺀 모든 메일 (자동·마케팅 포함)
  { key: 'marketing', defaultLabel: '자동·마케팅' },
  { key: 'following', defaultLabel: '팔로우' },
  { key: 'spam', defaultLabel: '스팸' },
  { key: 'archived', defaultLabel: '보관' },
];


// 메일 본문 문서 만들기 — 정화된 원본 문서에 높이 보고 스크립트만 덧붙인다.
//   원본에 <html>/<body> 가 있으면 그대로 쓰고(배경·정렬·템플릿 CSS 보존), 조각 HTML 이면 최소 골격만 씌운다.
//   우리 폰트·여백을 강제하지 않는다 — 강제하면 발신자가 만든 레이아웃이 깨진다.
function buildMailSrcDoc(id: number, html: string): string {
  const safe = sanitizeMailHtml(html);
  const resize = `<script>(function(){var send=function(){parent.postMessage({planqMailFrame:${id},h:document.documentElement.scrollHeight},'*');};send();window.addEventListener('load',send);if(window.ResizeObserver)new ResizeObserver(send).observe(document.body);setTimeout(send,300);setTimeout(send,1200);})();<\/script>`;
  // 가로 넘침만 최소 보정 (고정폭 템플릿이 패널보다 넓을 때 잘리지 않고 스크롤되게)
  const guard = '<style>html,body{margin:0;padding:0;}body{overflow-x:auto;}img{max-width:100%;height:auto;}</style>';
  const hasDoc = /<body[\s>]/i.test(safe);
  if (hasDoc) {
    if (/<\/body>/i.test(safe)) return safe.replace(/<\/body>/i, `${guard}${resize}</body>`);
    return `${safe}${guard}${resize}`;
  }
  return `<!DOCTYPE html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">${guard}</head><body>${safe}${resize}</body></html>`;
}

const MailPage: React.FC = () => {
  const { t } = useTranslation('qmail');
  const { user } = useAuth();
  const { formatTimeAgo, formatDateTime } = useTimeFormat();
  const [sp, setSp] = useSearchParams();
  const businessId = user?.business_id ? Number(user.business_id) : null;
  const myUserId = user?.id ? Number(user.id) : null;

  // 탭·계정 선택은 방문 간 유지된다 (URL 파라미터 > 지난번 선택 > 기본값 '답변 필요').
  // 메일함의 첫 화면은 "인박스" 가 아니라 "내가 답해야 하는 메일" 이다.
  const savedFolder = (() => {
    try { const v = localStorage.getItem('qmail_folder') as Folder | null; return v && FOLDERS.some(f => f.key === v) ? v : null; } catch { return null; }
  })();
  const folderParam = (sp.get('folder') as Folder) || savedFolder || 'reply_needed';
  const folder: Folder = useMemo(
    () => (FOLDERS.find(f => f.key === folderParam)?.key || 'reply_needed'),
    [folderParam],
  );
  const threadIdParam = sp.get('thread');
  const activeId = threadIdParam ? Number(threadIdParam) : null;
  const navigate = useNavigate();
  // 계정(회사/개인) 필터 — null = 전체
  const savedAccount = (() => {
    try { const v = localStorage.getItem('qmail_account'); return v ? Number(v) : null; } catch { return null; }
  })();
  const accountParam = sp.get('account');
  const accountFilter = sp.has('account') ? (Number(accountParam) || null) : savedAccount;
  useEffect(() => {
    try {
      localStorage.setItem('qmail_folder', folder);
      if (accountFilter) localStorage.setItem('qmail_account', String(accountFilter));
      else localStorage.removeItem('qmail_account');
    } catch { /* 사파리 프라이빗 모드 등 — 저장 실패해도 화면은 정상 */ }
  }, [folder, accountFilter]);

  const [threads, setThreads] = useState<Thread[]>([]);
  const [listLoading, setListLoading] = useState(false);
  // 무한스크롤 — 현재 페이지 + 더 있음 + 추가로딩
  const pageRef = useRef(1);
  const [hasMore, setHasMore] = useState(false);
  const [loadingMore, setLoadingMore] = useState(false);
  const [detail, setDetail] = useState<ThreadDetail | null>(null);
  const [detailLoading, setDetailLoading] = useState(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  // 우측 맥락 패널 — 리사이즈 + 접기 (Q Task 패턴 통일). localStorage 저장 · ⌘/ · Ctrl+\
  const [rightWidth, setRightWidth] = useState<number>(() => {
    try { const v = localStorage.getItem('qmail_right_width'); return v ? Math.max(280, Math.min(560, Number(v))) : 320; } catch { return 320; }
  });
  const rightResizingRef = useRef(false);
  const [rightCollapsed, setRightCollapsed] = useState<boolean>(() => {
    try { return localStorage.getItem('qmail_right_collapsed') === '1'; } catch { return false; }
  });
  const startRightResize = (e: React.MouseEvent) => {
    e.preventDefault(); rightResizingRef.current = true;
    document.body.style.userSelect = 'none'; document.body.style.cursor = 'col-resize';
  };
  useEffect(() => {
    const onMove = (e: MouseEvent) => { if (rightResizingRef.current) setRightWidth(Math.max(280, Math.min(560, window.innerWidth - e.clientX))); };
    const onUp = () => { if (rightResizingRef.current) { rightResizingRef.current = false; try { localStorage.setItem('qmail_right_width', String(rightWidth)); } catch { /* quota */ } document.body.style.userSelect = ''; document.body.style.cursor = ''; } };
    window.addEventListener('mousemove', onMove); window.addEventListener('mouseup', onUp);
    return () => { window.removeEventListener('mousemove', onMove); window.removeEventListener('mouseup', onUp); };
  }, [rightWidth]);
  const toggleRightCollapsed = useCallback(() => {
    setRightCollapsed((v) => { const next = !v; try { localStorage.setItem('qmail_right_collapsed', next ? '1' : '0'); } catch { /* quota */ } return next; });
  }, []);
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const mod = e.metaKey || e.ctrlKey; if (!mod) return;
      if (e.key === '/' || e.key === '\\') { e.preventDefault(); toggleRightCollapsed(); }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [toggleRightCollapsed]);
  const [folderCounts, setFolderCounts] = useState<Record<Folder, number>>({
    reply_needed: 0, uncertain: 0, all: 0, marketing: 0, following: 0, spam: 0, archived: 0,
  });
  const [accounts, setAccounts] = useState<MailAccount[]>([]);
  const [labelMaster, setLabelMaster] = useState<MailLabel[]>([]);
  // 라벨(태그)·프로젝트 필터 — 태그는 스레드에 붙는 진짜 태그이고, 여기서 리스트 필터로도 쓴다.
  // 프로젝트/채팅방 연결은 우측 맥락 패널에서 걸고, 이 셀렉트로 "그 프로젝트 메일만" 볼 수 있다.
  const [labelFilter, setLabelFilter] = useState<string>('');
  const [projectFilter, setProjectFilter] = useState<number>(0);
  const [projectOpts, setProjectOpts] = useState<Array<{ id: number; name: string }>>([]);
  const [frameH, setFrameH] = useState<Record<number, number>>({});
  const [members, setMembers] = useState<MailMember[]>([]);
  // 메일 검색 (제목·미리보기·본문) — 300ms 디바운스
  const [searchQ, setSearchQ] = useState('');
  const [qDebounced, setQDebounced] = useState('');
  useEffect(() => { const id = window.setTimeout(() => setQDebounced(searchQ.trim()), 300); return () => window.clearTimeout(id); }, [searchQ]);
  // M4 — FAQ 자동 클러스터링 제안
  const [faqSuggestions, setFaqSuggestions] = useState<Array<{ id: number; question: string; answer: string; occurrence_count: number }>>([]);
  const [faqExpandId, setFaqExpandId] = useState<number | null>(null);
  const [faqBusyId, setFaqBusyId] = useState<number | null>(null);

  const setFolder = (f: Folder) => {
    const nsp = new URLSearchParams(sp);
    nsp.set('folder', f);
    nsp.delete('thread');
    setSp(nsp, { replace: true });
  };

  // 첫 화면은 "일이 있는 곳" 으로 — 답변 필요가 있으면 거기서 시작하고, 없으면 확인 권장.
  //   사람이 고른 탭에 내용이 있으면 그 선택을 존중한다(지난 선택 유지). 빈 탭에 떨어뜨리지 않는다.
  const autoFolderDone = useRef(false);
  useEffect(() => {
    if (autoFolderDone.current) return;
    if (sp.get('folder')) { autoFolderDone.current = true; return; }   // URL 로 명시했으면 건드리지 않음
    const counts = folderCounts;
    if (counts.reply_needed === 0 && counts.uncertain === 0) return;   // 아직 카운트 로딩 전
    autoFolderDone.current = true;
    const currentEmpty = (counts[folder] ?? 0) === 0;
    if (!currentEmpty) return;                                          // 지금 탭에 내용이 있으면 그대로
    const next: Folder = counts.reply_needed > 0 ? 'reply_needed' : 'uncertain';
    if (next !== folder) setFolder(next);
  }, [folderCounts, folder, sp]);


  const setActive = (id: number | null) => {
    const nsp = new URLSearchParams(sp);
    if (id === null || activeId === id) nsp.delete('thread');
    else nsp.set('thread', String(id));
    setSp(nsp, { replace: true });
  };

  // 계정 필터 토글 (재클릭 해제 — 공통 UX 규칙)
  const setAccount = (id: number | null) => {
    const nsp = new URLSearchParams(sp);
    // '전체'는 0 으로 명시한다 — 파라미터를 지우면 지난번 선택(localStorage)이 되살아나 되돌아간다.
    if (id === null || accountFilter === id) nsp.set('account', '0');
    else nsp.set('account', String(id));
    nsp.delete('thread');
    setSp(nsp, { replace: true });
  };

  // 폴더 list fetch (계정·라벨·프로젝트 필터 반영) — page 1 (replace). 무한스크롤은 loadMore 가 append.
  const PAGE_SIZE = 30;
  const filterQuery = useCallback(() => {
    let s2 = '';
    if (labelFilter) s2 += `&label=${encodeURIComponent(labelFilter)}`;
    if (projectFilter) s2 += `&project_id=${projectFilter}`;
    return s2;
  }, [labelFilter, projectFilter]);
  const loadList = useCallback(async () => {
    if (!businessId) return;
    setListLoading(true);
    setErrorMsg(null);
    try {
      const acctQ = accountFilter ? `&account_id=${accountFilter}` : '';
      const qP = qDebounced ? `&q=${encodeURIComponent(qDebounced)}` : '';
      const fP = filterQuery();
      const r = await apiFetch(`/api/businesses/${businessId}/email-threads?folder=${folder}&limit=${PAGE_SIZE}&page=1${acctQ}${qP}${fP}`);
      const j = await r.json();
      if (j.success) { setThreads(j.data || []); pageRef.current = 1; setHasMore(!!j.pagination?.has_more); }
      else setErrorMsg(j.message || (t('errors.loadList', { defaultValue: '인박스 로딩 실패' }) as string));
    } catch (e) {
      setErrorMsg((e as Error).message);
    } finally {
      setListLoading(false);
    }
  }, [businessId, folder, accountFilter, qDebounced, filterQuery, t]);

  // 무한스크롤 — 다음 페이지 append
  const loadMore = useCallback(async () => {
    if (!businessId || loadingMore || !hasMore) return;
    setLoadingMore(true);
    try {
      const next = pageRef.current + 1;
      const acctQ = accountFilter ? `&account_id=${accountFilter}` : '';
      const qP = qDebounced ? `&q=${encodeURIComponent(qDebounced)}` : '';
      const r = await apiFetch(`/api/businesses/${businessId}/email-threads?folder=${folder}&limit=${PAGE_SIZE}&page=${next}${acctQ}${qP}${filterQuery()}`);
      const j = await r.json();
      if (j.success) {
        const fresh: Thread[] = j.data || [];
        setThreads(prev => {
          const seen = new Set(prev.map(t => t.id));
          return [...prev, ...fresh.filter(t => !seen.has(t.id))];
        });
        pageRef.current = next;
        setHasMore(!!j.pagination?.has_more);
      }
    } catch { /* silent — 다음 스크롤에 재시도 */ } finally { setLoadingMore(false); }
  }, [businessId, folder, accountFilter, qDebounced, filterQuery, loadingMore, hasMore]);

  // 메일 계정 목록 (회사/개인 그룹 + unread)
  const loadAccounts = useCallback(async () => {
    if (!businessId) return;
    try {
      const r = await apiFetch(`/api/businesses/${businessId}/mail-accounts`);
      const j = await r.json();
      if (j.success) setAccounts(j.data || []);
    } catch { /* silent — 계정 그룹은 부가 */ }
  }, [businessId]);

  // 폴더 카운트 fetch (병렬)
  //   계정 필터를 같이 태운다 — 안 그러면 특정 주소를 골라도 탭 숫자는 전 계정 합계라
  //   "회사 메일만 보는데 개인 메일까지 센 숫자" 가 뜬다 (리스트와 숫자 불일치).
  const loadCounts = useCallback(async () => {
    if (!businessId) return;
    const acctQs = accountFilter ? `&account_id=${accountFilter}` : '';
    const results = await Promise.all(
      FOLDERS.map(async ({ key }) => {
        try {
          const r = await apiFetch(`/api/businesses/${businessId}/email-threads?folder=${key}&limit=1${acctQs}`);
          const j = await r.json();
          return [key, j.pagination?.total || 0] as [Folder, number];
        } catch { return [key, 0] as [Folder, number]; }
      })
    );
    setFolderCounts(Object.fromEntries(results) as Record<Folder, number>);
  }, [businessId, accountFilter]);

  // 라벨 마스터 + 멤버 (M3-B 라벨/할당용)
  const loadLabels = useCallback(async () => {
    if (!businessId) return;
    try {
      const j = await apiFetch(`/api/businesses/${businessId}/email-labels`).then(r => r.json());
      if (j.success) setLabelMaster(j.data || []);
    } catch { /* silent */ }
  }, [businessId]);
  // M4 — FAQ 제안 로드
  const loadFaqSuggestions = useCallback(async () => {
    if (!businessId) return;
    try {
      const j = await apiFetch(`/api/businesses/${businessId}/email-faq-suggestions`).then(r => r.json());
      if (j.success) setFaqSuggestions(j.data || []);
    } catch { /* silent */ }
  }, [businessId]);
  const acceptFaq = useCallback(async (id: number) => {
    if (!businessId) return;
    setFaqBusyId(id);
    try {
      const r = await apiFetch(`/api/businesses/${businessId}/email-faq-suggestions/${id}/accept`, { method: 'POST' });
      if (r.ok) setFaqSuggestions(prev => prev.filter(s => s.id !== id));
    } catch { /* silent */ } finally { setFaqBusyId(null); }
  }, [businessId]);
  const dismissFaq = useCallback(async (id: number) => {
    if (!businessId) return;
    setFaqBusyId(id);
    try {
      const r = await apiFetch(`/api/businesses/${businessId}/email-faq-suggestions/${id}/dismiss`, { method: 'POST' });
      if (r.ok) setFaqSuggestions(prev => prev.filter(s => s.id !== id));
    } catch { /* silent */ } finally { setFaqBusyId(null); }
  }, [businessId]);
  const loadMembers = useCallback(async () => {
    if (!businessId) return;
    try {
      const j = await apiFetch(`/api/businesses/${businessId}/members`).then(r => r.json());
      if (j.success) setMembers((j.data || []).map((m: { user_id: number; name?: string | null; User?: { name: string } }) => ({ user_id: m.user_id, name: m.name || m.User?.name || `#${m.user_id}` })));
    } catch { /* silent */ }
  }, [businessId]);

  // 스레드 부분 수정 (스타/라벨/보관) — 낙관적 갱신
  const patchThread = useCallback(async (id: number, patch: Record<string, unknown>) => {
    if (!businessId) return;
    setThreads(prev => prev.map(t => (t.id === id ? { ...t, ...patch } as Thread : t)));
    setDetail(prev => (prev && prev.id === id ? { ...prev, ...patch } as ThreadDetail : prev));
    try {
      await apiFetch(`/api/businesses/${businessId}/email-threads/${id}`, {
        method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(patch),
      });
      loadCounts();
    } catch { /* 실패 시 silentReload 로 복원 */ silentReloadRef.current?.(); }
  }, [businessId, loadCounts]);

  const toggleStar = useCallback((e: React.MouseEvent, th: Thread) => {
    e.stopPropagation();
    patchThread(th.id, { is_starred: !th.is_starred });
  }, [patchThread]);

  // 답변 필요 해제 — 밖(Gmail·맥 메일)에서 이미 답장했거나 답장이 불필요한 메일
  const [dismissingId, setDismissingId] = useState<number | null>(null);
  const dismissReply = useCallback(async (e: React.MouseEvent, threadId: number) => {
    e.stopPropagation();
    if (!businessId) return;
    setDismissingId(threadId);
    try {
      const r = await apiFetch(`/api/businesses/${businessId}/email-threads/${threadId}/dismiss-reply`, { method: 'POST' });
      if (!r.ok) throw new Error('dismiss_failed');
      setThreads(prev => prev.filter(x => x.id !== threadId));   // 답변 필요 폴더에서 즉시 제거
      loadCounts();
      window.dispatchEvent(new CustomEvent('inbox:refresh'));    // 사이드바 Q Mail 뱃지 즉시 갱신
    } catch { /* 실패 시 목록 유지 — 다음 로드에서 복원 */ }
    finally { setDismissingId(null); }
  }, [businessId, loadCounts]);

  // 라벨 토글 (상세) — 현재 라벨 배열에 추가/제거
  const toggleLabel = useCallback((name: string) => {
    if (!detail) return;
    const cur = detail.labels || [];
    const next = cur.includes(name) ? cur.filter(l => l !== name) : [...cur, name];
    patchThread(detail.id, { labels: next });
  }, [detail, patchThread]);

  // 팔로우 토글 (상세)
  const toggleFollow = useCallback(async () => {
    if (!detail || !businessId) return;
    const next = !detail.my_following;
    setDetail(prev => (prev ? { ...prev, my_following: next } : prev));
    try {
      await apiFetch(`/api/businesses/${businessId}/email-threads/${detail.id}/follow`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ follow: next }),
      });
      loadCounts();
    } catch { /* noop */ }
  }, [detail, businessId, loadCounts]);

  // 담당 토글 (상세) — 본인 ↔ 해제
  const toggleAssignMe = useCallback(async () => {
    if (!detail || !businessId || !myUserId) return;
    const mine = detail.assignee_user_id === myUserId;
    const uid = mine ? null : myUserId;
    setDetail(prev => (prev ? { ...prev, assignee_user_id: uid, assignee_name: mine ? null : (members.find(m => m.user_id === myUserId)?.name || null) } : prev));
    try {
      await apiFetch(`/api/businesses/${businessId}/email-threads/${detail.id}/assign`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ user_id: uid }),
      });
      loadCounts();
    } catch { /* noop */ }
  }, [detail, businessId, myUserId, members, loadCounts]);

  const labelColor = useCallback((name: string) => labelMaster.find(l => l.name === name)?.color || '#14B8A6', [labelMaster]);
  const assignOptions = useMemo(() => [
    { value: 0, label: t('actions.unassigned', { defaultValue: '담당 없음' }) as string },
    ...members.map(m => ({ value: m.user_id, label: m.name })),
  ], [members, t]);

  // 담당자 지정 (멤버 선택 — PlanQSelect)
  const assignTo = useCallback(async (uid: number | null) => {
    if (!detail || !businessId) return;
    setDetail(prev => (prev ? { ...prev, assignee_user_id: uid, assignee_name: uid ? (members.find(m => m.user_id === uid)?.name || null) : null } : prev));
    try {
      await apiFetch(`/api/businesses/${businessId}/email-threads/${detail.id}/assign`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ user_id: uid }),
      });
      loadCounts();
    } catch { /* noop */ }
  }, [detail, businessId, members, loadCounts]);

  // 새 라벨 생성 (마스터 추가 후 현재 스레드에 적용)
  const [newLabelName, setNewLabelName] = useState('');
  const [labelBusy, setLabelBusy] = useState(false);
  const createLabel = useCallback(async () => {
    const nm = newLabelName.trim();
    if (!nm || !businessId || labelBusy) return;
    setLabelBusy(true);
    try {
      const r = await apiFetch(`/api/businesses/${businessId}/email-labels`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ name: nm }),
      });
      const j = await r.json();
      if (j.success) {
        setLabelMaster(j.data || []);
        setNewLabelName('');
        if (detail && !(detail.labels || []).includes(nm)) toggleLabel(nm);
      }
    } catch { /* noop */ } finally { setLabelBusy(false); }
  }, [newLabelName, businessId, labelBusy, detail, toggleLabel]);


  // 스레드 detail fetch + auto mark-read
  const loadDetail = useCallback(async (id: number) => {
    if (!businessId) return;
    setDetailLoading(true);
    try {
      const r = await apiFetch(`/api/businesses/${businessId}/email-threads/${id}`);
      const j = await r.json();
      if (j.success) {
        setDetail(j.data);
        // 자동 읽음 처리 (unread_count 있을 때만)
        if (j.data.unread_count > 0) {
          await apiFetch(`/api/businesses/${businessId}/email-threads/${id}/mark-read`, { method: 'POST' });
          loadList();
          loadCounts();
        }
      }
    } catch (e) {
      setErrorMsg((e as Error).message);
    } finally {
      setDetailLoading(false);
    }
  }, [businessId, loadList, loadCounts]);

  useEffect(() => { loadList(); }, [loadList]);
  useEffect(() => { loadCounts(); }, [loadCounts]);
  useEffect(() => { loadAccounts(); }, [loadAccounts]);
  useEffect(() => { loadLabels(); }, [loadLabels]);
  useEffect(() => {
    if (!businessId) return;
    let alive = true;
    (async () => {
      try {
        const r = await apiFetch(`/api/projects/?business_id=${businessId}&status=active`);
        const j = await r.json();
        if (!alive || !j.success) return;
        setProjectOpts((j.data || []).map((p: { id: number; name: string }) => ({ id: p.id, name: p.name })));
      } catch { /* 필터는 부가 기능 — 실패해도 리스트는 뜬다 */ }
    })();
    return () => { alive = false; };
  }, [businessId]);
  // 메일 본문(iframe)은 내용만큼 커져야 한다 — 고정 높이면 긴 메일이 잘려 보인다.
  // sandbox 안(스크립트 격리)에서 높이만 postMessage 로 알려준다. 본문은 DOMPurify 로 정제된 것.
  useEffect(() => {
    const onMsg = (e: MessageEvent) => {
      const d = e.data as { planqMailFrame?: number; h?: number } | null;
      if (!d || typeof d.planqMailFrame !== 'number' || typeof d.h !== 'number') return;
      const id = d.planqMailFrame;
      const h = Math.min(Math.max(d.h, 80), 6000);
      setFrameH(prev => (prev[id] === h ? prev : { ...prev, [id]: h }));
    };
    window.addEventListener('message', onMsg);
    return () => window.removeEventListener('message', onMsg);
  }, []);
  useEffect(() => { loadMembers(); }, [loadMembers]);
  useEffect(() => { loadFaqSuggestions(); }, [loadFaqSuggestions]);
  useEffect(() => {
    if (activeId) loadDetail(activeId);
    else setDetail(null);
  }, [activeId, loadDetail]);

  const onMarkSpam = async () => {
    if (!detail || !businessId) return;
    const path = detail.status === 'spam' ? 'mark-not-spam' : 'mark-spam';
    try {
      const r = await apiFetch(`/api/businesses/${businessId}/email-threads/${detail.id}/${path}`, { method: 'POST' });
      const j = await r.json();
      if (j.success) {
        setActive(null);
        loadList();
        loadCounts();
      }
    } catch (e) {
      setErrorMsg((e as Error).message);
    }
  };

  // ── 실시간 silent 갱신 (socket / visibility) — 스피너 없이 list+counts+열린 detail 갱신
  const silentReload = useCallback(() => {
    loadList();
    loadCounts();
    loadAccounts();
    if (activeId) loadDetail(activeId);
  }, [loadList, loadCounts, loadAccounts, activeId, loadDetail]);
  const silentReloadRef = useRef(silentReload);
  useEffect(() => { silentReloadRef.current = silentReload; }, [silentReload]);

  useEffect(() => {
    if (!user || !businessId) return;
    let pending: number | null = null;
    const debounced = () => {
      if (pending) return;
      pending = window.setTimeout(() => { pending = null; silentReloadRef.current(); }, 250);
    };
    joinRoom(`business:${businessId}`);
    const offNew = onSocket('mail:new', debounced);
    const offUpdated = onSocket('mail:updated', debounced);
    const onLocal = () => debounced();
    window.addEventListener('mail:refresh', onLocal);
    return () => {
      if (pending) window.clearTimeout(pending);
      window.removeEventListener('mail:refresh', onLocal);
      leaveRoom(`business:${businessId}`);
      offNew(); offUpdated();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user?.id, businessId]);

  useVisibilityRefresh(useCallback(() => {
    silentReloadRef.current();
    const s = getSocket();
    if (s && !s.connected) s.connect();
  }, []));

  // ── 답장 컴포저 ──
  const [replyOpen, setReplyOpen] = useState(false);
  const [replyHtml, setReplyHtml] = useState('');
  const [replyUploads, setReplyUploads] = useState<File[]>([]);
  const [replyFileIds, setReplyFileIds] = useState<number[]>([]);
  const [sending, setSending] = useState(false);
  const [replyError, setReplyError] = useState<string | null>(null);
  const [aiBusy, setAiBusy] = useState(false);
  const [aiFaqSources, setAiFaqSources] = useState<string[]>([]); // M4 — AI 답변이 활용한 등록 FAQ

  // AI 답변 제안 (Cue) — 마지막 inbound 기반 초안 → 컴포저 채움
  const aiSuggest = useCallback(async () => {
    if (!detail || !businessId || aiBusy) return;
    setAiBusy(true);
    setReplyError(null);
    try {
      const r = await apiFetch(`/api/businesses/${businessId}/email-threads/${detail.id}/ai-suggest`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({}),
      });
      const j = await r.json();
      if (!j.success) {
        const map: Record<string, string> = {
          cue_usage_limit_exceeded: t('reply.aiLimitExceeded', { defaultValue: '이번 달 Cue 사용량을 모두 썼어요.' }) as string,
          ai_unavailable: t('reply.aiUnavailable', { defaultValue: 'AI 서비스를 잠시 사용할 수 없어요.' }) as string,
          no_inbound_message: t('reply.aiNoInbound', { defaultValue: '답장할 받은 메일이 없어요.' }) as string,
        };
        setReplyError(map[j.message] || (t('reply.aiFailed', { defaultValue: 'AI 제안 생성 실패' }) as string));
        return;
      }
      if (j.data?.suggestion) setReplyHtml(j.data.suggestion);
      setAiFaqSources(j.data?.faq_used ? (j.data.faq_sources || []) : []);
    } catch (e) {
      setReplyError((e as Error).message);
    } finally { setAiBusy(false); }
  }, [detail, businessId, aiBusy, t]);

  // 스레드 전환 시 컴포저 초기화 — 답장창은 닫힌 채로. 먼저 내용을 읽고, 답장하기를 누르면 열린다.
  useEffect(() => {
    setReplyOpen(false); setReplyHtml(''); setReplyUploads([]); setReplyFileIds([]); setReplyError(null); setAiFaqSources([]);
  }, [activeId]);

  // 임시저장(reply) — 답장 컴포저 열 때 해당 스레드 초안 복원 + 1.5s 디바운스 자동저장. 발송 시 삭제.
  const replyDraftReady = useRef(false);
  useEffect(() => {
    if (!replyOpen || !businessId || !activeId) { replyDraftReady.current = false; return; }
    replyDraftReady.current = false;
    apiFetch(`/api/businesses/${businessId}/email-drafts?thread_id=${activeId}`).then(r => r.json()).then(j => {
      const d = j?.data;
      if (d) {
        if (d.body_html) setReplyHtml(d.body_html);
        if (Array.isArray(d.attachment_file_ids) && d.attachment_file_ids.length) setReplyFileIds(d.attachment_file_ids);
      }
    }).catch(() => {}).finally(() => { replyDraftReady.current = true; });
  }, [replyOpen, businessId, activeId]);
  useEffect(() => {
    if (!replyOpen || !businessId || !activeId || !replyDraftReady.current) return;
    if (isEmptyHtml(replyHtml) && !replyFileIds.length) return;
    const tid = setTimeout(() => {
      apiFetch(`/api/businesses/${businessId}/email-drafts`, {
        method: 'PUT', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ thread_id: activeId, body_html: replyHtml, attachment_file_ids: replyFileIds }),
      }).catch(() => {});
    }, 1500);
    return () => clearTimeout(tid);
  }, [replyOpen, businessId, activeId, replyHtml, replyFileIds]);

  // 답장 받는 사람 힌트 (마지막 inbound 발신자)
  const replyToHint = useMemo(() => {
    if (!detail) return '';
    const lastInbound = [...detail.messages].reverse().find(m => m.direction === 'inbound');
    return lastInbound?.from_email || detail.client?.company_name || '';
  }, [detail]);

  const isEmptyHtml = (h: string) =>
    !h.replace(/<[^>]*>/g, '').replace(/&nbsp;/gi, ' ').trim();

  const sendReply = async () => {
    if (!detail || !businessId || sending) return;
    if (isEmptyHtml(replyHtml)) {
      setReplyError(t('reply.emptyBody', { defaultValue: '내용을 입력해 주세요' }) as string);
      return;
    }
    setSending(true);
    setReplyError(null);
    try {
      // 새 업로드 먼저 올려 file id 확보 → 기존 선택 파일과 합침
      const fileIds = [...replyFileIds];
      for (const f of replyUploads) {
        const up = await uploadMyFile(businessId, f);
        if (up.success && up.file) fileIds.push(Number(String(up.file.id).replace('direct-', '')));
        else throw new Error(up.message || (t('reply.uploadFailed', { defaultValue: '첨부 업로드 실패' }) as string));
      }
      const r = await apiFetch(`/api/businesses/${businessId}/email-threads/${detail.id}/messages`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ body_html: replyHtml, attachment_file_ids: fileIds }),
      });
      const j = await r.json();
      if (!j.success) throw new Error(j.message || (t('reply.sendFailed', { defaultValue: '발송 실패' }) as string));
      // 성공 — 답장 초안 삭제 + 컴포저 닫고 갱신 (성공 토스트 금지)
      apiFetch(`/api/businesses/${businessId}/email-drafts?thread_id=${detail.id}`, { method: 'DELETE' }).catch(() => {});
      setReplyOpen(false); setReplyHtml(''); setReplyUploads([]); setReplyFileIds([]);
      await loadDetail(detail.id);
      loadList();
      loadCounts();
    } catch (e) {
      setReplyError((e as Error).message);
    } finally {
      setSending(false);
    }
  };

  const onComposerKeyDown = (e: React.KeyboardEvent) => {
    if ((e.metaKey || e.ctrlKey) && e.key === 'Enter') {
      e.preventDefault();
      sendReply();
    }
  };

  // ── 새 메일 작성 (compose) ──
  // #130 — 좌측 리스트를 Q Note·Q docs 와 같은 표준으로: 300px 그리드 + 접기(태블릿/모바일 오버레이).
  const [sidebarCollapsed, setSidebarCollapsed] = useState<boolean>(() => (
    typeof window !== 'undefined' ? window.innerWidth < 900 : false
  ));
  const [viewportNarrow, setViewportNarrow] = useState<boolean>(() => (
    typeof window !== 'undefined' ? window.innerWidth <= 1024 : false
  ));
  useEffect(() => {
    const mql = window.matchMedia('(max-width: 1024px)');
    const handler = (e: MediaQueryListEvent | MediaQueryList) => setViewportNarrow('matches' in e ? e.matches : false);
    handler(mql);
    mql.addEventListener('change', handler);
    return () => mql.removeEventListener('change', handler);
  }, []);

  const [composeOpen, setComposeOpen] = useState(false);
  const [cAccountId, setCAccountId] = useState<number | null>(null);
  const [cTo, setCTo] = useState('');
  const [cSubject, setCSubject] = useState('');
  const [cBody, setCBody] = useState('');
  const [cUploads, setCUploads] = useState<File[]>([]);
  const [cFileIds, setCFileIds] = useState<number[]>([]);
  const [cSending, setCSending] = useState(false);
  const [cError, setCError] = useState<string | null>(null);
  // 전달(forward) 모드 — set 이면 compose 모달이 전달용. message_id 로 서버가 원본 첨부 재유지.
  const [fwdFromMsgId, setFwdFromMsgId] = useState<number | null>(null);
  const [fwdAttachCount, setFwdAttachCount] = useState(0);
  // 열 때 발신 계정 기본값 = 첫 계정
  useEffect(() => {
    if (composeOpen && cAccountId == null && accounts.length) setCAccountId(accounts[0].id);
  }, [composeOpen, cAccountId, accounts]);
  // #80 — 퀵메뉴 '+메일' 진입 시 작성 모달 자동 오픈
  useEffect(() => {
    if (sp.get('compose') === '1') {
      setComposeOpen(true);
      const next = new URLSearchParams(sp); next.delete('compose'); setSp(next, { replace: true });
    }
  }, [sp, setSp]);
  // 임시저장(compose) — 새 메일 모달 열 때 본인 초안 복원 + 입력 시 1.5s 디바운스 자동저장.
  //   forward 모드는 transient 라 제외. 발송 시 sendCompose 가 삭제.
  const composeDraftReady = useRef(false);
  useEffect(() => {
    if (!composeOpen || fwdFromMsgId || !businessId) { composeDraftReady.current = false; return; }
    composeDraftReady.current = false;
    apiFetch(`/api/businesses/${businessId}/email-drafts`).then(r => r.json()).then(j => {
      const d = j?.data;
      if (d) {
        if (Array.isArray(d.to_emails) && d.to_emails.length) setCTo(d.to_emails.join(', '));
        if (d.subject) setCSubject(d.subject);
        if (d.body_html) setCBody(d.body_html);
        if (Array.isArray(d.attachment_file_ids) && d.attachment_file_ids.length) setCFileIds(d.attachment_file_ids);
        if (d.account_id) setCAccountId(d.account_id);
      }
    }).catch(() => {}).finally(() => { composeDraftReady.current = true; });
  }, [composeOpen, fwdFromMsgId, businessId]);
  useEffect(() => {
    if (!composeOpen || fwdFromMsgId || !businessId || !composeDraftReady.current) return;
    if (!cTo.trim() && !cSubject.trim() && isEmptyHtml(cBody) && !cFileIds.length) return;
    const tid = setTimeout(() => {
      apiFetch(`/api/businesses/${businessId}/email-drafts`, {
        method: 'PUT', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ to_emails: cTo.split(/[,;\s]+/).map(s => s.trim()).filter(Boolean), subject: cSubject, body_html: cBody, attachment_file_ids: cFileIds, account_id: cAccountId }),
      }).catch(() => {});
    }, 1500);
    return () => clearTimeout(tid);
  }, [composeOpen, fwdFromMsgId, businessId, cTo, cSubject, cBody, cFileIds, cAccountId]);

  const composeAccountOptions = useMemo(
    () => accounts.map(a => ({ value: a.id, label: `${a.display_name || a.email}${a.is_personal ? ` (${t('account.personal', { defaultValue: '개인' })})` : ''}` })),
    [accounts, t],
  );
  // 모바일·태블릿(≤1024px) — 작업대는 오버레이 드로어로 연다.
  //   여태 $hideTablet 으로 통째로 숨겨서, 폰에서는 메일의 업무·메모·연결을 아예 쓸 수 없었다.
  const ctxNarrow = viewportNarrow;
  const [ctxOverlayOpen, setCtxOverlayOpen] = useState(false);
  useBodyScrollLock(ctxNarrow && ctxOverlayOpen);
  const closeCompose = () => {
    setComposeOpen(false); setCTo(''); setCSubject(''); setCBody(''); setCUploads([]); setCFileIds([]); setCError(null);
    setFwdFromMsgId(null); setFwdAttachCount(0);
  };
  // 전달 시작 — compose 모달을 전달 모드로 열고 제목/인용본문 prefill
  const startForward = (m: Message) => {
    const baseSubj = detail?.subject || '';
    const subj = /^fwd:/i.test(baseSubj.trim()) ? baseSubj : `Fwd: ${baseSubj}`;
    const fromLabel = m.direction === 'outbound'
      ? `${t('me', { defaultValue: '나' })} <${detail?.account?.email || ''}>`
      : `${m.from_name || ''} <${m.from_email || ''}>`;
    const header = `<br><br><div style="border-top:1px solid #E2E8F0;padding-top:10px;color:#64748B;font-size:13px">`
      + `---------- ${t('forward.quotedHeader', { defaultValue: '전달된 메시지' })} ----------<br>`
      + `${t('forward.from', { defaultValue: '보낸사람' })}: ${fromLabel}<br>`
      + `${t('forward.date', { defaultValue: '날짜' })}: ${formatDateTime(m.sent_at)}<br>`
      + `${t('forward.to', { defaultValue: '받는사람' })}: ${(m.to_emails || []).join(', ')}<br>`
      + `${t('forward.subject', { defaultValue: '제목' })}: ${baseSubj}</div><br>`;
    setFwdFromMsgId(m.id);
    setFwdAttachCount((m.attachments || []).length);
    setCTo(''); setCError(null);
    setCSubject(subj);
    setCBody(header + (m.body_html || m.body_text || ''));
    setComposeOpen(true);
  };
  const sendCompose = async () => {
    if (!businessId || cSending) return;
    if (!cTo.trim()) { setCError(t('compose.toRequired', { defaultValue: '받는 사람을 입력해 주세요' }) as string); return; }
    if (isEmptyHtml(cBody)) { setCError(t('compose.bodyRequired', { defaultValue: '내용을 입력해 주세요' }) as string); return; }
    const accId = cAccountId || accounts[0]?.id;
    if (!accId) { setCError(t('compose.noAccount', { defaultValue: '보낼 메일 계정이 없어요' }) as string); return; }
    setCSending(true); setCError(null);
    try {
      const fileIds = [...cFileIds];
      for (const f of cUploads) {
        const up = await uploadMyFile(businessId, f);
        if (up.success && up.file) fileIds.push(Number(String(up.file.id).replace('direct-', '')));
        else throw new Error(up.message || (t('reply.uploadFailed', { defaultValue: '첨부 업로드 실패' }) as string));
      }
      const to = cTo.split(/[,;\s]+/).map(s => s.trim()).filter(Boolean);
      const r = fwdFromMsgId && activeId
        ? await apiFetch(`/api/businesses/${businessId}/email-threads/${activeId}/forward`, {
          method: 'POST', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ account_id: accId, message_id: fwdFromMsgId, to, subject: cSubject, body_html: cBody, attachment_file_ids: fileIds }),
        })
        : await apiFetch(`/api/businesses/${businessId}/email-compose`, {
          method: 'POST', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ account_id: accId, to, subject: cSubject, body_html: cBody, attachment_file_ids: fileIds }),
        });
      const j = await r.json();
      if (!j.success) throw new Error(j.message || (t('compose.sendFailed', { defaultValue: '발송 실패' }) as string));
      // 발송 성공 — 새 메일 초안 삭제 (forward 는 초안 없음)
      if (!fwdFromMsgId) apiFetch(`/api/businesses/${businessId}/email-drafts`, { method: 'DELETE' }).catch(() => {});
      closeCompose();
      loadList(); loadCounts(); loadAccounts();
      if (j.data?.thread_id) setActive(j.data.thread_id);
    } catch (e) {
      setCError((e as Error).message);
    } finally { setCSending(false); }
  };

  if (!businessId) return <PageShell title="Q Mail"><Empty>{t('selectWorkspace', { defaultValue: '워크스페이스를 선택해 주세요.' }) as string}</Empty></PageShell>;

  // 3단 그리드 — 목록 | 상세 | 맥락.
  // 2열로 두면 맥락 패널이 갈 자리가 없어 상세를 덮고, 우측엔 화살표만 남는다
  // (#130 사이드바 통일 때 만든 회귀). 맥락은 스레드를 열었고 접지 않았을 때만 폭을 가진다.
  return (
    <PanelGridLayout
      $cols={[
        sidebarCollapsed ? '0px' : '300px',
        '1fr',
        (detail && businessId && !rightCollapsed) ? `${rightWidth}px` : '0px',
      ].join(' ')}
    >
      {/* #130 — 좌측 리스트: 300px 접이식 (여태 340px 고정·접기 없음이라 Q Mail 만 다른 화면처럼 보였다) */}
      {!sidebarCollapsed && viewportNarrow && <SidebarBackdrop onClick={() => setSidebarCollapsed(true)} />}
      {/* 좌측 리스트 접기 — Q Talk·Q docs·Q Task 와 같은 경계선 중앙 화살표 핸들 (공통 컴포넌트).
          여태 Q Mail 만 헤더 안 박스 버튼이라 다른 화면과 어긋나 있었다. */}
      <PanelEdgeHandle
        side="left"
        collapsed={sidebarCollapsed}
        onToggle={() => setSidebarCollapsed((v) => !v)}
        offset={sidebarCollapsed ? 0 : 300}
        labelCollapse={t('sidebar.collapse', { defaultValue: '목록 접기' }) as string}
        labelExpand={t('sidebar.expand', { defaultValue: '목록 열기' }) as string}
      />
      <CollapsibleSidebar $collapsed={sidebarCollapsed}>
        <PanelHeader>
          <PanelTitle>Q Mail</PanelTitle>
          <ComposeBtn type="button" onClick={() => setComposeOpen(true)} title={t('compose.new', { defaultValue: '새 메일' }) as string} aria-label={t('compose.new', { defaultValue: '새 메일' }) as string}>
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
              <line x1="12" y1="5" x2="12" y2="19" /><line x1="5" y1="12" x2="19" y2="12" />
            </svg>
          </ComposeBtn>
        </PanelHeader>
        <FolderTabs>
          {FOLDERS.map(({ key, defaultLabel }) => (
            <FolderTab key={key} type="button" $active={folder === key} onClick={() => setFolder(key)}>
              {t(`folders.${key}`, { defaultValue: defaultLabel }) as string}
              {folderCounts[key] > 0 && <TabCount $active={folder === key}>{folderCounts[key]}</TabCount>}
            </FolderTab>
          ))}
        </FolderTabs>
        <SearchRow>
          <SearchIcon viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <circle cx="11" cy="11" r="7" /><line x1="21" y1="21" x2="16.65" y2="16.65" />
          </SearchIcon>
          <SearchInput
            value={searchQ}
            onChange={(e) => setSearchQ(e.target.value)}
            placeholder={t('search.placeholder', { defaultValue: '메일 검색 (제목·내용)' }) as string}
            aria-label={t('search.placeholder', { defaultValue: '메일 검색' }) as string}
          />
          {searchQ && (
            <SearchClear type="button" onClick={() => setSearchQ('')} aria-label={t('search.clear', { defaultValue: '검색 지우기' }) as string}>×</SearchClear>
          )}
        </SearchRow>
        {/* 계정 선택 — 태그 나열 대신 셀렉트 (주소가 늘어나면 태그 줄이 길어져 검색줄을 밀어낸다).
            옆에 "계정 관리" 진입로. 선택은 저장돼 다시 들어와도 그대로 열린다. */}
        {accounts.length >= 1 && (
          <AcctFilterRow>
            <AcctSelectWrap>
              <PlanQSelect
                size="sm"
                isSearchable={accounts.length > 5}
                value={
                  accountFilter
                    ? (() => {
                        const a = accounts.find((x) => x.id === accountFilter);
                        return a
                          ? { value: a.id, label: `${a.is_personal ? (t('accounts.personal', { defaultValue: '개인' }) as string) : (t('accounts.team', { defaultValue: '회사' }) as string)} · ${a.email}` }
                          : null;
                      })()
                    : { value: 0, label: t('accounts.all', { defaultValue: '전체 메일함' }) as string }
                }
                onChange={(opt) => {
                  const v = Number((opt as { value?: number } | null)?.value || 0);
                  setAccount(v > 0 ? v : null);
                }}
                options={[
                  { value: 0, label: t('accounts.all', { defaultValue: '전체 메일함' }) as string },
                  ...accounts.map((a) => ({
                    value: a.id,
                    label: `${a.is_personal ? (t('accounts.personal', { defaultValue: '개인' }) as string) : (t('accounts.team', { defaultValue: '회사' }) as string)} · ${a.email}${a.unread > 0 ? ` (${a.unread})` : ''}`,
                  })),
                ]}
              />
            </AcctSelectWrap>
            <AcctManageChip
              type="button"
              onClick={() => navigate('/business/settings/mail-accounts')}
              title={t('accounts.manageTitle', { defaultValue: '메일 계정 추가·설정' }) as string}
            >
              {t('accounts.manage', { defaultValue: '계정 관리' }) as string}
            </AcctManageChip>
          </AcctFilterRow>
        )}
        {/* 태그(라벨)·프로젝트 필터 — 태그는 상세에서 붙이고 여기서 걸러 본다. 항상 "전체" 포함. */}
        {(labelMaster.length > 0 || projectOpts.length > 0) && (
          <AcctFilterRow>
            {labelMaster.length > 0 && (
              <AcctSelectWrap>
                <PlanQSelect
                  size="sm"
                  isSearchable={labelMaster.length > 5}
                  value={{
                    value: labelFilter,
                    label: labelFilter || (t('filters.allLabels', { defaultValue: '태그 전체' }) as string),
                  }}
                  onChange={(opt) => setLabelFilter(String((opt as { value?: string } | null)?.value || ''))}
                  options={[
                    { value: '', label: t('filters.allLabels', { defaultValue: '태그 전체' }) as string },
                    ...labelMaster.map((l) => ({ value: l.name, label: l.name })),
                  ]}
                />
              </AcctSelectWrap>
            )}
            {projectOpts.length > 0 && (
              <AcctSelectWrap>
                <PlanQSelect
                  size="sm"
                  isSearchable={projectOpts.length > 5}
                  value={{
                    value: projectFilter,
                    label: projectOpts.find((p) => p.id === projectFilter)?.name
                      || (t('filters.allProjects', { defaultValue: '프로젝트 전체' }) as string),
                  }}
                  onChange={(opt) => setProjectFilter(Number((opt as { value?: number } | null)?.value || 0))}
                  options={[
                    { value: 0, label: t('filters.allProjects', { defaultValue: '프로젝트 전체' }) as string },
                    ...projectOpts.map((p) => ({ value: p.id, label: p.name })),
                  ]}
                />
              </AcctSelectWrap>
            )}
          </AcctFilterRow>
        )}
          {faqSuggestions.length > 0 && (
            <FaqSuggestBox>
              <FaqSuggestHead>
                {t('faq.title', { defaultValue: 'FAQ 후보' }) as string}
                <FaqCount>{faqSuggestions.length}</FaqCount>
              </FaqSuggestHead>
              {faqSuggestions.slice(0, 5).map(s => (
                <FaqItem key={s.id}>
                  <FaqQ type="button" onClick={() => setFaqExpandId(faqExpandId === s.id ? null : s.id)}>
                    <FaqQText>{s.question}</FaqQText>
                    <FaqOcc>{t('faq.occurrence', { count: s.occurrence_count, defaultValue: `${s.occurrence_count}건` }) as string}</FaqOcc>
                  </FaqQ>
                  {faqExpandId === s.id && <FaqAnswer>{s.answer}</FaqAnswer>}
                  <FaqActions>
                    <FaqRegisterBtn type="button" disabled={faqBusyId === s.id} onClick={() => acceptFaq(s.id)}>
                      {t('faq.register', { defaultValue: '등록' }) as string}
                    </FaqRegisterBtn>
                    <FaqDismissBtn type="button" disabled={faqBusyId === s.id} onClick={() => dismissFaq(s.id)}>
                      {t('faq.dismiss', { defaultValue: '무시' }) as string}
                    </FaqDismissBtn>
                  </FaqActions>
                </FaqItem>
              ))}
            </FaqSuggestBox>
          )}
          {errorMsg && <ErrorBar>{errorMsg}</ErrorBar>}
          {listLoading && threads.length === 0 ? (
            <Loading>
              <Spinner />
              {t('loading', { defaultValue: '불러오는 중…' }) as string}
            </Loading>
          ) : (accounts.length === 0 && !qDebounced) ? (
            /* 운영 #55 — 연결된 메일 계정이 없을 때: 어디서·어떻게 가져오는지 명확히 안내 + 연결 CTA */
            <EmptyList>
              <EmptyIcon viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5">
                <path d="M22 6l-10 7L2 6" /><rect x="2" y="4" width="20" height="16" rx="2" />
              </EmptyIcon>
              <EmptyText>{t('noAccount.title', { defaultValue: '아직 연결된 메일 계정이 없어요' }) as string}</EmptyText>
              <NoAcctHint>{t('noAccount.desc', { defaultValue: 'Gmail 또는 IMAP 메일 계정을 연결하면 Q Mail에서 받은 메일을 함께 보고 답장할 수 있어요. 여러 계정을 연결하면 주소별로도 볼 수 있어요.' }) as string}</NoAcctHint>
              <NoAcctBtn type="button" onClick={() => navigate('/business/settings/mail-accounts')}>
                {t('noAccount.cta', { defaultValue: '메일 계정 연결하기' }) as string}
              </NoAcctBtn>
            </EmptyList>
          ) : threads.length === 0 ? (
            <EmptyList>
              <EmptyIcon viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5">
                <path d="M22 6l-10 7L2 6" /><rect x="2" y="4" width="20" height="16" rx="2" />
              </EmptyIcon>
              <EmptyText>{qDebounced
                ? (t('search.empty', { defaultValue: '검색 결과가 없어요' }) as string)
                : (t('emptyFolder', { defaultValue: '이 폴더에 메일이 없어요' }) as string)}</EmptyText>
            </EmptyList>
          ) : (
            <ThreadList onScroll={(e) => {
              const el = e.currentTarget;
              if (hasMore && !loadingMore && el.scrollHeight - el.scrollTop - el.clientHeight < 300) loadMore();
            }}>
              {threads.map(mt => (
                <ThreadItem
                  key={mt.id}
                  type="button"
                  $active={activeId === mt.id}
                  $unread={mt.unread_count > 0}
                  onClick={() => setActive(mt.id)}
                >
                  <ThreadRow1>
                    <ThreadSender>
                      {/* 보낸 사람 = 실제 발신자(메일 헤더의 이름). 여태 내 메일함 이름
                          (account.display_name)을 그려서 PlanQ 알림이 내 계정명으로 보였다.
                          연결된 고객 이름도 발신자를 가리면 안 된다 — 고객 연결은 별도 칩으로 표시된다. */}
                      {mt.counterpart?.name || mt.client?.display_name || mt.client?.company_name
                        || mt.counterpart?.email || mt.account?.email || '(unknown)'}
                    </ThreadSender>
                    <ThreadRow1Right>
                      <StarSpan
                        role="button"
                        aria-label={mt.is_starred
                          ? t('actions.unstar', { defaultValue: '별표 해제' }) as string
                          : t('actions.star', { defaultValue: '별표' }) as string}
                        $on={mt.is_starred}
                        onClick={(e) => toggleStar(e, mt)}
                      >{mt.is_starred ? '★' : '☆'}</StarSpan>
                      <ThreadTime>{formatTimeAgo(mt.last_message_at)}</ThreadTime>
                    </ThreadRow1Right>
                  </ThreadRow1>
                  <ThreadSubject $unread={mt.unread_count > 0}>
                    {mt.unread_count > 0 && <UnreadDot />}
                    {mt.subject || '(no subject)'}
                  </ThreadSubject>
                  {mt.last_message_preview && <ThreadPreview>{mt.last_message_preview}</ThreadPreview>}
                  {mt.status === 'uncertain' && (
                    <UncertainBadge>
                      ⚠ {t(`uncertain.${mt.uncertain_reason || 'review'}`, { defaultValue: t('uncertain.review', { defaultValue: '검토 권장' }) }) as string}
                    </UncertainBadge>
                  )}
                  {/* 학습된 규칙으로 자동 분류된 메일임을 밝힌다 — 사용자 모르게 걸러지면 안 된다.
                      규칙은 설정 > 메일 계정 > 메일 분류 규칙에서 확인·삭제할 수 있다. */}
                  {mt.rule_id && (
                    <RuleBadge title={t('rules.appliedHint', { defaultValue: '설정에서 이 규칙을 확인하고 지울 수 있습니다' }) as string}>
                      {t('rules.applied', { defaultValue: '규칙으로 자동 분류됨' })}
                    </RuleBadge>
                  )}
                  {/* 답변 필요 폴더 — 오래 방치된 문의를 눈에 띄게 하고, 밖(Gmail 등)에서 이미 답장한
                      메일을 사람이 직접 끌 수 있게 한다. 안 그러면 플래그가 영영 안 꺼져 지표가 죽는다. */}
                  {folder === 'reply_needed' && (
                    <ReplyRow>
                      {waitingDays(mt.reply_needed_at) >= 3 && (
                        <OverdueChip>
                          {t('reply.waitingDays', {
                            defaultValue: '{{n}}일 경과',
                            n: waitingDays(mt.reply_needed_at),
                          }) as string}
                        </OverdueChip>
                      )}
                      <DismissBtn
                        type="button"
                        disabled={dismissingId === mt.id}
                        onClick={(e) => dismissReply(e, mt.id)}
                      >
                        {t('reply.dismiss', { defaultValue: '답변 완료' }) as string}
                      </DismissBtn>
                    </ReplyRow>
                  )}
                  {mt.labels && mt.labels.length > 0 && (
                    <RowLabels>
                      {mt.labels.map(l => <LabelChip key={l} $color={labelColor(l)}>{l}</LabelChip>)}
                    </RowLabels>
                  )}
                </ThreadItem>
              ))}
              {loadingMore && <ListMoreRow><Spinner /></ListMoreRow>}
            </ThreadList>
          )}
        </CollapsibleSidebar>

        {/* 우: 상세 */}
        <Panel $grow $hideTablet $last={!detail}>
          {/* 태블릿 이하 전용 — 그 폭에서는 사이드바가 오버레이 드로어라 경계선 핸들이 없다.
              데스크탑 접기/펼치기는 PanelEdgeHandle 이 담당. */}
          {sidebarCollapsed && (
            <ExpandBtn
              type="button"
              onClick={() => setSidebarCollapsed(false)}
              title={t('sidebar.expand', { defaultValue: '목록 열기' }) as string}
              aria-label={t('sidebar.expand', { defaultValue: '목록 열기' }) as string}
            >
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><path d="M9 18l6-6-6-6" /></svg>
            </ExpandBtn>
          )}
          {detailLoading && !detail ? (
            <Loading><Spinner /></Loading>
          ) : !detail ? (
            /* 빈 상태 — Q docs·Q Note·Q Talk 와 같은 공통 EmptyState (여태 Q Mail 만 13px 회색 한 줄) */
            <EmptyState
              icon={(
                <svg width="36" height="36" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round">
                  <rect x="2" y="4" width="20" height="16" rx="2" /><path d="M22 6l-10 7L2 6" />
                </svg>
              )}
              title={t('empty.title', { defaultValue: '메일에서 시작해 보세요' }) as string}
              description={`${t('empty.line1', { defaultValue: '고객 문의 · 견적 요청 · 계약 회신 — 대화의 절반은 메일에서 옵니다.' }) as string}\n${t('empty.line2', { defaultValue: '왼쪽 목록에서 메일을 선택하거나, 새 메일을 보내보세요.' }) as string}`}
              ctaLabel={accounts.length > 0 ? (t('compose.new', { defaultValue: '새 메일' }) as string) : undefined}
              onCta={accounts.length > 0 ? () => setComposeOpen(true) : undefined}
            />
          ) : (
            <>
              <PanelHeader>
                <PanelSubTitle>{detail.subject || '(no subject)'}</PanelSubTitle>
                <DetailHeaderRight>
                  {detail.message_count > 1 && <MetaChip>{t('messageCount', { defaultValue: '{{n}}개 메시지', n: detail.message_count }) as string}</MetaChip>}
                  {detail.client && <MetaChip>{detail.client.display_name || detail.client.company_name}</MetaChip>}
                  <DangerBtn type="button" onClick={onMarkSpam}>
                    {detail.status === 'spam'
                      ? t('actions.notSpam', { defaultValue: '스팸 해제' }) as string
                      : t('actions.markSpam', { defaultValue: '스팸으로' }) as string}
                  </DangerBtn>
                </DetailHeaderRight>
              </PanelHeader>
              <DetailToolbar>
                <DetailControls>
                  <CtrlBtn type="button" $on={detail.is_starred} onClick={() => patchThread(detail.id, { is_starred: !detail.is_starred })}>
                    {detail.is_starred ? '★' : '☆'} {t('actions.star', { defaultValue: '별표' }) as string}
                  </CtrlBtn>
                  <CtrlBtn type="button" $on={!!detail.my_following} onClick={toggleFollow}>
                    {detail.my_following
                      ? t('actions.following', { defaultValue: '팔로우 중' }) as string
                      : t('actions.follow', { defaultValue: '팔로우' }) as string}
                  </CtrlBtn>
                  {myUserId && (
                    <CtrlBtn type="button" $on={detail.assignee_user_id === myUserId} onClick={toggleAssignMe}>
                      {detail.assignee_user_id === myUserId
                        ? t('actions.assignedToMe', { defaultValue: '내 담당 ✓' }) as string
                        : t('actions.assignMe', { defaultValue: '내가 담당' }) as string}
                    </CtrlBtn>
                  )}
                  <AssignWrap>
                    <PlanQSelect
                      size="sm"
                      value={assignOptions.find(o => o.value === (detail.assignee_user_id || 0))}
                      onChange={(opt: unknown) => { const v = (opt as { value?: number } | null)?.value || 0; assignTo(v > 0 ? v : null); }}
                      options={assignOptions}
                      isSearchable
                      menuPlacement="bottom"
                    />
                  </AssignWrap>
                </DetailControls>
                <DetailLabels>
                  {(detail.labels || []).map(l => (
                    <LabelChip key={l} $color={labelColor(l)} $clickable onClick={() => toggleLabel(l)} title={t('actions.removeLabel', { defaultValue: '라벨 제거' }) as string}>
                      {l} ✕
                    </LabelChip>
                  ))}
                  {labelMaster.filter(lm => !(detail.labels || []).includes(lm.name)).map(lm => (
                    <AddLabelChip key={lm.name} type="button" $color={lm.color} onClick={() => toggleLabel(lm.name)}>+ {lm.name}</AddLabelChip>
                  ))}
                  <NewLabelInput
                    value={newLabelName}
                    disabled={labelBusy}
                    onChange={(e) => setNewLabelName(e.target.value)}
                    onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); createLabel(); } }}
                    placeholder={t('actions.newLabel', { defaultValue: '+ 새 라벨' }) as string}
                  />
                </DetailLabels>
              </DetailToolbar>
              <MessagesScroll>
                {detail.messages.map(m => (
                  <MessageCard key={m.id} $outbound={m.direction === 'outbound'}>
                    <MessageHeader>
                      <MessageFrom>
                        {m.direction === 'outbound'
                          ? `${t('me', { defaultValue: '나' }) as string} <${detail.account?.email || ''}>`
                          : `${m.from_name || ''} <${m.from_email || ''}>`}
                      </MessageFrom>
                      <MsgHeaderRight>
                        <MessageTime>{formatTimeAgo(m.sent_at)}</MessageTime>
                        <MsgForwardBtn type="button" onClick={() => startForward(m)}
                          title={t('forward.button', { defaultValue: '전달' }) as string}
                          aria-label={t('forward.button', { defaultValue: '전달' }) as string}>
                          {t('forward.button', { defaultValue: '전달' }) as string}
                        </MsgForwardBtn>
                      </MsgHeaderRight>
                    </MessageHeader>
                    {/* 메일 본문은 원본 문서 그대로 보여준다 — 우리 CSS 를 덮어씌우면 가운데 정렬이 풀리고
                        배경이 사라지고 여백이 잘린다(메일 템플릿은 <style> + table + body bgcolor 로 짜여 있다).
                        sanitizeMailHtml 이 문서를 통째로 정화(script·on* 제거)하고, sandbox iframe
                        (allow-scripts 만, same-origin 없음)이 격리한다. 우리가 넣는 스크립트는 높이 보고 한 줄. */}
                    {m.body_html ? (
                      <MessageBodyFrame
                        sandbox="allow-scripts"
                        style={{ height: `${frameH[m.id] || 240}px` }}
                        srcDoc={buildMailSrcDoc(m.id, m.body_html)}
                        title={`message-${m.id}`}
                      />
                    ) : (
                      <MessageBodyText>{m.body_text || '(no content)'}</MessageBodyText>
                    )}
                    {m.attachments.length > 0 && (
                      <Attachments>
                        {m.attachments.map(a => (
                          <Attachment key={a.id}>
                            <ClipIcon viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M21.44 11.05l-9.19 9.19a6 6 0 0 1-8.49-8.49l9.19-9.19a4 4 0 0 1 5.66 5.66l-9.2 9.19a2 2 0 0 1-2.83-2.83l8.49-8.48"/></ClipIcon> {a.file_name} ({Math.round(a.file_size / 1024)} KB)
                          </Attachment>
                        ))}
                      </Attachments>
                    )}
                  </MessageCard>
                ))}
              </MessagesScroll>
              <DetailFooter>
                {!replyOpen ? (
                  <ReplyBar>
                    <ActionButton tone="primary" size="md" onClick={() => setReplyOpen(true)}>
                      {t('reply.button', { defaultValue: '답장하기' }) as string}
                    </ActionButton>
                    {/* AI 답변 초안 — 플랫폼 기능은 'AI' 로 통일한다 (Cue 는 팀원으로 존재할 때만 Cue).
                        여기서 바로 부르면 작성창이 초안이 채워진 채로 열린다. 자동·마케팅 메일에는 숨김. */}
                    {(!detail?.triage || detail.triage === 'human' || detail.triage === 'unknown') && (
                      <AiActionButton
                        size="md"
                        loading={aiBusy}
                        onClick={() => { setReplyOpen(true); aiSuggest(); }}
                        label={aiBusy
                          ? (t('reply.aiThinking', { defaultValue: 'AI 작성 중…' }) as string)
                          : (t('reply.aiDraft', { defaultValue: 'AI 답변 초안' }) as string)}
                        title={t('reply.aiHint', { defaultValue: 'AI 가 이 메일의 답장 초안을 써줍니다' }) as string}
                      />
                    )}
                  </ReplyBar>
                ) : (
                  <Composer onKeyDown={onComposerKeyDown}>
                    {replyToHint && (
                      <ComposerTo>
                        {t('reply.to', { defaultValue: '받는 사람' }) as string}: <strong>{replyToHint}</strong>
                      </ComposerTo>
                    )}
                    <RichEditor
                      value={replyHtml}
                      onChange={setReplyHtml}
                      placeholder={t('reply.placeholder', { defaultValue: '답장 내용을 입력하세요…' }) as string}
                    />
                    <AttachmentField
                      businessId={businessId}
                      uploads={replyUploads}
                      onUploadsChange={setReplyUploads}
                      existingFileIds={replyFileIds}
                      onExistingFileIdsChange={setReplyFileIds}
                    />
                    {replyError && <ComposerError>{replyError}</ComposerError>}
                    {aiFaqSources.length > 0 && (
                      <FaqUsedBadge title={aiFaqSources.join(', ')}>
                        {t('reply.faqUsed', { defaultValue: '등록된 FAQ 기반 답변' }) as string}
                        {aiFaqSources[0] ? ` · ${aiFaqSources[0]}` : ''}
                      </FaqUsedBadge>
                    )}
                    {/* 버튼 자리는 고정 — 좌측부터 [보내기] [AI] [취소]. 답장창을 열고 닫아도 좌우가 뒤바뀌지 않는다.
                        (여태 AI 가 왼쪽, 보내기/취소가 오른쪽 끝이라 열 때마다 위치가 바뀌어 보였다) */}
                    <ComposerActions>
                      <ActionButton tone="primary" size="md" loading={sending} onClick={sendReply}>
                        {t('reply.send', { defaultValue: '보내기' }) as string}
                      </ActionButton>
                      {(!detail?.triage || detail.triage === 'human' || detail.triage === 'unknown') ? (
                        <AiActionButton
                          size="md"
                          loading={aiBusy}
                          disabled={sending}
                          onClick={aiSuggest}
                          label={aiBusy
                            ? t('reply.aiThinking', { defaultValue: 'AI 작성 중…' }) as string
                            : (replyHtml.trim()
                                ? t('reply.aiRegenerate', { defaultValue: 'AI 초안 다시 생성' }) as string
                                : t('reply.aiSuggest', { defaultValue: 'AI 답변 초안' }) as string)}
                          title={t('reply.aiHint', { defaultValue: 'AI 가 이 메일의 답장 초안을 써줍니다' }) as string}
                        />
                      ) : (
                        <AiGatedHint>{t('reply.aiGated', { defaultValue: '자동·마케팅 메일에는 AI 답변을 제안하지 않아요' }) as string}</AiGatedHint>
                      )}
                      <ActionButton tone="secondary" size="md" onClick={() => setReplyOpen(false)} disabled={sending}>
                        {t('reply.cancel', { defaultValue: '취소' }) as string}
                      </ActionButton>
                    </ComposerActions>
                    <ComposerHint>{t('reply.shortcut', { defaultValue: '⌘/Ctrl + Enter 로 보내기' }) as string}</ComposerHint>
                  </Composer>
                )}
              </DetailFooter>
            </>
          )}
        </Panel>

        {/* 우측 맥락 패널 — Q Talk RightPanel 과 같은 경계선 핸들로 접기/펼치기 (⌘/ · Ctrl+\) */}
        {detail && businessId && (
          <PanelEdgeHandle
            side="right"
            collapsed={rightCollapsed}
            onToggle={toggleRightCollapsed}
            offset={rightCollapsed ? 0 : rightWidth}
            labelCollapse={`${t('context.collapse', { defaultValue: '맥락 패널 접기' }) as string} (⌘/)`}
            labelExpand={`${t('context.expand', { defaultValue: '맥락 패널 펼치기' }) as string} (⌘/)`}
          />
        )}
        {/* 작업대 — 데스크탑은 우측 컬럼, 태블릿·폰은 오버레이 드로어 (Q Task 와 같은 패턴) */}
        {detail && businessId && ctxNarrow && ctxOverlayOpen && (
          <CtxBackdrop onClick={() => setCtxOverlayOpen(false)} />
        )}
        {detail && businessId && ctxNarrow && (
          <FloatingPanelToggle
            open={ctxOverlayOpen}
            onToggle={() => setCtxOverlayOpen((v) => !v)}
            ariaLabel={t('context.panelTitle', { defaultValue: '맥락' }) as string}
          />
        )}
        {detail && businessId && ((!ctxNarrow && !rightCollapsed) || (ctxNarrow && ctxOverlayOpen)) && (
          <Panel $width={rightWidth} $last $relative $overlay={ctxNarrow}>
            {!ctxNarrow && <CtxResizeHandle onMouseDown={startRightResize} />}
            <PanelHeader>
              <PanelMetaTitle>{t('context.panelTitle', { defaultValue: '맥락' }) as string}</PanelMetaTitle>
            </PanelHeader>
            <MailContextPanel businessId={businessId} thread={detail} members={members} myUserId={myUserId} onLinked={() => loadDetail(detail.id)} />
          </Panel>
        )}

      {composeOpen && (
        <ComposeOverlay onMouseDown={closeCompose}>
          <ComposeModal onMouseDown={(e) => e.stopPropagation()}>
            <ComposeHead>
              <ComposeTitle>{t('compose.new', { defaultValue: '새 메일' }) as string}</ComposeTitle>
              <CloseBtn type="button" onClick={closeCompose} aria-label={t('common.close', { defaultValue: '닫기' }) as string}>✕</CloseBtn>
            </ComposeHead>
            <ComposeBody>
              {accounts.length > 1 && (
                <ComposeField>
                  <ComposeLabel>{t('compose.from', { defaultValue: '보내는 계정' }) as string}</ComposeLabel>
                  <PlanQSelect
                    size="sm"
                    value={composeAccountOptions.find(o => o.value === cAccountId)}
                    onChange={(opt: unknown) => { const v = (opt as { value?: number } | null)?.value; if (v) setCAccountId(Number(v)); }}
                    options={composeAccountOptions}
                    isSearchable={false}
                    menuPlacement="bottom"
                  />
                </ComposeField>
              )}
              <ComposeField>
                <ComposeLabel>{t('compose.to', { defaultValue: '받는 사람' }) as string}</ComposeLabel>
                <ComposeInput value={cTo} onChange={(e) => setCTo(e.target.value)} placeholder="name@example.com" inputMode="email" />
              </ComposeField>
              <ComposeField>
                <ComposeLabel>{t('compose.subject', { defaultValue: '제목' }) as string}</ComposeLabel>
                <ComposeInput value={cSubject} onChange={(e) => setCSubject(e.target.value)} placeholder={t('compose.subjectPh', { defaultValue: '제목을 입력하세요' }) as string} />
              </ComposeField>
              <RichEditor value={cBody} onChange={setCBody} placeholder={t('compose.bodyPh', { defaultValue: '메일 내용을 입력하세요…' }) as string} />
              {fwdFromMsgId && fwdAttachCount > 0 && (
                <FwdAttachHint><ClipIcon viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M21.44 11.05l-9.19 9.19a6 6 0 0 1-8.49-8.49l9.19-9.19a4 4 0 0 1 5.66 5.66l-9.2 9.19a2 2 0 0 1-2.83-2.83l8.49-8.48"/></ClipIcon> {t('forward.origAttach', { defaultValue: '원본 첨부 {{n}}개 포함', n: fwdAttachCount }) as string}</FwdAttachHint>
              )}
              <AttachmentField businessId={businessId} uploads={cUploads} onUploadsChange={setCUploads} existingFileIds={cFileIds} onExistingFileIdsChange={setCFileIds} />
              {cError && <ComposerError>{cError}</ComposerError>}
            </ComposeBody>
            <ComposeFoot>
              <ActionButton tone="secondary" size="md" onClick={closeCompose} disabled={cSending}>
                {t('compose.cancel', { defaultValue: '취소' }) as string}
              </ActionButton>
              <ActionButton tone="primary" size="md" loading={cSending} onClick={sendCompose}>
                {t('compose.send', { defaultValue: '보내기' }) as string}
              </ActionButton>
            </ComposeFoot>
          </ComposeModal>
        </ComposeOverlay>
      )}
    </PanelGridLayout>
  );
};

export default MailPage;

// ─────────────────────────────────────────────
// styles
// ─────────────────────────────────────────────
// Q Talk 의 Layout 과 동일 — flex row, full-bleed (PageShell·카드 X)
// 컨테이너·패널은 공통 components/Layout/PanelLayout 의 PanelLayout/Panel 사용 (통일)
// M4 — FAQ 자동 클러스터링 제안 (좌측 패널, 폴더 아래)
const FaqSuggestBox = styled.div`
  border-bottom: 1px solid #E2E8F0; background: rgba(244, 63, 94, 0.04);
  padding: 10px 12px 12px; display: flex; flex-direction: column; gap: 8px;
`;
const FaqSuggestHead = styled.div`
  display: flex; align-items: center; gap: 6px;
  font-size: 12px; font-weight: 700; color: #F43F5E;
`;
const FaqCount = styled.span`
  margin-left: auto; min-width: 18px; height: 18px; padding: 0 6px;
  border-radius: 8px; background: rgba(244, 63, 94, 0.15); color: #F43F5E;
  font-size: 11px; font-weight: 700; display: inline-flex; align-items: center; justify-content: center;
`;
const FaqItem = styled.div`
  background: #FFFFFF; border: 1px solid rgba(244, 63, 94, 0.22); border-radius: 10px;
  padding: 8px 10px; display: flex; flex-direction: column; gap: 6px;
`;
const FaqQ = styled.button`
  all: unset; cursor: pointer; display: flex; align-items: flex-start; gap: 6px;
`;
const FaqQText = styled.span`
  flex: 1; min-width: 0; font-size: 12px; font-weight: 600; color: #0F172A;
  line-height: 1.4; overflow: hidden; text-overflow: ellipsis; display: -webkit-box;
  -webkit-line-clamp: 2; -webkit-box-orient: vertical;
`;
const FaqOcc = styled.span`flex-shrink: 0; font-size: 11px; font-weight: 700; color: #F43F5E;`;
const FaqAnswer = styled.div`
  font-size: 12px; color: #475569; line-height: 1.5; white-space: pre-wrap;
  overflow-wrap: anywhere; background: #F8FAFC; border-radius: 6px; padding: 8px 10px;
  max-height: 160px; overflow-y: auto;
`;
const FaqActions = styled.div`display: flex; gap: 6px;`;
const FaqRegisterBtn = styled.button`
  flex: 1; height: 30px; border-radius: 6px; border: none; cursor: pointer;
  background: #0D9488; color: #FFFFFF; font-size: 12px; font-weight: 600;
  &:hover:not(:disabled) { background: #0F766E; }
  &:disabled { opacity: 0.5; cursor: not-allowed; }
`;
const FaqDismissBtn = styled.button`
  flex: 1; height: 30px; border-radius: 6px; cursor: pointer;
  background: #FFFFFF; color: #64748B; border: 1px solid #E2E8F0; font-size: 12px; font-weight: 600;
  &:hover:not(:disabled) { background: #F1F5F9; color: #0F172A; }
  &:disabled { opacity: 0.5; cursor: not-allowed; }
`;
// M4 — AI 답변이 등록 FAQ 를 활용했을 때 배지 (컴포저)
const FaqUsedBadge = styled.div`
  display: inline-flex; align-items: center; gap: 4px; align-self: flex-start;
  margin: 0 0 8px; padding: 4px 10px; border-radius: 999px;
  background: rgba(244, 63, 94, 0.08); color: #F43F5E;
  font-size: 11px; font-weight: 700; max-width: 100%;
  overflow: hidden; text-overflow: ellipsis; white-space: nowrap;
`;
// 폴더 탭 (답변필요/인박스/내담당/팔로우/스팸/보관) — 좌측 상단 가로 탭
const FolderTabs = styled.div`
  display: flex; gap: 2px;
  padding: 4px 8px 0;
  border-bottom: 1px solid #E2E8F0;
  overflow-x: auto;
  flex-shrink: 0;
  scrollbar-width: none;
  &::-webkit-scrollbar { display: none; }
`;
const FolderTab = styled.button<{ $active: boolean }>`
  display: inline-flex; align-items: center; gap: 5px;
  flex-shrink: 0;
  padding: 8px 10px 9px;
  border: none; background: transparent;
  font-size: 13px; font-weight: ${p => p.$active ? 700 : 500};
  color: ${p => p.$active ? '#0F766E' : '#64748B'};
  border-bottom: 2px solid ${p => p.$active ? '#14B8A6' : 'transparent'};
  cursor: pointer; white-space: nowrap;
  transition: color 0.12s;
  &:hover { color: #0F766E; }
`;
const TabCount = styled.span<{ $active: boolean }>`
  min-width: 16px; padding: 0 5px;
  background: ${p => p.$active ? '#14B8A6' : '#E2E8F0'};
  color: ${p => p.$active ? '#FFFFFF' : '#64748B'};
  font-size: 10px; font-weight: 700;
  border-radius: 999px; text-align: center;
`;
// 계정 필터 칩 (회사/개인) — 탭 아래
// 메일 검색창
const SearchRow = styled.div`
  display: flex; align-items: center; gap: 6px;
  margin: 8px 10px; padding: 0 10px;
  background: #F8FAFC; border: 1px solid #E2E8F0; border-radius: 8px;
  flex-shrink: 0;
  &:focus-within { border-color: #14B8A6; box-shadow: 0 0 0 3px rgba(20,184,166,0.1); }
`;
const SearchIcon = styled.svg`width: 15px; height: 15px; color: #94A3B8; flex-shrink: 0;`;
const SearchInput = styled.input`
  flex: 1; min-width: 0; border: none; background: transparent; outline: none;
  height: 34px; font-size: 13px; color: #0F172A; font-family: inherit;
  &::placeholder { color: #94A3B8; }
`;
const SearchClear = styled.button`
  flex-shrink: 0; border: none; background: transparent; cursor: pointer;
  color: #94A3B8; font-size: 18px; line-height: 1; padding: 0 2px;
  &:hover { color: #0F172A; }
`;
const AcctFilterRow = styled.div`
  display: flex; align-items: center; gap: 8px;
  padding: 0 14px 10px;
`;
const AcctSelectWrap = styled.div`flex: 1; min-width: 0;`;
// 회사 공용 / 개인 구분 배지 — 한 인박스에 두 성격이 섞이므로 칩에서 바로 구분되어야 한다
// 운영 #55 — 계정 관리(설정) 진입 칩 (dashed, 보조 액션)
const AcctManageChip = styled.button`
  padding: 3px 10px; border-radius: 999px;
  font-size: 11px; font-weight: 600; cursor: pointer;
  border: 1px dashed #CBD5E1; background: transparent; color: #64748B;
  margin-left: auto;
  &:hover { border-color: #14B8A6; color: #0F766E; }
`;
// 운영 #55 — 계정 미연결 빈 상태
const NoAcctHint = styled.div`
  font-size: 12px; color: #64748B; line-height: 1.6;
  max-width: 320px; text-align: center; margin-top: 6px;
`;
const NoAcctBtn = styled.button`
  margin-top: 16px; padding: 0 18px; height: 40px;
  background: #14B8A6; color: #FFFFFF; border: none; border-radius: 8px;
  font-size: 13px; font-weight: 700; cursor: pointer;
  &:hover { background: #0D9488; }
`;

// 새 메일 작성 버튼 — Q Talk NewChatBtn 과 동일값
const ExpandBtn = styled.button`
  position: absolute; top: 16px; left: 12px; z-index: 5;
  display: inline-flex; align-items: center; justify-content: center;
  width: 28px; height: 28px; padding: 0; border-radius: 8px;
  border: 1px solid #E2E8F0; background: #fff; color: #64748B; cursor: pointer;
  box-shadow: 0 1px 2px rgba(15,23,42,.05);
  &:hover { background: #F8FAFC; color: #0F172A; }
  @media (min-width: 1025px) { display: none; }
`;
const ComposeBtn = styled.button`
  width: 32px; height: 32px;
  display: inline-flex; align-items: center; justify-content: center;
  background: #14B8A6; border: none; border-radius: 8px;
  color: #FFFFFF; cursor: pointer;
  transition: background 0.15s; flex-shrink: 0;
  &:hover { background: #0D9488; }
  &:focus-visible { outline: 2px solid rgba(20, 184, 166, 0.3); outline-offset: 2px; }
`;
// 새 메일 작성 모달
const ComposeOverlay = styled.div`
  position: fixed; inset: 0; z-index: 1000;
  background: rgba(15, 23, 42, 0.45);
  display: flex; align-items: center; justify-content: center;
  padding: 20px;
  @media (max-width: 640px) { padding: 0; align-items: stretch; }
`;
const ComposeModal = styled.div`
  width: min(680px, 100%); max-height: 90vh;
  background: #FFFFFF; border-radius: 14px;
  box-shadow: 0 4px 12px rgba(15,23,42,0.06), 0 12px 40px rgba(15,23,42,0.18);
  display: flex; flex-direction: column; overflow: hidden;
  @media (max-width: 640px) { border-radius: 0; max-height: 100vh; height: 100vh; }
`;
const ComposeHead = styled.div`
  min-height: 60px; padding: 14px 20px;
  border-bottom: 1px solid #E2E8F0;
  display: flex; align-items: center; justify-content: space-between;
  flex-shrink: 0;
`;
const ComposeTitle = styled.h2`
  margin: 0; font-size: 18px; font-weight: 700; color: #0F172A; letter-spacing: -0.2px;
`;
const CloseBtn = styled.button`
  width: 30px; height: 30px; border: none; background: transparent;
  color: #94A3B8; font-size: 16px; cursor: pointer; border-radius: 8px;
  &:hover { background: #F1F5F9; color: #0F172A; }
`;
const FwdAttachHint = styled.div`font-size: 12px; color: #0F766E; background: #F0FDFA; border: 1px solid #CCFBF1; border-radius: 8px; padding: 8px 12px;`;
const ComposeBody = styled.div`
  padding: 16px 20px; overflow-y: auto;
  display: flex; flex-direction: column; gap: 12px;
`;
const ComposeField = styled.div`
  display: flex; flex-direction: column; gap: 4px;
`;
const ComposeLabel = styled.label`
  font-size: 12px; font-weight: 600; color: #64748B;
`;
const ComposeInput = styled.input`
  height: 40px; padding: 0 12px;
  border: 1px solid #E2E8F0; border-radius: 8px;
  font-size: 14px; color: #0F172A;
  &::placeholder { color: #94A3B8; }
  &:focus { outline: none; border-color: #14B8A6; box-shadow: 0 0 0 3px rgba(20,184,166,0.12); }
`;
const ComposeFoot = styled.div`
  padding: 12px 20px; border-top: 1px solid #E2E8F0;
  display: flex; align-items: center; justify-content: flex-end; gap: 8px;
  flex-shrink: 0;
`;
// Q Talk ChatList 와 동일 — 둥근 행이 측면 여백 갖도록 padding
const ListMoreRow = styled.div`
  display: flex; justify-content: center; align-items: center; padding: 12px 0;
`;
const ThreadList = styled.div`
  flex: 1; overflow-y: auto;
  padding: 6px 6px 12px;
  &::-webkit-scrollbar { width: 6px; }
  &::-webkit-scrollbar-thumb { background: #E2E8F0; border-radius: 3px; }
`;
// Q Talk ChatRow 정확값 — 둥근 행, active=#F0FDFA + inset 3px 0 0 #0D9488, hover #F8FAFC
const ThreadItem = styled.button<{ $active: boolean; $unread: boolean }>`
  display: block; width: 100%;
  padding: 10px 10px;
  margin: 2px 0;
  border-radius: 10px;
  border: none;
  background: ${p => p.$active ? '#F0FDFA' : 'transparent'};
  ${p => p.$active && 'box-shadow: inset 3px 0 0 #0D9488;'}
  text-align: left;
  cursor: pointer;
  transition: background 0.1s;
  &:hover { ${p => !p.$active && 'background: #F8FAFC;'} }
`;
const ThreadRow1 = styled.div`
  display: flex; justify-content: space-between; align-items: baseline;
  margin-bottom: 4px;
`;
const ThreadSender = styled.span`
  font-size: 13px; font-weight: 600; color: #0F172A;
  white-space: nowrap; overflow: hidden; text-overflow: ellipsis;
  max-width: 70%;
`;
const ThreadTime = styled.span`
  font-size: 11px; color: #94A3B8; flex-shrink: 0;
`;
const ThreadSubject = styled.div<{ $unread: boolean }>`
  display: flex; align-items: center; gap: 6px;
  font-size: 13px;
  font-weight: ${p => p.$unread ? 600 : 500};
  color: #334155;
  margin-bottom: 2px;
  white-space: nowrap; overflow: hidden; text-overflow: ellipsis;
`;
const UnreadDot = styled.span`
  display: inline-block; flex-shrink: 0;
  width: 8px; height: 8px; border-radius: 50%;
  background: #14B8A6;
`;
const ThreadPreview = styled.div`
  font-size: 12px; color: #64748B;
  line-height: 1.4;
  overflow: hidden; text-overflow: ellipsis;
  display: -webkit-box;
  -webkit-line-clamp: 2;
  -webkit-box-orient: vertical;
`;
// M3-B — 행 별표 + 라벨 칩
const ThreadRow1Right = styled.span`
  display: inline-flex; align-items: center; gap: 6px; flex-shrink: 0;
`;
const StarSpan = styled.span<{ $on: boolean }>`
  font-size: 14px; line-height: 1; cursor: pointer;
  color: ${p => p.$on ? '#F59E0B' : '#CBD5E1'};
  &:hover { color: ${p => p.$on ? '#D97706' : '#94A3B8'}; }
`;
const RowLabels = styled.div`
  display: flex; flex-wrap: wrap; gap: 4px; margin-top: 4px;
`;
// M5 — Uncertain(확인 권장) 사유 배지 (Warning amber)
const ReplyRow = styled.div`
  display: flex; align-items: center; gap: 6px; margin-top: 6px;
`;
const OverdueChip = styled.span`
  font-size: 10px; font-weight: 700; color: #B91C1C; background: #FEF2F2;
  border: 1px solid #FECACA; border-radius: 999px; padding: 1px 7px;
`;
const DismissBtn = styled.button`
  margin-left: auto;
  font-size: 10px; font-weight: 600; color: #64748B;
  background: #FFFFFF; border: 1px solid #E2E8F0; border-radius: 6px;
  padding: 2px 8px; cursor: pointer;
  &:hover:not(:disabled) { border-color: #14B8A6; color: #0F766E; background: #F0FDFA; }
  &:disabled { opacity: 0.5; cursor: wait; }
`;
const RuleBadge = styled.span`
  display: inline-flex; align-items: center; align-self: flex-start;
  margin-top: 4px; padding: 2px 8px; border-radius: 999px;
  background: #F1F5F9; color: #64748B; font-size: 11px; font-weight: 600;
`;
const UncertainBadge = styled.span`
  display: inline-flex; align-items: center; gap: 3px; align-self: flex-start;
  margin-top: 4px; padding: 2px 8px; border-radius: 999px;
  background: rgba(245, 158, 11, 0.13); color: #92400E;
  font-size: 11px; font-weight: 700;
`;
const LabelChip = styled.span<{ $color: string; $clickable?: boolean }>`
  display: inline-flex; align-items: center; gap: 3px;
  padding: 1px 8px; border-radius: 999px;
  font-size: 11px; font-weight: 600;
  color: ${p => p.$color};
  background: ${p => p.$color}1A;
  border: 1px solid ${p => p.$color}55;
  cursor: ${p => p.$clickable ? 'pointer' : 'default'};
`;

// 상세 헤더 우측 (메시지 수·고객 칩 + 스팸) — PanelHeader 안 오른쪽 슬롯
const DetailHeaderRight = styled.div`
  display: flex; align-items: center; gap: 8px; flex-wrap: wrap;
  flex-shrink: 0;
`;
// 맥락 패널 좌측 리사이즈 핸들 (Q Task 패턴 통일)
const CtxResizeHandle = styled.div`
  position: absolute; top: 0; left: -3px; width: 6px; height: 100%;
  cursor: col-resize; z-index: 5;
  &:hover { background: rgba(20,184,166,0.2); }
  &:active { background: rgba(20,184,166,0.4); }
  @media (max-width: 1024px) { display: none; }
`;
// 상세 부가 툴바 (컨트롤·라벨) — PanelHeader 아래 별도 줄
const DetailToolbar = styled.div`
  padding: 12px 20px;
  border-bottom: 1px solid #F1F5F9;
  background: #FFFFFF;
`;
const MetaChip = styled.span`
  padding: 2px 8px;
  background: #F1F5F9; color: #475569;
  font-size: 11px; font-weight: 500;
  border-radius: 999px;
`;
// M3-B — 상세 헤더 컨트롤 (별표/팔로우/담당) + 라벨
const DetailControls = styled.div`
  display: flex; align-items: center; gap: 6px; flex-wrap: wrap;
  margin-top: 0;
`;
const CtrlBtn = styled.button<{ $on: boolean }>`
  height: 28px; padding: 0 12px;
  border-radius: 999px;
  font-size: 12px; font-weight: 600;
  cursor: pointer;
  border: 1px solid ${p => p.$on ? '#5EEAD4' : '#E2E8F0'};
  background: ${p => p.$on ? '#F0FDFA' : '#FFFFFF'};
  color: ${p => p.$on ? '#0F766E' : '#64748B'};
  transition: background 0.12s, border-color 0.12s;
  &:hover { border-color: #5EEAD4; }
  &:focus-visible { outline: 2px solid #5EEAD4; outline-offset: 2px; }
`;
const DetailLabels = styled.div`
  display: flex; flex-wrap: wrap; gap: 6px; margin-top: 10px;
`;
const AddLabelChip = styled.button<{ $color: string }>`
  padding: 2px 10px; border-radius: 999px;
  font-size: 11px; font-weight: 600;
  cursor: pointer;
  color: ${p => p.$color};
  background: #FFFFFF;
  border: 1px dashed ${p => p.$color}88;
  &:hover { background: ${p => p.$color}12; }
`;
const NewLabelInput = styled.input`
  height: 24px; padding: 0 10px;
  border: 1px dashed #CBD5E1; border-radius: 999px;
  font-size: 11px; color: #334155;
  width: 96px;
  &::placeholder { color: #94A3B8; }
  &:focus { outline: none; border-color: #14B8A6; border-style: solid; }
  &:disabled { opacity: 0.5; }
`;
const AssignWrap = styled.div`
  min-width: 150px;
`;
const DangerBtn = styled.button`
  margin-left: auto;
  height: 28px; padding: 0 12px;
  background: transparent; color: #B91C1C;
  border: 1px solid #FECACA; border-radius: 6px;
  font-size: 12px; font-weight: 600;
  cursor: pointer;
  &:hover { background: #FEF2F2; border-color: #FCA5A5; color: #991B1B; }
`;

// 메일 본문은 상세 패널(이미 카드) 안에서 또 카드로 감싸지 않는다 — 읽는 화면은 넓고 평평해야 한다.
// 메시지끼리는 구분선으로만 나누고, 내가 보낸 메일은 좌측 민트 라인 + 옅은 배경으로만 구분한다.
// 본문 iframe 은 내용 높이만큼 늘어나고, 길어지면 이 스크롤러가 끝까지 스크롤한다.
const MessagesScroll = styled.div`
  flex: 1; min-height: 0; overflow-y: auto;
  padding: 0 24px 24px;
  background: #FFFFFF;
  @media (max-width: 640px) { padding: 0 16px 16px; }
`;
const MessageCard = styled.div<{ $outbound: boolean }>`
  background: ${p => p.$outbound ? '#F8FDFC' : 'transparent'};
  border-left: ${p => p.$outbound ? '3px solid #5EEAD4' : 'none'};
  padding-left: ${p => p.$outbound ? '13px' : '0'};
  border-bottom: 1px solid #E2E8F0;
  padding-bottom: 12px;
  &:last-child { border-bottom: none; padding-bottom: 0; }
`;
const MessageHeader = styled.div`
  display: flex; justify-content: space-between; align-items: baseline; gap: 12px;
  padding: 16px 0 8px;
  background: transparent;
`;
const MsgHeaderRight = styled.div`display: flex; align-items: center; gap: 10px; flex-shrink: 0;`;
const MsgForwardBtn = styled.button`
  background: transparent; border: 1px solid #E2E8F0; color: #475569;
  padding: 3px 10px; border-radius: 6px; font-size: 11px; font-weight: 600; cursor: pointer;
  transition: background 0.15s, border-color 0.15s;
  &:hover { background: #F0FDFA; border-color: #99F6E4; color: #0F766E; }
`;
const MessageFrom = styled.div`
  font-size: 13px; font-weight: 600; color: #0F172A;
`;
const MessageTime = styled.div`
  font-size: 11px; color: #94A3B8;
`;
const MessageBodyFrame = styled.iframe`
  width: 100%;
  min-height: 120px;
  border: none;
  display: block;
  background: transparent;
`;
const MessageBodyText = styled.div`
  padding: 4px 0 8px;
  font-size: 14px; color: #334155;
  white-space: pre-wrap;
  font-family: -apple-system, sans-serif;
  line-height: 1.6;
`;
const Attachments = styled.div`
  padding: 10px 0 2px;
  border-top: 1px solid #F1F5F9;
  display: flex; flex-direction: column; gap: 4px;
`;
const Attachment = styled.div`
  font-size: 12px; color: #475569;
`;
// 하단 액션 영역 — 본문과 같은 흰 바탕. 회색/흰 박스를 겹쳐 띄우지 않는다(박스 속 박스 금지).
const DetailFooter = styled.div`
  padding: 14px 24px;
  border-top: 1px solid #E2E8F0;
  background: #FFFFFF;
  max-height: 55vh;
  overflow-y: auto;
`;
const ReplyBar = styled.div`
  display: flex; align-items: center; justify-content: flex-start; gap: 8px;
  padding: 0; border: none; background: transparent;
`;
const Composer = styled.div`
  display: flex; flex-direction: column; gap: 10px;
`;
const ComposerTo = styled.div`
  font-size: 12px; color: #64748B;
  strong { color: #0F172A; font-weight: 600; }
`;
const ComposerError = styled.div`
  padding: 8px 10px;
  background: #FEF2F2; color: #B91C1C;
  border: 1px solid #FECACA; border-radius: 8px;
  font-size: 12px;
`;
// 좌측 정렬 고정 — [보내기] [AI] [취소]. 버튼이 좌우로 튀지 않게 space-between 을 쓰지 않는다.
const ComposerActions = styled.div`
  display: flex; align-items: center; justify-content: flex-start; gap: 8px;
  flex-wrap: wrap;
`;
const ComposerHint = styled.div`
  font-size: 11px; color: #94A3B8;
`;
// AI 답변 제안 — Coral 강조 (AI 감지/액션 컬러)
// 자동·마케팅 메일 — AI 답변 비노출 안내 (게이트)
const AiGatedHint = styled.span`
  font-size: 12px; color: #94A3B8;
  display: inline-flex; align-items: center;
`;

const Loading = styled.div`
  display: flex; flex-direction: column; align-items: center; justify-content: center;
  padding: 60px 24px;
  font-size: 13px; color: #94A3B8;
  gap: 12px;
`;
const Spinner = styled.div`
  width: 24px; height: 24px;
  border: 2px solid #E2E8F0;
  border-top-color: #14B8A6;
  border-radius: 50%;
  animation: spin 0.8s linear infinite;
  @keyframes spin { to { transform: rotate(360deg); } }
`;
const ErrorBar = styled.div`
  margin: 12px 16px;
  padding: 10px 12px;
  background: #FEF2F2; color: #B91C1C;
  border: 1px solid #FECACA; border-radius: 8px;
  font-size: 12px;
`;
const EmptyList = styled.div`
  display: flex; flex-direction: column; align-items: center; justify-content: center;
  flex: 1; padding: 48px 24px; gap: 12px;
`;
const EmptyIcon = styled.svg`
  width: 48px; height: 48px;
  color: #CBD5E1;
`;
const EmptyText = styled.div`
  font-size: 13px; color: #64748B;
`;
const Empty = styled.div`
  padding: 60px 24px; text-align: center;
  font-size: 13px; color: #64748B;
`;

// 첨부 아이콘 — 이모지(📎) 대신 SVG (플랫폼 아이콘 통일, 폰트 의존 제거)
const ClipIcon = styled.svg`
  width: 13px; height: 13px; flex-shrink: 0; vertical-align: -2px; color: #64748B;
`;

// 작업대 오버레이 뒤 dim (태블릿·폰)
const CtxBackdrop = styled.div`
  position: fixed; inset: 0; z-index: 40;
  background: rgba(15, 23, 42, 0.35);
  @media (min-width: 1025px) { display: none; }
`;
