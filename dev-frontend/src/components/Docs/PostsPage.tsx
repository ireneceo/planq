// 문서(포스팅) 공용 페이지 — 워크스페이스·프로젝트 공용
// 레이아웃 패턴: Q Note 와 동일 (Sidebar + Content 2컬럼 + PanelHeader)
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
// 연결 입력 문구는 한 곳에서 온다 (화면마다 적으면 갈라진다)
import { CONNECT_PROMPT } from '../../components/Common/connectPrompts';
import { useVisibilityRefresh } from '../../hooks/useVisibilityRefresh';
import { useRevealSelectedRow } from '../../hooks/useRevealSelectedRow';
import { joinRoom, leaveRoom, onSocket } from '../../services/socket';
import { useTranslation } from 'react-i18next';
import { postContentToHtml } from '../../utils/postContentHtml';
import { docHasContent } from '../../utils/docHasContent';
import { sanitizeRichText } from '../../utils/sanitizeHtml';
import HelpDot from '../Common/HelpDot';
import AiActionButton from '../Common/AiActionButton';
import SlotFormModal from './SlotFormModal';
import { displayName } from '../../utils/displayName';
import i18n from '../../i18n';
import { useSearchParams } from 'react-router-dom';
import DocCommentsSection from './DocCommentsSection';
import { useTabTitle } from '../../hooks/useTabTitle';
import { useTimeFormat } from '../../hooks/useTimeFormat';
import SearchBox from '../Common/SearchBox';
import HighlightText from '../Common/HighlightText';
import MatchReason from '../Common/MatchReason';
import PanelHeader, { PanelTitle, PanelSubTitle, BackChevron } from '../Layout/PanelHeader';
import { useFromActionHandoff, type FromActionHandoff } from '../../hooks/useFromActionHandoff';
import FromTaskBanner from '../Common/FromTaskBanner';
import LinkedTaskChips, { type LinkedTaskRef } from '../Common/LinkedTaskChips';
import DocTaskLinkField, { linkTask } from './DocTaskLinkField';
import OverflowMenu from '../Common/OverflowMenu';
import AttachmentField from '../Common/AttachmentField';
import CategoryCombobox from '../Common/CategoryCombobox';
import EmptyState from '../Common/EmptyState';
import { uploadMyFile, uploadProjectFile, updateFileVisibility } from '../../services/files';
import ConfirmDialog from '../Common/ConfirmDialog';
import TrashDrawer from '../Trash/TrashDrawer';
import TrashButton from '../Trash/TrashButton';
import PostEditor from './PostEditor';
import DocToc from './DocToc';
import PostTableGrid from './PostTableGrid';
import SurveyPanel, { type SurveyTab } from './Survey/SurveyPanel';
import SurveySendModal from './Survey/SurveySendModal';
import SurveyPreviewModal from './Survey/SurveyPreviewModal';
import { mapApiError } from '../../utils/apiError';
import { useFileDownload } from '../../hooks/useFileDownload';
import {
  fetchPosts, fetchPost, fetchPostResult, applyPostAiEdit, createPost, updatePost, deletePost, StaleEditError,
  attachToPost, detachFromPost, fetchPostsMeta,
  createCategory, renameCategory, deleteCategory,
  updatePostVisibility, updatePostSecurityLevel, downloadPostPdf,
  downloadPostDocx, getSignedHtml, duplicatePost,
  type PostRow, type PostDetail, type PostsMeta, type SignedDocView,
} from '../../services/posts';
import VisibilityChangeModal from '../Common/VisibilityChangeModal';
import DetailFallback from '../Common/DetailFallback';
import { isOtherWorkspace } from '../../utils/workspaceMatch';
import type { DetailStatus } from '../../hooks/useDetailResource';
import { listProjects, listWorkspaceClients, type ApiProject, type WorkspaceClientRow } from '../../services/qtalk';
import { listTemplates, aiGenerateDoc, type DocTemplate, type DocKind, KIND_LABELS_KO } from '../../services/docs';
import AiRegenerateBar from '../Common/AiRegenerateBar';
import KindIcon from './KindIcon';
import PostShareModal from './PostShareModal';
import KbAiIngestModal from '../../pages/Knowledge/KbAiIngestModal';
import PostAiModal from './PostAiModal';
// 프로젝트 문서 탭 — 파일 탭과 동일한 공용 레이아웃 (단일 원천). 파일탭·문서탭 디자인 통일.
import { ProjBrowse, Split as AtSplit, FolderTreePanel as AtPanel, FilesArea as AtArea, TreeRoot as AtTree, FolderRow as AtRow, FolderName as AtName, FolderCount as AtCount, Grid as AtGrid, Card as AtCard, CardName as AtCardName, CardMeta as AtCardMeta, Toolbar as AtToolbar, ToolbarRight as AtToolbarRight, SortWrap as AtSortWrap } from './assetTabLayout';
import PostSignatureModal from './PostSignatureModal';
import SignatureProgressSection from './SignatureProgressSection';
import PlanQSelect, { type PlanQSelectOption } from '../Common/PlanQSelect';
import ListSortSelect, { sortRows, LIST_SORT_DEFAULT, type ListSortKey } from '../Common/ListSortSelect';
import SecurityLevelBadge, { useSecurityLevelLabel } from '../Common/SecurityLevelBadge';
import { useAuth, apiFetch } from '../../contexts/AuthContext';
import { cacheKey, readCache, hasCache, writeCache } from '../../lib/pageCache';
import FloatingPanelToggle from '../Common/FloatingPanelToggle';
import PanelResizeHandle, { usePanelWidth } from '../Layout/PanelResizeHandle';
import { usePostPresence } from '../../hooks/usePostPresence';
import { useConflictStash, CoeditTypingNotice, ConflictStashNote, ConflictBar, SignLockedBar, PresenceChips } from './DocCoedit';
import PostHistoryPanel from './PostHistoryPanel';
import PostAiEditDrawer from './PostAiEditDrawer';
import { isEnterAction } from '../../utils/imeKey';
import { uploadErrorText } from '../../utils/uploadError';
import {
  PrintOnlyTitle, Layout, Sidebar, TitleGroup, HeaderBtnRow, NewBtn, NewBtnWrap, NewDropdown, NewItem, NewItemTitle, NewItemDesc, ModalBackdrop, ModalDialog, ModalHead, ModalTitle, ModalClose, ModalBody, ModalSub, TplGrid, TplCard, TplCardIcon, TplBadgeSys, TplSearchInput, PinDot, ParentLink, SaveTplField, SaveTplLabel, SaveTplError, ModalFooter, TplCardBody, TplCardName, TplCardDesc, Empty, SearchWrap, FilterSection, FilterGroupLabel, Chip, Count, ColorDot, AddCatBtn, NewCatInput, RowList, RowItem, RowPinBtn, RowTitle, RowPreview, CardPreview, CardAuthor, RowVisChip, SectionGap, AiRegenRow, KindToggle, KindBtn, ShareMini, RowMeta, Dim, Content, StickyBands, StickyPanelHeader, Body, EditBody, TitleInput, AutoSaveMark, WideOnly, PhoneOnly, AutoSaveText, DraftTag, ViewMeta, MetaLeft, MetaRight, AiEditDoneBar, AiEditUndoBtn, AiEditCloseBtn, MetaActions, HeaderActions, PinTag, ProjectTag, CategoryTag, MetaField, MetaRow, MetaSummaryBtn, MetaSummaryLabel, MetaSummaryValue, MetaSummaryChevron, VisibilityChip, ShareTag, CategoryMini, AttachSection, AttachTitle, AttachScopeHint, AttachList, AttachRow, AttachName, RemoveBtn, CatActions, CatIconBtn, ErrorBar, DescAddBtn, DescToggleHeader, DescBoxLabel, DescChevron, PrimaryBtn, EditBtn, IconActionBtn, SignBtn, LeaveBlockedNote, SecondaryBtn, TitleRow, MobileBackBtn, KnowledgeToast, SignedBody,
} from './PostsPage.styles';

// 좌측 필터: 전체(기본) / 프로젝트 그룹 / 카테고리
// '내 문서'·'기본' 섹션은 제거. 상단 통합검색이 프로젝트명·제목·본문·카테고리를 모두 커버.
type FilterSel =
  | { kind: 'all' }
  | { kind: 'project'; projectId: number }
  | { kind: 'category'; name: string }
  /** #360 — 표만 모아 보는 진입로. 표는 문서 안에 있어 여태 찾아갈 길이 없었다. */
  | { kind: 'tables' }
  /** 설문 v2 — 설문만 모아 보기 */
  | { kind: 'surveys' };

export type PostsScope =
  | { type: 'workspace'; businessId: number }
  | { type: 'project'; businessId: number; projectId: number }
  | { type: 'personal'; businessId: number };  // N+30 — 개인 보관함 (본인 + vlevel=L1 + project_id=null)

interface Props {
  scope: PostsScope;
  /**
   * 문서 하나 고정 — 프로젝트 상세의 «메뉴에 추가한 문서» 탭(doc-:id).
   * 그 탭은 문서 탭 상세와 **같은 화면**(밴드·버튼·편집)이어야 한다 (2026-10-06 Irene:
   * "탭메뉴를 누르면 나오는 건 상세페이지야. 버튼도 그대로 나와야지"). 여태 그 탭은 본문만 베껴 그린
   * 축소판이라 표 설명·서명본·목차·첨부가 빠졌고, [편집] 은 문서 목록으로 튕겨 냈다.
   * 고정 모드에서는 목록으로 돌아가지 않고, 주소(?post)도 건드리지 않는다(주소는 탭 키 doc-:id 가 쥔다).
   */
  pinnedPostId?: number;
}

// 제목·카테고리에서 종류 추정 — 후속 액션 결정용
function inferKindFromTitle(title: string, category: string | null): 'contract' | 'nda' | 'sow' | 'proposal' | 'quote' | 'other' {
  const t = ((title || '') + ' ' + (category || '')).toLowerCase();
  if (/계약|contract/.test(t)) return 'contract';
  if (/nda|기밀|비밀유지/.test(t)) return 'nda';
  if (/sow|작업|명세/.test(t)) return 'sow';
  if (/제안|proposal/.test(t)) return 'proposal';
  if (/견적|quote|quotation/.test(t)) return 'quote';
  return 'other';
}

const PostsPage: React.FC<Props> = ({ scope, pinnedPostId }) => {
  const { t } = useTranslation('qdocs');
  const { t: tc } = useTranslation('common');   // 연결 문구 정본
  const { t: tErr } = useTranslation('errors');
  const { formatDate, formatTimeAgo } = useTimeFormat();
  // 목록 정렬 — 기본은 **작성일 최신순**(2026-10-06 Irene: "수정될 때 리스트 순서가 바뀌니까 이상해").
  //   그래서 날짜도 작성일을 보인다. «최근 수정순» 을 골랐을 때만 수정일을 «수정 …» 으로 말한다
  //   (2026-09-05: 날짜만 찍혀 있어 오래전 글이 "오늘 쓴 글" 로 읽혔다 — 그 이름 붙이기는 유지).
  const [listSort, setListSort] = useState<ListSortKey>(LIST_SORT_DEFAULT);
  const listDate = useCallback((row: { created_at?: string | null; updated_at?: string | null }) => {
    if (listSort !== 'updated') return row.created_at ? formatDate(row.created_at) : '';
    const created = row.created_at ? new Date(row.created_at).getTime() : 0;
    const updated = row.updated_at ? new Date(row.updated_at).getTime() : 0;
    // 생성 직후 몇 초 차이는 수정이 아니다(생성 트랜잭션·첨부 붙이기 등).
    const edited = created > 0 && updated > created + 60 * 1000;
    const shown = formatDate((edited ? row.updated_at : row.created_at) as string);
    return edited ? (t('list.editedAt', { date: shown, defaultValue: '수정 {{date}}' }) as string) : shown;
  }, [formatDate, t, listSort]);

  // 재진입 즉시 표시 — 같은 목록(범위+검색어+필터)이면 지난 결과로 먼저 그린다.
  //   검색어·필터를 키에 넣는 이유: 안 넣으면 "검색 결과가 잠깐 남아 있다가 바뀌는" 더 나쁜 화면이 된다.
  //   user 축 필수 — 개인 보관함(personal) 은 L1 개인자원이다.
  const { user: cacheUser } = useAuth();
  const postsKey = cacheKey(
    `posts:${scope.type}${scope.type === 'project' ? scope.projectId : ''}`,
    cacheUser?.id, scope.businessId,
  );
  // 첨부 다운로드 — 인증 fetch + 진행 표시 (링크 방식은 401)
  const dl = useFileDownload();
  const [rows, setRows] = useState<PostRow[]>(() => readCache<PostRow[]>(postsKey) ?? []);
  const [meta, setMeta] = useState<PostsMeta>({ total: 0, myCount: 0, categories: [], projects: [] });
  const [loading, setLoading] = useState(() => !hasCache(postsKey));
  const [query, setQuery] = useState('');
  const [searchParams, setSearchParams] = useSearchParams();
  const [filter, setFilter] = useState<FilterSel>(() => {
    // 워크스페이스 scope 진입 시 ?project=:id 쿼리 → 그 프로젝트 필터 자동 선택
    if (scope.type === 'workspace') {
      const pid = Number(searchParams.get('project'));
      if (Number.isFinite(pid) && pid > 0) return { kind: 'project', projectId: pid };
    }
    return { kind: 'all' };
  });
  // 검색·딥링크로 연 문서는 **목록에서도 보여야** 한다 (hooks/useRevealSelectedRow 주석)
  const pinned = !!pinnedPostId;
  const [activeId, setActiveId] = useState<number | null>(() => {
    if (pinnedPostId) return pinnedPostId;
    const v = Number(searchParams.get('post'));
    return Number.isFinite(v) && v > 0 ? v : null;
  });
  useRevealSelectedRow(activeId);

  // N+42 — Q Note 정리하기 → 정식 문서 승격 (?prefill_brief=text 으로 진입). 마운트 시 한 번만.
  useEffect(() => {
    if (briefPrefillAppliedRef.current) return;
    const text = searchParams.get('prefill_brief');
    const title = searchParams.get('prefill_brief_title');
    if (!text && !title) return;
    setAiInitialBriefText(text || '');
    setAiInitialBriefTitle((title || '').slice(0, 200));
    setAiDefaultMode('brief');
    setAiIntent('ai');
    setAiOpen(true);
    const next = new URLSearchParams(searchParams);
    next.delete('prefill_brief');
    next.delete('prefill_brief_title');
    setSearchParams(next, { replace: true });
    briefPrefillAppliedRef.current = true;
  }, [searchParams, setSearchParams]);
  // URL 싱크는 별도 effect 로 분리 — setActiveId 호출 흐름에 부수효과 안 만들도록.
  useEffect(() => {
    if (pinned) return;   // 고정 탭은 주소를 쥐지 않는다
    setSearchParams(prev => {
      const sp = new URLSearchParams(prev);
      const cur = sp.get('post');
      const next = activeId ? String(activeId) : null;
      if (cur === next) return prev; // 변화 없으면 스킵 (re-render 방지)
      if (next) sp.set('post', next); else sp.delete('post');
      return sp;
    }, { replace: true });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeId]);
  // URL(?post) → activeId 역방향 동기화. 탭 전환 등으로 외부에서 ?post 가 제거/변경되면 활성 문서도 따라감.
  //   (옛: 최초 1회만 읽어서, 문서 탭 클릭으로 ?post 지워도 상세에 남던 버그)
  useEffect(() => {
    if (pinned) return;
    const v = Number(searchParams.get('post'));
    const urlId = Number.isFinite(v) && v > 0 ? v : null;
    setActiveId(prev => (prev === urlId ? prev : urlId));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [searchParams]);
  const [detail, setDetail] = useState<PostDetail | null>(null);
  const [detailStatus, setDetailStatus] = useState<DetailStatus>('idle');
  // 다른 워크스페이스 문서를 ?post= 로 열었을 때 그 워크스페이스 — 내용 대신 전환 안내(DetailFallback other_workspace)
  const [otherWsBizId, setOtherWsBizId] = useState<number | null>(null);
  // 탭 이름 = 열려 있는 문서 이름 (목록만 보는 중이면 null → 'Q docs' 로 복귀).
  //   ★ 워크스페이스 scope 일 때만 — 이 컴포넌트는 프로젝트 상세(DocsTab)·개인 보관함 안에도
  //     임베드된다. 거기서도 제목을 쓰면 그 화면의 주인(프로젝트명)을 덮어써 지운다.
  useTabTitle(detail?.title, scope.type === 'workspace');
  // N+67 — visibility 변경 모달 + fetch context
  const [visModalOpen, setVisModalOpen] = useState(false);
  const [visProjects, setVisProjects] = useState<ApiProject[]>([]);
  const [visClients, setVisClients] = useState<WorkspaceClientRow[]>([]);
  const [visMembers, setVisMembers] = useState<Array<{ user_id: number; name: string; role: string }>>([]);
  // N+72 fix — 페이지 mount 시 즉시 fetch (detail null 이어도 OK).
  // 옛: deps=[detail?.business_id] 였는데 modal 열 시점에 visMembers=[] 회귀 (사용자 호소 "멤버 리스트에 안뜨던데").
  const visBizId = scope.type === 'project' ? scope.businessId : (scope.type === 'workspace' || scope.type === 'personal' ? scope.businessId : null);
  useEffect(() => {
    if (!visBizId) return;
    listProjects(visBizId).then(setVisProjects).catch(() => {});
    listWorkspaceClients(visBizId).then(c => setVisClients(c.filter(x => x.status !== 'archived'))).catch(() => {});
    apiFetch(`/api/businesses/${visBizId}/members`).then(r => r.json()).then(j => {
      if (j?.success && Array.isArray(j.data)) {
        setVisMembers(j.data
          .filter((m: { user?: { is_ai?: boolean }; role?: string }) => !m.user?.is_ai && m.role !== 'ai')
          .map((m: { user_id?: number; id?: number; user?: { id?: number; name?: string; display_name?: string | null }; name?: string; role?: string }) => ({
            user_id: m.user_id || m.id || m.user?.id || 0,
            // 워크스페이스 표시명(user.display_name) 우선 — 계정명 노출 방지 [[feedback_member_display_name_on_lists]]
            name: m.user?.display_name || m.name || m.user?.name || '—',
            role: m.role || 'member',
          })).filter((m: { user_id: number }) => m.user_id > 0));
      }
    }).catch(() => {});
  }, [visBizId]);
  // ★ 공개 범위는 **모르면 가장 넓은 이름을 말하면 안 된다.**
  //   옛 코드는 값을 못 읽으면 그대로 '워크스페이스' 로 떨어졌다 — 나만 보기 문서가 화면에서만
  //   전체 공개로 보일 수 있는 방향이다(공개 범위 표시에서 이 방향의 오답이 제일 나쁘다).
  //   알 수 없으면 알 수 없다고 말한다 (CLAUDE.md "알 수 없는 값은 보이게 렌더").
  const visLabel = (vl: string | null | undefined) => {
    if (vl === 'L1') return t('vis.L1', '나만') as string;
    if (vl === 'L2') return t('vis.L2', '팀') as string;
    if (vl === 'L3') return t('vis.L3', '워크스페이스') as string;
    if (vl === 'L4') return t('vis.L4', '외부') as string;
    return t('vis.unknown', { defaultValue: '확인 필요' }) as string;
  };
  const secLabel = useSecurityLevelLabel();  // D4 #62 보안등급 라벨
  const [mode, setMode] = useState<'view' | 'edit' | 'new'>('view');
  const [titleDraft, setTitleDraft] = useState('');
  const [contentDraft, setContentDraft] = useState<unknown>(null);
  const [categoryDraft, setCategoryDraft] = useState<string>('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<PostDetail | null>(null);
  const [newCatOpen, setNewCatOpen] = useState(false);
  // 운영 #401 — 분류 이름 변경·삭제
  const [catEditKey, setCatEditKey] = useState<string | null>(null);
  const [catEditDraft, setCatEditDraft] = useState('');
  const [catDeleting, setCatDeleting] = useState<{ id: number | null; name: string; count: number } | null>(null);
  const [newCatDraft, setNewCatDraft] = useState('');
  // 신규 모드(Post.id 미존재) 에서 첨부 예약용 — 저장 직후 attach 일괄 처리
  const [pendingUploads, setPendingUploads] = useState<File[]>([]);
  const [pendingExistingIds, setPendingExistingIds] = useState<number[]>([]);
  const [, setPendingExistingMeta] = useState<Record<number, { name: string; size: number }>>({});
  // 본문 하단 "관련 문서" 연결 — 다른 post(문서/표) 참조. 단방향 (저장 시 PUT linked_post_ids).
  const [pendingPostIds, setPendingPostIds] = useState<number[]>([]);
  // 편집을 시작할 때 본 연결 목록 — 저장 때 `linked_base_ids` 로 보낸다. 서버는 이것과 비교해
  //   «더한 것·뺀 것» 만 반영한다(그 사이 상대 문서 쪽에서 걸린 연결을 화면이 몰랐다고 지우지 않는다).
  const linkBaseRef = useRef<number[]>([]);
  // 표(table) 편집 모드의 본문 설명 에디터 collapsible — 빈 상태 신규일 때 닫혀 시작, 내용 있으면 열린 상태.
  const [tableDescOpen, setTableDescOpen] = useState<boolean>(false);
  const submittingRef = useRef(false);
  /** 명시 저장 재시도 1회 가드 (내가 낸 충돌만) */
  const saveRetriedRef = useRef(false);
  // ── #252 자동저장 ("문서에 글 쓸 때도 메모처럼 임시저장되면 안되나? 날라갈까봐 불안한데") ──
  //   메모(MemoView)와 같은 모델: 입력 → debounce → PUT. 성공은 ✓ 뱃지만(토스트 금지, CLAUDE.md).
  //   신규 글은 첫 입력에 draft 로 POST 해 id 를 확보한 뒤 PUT 으로 이어간다 —
  //   서버가 draft 를 L1 로 강제하고 broadcast·감사·stage 를 막으므로 남에게 새지 않는다.
  const [autoState, setAutoState] = useState<'idle' | 'saving' | 'saved' | 'error' | 'stale'>('idle');
  const [autoErr, setAutoErr] = useState<string | null>(null);
  const [historyOpen, setHistoryOpen] = useState(false);
  // 문서 AI 수정(docs/DOC_AI_EDIT_DESIGN.md) — 반영 뒤 «N곳 반영 · 되돌리기» 줄. 되돌리기 = 반영 직전 버전 복원.
  const [aiEditOpen, setAiEditOpen] = useState(false);
  // 되돌리기 = 같은 «적용» 문을 전/후를 뒤집어 부른다(표 칸은 버전 기록이 없어 복원 라우트로는 못 돌린다)
  const [aiEditDone, setAiEditDone] = useState<{ postId: number; applied: number; base: string | null; changes: { id: number; before: string; after: string }[]; undoing?: boolean; undone?: boolean } | null>(null);
  // 표 문서는 값이 표(q_records)에 있다 — AI 수정 적용·되돌리기 뒤 표를 다시 읽게 키를 올린다
  const [tableReloadKey, setTableReloadKey] = useState(0);
  // leaveEditSession 이 최신 값을 보게 하는 ref (useCallback 클로저에 갇히지 않게).
  const detailRef = useRef<PostDetail | null>(null);
  //   ★ 이 ref 는 선언만 돼 있고 **한 번도 대입되지 않았다** — 아래 leaveEditSession 의
  //     "나가는 순간 첨부 저장" 이 지금껏 한 번도 실행된 적이 없다(항상 null?.() 로 조용히 통과).
  //     주석은 동작을 설명하는데 코드는 죽어 있었다. 정의부(persistAttachments) 뒤에서 대입한다.
  const persistAttachmentsRef = useRef<
    ((id: number, target: { projectId: number | null; vlevel: 'L1' | 'L2' | 'L3' | 'L4' })
      => Promise<{ changed: boolean; hasFailure: boolean; linkFailed?: boolean }>) | null
  >(null);
  // ★ 2026-08-24 — 자동저장이 실패/충돌이면 leaveEditSession() 이 false 를 돌려 **이동을 막는다**.
  //   그 자체는 옳다(저장 안 된 글을 잃지 않는다). 문제는 **아무 말도 안 한다**는 것이었다 —
  //   문서를 클릭해도, 새 문서를 눌러도 반응이 없어 화면이 먹통으로 보인다(작은 배지에만 사유가 있다).
  //   막힌 순간을 명시적으로 알린다.
  const [leaveBlocked, setLeaveBlocked] = useState(false);
  const autoTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const autoDirtyRef = useRef(false);
  const autoBusyRef = useRef(false);
  // 편집 시작 시점의 updated_at — 낙관적 잠금 기준. 저장 성공마다 갱신한다.
  const baseUpdatedAtRef = useRef<string | null>(null);
  /** 자동저장 재시도 1회 가드 — 내가 낸 충돌만, 무한 재시도 금지 */
  const autoRetriedRef = useRef(false);
  // 자동저장이 만든 draft 의 id (신규 모드). 명시 저장·취소가 이걸 보고 승격/삭제한다.
  const autoDraftIdRef = useRef<number | null>(null);
  // 편집 진입 시점 스냅샷 — "취소" 가 자동저장된 내용을 되돌리는 근거.
  // ★ projectId 를 스냅샷에 포함한다 — 자동저장 **발화 조건**이기도 하다.
  //   payload 에만 넣고 여기서 빼면, 프로젝트를 골라도 '바뀐 것 없음'으로 판정돼
  //   요청이 아예 안 나간다(2026-09-03 실측: 선택 후 4초 대기, PUT 0건).
  const editSnapshotRef = useRef<{ title: string; content: unknown; category: string; projectId: number | null } | null>(null);
  // 에디터가 마운트하며 붙이는 스키마 기본값(TextAlign 의 textAlign:null 등)으로 나는 첫 emit.
  //   이 emit 은 **기준선(editSnapshotRef)이 잡히기 전에** 도착한다 — 자식 effect 가 부모보다
  //   먼저 돌기 때문이다(실측). 그래서 여기 받아 두었다가 기준선을 이 값으로 잡는다.
  //   기준선을 에디터의 렌즈로 재는 것이 핵심이다 — 사람의 입력 여부를 판정하지 않는다.
  const pendingNormalizedRef = useRef<unknown>(null);
  // AI 가 써 준 본문으로 새 문서를 시작했는가. 진입 시드는 보통 "변경" 이 아니지만(빈 문서·템플릿만
  //   열고 닫아도 초안이 쌓이지 않게), **AI 생성은 사용자가 비용(Cue)을 써서 만든 결과물**이다.
  //   손대지 않고 다른 문서를 눌렀다고 사라지면 안 된다 — 시드 시점에 초안으로 박제한다.
  //   (2026-09-05 Fable 지적: 이 경로는 시드가 HTML 문자열이고 에디터 emit 은 JSON 이라 여태
  //    늘 "변경됨" 으로 잡혀 저장돼 왔다. 사용자는 "AI 문서는 남는다" 를 경험해 왔다.)
  const aiSeedRef = useRef(false);
  // ★ 자동저장 발화 기준은 "마지막으로 서버에 쓴 값" 이어야 한다 (편집 진입 스냅샷이 아니라).
  //   진입 스냅샷만 보면, 한 글자만 고쳐도 그 뒤로 **영원히 changed=true** 라
  //   저장이 끝나 autoState 가 바뀔 때마다 effect 가 다시 2초 타이머를 걸어 **자동저장이 자기를 재예약**한다.
  //   → 타이핑을 멈춰도 2초마다 PUT 이 계속 나간다(운영 신고: "갑자기 갑자기 저장이 돼").
  //   진입 스냅샷은 '취소' 되돌림 기준이라 건드리면 안 되므로 **기준을 둘로 분리**한다.
  const lastSavedRef = useRef<{ title: string; content: unknown; category: string; projectId: number | null } | null>(null);
  // ★ 편집 세션 카운터. 스냅샷 effect 를 `detail?.id` 에 걸면, 첫 자동저장의 setDetail(created) 가
  //   그 effect 를 재발화시켜 autoDraftIdRef·autoState 를 리셋한다 — 그러면 명시 저장이 승격 대신
  //   글을 하나 더 만들고, 취소는 draft 를 못 지운다(Fable 실측 BLOCKER). 진입 지점만 이 값을 올린다.
  const [editEpoch, setEditEpoch] = useState(0);
  // 새 문서에서 고른 «업무 연결» 중 아직 못 건 것(DocTaskLinkField 가 알려 준다) — 저장 버튼 분기가 건다
  const pendingTaskIdsRef = useRef<number[]>([]);
  const beginEditSession = useCallback(() => setEditEpoch((n) => n + 1), []);
  // 서명 잠금으로 멈춘 자동저장 — 겹침(남이 먼저 저장)과 같은 «멈춤» 이지만 다른 사실이라 바를 가른다(Fable 2026-10-22 FAIL ①)
  const [signLocked, setSignLocked] = useState(false);
  // 폰(≤640) 편집 — 분류·연결 칸은 요약 한 줄로 접어 두고 누를 때만 편다(2026-10-20, Irene «카테고리가 다 한줄씩 …
  //   높이값이 넓어서 입력란이 좁아»). 편집 세션마다 접힌 채로 시작한다. 넓은 화면은 이 값을 보지 않는다(CSS).
  const [metaOpenPhone, setMetaOpenPhone] = useState(false);
  const [pendingTaskCount, setPendingTaskCount] = useState(0);
  useEffect(() => { setMetaOpenPhone(false); setPendingTaskCount(0); }, [editEpoch]);
  useEffect(() => { detailRef.current = detail; }, [detail]);
  const [shareOpen, setShareOpen] = useState(false);
  const [aiOpen, setAiOpen] = useState(false);
  // 운영 — Q docs AI 재생성: 생성 컨텍스트 보관 + 재생성 busy
  // 운영 #312 — instructions: "다시 만들기" 로 준 지시를 **누적** 보관한다. 매번 마지막 한 줄만
  //   보내면 앞서 시킨 것이 전부 풀려 결과가 처음으로 되돌아간다("히스토리 날리고").
  const [aiCtx, setAiCtx] = useState<{ kind: string; userInput: string; clientId?: number | null; projectId?: number | null; instructions?: string[] } | null>(null);
  const [regenBusy, setRegenBusy] = useState(false);
  const [aiIntent, setAiIntent] = useState<'manual' | 'ai'>('manual');
  // 사이클 N+22 — + 버튼 드롭다운 (빈 문서 즉시 / 표는 모달 default table) + 모달 default tab
  const [newDropdownOpen, setNewDropdownOpen] = useState(false);
  const [aiDefaultMode, setAiDefaultMode] = useState<'blank' | 'new' | 'brief' | 'table' | 'survey' | undefined>(undefined);
  // N+42 — Q Note 정리하기 → 정식 문서 승격 진입 prefill
  const [aiInitialBriefTitle, setAiInitialBriefTitle] = useState<string | undefined>(undefined);
  const [aiInitialBriefText, setAiInitialBriefText] = useState<string | undefined>(undefined);
  const briefPrefillAppliedRef = useRef(false);
  const [signOpen, setSignOpen] = useState(false);
  // 사이클 O3 — Q info 로 보내기 (post → KbDocument import)
  const [knowledgeBusy, setKnowledgeBusy] = useState(false);
  const [knowledgeMsg, setKnowledgeMsg] = useState<string | null>(null);
  const [signReloadKey, setSignReloadKey] = useState(0);
  const [projectDraft, setProjectDraft] = useState<number | null>(null);
  // 업무 «결과물 액션» 에서 넘어온 새 문서(?from_action=) — docs/TASK_ACTIONS_DESIGN.md §4.2.
  //   첫 저장(임시저장 생성)에만 from_action_id 를 싣는다 — 서버가 그 문서를 액션에 건다(담당자만).
  const [fromAction, setFromAction] = useState<FromActionHandoff | null>(null);
  const [fromActionFailed, setFromActionFailed] = useState(false);
  const fromActionSentRef = useRef(false);
  // 자동저장 콜백(useCallback)이 옛 값을 보지 않게 ref 로 읽는다
  const fromActionRef = useRef<FromActionHandoff | null>(null);
  fromActionRef.current = fromAction;
  const fromActionPayload = (): { from_action_id?: number } => {
    const fa = fromActionRef.current;
    if (!fa || !fa.can_perform || fromActionSentRef.current) return {};
    fromActionSentRef.current = true;
    return { from_action_id: fa.action.id };
  };
  // 발행·취소로 편집을 떠나면 띠를 걷는다 — 그 뒤에는 밴드2 의 «업무:» 칩이 연결을 말한다
  useEffect(() => {
    if (mode === 'view' && fromAction) { setFromAction(null); setFromActionFailed(false); }
  }, [mode, fromAction]);
  // #336 — 방금 만든 표는 바로 편집 화면으로 열려야 한다.
  //   여태 URL 의 ?new_table=1 만 보고 판정했는데, setActiveId 와 setSearchParams 가
  //   **다른 커밋에 떨어지면** activeId effect 가 옛 searchParams 를 읽어 보기 모드로 연다.
  //   타이밍에 따라 되기도 하고 안 되기도 해서 "이상하다" 로 보였다. ref 로 확정 신호를 남긴다.
  const pendingNewTableRef = useRef<number | null>(null);
  const [projects, setProjects] = useState<ApiProject[]>([]);
  // 템플릿 모달 — 새 글 작성 시 시드 5종 중 선택해서 본문 prefill
  const [tplModalOpen, setTplModalOpen] = useState(false);
  const [templates, setTemplates] = useState<DocTemplate[]>([]);
  // 사이클 I2 — Phase F 슬롯 폼
  const [slotTplId, setSlotTplId] = useState<number | null>(null);
  const [tplSearch, setTplSearch] = useState('');
  const { user } = useAuth();
  // 같이 고치고 있는 사람(나 빼고, 보기 화면에서도) · 마지막 입력 시각 · 남의 저장을 맞추는 함수 · 겹쳐서 남긴 내 글
  //   — docs/DOC_COEDIT_DESIGN.md B 안
  const presence = usePostPresence(detail?.id ?? null, scope.businessId ?? null, user?.id ? Number(user.id) : null, mode === 'edit', !!detail?.id);
  const presenceUsers = presence.others;
  const presencePingRef = useRef(presence.ping);
  presencePingRef.current = presence.ping;
  const lastInputAtRef = useRef(0);
  const remoteSavedRef = useRef<((postId: number) => Promise<void>) | null>(null);
  const conflict = useConflictStash(detail?.id ?? null, scope.businessId ?? null);

  // N+30 — personal 도 scope.businessId 우선 사용 (multi-workspace 사용자 시 user.business_id fallback 잘못된 bizId 회귀 차단)
  const businessId = (scope.type === 'workspace' || scope.type === 'personal') ? scope.businessId : (user?.business_id ? Number(user.business_id) : null);
  // 템플릿 저장 모달 상태
  const [saveTplOpen, setSaveTplOpen] = useState(false);
  // 휴지통 (Irene 2026-08-31) — 문서·정보는 여태 지우면 영구 삭제였다
  const [trashOpen, setTrashOpen] = useState(false);
  const [saveTplName, setSaveTplName] = useState('');
  const [saveTplDesc, setSaveTplDesc] = useState('');
  const [saveTplBusy, setSaveTplBusy] = useState(false);
  const [saveTplError, setSaveTplError] = useState<string | null>(null);
  const [pdfBusy, setPdfBusy] = useState(false);
  const [docxBusy, setDocxBusy] = useState(false);   // #225 — 워드 생성 중 중복 클릭 차단
  // 운영 #338 — 목차가 이동할 대상(렌더된 본문 컨테이너). 목차는 여기서 h1~h3 을 찾는다.
  const docBodyRef = useRef<HTMLDivElement>(null);

  // content_json → HTML 변환. 변환·정화는 utils/postContentHtml 한 곳 —
  //   무로그인 열람 화면(GuestDocsTab)이 같은 함수를 쓴다.
  const renderContentToHtml = useCallback((contentJson: unknown): string => postContentToHtml(contentJson), []);

  // ── 문서 복사 (2026-09-22, Irene: "편집버튼 옆에 복사버튼 넣어줘. 아이콘만 있으면 될 것 같아.")
  //    복사본은 새 문서다 — 만들고 **바로 그 문서를 연다**(어디 갔는지 찾게 만들지 않는다).
  const [dupBusy, setDupBusy] = useState(false);
  const duplicateCurrent = useCallback(async () => {
    const d = detailRef.current;
    if (!d || dupBusy) return;
    setDupBusy(true); setError(null);
    try {
      const copy = await duplicatePost(d.id);
      await load();                 // 목록에 바로 보이게
      await selectPost(copy.id);    // 그리고 그 문서를 연다 — 어디 갔는지 찾게 만들지 않는다
    } catch (e) {
      setError((e as Error).message === 'forbidden'
        ? (t('duplicate.forbidden', { defaultValue: '이 문서를 복사할 권한이 없습니다.' }) as string)
        : (t('duplicate.failed', { defaultValue: '복사하지 못했습니다. 잠시 후 다시 시도해주세요.' }) as string));
    } finally { setDupBusy(false); }
  }, [dupBusy]);

  // 서명본 — 서명 요청이 하나라도 있으면 본문 자리에 «고정본 + 서명» 을 그린다.
  //   서명 진행이 바뀌면(요청·서명 완료) 같이 다시 읽는다 — signReloadKey 가 그 신호다.
  const [signedDoc, setSignedDoc] = useState<SignedDocView | null>(null);
  const signedDocIdRef = useRef<number | null>(null);
  // 서명본을 **이 문서 것으로** 읽었는가 — 문서를 옮긴 직후 한 렌더는 앞 문서의 signedDoc 이 남아 있다(?edit=1 판정용)
  const signedDocLoadedForRef = useRef<number | null>(null);
  useEffect(() => {
    const id = detail?.id;
    if (!id) { setSignedDoc(null); signedDocIdRef.current = null; return undefined; }
    // 다른 문서로 옮기면 앞 문서의 값(잠금 포함)을 들고 있지 않는다 — 같은 문서를 다시 읽을 때는 그대로 둔다(본문이 깜빡이지 않게)
    if (signedDocIdRef.current !== id) { setSignedDoc(null); signedDocIdRef.current = id; }
    let alive = true;
    void getSignedHtml(id).then((v) => { if (alive) { signedDocLoadedForRef.current = id; setSignedDoc(v); } });
    return () => { alive = false; };
  }, [detail?.id, signReloadKey]);
  // 지금 본문을 고칠 수 있나 — 권한(can_edit) ∧ 서명 잠금 아님. 서명본을 아직 못 읽었으면 내지 않는다
  //   (앞 문서 값으로 [편집] 이 잠깐 떴다 사라지지 않게).
  const canEditNow = !!detail && detail.can_edit !== false && signedDoc != null && !signedDoc.edit_locked;

  const filteredTemplates = useMemo(() => {
    const q = tplSearch.trim().toLowerCase();
    if (!q) return templates;
    return templates.filter(t =>
      (t.name || '').toLowerCase().includes(q) ||
      (t.description || '').toLowerCase().includes(q) ||
      (KIND_LABELS_KO[t.kind] || '').toLowerCase().includes(q)
    );
  }, [templates, tplSearch]);

  // 워크스페이스 모드: project_id 필터 없음(모든 문서), 프로젝트 모드: project_id=scope.projectId
  const scopeProjectId = scope.type === 'project' ? scope.projectId : undefined;
  // 분류에는 두 종류가 있다 — 마스터에 등록된 것(id 있음)과 **문서에만 남은 값**(id 없음).
  //   뒤엣것도 화면에는 똑같이 보이므로, 고칠 수 없게 두면 "왜 이건 안 되지" 가 된다.
  //   findOrCreate 인 생성 API 로 마스터를 확보해 id 를 얻은 뒤 같은 경로로 처리한다.
  const ensureCatId = useCallback(async (c: { id: number | null; name: string }): Promise<number> => {
    if (c.id != null) return c.id;
    const created = await createCategory(scope.businessId, c.name, scopeProjectId ?? null);
    return created.id;
  }, [scope.businessId, scopeProjectId]);

  const load = useCallback(async () => {
    // 캐시는 **기본 목록**(검색어·필터 없음)에만 쓴다. 검색 결과를 캐시하면 다음 진입에
    // 남의 검색 결과가 잠깐 보이는 더 나쁜 화면이 된다.
    const plain = !query && filter.kind === 'all';
    if (!(plain && hasCache(postsKey))) setLoading(true);
    try {
      // N+30 — 개인 보관함 모드: 자체 fetch 함수 (본인 + L1 + project_id=null 자동)
      if (scope.type === 'personal') {
        const { fetchPersonalPosts } = await import('../../services/posts');
        const list = await fetchPersonalPosts(scope.businessId);
        // 클라이언트 측 query 필터 (backend 가 q 파라미터 안 받음)
        const filtered = query
          ? list.filter(p => (p.title || '').toLowerCase().includes(query.toLowerCase()))
          : list;
        setRows(filtered);
        if (plain) writeCache(postsKey, filtered);
        return;
      }
      // 필터를 API 파라미터로 변환
      const apiFilter: { projectId?: number | null; query?: string; category?: string; mine?: boolean; docKind?: 'doc' | 'table' | 'brief' | 'template' | 'survey' } = {
        query: query || undefined,
      };
      if (scope.type === 'project') apiFilter.projectId = scope.projectId;
      if (filter.kind === 'project') apiFilter.projectId = filter.projectId;
      else if (filter.kind === 'category') apiFilter.category = filter.name;
      else if (filter.kind === 'tables') apiFilter.docKind = 'table';
      else if (filter.kind === 'surveys') apiFilter.docKind = 'survey';

      const list = await fetchPosts(scope.businessId, apiFilter);
      setRows(list);
      if (plain) writeCache(postsKey, list);
    } finally { setLoading(false); }
    // ★ dep 은 **원시값으로만** — `scope` 는 호출부가 `scope={{...}}` 인라인으로 넘겨
    //   부모가 한 번 렌더될 때마다 새 객체가 되고, 그때마다 문서 목록을 다시 받았다.
    //   같은 계열이 DocsTab 에서는 **자기 렌더로도** 새 객체가 되어 API 1,219건 폭주가 났다
    //   (2026-09-09 실측 · memory feedback_props_useMemo).
  }, [scope.type, scope.businessId, scopeProjectId, query, filter, postsKey]);

  const loadMeta = useCallback(async () => {
    const m = await fetchPostsMeta(scope.businessId, scopeProjectId);
    setMeta(m);
  }, [scope.businessId, scopeProjectId]);

  useEffect(() => { load(); }, [load]);
  useEffect(() => { loadMeta(); }, [loadMeta]);

  // N+39 — PWA background → foreground 복귀 시 missed events 회복 (CLAUDE.md 운영 안정성 16번 (d))
  useVisibilityRefresh(useCallback(() => { void load(); void loadMeta(); }, [load, loadMeta]));

  // N+38 — 실시간 동기화 (CLAUDE.md 운영 안정성 16번 박제).
  // 다른 사용자가 문서 추가/수정/삭제 시 본인이 페이지 열고 있으면 즉시 보임.
  // backend posts.js 가 'business:${bizId}' room 으로 broadcast — 공유 소켓(services/socket)
  // 에 joinRoom + listener 만 추가.
  useEffect(() => {
    if (!scope.businessId) return;
    let pending: number | null = null;
    const debouncedReload = () => {
      if (pending) return;
      pending = window.setTimeout(() => { pending = null; void load(); void loadMeta(); }, 250);
    };
    // N+72 fix — 열린 detail 도 갱신 (저장 직후 실시간 반영 안 됨 호소)
    const refetchOpenDetail = async (postId: number) => {
      try {
        if (activeId !== postId) return;
        // #252 MAJOR-1 — 편집 중이면 남의 저장으로 내 에디터를 갈아끼우지 않는다.
        //   setDetail 은 스냅샷·base_updated_at 기준까지 흔들어 타이핑 중 글을 날린다.
        //   충돌은 낙관적 잠금이 409(stale 배지)로 알려준다 — 조용히 덮는 대신 사용자가 판단한다.
        //   ★ 2026-10-22 — 단, **안 치고 있으면** 바로 최신으로 맞춘다(remoteSavedRef). 치는 중이면 그대로 두고
        //   다음 자동저장이 409 로 «고르기» 바를 띄운다.
        if (modeRef.current === 'new') return;
        if (modeRef.current === 'edit') { await remoteSavedRef.current?.(postId); return; }
        const d = await fetchPost(postId);
        setDetail(d);
      } catch (_) { /* skip */ }
    };
    // 페이지 mount 시 공유 소켓 (services/socket) business room join + listener 3종.
    //   §10-D: 옛 window.__planq_postsSocket 전역 싱글턴 제거 (멀티탭에서 두 인스턴스가 서로
    //   소켓 참조를 덮어써 끊던 코드). 공유 소켓 + refCount 로 근본 해결.
    joinRoom(`business:${scope.businessId}`);
    const offNew = onSocket('post:new', debouncedReload);
    const offUpd = onSocket('post:updated', (payload: { id: number } | number) => {
      debouncedReload();
      const id = typeof payload === 'number' ? payload : payload?.id;
      if (id) void refetchOpenDetail(id);
    });
    const offDel = onSocket('post:deleted', debouncedReload);
    return () => {
      if (pending) window.clearTimeout(pending);
      leaveRoom(`business:${scope.businessId}`);
      offNew(); offUpd(); offDel();
    };
  }, [scope.businessId, load, loadMeta, activeId]);

  useEffect(() => {
    if (!activeId) {
      setDetail(null);
      // mode 는 강제 변경 안 함 — startNew()/cancelEdit() 가 명시적으로 책임짐.
      // 강제 변경하면 startNew → mode='new' 직후 이 effect 가 'view' 로 덮어써 에디터가 사라짐.
      return;
    }
    let cancelled = false;
    setDetailStatus('loading');
    (async () => {
      // ★ 실패 이유를 잃지 않는다 — 여태 fetchPost 는 404·403·500 을 전부 null 로 뭉갰고,
      //   화면은 목록만 남긴 채 **아무 말도 하지 않았다** (2026-08-30).
      const { status: st, data: d } = await fetchPostResult(activeId);
      // ★ 2026-09-11 (WORKSPACE_SCOPE_DESIGN Q6) — 서버는 문서 **자기** 워크스페이스 권한만 본다. 옛 탭·딥링크로
      //   다른 워크스페이스 문서가 열리면 지금 워크스페이스 화면에 남의 문서가 그려졌다 → 내용 대신 전환 안내.
      if (!cancelled && d && isOtherWorkspace((d as { business_id?: number | null }).business_id, scope.businessId)) {
        setOtherWsBizId(Number((d as { business_id?: number | null }).business_id));
        setDetail(null);
        setDetailStatus('other_workspace');
        return;
      }
      if (!cancelled) setOtherWsBizId(null);
      if (!cancelled) {
        setDetailStatus(st);
        setDetail(d);
        // #96 — 방금 만든 표(?new_table=1)는 바로 편집 화면으로. 그 외는 view.
        const flaggedNewTable = pendingNewTableRef.current === activeId;
        const isNewTable = (flaggedNewTable || searchParams.get('new_table') === '1') && (d?.kind === 'table' || d?.kind === 'survey');
        if (flaggedNewTable) pendingNewTableRef.current = null;   // 1회성 신호
        // #252 — 이것도 편집 진입이다. beginEditSession() 이 없으면 직전 편집의 스냅샷·
        //   draft ref 가 그대로 남아(mode 가 이미 'edit' 이면 effect 자체가 재발화하지 않는다)
        //   취소가 엉뚱한 글을 되돌리고 저장이 엉뚱한 draft 를 승격시킨다.
        if (isNewTable) beginEditSession();
        setMode(isNewTable ? 'edit' : 'view');
        if (isNewTable) {
          const np = new URLSearchParams(searchParams);
          np.delete('new_table');
          setSearchParams(np, { replace: true });
        }
        if (d) {
          setTitleDraft(d.title);
          setContentDraft(d.content_json);
          setCategoryDraft(d.category || '');
        }
      }
    })();
    return () => { cancelled = true; };
  }, [activeId]); // eslint-disable-line react-hooks/exhaustive-deps

  const startNew = async () => {
    // #252 — 이미 편집 중이었다면 그 세션부터 마무리(마지막 타이핑 flush + 고아 draft 차단)
    if (!(await leaveEditSession())) return;
    setActiveId(null);
    setDetail(null);
    setMode('new'); beginEditSession();
    setAiCtx(null);  // 운영 — 빈 새 문서는 AI 재생성 바 숨김
    setTitleDraft('');
    setContentDraft(null);
    // 현재 필터가 카테고리면 해당 카테고리로 프리필
    setCategoryDraft(filter.kind === 'category' ? filter.name : '');
    // 프로젝트 scope 면 자동 연결, 워크스페이스 scope + 필터=프로젝트면 그 프로젝트로
    setProjectDraft(scope.type === 'project' ? scope.projectId : (filter.kind === 'project' ? filter.projectId : null));
    setPendingUploads([]);
    setPendingExistingIds([]);
    setPendingExistingMeta({});
    setPendingPostIds([]);
    linkBaseRef.current = [];
    setError(null);
  };

  // #434 — 다른 앱에서 «공유» 로 들어온 글·파일(?prefill= · ?attachFileIds=)을 **새 문서**로 연다.
  //   공유 화면이 /docs 로 보내기만 하고 여기서 읽는 곳이 없어 글이 사라졌다(업무·메모·채팅은 이미 읽고 있었다).
  //   첫 줄 = 제목, 나머지 = 본문. 파일은 기존 파일 첨부로 붙인다(공유 화면이 먼저 올려 둔 id).
  const sharePrefillRef = useRef(false);
  useEffect(() => {
    if (sharePrefillRef.current) return;
    const text = searchParams.get('prefill');
    const ids = (searchParams.get('attachFileIds') || '').split(',').map(Number).filter((n) => Number.isFinite(n) && n > 0);
    if (!text && ids.length === 0) return;
    sharePrefillRef.current = true;
    void (async () => {
      await startNew();
      if (text) {
        const lines = text.split('\n');
        const esc = (x: string) => x.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
        setTitleDraft((lines[0] || '').slice(0, 200));
        const rest = lines.slice(1).filter((l, i, a) => l.trim() || (i > 0 && a[i - 1].trim()));
        if (rest.length) setContentDraft(rest.map((l) => `<p>${esc(l)}</p>`).join('') as unknown);
      }
      if (ids.length) setPendingExistingIds(ids);
      const next = new URLSearchParams(searchParams);
      next.delete('prefill'); next.delete('attachFileIds');
      setSearchParams(next, { replace: true });
    })();
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [searchParams]);

  // 업무 «결과물 액션» → 새 문서. 제목 = 액션 이름, 프로젝트 = 업무의 프로젝트. 주소는 훅이 즉시 지운다.
  useFromActionHandoff(scope.type === 'workspace', (h) => {
    void (async () => {
      await startNew();
      setTitleDraft(h.action.label.slice(0, 200));
      if (h.task.project_id) setProjectDraft(h.task.project_id);
      fromActionSentRef.current = false;
      setFromActionFailed(false);
      setFromAction(h);
    })();
  });

  // 편집 폼 옵션용: 워크스페이스 프로젝트 목록 (편집/신규 진입 시점에만 fetch)
  useEffect(() => {
    const isEditing = mode === 'edit' || mode === 'new';
    if (!isEditing) return;
    let cancelled = false;
    listProjects(scope.businessId, 'active').then(list => { if (!cancelled) setProjects(list); }).catch(() => {});
    return () => { cancelled = true; };
  }, [mode, scope.businessId]);

  const projectOptions: PlanQSelectOption[] = useMemo(
    () => projects.map(p => ({ value: p.id, label: p.name })),
    [projects]
  );

  // 템플릿 모달 오픈 — 시스템 5종 + 사용자 본인 템플릿 모두 fetch
  const openTemplateModal = async () => {
    if (!businessId) return;
    setTplModalOpen(true);
    setTplSearch('');
    try {
      const list = await listTemplates(businessId);
      setTemplates(list);
    } catch { /* ignore */ }
  };

  // 클라이언트 사이드 mustache — business/today 만 치환 (Post 단계라 client/project 없음)
  const renderTemplateClient = (html: string): string => {
    const today = new Date().toISOString().slice(0, 10);
    const todayPlus30 = new Date(Date.now() + 30 * 86400000).toISOString().slice(0, 10);
    const ctx: Record<string, string> = {
      'business.name': user?.business_name || '',
      'business.brand_name': user?.business_name || '',
      'party_a.name': user?.business_name || '',
      'issued_at': today,
      'effective_date': today,
      'valid_until': todayPlus30,
      'duration_months': '24',
      'title': '',
      'session.title': '',
      'session.created_at': today,
      'session.participants': '',
      'session.location': '',
      'session.brief': '',
    };
    return html.replace(/\{\{\s*([\w.]+)\s*\}\}/g, (_, p) => ctx[p] ?? '');
  };

  const startFromAi = async ({ title, bodyHtml, aiContext }: { title: string; bodyHtml: string; aiContext?: { kind: string; userInput: string; clientId?: number | null; projectId?: number | null } }) => {
    if (!(await leaveEditSession())) return;
    setActiveId(null);
    setDetail(null);
    setMode('new'); beginEditSession();
    aiSeedRef.current = true;          // ↓ 세션 effect 가 이것을 보고 초안 저장을 예약한다
    setTitleDraft(title);
    setContentDraft(bodyHtml as unknown);
    setCategoryDraft(filter.kind === 'category' ? filter.name : '');
    setPendingUploads([]);
    setPendingExistingIds([]);
    setPendingExistingMeta({});
    setPendingPostIds([]);
    linkBaseRef.current = [];
    // #310 — AI 모달에서 고른 프로젝트를 새 문서에 그대로 잇는다.
    //   여태 aiContext 에 projectId 가 담겨 오는데도 초안에 반영하지 않아,
    //   "AI 로 문서 만들 때 프로젝트 연결했는데 새 문서에 동기화가 안 된다" 는 신고가 났다.
    //   페이지가 프로젝트 스코프면 그 프로젝트가 우선(그 화면에서는 소속이 고정이다).
    setProjectDraft(scope.type === 'project' ? scope.projectId : (aiContext?.projectId ?? null));
    setAiCtx(aiContext || null);  // 운영 — 재생성용 컨텍스트
    setError(null);
    setAiOpen(false);
  };

  // 운영 — Q docs AI 재생성: 보관한 컨텍스트 + 지시로 본문 재생성 (제목 유지, 본문 교체)
  const regenerateDoc = async (instruction: string) => {
    if (!aiCtx || regenBusy) return;
    setRegenBusy(true); setError(null);
    // 운영 #312 — 재생성은 "다시 쓰기" 가 아니라 "고쳐 쓰기" 다.
    //   ① 지금 화면의 본문(사용자가 손으로 고친 것 포함)을 원본으로 넘기고
    //   ② 지금까지 준 지시를 전부 누적해 넘긴다.
    //   ★ 지시 누적은 **성공했을 때만** 확정한다 — 실패한 요청까지 쌓이면 다음 재생성이
    //     한 번도 반영된 적 없는 지시를 들고 간다.
    const nextInstructions = [...(aiCtx.instructions || []), ...(instruction ? [instruction] : [])];
    // contentDraft 는 사용자가 편집하는 순간 TipTap JSON 이 된다(AI 직후엔 HTML 문자열).
    //   둘 다 HTML 로 맞춰 보낸다 — 모델에게는 HTML 이 원본이다.
    const baseHtml = typeof contentDraft === 'string' ? contentDraft : renderContentToHtml(contentDraft);
    try {
      const r = await aiGenerateDoc({
        business_id: scope.businessId, kind: aiCtx.kind as DocKind, title: titleDraft.trim() || (t('ai.untitledDoc', { defaultValue: '문서' }) as string),
        user_input: aiCtx.userInput, client_id: aiCtx.clientId, project_id: aiCtx.projectId,
        base_html: baseHtml || undefined,
        instructions: nextInstructions.length ? nextInstructions : undefined,
      });
      setContentDraft(r.body_html as unknown);
      setAiCtx((prev) => (prev ? { ...prev, instructions: nextInstructions } : prev));
    } catch (e) {
      setError((e as Error).message || (t('ai.regenFailed', '재생성 실패. 잠시 후 다시 시도해 주세요.') as string));
    } finally { setRegenBusy(false); }
  };

  const startFromTemplate = async (tpl: DocTemplate) => {
    // 사이클 I2 — schema_json 슬롯이 있으면 SlotFormModal 먼저, 없으면 기존 흐름
    const sj = (tpl as unknown as { schema_json?: unknown }).schema_json;
    const hasSlots = Array.isArray(sj) && sj.length > 0;
    if (hasSlots && tpl.id) {
      setTplModalOpen(false);
      setSlotTplId(tpl.id);
      return;
    }
    if (!(await leaveEditSession())) return;
    setActiveId(null);
    setDetail(null);
    setMode('new'); beginEditSession();
    setTitleDraft(tpl.name);
    const html = tpl.body_template ? renderTemplateClient(tpl.body_template) : '';
    setContentDraft(html as unknown);
    setCategoryDraft(filter.kind === 'category' ? filter.name : KIND_LABELS_KO[tpl.kind] || '');
    setPendingUploads([]);
    setPendingExistingIds([]);
    setPendingExistingMeta({});
    setPendingPostIds([]);
    linkBaseRef.current = [];
    setError(null);
    setTplModalOpen(false);
  };

  // 슬롯 폼 완료 시 — 채워진 HTML 로 PostEditor 진입
  const handleSlotConfirm = async (rendered: { html: string; title: string }) => {
    if (!(await leaveEditSession())) return;
    setActiveId(null);
    setDetail(null);
    setMode('new'); beginEditSession();
    setTitleDraft(rendered.title);
    setContentDraft(rendered.html as unknown);
    setCategoryDraft(filter.kind === 'category' ? filter.name : '');
    setPendingUploads([]);
    setPendingExistingIds([]);
    setPendingExistingMeta({});
    setPendingPostIds([]);
    linkBaseRef.current = [];
    setError(null);
    setSlotTplId(null);
  };

  const startEdit = () => {
    if (!detail) return;
    setMode('edit'); beginEditSession();
    setAiCtx(null);  // 운영 — 기존 문서 편집은 AI 재생성 바 숨김
    setTitleDraft(detail.title);
    setContentDraft(detail.content_json);
    setCategoryDraft(detail.category || '');
    setProjectDraft(detail.project_id);
    {
      // 시작 목록은 **보는 사람이 읽을 수 있는 연결**(linked_posts)에서 만든다. linked_post_ids 는 저장 응답(serialize)이
      //   덧입혀지면 원시 목록이 돼, 남이 건 못 읽는 문서 id 가 «#1110» 칩으로 뜬다(Fable 2026-10-05 관찰).
      const startLinks = Array.isArray(detail.linked_posts)
        ? detail.linked_posts.map(lp => lp.id)
        : (Array.isArray(detail.linked_post_ids) ? detail.linked_post_ids : []);
      setPendingPostIds(startLinks);
      linkBaseRef.current = [...startLinks];
    }
    // 표 본문 설명 — 기존 내용이 있으면 자동 펼침, 없으면 접어두기
    setTableDescOpen(docHasContent(detail.content_json));   // 빈 설명이면 접어 둔다(옛 «길이 > 30» 은 빈 문서도 참이었다)
    setError(null);
  };

  // 받은 서명 [문서에서 수정] → /docs?post=<id>&edit=1 (2026-10-23). 1회성 신호 — 주소에서 바로 지우고 ref 로 들고 있다가,
  //   문서와 그 문서의 서명본(잠금)을 읽은 뒤 **고칠 수 있을 때만** 편집으로 연다. 못 고치면 보기 그대로(서명 진행 절이 길을 말한다).
  //   ★ 마운트 때 한 번만 읽지 않는다 — 문서 탭이 이미 열려 있으면 같은 탭에 주소만 바뀌어 들어온다(keep-alive).
  const pendingEditRef = useRef<number | null>(null);
  useEffect(() => {
    if (searchParams.get('edit') !== '1') return;
    const v = Number(searchParams.get('post'));
    pendingEditRef.current = Number.isFinite(v) && v > 0 ? v : null;
    const np = new URLSearchParams(searchParams);
    np.delete('edit');
    setSearchParams(np, { replace: true });
  }, [searchParams]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => {
    const want = pendingEditRef.current;
    if (!want || !detail || detail.id !== want) return;
    if (signedDoc == null || signedDocLoadedForRef.current !== want) return;
    pendingEditRef.current = null;
    if (canEditNow && mode === 'view') startEdit();
  }, [detail, signedDoc, canEditNow]); // eslint-disable-line react-hooks/exhaustive-deps

  // 사이클 O3 — 포스트를 Q info 로 보내기 (인덱싱 후 Cue 답변에 활용)
  // N+72-7 — 문서 ↔ 표 타입 변경 (편집 모드).
  //   표→문서: 빈 표면 자유, 컬럼/행 있으면 ConfirmDialog (force_kind_change=true)
  //   문서→표: 자유 (빈 q_record 자동 생성)
  // 문서 본문을 AI 추출 모달로 넘길 때의 페이로드 (#284)
  const [aiIngest, setAiIngest] = useState<{ text: string; postId: number; title: string } | null>(null);
  const [pendingKindChange, setPendingKindChange] = useState<'doc' | 'table' | 'survey' | null>(null);
  // 설문 v2 — 네 탭·보내기·미리보기(docs/SURVEY_V2_DESIGN.md §8.2). 응답·통계·발행은 멤버 이상(서버도 같은 술어)
  const [surveyTab, setSurveyTab] = useState<SurveyTab>('questions');
  const [surveySendOpen, setSurveySendOpen] = useState(false);
  const [surveyPreviewOpen, setSurveyPreviewOpen] = useState(false);
  const [surveyPublishKey, setSurveyPublishKey] = useState(0);
  const surveyMemberUp = ['owner', 'admin', 'member'].includes(String(user?.business_role || ''));
  useEffect(() => { setSurveyTab('questions'); }, [detail?.id]);

  const doKindChange = async (newKind: 'doc' | 'table' | 'survey', force = false) => {
    if (!detail || !businessId) return;
    try {
      const r = await apiFetch(`/api/posts/${detail.id}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ kind: newKind, force_kind_change: force }),
      });
      const j = await r.json();
      if (j.success && j.data) {
        // 저장 응답에는 `linked_posts`·표시명이 없다(GET 에는 있다) — 덧입힌다
        setDetail((prev) => (prev ? { ...prev, ...j.data } : j.data));
        setKnowledgeMsg(t('kind.changed', '{{kind}} 으로 변경됐습니다', { kind: newKind === 'table' ? t('kind.table', '표') : newKind === 'survey' ? t('kind.survey', '설문') : t('kind.doc', '문서') }) as string);
        setTimeout(() => setKnowledgeMsg(null), 3000);
      } else if (j.message === 'survey_has_rounds') {
        // 보낸 회차가 있는 설문은 문서로 바꿀 수 없다 — 회차·받는 사람 기록이 이 질문지를 가리킨다
        setKnowledgeMsg(t('survey.hasRounds', '이미 보낸 회차가 있는 설문은 문서로 바꿀 수 없어요. 복사해서 새 문서로 시작하세요.') as string);
        setTimeout(() => setKnowledgeMsg(null), 8000);
      } else {
        setKnowledgeMsg(t('kind.changeErr', '변경 실패: {{msg}}', { msg: j.message || 'error' }) as string);
        setTimeout(() => setKnowledgeMsg(null), 8000);
      }
    } catch (e) {
      setKnowledgeMsg(t('kind.changeErr', '변경 실패: {{msg}}', { msg: mapApiError(e, tErr) }) as string);
      setTimeout(() => setKnowledgeMsg(null), 8000);
    }
  };

  const changeKind = async (newKind: 'doc' | 'table' | 'survey') => {
    if (!detail || detail.kind === newKind) return;
    // 표·설문→문서: q_record 가 비어있어도 backend 409 안 나옴 → 일단 force=false 로 시도, 409 면 confirm
    if (newKind === 'doc' && (detail.kind === 'table' || detail.kind === 'survey') && detail.q_record_id) {
      // 우선 force=false 로 호출, 409 (table_has_data) 일 때만 confirm
      const r = await apiFetch(`/api/posts/${detail.id}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ kind: 'doc', force_kind_change: false }),
      });
      if (r.status === 409) {
        const jj = await r.json().catch(() => ({}));
        if (jj.message === 'survey_has_rounds') {
          setKnowledgeMsg(t('survey.hasRounds', '이미 보낸 회차가 있는 설문은 문서로 바꿀 수 없어요. 복사해서 새 문서로 시작하세요.') as string);
          setTimeout(() => setKnowledgeMsg(null), 8000);
          return;
        }
        setPendingKindChange('doc');  // ConfirmDialog 띄움
        return;
      }
      const j = await r.json();
      if (j.success && j.data) {
        // 저장 응답에는 `linked_posts`·표시명이 없다(GET 에는 있다) — 덧입힌다
        setDetail((prev) => (prev ? { ...prev, ...j.data } : j.data));
        setKnowledgeMsg(t('kind.changed', '문서로 변경됐습니다') as string);
        setTimeout(() => setKnowledgeMsg(null), 3000);
      }
      return;
    }
    await doKindChange(newKind, false);
  };

  // #284 — "내용이 그냥 텍스트로 정리되어 버리는데 AI가 검토해서 항목별로 따로 저장할 거 있으면
  //   하고 보낼 수 없어?" 여태 문서→Info 는 본문을 **통짜 한 건**으로 넣었다.
  //   이제 같은 AI 추출(kb/ai-ingest)을 태워 항목으로 나누고, 사용자가 확인한 뒤 저장한다.
  //   ★ 본문 평문은 **서버에서 받아온다** — content_json 에서 문단을 복원하는 규칙이 서버에 한 벌
  //     있고, 프론트에 베끼면 갈라진다(#234 가 그 계열의 사고였다).
  const sendToKnowledge = async (post: PostDetail) => {
    // ★ 2026-09-11 — 문서의 워크스페이스로 보낸다. 여태 현재 워크스페이스로 보내, 프로젝트 상세에서
    //   다른 워크스페이스 문서를 열면 서버가 그 워크스페이스에서 문서를 못 찾아 404 였다(감사 ② 어긋남).
    const docBizId = post.business_id || businessId;
    if (!docBizId || knowledgeBusy) return;
    setKnowledgeBusy(true);
    setKnowledgeMsg(null);
    try {
      const r = await apiFetch(`/api/businesses/${docBizId}/kb/documents/import-from-post`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ post_id: post.id, extract_only: true }),
      });
      const j = await r.json();
      if (r.ok && j.success && j.data?.text) {
        // ★ 2026-09-07 — 서버가 주는 title 을 **버리지 않는다.** 여태 본문만 넘겨서 AI 는
        //   이 글이 무엇에 관한 것인지 모른 채 항목을 나눴다(Irene: "문서 상세를 보고 인포 만들어야지").
        setAiIngest({ text: j.data.text, postId: post.id, title: j.data.title || post.title || '' });
      } else {
        setKnowledgeMsg(t('actions.sendToKnowledgeErr', '추가 실패: {{msg}}', { msg: j.message || 'error' }) as string);
      }
    } catch (e) {
      setKnowledgeMsg(t('actions.sendToKnowledgeErr', '추가 실패: {{msg}}', { msg: mapApiError(e, tErr) }) as string);
    } finally {
      setKnowledgeBusy(false);
      // 에러는 더 길게 (8초), 성공은 4초
      const isErr = (s: string | null) => s && (s.includes('실패') || s.includes('Failed') || s.includes('에러'));
      setTimeout(() => setKnowledgeMsg(null), isErr(knowledgeMsg) ? 8000 : 4000);
    }
  };

  // ── #252 편집 진입 스냅샷 ──────────────────────────────────────────
  // 편집/신규 진입 지점이 5곳(빈 문서·AI·템플릿·슬롯·기존 편집)이라 각각에 손대는 대신
  //   mode 전환 한 곳에서 잡는다. 스냅샷은 두 가지 역할을 한다:
  //     ① 자동저장 발화 기준 — 진입 시 세팅된 초안(템플릿·AI 시드)은 "변경" 이 아니다.
  //        이게 없으면 템플릿만 열고 닫아도 빈 draft 가 쌓인다.
  //     ② "취소" 의 되돌림 기준 — 자동저장이 이미 서버에 썼으므로, 취소는 이 값으로
  //        되돌리는 명시 PUT 이어야 한다(안 그러면 취소해도 남는다).
  useEffect(() => {
    if (mode === 'edit' || mode === 'new') {
      // 기준선은 진입 시점의 draft. 에디터가 스키마 기본값을 붙여 내놓는 다른 표현은
      //   pendingNormalizedRef 가 따로 들고 있다(둘 중 어느 쪽이 draft 에 남을지 순서가 보장되지 않는다).
      editSnapshotRef.current = { title: titleDraft, content: contentDraft, category: categoryDraft, projectId: projectDraft };
      lastSavedRef.current = null;
      baseUpdatedAtRef.current = detail?.updated_at ?? null;
      autoDraftIdRef.current = mode === 'new' ? null : (detail?.id ?? null);
      // 보통은 깨끗한 상태로 시작하지만, AI 시드는 그 자체가 지킬 값이다(위 aiSeedRef 참조).
      autoDirtyRef.current = aiSeedRef.current;
      aiSeedRef.current = false;
      setAutoState('idle');
      setAutoErr(null);
    } else {
      editSnapshotRef.current = null;
      lastSavedRef.current = null;
      pendingNormalizedRef.current = null;
      autoDirtyRef.current = false;
    }
    // ★ deps 에 detail?.id 를 넣지 않는다 — 자동저장이 detail 을 갱신하면 세션이 리셋된다.
    //   진입 지점이 beginEditSession() 으로 editEpoch 를 올릴 때만 재초기화한다.
  }, [mode, editEpoch]); // eslint-disable-line react-hooks/exhaustive-deps

  // 본문 변경 수신 — 에디터의 **정규화 emit** 은 기준선으로 흡수하고 변경으로 세지 않는다.
  //   기준선을 서버 값(정규화 전)으로 잡으면 에디터의 렌즈와 달라 늘 "바뀐 것" 이 된다
  //   (memory feedback_measure_with_same_lens_as_code · feedback_system_filled_not_user_input).
  const handleContentChange = useCallback((next: unknown) => {
    // 세션이 열리는 중(기준선 전)에 오는 값 = 에디터의 정규화본. **기준선의 또 다른 표현**으로 둔다.
    //   기준선을 여기서 갈아치우지 않는다 — 그러면 진짜 편집이 "변경 없음" 이 되어 유실된다.
    if (!editSnapshotRef.current) pendingNormalizedRef.current = next;
    setContentDraft(next);
  }, []);

  // ── 충돌(stale) 빠져나오기 ────────────────────────────────────────
  //   "저장은 누가 해?"(Irene) — 둘이 같이 고치면 **나중에 저장한 사람 내용이 남는다**.
  //   문제는 여태 뒤늦은 사람이 뱃지 하나만 보고 저장도 이동도 못 하는 막다른 길에 갇혔다는 것.
  //   두 갈래를 명시적으로 준다: 남의 최신본으로 갈아타거나, 내 내용으로 덮어쓰거나.
  // 서버 최신본으로 편집 화면을 맞춘다 — 기준 시각·마지막 저장분까지 같이(안 그러면 맞춘 직후 자동저장이 나간다).
  const applyLatestPost = useCallback((latest: PostDetail) => {
    setDetail(latest);
    setTitleDraft(latest.title);
    setContentDraft(latest.content_json);
    setCategoryDraft(latest.category || '');
    baseUpdatedAtRef.current = latest.updated_at ?? null;
    lastSavedRef.current = { title: latest.title, content: latest.content_json, category: latest.category || '', projectId: latest.project_id ?? null };
    autoDirtyRef.current = false;
  }, []);

  // 남이 저장했다는 신호 — 내가 안 치고 있고 저장할 것도 없을 때만 바로 맞춘다.
  remoteSavedRef.current = async (postId: number) => {
    const idle = () => !autoDirtyRef.current
      && autoStateRef.current !== 'saving' && autoStateRef.current !== 'stale'
      && Date.now() - lastInputAtRef.current > 3000;
    if (!idle()) return;
    const latest = await fetchPost(postId);
    if (!latest || latest.id !== postId || modeRef.current !== 'edit') return;
    if ((latest.updated_at ?? null) === baseUpdatedAtRef.current) return;   // 내 저장이 돌아온 것
    if (!idle()) return;   // 받아 오는 사이 치기 시작했다
    applyLatestPost(latest);
  };

  const resolveStaleReload = useCallback(async () => {
    if (!detail?.id) return;
    const latest = await fetchPost(detail.id);
    if (!latest) return;
    // 내가 쓰던 글은 버리지 않고 따로 남긴다(이 문서·이 사람 몫 하나 — 7일).
    if (titleDraft !== latest.title || JSON.stringify(contentDraft ?? null) !== JSON.stringify(latest.content_json ?? null)) {
      conflict.save({ title: titleDraft, content: contentDraft });
    }
    applyLatestPost(latest);
    setAutoErr(null);
    setAutoState('idle');
    setLeaveBlocked(false);
  }, [detail?.id, conflict.save, titleDraft, contentDraft, applyLatestPost]);

  const resolveStaleOverwrite = useCallback(async () => {
    if (!detail?.id) return;
    const latest = await fetchPost(detail.id);
    // 최신 기준점을 잡고 내 내용을 그 위에 쓴다 — 명시적인 last-writer-wins.
    baseUpdatedAtRef.current = latest?.updated_at ?? baseUpdatedAtRef.current;
    setAutoState('idle');
    setAutoErr(null);
    setLeaveBlocked(false);
    autoDirtyRef.current = true;
    await runAutosaveRef.current?.();
  }, [detail?.id]);

  // ── #252 자동저장 엔진 ────────────────────────────────────────────
  // debounce 2초 (AutoSaveField 표준. 메모는 1초지만 문서는 본문이 길어 PUT 이 무겁다).
  const AUTOSAVE_DEBOUNCE_MS = 2000;

  // 반환값은 "이탈 flush"(leaveEditSession) 가 성공/실패를 판정하는 근거다 —
  //   실패했는데 화면을 넘겨버리면 사용자는 저장된 줄 알고 글을 잃는다.
  const runAutosave = useCallback(async (): Promise<'ok' | 'skip' | 'error' | 'stale'> => {
    if (autoBusyRef.current) return 'skip';
    // 제목이 비면 서버가 400 을 준다 — 아직 저장할 단계가 아니다(조용히 대기).
    if (!titleDraft.trim()) return 'skip';
    autoBusyRef.current = true;
    setAutoState('saving');
    // 이 저장이 실제로 보낸 값 — 성공 후 자동저장 발화 기준(lastSavedRef)이 된다.
    //   await 도중 사용자가 더 타이핑하면 draft 가 바뀌므로 **호출 시점 값**으로 고정해야 한다
    //   (안 그러면 방금 친 글자가 "이미 저장됨" 으로 처리돼 마지막 타이핑이 유실된다).
    const sentSnapshot = { title: titleDraft, content: contentDraft, category: categoryDraft, projectId: projectDraft };
    try {
      const categoryVal = categoryDraft.trim() || null;
      const targetId = detail?.id ?? autoDraftIdRef.current;
      if (!targetId) {
        // 신규 — 임시저장으로 만들고 id 를 붙든다. 이후 입력은 전부 PUT.
        const created = await createPost({
          business_id: scope.businessId,
          project_id: scope.type === 'project' ? scope.projectId : projectDraft,
          title: titleDraft.trim(),
          content_json: contentDraft as never,
          category: categoryVal,
          status: 'draft',
          ...fromActionPayload(),
          // ★ 개인 보관함에서 만든 것은 **나만 보기(L1)** 다 (Irene 2026-08-31:
          //   "개인보관함에 올리는 건 당연히 나만보기로 만들어줘야 하는 거 아니야? 올리는 것들 다?")
          //   여기서 안 보내면 서버 기본값이 project_id 없을 때 **L3(워크스페이스 전체)** 다
          //   (routes/posts.js:490). 초안일 동안은 L1 이라 안 보이다가, 발행되는 순간
          //   전 멤버에게 공개되고 **개인 보관함 목록(L1 필터)에서는 사라진다.**
          //   파일 업로드는 이미 서버가 L1 로 저장한다 — 문서만 규칙이 갈라져 있었다.
          ...(scope.type === 'personal' ? { vlevel: 'L1' as const } : {}),
        });
        if (created.warnings?.includes('action_link_failed')) setFromActionFailed(true);
        autoDraftIdRef.current = created.id;
        baseUpdatedAtRef.current = created.updated_at ?? null;
        setDetail(created);
      } else {
        const patched = await updatePost(targetId, {
          title: titleDraft.trim(),
          content_json: contentDraft as never,
          category: categoryVal,
          // ★ 프로젝트 연결을 자동저장에도 실어 보낸다 (운영 신고 2026-09-03 — Irene:
          //   "문서에서 프로젝트 연결해도 연결이 안돼").
          //   여태 **신규 생성(createPost)과 수동 저장에만** project_id 가 실렸고,
          //   자동저장(이 분기)에는 빠져 있었다. 그래서 이미 있는 문서에서 프로젝트를 고르면
          //   화면은 "저장됨" 뱃지를 띄우는데 값은 서버로 가지 않았다 —
          //   실제로 운영 문서 #82 는 project_id 가 null 이었고, 8/25 에 **생성 시점에** 고른
          //   #73·#74 만 값이 붙어 있었다.
          //   (memory feedback_ui_control_sends_nothing — 문구만 바뀌고 요청은 안 나가는 컨트롤)
          //   프로젝트 scope 페이지에서는 값이 고정이라 보내지 않는다(수동 저장과 같은 규칙).
          ...(scope.type === 'workspace' ? { project_id: projectDraft } : {}),
          base_updated_at: baseUpdatedAtRef.current,
          autosave: true,
        });
        baseUpdatedAtRef.current = patched.updated_at ?? null;
        // detail 전체를 갈아끼우면 편집 중인 draft 가 서버 값으로 튕긴다 — 메타만 반영.
        setDetail((prev) => (prev ? { ...prev, updated_at: patched.updated_at } : patched));
      }
      autoDirtyRef.current = false;
      lastSavedRef.current = sentSnapshot;   // ★ 이게 없으면 자동저장이 2초마다 자기를 재예약한다
      setAutoState('saved');
      setAutoErr(null);
      return 'ok';
    } catch (e) {
      if (e instanceof StaleEditError) {
        // ★ **내 저장으로 서버가 앞서 나간 것이면 충돌이 아니다** — 기준만 갱신하고 한 번 재시도한다.
        //   혼자 쓰는데도 "다른 사람이 수정했습니다" 가 뜨던 것의 정체가 이것이다(운영 신고 2026-08-20).
        //   재시도는 1회만 — 진짜 충돌이면 두 번째에 다시 409 가 나고 그때는 배너로 알린다.
        if (e.byMe && e.currentUpdatedAt && !autoRetriedRef.current) {
          autoRetriedRef.current = true;
          baseUpdatedAtRef.current = e.currentUpdatedAt;
          // ★ 아직 이 호출 안이라 busy 가 켜져 있다 — 풀지 않으면 재시도가 첫 줄에서 'skip' 으로 돌아와
          //   저장은 안 됐는데 성공처럼 지나간다(나가는 순간이면 마지막 글이 사라진다).
          autoBusyRef.current = false;
          const again = (await runAutosaveRef.current?.()) ?? 'stale';
          autoRetriedRef.current = false;
          return again;
        }
        // 남의 저장을 덮지 않는다 — 자동저장을 멈추고 사용자에게 알린다.
        setAutoState('stale');
        setAutoErr(e.message || (t('autosave.staleHelp', '다른 사람이 이 문서를 수정했습니다. 새로고침 후 이어서 작성해 주세요.') as string));
        return 'stale';
      }
      // 서명 잠금 — 재시도해도 영영 안 된다. 자동저장을 멈추고 사실과 다음 행동을 알린다.
      if ((e as { code?: string })?.code === 'post_locked_by_signature') {
        setAutoState('stale');   // 자동저장 정지 상태(재시도 안 함)
        setSignLocked(true);
        setAutoErr((e as Error).message || (t('autosave.signatureLocked', '서명 요청을 보낸 문서라 고칠 수 없습니다. 받는 분이 아직 서명하지 않았으면 아래 서명 진행에서 [고쳐서 다시 보내기] 를 누르세요. 이미 서명받았다면 문서를 복사해 새로 보내 주세요.') as string));
        return 'stale';
      }
      setAutoState('error');
      setAutoErr((e as Error).message || (t('autosave.failed', '임시저장 실패') as string));
      return 'error';
    } finally {
      autoBusyRef.current = false;
    }
  }, [titleDraft, contentDraft, categoryDraft, detail?.id, projectDraft, scope, t]);

  // ── #252 BLOCKER-3c — "저장도 취소도 아닌 이탈" 마무리 ─────────────
  // 편집 중 다른 문서를 클릭하거나 새 문서를 시작하면 지금까지 쓴 글이 갈 곳을 잃는다.
  //   ① 대기 중인 debounce 를 즉시 flush 한다 — 마지막 2초 타이핑을 버리지 않는다.
  //   ② flush 가 실패(에러·충돌)하면 false 를 반환해 **이탈 자체를 막는다**.
  //      실패를 감춘 채 화면을 넘기면 사용자는 저장된 줄 알고 글을 잃는다(조용한 실패 금지).
  //   ③ 성공하면 세션 ref 를 끊는다. 남은 draft 는 삭제하지 않는다 — 사용자가 쓴 글이고,
  //      목록에 "임시저장" 뱃지로 보여 다시 열어 이어쓸 수 있다(3a·3b).
  // 렌더 중 대입은 concurrent 렌더에서 안전하지 않다 — commit 후 effect 로 동기화한다.
  //   (읽는 쪽이 전부 이벤트 핸들러라 effect 시점이면 충분하다)
  const runAutosaveRef = useRef(runAutosave);
  const modeRef = useRef(mode);
  const autoStateRef = useRef(autoState);
  useEffect(() => { if (autoState !== 'stale') setSignLocked(false); }, [autoState]);
  useEffect(() => {
    runAutosaveRef.current = runAutosave;
    modeRef.current = mode;
    autoStateRef.current = autoState;
  });

  const leaveEditSession = useCallback(async (): Promise<boolean> => {
    if (modeRef.current !== 'edit' && modeRef.current !== 'new') return true;
    if (autoTimerRef.current) { clearTimeout(autoTimerRef.current); autoTimerRef.current = null; }
    if (autoDirtyRef.current && autoStateRef.current !== 'stale') {
      const r = await runAutosaveRef.current();
      if (r === 'error' || r === 'stale') { setLeaveBlocked(true); return false; }   // 편집 화면 유지 + 사유 노출
    }
    // ★ 저장 버튼 없이 쓰려면(CLAUDE.md 자동저장 원칙) "나가는 순간" 이 곧 저장이어야 한다.
    //   자동저장은 본문·제목만 쓴다 — **첨부는 명시 저장에서만 반영**되므로 여기서 같이 마무리한다.
    //   안 하면 버튼을 없앤 순간 첨부가 조용히 사라진다(Irene: "저장버튼 없이 자동저장", 2026-08-25).
    if (modeRef.current === 'edit' && detailRef.current?.id) {
      try {
        const d = detailRef.current;
        const pr = await persistAttachmentsRef.current?.(d.id, {
          projectId: d.project_id ?? null,
          vlevel: (d.vlevel || (d.project_id ? 'L2' : 'L3')) as 'L1' | 'L2' | 'L3' | 'L4',
        });
        // 연결을 못 저장했으면 편집 화면에 머문다 — 보기로 넘어가면 안내(setError)가 사라지고
        //   사용자는 «연결됐다» 고 믿는다. (파일 업로드 실패의 기존 동작은 바꾸지 않는다.)
        if (pr?.linkFailed) { setLeaveBlocked(true); return false; }
      } catch { /* 첨부 반영 실패는 편집 이탈을 막지 않는다 — 본문은 이미 저장됐다 */ }
      // ★ 보기 화면을 **방금 저장한 내용**으로 맞춘다 (Irene 2026-08-31
      //   "저장 후 보이는 화면이 바로 적용이 안돼", "제목 바꾼 게 안 바뀌어서 검색이 안 됐다").
      //   자동저장은 타이핑 중 에디터를 갈아끼우지 않으려고 detail 에 updated_at 만 반영한다
      //   (위 runAutosave). 그래서 편집을 마치고 돌아오면 본문·제목이 **문서를 열었을 때 값**
      //   그대로였다 — 저장은 됐는데 화면만 옛것이라 사용자에겐 "저장이 안 된다" 로 보인다.
      //   나가는 순간은 더 이상 타이핑 중이 아니므로 여기서 최신본으로 확정한다.
      //   (setMode('view') 앞이라 옛 내용이 한 번 깜빡이지 않는다.)
      try {
        const fresh = await fetchPost(detailRef.current.id);
        if (fresh) {
          setDetail(fresh);
          baseUpdatedAtRef.current = fresh.updated_at ?? null;
        }
      } catch { /* 조회 실패해도 이탈은 막지 않는다 */ }
    }
    autoDirtyRef.current = false;
    autoDraftIdRef.current = null;
    editSnapshotRef.current = null;
    setLeaveBlocked(false);
    setAutoState('idle');
    setAutoErr(null);
    // 편집 모드를 명시적으로 닫는다 — 같은 행 재클릭(activeId=null) 처럼 activeId effect 가
    //   mode 를 건드리지 않는 경로에서도 세션이 남지 않게.
    setMode('view');
    await load();   // 이탈 직후 목록에 임시저장 행이 바로 보이게
    return true;
  }, [load]);

  // 목록/카드 클릭 진입점 — 편집 중이면 먼저 세션을 마무리한다(고아 draft·타이핑 유실 차단).
  //   재클릭 토글(CLAUDE.md UI 규칙)은 호출부에서 id === activeId ? null : id 로 넘긴다.
  const selectPost = useCallback(async (id: number | null) => {
    if (!(await leaveEditSession())) return;   // flush 실패 — 편집 화면 유지
    setActiveId(id);
  }, [leaveEditSession]);

  // 입력 변화 → debounce 예약. stale(충돌) 상태면 더 이상 쏘지 않는다.
  useEffect(() => {
    if (!(mode === 'edit' || mode === 'new')) return;
    if (autoState === 'stale') return;
    // 저장이 날아가는 중이면 예약하지 않는다 — 끝나면 기준(lastSavedRef)이 갱신되고,
    // 그 사이 사용자가 더 쳤으면 'saved' 로 바뀌는 순간 이 effect 가 다시 돌아 예약한다(유실 없음).
    if (autoState === 'saving') return;
    if (!editSnapshotRef.current) return;   // 편집 진입 스냅샷 전에는 발화 금지(초기 세팅이 dirty 로 잡히지 않게)
    // 마지막 저장분이 있으면 그것과 비교한다 — 없으면(아직 한 번도 저장 안 함) 진입 스냅샷과 비교.
    const snap = lastSavedRef.current || editSnapshotRef.current;
    // ★ 기준선은 **에디터가 내놓은 값**이어야 한다 (아래 pendingNormalizedRef 참조).
    //   서버 값(정규화 전)으로 잡으면 에디터의 렌즈와 달라 열자마자 영원히 "바뀐 것" 이 되고,
    //   편집 버튼만 눌러도 자동저장이 나가 옛 글의 수정일이 오늘로 바뀐다
    //   (Irene 2026-09-05, 운영 문서 실측 — 차이가 attrs:{textAlign:null} 하나뿐이었다).
    //   ★ 여기서 **변경을 세지 않는 조건을 걸면 안 된다.** 2026-09-05 실패 사례:
    //   "사람이 포커스한 뒤에만" 으로 막았더니 TipTap 의 focus() 가 rAF 로 지연돼
    //   툴바 클릭(글머리기호·표·굵게·이미지)이 전부 isFocused=false 로 도착했고,
    //   그 편집이 통째로 유실됐다(Fable 실측). 기준선만 바로잡고 비교는 무조건 한다 —
    //   틀려도 최악이 "안 바뀐 저장 한 번" 이지 유실이 아니다.
    // 안 고친 본문에는 표현이 **둘** 있다: 서버가 준 값과, 에디터가 스키마 기본값을 붙여 내놓은 값.
    //   둘 중 어느 쪽과 같아도 "고치지 않았다" 로 본다 — 어느 쪽이 draft 에 남을지는 진입 경로의
    //   순서(startEdit 의 setContentDraft vs 에디터 마운트 emit)에 달려 있어 고정할 수 없다.
    //   ★ 이 예외는 **첫 저장 전까지만** 쓴다. 한 번이라도 저장한 뒤에는 엄격 비교여야
    //   "고쳤다가 되돌린" 것이 서버에 반영된다.
    const draftJson = JSON.stringify(contentDraft ?? null);
    const contentUnchanged = draftJson === JSON.stringify(snap.content ?? null)
      || (lastSavedRef.current === null && pendingNormalizedRef.current !== null
          && draftJson === JSON.stringify(pendingNormalizedRef.current));
    const changed = titleDraft !== snap.title
      || !contentUnchanged
      || categoryDraft !== snap.category
      // 워크스페이스 화면에서만 프로젝트를 고를 수 있다 — 프로젝트 화면은 값이 고정이라 비교 대상이 아니다
      || (scope.type === 'workspace' && projectDraft !== snap.projectId);
    if (!changed && !autoDirtyRef.current) return;
    if (changed) { lastInputAtRef.current = Date.now(); presencePingRef.current(); }
    autoDirtyRef.current = true;
    if (autoTimerRef.current) clearTimeout(autoTimerRef.current);
    autoTimerRef.current = setTimeout(() => { runAutosave(); }, AUTOSAVE_DEBOUNCE_MS);
    return () => { if (autoTimerRef.current) clearTimeout(autoTimerRef.current); };
  }, [titleDraft, contentDraft, categoryDraft, projectDraft, scope.type, mode, autoState, runAutosave]);

  // 저장 대기 중 이탈 경고 + PWA 자동 reload 차단 (운영 안정성 2번 — body[data-form-dirty]).
  useEffect(() => {
    const editing = mode === 'edit' || mode === 'new';
    const dirty = editing && (autoDirtyRef.current || autoState === 'saving');
    if (dirty) document.body.dataset.formDirty = '1';
    else delete document.body.dataset.formDirty;
    // ★ 편집 화면이 열려 있는 동안은 저장이 끝났어도 자동 reload 를 막는다.
    //   formDirty 만으로는 **자동저장이 끝나는 순간** 플래그가 꺼져, 그 틈에 새 빌드가 감지되면
    //   글을 쓰는 중에 페이지가 새로고침돼 편집이 닫혔다(운영 신고 2026-08-21).
    if (editing) document.body.dataset.editingActive = '1';
    else delete document.body.dataset.editingActive;
    const onBeforeUnload = (e: BeforeUnloadEvent) => {
      if (!autoDirtyRef.current && autoState !== 'saving') return;
      e.preventDefault();
      e.returnValue = '';
    };
    window.addEventListener('beforeunload', onBeforeUnload);
    return () => {
      window.removeEventListener('beforeunload', onBeforeUnload);
      delete document.body.dataset.formDirty;
      delete document.body.dataset.editingActive;
    };
  }, [mode, autoState, titleDraft, contentDraft, categoryDraft]);

  // 취소 — ★ 자동저장이 이미 서버에 썼으므로 state 만 되돌리면 "취소했는데 남아있다" 가 된다.
  //   신규(자동 draft) 는 삭제하고, 기존 문서는 진입 스냅샷으로 되돌리는 명시 PUT 을 쏜다.
  const cancelEdit = async () => {
    if (autoTimerRef.current) clearTimeout(autoTimerRef.current);   // 대기 중인 자동저장 취소
    const snap = editSnapshotRef.current;
    if (mode === 'new') {
      const draftId = autoDraftIdRef.current;
      if (draftId) await deletePost(draftId);   // boolean 반환(throw 안 함) — 실패해도 화면은 닫는다
      autoDraftIdRef.current = null;
      setActiveId(null);
      setDetail(null);
      setMode('view');
      setTitleDraft('');
      setContentDraft(null);
      setCategoryDraft('');
      setProjectDraft(null);
      setPendingUploads([]);
      setPendingExistingIds([]);
      setPendingExistingMeta({});
      await load(); await loadMeta();
    } else if (detail) {
      // 자동저장이 한 번이라도 나갔으면 서버 값이 스냅샷과 다르다 → 되돌리기 PUT.
      if (autoState !== 'idle' && autoState !== 'stale' && snap) {
        try {
          const reverted = await updatePost(detail.id, {
            title: snap.title,
            content_json: snap.content as never,
            category: snap.category.trim() || null,
            // 프로젝트도 자동저장으로 이미 서버에 나갔다 — 같이 되돌리지 않으면
            // "취소했는데 프로젝트만 붙어 있다" 가 된다.
            ...(scope.type === 'workspace' ? { project_id: snap.projectId } : {}),
            base_updated_at: baseUpdatedAtRef.current,
          });
          baseUpdatedAtRef.current = reverted.updated_at ?? null;
          setDetail(reverted);
        } catch { /* 되돌리기 실패 — 아래에서 서버 최신본으로 재조회 */
          const fresh = await fetchPost(detail.id);
          if (fresh) { baseUpdatedAtRef.current = fresh.updated_at ?? null; setDetail(fresh); }
        }
        await load();
      }
      setMode('view');
      setTitleDraft(snap?.title ?? detail.title);
      setContentDraft(snap?.content ?? detail.content_json);
      setCategoryDraft(snap?.category ?? (detail.category || ''));
      setProjectDraft(snap ? snap.projectId : detail.project_id);
    }
    setAutoState('idle');
    setAutoErr(null);
    autoDirtyRef.current = false;
    setError(null);
  };

  // 첨부 범위 안내 — **지금 이 문서 기준으로** 어떻게 되는지 한 줄로 말한다(Irene 2026-08-30).
  //   ★ 기준은 `detail`(저장된 문서) 이다. 처음엔 `projectDraft`(편집 초안)를 봤는데,
  //     보기 모드로 문서를 여는 경로는 setProjectDraft 를 부르지 않아 **직전 편집의 잔재**나
  //     null 을 읽었다 — 프로젝트 문서에 "워크스페이스 멤버가 볼 수 있어요" 가 떴다(Fable 실측).
  //   ★ vlevel 도 같이 본다. 승급 규칙(persistAttachments 호출부)이 L4 는 제외하고,
  //     L1 문서면 첨부도 L1 로 남는다 — projectId 만 보면 그 두 경우에 거짓말이 된다.
  const attachScopeProjectId = mode === 'new'
    ? (scope.type === 'project' ? scope.projectId : projectDraft)
    : (detail?.project_id ?? (scope.type === 'project' ? scope.projectId : null));
  const attachScopeLevel = mode === 'new'
    ? (attachScopeProjectId ? 'L2' : 'L3')
    : (detail?.vlevel || (attachScopeProjectId ? 'L2' : 'L3'));
  // ★ 등급 × 프로젝트 **격자**로 판단한다. projectId 를 먼저 보면 "L3 인데 프로젝트가 연결된 문서"
  //   에서 "프로젝트 참여자가 볼 수 있어요" 라는 **청중을 좁게 말하는 거짓**이 된다 —
  //   실제로는 워크스페이스 전체가 본다. 운영에 그 조합이 8건 있었고, dev 에는 0건이라
  //   dev 실측만으로는 안 잡히는 부류였다(Fable 적발).
  //   프로젝트 문구는 **L2 이면서 프로젝트가 있을 때만**.
  const attachScopeHint =
    attachScopeLevel === 'L4'
      ? (t('attach.scopeHintPublic', '올린 파일은 공개 링크를 여는 사람도 내려받을 수 있어요.') as string)
      : attachScopeLevel === 'L1'
        ? (t('attach.scopeHintPrivate', '이 문서는 나만 보기라 올린 파일도 나만 볼 수 있어요.') as string)
        : (attachScopeLevel === 'L2' && attachScopeProjectId)
          ? (t('attach.scopeHintProject', '올린 파일은 이 문서와 같은 범위 — 프로젝트 참여자가 볼 수 있어요.') as string)
          : (t('attach.scopeHintWorkspace', '올린 파일은 이 문서와 같은 범위 — 워크스페이스 멤버가 볼 수 있어요.') as string);

  // 예약된 첨부(신규 업로드 + 기존 파일 선택)를 post 에 반영한다.
  //   신규 작성·편집 **양쪽이 같은 경로**를 쓴다 — 한쪽에만 있어서 편집 모드 첨부가 통째로 유실됐다(#365).
  //   업로드가 실패해도 **본문 저장은 되돌리지 않는다**. 파일 하나 때문에 쓴 글을 잃게 하지 않는다.
  //   ★ #378 — 첨부는 **문서와 같은 곳에 같은 범위로** 있어야 한다. 두 가지가 어긋나 있었다.
  //     (a) 프로젝트 귀속 — 워크스페이스 Docs 에서 프로젝트를 골라 쓴 문서의 첨부가 프로젝트 없이
  //         올라가 '프로젝트 > 파일' 에서 영영 안 잡혔다(scope.type 만 보고 projectDraft 를 무시했다).
  //     (b) 노출 범위 — 프로젝트 없는 문서(L3)의 첨부는 L1 로 올라간다. 업로드가 정하는 범위는
  //         project 유무뿐이라 문서보다 좁아진다 → "문서는 보이는데 첨부는 못 여는" 상태(운영 실측 2건).
  //     기존 파일을 **고른** 것은 손대지 않는다 — 참조는 이사가 아니다.
  const persistAttachments = async (
    postId: number,
    target: { projectId: number | null; vlevel: 'L1' | 'L2' | 'L3' | 'L4' },
  ): Promise<{ changed: boolean; hasFailure: boolean; linkFailed?: boolean }> => {
    const fileIds: number[] = [...pendingExistingIds];
    const uploadedIds: number[] = [];
    const failedFiles: File[] = [];
    const failedLabels: string[] = [];
    for (const f of pendingUploads) {
      const result = target.projectId
        ? await uploadProjectFile(scope.businessId, target.projectId, f)
        : await uploadMyFile(scope.businessId, f);
      if (result.success && result.file) {
        const fid = Number(result.file.id.replace(/^direct-/, ''));
        if (fid) { fileIds.push(fid); uploadedIds.push(fid); }
      } else {
        // 2026-09-14 — 사유를 두 갈래로만 접지 않는다. Drive 연결·맥락 안내까지 그대로 말한다.
        const reason = uploadErrorText(result.message, t, result.limitBytes);
        failedFiles.push(f);
        failedLabels.push(`${f.name} (${reason})`);
      }
    }
    if (fileIds.length > 0) await attachToPost(postId, fileIds);
    // 문서보다 좁게 올라간 **신규 업로드분**만 문서 범위로 넓힌다. 넓히기 한 방향뿐 —
    //   좁히면 이미 보던 사람이 못 보게 된다. L4(외부 공개)로는 자동으로 올리지 않는다.
    const RANK: Record<string, number> = { L1: 1, L2: 2, L3: 3, L4: 4 };
    const uploadedLevel = target.projectId ? 'L2' : 'L1';
    let scopeFailed = 0;
    // (#378) 옛 주석: "프로젝트 없이 L2 면 업로더 본인조차 못 보게 되니 손대지 않는다" —
    //   그건 **파일 목록 술어에 업로더 예외가 없던 것**이 원인이었고, 이제 봉합됐다
    //   (`access_scope.js fileListWhereByLevel` — 단건 검사엔 원래 있었다).
    //   프론트에서 우회하던 예외를 제거한다. 청중 없는 L2 문서의 첨부도 문서와 같은 등급으로 올린다.
    if (target.vlevel !== 'L4' && RANK[uploadedLevel] < RANK[target.vlevel]) {
      for (const fid of uploadedIds) {
        try {
          await updateFileVisibility(scope.businessId, fid,
            target.projectId ? { level: target.vlevel, project_id: target.projectId } : { level: target.vlevel });
        } catch {
          // 첨부 자체는 이미 붙었다 — 범위 조정 실패로 저장을 되돌리지 않는다. 대신 **말해 준다**.
          scopeFailed += 1;
        }
      }
    }
    // 성공분만 비우고 **실패분은 남긴다** — 사용자가 무엇이 안 올라갔는지 보고 다시 시도할 수 있게.
    setPendingUploads(failedFiles);
    setPendingExistingIds([]);
    setPendingExistingMeta({});
    if (failedLabels.length > 0) {
      setError(t('attach.someFailed', '문서는 저장했습니다. 다음 파일은 올리지 못했습니다: {{files}}', { files: failedLabels.join(', ') }) as string);
    } else if (scopeFailed > 0) {
      setError(t('attach.scopeFailed', '첨부는 저장했지만 공개 범위를 문서와 맞추지 못했습니다. 다른 멤버에게 보이지 않을 수 있습니다.') as string);
    }
    // ★ 연결 문서(«관련 문서») — 첨부와 **같은 마무리 지점**에서 저장한다 (2026-10-05).
    //   2026-08-25 에 기존 문서 편집의 [저장] 버튼을 없애고 [편집 완료](leaveEditSession)로 바꾸면서
    //   연결은 그 버튼 안에만 실려 있던 탓에 **어느 경로로도 서버에 가지 않았다** — 칩은 붙는데
    //   편집 완료 후 사라졌다(Irene: "편집완료 해도 저장안되고 표시 안돼"). 새 문서 저장도 같았다.
    //   이 함수는 새 문서 저장·편집 완료가 모두 부른다 — 여기 한 곳에 두면 빠지는 길이 없다.
    const linkBase = linkBaseRef.current;
    const linkDirty = pendingPostIds.length !== linkBase.length || pendingPostIds.some(id => !linkBase.includes(id));
    let linkFailed = false;
    if (linkDirty) {
      try {
        const saved = await updatePost(postId, { linked_post_ids: pendingPostIds, linked_base_ids: linkBase });
        baseUpdatedAtRef.current = saved.updated_at ?? baseUpdatedAtRef.current;
        linkBaseRef.current = [...pendingPostIds];
      } catch {
        linkFailed = true;
        setError(t('links.saveFailed', '문서는 저장했지만 연결 문서를 저장하지 못했습니다. 다시 시도해 주세요.') as string);
      }
    }
    return { changed: fileIds.length > 0 || (linkDirty && !linkFailed), hasFailure: failedLabels.length > 0 || linkFailed, linkFailed };
  };
  // 매 렌더 갱신 — 위 leaveEditSession 이 이 함수보다 먼저 정의돼 있어 ref 로 건넨다.
  persistAttachmentsRef.current = persistAttachments;

  const submit = async () => {
    if (submittingRef.current) return;
    if (!titleDraft.trim()) { setError(t('validation.titleRequired', '제목을 입력하세요') as string); return; }
    submittingRef.current = true;
    if (autoTimerRef.current) clearTimeout(autoTimerRef.current);   // 대기 중 자동저장과 겹치지 않게
    setSaving(true); setError(null);
    // ★ #341 — 이미 **날아가고 있는** 자동저장이 있으면 끝날 때까지 기다린다.
    //   타이머만 끄면 in-flight 요청은 그대로 간다. 그 사이 저장을 누르면
    //   autoDraftIdRef 가 아직 null 이라 아래 분기가 createPost 로 빠져
    //   **임시저장본(자동) + 저장본(수동) 두 개**가 만들어진다.
    //   운영 신고: "임시저장 남고 저장이 따로 되는 경우가 자꾸 생긴다".
    //   무한 대기 방지로 상한을 둔다 — 넘어가면 아래 분기가 알아서 처리한다(멱등은 아니지만 멈추진 않는다).
    for (let waited = 0; autoBusyRef.current && waited < 8000; waited += 50) {
      await new Promise((r) => setTimeout(r, 50));
    }
    try {
      const categoryVal = categoryDraft.trim() || null;
      if (mode === 'new') {
        // 프로젝트 scope 는 자동 강제, 워크스페이스 scope 면 사용자 선택값
        const projectId = scope.type === 'project' ? scope.projectId : projectDraft;
        // 자동저장이 이미 draft 를 만들어 뒀으면 **새로 만들지 않고 승격**한다.
        //   여기서 또 createPost 하면 같은 글이 두 개 생긴다(draft 1 + 정식 1).
        //   status='published' 로 올라가는 이 PUT 에서 broadcast·감사·stage 가 비로소 발화한다.
        const created = autoDraftIdRef.current
          ? await updatePost(autoDraftIdRef.current, {
            title: titleDraft.trim(),
            content_json: contentDraft as any,
            category: categoryVal,
            status: 'published',
            // draft 는 L1 로 강제돼 있었다 — 정식 등록 시 기본 공개 범위로 승격.
            //   ★ 단, **개인 보관함은 승격 대상이 아니다** (Irene 2026-08-31).
            //     여기서 L3 로 올리면 내 보관함에 쓴 글이 전 멤버에게 공개되고,
            //     동시에 보관함 목록(L1 필터)에서 **사라진다** — 사용자에겐 "글이 없어졌다".
            vlevel: scope.type === 'personal' ? 'L1' : (projectId ? 'L2' : 'L3'),
            base_updated_at: baseUpdatedAtRef.current,
          })
          : await createPost({
            business_id: scope.businessId,
            project_id: projectId,
            title: titleDraft.trim(),
            content_json: contentDraft as any,
            category: categoryVal,
            ...fromActionPayload(),
            ...(scope.type === 'personal' ? { vlevel: 'L1' as const } : {}),
          });
        if (created.warnings?.includes('action_link_failed')) setFromActionFailed(true);
        // 예약된 첨부 처리 — 편집 모드와 **같은 경로**를 쓴다 (#365)
        //   첨부의 공개 범위도 문서를 따라간다 — 문서는 나만 보기인데 첨부만 전체면 그게 유출이다.
        const attachRes = await persistAttachments(created.id, {
          projectId,
          vlevel: scope.type === 'personal' ? 'L1' : (projectId ? 'L2' : 'L3'),
        });
        // 고른 업무 연결 — 저장하면 보기로 넘어가 칸이 사라지므로 여기서 건다(중복은 서버가 건너뛴다)
        const taskIds = pendingTaskIdsRef.current.splice(0);
        let taskLinkFailed = false;
        for (const tid of taskIds) {
          try { await linkTask(tid, created.id); } catch { taskLinkFailed = true; }
        }
        if (taskLinkFailed) setError(tc('taskLink.linkFailed') as string);
        const final = (attachRes.changed || taskIds.length > 0) ? ((await fetchPost(created.id)) || created) : created;
        setDetail(final);
        setActiveId(final.id);
        // 업로드 실패가 있으면 편집 화면에 머문다 — 보기 모드로 넘어가면 안내가 사라진다.
        setMode(attachRes.hasFailure || taskLinkFailed ? 'edit' : 'view');
        await load(); await loadMeta();
      } else if (mode === 'edit' && detail) {
        // #252 BLOCKER-3b — 임시저장(draft) 을 다시 열어 편집한 뒤 저장하면 **정식 등록**이다.
        //   status 를 안 보내면 저장은 성공하는데 문서는 draft(L1) 로 남아 남에게 영영 안 보인다.
        //   사용자는 저장했다고 믿는다 — 신규 승격(위 분기)과 같은 규칙을 적용한다.
        const targetProjectId = scope.type === 'workspace' ? projectDraft : detail.project_id;
        const promote = detail.status === 'draft';
        const patched = await updatePost(detail.id, {
          title: titleDraft.trim(),
          content_json: contentDraft as any,
          category: categoryVal,
          base_updated_at: baseUpdatedAtRef.current,
          // 프로젝트 scope 페이지에선 project_id 변경 막기 (강제 유지)
          ...(scope.type === 'workspace' ? { project_id: projectDraft } : {}),
          ...(promote ? { status: 'published' as const, vlevel: (targetProjectId ? 'L2' : 'L3') as 'L2' | 'L3' } : {}),
        });
        // ★ 기준 시각 갱신 — 이게 없어서 저장 버튼을 누른 뒤 이어서 쓰면 **다음 자동저장이 반드시
        //   409** 였다(혼자 쓰는데도 "다른 사람이 수정했습니다"). 자동저장 경로에만 있던 갱신을 여기에도.
        baseUpdatedAtRef.current = patched.updated_at ?? null;
        // ★ #365 — 편집 모드에서는 첨부가 **한 번도 저장되지 않았다**.
        //   attachToPost 호출이 신규 작성 분기에만 있어서, 이미 저장된 문서에 파일을 올려도
        //   조용히 사라졌다("첨부한 영상이 보이지 않아요"). 영상 한정이 아니라 전 파일 공통이었다.
        //   승격(draft→정식)이면 새 범위, 아니면 문서가 지금 갖고 있는 범위에 맞춘다.
        //   임시저장(L1)에 붙인 첨부는 L1 그대로 — 아직 남에게 보일 글이 아니다.
        const attachTargetLevel = (promote
          ? (targetProjectId ? 'L2' : 'L3')
          : (patched.vlevel || detail.vlevel || (targetProjectId ? 'L2' : 'L3'))) as 'L1' | 'L2' | 'L3' | 'L4';
        const attachResEdit = await persistAttachments(patched.id, { projectId: targetProjectId ?? null, vlevel: attachTargetLevel });
        const finalEdit = attachResEdit.changed ? ((await fetchPost(patched.id)) || patched) : patched;
        setDetail(finalEdit);
        setMode(attachResEdit.hasFailure ? 'edit' : 'view');
        await load(); await loadMeta();
      }
      // 명시 저장이 끝났으면 자동저장 상태·draft 참조를 비운다.
      autoDraftIdRef.current = null;
      autoDirtyRef.current = false;
      setAutoState('idle');
      setAutoErr(null);
    } catch (e) {
      if (e instanceof StaleEditError) {
        // ★ 내 저장으로 서버가 앞서 나간 것이면 충돌이 아니다 — 기준만 갱신하고 한 번 더 저장한다.
        //   (자동저장과 같은 규칙. 여기서 막히면 사용자는 쓴 글을 저장할 방법이 없다.)
        if (e.byMe && e.currentUpdatedAt && !saveRetriedRef.current) {
          saveRetriedRef.current = true;
          baseUpdatedAtRef.current = e.currentUpdatedAt;
          submittingRef.current = false;
          try { await submit(); } finally { saveRetriedRef.current = false; }
          return;
        }
        // 충돌은 "저장 실패" 가 아니라 별도 안내 — 사용자가 새로고침해야 하는 상황이다.
        setAutoState('stale');
        setAutoErr(e.message || (t('autosave.staleHelp', '다른 사람이 이 문서를 수정했습니다. 새로고침 후 이어서 작성해 주세요.') as string));
      }
      setError((e as Error).message);
    }
    finally { submittingRef.current = false; setSaving(false); }
  };

  const onDelete = async () => {
    if (!deleteTarget) return;
    const id = deleteTarget.id;
    const ok = await deletePost(id);  // boolean 반환(throw 안 함) — false(403 등)면 삭제 반영 금지
    if (!ok) return;  // 실패 시 확인 모달 유지(거짓 삭제 방지)
    setDeleteTarget(null);
    setActiveId(null);
    setDetail(null);
    await load(); await loadMeta();
  };

  const detachOne = async (attId: number) => {
    if (!detail) return;
    const ok = await detachFromPost(detail.id, attId);  // boolean(throw 안 함)
    if (!ok) return;  // 실패 시 반영 금지(거짓 분리 방지)
    const reloaded = await fetchPost(detail.id);
    setDetail(reloaded);
  };

  // 고정한 문서는 어떤 정렬에서도 위 — 서버 order 의 is_pinned 우선과 같은 규칙.
  const filtered = useMemo(() => {
    const sorted = sortRows(rows, listSort);
    return [...sorted.filter(r => r.is_pinned), ...sorted.filter(r => !r.is_pinned)];
  }, [rows, listSort]);

  const isEditing = mode === 'new' || (mode === 'edit' && !!detail);

  const COLLAPSE_KEY = `qdocs-sidebar-collapsed-${scope.businessId}`;
  const [sidebarCollapsed, setSidebarCollapsed] = useState<boolean>(() => {
    try { return localStorage.getItem(COLLAPSE_KEY) === '1'; } catch { return false; }
  });
  // 좌측 리스트 폭 — 드래그로 조절 (다른 화면과 같은 방식)
  const { width: listWidth, startResize: startListResize } = usePanelWidth('qdocs_list_width', 300, 'left');

  const toggleSidebar = useCallback(() => {
    setSidebarCollapsed(prev => {
      const next = !prev;
      try { localStorage.setItem(COLLAPSE_KEY, next ? '1' : '0'); } catch { /* noop */ }
      return next;
    });
  }, [COLLAPSE_KEY]);

  // ── 프로젝트 스코프 풀레이아웃 + 상단 메뉴 고정(pin) ──
  //   프로젝트 탭은 다른 탭처럼 단일 풀폭 레이아웃. 문서를 "상단 메뉴에 추가"하면 프로젝트 탭바에
  //   doc-탭으로 등장(QProjectDetailPage 가 localStorage 를 읽어 렌더). 옛 ProjectPostsTab 기능 복원.
  const isProject = scope.type === 'project';
  const projId = scope.type === 'project' ? scope.projectId : null;
  // ★ 2026-09-07 — 핀은 **서버(사람 단위)** 가 정본이다. 옛 localStorage 는
  //   기기를 바꾸면 사라져서, 데스크탑에서 올린 탭이 폰에서 안 보였다
  //   (Irene: "모바일에서는 안나와. 나와야지"). 저장소는 usePinnedDocTabs 와 같은 곳이다 —
  //   두 벌을 두면 어느 쪽이 진실인지 갈린다.
  const [pinnedIds, setPinnedIds] = useState<number[]>([]);
  useEffect(() => {
    if (!projId) { setPinnedIds([]); return; }
    let alive = true;
    (async () => {
      const r = await apiFetch(`/api/projects/${projId}/pinned-docs`);
      if (!r.ok || !alive) return;
      const j = await r.json().catch(() => null);
      if (alive && j?.success) setPinnedIds((j.data || []).map((x: { post_id: number }) => x.post_id));
    })();
    return () => { alive = false; };
  }, [projId]);
  const togglePin = useCallback(async (id: number) => {
    if (!projId) return;
    const on = pinnedIds.includes(id);
    // 낙관적 갱신 — 실패하면 서버 값으로 되돌린다.
    setPinnedIds(prev => (on ? prev.filter(x => x !== id) : [...prev, id]));
    const r = await apiFetch(
      on ? `/api/projects/${projId}/pinned-docs/${id}` : `/api/projects/${projId}/pinned-docs`,
      on
        ? { method: 'DELETE' }
        : { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ post_id: id }) },
    );
    if (!r.ok) { setPinnedIds(prev => (on ? [...prev, id] : prev.filter(x => x !== id))); return; }
    window.dispatchEvent(new CustomEvent('qproject-pinned-changed', { detail: { projectId: projId } }));
  }, [projId, pinnedIds]);

  return (
    <Layout $collapsed={sidebarCollapsed} $projectFull={isProject} $hasDetail={!!detail || isEditing} $listW={listWidth}>
      {/* 하니스 판정 신호(CLAUDE.md §17) — 양성 신호로, 뷰포트·모드와 무관하게 항상 그려지는 루트에.
          목록 영역 안에 두면 폰에서 그 자리가 안 그려져 판정 자체가 불가능해진다(2026-08-29 실측). */}
      {!loading && <span data-testid="posts-ready" hidden />}
      {isProject && !pinned && !detail && !isEditing && (
        <ProjBrowse>
          <AtToolbar>
            <SearchBox width={260} value={query} onChange={setQuery} placeholder={t('search.placeholder', '문서 검색') as string} />
            <AtSortWrap>
              <ListSortSelect value={listSort} onChange={setListSort} />
            </AtSortWrap>
            <AtToolbarRight>
            <AiActionButton size="filter" onClick={() => { setAiIntent('ai'); setAiOpen(true); }} label={t('ai.btn', 'AI')} title={t('ai.openHint', 'AI 가 문서 본문을 자동 작성') as string} />
            <NewBtnWrap>
              <NewBtn type="button" data-testid="docs-new" onClick={() => setNewDropdownOpen(v => !v)} title={t('btn.new') as string} aria-label={t('btn.new') as string} aria-expanded={newDropdownOpen}>
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/></svg>
                <span data-cta-label>{t('btn.new', '새 문서') as string}</span>
              </NewBtn>
              {newDropdownOpen && (
                <NewDropdown onMouseLeave={() => setNewDropdownOpen(false)}>
                  <NewItem type="button" data-testid="docs-new-blank" onClick={() => { setNewDropdownOpen(false); startNew(); }}>
                    <NewItemTitle>{t('newDropdown.blankLabel', { defaultValue: '빈 문서' }) as string}</NewItemTitle>
                    <NewItemDesc>{t('newDropdown.blankDesc', { defaultValue: '빈 본문으로 즉시 시작' }) as string}</NewItemDesc>
                  </NewItem>
                  <NewItem type="button" onClick={() => { setNewDropdownOpen(false); setAiIntent('manual'); setAiDefaultMode('table'); setAiOpen(true); }}>
                    <NewItemTitle>{t('newDropdown.tableLabel', { defaultValue: '표' }) as string}</NewItemTitle>
                    <NewItemDesc>{t('newDropdown.tableDesc', { defaultValue: '계정·자산 등 행/열 데이터' }) as string}</NewItemDesc>
                  </NewItem>
                  <NewItem type="button" data-testid="docs-new-survey" onClick={() => { setNewDropdownOpen(false); setAiIntent('manual'); setAiDefaultMode('survey'); setAiOpen(true); }}>
                    <NewItemTitle>{t('newDropdown.surveyLabel', { defaultValue: '설문' }) as string}</NewItemTitle>
                    <NewItemDesc>{t('newDropdown.surveyDesc', { defaultValue: '질문을 만들고 고객에게 보내 응답을 모아요' }) as string}</NewItemDesc>
                  </NewItem>
                  <NewItem type="button" data-testid="docs-new-template" onClick={() => { setNewDropdownOpen(false); openTemplateModal(); }}>
                    <NewItemTitle>{t('newDropdown.templateLabel', { defaultValue: '템플릿에서 시작' }) as string}</NewItemTitle>
                    <NewItemDesc>{t('newDropdown.templateDesc', { defaultValue: '견적·NDA·계약·SOW·회의록 양식' }) as string}</NewItemDesc>
                  </NewItem>
                </NewDropdown>
              )}
            </NewBtnWrap>
            </AtToolbarRight>
          </AtToolbar>
          <AtSplit>
            <AtPanel>
              <AtTree>
                <AtRow $selected={filter.kind === 'all'} onClick={() => setFilter({ kind: 'all' })}>
                  <span />
                  <AtName>{t('filter.all', '전체') as string}</AtName>
                  <AtCount>{meta.total}</AtCount>
                  <span />
                </AtRow>
                {/* #360 — 표 진입로. 누적 기록(표)을 문서 목록에서 바로 찾아갈 수 있게 한다. */}
                <AtRow $selected={filter.kind === 'tables'}
                  onClick={() => setFilter(filter.kind === 'tables' ? { kind: 'all' } : { kind: 'tables' })}>
                  <span />
                  <AtName>{t('filter.tables', '표') as string}</AtName>
                  <AtCount>{meta.tableCount ?? ''}</AtCount>
                  <span />
                </AtRow>
                {/* 설문 v2 — 설문 진입로 */}
                <AtRow $selected={filter.kind === 'surveys'} data-testid="docs-filter-surveys"
                  onClick={() => setFilter(filter.kind === 'surveys' ? { kind: 'all' } : { kind: 'surveys' })}>
                  <span />
                  <AtName>{t('filter.surveys', '설문') as string}</AtName>
                  <AtCount>{meta.surveyCount ?? ''}</AtCount>
                  <span />
                </AtRow>
                {meta.categories.map(c => (
                  <AtRow key={c.name} $selected={filter.kind === 'category' && filter.name === c.name}
                    onClick={() => { if (filter.kind === 'category' && filter.name === c.name) setFilter({ kind: 'all' }); else setFilter({ kind: 'category', name: c.name }); }}>
                    <span />
                    {catEditKey === c.name ? (
                      /* 운영 #401 — 이름 변경. 서버가 그 분류를 쓰던 문서 값도 같이 옮긴다. */
                      <NewCatInput autoFocus value={catEditDraft}
                        onClick={e => e.stopPropagation()}
                        onChange={e => setCatEditDraft(e.target.value)}
                        onBlur={async () => {
                          const v = catEditDraft.trim(); const id = c.id;
                          setCatEditKey(null); setCatEditDraft('');
                          if (!v || v === c.name) return;
                          try { await renameCategory(id ?? await ensureCatId(c), v); await loadMeta(); await load();
                            if (filter.kind === 'category' && filter.name === c.name) setFilter({ kind: 'category', name: v });
                          } catch (e) { setError(mapApiError(e, tErr)); }
                        }}
                        onKeyDown={e => { if (isEnterAction(e)) (e.target as HTMLInputElement).blur();
                          if (e.key === 'Escape') { setCatEditKey(null); setCatEditDraft(''); } }} />
                    ) : (
                      <AtName>#{c.name}</AtName>
                    )}
                    <AtCount>{c.count}</AtCount>
                    {/* 마스터에 등록된 분류만 고치고 지울 수 있다 — id 가 없는 것은 문서에만 남은 옛 값이다 */}
                    {catEditKey !== c.name ? (
                      <CatActions onClick={e => e.stopPropagation()}>
                        <CatIconBtn type="button" data-testid="postcat-rename"
                          title={t('cat.rename', { defaultValue: '이름 변경' }) as string}
                          onClick={() => { setCatEditKey(c.name); setCatEditDraft(c.name); }}>✎</CatIconBtn>
                        <CatIconBtn type="button" $danger data-testid="postcat-delete"
                          title={t('cat.delete', { defaultValue: '삭제' }) as string}
                          onClick={() => setCatDeleting({ id: c.id, name: c.name, count: c.count })}>×</CatIconBtn>
                      </CatActions>
                    ) : <span />}
                  </AtRow>
                ))}
                {newCatOpen ? (
                  <NewCatInput autoFocus value={newCatDraft} onChange={e => setNewCatDraft(e.target.value)}
                    onBlur={async () => { const v = newCatDraft.trim(); setNewCatOpen(false); setNewCatDraft(''); if (!v) return; try { await createCategory(scope.businessId, v, scopeProjectId ?? null); await loadMeta(); setFilter({ kind: 'category', name: v }); } catch { /* silent */ } }}
                    onKeyDown={e => { if (isEnterAction(e)) (e.target as HTMLInputElement).blur(); if (e.key === 'Escape') { setNewCatOpen(false); setNewCatDraft(''); } }}
                    placeholder={t('filter.newCategoryPlaceholder', '카테고리 이름 (Enter)') as string} maxLength={40} />
                ) : (
                  <AddCatBtn type="button" onClick={() => setNewCatOpen(true)} title={t('filter.addCategory', '카테고리 추가') as string}>
                    + {t('filter.addCategory', '카테고리 추가')}
                  </AddCatBtn>
                )}
              </AtTree>
            </AtPanel>
            <AtArea>
              {loading ? (
                <Dim>{t('loading', '로딩 중…') as string}</Dim>
              ) : filtered.length === 0 ? (
                <EmptyState
                  icon={(
                    <svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
                      <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/>
                      <polyline points="14 2 14 8 20 8"/><line x1="16" y1="13" x2="8" y2="13"/><line x1="16" y1="17" x2="8" y2="17"/>
                    </svg>
                  )}
                  title={t('empty.title', '문서를 시작하세요') as string}
                  description={t('empty.line1', '매뉴얼 · 가이드 · 공지 · 회의록 — 팀이 함께 읽는 문서를 만들어 보세요.') as string}
                  ctaLabel={t('newDropdown.blankLabel', { defaultValue: '빈 문서' }) as string}
                  onCta={startNew}
                  secondaryCtaLabel={t('newDropdown.tableLabel', { defaultValue: '표' }) as string}
                  onSecondaryCta={() => { setAiIntent('manual'); setAiDefaultMode('table'); setAiOpen(true); }}
                />
              ) : (
                <AtGrid>
                  {filtered.map(r => (
                    <AtCard key={r.id} data-testid="docs-card" data-row-id={r.id} $selected={activeId === r.id} onClick={() => { void selectPost(r.id); }}>
                      <RowPinBtn type="button" $on={pinnedIds.includes(r.id)} onClick={(e) => { e.stopPropagation(); togglePin(r.id); }}
                        aria-label={(pinnedIds.includes(r.id) ? t('project.docs.removeFromMenu', '상단 메뉴에서 제거') : t('project.docs.addToMenu', '상단 메뉴에 추가')) as string}
                        title={(pinnedIds.includes(r.id) ? t('project.docs.removeFromMenu', '상단 메뉴에서 제거') : t('project.docs.addToMenu', '상단 메뉴에 추가')) as string}><svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><line x1="12" y1="17" x2="12" y2="22"/><path d="M5 17h14l-1.7-2.6a2 2 0 0 1-.3-1.1V7a2 2 0 0 1 2-2H5a2 2 0 0 1 2 2v6.3a2 2 0 0 1-.3 1.1L5 17z"/></svg></RowPinBtn>
                      <AtCardName>
                        {r.status === 'draft' && (
                          <DraftTag title={t('autosave.draftBadgeHint', '아직 나만 보이는 임시저장 문서입니다. 열어서 저장하면 정식 등록됩니다.') as string}>
                            {t('autosave.draftBadge', '임시저장')}
                          </DraftTag>
                        )}
                        <HighlightText text={r.title} query={query} />
                      </AtCardName>
                      {/* 운영 (Irene 2026-08-28): "리스트에 나오는 내용이 제목만나오면 다인가?
                          내용살짝 보여주거나 해야하는 거 아니야? 아니면 다른 정보라도?"
                          content_preview(200자)는 목록 API 가 이미 주고 있었고 카드만 안 그렸다.
                          워크스페이스 목록(RowPreview)과 같은 정보량으로 맞춘다 — 본문 두 줄 + 작성자.
                          2026-09-11 — 검색 중 본문에서 맞았으면 목록 행과 같이 매칭 주변 문장을 그린다. */}
                      {query && r.match?.field === 'content' && r.match.snippet
                        ? <CardPreview><HighlightText text={r.match.snippet} query={query} /></CardPreview>
                        : r.content_preview && <CardPreview><HighlightText text={r.content_preview} query={query} /></CardPreview>}
                      {/* 프로젝트 안 카드에는 프로젝트 태그가 없다 — 프로젝트 이름으로 맞았으면 그 사유를 한 줄로 */}
                      {query && r.match?.field === 'project' && (
                        <MatchReason field="project" snippet={r.match.snippet} query={query} />
                      )}
                      <AtCardMeta>
                        <span>{listDate(r)}</span>
                        {r.author?.name && <CardAuthor>{r.author.name}</CardAuthor>}
                        {r.category && <CategoryMini>#{r.category}</CategoryMini>}
                        <RowVisChip $level={(r.vlevel as string) || ''}>{visLabel(r.vlevel)}</RowVisChip>
                      </AtCardMeta>
                    </AtCard>
                  ))}
                </AtGrid>
              )}
            </AtArea>
          </AtSplit>
        </ProjBrowse>
      )}
      {/* 리스트 접기/펼치기 — 공통 FloatingPanelToggle(뷰포트 왼쪽 변 플로팅).
          ≤900px 은 리스트↔상세 풀스크린 전환이라 핸들 숨김(hideBelow). */}
      {!isProject && (
        <FloatingPanelToggle
          side="left"
          hideBelow={900}
          open={!sidebarCollapsed}
          onToggle={toggleSidebar}
          offsetOpen={`${listWidth}px`}
          ariaLabel={(sidebarCollapsed ? t('sidebar.expand', '리스트 열기') : t('sidebar.collapse', '리스트 접기')) as string}
        />
      )}
      {!isProject && !sidebarCollapsed && (
      <Sidebar $hasDetail={!!detail || isEditing} $projectFull={false} style={{ position: 'relative' }}>
        <PanelResizeHandle onMouseDown={startListResize} />
        <>
        <PanelHeader>
          <TitleGroup>
            <PanelTitle>{scope.type === 'workspace' ? t('page.title', 'Q docs') : t('tab.title', '문서')}</PanelTitle>
            <HelpDot askCue={t('help.cuePrefill','Q docs 의 템플릿·AI 작성·서명 요청·분할 청구가 어떻게 작동하는지 알려줘') as string} topic="qdocs">
              {t('help.body','5종 템플릿(견적·청구·NDA·제안·회의록)에서 시작하거나 AI 자동 작성. 작성 후 서명 요청을 보내면 고객이 OTP 인증으로 서명. 견적·계약 post 와 청구서를 연결하면 회차별 분할 청구도 가능.')}
            </HelpDot>
          </TitleGroup>
          <HeaderBtnRow>
            <AiActionButton
              onClick={() => { setAiIntent('ai'); setAiOpen(true); }}
              label={t('ai.btn', 'AI')}
              title={t('ai.openHint', 'AI 가 문서 본문을 자동 작성') as string}
            />
            <NewBtnWrap>
              <NewBtn type="button" data-testid="docs-new" onClick={() => setNewDropdownOpen(v => !v)} title={t('btn.new') as string} aria-label={t('btn.new') as string} aria-expanded={newDropdownOpen}>
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                  <line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/>
                </svg>
              </NewBtn>
              {newDropdownOpen && (
                <NewDropdown onMouseLeave={() => setNewDropdownOpen(false)}>
                  <NewItem type="button" data-testid="docs-new-blank" onClick={() => { setNewDropdownOpen(false); startNew(); }}>
                    <NewItemTitle>{t('newDropdown.blankLabel', { defaultValue: '빈 문서' }) as string}</NewItemTitle>
                    <NewItemDesc>{t('newDropdown.blankDesc', { defaultValue: '빈 본문으로 즉시 시작' }) as string}</NewItemDesc>
                  </NewItem>
                  <NewItem type="button" onClick={() => { setNewDropdownOpen(false); setAiIntent('manual'); setAiDefaultMode('table'); setAiOpen(true); }}>
                    <NewItemTitle>{t('newDropdown.tableLabel', { defaultValue: '표' }) as string}</NewItemTitle>
                    <NewItemDesc>{t('newDropdown.tableDesc', { defaultValue: '계정·자산 등 행/열 데이터' }) as string}</NewItemDesc>
                  </NewItem>
                  <NewItem type="button" data-testid="docs-new-survey" onClick={() => { setNewDropdownOpen(false); setAiIntent('manual'); setAiDefaultMode('survey'); setAiOpen(true); }}>
                    <NewItemTitle>{t('newDropdown.surveyLabel', { defaultValue: '설문' }) as string}</NewItemTitle>
                    <NewItemDesc>{t('newDropdown.surveyDesc', { defaultValue: '질문을 만들고 고객에게 보내 응답을 모아요' }) as string}</NewItemDesc>
                  </NewItem>
                  <NewItem type="button" data-testid="docs-new-template" onClick={() => { setNewDropdownOpen(false); openTemplateModal(); }}>
                    <NewItemTitle>{t('newDropdown.templateLabel', { defaultValue: '템플릿에서 시작' }) as string}</NewItemTitle>
                    <NewItemDesc>{t('newDropdown.templateDesc', { defaultValue: '견적·NDA·계약·SOW·회의록 양식' }) as string}</NewItemDesc>
                  </NewItem>
                </NewDropdown>
              )}
            </NewBtnWrap>
          </HeaderBtnRow>
        </PanelHeader>

        {/* 휴지통 — 검색줄 오른쪽 끝(Q file·Q info 와 같은 자리). ★ 2026-09-22 휴지통은 하나다(components/Trash).
            예전엔 필터 아래 얇은 줄의 «아이콘+글자» 링크였고 파일 휴지통은 글자 버튼이라 모양이 갈라져 있었다. */}
        <SearchWrap>
          <SearchBox width="100%" value={query} onChange={setQuery} placeholder={t('search.placeholder', '제목·내용·프로젝트 검색') as string} />
          <ListSortSelect variant="icon" data-testid="docs-sort" value={listSort} onChange={setListSort} />
          <TrashButton active={trashOpen} data-testid="docs-trash-open" onClick={() => setTrashOpen(true)} />
        </SearchWrap>

        <FilterSection>
          {/* 카테고리 — 전체 포함 */}
          <FilterGroupLabel>{t('filter.byCategory', '카테고리') as string}</FilterGroupLabel>
          <Chip type="button" $active={filter.kind === 'all'} onClick={() => setFilter({ kind: 'all' })}>
            {t('filter.all', '전체') as string}
            <Count>{meta.total}</Count>
          </Chip>
          {/* 설문 v2 — 설문만 모아 보기(설문이 하나라도 있으면) */}
          {(meta.surveyCount ?? 0) > 0 && (
            <Chip type="button" data-testid="docs-filter-surveys" $active={filter.kind === 'surveys'}
              onClick={() => setFilter(filter.kind === 'surveys' ? { kind: 'all' } : { kind: 'surveys' })}>
              {t('filter.surveys', '설문') as string}
              <Count>{meta.surveyCount}</Count>
            </Chip>
          )}
          {meta.categories.map(c => (
            <Chip
              key={c.name}
              type="button"
              $active={filter.kind === 'category' && filter.name === c.name}
              onClick={() => {
                // 재클릭 시 토글 해제 (PlanQ UI 표준 — 리스트 재클릭 토글)
                if (filter.kind === 'category' && filter.name === c.name) setFilter({ kind: 'all' });
                else setFilter({ kind: 'category', name: c.name });
              }}
            >
              #{c.name}
              <Count>{c.count}</Count>
            </Chip>
          ))}
          {/* 운영 #401 — 분류 이름 변경·삭제. 칩은 button 이라 안에 버튼을 넣을 수 없다
              (중첩 button 은 무효 마크업). **고른 분류 옆**에 붙여 discoverable 하게 둔다.
              프로젝트 탭의 목록(위 AtRow)과 같은 동작을 쓴다 — 규칙이 갈라지지 않게. */}
          {filter.kind === 'category' && (() => {
            const cur = meta.categories.find(x => x.name === filter.name);
            if (!cur) return null;
            if (catEditKey === cur.name) {
              return (
                <NewCatInput autoFocus value={catEditDraft}
                  onChange={e => setCatEditDraft(e.target.value)}
                  onBlur={async () => {
                    const v = catEditDraft.trim(); setCatEditKey(null); setCatEditDraft('');
                    if (!v || v === cur.name) return;
                    try {
                      await renameCategory(cur.id ?? await ensureCatId(cur), v);
                      await loadMeta(); await load(); setFilter({ kind: 'category', name: v });
                    } catch (e) { setError(mapApiError(e, tErr)); }
                  }}
                  onKeyDown={e => { if (isEnterAction(e)) (e.target as HTMLInputElement).blur();
                    if (e.key === 'Escape') { setCatEditKey(null); setCatEditDraft(''); } }} />
              );
            }
            return (
              <CatActions>
                <CatIconBtn type="button" data-testid="postcat-rename"
                  title={t('cat.rename', { defaultValue: '이름 변경' }) as string}
                  onClick={() => { setCatEditKey(cur.name); setCatEditDraft(cur.name); }}>✎</CatIconBtn>
                <CatIconBtn type="button" $danger data-testid="postcat-delete"
                  title={t('cat.delete', { defaultValue: '삭제' }) as string}
                  onClick={() => setCatDeleting({ id: cur.id, name: cur.name, count: cur.count })}>×</CatIconBtn>
              </CatActions>
            );
          })()}
          {newCatOpen ? (
            <NewCatInput
              autoFocus
              value={newCatDraft}
              onChange={e => setNewCatDraft(e.target.value)}
              onBlur={async () => {
                const v = newCatDraft.trim();
                setNewCatOpen(false);
                setNewCatDraft('');
                if (!v) return;
                try {
                  await createCategory(scope.businessId, v, scopeProjectId ?? null);
                  await loadMeta();
                  setFilter({ kind: 'category', name: v });
                } catch { /* silent */ }
              }}
              onKeyDown={e => {
                if (isEnterAction(e)) (e.target as HTMLInputElement).blur();
                if (e.key === 'Escape') { setNewCatOpen(false); setNewCatDraft(''); }
              }}
              placeholder={t('filter.newCategoryPlaceholder', '카테고리 이름 (Enter)') as string}
              maxLength={40}
            />
          ) : (
            <AddCatBtn type="button" onClick={() => setNewCatOpen(true)} title={t('filter.addCategory', '카테고리 추가') as string}>
              + {t('filter.addCategory', '카테고리 추가')}
            </AddCatBtn>
          )}

          {/* 프로젝트 — 워크스페이스 모드에서만 */}
          {scope.type === 'workspace' && meta.projects.length > 0 && (
            <>
              <FilterGroupLabel>{t('filter.byProject', '프로젝트') as string}</FilterGroupLabel>
              {meta.projects.map(p => (
                <Chip
                  key={p.id}
                  type="button"
                  $active={filter.kind === 'project' && filter.projectId === p.id}
                  onClick={() => {
                    // 재클릭 시 토글 해제
                    if (filter.kind === 'project' && filter.projectId === p.id) setFilter({ kind: 'all' });
                    else setFilter({ kind: 'project', projectId: p.id });
                  }}
                >
                  <ColorDot $color={p.color || '#14B8A6'} />
                  {p.name}
                  <Count>{p.count}</Count>
                </Chip>
              ))}
            </>
          )}
        </FilterSection>


        <RowList>
          {/* data-testid — 하니스가 "재진입에 또 로딩되는가" 를 판정하는 신호(CLAUDE.md §17) */}
          {loading ? (
            <Dim data-testid="posts-loading">{t('loading', '로딩 중…')}</Dim>
          ) : filtered.length === 0 ? (
            <EmptyState
              icon={(
                <svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/>
                  <polyline points="14 2 14 8 20 8"/>
                  <line x1="16" y1="13" x2="8" y2="13"/>
                  <line x1="16" y1="17" x2="8" y2="17"/>
                </svg>
              )}
              title={t('empty.title') as string}
              description={t('empty.line1') as string}
              ctaLabel={t('newDropdown.blankLabel', { defaultValue: '빈 문서' }) as string}
              ctaIcon={(
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round">
                  <line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/>
                </svg>
              )}
              onCta={startNew}
              secondaryCtaLabel={t('newDropdown.tableLabel', { defaultValue: '표' }) as string}
              onSecondaryCta={() => { setAiIntent('manual'); setAiDefaultMode('table'); setAiOpen(true); }}
            />
          ) : (
            filtered.map(r => (
              <RowItem
                key={r.id}
                data-testid="docs-row"
                data-post-id={r.id}
                data-row-id={r.id}
                $active={activeId === r.id}
                $project={isProject}
                onClick={() => { void selectPost(activeId === r.id ? null : r.id); }}
              >
                {isProject && (
                  <RowPinBtn
                    type="button"
                    $on={pinnedIds.includes(r.id)}
                    onClick={(e) => { e.stopPropagation(); togglePin(r.id); }}
                    aria-label={(pinnedIds.includes(r.id) ? t('project.docs.removeFromMenu', '상단 메뉴에서 제거') : t('project.docs.addToMenu', '상단 메뉴에 추가')) as string}
                    title={(pinnedIds.includes(r.id) ? t('project.docs.removeFromMenu', '상단 메뉴에서 제거') : t('project.docs.addToMenu', '상단 메뉴에 추가')) as string}
                  ><svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><line x1="12" y1="17" x2="12" y2="22"/><path d="M5 17h14l-1.7-2.6a2 2 0 0 1-.3-1.1V7a2 2 0 0 1 2-2H5a2 2 0 0 1 2 2v6.3a2 2 0 0 1-.3 1.1L5 17z"/></svg></RowPinBtn>
                )}
                <RowTitle>
                  {r.is_pinned && <PinTag aria-hidden="true"><svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><line x1="12" y1="17" x2="12" y2="22"/><path d="M5 17h14l-1.7-2.6a2 2 0 0 1-.3-1.1V7a2 2 0 0 1 2-2H5a2 2 0 0 1 2 2v6.3a2 2 0 0 1-.3 1.1L5 17z"/></svg></PinTag>}
                  {/* #252 — 임시저장 행은 나만 보인다. 표시가 없으면 "저장했는데 팀이 못 본다" 가 된다. */}
                  {r.status === 'draft' && (
                    <DraftTag title={t('autosave.draftBadgeHint', '아직 나만 보이는 임시저장 문서입니다. 열어서 저장하면 정식 등록됩니다.') as string}>
                      {t('autosave.draftBadge', '임시저장')}
                    </DraftTag>
                  )}
                  <HighlightText text={r.title} query={query} />
                </RowTitle>
                {/* 2026-09-11 — 검색 중 본문에서 맞았으면 미리보기 자리에 **매칭 주변 문장**을 그린다.
                    미리보기는 앞 200자라 뒤쪽에서 맞은 문서는 "왜 떴는지" 가 안 보였다. (서버 match 계약: routes/posts.js) */}
                {query && r.match?.field === 'content' && r.match.snippet
                  ? <RowPreview data-testid="docs-row-snippet"><HighlightText text={r.match.snippet} query={query} /></RowPreview>
                  : r.content_preview && <RowPreview><HighlightText text={r.content_preview} query={query} /></RowPreview>}
                <RowMeta>
                  <span>{displayName(r.author, i18n.language) || '—'}</span>
                  <span>·</span>
                  <span>{listDate(r)}</span>
                  {r.category && <CategoryMini>#<HighlightText text={r.category} query={query} /></CategoryMini>}
                  {r.project && (
                    <ProjectTag $color={r.project.color || '#14B8A6'}><HighlightText text={r.project.name} query={query} /></ProjectTag>
                  )}
                  {/* N+72 — 리스트 행 공유 범위 표시 (사용자 호소) */}
                  <RowVisChip $level={(r.vlevel as string) || ''}>
                    {visLabel(r.vlevel)}
                  </RowVisChip>
                  {r.share_token && <ShareMini title={t('share.publicHint', '공개 링크가 활성화됨') as string}>🔗</ShareMini>}
                  {/* D4 #62 — 보안등급 배지 (일반은 자동 숨김) */}
                  <SecurityLevelBadge level={r.security_level} />
                </RowMeta>
              </RowItem>
            ))
          )}
        </RowList>
        </>
      </Sidebar>
      )}

      {(!isProject || pinned || detail || isEditing) && (
      <Content $hasDetail={!!detail || isEditing} $projectFull={isProject} $editing={isEditing}>
        {isEditing ? (
          <>
            <StickyBands data-testid="docs-detail-bands">
            <PanelHeader>
              <TitleRow>
                <MobileBackBtn $always={isProject} type="button" onClick={cancelEdit} aria-label={t('back', '뒤로') as string}>
                  <BackChevron />
                </MobileBackBtn>
                <TitleInput
                  autoFocus={mode === 'new'}
                  value={titleDraft}
                  onChange={e => setTitleDraft(e.target.value)}
                  placeholder={t('titlePlaceholder', '문서 제목') as string}
                  maxLength={200}
                />
              </TitleRow>
              <HeaderActions>
                <AutoSaveMark
                  $tone={autoState === 'error' || autoState === 'stale' ? 'err' : 'ok'}
                  title={autoErr || undefined}
                  aria-live="polite"
                >
                  {/* 폰은 저장 중·저장됨 글자를 접는다(제목 칸 자리) — 실패·충돌 글자는 그대로 보인다 */}
                  {autoState === 'saving' && <AutoSaveText>{t('autosave.saving', '임시저장 중…')}</AutoSaveText>}
                  {autoState === 'saved' && <>✓<AutoSaveText> {t('autosave.saved', '임시저장됨')}</AutoSaveText></>}
                  <PresenceChips users={presenceUsers} short />
                  {autoState === 'error' && `! ${t('autosave.failed', '임시저장 실패')}`}
                  {autoState === 'stale' && `! ${signLocked ? t('autosave.signLockedShort', '서명 중이라 수정 불가') : t('autosave.stale', '다른 사람이 수정함')}`}
                </AutoSaveMark>
                {/* ★ 저장 버튼은 **새 문서에만** 둔다 (2026-08-25, Notion 방식으로 정렬).
                    기존 문서 편집은 치는 대로 저장되고, 나가는 순간 첨부까지 마무리된다
                    (leaveEditSession). 저장 버튼을 남겨두면 "임시저장인데 왜 저장돼?" 라는
                    이중 상태 혼란이 그대로 남는다. 되돌리기는 변경 기록이 담당한다.
                    새 문서는 처음 공개되는 순간이 의도적이어야 하므로 버튼을 유지한다. */}
                <SecondaryBtn type="button" disabled={saving} onClick={cancelEdit}>
                  {mode === 'new' ? t('cancel', '취소') : (
                    // 폰은 짧은 글자 — 긴 글자가 제목 칸을 92px 로 눌렀다(2026-10-20 실측)
                    <><WideOnly>{t('revertEdit', '이번 편집 되돌리기')}</WideOnly><PhoneOnly>{t('revertEditShort', '되돌리기')}</PhoneOnly></>
                  )}
                </SecondaryBtn>
                {mode === 'new' ? (
                  <PrimaryBtn type="button" disabled={saving || !titleDraft.trim()} onClick={submit}>
                    {saving ? t('saving', '저장 중…') : t('save', '저장')}
                  </PrimaryBtn>
                ) : (
                  <PrimaryBtn type="button" disabled={saving} onClick={() => { void leaveEditSession(); }}>
                    {t('doneEditing', '편집 완료')}
                  </PrimaryBtn>
                )}
              </HeaderActions>
            </PanelHeader>
            {/* 저장 충돌·이동 차단 경고 — 상시 밴드가 아니라 있을 때만 뜬다.
                밴드로 두면 평소에 빈 줄이 남아 상세가 3밴드가 된다. */}
            {autoState === 'stale' && signLocked && <SignLockedBar />}
            {autoState === 'stale' && !signLocked && <ConflictBar onSee={() => setHistoryOpen(true)} onReload={() => { void resolveStaleReload(); }} onOverwrite={() => { void resolveStaleOverwrite(); }} />}
            {autoState !== 'stale' && <CoeditTypingNotice users={presenceUsers} />}
            {conflict.stash && <ConflictStashNote stash={conflict.stash} onDrop={conflict.drop} />}
            {leaveBlocked && (
              <LeaveBlockedNote role="alert">
                {t('autosave.leaveBlocked', '저장하지 못한 변경이 있어 이동하지 못했습니다. 저장하거나 취소해 주세요.')}
              </LeaveBlockedNote>
            )}
            {(() => {
              // 폰 요약 줄 — 접혀 있어도 지금 값이 보인다(숨긴 채 바뀌어 있지 않게)
              const projName = scope.type === 'workspace' && projectDraft ? projectOptions.find(o => o.value === projectDraft)?.label : null;
              const taskN = (mode === 'edit' ? (detail?.linked_tasks?.length || 0) : pendingTaskCount);
              const parts: string[] = [];
              if (categoryDraft.trim()) parts.push(`#${categoryDraft.trim()}`);
              if (projName) parts.push(String(projName));
              if (taskN > 0) parts.push(t('metaSummary.tasks', { count: taskN, defaultValue: '업무 {{count}}' }) as string);
              if (mode === 'edit' && detail) parts.push(`${t('visibility.label', { defaultValue: '공개' }) as string}: ${visLabel(detail.vlevel)}`);
              return (
                <MetaSummaryBtn type="button" data-testid="docs-meta-summary" aria-expanded={metaOpenPhone}
                  onClick={() => setMetaOpenPhone(v => !v)}>
                  <MetaSummaryLabel>{t('metaSummary.label', '분류·연결')}</MetaSummaryLabel>
                  <MetaSummaryValue>{parts.length ? parts.join(' · ') : t('metaSummary.empty', '없음')}</MetaSummaryValue>
                  <MetaSummaryChevron $open={metaOpenPhone} aria-hidden="true">
                    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round"><polyline points="6 9 12 15 18 9"/></svg>
                  </MetaSummaryChevron>
                </MetaSummaryBtn>
              );
            })()}
            <MetaRow $phoneOpen={metaOpenPhone} data-testid="docs-meta-row">
              {/* ★ 카테고리 입력은 width:100% 라 행을 통째로 먹었고, 그래서 혼자 한 줄을 차지했다
                  (Irene: "카테고리 창이 너무 심하게 길어. 혼자 있을 이유가 없는데").
                  폭을 묶어 프로젝트·형태·공개·보안과 **한 줄**에 서게 한다. 좁아지면 자연히 접힌다. */}
              <MetaField $basis={180}>
                <CategoryCombobox
                  value={categoryDraft}
                  onChange={setCategoryDraft}
                  options={meta.categories.map(c => c.name)}
                  placeholder={t('categoryPlaceholder', '카테고리 (예: 매뉴얼, 가이드)') as string}
                />
              </MetaField>
              {scope.type === 'workspace' && (
                <MetaField $basis={200}>
                <PlanQSelect
                  size="sm"
                  options={projectOptions}
                  value={projectOptions.find(o => o.value === projectDraft) || null}
                  onChange={(opt) => setProjectDraft(opt ? Number((opt as PlanQSelectOption).value) : null)}
                  placeholder={tc(CONNECT_PROMPT.projectNone) as string}
                  isClearable
                  isSearchable
                />
                </MetaField>
              )}
              {/* 업무 연결 (2026-10-15) — 업무 결과물 첨부로 건다(DocTaskLinkField 머리말). 개인 보관함은 늘 나만 보기라
                  걸어도 업무 사람들에게 안 보인다 — 칸을 두지 않는다. 편집 세션마다 새로(editEpoch) — 새 문서에서 고른 업무가 다음 문서로 넘어가지 않게. */}
              {scope.type !== 'personal' && (mode === 'new' || (mode === 'edit' && detail)) && (
                <DocTaskLinkField
                  key={`doctask-${editEpoch}`}
                  postId={detail?.id ?? null}
                  businessId={detail?.business_id ?? scope.businessId}
                  tasks={(detail?.linked_tasks || []) as LinkedTaskRef[]}
                  onTasksChange={(list) => setDetail((prev) => (prev ? { ...prev, linked_tasks: list } : prev))}
                  fromTaskId={fromAction?.task.id ?? null}
                  onPendingChange={(ids) => { pendingTaskIdsRef.current = ids; setPendingTaskCount(ids.length); }}
                />
              )}
              {/* N+72-7 — 문서 ↔ 표 타입 toggle (편집 모드에서 변경 가능). 표→문서: 데이터 있으면 confirm 모달 */}
              {mode === 'edit' && detail && (
                <KindToggle role="tablist" aria-label={t('kind.label', '문서 형태') as string}>
                  <KindBtn type="button" role="tab" aria-selected={detail.kind !== 'table' && detail.kind !== 'survey'} $active={detail.kind !== 'table' && detail.kind !== 'survey'} onClick={() => changeKind('doc')}>
                    <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/><line x1="16" y1="13" x2="8" y2="13"/><line x1="16" y1="17" x2="8" y2="17"/></svg>
                    {t('kind.doc', '문서') as string}
                  </KindBtn>
                  <KindBtn type="button" role="tab" aria-selected={detail.kind === 'table'} $active={detail.kind === 'table'} onClick={() => changeKind('table')}>
                    <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><rect x="3" y="3" width="18" height="18" rx="2"/><line x1="3" y1="9" x2="21" y2="9"/><line x1="3" y1="15" x2="21" y2="15"/><line x1="9" y1="3" x2="9" y2="21"/><line x1="15" y1="3" x2="15" y2="21"/></svg>
                    {t('kind.table', '표') as string}
                  </KindBtn>
                  {/* 설문 v2 — 표 ↔ 설문은 같은 질문지(데이터 이동 없음), 문서 → 설문은 빈 질문지 */}
                  <KindBtn type="button" role="tab" data-testid="post-kind-survey" aria-selected={detail.kind === 'survey'} $active={detail.kind === 'survey'} onClick={() => changeKind('survey')}>
                    <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M9 11l2 2 4-4"/><rect x="3" y="3" width="18" height="18" rx="2"/></svg>
                    {t('kind.survey', '설문') as string}
                  </KindBtn>
                </KindToggle>
              )}
              {/* 편집 메타 패리티 — 상세에서 바꾸던 공개·보안을 편집 모드에서도 같은 줄에서 수정(Irene) */}
              {mode === 'edit' && detail && (
                <>
                  <VisibilityChip type="button" onClick={() => setVisModalOpen(true)} title={t('visibility.change', { defaultValue: '공개 범위 변경' }) as string}>
                    {t('visibility.label', { defaultValue: '공개' }) as string}: {visLabel(detail.vlevel)}
                  </VisibilityChip>
                  <MetaField $basis={160}>
                    <PlanQSelect
                      size="sm" isClearable={false} isSearchable={false}
                      value={{ value: detail.security_level || 'general', label: secLabel(detail.security_level || 'general') }}
                      options={(['general', 'internal', 'confidential'] as const).map((lv) => ({ value: lv, label: secLabel(lv) }))}
                      onChange={async (o) => {
                        const lv = (((o as { value?: string })?.value) || 'general') as 'general' | 'internal' | 'confidential';
                        try {
                          const r = await updatePostSecurityLevel(detail.id, lv);
                          setDetail(prev => prev ? { ...prev, security_level: lv, ...(r.revoked_share ? { share_token: null, vlevel: prev.vlevel === 'L4' ? 'L3' : prev.vlevel } : {}) } : prev);
                        } catch { /* keep current on error */ }
                      }}
                    />
                  </MetaField>
                </>
              )}
            </MetaRow>
            </StickyBands>
            <EditBody>
              {/* 서명 잠금이면 [고쳐서 다시 보내기] 가 있는 서명 진행을 편집 화면에도 꺼낸다 — 안내가 «아래 서명 진행» 을
                  가리키는데 그 칸이 보기 화면에만 있어 편집 중에는 누를 곳이 없었다(2026-10-22 Irene). 닫으면 잠금이 풀려
                  쓰던 글을 바로 저장한다. */}
              {/* 잠금이 아니어도 «다시 보내기» 차례면(회차를 닫고 고치는 중) 같은 칸이 [다시 보내기] 로 보인다 — 고친 뒤 무엇을
                  누를지 화면이 말한다(2026-10-23). 누르면 쓰던 글을 저장하고 보기로 나가 서명 받기 창을 연다(편집기 내용과
                  창이 읽는 문서가 엇갈리지 않게). */}
              {detail && (
                <SignatureProgressSection
                  postId={detail.id}
                  inferredKind={inferKindFromTitle(detail.title, detail.category)}
                  reloadTrigger={signReloadKey}
                  onlyResend={!signLocked}
                  onAddMore={() => {
                    // 잠금 중(서명 추가)은 종전대로 창만 연다 — 잠긴 동안 쓴 글은 저장되지 않으므로 편집을 나가면 사라진다
                    if (signLocked) { setSignOpen(true); return; }
                    void (async () => { if (await leaveEditSession()) setSignOpen(true); })();
                  }}
                  onChanged={() => setSignReloadKey(k => k + 1)}
                  onRoundClosed={() => {
                    setSignReloadKey(k => k + 1);
                    setSignLocked(false);
                    setAutoErr(null);
                    setAutoState('idle');
                    void runAutosaveRef.current?.();
                  }}
                />
              )}
              {fromAction && <FromTaskBanner handoff={fromAction} linkFailed={fromActionFailed} />}
              {error && <ErrorBar>{error}</ErrorBar>}
              {/* 다운로드 실패는 조용히 넘기지 않는다 — 이전엔 링크가 401 이어도 화면에 아무 말이 없었다 */}
              {dl.error && <ErrorBar>{dl.error}</ErrorBar>}
              {detail?.kind === 'survey' && detail.q_record_id ? (
                <SurveyPanel
                  recordId={detail.q_record_id} businessId={scope.businessId} editable
                  canSeeResponses={surveyMemberUp} tab={surveyTab} onTab={setSurveyTab}
                  onSend={() => setSurveySendOpen(true)} onPreview={() => setSurveyPreviewOpen(true)} publishReloadKey={surveyPublishKey}
                  descriptionSlot={(
                    <PostEditor value={contentDraft} onChange={handleContentChange} businessId={scope.businessId} projectId={scopeProjectId}
                      placeholder={t('survey.descriptionPh', '왜 이 설문을 보내는지 한두 문장') as string} borderless />
                  )}
                />
              ) : detail?.kind === 'table' && detail.q_record_id ? (
                <>
                  {/* 표 설명 — **원할 때만**(2026-10-11 Irene: "표 설명을 원할 때만 나와야 하는 거 아니야?").
                      닫혀 있으면 작은 «+ 표 설명 추가» 한 줄만, 열면 헤더+편집기. 설명이 이미 있으면 처음부터 열림. */}
                  {!tableDescOpen ? (
                    <DescAddBtn type="button" data-testid="table-desc-add" onClick={() => setTableDescOpen(true)}>
                      + {t('tableDescAdd', { defaultValue: '표 설명 추가' }) as string}
                    </DescAddBtn>
                  ) : (
                  <div className="pq-fullbleed" style={{ marginTop: -16 }}>
                    <DescToggleHeader type="button" onClick={() => setTableDescOpen(v => !v)} aria-expanded={tableDescOpen}>
                      <DescBoxLabel>{t('tableDescTitle', { defaultValue: '표 설명' }) as string}</DescBoxLabel>
                      <DescChevron $open={tableDescOpen}>
                        <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round"><polyline points="6 9 12 15 18 9"/></svg>
                        {tableDescOpen ? (t('tableDescCloseShort', { defaultValue: '닫기' }) as string) : (t('tableDescOpenShort', { defaultValue: '열기' }) as string)}
                      </DescChevron>
                    </DescToggleHeader>
                    {tableDescOpen && (
                      <PostEditor
                        value={contentDraft}
                        onChange={handleContentChange}
                        businessId={scope.businessId}
                        projectId={scopeProjectId}
                        placeholder={t('tableDescPlaceholder', '표에 대한 설명을 입력하세요 (선택)') as string}
                        borderless
                      />
                    )}
                  </div>
                  )}
                  {/* N+72-7 — 본문↔표 간격 (편집 모드) */}
                  <SectionGap />
                  <div className="pq-fullbleed"><PostTableGrid recordId={detail.q_record_id} businessId={scope.businessId} onConvertToSurvey={() => changeKind('survey')} /></div>
                </>
              ) : (
                <>
                  {/* 운영 — AI 생성물 재생성 (지시 기반). AI 로 만든 새 문서일 때만 노출 */}
                  {mode === 'new' && aiCtx && (
                    <AiRegenRow>
                      <AiRegenerateBar busy={regenBusy} onRegenerate={regenerateDoc} />
                    </AiRegenRow>
                  )}
                  {/* 툴바를 위 MetaRow 회색 구분선에 바로 붙인다(Body gap 16 상쇄) — 편집 상단 여백 제거(Irene) */}
                  <div className="pq-fullbleed" style={{ marginTop: -16 }}>
                    <PostEditor value={contentDraft} onChange={handleContentChange} businessId={scope.businessId} projectId={scopeProjectId} placeholder={t('contentPlaceholder', '본문을 작성하세요…') as string} borderless />
                  </div>
                </>
              )}

              <AttachSection>
                <AttachTitle>{t('attachments', '첨부 파일·문서')}</AttachTitle>
                {/* 알아야 하는 운영 기준은 **그 자리에서 한 줄로**(Irene 2026-08-30).
                    규칙을 설명하지 않고 "이 문서 기준으로 어떻게 되는지" 상태로 쓴다 —
                    안 쓰면 "왜 다른 사람에겐 안 보이지" 를 나중에 겪는다(#378). */}
                <AttachScopeHint>{attachScopeHint}</AttachScopeHint>
                {mode === 'edit' && detail && detail.attachments.length > 0 && (
                  <AttachList>
                    {detail.attachments.map(a => (
                      <AttachRow key={a.id}>
                        {/* 링크로 열면 401 이다(라우트가 Bearer 요구) — 인증 fetch 로 받는다.
                            받는 동안 이름 옆에 진행 상태를 붙여 "안 눌리는 것" 처럼 보이지 않게 한다. */}
                        <AttachName as="button" type="button"
                          disabled={dl.downloading}
                          onClick={() => a.file?.download_url && dl.start(a.file.download_url, a.file.file_name || 'file', String(a.id))}>
                          {a.file?.file_name || '—'}
                          {dl.downloadingId === String(a.id) && ` · ${dl.progressText}`}
                        </AttachName>
                        <RemoveBtn type="button" onClick={() => detachOne(a.id)} title={t('actions.remove', '제거') as string} aria-label={t('actions.remove', '제거') as string}>×</RemoveBtn>
                      </AttachRow>
                    ))}
                  </AttachList>
                )}
                <AttachmentField
                  businessId={scope.businessId}
                  uploads={pendingUploads}
                  onUploadsChange={setPendingUploads}
                  existingFileIds={pendingExistingIds}
                  onExistingFileIdsChange={setPendingExistingIds}
                  includePosts
                  existingPostIds={pendingPostIds}
                  onExistingPostIdsChange={setPendingPostIds}
                />
              </AttachSection>
            </EditBody>
          </>
        ) : detail ? (
          <>
            <StickyBands data-testid="docs-detail-bands">
            <StickyPanelHeader>
              <TitleRow>
                {!pinned && (
                <MobileBackBtn $always={isProject} type="button" onClick={() => setDetail(null)} aria-label={t('back', '뒤로') as string}>
                  <BackChevron />
                </MobileBackBtn>
                )}
                <PanelSubTitle>
                  {detail.is_pinned && <PinDot title={t('list.pinned', '고정됨') as string} />}
                  {detail.title}
                {/* 양방향 링크: 자료정리에서 파생된 후속 문서면 parent 로 가는 링크 */}
                {detail.parent_post_id && (
                  <ParentLink href={`/docs/brief/${detail.parent_post_id}`}
                    title={t('parentLink.title', '원본 자료정리로 이동') as string}>
                    ← {t('parentLink.label', '자료정리에서 파생')}
                  </ParentLink>
                )}
              </PanelSubTitle>
              </TitleRow>
              <HeaderActions>
              {/* 가끔 쓰는 것 — 글자 라벨을 달아 메뉴로. 순서는 쓰는 빈도 순, 삭제만 구분선 뒤. */}
              <OverflowMenu
                label={t('actions.more', { defaultValue: '더보기' }) as string}
                data-testid="post-more"
                items={[
                  {
                    key: 'history', testId: 'post-history',
                    label: t('history.title', '변경 기록') as string,
                    icon: <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M3 3v5h5" /><path d="M3.05 13A9 9 0 1 0 6 5.3L3 8" /><path d="M12 7v5l4 2" /></svg>,
                    onClick: () => setHistoryOpen(true),
                  },
                  {
                    key: 'knowledge', testId: 'post-send-knowledge',
                    label: t('actions.menuSendToKnowledge', { defaultValue: 'Q info 로 보내기' }) as string,
                    disabled: knowledgeBusy,
                    icon: <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M12 6.253v13"/><path d="M12 6.253C10.832 5.477 9.246 5 7.5 5 5.754 5 4.168 5.477 3 6.253v13C4.168 18.477 5.754 18 7.5 18s3.332.477 4.5 1.253"/><path d="M12 6.253C13.168 5.477 14.754 5 16.5 5c1.746 0 3.332.477 4.5 1.253v13C19.832 18.477 18.246 18 16.5 18s-3.332.477-4.5 1.253"/></svg>,
                    onClick: () => sendToKnowledge(detail),
                  },
                  {
                    key: 'template', testId: 'post-save-template',
                    label: t('actions.saveAsTemplate', '템플릿으로 저장') as string,
                    icon: <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M19 21l-7-5-7 5V5a2 2 0 0 1 2-2h10a2 2 0 0 1 2 2z"/></svg>,
                    onClick: () => { setSaveTplName(detail.title); setSaveTplDesc(''); setSaveTplError(null); setSaveTplOpen(true); },
                  },
                  {
                    key: 'pdf', testId: 'post-download-pdf',
                    label: t('actions.downloadPdf', 'PDF 다운로드') as string,
                    disabled: pdfBusy,
                    icon: <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/></svg>,
                    onClick: () => {
                      if (pdfBusy) return;            // 중복 제출 가드 (UI_DESIGN_GUIDE §1.8)
                      setPdfBusy(true); setError(null);
                      void downloadPostPdf(detail.id, detail.title)
                        .catch((e: unknown) => {
                          // 서버가 보낸 사유가 있으면 그대로, 없으면 이 동작의 문구로.
                          const msg = (e as Error)?.message;
                          setError(msg && !/^HTTP \d+$/.test(msg) ? msg : (t('actions.pdfError', 'PDF 생성 실패') as string));
                        })
                        .finally(() => setPdfBusy(false));
                    },
                  },
                  {
                    key: 'docx', testId: 'post-download-docx',
                    label: t('actions.menuDownloadDocx', { defaultValue: '워드로 내려받기' }) as string,
                    disabled: docxBusy,
                    icon: <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/><path d="M8 13l1.5 5L12 14l2.5 4L16 13"/></svg>,
                    onClick: () => {
                      if (docxBusy) return;
                      setDocxBusy(true); setError(null);
                      void downloadPostDocx(detail.id, detail.title)
                        .catch((e: unknown) => {
                          const msg = (e as Error)?.message;
                          setError(msg && !/^HTTP \d+$/.test(msg) ? msg : (t('actions.docxError', '워드 파일 생성 실패') as string));
                        })
                        .finally(() => setDocxBusy(false));
                    },
                  },
                  {
                    key: 'print', testId: 'post-print',
                    label: t('actions.menuPrint', { defaultValue: '인쇄' }) as string,
                    icon: <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><polyline points="6 9 6 2 18 2 18 9"/><path d="M6 18H4a2 2 0 0 1-2-2v-5a2 2 0 0 1 2-2h16a2 2 0 0 1 2 2v5a2 2 0 0 1-2 2h-2"/><rect x="6" y="14" width="12" height="8"/></svg>,
                    onClick: () => window.print(),
                  },
                  {
                    key: 'delete', testId: 'post-delete', dividerBefore: true, danger: true,
                    label: t('delete', '삭제') as string,
                    icon: <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><polyline points="3 6 5 6 21 6"/><path d="M19 6l-2 14a2 2 0 0 1-2 2H9a2 2 0 0 1-2-2L5 6"/><path d="M10 11v6M14 11v6"/><path d="M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/></svg>,
                    onClick: () => setDeleteTarget(detail),
                  },
                ]}
              />
              </HeaderActions>
            </StickyPanelHeader>
            {/* ★ 액션을 헤더에서 **내려** 제목 아래 한 줄로 (Irene 2026-09-05:
                "서브헤더에 버튼이 너무 많아. 제목이 보이지도 않아. 좌측 검색창 가로라인 맞춰서 헤더 2줄로").
                실측(1440px): 헤더 920px 중 액션이 534px 을 먹고 제목 칸은 304px — 33% 였다.
                밴드 높이는 좌측 검색줄과 같다(12 + 36 + 8) — 좌우 밑줄이 같은 y 에서 이어진다.
                자주 쓰는 셋(편집·공유·서명 받기)만 남기고 나머지는 ⋯ 로 접는다. 접힌 쪽은
                아이콘 전용이라 hover 해야 알 수 있었던 것들이라, 글자 라벨이 붙어 오히려 읽힌다. */}
            <ViewMeta>
              <MetaLeft>
              <span>{displayName(detail.author, i18n.language) || '—'}</span>
              <span>·</span>
              <span>{formatDate(detail.created_at)}</span>
              {detail.editor && detail.editor.id !== detail.author?.id && (
                <><span>·</span><span>{t('editedBy', '수정: {{name}}', { name: detail.editor.name })}</span></>
              )}
              {detail.updated_at && detail.updated_at !== detail.created_at && (
                <><span>·</span><span title={formatDate(detail.updated_at)}>{formatTimeAgo(detail.updated_at)}</span></>
              )}
              <PresenceChips users={presenceUsers} />
              {detail.category && (
                <CategoryTag
                  type="button"
                  onClick={() => setFilter({ kind: 'category', name: detail.category! })}
                  title={t('filter.filterBy', '이 카테고리로 필터') as string}
                >
                  #{detail.category}
                </CategoryTag>
              )}
              {detail.project && (
                <ProjectTag $color={detail.project.color || '#14B8A6'}>
                  <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" style={{ marginRight: 2 }}><path d="M3 7a2 2 0 0 1 2-2h4l2 3h8a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"/></svg>
                  {detail.project.name}
                </ProjectTag>
              )}
              {/* ★ 공개 범위 칩은 **좌측 메타**에 둔다 (Irene 2026-09-06:
                  "이 표시만 버튼들과 높이값이 다른데 좌측 날짜 뒤로 붙이는 거 어때?").
                  우측은 36px 액션 버튼 줄이라 22px 칩 혼자 어긋나 보였다. 좌측은 작성자·날짜·
                  분류·프로젝트가 모두 작은 메타라 높이가 맞는다. */}
              <VisibilityChip
                type="button"
                onClick={() => setVisModalOpen(true)}
                title={t('visibility.change', { defaultValue: '공개 범위 변경' }) as string}
              >
                {t('visibility.label', { defaultValue: '공개' }) as string}: {visLabel(detail.vlevel)}
              </VisibilityChip>
              {/* ★ 2026-09-10 (Irene): "공유 중 이런 표시도 왼쪽으로 공개: 팀 옆으로 가야지.
                  왜 오른쪽에 붙어있어?" — 공개 범위 칩을 좌측으로 옮긴 2026-09-06 과 **같은 이유**다.
                  우측은 36px 액션 버튼 줄이고 이건 22px 상태 칩이라 혼자 높이가 어긋난다.
                  게다가 "공개: 팀" 과 "공유 중" 은 같은 것(누가 볼 수 있는가)을 말하므로 붙어 있어야
                  한 눈에 읽힌다. 보안등급 배지도 같은 성격이라 함께 옮긴다. */}
              {detail.share_token && (
                <ShareTag title={t('share.publicHint', '공개 링크가 활성화되어 있습니다') as string}>
                  <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" style={{ marginRight: 2 }}><path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.72"/><path d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.72-1.72"/></svg>
                  {t('share.publicBadge', '공유 중')}
                </ShareTag>
              )}
              {/* D4 #62 — 보안등급 배지 (일반은 노이즈 0, 자동 숨김) */}
              <SecurityLevelBadge level={detail.security_level} />
              {/* 이 문서를 결과물·액션으로 건 업무(보는 사람 기준) — docs/TASK_ACTIONS_DESIGN.md §4.2 */}
              <LinkedTaskChips tasks={detail.linked_tasks} />
              </MetaLeft>
              <MetaRight>
              {/* ★ 액션을 **메타 줄 오른쪽**으로 (Irene 2026-09-05: "점점점 메뉴만 위로 올리면 어때?
                  그리고 2, 3째줄 한줄로 맞추고 버튼들은 우측 정렬이 맞겠는데").
                  별도 액션 밴드(DetailActionBar)가 사라지고 상세는 **두 밴드**로 끝난다.
                  실측(1440px): ⋯ 만 헤더에 남기면 제목 몫이 304px → 872px 이 된다. */}
                <MetaActions>
                {/* AI 수정 — «AI 작성» 과 같은 ★ 버튼(AiActionButton)을 같은 줄 맨 앞에 (Irene 2026-10-11:
                    "별표 넣고 똑같이 헤더에 버튼이 있어야 하는 거 아니야? AI로 작성할 때처럼 수정도.")
                    ⋯ 메뉴 안에 두니 찾을 수 없었다. 같은 일을 하는 문을 두 곳에 두지 않는다 — 메뉴에서는 뺐다. */}
                {detail.kind === 'survey' ? (
                  // 설문 — AI 수정 자리에 [보내기](밴드2 액션 3개 계약). 보내기는 멤버 이상만
                  surveyMemberUp && (
                    <EditBtn type="button" data-testid="post-survey-send" onClick={() => setSurveySendOpen(true)}
                      title={t('survey.sendHint', '고객에게 메일로 보내 응답을 받아요') as string} aria-label={t('survey.send', '보내기') as string}>
                      <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" style={{ marginRight: 4 }}><line x1="22" y1="2" x2="11" y2="13"/><polygon points="22 2 15 22 11 13 2 9 22 2"/></svg>
                      {t('survey.send', '보내기')}
                    </EditBtn>
                  )
                ) : canEditNow && (
                <AiActionButton size="filter" testId="post-ai-edit"
                  onClick={() => setAiEditOpen(true)}
                  label={t('aiEdit.btn', 'AI 수정') as string}
                  title={t('aiEdit.btnHint', 'AI 에게 고칠 것을 말하면 수정안을 만들어 수정 전·후를 먼저 보여 줘요') as string} />
                )}
                {/* 고칠 수 없는 사람(고객 등)에게는 [편집] 을 내지 않는다 — 판정은 서버 can_edit(PUT 과 같은 술어).
                    서명 요청이 살아 있어 잠긴 문서도 같다 — 고치는 문은 서명 진행의 [고쳐서 다시 보내기] 하나다(2026-10-22, Irene:
                    "고쳐서 다시보내기를 눌러야 하면 위에 편집버튼이 없어야지"). 잠금은 서버 edit_locked(PUT 409 와 같은 함수) */}
                {canEditNow && (
                <EditBtn type="button" data-testid="post-edit" onClick={startEdit}
                  title={t('edit', '편집') as string} aria-label={t('edit', '편집') as string}>
                  <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" style={{ marginRight: 4 }}><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/><path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"/></svg>
                  {t('edit', '편집')}
                </EditBtn>
                )}
                {/* 복사 — **아이콘만**(Irene). 밴드2 액션 3개 계약을 지키려고 글자를 빼고 title·aria 로 말한다. */}
                <IconActionBtn
                  type="button"
                  data-testid="post-duplicate"
                  onClick={() => { void duplicateCurrent(); }}
                  disabled={dupBusy}
                  title={t('duplicate.hint', { defaultValue: '이 문서를 복사해 새 문서로 시작 (서명·공유 링크는 복사되지 않습니다)' }) as string}
                  aria-label={t('duplicate.btn', { defaultValue: '복사' }) as string}
                >
                  <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
                    <rect x="9" y="9" width="13" height="13" rx="2"/>
                    <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/>
                  </svg>
                </IconActionBtn>
                <PrimaryBtn type="button" data-testid="post-share" onClick={() => setShareOpen(true)} title={t('share.headerHint', '외부 사람과 공유 — 링크 / 이메일 / 만료') as string}>
                  <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" style={{ marginRight: 4 }}><circle cx="18" cy="5" r="3"/><circle cx="6" cy="12" r="3"/><circle cx="18" cy="19" r="3"/><line x1="8.59" y1="13.51" x2="15.42" y2="17.49"/><line x1="15.41" y1="6.51" x2="8.59" y2="10.49"/></svg>
                  {t('share.button', '공유')}
                </PrimaryBtn>
                <SignBtn type="button" data-testid="post-sign" onClick={() => setSignOpen(true)} title={t('sign.headerHint', '서명자에게 이메일로 서명 요청') as string}>
                  <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" style={{ marginRight: 4 }}><path d="M12 19l7-7 3 3-7 7-3-3z"/><path d="M18 13l-1.5-7.5L2 2l3.5 14.5L13 18l5-5z"/><path d="M2 2l7.586 7.586"/><circle cx="11" cy="11" r="2"/></svg>
                  {t('sign.button', '서명 받기')}
                </SignBtn>
                </MetaActions>
            
              </MetaRight>
            </ViewMeta>
            {conflict.stash && <ConflictStashNote stash={conflict.stash} onDrop={conflict.drop} />}
            </StickyBands>
            <Body>
              {/* ★ 보기 모드에는 오류 자리가 아예 없었다 — PDF·워드 생성 실패가 setError 로만 남고
                  화면에는 아무 말도 안 나왔다(조용한 실패). 편집 모드와 같은 자리를 준다. */}
              {error && <ErrorBar>{error}</ErrorBar>}
              {dl.error && <ErrorBar>{dl.error}</ErrorBar>}
              {aiEditDone && aiEditDone.postId === detail.id && (
                <AiEditDoneBar role="status" data-testid="post-ai-edit-done">
                  <span>{aiEditDone.undone
                    ? t('aiEdit.undone', '적용을 되돌렸어요.')
                    : t('aiEdit.done', 'AI 수정안 {{n}}곳을 문서에 적용했어요.', { n: aiEditDone.applied })}</span>
                  {!aiEditDone.undone && aiEditDone.base && (
                    <AiEditUndoBtn type="button" data-testid="post-ai-edit-undo" disabled={!!aiEditDone.undoing}
                      onClick={() => {
                        const cur = aiEditDone;
                        if (!cur.base || cur.undoing) return;
                        setAiEditDone({ ...cur, undoing: true });
                        void (async () => {
                          try {
                            await applyPostAiEdit(cur.postId, {
                              base_updated_at: cur.base!, undo: true,
                              changes: cur.changes.map((c) => ({ id: c.id, before: c.after, after: c.before })),
                            });
                          } catch (e) {
                            setAiEditDone({ ...cur, undoing: false });
                            setError((e as Error).message === 'stale_edit'
                              ? t('aiEdit.undoStale', '적용한 뒤 문서가 또 바뀌어 되돌리지 못했어요. [⋯ > 변경 기록]에서 되돌려 주세요.') as string
                              : t('history.restoreFailed', '되돌리지 못했습니다') as string);
                            return;
                          }
                          const fresh = await fetchPost(cur.postId); if (fresh) setDetail(fresh);
                          setTableReloadKey((k) => k + 1);
                          setAiEditDone({ ...cur, undoing: false, undone: true });
                          await load();
                        })();
                      }}>
                      {aiEditDone.undoing ? t('history.restoring', '되돌리는 중…') : t('aiEdit.undo', '되돌리기')}
                    </AiEditUndoBtn>
                  )}
                  <AiEditCloseBtn type="button" aria-label={t('close', '닫기') as string} onClick={() => setAiEditDone(null)}>✕</AiEditCloseBtn>
                </AiEditDoneBar>
              )}
              {/* 서명 진행 — 본문 **위**(2026-10-22). 아래에 있으면 긴 계약서에서 [고쳐서 다시 보내기]·[서명 추가] 를 찾으러
                  맨 끝까지 내려가야 했다. 셋째 밴드(고정)로 올리지 않는다 — 상세는 두 밴드 계약. 대신 접힌다. */}
              <SignatureProgressSection
                postId={detail.id}
                inferredKind={inferKindFromTitle(detail.title, detail.category)}
                reloadTrigger={signReloadKey}
                onAddMore={() => setSignOpen(true)}
                onChanged={() => setSignReloadKey(k => k + 1)}
                onRoundClosed={() => {
                  // 확인창 버튼이 «닫고 고치기» — 닫았으면 바로 편집으로 간다([편집] 은 잠금 동안 숨어 있다)
                  setSignReloadKey(k => k + 1);
                  startEdit();
                }}
              />
              {/* 보안등급 상시노출 SecurityRow 제거 — 뷰는 MetaBar chip(일반 자동숨김), 변경은 편집 모드 메타에서(Irene) */}
              {/* 운영 #338 — 긴 문서의 목차. 본문에서 파생하므로 옛 문서에서도 바로 뜬다.
                  제목이 2개 미만이면 스스로 아무것도 그리지 않는다. 인쇄에는 넣지 않는다
                  (data-print-area 밖 — 종이에서는 클릭 이동이 의미가 없다). */}
              <DocToc content={detail.content_json} containerRef={docBodyRef} />
              <div data-print-area className="pq-fullbleed" style={{ marginTop: -16 }} ref={docBodyRef}>
                <PrintOnlyTitle>{detail.title}</PrintOnlyTitle>
                {detail.kind === 'survey' && detail.q_record_id ? (
                  // 설문 kind — 네 탭(질문지·응답·통계·발행). 보기 모드: 질문지·응답은 읽기만
                  <SurveyPanel
                    recordId={detail.q_record_id} businessId={scope.businessId} editable={false}
                    canSeeResponses={surveyMemberUp} tab={surveyTab} onTab={setSurveyTab}
                    onSend={() => setSurveySendOpen(true)} onPreview={() => setSurveyPreviewOpen(true)} publishReloadKey={surveyPublishKey}
                    descriptionSlot={docHasContent(detail.content_json) ? <PostEditor value={detail.content_json} onChange={() => {}} editable={false} borderless /> : undefined}
                  />
                ) : detail.kind === 'table' && detail.q_record_id ? (
                  // 표 kind — 본문 설명(있으면) + 표 그리드 (보기 모드: read-only)
                  <>
                    {/* 설명은 보이는 내용이 있을 때만 — 빈 설명이 빈 칸·간격으로 남지 않게 */}
                    {docHasContent(detail.content_json) && (
                      <PostEditor value={detail.content_json} onChange={() => {}} editable={false} borderless />
                    )}
                    {/* N+72-7 — 본문↔표 사이 간격 (사용자 호소 "들러붙어 보기 안좋아") */}
                    {docHasContent(detail.content_json) && <SectionGap />}
                    <PostTableGrid key={`tbl-${tableReloadKey}`} recordId={detail.q_record_id} businessId={scope.businessId} readOnly onConvertToSurvey={() => changeKind('survey')} />
                  </>
                ) : signedDoc?.has_signatures && signedDoc.html ? (
                  // 서명본 — 고정본 + 서명. 조립은 서버 한 곳이라 PDF·공유 링크와 같은 그림이다.
                  //   ★ 편집기로 그리지 않는다 — 편집기는 서명란을 «빈 자리» 로만 안다.
                  <SignedBody
                    data-testid="doc-signed-body"
                    dangerouslySetInnerHTML={{ __html: sanitizeRichText(signedDoc.html) }}
                  />
                ) : (
                  <PostEditor value={detail.content_json} onChange={() => {}} editable={false} borderless />
                )}
              </div>


              {/* 보기 모드 — 첨부도 연결도 없으면 섹션 자체 숨김 */}
              {(detail.attachments.length > 0 || (detail.linked_posts && detail.linked_posts.length > 0)) && (
                <AttachSection>
                  <AttachTitle>{t('attachments', '첨부 파일·문서')}</AttachTitle>
                {/* 알아야 하는 운영 기준은 **그 자리에서 한 줄로**(Irene 2026-08-30).
                    규칙을 설명하지 않고 "이 문서 기준으로 어떻게 되는지" 상태로 쓴다 —
                    안 쓰면 "왜 다른 사람에겐 안 보이지" 를 나중에 겪는다(#378). */}
                <AttachScopeHint>{attachScopeHint}</AttachScopeHint>
                  {detail.attachments.length > 0 && (
                    <AttachList>
                      {detail.attachments.map(a => (
                        <AttachRow key={a.id}>
                          <AttachName as="button" type="button"
                            disabled={dl.downloading}
                            onClick={() => a.file?.download_url && dl.start(a.file.download_url, a.file.file_name || 'file', String(a.id))}>
                            {a.file?.file_name || '—'}
                            {dl.downloadingId === String(a.id) && ` · ${dl.progressText}`}
                          </AttachName>
                          <RemoveBtn type="button" onClick={() => detachOne(a.id)} title={t('actions.remove', '제거') as string} aria-label={t('actions.remove', '제거') as string}>×</RemoveBtn>
                        </AttachRow>
                      ))}
                    </AttachList>
                  )}
                  {detail.linked_posts && detail.linked_posts.length > 0 && (
                    <AttachList>
                      {detail.linked_posts.map(lp => (
                        <AttachRow key={`lp-${lp.id}`}>
                          <AttachName as="a" href={`/docs?post=${lp.id}`}>
                            {lp.kind === 'table' ? '📊 ' : '📄 '}{lp.title}
                          </AttachName>
                        </AttachRow>
                      ))}
                    </AttachList>
                  )}
                </AttachSection>
              )}

              {/* 문서 댓글 (2026-10-15, docs/DOC_COMMENTS_DESIGN.md) — 보기 모드에만. 볼 범위는 서버가 정한다 */}
              <DocCommentsSection
                key={`cm-${detail.id}`}
                postId={detail.id}
                businessId={detail.business_id ?? scope.businessId}
                projectId={detail.project_id ?? null}
              />
            </Body>
          </>
        ) : (detailStatus === 'not_found' || detailStatus === 'forbidden' || detailStatus === 'error' || detailStatus === 'other_workspace') ? (
          /* 못 불러온 것 — "아직 안 골랐음"(아래 온보딩)과 **다른 상태**다 (2026-08-30) */
          <DetailFallback
            status={detailStatus}
            businessId={otherWsBizId}
            onRetry={activeId ? () => setActiveId((v) => v) : undefined}
            onBack={pinned ? undefined : () => setActiveId(null)}
          />
        ) : (
          <EmptyState
            icon={(
              <svg width="36" height="36" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
                <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/>
                <polyline points="14 2 14 8 20 8"/>
                <line x1="16" y1="13" x2="8" y2="13"/>
                <line x1="16" y1="17" x2="8" y2="17"/>
                <polyline points="10 9 9 9 8 9"/>
              </svg>
            )}
            title={t('empty.title', '문서를 시작하세요') as string}
            description={(
              <>
                {t('empty.line1', '매뉴얼 · 가이드 · 공지 · 회의록 — 팀이 함께 읽는 문서를 만들어 보세요.')}
                <br />
                {t('empty.line2', '왼쪽 목록에서 기존 문서를 선택하거나, 새로 작성할 수 있습니다.')}
              </>
            )}
            ctaLabel={t('newDropdown.blankLabel', { defaultValue: '빈 문서' }) as string}
            ctaIcon={(
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round">
                <line x1="12" y1="5" x2="12" y2="19"/>
                <line x1="5" y1="12" x2="19" y2="12"/>
              </svg>
            )}
            onCta={startNew}
            secondaryCtaLabel={t('newDropdown.tableLabel', { defaultValue: '표' }) as string}
            onSecondaryCta={() => { setAiIntent('manual'); setAiDefaultMode('table'); setAiOpen(true); }}
          />
        )}
      </Content>
      )}

      <ConfirmDialog
        isOpen={!!deleteTarget}
        onClose={() => setDeleteTarget(null)}
        onConfirm={onDelete}
        title={t('deleteTitle', '문서 삭제') as string}
        message={t('deleteMessage', '"{{title}}" 문서를 삭제할까요? 이 작업은 되돌릴 수 없습니다.', { title: deleteTarget?.title || '' }) as string}
        confirmText={t('delete', '삭제') as string}
        cancelText={t('cancel', '취소') as string}
        variant="danger"
      />

      <TrashDrawer
        open={trashOpen}
        initialTab="doc"
        businessId={scope.businessId}
        projectId={scope.type === 'project' ? scope.projectId : undefined}
        onClose={() => setTrashOpen(false)}
        onChanged={() => { void loadMeta(); void load(); }}
      />

      {/* 운영 #401 — 분류 삭제. 몇 건이 분류를 잃는지 **먼저 말하고** 지운다.
          (문서 자체는 남는다 — 분류만 비워진다) */}
      <ConfirmDialog
        isOpen={!!catDeleting}
        onClose={() => setCatDeleting(null)}
        onConfirm={async () => {
          const target = catDeleting; setCatDeleting(null);
          if (!target) return;
          try {
            await deleteCategory(target.id ?? await ensureCatId(target));
            await loadMeta(); await load();
            if (filter.kind === 'category' && filter.name === target.name) setFilter({ kind: 'all' });
          } catch (e) { setError(mapApiError(e, tErr)); }
        }}
        title={t('cat.deleteTitle', { defaultValue: '분류 삭제' }) as string}
        message={(catDeleting && catDeleting.count > 0
          ? t('cat.deleteMessageInUse', {
              name: catDeleting.name, count: catDeleting.count,
              defaultValue: '"{{name}}" 분류를 삭제할까요? 이 분류의 문서 {{count}}건은 그대로 남고 분류만 비워집니다.',
            })
          : t('cat.deleteMessage', { name: catDeleting?.name || '', defaultValue: '"{{name}}" 분류를 삭제할까요?' })) as string}
        confirmText={t('delete', '삭제') as string}
        cancelText={t('cancel', '취소') as string}
        variant="danger"
      />

      {/* 설문 v2 — 보내기(받는 사람 → 주소 확인 → 보내기) · 응답 화면 미리보기 */}
      {detail?.kind === 'survey' && detail.q_record_id && (
        <>
          <SurveySendModal open={surveySendOpen} onClose={() => setSurveySendOpen(false)} recordId={detail.q_record_id} surveyTitle={detail.title}
            onSent={() => { setSurveyTab('publish'); setSurveyPublishKey((k) => k + 1); }} />
          <SurveyPreviewModal open={surveyPreviewOpen} onClose={() => setSurveyPreviewOpen(false)} recordId={detail.q_record_id} />
        </>
      )}

      {/* N+72-7 — 표→문서 변경 시 표 데이터 사라짐 확인 (force_kind_change=true) */}
      <ConfirmDialog
        isOpen={pendingKindChange === 'doc'}
        onClose={() => setPendingKindChange(null)}
        onConfirm={() => { doKindChange('doc', true); setPendingKindChange(null); }}
        title={t('kind.changeToDocTitle', '문서로 변경') as string}
        message={t('kind.changeToDocMsg', '표의 컬럼·데이터가 모두 사라집니다. 계속하시겠습니까?') as string}
        confirmText={t('kind.changeToDocConfirmBtn', '문서로 변경') as string}
        cancelText={t('cancel', '취소') as string}
        variant="danger"
      />

      {detail && shareOpen && (
        <PostShareModal
          open={shareOpen}
          onClose={() => setShareOpen(false)}
          post={detail}
          onChanged={updated => setDetail(updated)}
        />
      )}

      {/* N+67 — visibility 변경 모달 (VisibilityField wrapper) */}
      {detail && (
        <VisibilityChangeModal
          open={visModalOpen}
          current={(detail.vlevel as 'L1'|'L2'|'L3'|'L4') || 'L3'}
          currentProjectId={detail.project_id ?? null}
          currentTargetMemberIds={detail.target_member_ids ?? null}
          canChooseL2
          projects={visProjects.map(p => ({ id: p.id, name: p.name }))}
          members={visMembers}
          clients={visClients.map(c => ({ id: c.id, display_name: c.display_name, biz_name: c.biz_name, company_name: c.company_name }))}
          onConfirm={async ({ level, projectId }) => {
            try {
              const r = await updatePostVisibility(detail.id, {
                level,
                ...(projectId ? { project_id: projectId } : {}),
              });
              setDetail(prev => prev ? { ...prev, vlevel: r.vlevel as 'L1'|'L2'|'L3'|'L4', project_id: r.project_id, share_token: r.share_token ?? prev.share_token } : prev);
            } catch (e) { /* keep modal open on error */ throw e; }
          }}
          onClose={() => setVisModalOpen(false)}
        />
      )}

      {aiOpen && (
        <PostAiModal
          open={aiOpen}
          onClose={() => { setAiOpen(false); setAiDefaultMode(undefined); setAiInitialBriefText(undefined); setAiInitialBriefTitle(undefined); }}
          businessId={scope.businessId}
          projectId={scope.type === 'project' ? scope.projectId : null}
          onGenerate={startFromAi}
          onBlank={startNew}
          intent={aiIntent}
          defaultMode={aiDefaultMode}
          initialBriefText={aiInitialBriefText}
          initialBriefTitle={aiInitialBriefTitle}
          onTableCreated={async (id) => {
            // #96 — 표 생성 후 in-place 진입 (프로젝트 scope 에서도 페이지 이탈 없이). new_table=1 로 edit 모드.
            if (!(await leaveEditSession())) return;   // #252 — 편집 중이었으면 먼저 마무리
            pendingNewTableRef.current = id;           // #336 — URL 반영 타이밍과 무관하게 편집 모드로
            setActiveId(id);
            setSearchParams(prev => {
              const sp = new URLSearchParams(prev);
              sp.set('post', String(id));
              sp.set('new_table', '1');
              return sp;
            }, { replace: true });
            load();
          }}
        />
      )}


      {detail && signOpen && (
        <PostSignatureModal
          open={signOpen}
          onClose={() => setSignOpen(false)}
          post={detail}
          onSent={() => setSignReloadKey(k => k + 1)}
          // 저장 응답에는 linked_posts·표시명(author/editor)이 없다(GET 에만 있다) — 통째로 대입하면 상세의 연결 문서 칩이
          //   사라지고 이름이 원이름으로 떨어진다(Fable 2026-10-05). 같은 파일의 다른 저장처럼 덧입힌다.
          onPostUpdated={(saved) => setDetail((prev) => (prev ? {
            ...prev, ...saved, linked_posts: prev.linked_posts, author: prev.author, editor: prev.editor,
          } : saved))}
          onOpenEditor={() => { setSignOpen(false); startEdit(); }}
        />
      )}

      {detail && (
        <PostAiEditDrawer
          key={detail.id}
          open={aiEditOpen}
          postId={detail.id}
          onClose={() => setAiEditOpen(false)}
          onApplied={({ applied, baseUpdatedAt, changes }) => {
            const pid = detail.id;
            setAiEditDone({ postId: pid, applied, base: baseUpdatedAt, changes });
            setTableReloadKey((k) => k + 1);
            void (async () => { const fresh = await fetchPost(pid); if (fresh) setDetail(fresh); await load(); })();
          }}
        />
      )}
      {detail && (
        <PostHistoryPanel
          postId={detail.id}
          open={historyOpen}
          isTable={detail.kind === 'table'}
          onClose={() => setHistoryOpen(false)}
          onRestored={() => { void (async () => { const fresh = await fetchPost(detail.id); if (fresh) setDetail(fresh); await load(); })(); }}
        />
      )}
      {saveTplOpen && (
        <ModalBackdrop onClick={() => !saveTplBusy && setSaveTplOpen(false)}>
          <ModalDialog onClick={e => e.stopPropagation()} role="dialog" aria-modal="true" aria-label={t('saveTpl.title', '템플릿으로 저장') as string}>
            <ModalHead>
              <ModalTitle>{t('saveTpl.title', '템플릿으로 저장')}</ModalTitle>
              <ModalClose type="button" onClick={() => !saveTplBusy && setSaveTplOpen(false)} aria-label="Close">
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
              </ModalClose>
            </ModalHead>
            <ModalBody>
              <ModalSub>{t('saveTpl.sub', '현재 본문을 워크스페이스 템플릿으로 저장합니다. 다음 새 글 작성 시 검색해서 사용할 수 있습니다.')}</ModalSub>
              <SaveTplField>
                <SaveTplLabel>{t('saveTpl.name', '템플릿 이름')} *</SaveTplLabel>
                <TplSearchInput type="text" value={saveTplName} onChange={e => setSaveTplName(e.target.value)} placeholder={t('saveTpl.namePh', '예: 우리 회사 표준 NDA') as string} />
              </SaveTplField>
              <SaveTplField>
                <SaveTplLabel>{t('saveTpl.desc', '설명 (선택)')}</SaveTplLabel>
                <TplSearchInput type="text" value={saveTplDesc} onChange={e => setSaveTplDesc(e.target.value)} placeholder={t('saveTpl.descPh', '한 줄 요약') as string} />
              </SaveTplField>
              {saveTplError && <SaveTplError>{saveTplError}</SaveTplError>}
            </ModalBody>
            <ModalFooter>
              <SecondaryBtn type="button" onClick={() => !saveTplBusy && setSaveTplOpen(false)}>{t('cancel', '취소')}</SecondaryBtn>
              <PrimaryBtn type="button" disabled={saveTplBusy || !saveTplName.trim() || !detail} onClick={async () => {
                if (!businessId || !detail) return;
                setSaveTplBusy(true); setSaveTplError(null);
                try {
                  const html = renderContentToHtml(detail.content_json);
                  // ★ apiFetch — 여태 raw fetch 에 localStorage 'accessToken' 을 실었는데, 액세스 토큰은 **메모리에만** 있다
                  //   (AuthContext). 늘 빈 토큰 → 401 → "저장 실패" 였다. apiFetch 가 토큰·갱신·워크스페이스 헤더를 싣는다.
                  const r = await (await apiFetch('/api/docs/templates', {
                    method: 'POST', headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({
                      business_id: businessId, name: saveTplName.trim(), description: saveTplDesc.trim() || null,
                      kind: 'custom', mode: 'editor', body_template: html, locale: 'ko', visibility: 'workspace_only',
                    }),
                  })).json();
                  if (!r.success) throw new Error(r.message || 'save_failed');
                  setSaveTplOpen(false);
                  setTemplates([]); // 다음 모달 오픈 시 다시 fetch
                } catch (err) {
                  setSaveTplError(t('saveTpl.error', '저장 실패. 다시 시도해주세요.') as string);
                } finally { setSaveTplBusy(false); }
              }}>{saveTplBusy ? t('saving', '저장 중…') : t('save', '저장')}</PrimaryBtn>
            </ModalFooter>
          </ModalDialog>
        </ModalBackdrop>
      )}

      {tplModalOpen && (
        <ModalBackdrop onClick={() => setTplModalOpen(false)}>
          <ModalDialog onClick={e => e.stopPropagation()} role="dialog" aria-modal="true" aria-label={t('templates.modalTitle', '템플릿 선택') as string}>
            <ModalHead>
              <ModalTitle>{t('templates.modalTitle', '템플릿에서 시작')}</ModalTitle>
              <ModalClose type="button" onClick={() => setTplModalOpen(false)} aria-label="Close">
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
              </ModalClose>
            </ModalHead>
            <ModalBody>
              <ModalSub>{t('templates.modalSub', '본문이 자동으로 채워집니다. 자유롭게 편집한 후 저장하세요.')}</ModalSub>
              <TplSearchInput
                autoFocus
                type="text"
                value={tplSearch}
                onChange={e => setTplSearch(e.target.value)}
                placeholder={t('templates.searchPh', '템플릿 검색 (이름·설명·종류)') as string}
              />
              <TplGrid>
                {templates.length === 0 ? (
                  <Empty>{t('templates.loading', '로드 중...')}</Empty>
                ) : filteredTemplates.length === 0 ? (
                  <Empty>{t('templates.noResult', '검색 결과 없음')}</Empty>
                ) : (
                  filteredTemplates.map(tpl => (
                    <TplCard key={tpl.id} type="button" onClick={() => startFromTemplate(tpl)}>
                      <TplCardIcon><KindIcon kind={tpl.kind} size={20} /></TplCardIcon>
                      <TplCardBody>
                        <TplCardName>{tpl.name}</TplCardName>
                        <TplCardDesc>{tpl.description}</TplCardDesc>
                      </TplCardBody>
                      {tpl.is_system && <TplBadgeSys>{t('templates.system', '기본')}</TplBadgeSys>}
                    </TplCard>
                  ))
                )}
              </TplGrid>
            </ModalBody>
          </ModalDialog>
        </ModalBackdrop>
      )}
      {slotTplId !== null && businessId && (
        <SlotFormModal
          templateId={slotTplId}
          businessId={businessId}
          projectId={scope.type === 'project' ? scope.projectId : null}
          clientId={null}
          open={true}
          onClose={() => setSlotTplId(null)}
          onConfirm={handleSlotConfirm}
        />
      )}
      {/* #284 — 문서 본문을 AI 가 항목으로 나눠 Info 에 넣는다. 저장은 사용자가 확인한 뒤.
          출처(postId)를 같이 넘겨 저장된 항목마다 원본 문서로 되짚을 수 있게 한다. */}
      {aiIngest && businessId && (
        <KbAiIngestModal
          businessId={businessId}
          initialText={aiIngest.text}
          sourcePostId={aiIngest.postId}
          sourceTitle={aiIngest.title}
          onClose={() => setAiIngest(null)}
          onSaved={() => {
            setAiIngest(null);
            setKnowledgeMsg(t('actions.sendToKnowledgeOk', 'Q info 에 추가됐습니다 — 인덱싱 후 Cue 답변에 활용됩니다') as string);
            setTimeout(() => setKnowledgeMsg(null), 4000);
          }}
        />
      )}
      {knowledgeMsg && <KnowledgeToast>{knowledgeMsg}</KnowledgeToast>}
    </Layout>
  );
};

export default PostsPage;
