// 프로젝트 문서 허브 — 직접 업로드 + Q Talk / Q Task / Q Note 자동 집계 (실 API: services/files.ts)
// 기능: 좌측 폴더 트리 · 대량 선택/삭제/이동 · 그리드/리스트 · 드로어 미리보기
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import styled from 'styled-components';
import { useTranslation } from 'react-i18next';
import type { TFunction } from 'i18next';
import { useTimeFormat } from '../../hooks/useTimeFormat';
import { useMarqueeSelect } from '../../hooks/useMarqueeSelect';
import { FolderSvg, FolderOpenSvg, AllSvg, MyFilesSvg, PlusSvg, FolderMoveSvg, SystemFolderIcon } from './docs/treeIcons';
import {
  TreeRoot, TreeDivider, FolderRow, FolderIconWrap, FolderName, SectionRow, FolderSectionLabel, EmptyHint, RowPlusBtn, FolderNewBtn, RenameInput
} from './docs/treeStyles';
import TreeRow from './docs/TreeRow';
import { useFileOpen } from './docs/useFileOpen';
import { useFolderDrop, isExternalFileDrag, type FolderDropFn } from './docs/folderDrop';
import { useVisibilityRefresh } from '../../hooks/useVisibilityRefresh';
import { useFileDownload } from '../../hooks/useFileDownload';
import DetailDrawer from '../../components/Common/DetailDrawer';
import DetailFallbackDrawer from '../../components/Common/DetailFallbackDrawer';
import type { DetailStatus } from '../../hooks/useDetailResource';
import { findOtherWorkspaceOf } from '../../utils/workspaceMatch';
import ShareModal from '../../components/Common/ShareModal';
import { FormInput, FormLabel } from '../../components/UI/Modal';
import EmptyState from '../../components/Common/EmptyState';
import PlanQSelect from '../../components/Common/PlanQSelect';
import VisibilityBadge from '../../components/Common/VisibilityBadge';
import SecurityLevelBadge, { useSecurityLevelLabel } from '../../components/Common/SecurityLevelBadge';
import SearchBox from '../../components/Common/SearchBox';
import HighlightText from '../../components/Common/HighlightText';
import MatchReason from '../../components/Common/MatchReason';
import { pickMatch } from '../../utils/searchMatch';
import { useUploadQueue, UploadQueuePanel } from './docs/UploadQueue';
import FileMetaEditor from './docs/FileMetaEditor';
import PreviewArea from './docs/PreviewArea';
import CloudConnectNotice from '../../components/Common/CloudConnectNotice';
import { Toolbar, ToolbarRight, SortWrap } from '../../components/Docs/assetTabLayout';
import { Link } from 'react-router-dom';
import {
  fetchProjectFiles, fetchWorkspaceFiles, uploadProjectFile, uploadMyFile, deleteProjectFile, bulkDeleteFiles,
  fetchFolders, createFolder, renameFolder, deleteFolder, reorderFolder, moveFile,
  fetchWorkspaceFolders, createWorkspaceFolder,
  createShareLink, bulkDownloadZip, updateFileVisibility, updateFileSecurityLevel,
  formatBytes, extOf, isImage, getUploadLimits, type UploadLimits,
  type ProjectFile, type FileSource, type FileFolder, parseFileId, canOpenInNewTab } from '../../services/files';
import VisibilityField, { serializeVisibility, parseVisibility, type VisibilityValue } from '../../components/Common/VisibilityField';
import { listProjects, listWorkspaceClients, type ApiProject, type WorkspaceClientRow } from '../../services/qtalk';
import { apiFetch, useAuth } from '../../contexts/AuthContext';
import { cacheKey, readCache, hasCache, writeCache } from '../../lib/pageCache';
import TrashDrawer from './TrashDrawer';
import { joinRoom, leaveRoom, onSocket } from '../../services/socket';
import { useFileDragOut, isMovableInApp } from '../../hooks/useFileDragOut';
import OverflowMenu from '../../components/Common/OverflowMenu';
import { isEnterAction } from '../../utils/imeKey';
import { openDriveEditor } from '../../utils/driveEdit';

export type DocScope =
  | { type: 'project'; projectId: number; businessId: number }
  | { type: 'workspace'; businessId: number }
  | { type: 'personal'; businessId: number };  // N+30 — 개인 보관함 (본인 + L1 + project_id=null)

// #97 — 이미지 preview_url 에 리사이즈 폭 부여 (그리드 썸네일/미리보기용, 원본은 파라미터 없이)
/** 첫 화면에 들어오는 카드 수(1440px 기준 6열 × 2행 + 여유). 이만큼은 바로 받는다. */
const EAGER_THUMBS = 16;
const withW = (u: string | undefined | null, w: number): string | undefined =>
  u && u !== '#' ? `${u}${u.includes('?') ? '&' : '?'}w=${w}` : undefined;

type SortKey = 'recent' | 'name' | 'size';
type ViewMode = 'grid' | 'list';
// 폴더 선택 상태: 'all' = 전체 | 'direct' = 직접 업로드 루트 | `src:chat` etc | number = 사용자 폴더 id
// 워크스페이스 모드: 'all' | `proj:${projectId}` | `src:...`
type FolderSel = 'all' | 'direct' | 'my' | `src:${FileSource}` | `proj:${number}` | number;

interface Props {
  // 하위 호환: 기존 호출부 ({ projectId, businessId }) 는 자동으로 project scope
  projectId?: number;
  /** 프로젝트 모드에서 좌측 «기본 폴더» 행에 쓰는 이름·색 (호출부가 이미 알고 있다 — 다시 조회하지 않는다). */
  projectName?: string;
  projectColor?: string | null;
  businessId?: number;
  scope?: DocScope;
  /**
   * 딥링크로 열 파일 id (`/files?file=N`). ★파라미터는 **페이지 오너가 읽어** 내려보낸다 —
   * DocsTab 은 프로젝트·개인보관함에도 임베드되므로 여기서 직접 URL 을 읽으면
   * 인스턴스들이 같은 파라미터를 두고 싸운다 (Fable 지적, 2026-08-30).
   */
  openFileId?: number | null;
  /** 상세가 열리고 닫힐 때 — 오너가 URL 을 맞춘다 */
  onOpenFileChange?: (id: number | null) => void;
}

/** 업로드 큐 한 건 */
/** Cue 읽기 상태 한 줄. 이유는 서버가 준 `reason` 그대로 옮긴다 —
 *  화면이 판정을 다시 하면 서버와 갈라진다. 옛 바이너리(.doc·.xls·.ppt)는
 *  **무엇을 하면 읽히는지**까지 말해 준다(형식만 바꾸면 되는 일이다). */
function cueReadText(f: ProjectFile, t: TFunction): string {
  const cr = f.cue_read;
  if (!cr) return '';
  if (cr.ok) return t('docs.cueRead.ok', '내용을 읽습니다') as string;
  const ext = String(f.file_name || '').toLowerCase().split('.').pop() || '';
  if (cr.reason === 'unsupported_type' && ['doc', 'xls', 'ppt'].includes(ext)) {
    return t('docs.cueRead.unsupported_office', '이 형식은 못 읽습니다 — .docx·.xlsx·.pptx 로 저장하면 읽힙니다') as string;
  }
  const known = ['unsupported_type', 'restricted', 'personal', 'too_large', 'empty_text'];
  const key = known.includes(String(cr.reason)) ? cr.reason : 'other';
  return t(`docs.cueRead.${key}`, t('docs.cueRead.other', '내용을 읽지 못합니다')) as string;
}

const DocsTab: React.FC<Props> = (props) => {
  // ★ scope 는 **매 렌더마다 새 객체가 되면 안 된다** — 아래 useEffect 의 dep 이다.
  //   2026-09-09 실측(프로젝트 > 파일 탭 1회 진입): 렌더마다 새 객체 → effect 재실행 →
  //   3개 fetch 의 setState 가 다시 렌더를 불러 **API 1,219건**이 나갔다
  //   (`/businesses/:id/members` 398 · `/clients/:id` 398 · `/projects?business_id` 397).
  //   결과로 Sequelize 커넥션 풀이 20/20 으로 묶여 **다음 화면의 요청 3건이 45초를 기다렸고**
  //   (실측: files → docs 탭 이동 45,083ms), 일반 rate-limit(600/분)도 한 번에 태운다.
  //   → dep 은 **원시값으로만** 잡는다. 호출부가 `scope={{...}}` 인라인이어도 안전하다
  //     (memory feedback_props_useMemo).
  const sType: DocScope['type'] = props.scope
    ? props.scope.type
    : (props.projectId && props.businessId ? 'project' : 'workspace');
  const sBiz = props.scope ? props.scope.businessId : props.businessId;
  const sProj = props.scope
    ? (props.scope.type === 'project' ? props.scope.projectId : undefined)
    : props.projectId;
  const scope: DocScope = useMemo(() => (
    sType === 'project'
      ? { type: 'project', projectId: sProj as number, businessId: sBiz as number }
      : sType === 'personal'
        ? { type: 'personal', businessId: sBiz as number }
        : { type: 'workspace', businessId: sBiz as number }
  ), [sType, sBiz, sProj]);
  const isWorkspace = scope.type === 'workspace';
  const isPersonal = scope.type === 'personal';   // N+30 개인 보관함 모드
  const projectId = scope.type === 'project' ? scope.projectId : 0;
  const businessId = scope.businessId;
  // #228 — 파일을 OS 로 끌어내기 (자체 스토리지 일반등급 파일만)
  const { getDragProps } = useFileDragOut(businessId);
  const { t } = useTranslation('qproject');
  const tr: (k: string, fb?: string) => string = (k, fb) => t(k, (fb ?? '') as string) as unknown as string;
  const { formatDate } = useTimeFormat();

  // 재진입 즉시 표시 — 같은 범위(개인/워크스페이스/프로젝트)로 다시 들어오면 지난 목록으로 먼저 그린다.
  //   scope 별로 키가 갈리므로 프로젝트 파일이 워크스페이스 파일 자리에 섞이지 않는다.
  //   ★ user 축을 반드시 넣는다 — 개인 보관함(personal)은 L1 개인자원이라 키가 겹치면
  //     같은 브라우저의 다른 사용자에게 남의 목록이 비칠 수 있다. 로그아웃 시 clearPageCache
  //     가 통째로 비우지만, 키에서도 한 번 더 막는다(겹쳐서 막기).
  const { user: cacheUser } = useAuth();
  const fileKey = cacheKey(
    scope.type === 'project' ? `files:p${scope.projectId}` : `files:${scope.type}`,
    cacheUser?.id, scope.businessId,
  );
  // 썸네일을 못 받은 파일 — 깨진 아이콘 대신 파일 종류 아이콘으로 되돌린다.
  const [thumbFailed, setThumbFailed] = useState<Set<string>>(new Set());
  const [trashOpen, setTrashOpen] = useState(false);
  // 휴지통에서 복구하면 바깥 목록이 **즉시** 그것을 보여야 한다 — 안 그러면 복구가 안 된 것처럼 보인다.
  const [reloadTick, setReloadTick] = useState(0);
  const [files, setFiles] = useState<ProjectFile[]>(() => readCache<ProjectFile[]>(fileKey) ?? []);
  const [folders, setFolders] = useState<FileFolder[]>(() => readCache<FileFolder[]>(`${fileKey}:folders`) ?? []);
  // ★ "못 불러옴" 과 "파일 없음" 은 다른 상태다(500 재현으로 실측 — 오류인데 빈 상태가 떴다).
  const [loadError, setLoadError] = useState(false);
  const [loading, setLoading] = useState(() => !hasCache(fileKey));
  const [view, setView] = useState<ViewMode>('grid');
  const [folderSel, setFolderSel] = useState<FolderSel>('all');
  const [query, setQuery] = useState('');
  const [sort, setSort] = useState<SortKey>('recent');
  const [preview, setPreview] = useState<ProjectFile | null>(null);

  // ── 딥링크 소생 (2026-08-30) ────────────────────────────────────────────
  //   `/files?file=N` 은 알림·전역검색·개인보관함·공개페이지·표 **5곳이 만드는데**
  //   읽는 곳이 **0곳**이었다 — 즉 파일 알림을 눌러도 항상 아무 일도 안 일어났다.
  //   목록이 로드된 뒤 그 id 를 찾아 상세를 연다. 목록에 없으면(삭제·권한) 그대로 둔다 —
  //   "없음" 안내는 다음 커밋의 공통 폴백이 담당한다.
  const openFileId = props.openFileId ?? null;
  const openedFileRef = useRef<number | null>(null);
  // Q6 — 목록에 없는 ?file= 는 **이유를 말한다**(여태 "그대로 둔다" 로 미뤄져 아무 일도 안 일어났다).
  //   ① 내 다른 워크스페이스 파일이면 전환 안내 — 그러면 이 목록에는 영영 안 온다(바로 판정).
  //   ② 아니면 "찾을 수 없음" — 단 **새로 받은 목록**으로 확인한 뒤에만(캐시로 먼저 그린 목록은 낡았을 수 있다).
  const [missingFile, setMissingFile] = useState<{ id: number; status: DetailStatus; otherBiz: number | null } | null>(null);
  const probedFileRef = useRef<number | null>(null);
  const firstFilesRef = useRef(true);
  const [filesFresh, setFilesFresh] = useState(false);
  useEffect(() => {
    if (firstFilesRef.current) { firstFilesRef.current = false; return; }
    setFilesFresh(true);
  }, [files]);
  useEffect(() => {
    if (!openFileId) { openedFileRef.current = null; probedFileRef.current = null; setMissingFile(null); return; }
    if (openedFileRef.current === openFileId) return;
    // ★ 목록의 id 는 `direct-123` 같은 **합성 문자열**이다 (#390 에서 Number('direct-N')=NaN
    //   사고가 난 그 축). 딥링크의 숫자 id 와 맞추려면 반드시 parseFileId 로 푼다.
    const hit = files.find((f) => parseFileId(f.id)?.id === openFileId);
    if (hit) { openedFileRef.current = openFileId; setMissingFile(null); setPreview(hit); return; }
    if (probedFileRef.current !== openFileId) {
      const want = openFileId;
      probedFileRef.current = want;
      void findOtherWorkspaceOf('file', want, scope.businessId).then((other) => {
        if (other && probedFileRef.current === want) setMissingFile({ id: want, status: 'other_workspace', otherBiz: other });
      });
    }
    if (filesFresh && !loading && !loadError) {
      setMissingFile((cur) => (cur && cur.id === openFileId ? cur : { id: openFileId, status: 'not_found', otherBiz: null }));
    }
  }, [openFileId, files, filesFresh, loading, loadError, scope.businessId]);
  const closeMissingFile = useCallback(() => {
    setMissingFile(null);
    props.onOpenFileChange?.(null);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [props.onOpenFileChange]);

  // 상세 열림/닫힘을 오너에 알려 URL 을 맞춘다 (새로고침·공유에서 맥락 유지)
  const notifyOpen = props.onOpenFileChange;
  useEffect(() => {
    if (!notifyOpen) return;
    notifyOpen(preview ? (parseFileId(preview.id)?.id ?? null) : null);
  }, [preview, notifyOpen]);
  const [shareTarget, setShareTarget] = useState<ProjectFile | null>(null);
  const [dragOver, setDragOver] = useState(false);
  // 업로드 큐 — 파일별 진행률·속도·취소 (docs/UploadQueue)
  const { uploads, runUploads, cancelUpload } = useUploadQueue();
  const [deleteConfirm, setDeleteConfirm] = useState<ProjectFile | null>(null);
  // 프로젝트 안에 새 폴더 — 이름을 받아야 하므로 작은 입력창을 띄운다(이름 없는 폴더를 만들지 않는다).
  const [newProjectFolder, setNewProjectFolder] = useState<{ projectId: number; parentId: number | null; name: string } | null>(null);
  const [selectMode, setSelectMode] = useState(false);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [bulkDeleteOpen, setBulkDeleteOpen] = useState(false);
  const [moveTargetOpen, setMoveTargetOpen] = useState(false);
  /* ★ 2026-09-20 (Irene: *"폴더이름 버튼.. 이게 왜 이렇게 크고 뭐야? 카테고리 표시면 좌측 상단에
     표시되는 거랑 같이 나열되어야 하는 거 아니야? 이동 버튼이면 이동 아이콘만 있으면 되는 거고"*) —
     한 컨트롤이 **분류 표시**와 **이동 버튼** 두 가지를 겸하고 있었다(폴더 이름을 글자로 단 36px 알약).
     둘은 다른 것이다: 분류는 출처 칩 옆에 나란히, 이동은 다른 액션과 같은 아이콘 버튼. */
  const [moveSingle, setMoveSingle] = useState<ProjectFile | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const secLabel = useSecurityLevelLabel();  // D4 #62 보안등급 라벨
  // N+67 — visibility 변경 UI 용 (preview drawer 안)
  const [projects, setProjects] = useState<ApiProject[]>([]);
  const [clients, setClients] = useState<WorkspaceClientRow[]>([]);
  const [members, setMembers] = useState<Array<{ user_id: number; name: string; role: string }>>([]);
  useEffect(() => {
    const bizId = scope.type === 'project' ? scope.businessId : scope.businessId;
    if (!bizId) return;
    listProjects(bizId).then(setProjects).catch(() => {});
    listWorkspaceClients(bizId).then(c => setClients(c.filter(x => x.status !== 'archived'))).catch(() => {});
    apiFetch(`/api/businesses/${bizId}/members`).then(r => r.json()).then(j => {
      if (j?.success && Array.isArray(j.data)) {
        setMembers(j.data
          .filter((m: { user?: { is_ai?: boolean }; role?: string }) => !m.user?.is_ai && m.role !== 'ai')
          .map((m: { user_id?: number; id?: number; user?: { id?: number; name?: string; display_name?: string | null }; name?: string; role?: string }) => ({
            user_id: m.user_id || m.id || m.user?.id || 0,
            // 워크스페이스 표시명 우선 — 계정명 노출 방지
            name: m.user?.display_name || m.name || m.user?.name || '—',
            role: m.role || 'member',
          })).filter((m: { user_id: number }) => m.user_id > 0));
      }
    }).catch(() => {});
  }, [scope]);

  useEffect(() => {
    let cancelled = false;
    if (!hasCache(fileKey)) setLoading(true);   // 캐시로 이미 그렸으면 스피너로 되돌리지 않는다
    if (isPersonal) {
      // N+30 — 개인 보관함: 본인 L1 파일만. 폴더 X (개인 보관함은 평면 view)
      import('../../services/files').then(({ fetchPersonalFiles }) => {
        fetchPersonalFiles(businessId).then(fs => {
          if (!cancelled) { setFiles(fs); setFolders([]); writeCache(fileKey, fs); setLoadError(false); setLoading(false); }
        }).catch(() => { if (!cancelled) { setLoadError(true); setLoading(false); } });
      });
    } else if (isWorkspace) {
      // Irene 2026-08-31 — 워크스페이스 파일에도 폴더. 여태 여기서 folders 를 **비웠다**
      //   (폴더 라우트가 프로젝트 전용이었다). 운영 파일의 95% 가 이쪽이다.
      Promise.all([fetchWorkspaceFiles(businessId), fetchWorkspaceFolders(businessId)]).then(([fs, fd]) => {
        if (!cancelled) { setFiles(fs); setFolders(fd); writeCache(fileKey, fs); writeCache(`${fileKey}:folders`, fd); setLoadError(false); setLoading(false); }
      }).catch(() => { if (!cancelled) { setLoadError(true); setLoading(false); } });
    } else {
      Promise.all([fetchProjectFiles(projectId), fetchFolders(projectId)]).then(([fs, fd]) => {
        if (!cancelled) {
          setFiles(fs); setFolders(fd); setLoading(false);
          writeCache(fileKey, fs); writeCache(`${fileKey}:folders`, fd);
          // ★ 2026-09-20 — 프로젝트 이름 조회를 **걷어냈다.** 그 값을 쓰던 곳은 좌측 트리의
          //   «프로젝트 루트» 행 하나뿐이었는데, 프로젝트 안에서 프로젝트 이름을 한 번 더 보여 주는
          //   것이라 없앴다(Irene). 읽는 곳이 없어진 값은 남기지 않는다 — 남기면 다음 사람이
          //   적용 중이라고 믿고, 쓸데없는 요청이 한 번 더 나간다.
        }
      });
    }
    return () => { cancelled = true; };
  }, [projectId, businessId, isWorkspace, isPersonal, fileKey, reloadTick]);

  // 목록 다시 읽기 — visibility 복귀 안전망과 Drive 가져오기 직후가 **같은 함수**를 쓴다.
  //   (한쪽만 고치면 "가져왔는데 목록에 안 보인다" 가 된다.)
  const reload = useCallback(() => {
    if (!businessId) return;
    if (isPersonal) {
      import('../../services/files').then(({ fetchPersonalFiles }) => fetchPersonalFiles(businessId).then(fs => setFiles(fs)));
    } else if (isWorkspace) {
      Promise.all([fetchWorkspaceFiles(businessId), fetchWorkspaceFolders(businessId)]).then(([fs, fd]) => { setFiles(fs); setFolders(fd); });
    } else {
      Promise.all([fetchProjectFiles(projectId), fetchFolders(projectId)]).then(([fs, fd]) => { setFiles(fs); setFolders(fd); });
    }
  }, [businessId, projectId, isPersonal, isWorkspace]);

  // N+39 — PWA visibility 안전망 (socket 끊김 / background→foreground)
  useVisibilityRefresh(reload);

  // N+38 — 실시간 동기화 (CLAUDE.md 운영 안정성 16번 박제).
  // 다른 사용자가 파일 업로드/삭제/이동/visibility 변경 시 본인이 페이지 열고 있으면 즉시 보임.
  // backend files.js 가 business room 으로 broadcast.
  useEffect(() => {
    if (!businessId) return;
    let pending: number | null = null;
    const triggerReload = () => {
      if (pending) return;
      pending = window.setTimeout(() => {
        pending = null;
        // 같은 fetch 흐름 재호출 — 위 effect 의 deps 변경 트리거하기 어려우니 직접 fetch
        if (isPersonal) {
          import('../../services/files').then(({ fetchPersonalFiles }) => fetchPersonalFiles(businessId).then(fs => setFiles(fs)));
        } else if (isWorkspace) {
          Promise.all([fetchWorkspaceFiles(businessId), fetchWorkspaceFolders(businessId)]).then(([fs, fd]) => { setFiles(fs); setFolders(fd); });
        } else {
          Promise.all([fetchProjectFiles(projectId), fetchFolders(projectId)]).then(([fs, fd]) => { setFiles(fs); setFolders(fd); });
        }
      }, 250);
    };
    joinRoom(`business:${businessId}`);
    const offNew = onSocket('file:new', triggerReload);
    const offUpdated = onSocket('file:updated', triggerReload);
    const offDeleted = onSocket('file:deleted', triggerReload);
    // #379 — Google Drive 에서 고친 것도 여기로 온다(이름변경·이동·삭제).
    //   서버가 `gdrive:changed` 를 쏘고 있었지만 **받는 곳이 한 군데도 없었다** —
    //   broadcast 는 수신부까지가 기능이다(CLAUDE.md 실시간 반영 규칙 16-c).
    const offGdrive = onSocket('gdrive:changed', triggerReload);
    return () => {
      if (pending) window.clearTimeout(pending);
      leaveRoom(`business:${businessId}`);
      offNew(); offUpdated(); offDeleted(); offGdrive();
    };
  }, [businessId, projectId, isWorkspace, isPersonal]);

  // 선택 모드 종료 시 선택 초기화
  useEffect(() => { if (!selectMode) setSelectedIds(new Set()); }, [selectMode]);

  const counts = useMemo(() => {
    const byFolder: Record<number, number> = {};
    let directRoot = 0;
    let myFiles = 0;
    const bySrc: Record<FileSource, number> = { direct: 0, chat: 0, task: 0, meeting: 0, post: 0, mail: 0 };
    for (const f of files) {
      // ★ 출처는 태그다 — 한 파일이 채팅·업무 양쪽에 걸리면 양쪽에서 다 세어야 한다.
      //   (Irene: "이 폴더들은 그냥 태그같은 필터 기능 아니야? 겹쳐서 나와야지.")
      for (const s of srcsOf(f)) bySrc[s]++;
      if (f.source === 'direct') {
        if (f.project_context == null) myFiles++;
        if (f.folder_id == null) directRoot++;
        else byFolder[f.folder_id] = (byFolder[f.folder_id] || 0) + 1;
      }
    }
    return { total: files.length, bySrc, byFolder, directRoot, myFiles };
  }, [files]);

  const filteredByFolder = useMemo(() => {
    if (folderSel === 'all') return files;
    if (folderSel === 'my') return files.filter(f => f.source === 'direct' && f.project_context == null);
    if (folderSel === 'direct') return files.filter(f => f.source === 'direct' && f.folder_id == null);
    if (typeof folderSel === 'string' && folderSel.startsWith('src:')) {
      const src = folderSel.slice(4) as FileSource;
      return files.filter(f => srcsOf(f).includes(src));
    }
    if (typeof folderSel === 'string' && folderSel.startsWith('proj:')) {
      const pid = Number(folderSel.slice(5));
      return files.filter(f => f.project_context?.id === pid);
    }
    return files.filter(f => f.source === 'direct' && f.folder_id === folderSel);
  }, [files, folderSel]);

  // 워크스페이스 모드: 프로젝트별 집계
  const projectGroups = useMemo(() => {
    if (!isWorkspace) return [];
    const map = new Map<number, { id: number; name: string; color?: string | null; count: number }>();
    for (const f of files) {
      if (!f.project_context) continue;
      const cur = map.get(f.project_context.id);
      if (cur) cur.count++;
      else map.set(f.project_context.id, { ...f.project_context, count: 1 });
    }
    return Array.from(map.values()).sort((a, b) => b.count - a.count);
  }, [files, isWorkspace]);

  const visible = useMemo(() => {
    let r = filteredByFolder.slice();
    if (query.trim()) {
      const q = query.toLowerCase();
      // 파일명만으로는 영상·스캔본을 찾을 수 없다 — 설명·태그도 같이 본다.
      r = r.filter(f =>
        f.file_name.toLowerCase().includes(q)
        || (f.description || '').toLowerCase().includes(q)
        || (f.tags || []).some(tg => tg.toLowerCase().includes(q)));
    }
    if (sort === 'name') r.sort((a, b) => (a.file_name || '').localeCompare(b.file_name || ''));
    else if (sort === 'size') r.sort((a, b) => (b.file_size || 0) - (a.file_size || 0));
    else r.sort((a, b) => (b.uploaded_at || '').localeCompare(a.uploaded_at || ''));
    return r;
  }, [filteredByFolder, query, sort]);

  const selectedFiles = useMemo(() => files.filter(f => selectedIds.has(f.id)), [files, selectedIds]);
  const selectedDeletable = selectedFiles.filter(f => f.deletable);

  const [pendingUpload, setPendingUpload] = useState<File[] | null>(null);
  const [workspaceUploadProject, setWorkspaceUploadProject] = useState<number | null>(null);

  /**
   * 올린다. `folderOverride` 를 주면 **그 폴더로** — 좌측 폴더 행에 바로 떨어뜨린 경우다
   * (Irene 2026-09-20: *"로컬 파일로 있는 것도 폴더 위에 바로 올려서 못 넣어?"*).
   * 주지 않으면 지금 보고 있는 폴더(`folderSel`)로 — 종전과 같다.
   */
  const handleFiles = useCallback(async (fileList: FileList | File[], folderOverride?: number | null) => {
    const arr = Array.from(fileList);
    if (arr.length === 0) return;
    const sel: FolderSel | null = folderOverride !== undefined ? folderOverride : folderSel;
    // N+30 — 개인 보관함 모드: project_id 없이 uploadMyFile → backend 가 자동 visibility=L1 (files.js:390)
    if (isPersonal) {
      await runUploads(arr,
        (f, hooks) => uploadMyFile(businessId, f, hooks),
        (file) => setFiles(prev => [file, ...prev]));
      return;
    }
    if (isWorkspace) {
      // 워크스페이스 모드:
      //  - "내 파일" 폴더 선택 중이면 바로 업로드 (project_id 없이)
      //  - 그 외엔 프로젝트 선택 모달 띄움
      if (sel === 'my') {
        await runUploads(arr,
          (f, hooks) => uploadMyFile(businessId, f, hooks),
          (file) => setFiles(prev => [file, ...prev]));
        return;
      }
      // 폴더를 골라 놓고 올리면 **그 폴더로** 들어간다 — 안 그러면 올린 파일이
      //   보고 있던 폴더에 안 보여 "어디 갔지" 가 된다(프로젝트 모드와 같은 규칙).
      if (typeof sel === 'number') {
        const targetFolder = sel;
        await runUploads(arr,
          (f, hooks) => uploadMyFile(businessId, f, hooks),
          async (file) => {
            const parsed = parseFileId(file.id);
            if (parsed?.source === 'direct') await moveFile(businessId, file.id, targetFolder);
            setFiles(prev => [{ ...file, folder_id: targetFolder }, ...prev]);
          });
        return;
      }
      setPendingUpload(arr);
      return;
    }
    const targetFolderId = typeof sel === 'number' ? sel : null;
    await runUploads(arr,
      (f, hooks) => uploadProjectFile(businessId, projectId, f, { folderId: targetFolderId, ...hooks }),
      (file) => setFiles(prev => [file, ...prev]));
  }, [businessId, projectId, folderSel, isWorkspace, isPersonal, runUploads]);

  const commitWorkspaceUpload = useCallback(async () => {
    if (!pendingUpload || !workspaceUploadProject) return;
    const arr = pendingUpload;
    const targetProject = workspaceUploadProject;
    setPendingUpload(null); setWorkspaceUploadProject(null);
    await runUploads(arr,
      (f, hooks) => uploadProjectFile(businessId, targetProject, f, { folderId: null, ...hooks }),
      (file) => {
        // project_context 수동 주입 (워크스페이스 뷰 유지)
        const proj = projectGroups.find(p => p.id === targetProject);
        const withCtx = proj ? { ...file, project_context: { id: proj.id, name: proj.name, color: proj.color } } : file;
        setFiles(prev => [withCtx, ...prev]);
      });
  }, [pendingUpload, workspaceUploadProject, businessId, projectGroups, runUploads]);

  // ★ 빈 공간을 끌어 여러 개 고르기 (Irene 2026-09-20: *"드래그해서 여러 개 선택하는 것도 안되는데"*).
  //   고르면 **선택모드가 자동으로 켜진다** — 안 켜면 고른 티가 안 나고 일괄 버튼도 안 나온다.
  //   Shift/⌘/Ctrl 을 누른 채 끌면 기존 선택에 더한다.
  const filesAreaRef = useRef<HTMLDivElement>(null);
  const onMarquee = useCallback((ids: string[], additive: boolean) => {
    if (!ids.length && !additive) { setSelectedIds(new Set()); return; }
    setSelectMode(true);
    setSelectedIds(prev => {
      const next = additive ? new Set(prev) : new Set<string>();
      ids.forEach(id => next.add(id));
      return next;
    });
  }, []);
  const { rect: marquee } = useMarqueeSelect({
    containerRef: filesAreaRef,
    itemSelector: '[data-file-id]',
    onSelect: onMarquee,
  });

  const toggleSelect = (id: string, e?: React.MouseEvent) => {
    setSelectedIds(prev => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
    void e;
  };
  const selectAllVisible = () => setSelectedIds(new Set(visible.map(f => f.id)));
  const clearSelection = () => setSelectedIds(new Set());

  const onBulkDeleteConfirmed = useCallback(async () => {
    const ids = selectedDeletable.map(f => f.id);
    if (ids.length === 0) { setBulkDeleteOpen(false); return; }
    await bulkDeleteFiles(businessId, ids);
    setFiles(prev => prev.filter(f => !selectedIds.has(f.id) || !f.deletable));
    setSelectedIds(new Set());
    setBulkDeleteOpen(false);
  }, [selectedDeletable, businessId, selectedIds]);

  // ─── 공유 링크 + ZIP 다운로드 ───
  // 백엔드가 지원하는 source: direct / chat / task. meeting / post 는 후속.
  // gdrive 등 외부 storage 도 백엔드에서 자동 제외.
  const selectedDownloadable = selectedFiles.filter(f =>
    f.source === 'direct' || f.source === 'chat' || f.source === 'task'
  );
  const [shareLinkInfo, setShareLinkInfo] = useState<{ url: string; expires: string } | null>(null);
  const [shareError, setShareError] = useState<string | null>(null);
  // ★ 업로드 한도는 **플랜마다 다르다** (Free 5MB · Starter 20 · Basic 50 · Pro 100 · Enterprise 200).
  //   여태 드롭존 문구에 `최대 50MB` 가 **하드코딩**돼 있어 Free 사용자에게 10배 틀린 숫자를
  //   보여주고 있었다 — Irene #417: *"여전히 용량 큰게 안올라가는 것 같은데 … 기준을 찾아."*
  //   화면이 기준을 거짓으로 말하면 사용자는 영영 원인을 못 찾는다.
  //   서버가 내려주는 값을 그대로 쓴다(`getUploadLimits` — 60초 캐시, 숫자를 두 벌 두지 않는다).
  const [uploadLimits, setUploadLimits] = useState<UploadLimits | null>(null);
  useEffect(() => {
    if (!businessId) return;
    let alive = true;
    getUploadLimits(businessId).then((v) => { if (alive) setUploadLimits(v); }).catch(() => {});
    return () => { alive = false; };
  }, [businessId]);

  const [downloading, setDownloading] = useState(false);
  const [zipProgress, setZipProgress] = useState<{ received: number; total: number | null } | null>(null);
  // 단건 다운로드 — 인증 fetch + "받는 중…" 표시 (링크 방식은 401 이라 못 쓴다)
  const dl = useFileDownload();

  const onCreateShareLink = useCallback(async () => {
    if (selectedFiles.length !== 1) return;
    const f = selectedFiles[0];
    if (f.source !== 'direct') {
      setShareError(t('docs.bulk.shareNotSupported', '직접 업로드 파일만 공유 링크를 만들 수 있습니다'));
      return;
    }
    setShareError(null);
    const r = await createShareLink(businessId, f.id, 30);
    if (!r) {
      setShareError(t('docs.bulk.shareFailed', '공유 링크 생성 실패'));
      return;
    }
    try { await navigator.clipboard.writeText(r.share_url); } catch { /* ignore */ }
    setShareLinkInfo({ url: r.share_url, expires: r.expires_at });
  }, [selectedFiles, businessId, t]);

  const onBulkDownload = useCallback(async () => {
    if (selectedDownloadable.length === 0) return;
    setDownloading(true);
    setZipProgress(null);
    setShareError(null);
    try {
      // 진행률을 흘려 받는다 — 스트리밍 ZIP 은 Content-Length 가 없어 퍼센트가 안 나오므로
      //   그때는 받은 양(MB)을 보여준다. 아무 표시도 없는 "준비 중..." 이 가장 나쁘다.
      const r = await bulkDownloadZip(businessId, selectedDownloadable.map(f => f.id), setZipProgress);
      if (!r.ok) {
        setShareError(t('docs.bulk.zipFailed', 'ZIP 다운로드 실패: {{msg}}', { msg: r.message || '' }));
      }
    } finally {
      setDownloading(false);
      setZipProgress(null);
    }
  }, [selectedDownloadable, businessId, t]);

  /**
   * 폴더 통째 다운로드 (Irene #417: "폴더 전체 다운로드나 파일 전체 선택 다운로드 기능도 있어야 해").
   * 새 API 를 만들지 않는다 — 그 폴더의 파일 id 를 모아 **기존 bulk-download(zip)** 에 넘긴다.
   * ★ 받을 수 있는 것만 넘긴다(`download_url` 이 있는 것). 빈 폴더면 애초에 메뉴에 안 뜬다.
   */
  const onDownloadFolder = useCallback(async (folderId: number) => {
    const ids = files.filter(f => f.folder_id === folderId && f.download_url && f.download_url !== '#').map(f => f.id);
    if (!ids.length) return;
    setDownloading(true); setZipProgress(null); setShareError(null);
    try {
      const r = await bulkDownloadZip(businessId, ids, setZipProgress);
      if (!r.ok) setShareError(t('docs.bulk.zipFailed', 'ZIP 다운로드 실패: {{msg}}', { msg: r.message || '' }) as string);
    } finally { setDownloading(false); setZipProgress(null); }
  }, [files, businessId, t]);

  const zipProgressText = !zipProgress
    ? t('docs.bulk.zipDownloading', '준비 중...')
    : (zipProgress.total && zipProgress.total > 0
      ? `${Math.min(99, Math.floor((zipProgress.received / zipProgress.total) * 100))}%`
      : `${(zipProgress.received / (1024 * 1024)).toFixed(1)}MB`);

  // 편집 열기 — Drive 에 바이트가 있는 파일을 Drive 편집기로 연다.
  //   ★ 팝업 차단을 피하려면 **클릭과 같은 턴에** 창을 열어야 한다. 그래서 먼저 빈 창을 띄우고
  //     서버 응답이 오면 그 창의 주소를 바꾼다(미리보기 '새 탭 열기' 와 같은 방식).
  //   ★ 권한을 못 준 경우(구글 계정이 없는 주소 등)에도 링크는 열되 **왜 그런지 화면이 말한다** —
  //     조용히 "액세스 권한 필요" 만 보면 사용자는 고장으로 읽는다.
  const [editOpening, setEditOpening] = useState(false);
  const [editNote, setEditNote] = useState<string | null>(null);
  const openDriveEdit = useCallback(async (f: ProjectFile) => {
    if (editOpening) return;                 // 중복 제출 가드
    const parsed = parseFileId(f.id);
    if (!parsed) return;
    setEditOpening(true);
    setEditNote(null);
    // 여는 절차는 공용(utils/driveEdit) — 채팅·업무 첨부 미리보기가 같은 함수를 쓴다.
    const res = await openDriveEditor(businessId, parsed.id);
    if (!res.ok) setEditNote(tr('docs.driveEdit.failed'));
    else if (res.accessReason === 'no_google_account') setEditNote(tr('docs.driveEdit.noGoogleAccount'));
    setEditOpening(false);
  }, [businessId, editOpening, tr]);

  // 폴더로 끌어다 놓기 (#파일 정리). 이동 API·권한은 일괄 이동(onMoveTo)과 같은 것을 쓴다.
  //   ★ 끄는 파일이 선택 안에 있으면 **선택 전체**를 옮긴다 — 10개를 고르고 하나를 끌었는데
  //     그 하나만 가면 사용자는 나머지가 어디 갔는지 다시 찾아야 한다(탐색기와 같은 관습).
  //   ★ 실패한 건은 화면에서도 안 옮긴다 — 서버가 거절했는데 화면만 옮기면 새로고침에 되돌아온다.
  const onDropToFolder = useCallback(async (targetFolderId: number | null, draggedId: string) => {
    const ids = selectedIds.has(draggedId)
      ? files.filter(f => selectedIds.has(f.id) && isMovableInApp(f)).map(f => f.id)
      : [draggedId];
    const moved: string[] = [];
    for (const id of ids) {
      if (await moveFile(businessId, id, targetFolderId)) moved.push(id);
    }
    if (!moved.length) return;
    const movedSet = new Set(moved);
    setFiles(prev => prev.map(f => movedSet.has(f.id) ? { ...f, folder_id: targetFolderId } : f));
    setSelectedIds(new Set());
  }, [businessId, files, selectedIds]);

  /** 이 파일이 지금 들어 있는 폴더 이름 — **분류 칩**에 쓴다(누르는 것이 아니다).
   *  ★ 2026-09-20 이전엔 이 이름이 36px 짜리 «버튼» 이었다. 한 컨트롤이 분류 표시와 이동을
   *    겸해서 행에서 혼자 크고 무슨 버튼인지도 모호했다 — 분류는 칩, 이동은 아이콘으로 갈랐다.
   *  ★ 폴더가 없으면 칩을 그리지 않는다(«폴더 없음» 을 모든 행에 다는 것은 정보가 아니다).
   *    드래그 말고 옮기는 문은 [이동] 아이콘 → 폴더 선택 모달이다(일괄 이동과 같은 문). */
  const currentFolderName = useCallback((f: ProjectFile) => (
    f.folder_id ? (folders.find(fd => fd.id === f.folder_id)?.name || t('docs.folder.noFolder', '폴더 없음') as string)
      : t('docs.folder.noFolder', '폴더 없음') as string
  ), [folders, t]);

  /** 프로젝트 안에 폴더를 만든다 — 프로젝트 폴더 라우트(`/api/folders/projects/:id`)를 쓴다.
   *  워크스페이스 라우트로 만들면 `project_id` 가 비어 그 프로젝트에 안 붙는다. */
  const commitProjectFolder = useCallback(async () => {
    if (!newProjectFolder) return;
    const name = newProjectFolder.name.trim();
    if (!name) return;
    try {
      const f = await createFolder(newProjectFolder.projectId, name, newProjectFolder.parentId);
      setFolders(prev => prev.some(x => x.id === f.id) ? prev : [...prev, { ...f, project_id: newProjectFolder.projectId }]);
    } catch (e) { void e; }
    setNewProjectFolder(null);
  }, [newProjectFolder]);

  /** 지금 들어 있는 폴더. 여러 건이면 **모두 같을 때만** 값이 나온다(제각각이면 표시가 거짓이 된다). */
  const moveFrom = useMemo<number | null | undefined>(() => {
    const targets = moveSingle ? [moveSingle] : selectedDeletable;
    if (!targets.length) return undefined;
    const first = targets[0].folder_id ?? null;
    return targets.every(f => (f.folder_id ?? null) === first) ? first : undefined;
  }, [moveSingle, selectedDeletable]);

  const onMoveTo = useCallback(async (targetFolderId: number | null) => {
    // 한 건(아이콘 버튼)과 여러 건(일괄 바)이 **같은 문**을 쓴다 — 따로 쓰면 한쪽만 고쳐진다.
    const targets = moveSingle ? [moveSingle] : selectedDeletable;
    for (const f of targets) {
      await moveFile(businessId, f.id, targetFolderId);
    }
    setFiles(prev => prev.map(f => targets.find(s => s.id === f.id) ? { ...f, folder_id: targetFolderId } : f));
    if (!moveSingle) setSelectedIds(new Set());
    setMoveSingle(null);
    setMoveTargetOpen(false);
  }, [selectedDeletable, businessId, moveSingle]);

  const onDeleteConfirmed = useCallback(async () => {
    if (!deleteConfirm) return;
    const ok = await deleteProjectFile(businessId, deleteConfirm.id);
    if (ok) {
      setFiles(prev => prev.filter(f => f.id !== deleteConfirm.id));
      if (preview?.id === deleteConfirm.id) setPreview(null);
    }
    setDeleteConfirm(null);
  }, [deleteConfirm, businessId, preview]);

  /* 좌측 트리의 드롭 — **한 인스턴스**를 두 트리가 나눠 쓴다. 각자 훅을 부르면 «끌어온 표시»
     상태가 두 벌이 되어 한쪽에 올렸는데 다른 쪽이 안 밝아진다. */
  const treeDrop = useFolderDrop(onDropToFolder, (fid, fl) => handleFiles(fl, fid));
  /* 여는 문 한 곳 — 헤더 버튼과 미리보기 영역 클릭이 같은 함수를 쓴다. */
  const { opening, shortcutUrl, openPreviewTarget } = useFileOpen(businessId, preview, dl);

  const isEmpty = !loading && files.length === 0;

  return (
    <Wrap
      /* ★ 2026-09-20 (Irene: *"파일을 드래그 해서 좌측 폴더에 넣으면 그리로 들어가는 거 아니야?
         왜 드래그 해서 당기면 업로드하라는 아이콘이 나와???"*) —
         이 껍데기가 **모든** 드래그에 업로드 오버레이를 띄웠다. 오버레이는 안쪽을 통째로 덮으므로
         좌측 폴더 행이 드롭을 **받지 못한다** — 옮기기가 되는데도 "안 된다" 로 보였다.
         바깥(OS)에서 끌어온 것만 업로드다. 우리 파일을 끌 때는 전용 MIME 이 실려 온다. */
      onDragEnter={e => {
        if (!isExternalFileDrag(e)) return;
        e.preventDefault(); setDragOver(true);
        // 바깥 파일도 폴더에 놓을 수 있다 — 좌측 점선을 같이 켠다.
        try { document.body.dataset.pqDragfile = '1'; } catch { /* noop */ }
      }}
      onDragLeave={e => {
        if (e.currentTarget.contains(e.relatedTarget as Node)) return;
        setDragOver(false);
        try { delete document.body.dataset.pqDragfile; } catch { /* noop */ }
      }}
      onDragOver={e => { if (!isExternalFileDrag(e)) return; e.preventDefault(); }}
      onDrop={e => {
        if (!isExternalFileDrag(e)) { setDragOver(false); return; }
        e.preventDefault(); setDragOver(false);
        try { delete document.body.dataset.pqDragfile; } catch { /* noop */ }
        handleFiles(e.dataTransfer.files);
      }}
    >
      <Inner>
      {/* GDrive 연결 안내 / 연결 추천 (workspace · project 양쪽) */}
      {businessId > 0 && <CloudConnectNotice businessId={businessId} />}

      {/* 드롭 오버레이 (전역 드래그 중 표시) */}
      {dragOver && <DragOverlay data-testid="docs-upload-overlay">
        <DragOverlayInner>
          <DzIcon $large>
            <svg width="42" height="42" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
              <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
              <polyline points="17 8 12 3 7 8" /><line x1="12" y1="3" x2="12" y2="15" />
            </svg>
          </DzIcon>
          <div>{t('docs.drop.release', '여기에 놓아 업로드')}</div>
        </DragOverlayInner>
      </DragOverlay>}

      {/* 업로드 영역 — 파일 있을 때는 compact */}
      {isEmpty ? (
        <Dropzone $drag={dragOver} onClick={() => inputRef.current?.click()}
          role="button" tabIndex={0}
          onKeyDown={e => { if (isEnterAction(e) || e.key === ' ') inputRef.current?.click(); }}>
          <DzIcon>
            <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
              <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
              <polyline points="17 8 12 3 7 8" /><line x1="12" y1="3" x2="12" y2="15" />
            </svg>
          </DzIcon>
          <DzTitle>{t('docs.drop.title', '파일을 여기에 드롭하거나 클릭해 선택')}</DzTitle>
          {/* 이유만 말하면 막다른 길이다 — **더 큰 파일은 어떻게 하면 되는지**를 같이 말한다.
              Drive 가 연결돼 있으면 큰 파일이 실제로 그 경로로 올라간다(운영 84MB 실측). */}
          <DzHint>
            {uploadLimits
              ? (uploadLimits.external_ready
                ? t('docs.drop.hintDrive', '파일 하나에 {{limit}}까지 · 그보다 크면 Google Drive 로 저장됩니다', { limit: formatBytes(uploadLimits.self_max_bytes) })
                : t('docs.drop.hintLimit', '파일 하나에 {{limit}}까지 · 더 큰 파일은 Google Drive 를 연결하면 그대로 올라갑니다', { limit: formatBytes(uploadLimits.self_max_bytes) })) as string
              : t('docs.drop.hintPlain', '여러 파일을 한 번에 올릴 수 있습니다') as string}
          </DzHint>
          <DzHint><StorageLeft limits={uploadLimits} /></DzHint>
        </Dropzone>
      ) : (
        <CompactBar>
          <CompactUploadBtn type="button" onClick={() => inputRef.current?.click()}>
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
              <polyline points="17 8 12 3 7 8" /><line x1="12" y1="3" x2="12" y2="15" />
            </svg>
            {t('docs.drop.upload', '업로드')}
          </CompactUploadBtn>
          {/* ★ 한도는 **여기에도** 있어야 한다 — 드롭존은 워크스페이스가 완전히 빌 때만 나오고,
              파일이 하나라도 있으면 이 줄로 바뀐다. 즉 사용자가 실제로 보는 것은 거의 항상 이쪽인데
              여태 한도 얘기가 **아예 없었다**. "기준을 찾아"(#417) 라는 말이 나온 자리다. */}
          {/* ★ 폰에서는 **한도만** 남긴다 — 드래그 안내는 터치에서 뜻이 없고, 한도는 업로드가
              실패했을 때 **가장 필요한 정보**다. 옛 코드는 이 줄을 폰에서 통째로 숨겨서
              (`display:none`) 정작 필요한 사람만 못 보고 있었다(실측 0×0). */}
          <CompactHint>
            {uploadLimits && (
              <LimitPart>{t('docs.drop.limitOnly', '파일 하나에 {{limit}}까지', { limit: formatBytes(uploadLimits.self_max_bytes) }) as string}</LimitPart>
            )}
            <LimitPart>{uploadLimits && uploadLimits.bytes_quota != null ? ' · ' : ''}<StorageLeft limits={uploadLimits} /></LimitPart>
            <DragPart>
              {uploadLimits
                ? (t('docs.drop.compactHintTail', ' · 여기나 리스트 영역에 끌어다 놓아도 됩니다') as string)
                : (t('docs.drop.compactHint', '여기나 리스트 영역에 파일을 끌어다 놓아도 됩니다') as string)}
            </DragPart>
          </CompactHint>
        </CompactBar>
      )}
      <UploadQueuePanel uploads={uploads} onCancel={cancelUpload} />
      <input ref={inputRef} type="file" multiple hidden
        onChange={e => { if (e.target.files) handleFiles(e.target.files); e.target.value = ''; }} />

      {/* 툴바 */}
      <Toolbar>
        <SearchBox
          value={query}
          onChange={setQuery}
          placeholder={tr('docs.search', '파일 검색')}
          width={260}
        />
        <SortWrap>
          <PlanQSelect
            size="sm"
            value={{ value: sort, label: sortLabel(sort, tr) }}
            onChange={v => { const nv = (v as { value?: SortKey } | null)?.value; if (nv) setSort(nv); }}
            options={[
              { value: 'recent', label: t('docs.sort.recent', '최근 순') },
              { value: 'name', label: t('docs.sort.name', '이름 순') },
              { value: 'size', label: t('docs.sort.size', '크기 순') },
            ]}
          />
        </SortWrap>
        <ToolbarRight>
        <ViewToggle role="group" aria-label="view">
          <VT $active={view === 'grid'} type="button" onClick={() => setView('grid')} title={tr('docs.view.grid', '그리드')}>
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <rect x="3" y="3" width="7" height="7" /><rect x="14" y="3" width="7" height="7" />
              <rect x="14" y="14" width="7" height="7" /><rect x="3" y="14" width="7" height="7" />
            </svg>
          </VT>
          <VT $active={view === 'list'} type="button" data-testid="docs-view-list" onClick={() => setView('list')} title={tr('docs.view.list', '리스트')}>
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <line x1="8" y1="6" x2="21" y2="6" /><line x1="8" y1="12" x2="21" y2="12" />
              <line x1="8" y1="18" x2="21" y2="18" /><circle cx="4" cy="6" r="1" />
              <circle cx="4" cy="12" r="1" /><circle cx="4" cy="18" r="1" />
            </svg>
          </VT>
        </ViewToggle>
        <SelectToggle $on={selectMode} type="button" onClick={() => setSelectMode(v => !v)}>
          {selectMode ? t('docs.bulk.exit', '선택 종료') : t('docs.bulk.enter', '선택')}
        </SelectToggle>
        {/* 휴지통 — 지운 파일을 되돌리는 유일한 경로. 이게 없어서 삭제가 사실상 영구였다. */}
        <SelectToggle
          $on={trashOpen}
          type="button"
          data-testid="files-trash-open"
          onClick={() => setTrashOpen(true)}
          title={t('docs.trash.title', '휴지통') as string}
        >
          {t('docs.trash.title', '휴지통') as string}
        </SelectToggle>
        </ToolbarRight>
      </Toolbar>

      {/* 하니스 판정 신호(CLAUDE.md §17) — **양성**이어야 한다.
          "로딩 표식이 없다" 는 화면이 아직 안 뜬 것과 구별되지 않아 카나리가 눈이 멀었다.
          그리고 파일 영역 안에 두었더니 폰에서는 그 자리가 아예 안 그려져 판정 자체가 불가능했다
          (2026-08-29 실측). 그래서 뷰포트·모드와 무관하게 항상 그려지는 루트에 둔다. */}
      {loading
        ? <span data-testid="files-loading" hidden />
        : <span data-testid="files-ready" hidden />}

      <TrashDrawer
        open={trashOpen}
        businessId={Number(businessId)}
        projectId={scope.type === 'project' ? scope.projectId : undefined}
        onClose={() => setTrashOpen(false)}
        onChanged={() => { setReloadTick((v) => v + 1); }}
      />

      {/* Split: 좌 (폴더 트리 or 프로젝트 그룹) + 우 파일 영역
          N+30 — personal 모드: 좌측 패널 자체 렌더 X (평면 view, 폴더·프로젝트 그룹 없음) */}
      <Split $single={isPersonal}>
        {!isPersonal && (
        <FolderTreePanel>
          {isWorkspace ? (
            <>
              <ProjectGroups
                projectGroups={projectGroups}
                counts={counts}
                total={counts.total}
                selected={folderSel}
                onSelect={sel => { setFolderSel(sel); clearSelection(); }}
                tr={tr}
                folders={folders}
                folderCounts={counts.byFolder}
                onSelectFolder={id => { setFolderSel(id); clearSelection(); }}
                onCreateFolder={(pid, parentId) => setNewProjectFolder({ projectId: pid, parentId: parentId ?? null, name: '' })}
                folderDrop={treeDrop}
              />
              {/* Irene 2026-08-31 — 워크스페이스 파일에도 폴더.
                  프로젝트 그룹(출처별 탐색)은 그대로 두고 **아래에** 폴더를 더한다 —
                  둘은 다른 축이라 하나로 합치면 어느 쪽으로 찾는지가 흐려진다. */}
              <FolderTree
                folders={folders}
                counts={counts}
                total={counts.total}
                foldersOnly
                selected={folderSel}
                onSelect={sel => { setFolderSel(sel); clearSelection(); }}
                onCreate={async (parentId, name) => {
                  const f = await createWorkspaceFolder(businessId, name, parentId);
                  setFolders(prev => prev.some(x => x.id === f.id) ? prev : [...prev, f]);
                }}
                onRename={async (id, name) => {
                  await renameFolder(id, name);
                  setFolders(prev => prev.map(f => f.id === id ? { ...f, name } : f));
                }}
                onDelete={async (id) => {
                  await deleteFolder(id);
                  setFolders(prev => prev.filter(f => f.id !== id));
                  setFiles(prev => prev.map(f => f.folder_id === id ? { ...f, folder_id: null } : f));
                  if (folderSel === id) setFolderSel('all');
                }}
                onReorder={async (id, dir) => {
                  await reorderFolder(id, dir);
                  const fd = await fetchWorkspaceFolders(businessId);
                  setFolders(fd);
                }}
                onDropFiles={onDropToFolder}
                onDropExternal={(fid, fl) => handleFiles(fl, fid)}
                folderDrop={treeDrop}
                onDownloadFolder={onDownloadFolder}
                tr={tr}
              />
            </>
          ) : (
            <FolderTree
              folders={folders}
              counts={counts}
              total={counts.total}
              selected={folderSel}
              onSelect={sel => { setFolderSel(sel); clearSelection(); }}
              onCreate={async (parentId, name) => {
                const f = await createFolder(projectId, name, parentId);
                setFolders(prev => [...prev, f]);
              }}
              onRename={async (id, name) => {
                await renameFolder(id, name);
                setFolders(prev => prev.map(f => f.id === id ? { ...f, name } : f));
              }}
              onDelete={async (id) => {
                await deleteFolder(id);
                setFolders(prev => prev.filter(f => f.id !== id));
                setFiles(prev => prev.map(f => f.folder_id === id ? { ...f, folder_id: null } : f));
                if (folderSel === id) setFolderSel('direct');
              }}
              onReorder={async (id, direction) => {
                setFolders(prev => {
                  const target = prev.find(f => f.id === id);
                  if (!target) return prev;
                  const siblings = prev
                    .filter(f => f.parent_id === target.parent_id)
                    .sort((a, b) => a.sort_order - b.sort_order);
                  const idx = siblings.findIndex(s => s.id === id);
                  const targetIdx = direction === 'up' ? idx - 1 : idx + 1;
                  if (targetIdx < 0 || targetIdx >= siblings.length) return prev;
                  const reordered = [...siblings];
                  [reordered[idx], reordered[targetIdx]] = [reordered[targetIdx], reordered[idx]];
                  const orderMap = new Map(reordered.map((r, i) => [r.id, i]));
                  return prev.map(f => orderMap.has(f.id) ? { ...f, sort_order: orderMap.get(f.id)! } : f);
                });
                await reorderFolder(id, direction);
              }}
              onDropFiles={onDropToFolder}
              onDropExternal={(fid, fl) => handleFiles(fl, fid)}
              folderDrop={treeDrop}
              onDownloadFolder={onDownloadFolder}
              projectName={props.projectName}
              projectColor={props.projectColor}
              tr={tr}
            />
          )}
        </FolderTreePanel>
        )}

        <FilesArea ref={filesAreaRef}>
          {selectMode && selectedIds.size > 0 && (
            <BulkBar>
              <BulkBarLeft>
                <strong>{t('docs.bulk.selected', '{{n}}개 선택됨', { n: selectedIds.size })}</strong>
                <span>· {t('docs.bulk.deletable', '삭제 가능 {{n}}개', { n: selectedDeletable.length })}</span>
              </BulkBarLeft>
              <BulkBarRight>
                <BulkBtn type="button" onClick={selectAllVisible}>{t('docs.bulk.selectAll', '전체 선택')}</BulkBtn>
                <BulkBtn type="button" onClick={clearSelection}>{t('docs.bulk.clear', '해제')}</BulkBtn>
                <BulkBtnSep />
                <BulkBtn type="button" $primary
                  disabled={selectedDownloadable.length === 0 || downloading}
                  onClick={onBulkDownload}>
                  {downloading
                    ? zipProgressText
                    : t('docs.bulk.zipDownload', 'ZIP 다운로드 ({{n}})', { n: selectedDownloadable.length })}
                </BulkBtn>
                <BulkBtn type="button"
                  disabled={selectedFiles.length !== 1 || selectedFiles[0]?.source !== 'direct'}
                  onClick={onCreateShareLink}
                  title={selectedFiles.length !== 1
                    ? t('docs.bulk.shareHintOne', '파일 1개만 선택해주세요') as string
                    : ''}>
                  {t('docs.bulk.shareLink', '공유 링크')}
                </BulkBtn>
                <BulkBtnSep />
                <BulkBtn type="button" disabled={selectedDeletable.length === 0} onClick={() => setMoveTargetOpen(true)}>
                  {t('docs.bulk.move', '이동')}
                </BulkBtn>
                <BulkBtn $danger type="button" disabled={selectedDeletable.length === 0} onClick={() => setBulkDeleteOpen(true)}>
                  {t('docs.bulk.delete', '삭제')}
                </BulkBtn>
              </BulkBarRight>
            </BulkBar>
          )}
          {/* ★ 폴더 ⋯ 로 받을 때는 **선택 모드가 아니다** — 진행률이 일괄 선택 바 안에만 있어서
              큰 폴더를 받으면 수십 초 동안 화면에 아무 표시가 없었다(= 고장으로 읽힌다).
              선택 모드 **밖**에서도 보이는 자리에 둔다(ErrorBar 와 같은 자리). */}
          {downloading && !selectMode && (
            <ErrorBar role="status" data-testid="folder-zip-progress">
              {t('docs.folder.downloading', '폴더를 압축해 받는 중… {{p}}', { p: zipProgressText }) as string}
            </ErrorBar>
          )}
          {shareError && <ErrorBar>{shareError}</ErrorBar>}
          {dl.error && <ErrorBar>{dl.error}</ErrorBar>}
          {/* 편집 열기 안내 — 링크는 열렸지만 권한을 못 준 경우까지 말한다(조용한 실패 금지). */}
          {editNote && <ErrorBar data-testid="drive-edit-note" onClick={() => setEditNote(null)}>{editNote}</ErrorBar>}
          {shareLinkInfo && (
            <ShareLinkBar>
              <strong>{t('docs.bulk.shareCreated', '공유 링크 생성 — 클립보드에 복사됨')}</strong>
              <ShareUrl>{shareLinkInfo.url}</ShareUrl>
              <small>{t('docs.bulk.shareExpires', '만료: {{date}}', { date: new Date(shareLinkInfo.expires).toLocaleDateString() })}</small>
              <BulkBtn type="button" onClick={() => setShareLinkInfo(null)}>{t('common.close', '닫기')}</BulkBtn>
            </ShareLinkBar>
          )}

          {/* data-testid — 하니스가 "재진입에 또 로딩되는가" 를 판정하는 신호(CLAUDE.md §17) */}
          {loading ? (
            view === 'grid' ? (
              <Grid>
                {Array.from({ length: 6 }).map((_, i) => (
                  <SkeletonCard key={i}>
                    <SkThumb /><SkLine $w="70%" /><SkLine $w="45%" />
                  </SkeletonCard>
                ))}
              </Grid>
            ) : (
              <ListTable>
                {Array.from({ length: 6 }).map((_, i) => (
                  <SkeletonRow key={i}>
                    <SkIcon /><SkLine $w="40%" /><SkLine $w="15%" /><SkLine $w="12%" />
                  </SkeletonRow>
                ))}
              </ListTable>
            )
          ) : visible.length === 0 ? (
            /* ★ 실패를 빈 상태로 위장하지 않는다 — 빈 상태보다 먼저 판정한다 */
            loadError ? (
              <EmptyState
                icon={<svg width="36" height="36" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="12" r="10"/><line x1="12" y1="8" x2="12" y2="12"/><line x1="12" y1="16" x2="12.01" y2="16"/></svg>}
                title={t('docs.loadError.title', '파일을 불러오지 못했습니다')}
                description={t('docs.loadError.desc', '잠시 후 다시 시도해 주세요. 계속 안 되면 네트워크 연결을 확인해 주세요.')}
              />
            ) : files.length === 0 ? (
              <EmptyState
                icon={<EmptyIcon />}
                title={t('docs.empty.title', '아직 파일이 없어요')}
                description={t('docs.empty.desc', '드롭존에 파일을 떨어뜨리거나, 채팅·업무·회의에 첨부하면 여기에 모입니다')}
              />
            ) : (
              <Dim>{t('docs.empty.filtered', '조건에 맞는 파일이 없습니다')}</Dim>
            )
          ) : view === 'grid' ? (
            <Grid>
              {visible.map((f, idx) => {
                const checked = selectedIds.has(f.id);
                // 파일명에 없으면 설명·태그 중 어디서 찾았는지 한 줄로 알려준다 (필터 술어와 같은 순서)
                const hit = query.trim() ? pickMatch([
                  { field: 'file_name', text: f.file_name, shown: true },
                  { field: 'description', text: f.description },
                  { field: 'tag', text: f.tags || [] },
                ], query) : null;
                return (
                  <Card key={f.id} $selected={checked} data-testid="file-card" data-file-id={f.id}
                    {...getDragProps(f)}
                    onClick={e => selectMode ? toggleSelect(f.id, e) : setPreview(f)}>
                    {selectMode && (
                      <CardCheck onClick={e => e.stopPropagation()}>
                        <input type="checkbox" checked={checked} onChange={() => toggleSelect(f.id)} disabled={!f.deletable} />
                      </CardCheck>
                    )}
                    {(() => {
                      const img = isImage(f.mime_type, f.file_name);
                      const valid = !!f.preview_url && f.preview_url !== '#';
                      return (
                        <Thumb>
                          {img && valid && !thumbFailed.has(f.id)
                            /* ★ 배경 이미지(background-image)로 두면 **화면 밖 카드까지 전부** 받는다.
                                 운영 실측: /files 한 번 열면 API 요청 1,099건 — 그중 ~1,000건이 이 썸네일이고,
                                 한도는 600건/분이다. 즉 **파일 화면을 한 번 여는 것만으로 그 사용자가 잠긴다**
                                 (그 상태로 새로고침하면 refresh 가 429 → 로그인 화면으로 튕긴다).
                                 <img loading="lazy"> 는 뷰포트에 들어올 때만 받는다. contain·가운데 정렬은
                                 object-fit 으로 유지 — 보이는 모양은 그대로다(#121 규칙 보존). */
                            ? (
                              <ThumbImg
                                src={withW(f.preview_url, 400)} alt=""
                                /* ★ 2026-09-20 (Irene: *"계속 바로 바로 안뜨고 엄청 오래 걸린다고. 리스트 썸네일이"*)
                                   — `loading="lazy"` 는 **화면 안에 있어도 낮은 우선순위**로 받는다.
                                   운영 nginx 가 HTTP/1.1 이라 연결이 6개뿐인데, 그 6개를 API 호출과
                                   나눠 쓰면서 낮은 우선순위로 밀리니 첫 화면 썸네일이 한참 뒤에 뜬다.
                                   **첫 화면에 보이는 것들**은 바로 받고(eager+high), 나머지만 lazy 로 둔다.
                                   서버는 빠르다 — 운영 실측 40ms(디스크 캐시 적중). 줄서기가 문제였다. */
                                loading={idx < EAGER_THUMBS ? 'eager' : 'lazy'}
                                fetchPriority={idx < EAGER_THUMBS ? 'high' : 'low'}
                                decoding="async"
                                /* ★ 못 받은 이미지는 **감춘다.** 옛 background-image 는 실패해도 배경색만
                                     보였는데, <img> 로 바꾸면 깨진 아이콘이 그대로 뜬다(실측 3건).
                                     고치면서 새 흠집을 내지 않는다 — 실패하면 파일 종류 아이콘으로 되돌린다. */
                                onError={() => setThumbFailed((prev) => prev.has(f.id) ? prev : new Set(prev).add(f.id))}
                              />
                            )
                            : <FileExtIcon ext={extOf(f.file_name)} size={56} large />}
                          {/* ★ 2026-09-20 (Irene: *"폴더이름 아래에 있는 거 이상하다고. 날짜 좁게 나오고
                              이게 뭐야? … 직접업로드 옆에, 업무, 회의 이런 거 옆에 나오게 배치를 해"*) —
                              폴더 칩을 **날짜 줄**에 넣었더니 날짜를 밀어 좁아졌다. 분류는 분류끼리 —
                              출처 태그와 한 줄로 묶는다.
                              ★ 태그가 각자 `absolute` 라 두 개 이상이면 **서로 겹쳐 있었다**(출처가 둘인 파일).
                                줄로 묶으면서 같이 풀린다. */}
                          <TagRow>
                            {srcsOf(f).map(sc => (
                              <SourceTag key={sc} $src={sc}>{sourceShortLabel(sc, tr)}</SourceTag>
                            ))}
                            {f.folder_id && <FolderChip data-folder-chip $onThumb title={currentFolderName(f)}>{currentFolderName(f)}</FolderChip>}
                          </TagRow>
                        </Thumb>
                      );
                    })()}
                    <CardName title={f.file_name}><HighlightText text={f.file_name} query={query} /></CardName>
                    {hit && !hit.shown && (
                      <CardReason><MatchReason field={hit.field} snippet={hit.snippet} query={query} /></CardReason>
                    )}
                    {/* 공유 범위 (Irene 2026-08-31): "리스트에 … 공유범위가 같이 표시되어야 맞는 것 같은데?"
                        누가 올렸는지는 보이는데 **누가 볼 수 있는지**는 안 보였다. 파일 목록에서
                        가장 알고 싶은 것이 그것이다(특히 개인 보관함에서 L1 인지 눈으로 확인). */}
                    <CardMeta>
                      {f.visibility && <VisibilityBadge level={f.visibility as 'L1' | 'L2' | 'L3' | 'L4'} compact />}
                      {f.security_level && f.security_level !== 'general' && <SecurityLevelBadge level={f.security_level} />}
                    </CardMeta>
                    <CardMeta><span>{formatBytes(f.file_size)}</span><span>·</span><span>{f.uploader_name}</span></CardMeta>
                    <CardMeta>
                      <span>{formatDate(f.uploaded_at)}</span>
                      {/* ★ 그리드가 **기본 뷰**다 — 폰도 여기로 시작한다. 여기에 [폴더로 이동] 이 없으면
                          폰에서는 옮길 방법이 여전히 없다(드래그가 안 된다). 리스트 뷰에만 붙였다가
                          Fable 재검증에서 잡혔다: "리스트 뷰에만 있다 · 폰 기본 뷰에서는 0개".
                          ★ 폴더 **이름**은 여기 두지 않는다 — 날짜를 민다. 분류는 썸네일의 태그 줄로. */}
                      {isMovableInApp(f) && !selectMode && folders.length > 0 && (
                        <MoveBtn type="button" style={{ marginLeft: 'auto' }}
                          title={t('docs.moveTo') as string} aria-label={t('docs.moveTo') as string}
                          data-testid={`docs-file-move-${f.id}`}
                          onClick={e => { e.stopPropagation(); setMoveSingle(f); setMoveTargetOpen(true); }}>
                          <FolderMoveSvg />
                        </MoveBtn>
                      )}
                    </CardMeta>
                  </Card>
                );
              })}
            </Grid>
          ) : (
            <ListTable>
              <ListHead $selectMode={selectMode}>
                {selectMode && <HCChk>
                  <input type="checkbox"
                    checked={visible.length > 0 && visible.every(v => selectedIds.has(v.id))}
                    onChange={e => e.target.checked ? selectAllVisible() : clearSelection()} />
                </HCChk>}
                <HCName>{t('docs.col.name', '파일명')}</HCName>
                <HCSrc>{t('docs.col.source', '출처')}</HCSrc>
                <HCSize>{t('docs.col.size', '크기')}</HCSize>
                <HCUp>{t('docs.col.uploader', '업로더')}</HCUp>
                <HCDate>{t('docs.col.date', '업로드')}</HCDate>
                <HCAct />
              </ListHead>
              {visible.map(f => {
                const checked = selectedIds.has(f.id);
                const hit = query.trim() ? pickMatch([
                  { field: 'file_name', text: f.file_name, shown: true },
                  { field: 'description', text: f.description },
                  { field: 'tag', text: f.tags || [] },
                ], query) : null;
                return (
                  <ListRow key={f.id} $selected={checked} data-file-id={f.id}
                    $selectMode={selectMode}
                    {...getDragProps(f)}
                    onClick={() => selectMode ? toggleSelect(f.id) : setPreview(f)}>
                    {selectMode && <RowChk onClick={e => e.stopPropagation()}>
                      <input type="checkbox" checked={checked} onChange={() => toggleSelect(f.id)} disabled={!f.deletable} />
                    </RowChk>}
                    <RowName>
                      <FileExtIcon ext={extOf(f.file_name)} size={32} />
                      <RowNameStack>
                        <RowNameText title={f.file_name}><HighlightText text={f.file_name} query={query} /></RowNameText>
                        {hit && !hit.shown && <MatchReason field={hit.field} snippet={hit.snippet} query={query} />}
                      </RowNameStack>
                      {/* #379 — Drive 에서 사본을 지우면 원본은 그대로 두고 미러만 끊는다.
                          알려주지 않으면 사용자는 "드라이브에 없는데 왜 여기 있지" 를 설명할 수 없다. */}
                      {f.gdrive_unmirrored && (
                        <UnmirrorTag title={tr('docs.unmirroredHint') as string}>
                          {tr('docs.unmirrored') as string}
                        </UnmirrorTag>
                      )}
                    </RowName>
                    <RowSrc>
                      {srcsOf(f).map(sc => (
                        <SourcePill key={sc} $src={sc}>{sourceShortLabel(sc, tr)}</SourcePill>
                      ))}
                      {isWorkspace && f.project_context ? (
                        <ProjectLink to={`/projects/p/${f.project_context.id}?tab=docs`} onClick={e => e.stopPropagation()}>
                          <ProjectDot $color={f.project_context.color || '#14B8A6'} />
                          <span>{f.project_context.name}</span>
                        </ProjectLink>
                      ) : f.context ? (
                        <RowCtx title={f.context.label}>{f.context.label}</RowCtx>
                      ) : null}
                      {f.folder_id && <FolderChip data-folder-chip title={currentFolderName(f)}>{currentFolderName(f)}</FolderChip>}
                    </RowSrc>
                    <RowSize>{formatBytes(f.file_size)}</RowSize>
                    <RowUp>{f.uploader_name}</RowUp>
                    <RowDate>{formatDate(f.uploaded_at)}</RowDate>
                    <RowAct>
                      {/* 목록에서 바로 받기 — 전에는 미리보기를 열어야만 받을 수 있었다.
                          진행률은 미리보기와 같은 훅(useFileDownload)이 만든다. */}
                      {!selectMode && f.download_url && f.download_url !== '#' && (
                        <IconBtn type="button"
                          disabled={dl.downloading}
                          title={dl.downloadingId === f.id ? (dl.progressText || '') : tr('docs.download')}
                          aria-label={tr('docs.download')}
                          onClick={e => { e.stopPropagation(); dl.start(f.download_url, f.file_name, f.id); }}>
                          {dl.downloadingId === f.id ? (
                            <DlPct>{dl.progressText}</DlPct>
                          ) : (
                            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                              <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
                              <polyline points="7 10 12 15 17 10" />
                              <line x1="12" y1="15" x2="12" y2="3" />
                            </svg>
                          )}
                        </IconBtn>
                      )}
                      {isMovableInApp(f) && !selectMode && folders.length > 0 && (
                        <MoveBtn type="button"
                          title={t('docs.moveTo') as string} aria-label={t('docs.moveTo') as string}
                          data-testid={`docs-file-move-${f.id}`}
                          onClick={e => { e.stopPropagation(); setMoveSingle(f); setMoveTargetOpen(true); }}>
                          <FolderMoveSvg />
                        </MoveBtn>
                      )}
                      {f.deletable && !selectMode && (
                        <IconBtn type="button" title={tr('docs.delete', '삭제')}
                          onClick={e => { e.stopPropagation(); setDeleteConfirm(f); }}>
                          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                            <polyline points="3 6 5 6 21 6" />
                            <path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6" />
                            <path d="M10 11v6M14 11v6" />
                          </svg>
                        </IconBtn>
                      )}
                    </RowAct>
                  </ListRow>
                );
              })}
            </ListTable>
          )}
          {marquee && (
            <MarqueeBox style={{ left: marquee.x, top: marquee.y, width: marquee.w, height: marquee.h }} />
          )}
        </FilesArea>
      </Split>

      {/* Q6 — ?file= 를 못 열었을 때 이유를 말한다(다른 워크스페이스 포함) */}
      <DetailFallbackDrawer state={preview ? null : missingFile} onClose={closeMissingFile} />

      {/* 미리보기 드로어 */}
      <DetailDrawer open={!!preview} onClose={() => setPreview(null)} ariaLabel={tr('docs.preview.aria', '파일 미리보기')}>
        {preview && (
          <>
            <DetailDrawer.Header onClose={() => setPreview(null)}>
              <PvHeaderInner>
                <PvHeaderText>
                  <PvTitle data-testid="file-preview-title">{preview.file_name}</PvTitle>
                  <PvSubRow data-testid="file-preview-meta">
                    <SourcePill $src={preview.source}>{sourceShortLabel(preview.source, tr)}</SourcePill>
                    <PvSub>{formatBytes(preview.file_size)} · {preview.uploader_name}</PvSub>
                    {/* ★ 2026-09-20 (Irene: *"제목은 첫줄에 다 나오고 버튼들은 직접 업로드 172b
                        업로드한 사람 이름 나오는 줄에 같은 줄로 나와야 하는 거 아니야? 우측 정렬해서?
                        제목이 다 잘리고 불필요하게 두 줄이 되는데."*) —
                        버튼을 제목 **옆**에 두면 제목 칸이 그만큼 줄어 긴 파일명이 두 줄로 접힌다.
                        메타 줄로 내리고 우측 끝에 붙인다(빈 칸막이가 아니라 margin-left:auto —
                        줄이 바뀔 때 버튼이 새 줄 왼쪽으로 떨어지지 않게). */}
                  <PvActions data-testid="file-preview-actions">
                    {/* 공유는 **직접 업로드 파일**만. 채팅·업무 첨부는 id 체계가 달라(chat-45 는
                        MessageAttachment id) 같은 라우트를 때리면 남의 파일을 가리키거나 404 다.
                        되지도 않는 버튼을 보여주면 사용자는 "눌렀는데 아무 일도 안 난다" 로 읽는다. */}
                    {preview.source === 'direct' && (
                    <HeaderIconBtn type="button" onClick={() => setShareTarget(preview)}
                      title={tr('docs.share', '공유')} aria-label={tr('docs.share', '공유')}>
                      <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                        <circle cx="18" cy="5" r="3" />
                        <circle cx="6" cy="12" r="3" />
                        <circle cx="18" cy="19" r="3" />
                        <line x1="8.59" y1="13.51" x2="15.42" y2="17.49" />
                        <line x1="15.41" y1="6.51" x2="8.59" y2="10.49" />
                      </svg>
                    </HeaderIconBtn>
                    )}
                    {/* ★ "열기" — 내려받지 않고 원본을 새 탭에서 본다 (Irene 2026-08-31 "오픈기능이 필요해").
                      * 팝업 차단을 피하려면 **클릭과 같은 틱에** 탭을 열어야 한다. 그래서 빈 탭을 먼저 열고,
                      * 인증 fetch 로 받은 blob 주소를 나중에 넣는다(다운로드 라우트는 Bearer 를 요구해
                      * 링크로 직접 걸면 401 이다). noopener 를 주면 핸들이 null 이라 넣을 곳이 없어진다.
                      * 서버가 attachment 로만 내보내는 형식(html·svg 등)에는 버튼을 두지 않는다 —
                      * 눌러도 다운로드가 시작될 뿐이다(services/files.ts canOpenInNewTab). */}
                    {canOpenInNewTab(preview) && (() => {
                    const openLabel = t('docs.preview.openInNewTab', '새 탭에서 열기') as string;
                    return (
                    <HeaderIconBtn type="button"
                      data-testid="file-preview-open"
                      disabled={opening}
                      onClick={() => { void openPreviewTarget(preview, shortcutUrl); }}
                      title={openLabel} aria-label={openLabel}>
                      <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                        <path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6" />
                        <polyline points="15 3 21 3 21 9" /><line x1="10" y1="14" x2="21" y2="3" />
                      </svg>
                    </HeaderIconBtn>
                    ); })()}
                    {/* 편집 열기 — 바이트가 Drive 에 있는 파일만. Drive 편집기가 docx/xlsx/pptx 를 그대로 연다.
                      * ★ 링크만으로는 **연결 계정 본인에게만** 열린다 — 서버가 요청자에게 권한을 주고 링크를 준다. */}
                    {preview.storage_provider === 'gdrive' && (
                      <HeaderIconBtn type="button"
                        data-testid="file-drive-edit"
                        disabled={editOpening}
                        onClick={() => openDriveEdit(preview)}
                        title={tr('docs.driveEdit.open')} aria-label={tr('docs.driveEdit.open')}>
                        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                          <path d="M17 3a2.85 2.83 0 1 1 4 4L7.5 20.5 2 22l1.5-5.5Z" />
                        </svg>
                      </HeaderIconBtn>
                    )}
                    {/* ★ 여기는 원래 `<a href download>` 였다 — 그 라우트는 Bearer 헤더를 요구해서
                      * 링크로는 100% 401 이었다(실측). 인증 fetch 로 받고, 받는 동안 상태를 보여준다. */}
                    {(() => { const dlLabel = tr('docs.download', '다운로드'); return (
                    <HeaderIconBtn type="button"
                      data-testid="file-preview-download"
                      disabled={dl.downloading}
                      onClick={() => dl.start(preview.download_url, preview.file_name)}
                      title={dl.downloading ? (dl.progressText || '') : dlLabel}
                      aria-label={dlLabel}>
                      {dl.downloading ? (
                        <DownloadingText>{dl.progressText}</DownloadingText>
                      ) : (
                        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                          <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
                          <polyline points="7 10 12 15 17 10" /><line x1="12" y1="15" x2="12" y2="3" />
                        </svg>
                      )}
                    </HeaderIconBtn>
                    ); })()}
                    {preview.deletable && (
                      <HeaderIconBtn $danger type="button" onClick={() => setDeleteConfirm(preview)}
                        title={tr('docs.delete', '삭제')} aria-label={tr('docs.delete', '삭제')}>
                        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                          <polyline points="3 6 5 6 21 6" />
                          <path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6" />
                          <path d="M10 11v6M14 11v6" />
                        </svg>
                      </HeaderIconBtn>
                    )}
                  </PvActions>
                  </PvSubRow>
                </PvHeaderText>
              </PvHeaderInner>
            </DetailDrawer.Header>
            <DetailDrawer.Body>
              <PreviewArea file={preview} businessId={businessId} shortcutUrl={shortcutUrl}
                onOpen={() => { void openPreviewTarget(preview, shortcutUrl); }} />
              {/* 이름·설명·태그 — 파일명만으로 못 찾는 자료를 검색 가능하게 (자동저장) */}
              {preview.source === 'direct' && preview.deletable && (
                <FileMetaEditor
                  key={preview.id}
                  businessId={businessId}
                  file={preview}
                  onSaved={(m) => {
                    setPreview(prev => (prev ? { ...prev, ...m } : prev));
                    setFiles(prev => prev.map(f => (f.id === preview.id ? { ...f, ...m } : f)));
                  }}
                />
              )}
              <MetaList>
                <MetaItem><MetaKey>{t('docs.col.uploader', '업로더')}</MetaKey><MetaVal>{preview.uploader_name}</MetaVal></MetaItem>
                <MetaItem><MetaKey>{t('docs.col.date', '업로드')}</MetaKey><MetaVal>{formatDate(preview.uploaded_at)}</MetaVal></MetaItem>
                <MetaItem><MetaKey>{t('docs.col.size', '크기')}</MetaKey><MetaVal>{formatBytes(preview.file_size)}</MetaVal></MetaItem>
                <MetaItem><MetaKey>{t('docs.col.mime', '형식')}</MetaKey><MetaVal>{preview.mime_type || '—'}</MetaVal></MetaItem>
                {preview.context && <MetaItem>
                  <MetaKey>{t('docs.col.context', '출처')}</MetaKey><MetaVal>{preview.context.label}</MetaVal>
                </MetaItem>}
                {/* Cue 가 이 파일 내용을 읽는지 — 안 읽으면 **왜 안 읽는지**까지 한 줄로.
                    이 줄이 없으면 "왜 이 파일은 못 찾아?" 가 다음 신고가 된다
                    (memory: feedback_rules_must_be_explained_briefly). */}
                {preview.cue_read && <MetaItem>
                  <MetaKey>{t('docs.cueRead.label', 'Cue 읽기')}</MetaKey>
                  <CueReadVal $ok={preview.cue_read.ok}>{cueReadText(preview, t)}</CueReadVal>
                </MetaItem>}
              </MetaList>
              {/* N+67 — 공개 범위 변경 UI (source='direct' 인 파일만 변경 가능. 채팅/업무 첨부는 상위 visibility 따름) */}
              {preview.source === 'direct' && (
                <VisibilitySection>
                  <SectionLabel>{t('docs.visibility', { defaultValue: '공개' }) as string}</SectionLabel>
                  <VisibilityField
                    value={parseVisibility({
                      vlevel: preview.visibility ?? null,
                      project_id: preview.project_id ?? null,
                      client_id: null,
                      client_ids: null,
                      target_member_ids: null,
                    })}
                    onChange={async (v: VisibilityValue) => {
                      const fileIdNum = Number(String(preview.id).replace(/^direct-/, ''));
                      if (!fileIdNum) return;
                      const bizId = scope.businessId;
                      const ser = serializeVisibility(v);
                      try {
                        const rv = await updateFileVisibility(bizId, fileIdNum, {
                          level: v.vlevel,
                          ...(v.variant === 'L2_project' && ser.project_id ? { project_id: ser.project_id } : {}),
                        });
                        setPreview(prev => prev ? { ...prev, visibility: v.vlevel, project_id: ser.project_id } : prev);
                        // ★ 보안등급과 **같은 처리** (2026-09-17, Fable 10차 #4).
                        //   개인(L1)으로 내렸는데 사본을 못 거둔 경우(`is_origin`·`failed`)를
                        //   말하지 않으면, 사용자는 «개인으로 돌렸다» 고 믿는데 공유 폴더엔 그대로다.
                        if (rv.drive_copy === 'is_origin' || rv.drive_copy === 'failed') {
                          setShareError(t(
                            rv.drive_copy === 'is_origin' ? 'docs.security.driveOrigin' : 'docs.security.driveFailed',
                          ) as string);
                        }
                      } catch (_) { /* skip */ }
                    }}
                    projects={projects.map(p => ({ id: p.id, name: p.name }))}
                    clients={clients.map(c => ({ id: c.id, display_name: c.display_name, biz_name: c.biz_name, company_name: c.company_name }))}
                    members={members}
                    hide={{ L4: true }}  // file 외부 share 는 ShareModal 흐름이 표준
                  />
                  {/* D4 #62 — 보안등급 (visibility 와 별개 축. 내부·기밀은 외부 공유 차단) */}
                  <SectionLabel style={{ marginTop: 14 }}>{t('securityLevel.label', { defaultValue: '보안등급' }) as string}</SectionLabel>
                  <PlanQSelect
                    size="sm" isClearable={false} isSearchable={false}
                    value={{ value: preview.security_level || 'general', label: secLabel(preview.security_level || 'general') }}
                    options={(['general', 'internal', 'confidential'] as const).map((lv) => ({ value: lv, label: secLabel(lv) }))}
                    onChange={async (o) => {
                      const lv = (((o as { value?: string })?.value) || 'general') as 'general' | 'internal' | 'confidential';
                      const fileIdNum = Number(String(preview.id).replace(/^direct-/, ''));
                      if (!fileIdNum) return;
                      try {
                        const r = await updateFileSecurityLevel(scope.businessId, fileIdNum, lv);
                        setPreview(prev => prev ? { ...prev, security_level: lv, ...(r.revoked_share ? { share_token: null } : {}) } : prev);
                        // ★ **Drive 사본이 남았으면 말한다** (2026-09-17, Fable 8차 차단②).
                        //   등급을 올리면 서버가 사본을 거두는데, 못 거두는 경우가 있다:
                        //   `is_origin`(Drive 가 원본이라 지우면 파일이 사라진다) · `failed`(토큰 만료 등).
                        //   조용히 넘어가면 사용자는 «비밀로 바꿨다» 고 믿는데 사본은 Drive 에 그대로다.
                        if (lv !== 'general' && (r.drive_copy === 'is_origin' || r.drive_copy === 'failed')) {
                          setShareError(t(
                            r.drive_copy === 'is_origin' ? 'docs.security.driveOrigin' : 'docs.security.driveFailed',
                          ) as string);
                        }
                      } catch (_) { /* skip */ }
                    }}
                  />
                  <SecHint>{t(`securityLevel.${preview.security_level || 'general'}Hint`, { defaultValue: '' }) as string}</SecHint>
                </VisibilitySection>
              )}
            </DetailDrawer.Body>
          </>
        )}
      </DetailDrawer>

      {/* 공유 모달 */}
      {shareTarget && (
        <ShareModal
          open={!!shareTarget}
          entityType="file"
          /* ★ 운영 #390 — 여기가 `Number(shareTarget.id)` 였다. ProjectFile.id 는 'direct-12'
             같은 **합성 문자열**이라 Number() 는 NaN 이 되고, /api/files/NaN/share 라는
             존재하지 않는 경로를 때려 공유 링크가 아예 만들어지지 않았다.
             실패가 404 HTML 이라 화면에는 아무 말도 안 뜬다 — "생성이 안됨" 의 정체. */
          entityId={parseFileId(String(shareTarget.id))?.id ?? 0}
          entityTitle={shareTarget.file_name}
          onClose={() => setShareTarget(null)}
        />
      )}

      {/* 단일 삭제 확인 */}
      {deleteConfirm && (
        <Modal onMouseDown={e => { if (e.target === e.currentTarget) setDeleteConfirm(null); }}>
          <Dialog>
            <DTitle>{t('docs.confirmDelete.title', '파일을 삭제할까요?')}</DTitle>
            <DBody>
              <p><strong>{deleteConfirm.file_name}</strong></p>
              {/* ★ 휴지통이 생기면서 이 문구가 거짓말이 됐다 — 동작을 바꾸면 그 동작을 설명하는
                  문자열도 같이 바꾼다(memory feedback_new_behavior_makes_copy_lie). */}
              <p>{t('docs.confirmDelete.descTrash', '삭제한 파일은 휴지통으로 이동합니다. 30일 안에 되돌릴 수 있습니다.')}</p>
            </DBody>
            <DFooter>
              <SecondaryBtn type="button" onClick={() => setDeleteConfirm(null)}>{t('members.cancel', '취소')}</SecondaryBtn>
              <DangerBtn type="button" onClick={onDeleteConfirmed}>{t('docs.delete', '삭제')}</DangerBtn>
            </DFooter>
          </Dialog>
        </Modal>
      )}

      {/* 대량 삭제 확인 */}
      {bulkDeleteOpen && (
        <Modal onMouseDown={e => { if (e.target === e.currentTarget) setBulkDeleteOpen(false); }}>
          <Dialog>
            <DTitle>{t('docs.bulkDelete.title', '{{n}}개 파일을 삭제할까요?', { n: selectedDeletable.length })}</DTitle>
            <DBody>
              <BulkFileList>
                {selectedDeletable.slice(0, 5).map(f => (
                  <BulkFileItem key={f.id}>• {f.file_name}</BulkFileItem>
                ))}
                {selectedDeletable.length > 5 && (
                  <BulkFileMore>{t('docs.bulkDelete.more', '외 {{n}}개', { n: selectedDeletable.length - 5 })}</BulkFileMore>
                )}
              </BulkFileList>
              <p>{t('docs.confirmDelete.descTrash', '삭제한 파일은 휴지통으로 이동합니다. 30일 안에 되돌릴 수 있습니다.')}</p>
            </DBody>
            <DFooter>
              <SecondaryBtn type="button" onClick={() => setBulkDeleteOpen(false)}>{t('members.cancel', '취소')}</SecondaryBtn>
              <DangerBtn type="button" onClick={onBulkDeleteConfirmed}>{t('docs.delete', '삭제')}</DangerBtn>
            </DFooter>
          </Dialog>
        </Modal>
      )}

      {/* 워크스페이스 업로드: 프로젝트 선택 */}
      {pendingUpload && (
        <Modal onMouseDown={e => { if (e.target === e.currentTarget) setPendingUpload(null); }}>
          <Dialog>
            <DTitle>{t('docs.wsUpload.title', '어느 프로젝트에 업로드할까요?')}</DTitle>
            <DBody>
              <p>{t('docs.wsUpload.desc', '{{n}}개 파일을 업로드할 프로젝트를 선택하세요', { n: pendingUpload.length })}</p>
              <MoveTargetList>
                {projectGroups.length === 0 ? (
                  <Dim>{t('docs.wsUpload.noProject', '프로젝트가 없습니다')}</Dim>
                ) : projectGroups.map(p => (
                  <MoveTargetRow key={p.id} type="button"
                    onClick={() => setWorkspaceUploadProject(p.id)}
                    style={workspaceUploadProject === p.id ? { background: '#F0FDFA', borderColor: '#14B8A6' } : {}}>
                    <ProjectDot $color={p.color || '#14B8A6'} />
                    <span>{p.name}</span>
                  </MoveTargetRow>
                ))}
              </MoveTargetList>
            </DBody>
            <DFooter>
              <SecondaryBtn type="button" onClick={() => { setPendingUpload(null); setWorkspaceUploadProject(null); }}>{t('members.cancel', '취소')}</SecondaryBtn>
              <PrimaryBtn type="button" disabled={!workspaceUploadProject} onClick={commitWorkspaceUpload}>
                {t('docs.wsUpload.confirm', '업로드')}
              </PrimaryBtn>
            </DFooter>
          </Dialog>
        </Modal>
      )}

      {/* 프로젝트 안에 새 폴더 — 이름을 받는다. 이름 없는 폴더를 만들면 목록에서 못 찾는다. */}
      {newProjectFolder && (
        <Modal onMouseDown={e => { if (e.target === e.currentTarget) setNewProjectFolder(null); }}>
          <Dialog>
            <DTitle>{t('docs.folder.newInProject') as string}</DTitle>
            <DBody>
              {/* ★ 2026-09-20 (Irene: *"이 팝업에서 폴더이름 넣는 입력란 너무 작아. 제대로 구성해.
                  입력란 컴포넌트 이거 아닌데?"*) — 트리 행 안에서 이름을 고치는 `RenameInput`(24px)을
                  모달에 그대로 썼다. 그건 **행 안에 끼워 넣는 칸**이지 폼 입력란이 아니다.
                  공용 폼 입력(FormInput/FormLabel)을 쓴다 — 다른 모달과 같은 규격이 된다. */}
              <FormLabel htmlFor="docs-new-folder-name">{tr('docs.folder.nameLabel')}</FormLabel>
              <FormInput id="docs-new-folder-name" autoFocus value={newProjectFolder.name}
                data-testid="docs-new-folder-input"
                placeholder={tr('docs.folder.placeholder')}
                onChange={e => setNewProjectFolder(v => (v ? { ...v, name: e.target.value } : v))}
                onKeyDown={e => { if (isEnterAction(e)) { e.preventDefault(); void commitProjectFolder(); } if (e.key === 'Escape') setNewProjectFolder(null); }} />
            </DBody>
            <DFooter>
              <SecondaryBtn type="button" onClick={() => setNewProjectFolder(null)}>{t('members.cancel', '취소')}</SecondaryBtn>
              <PrimaryBtn type="button" disabled={!newProjectFolder.name.trim()} onClick={() => void commitProjectFolder()}>
                {t('docs.folder.new') as string}
              </PrimaryBtn>
            </DFooter>
          </Dialog>
        </Modal>
      )}

      {/* 대량 이동 */}
      {moveTargetOpen && (
        <Modal onMouseDown={e => { if (e.target === e.currentTarget) { setMoveTargetOpen(false); setMoveSingle(null); } }}>
          {/* 이 창은 §17 손잡이가 없어 검사 하니스가 «떴는지» 를 못 쟀다 — 열림 판정 축을 붙인다. */}
          <Dialog role="dialog" aria-modal="true" data-testid="docs-move-modal"
            aria-label={t('docs.move.title', '이동할 폴더 선택') as string}>
            <DTitle>{t('docs.move.title', '이동할 폴더 선택')}</DTitle>
            <DBody>
              <MoveTargetList>
                {/* ★ 2026-09-20 (Irene: *"이동할 폴더 리스트 … 현재 들어있는 폴더가 어딘지 모르게
                    폴더리스트를 보여주는데? 기존에 들어있는 폴더는 표시해 놔야 다른 폴더를 선택하지"*) —
                    «어디서» 를 모르면 «어디로» 를 고를 수 없다. 지금 자리는 눌리지 않게 두고 표시를 단다.
                    여러 건을 한 번에 옮길 때는 자리가 제각각일 수 있으므로 **모두 같은 폴더일 때만** 단다. */}
                <MoveTargetRow type="button" disabled={moveFrom === null}
                  $current={moveFrom === null} onClick={() => onMoveTo(null)}>
                  <span>{t('docs.folder.noFolder', '폴더 없음')}</span>
                  {moveFrom === null && <MoveCurrentTag>{t('docs.move.current', '현재 위치')}</MoveCurrentTag>}
                </MoveTargetRow>
                {folders.filter(f => f.parent_id === null).map(f => (
                  <React.Fragment key={f.id}>
                    <MoveTargetRow type="button" disabled={moveFrom === f.id}
                      $current={moveFrom === f.id} onClick={() => onMoveTo(f.id)}>
                      <MoveTargetIcon><FolderSvg /></MoveTargetIcon><span>{f.name}</span>
                      {moveFrom === f.id && <MoveCurrentTag>{t('docs.move.current', '현재 위치')}</MoveCurrentTag>}
                    </MoveTargetRow>
                    {folders.filter(c => c.parent_id === f.id).map(c => (
                      <MoveTargetRow key={c.id} type="button" disabled={moveFrom === c.id}
                        $current={moveFrom === c.id} onClick={() => onMoveTo(c.id)} style={{ paddingLeft: 34 }}>
                        <MoveTargetIcon><FolderSvg /></MoveTargetIcon><span>{c.name}</span>
                        {moveFrom === c.id && <MoveCurrentTag>{t('docs.move.current', '현재 위치')}</MoveCurrentTag>}
                      </MoveTargetRow>
                    ))}
                  </React.Fragment>
                ))}
              </MoveTargetList>
            </DBody>
            <DFooter>
              <SecondaryBtn type="button" onClick={() => { setMoveTargetOpen(false); setMoveSingle(null); }}>{t('members.cancel', '취소')}</SecondaryBtn>
            </DFooter>
          </Dialog>
        </Modal>
      )}
      </Inner>
    </Wrap>
  );
};

export default DocsTab;

// ─── 워크스페이스 모드: 프로젝트 그룹 ───

// ─── 폴더 드롭 존 ───
// 폴더 행이 여러 곳(프로젝트 루트 · 사용자 폴더 · 워크스페이스 트리)에 흩어져 있어
// 각자 손으로 쓰면 반드시 갈라진다. 한 훅으로 묶어 그대로 스프레드한다.
//   ★ 판정은 **전용 MIME** 으로만 한다 — text/plain 으로 받으면 브라우저 밖에서 끌어온
//     아무 텍스트나 "파일 이동" 으로 읽힌다.
interface ProjectGroupsProps {
  projectGroups: Array<{ id: number; name: string; color?: string | null; count: number }>;
  /** 이 워크스페이스에 보이는 **프로젝트 폴더**(하위 포함). 프로젝트 행 아래로 펼쳐진다.
   *  ★ 2026-09-20 (Irene: *"좌측 카테고리에 왜 K-DINE이 두번 나오냐고"*) —
   *    처음엔 「폴더」 섹션에 프로젝트 묶음을 **따로** 그렸다. 그러면 프로젝트 목록에 한 번,
   *    폴더 섹션에 또 한 번, **같은 이름이 두 번** 나온다. 프로젝트는 한 줄이어야 하고
   *    폴더는 그 아래에 달려야 한다. */
  folders?: FileFolder[];
  folderCounts?: Record<number, number>;
  onSelectFolder?: (id: number) => void;
  /** 그 프로젝트 안에 폴더를 새로 만든다. 없으면 [+] 를 그리지 않는다. */
  onCreateFolder?: (projectId: number, parentId?: number | null) => void;
  /** 하위 폴더 행의 드롭 — FolderTree 와 **같은 훅**이 만든다(베끼면 한쪽만 고쳐진다). */
  folderDrop?: FolderDropFn;
  counts: { total: number; bySrc: Record<FileSource, number>; byFolder: Record<number, number>; directRoot: number; myFiles: number };
  total: number;
  selected: FolderSel;
  onSelect: (sel: FolderSel) => void;
  tr: (k: string, fb?: string) => string;
}

const ProjectGroups: React.FC<ProjectGroupsProps> = ({ projectGroups, counts, total, selected, onSelect, tr, folders = [], folderCounts = {}, onSelectFolder, onCreateFolder, folderDrop }) => {
  const [open, setOpen] = useState<Set<number>>(new Set());
  const toggle = (id: number) => setOpen(prev => { const n = new Set(prev); if (n.has(id)) n.delete(id); else n.add(id); return n; });
  const foldersOf = (projectId: number, parentId: number | null) =>
    folders.filter(f => f.project_id === projectId && f.parent_id === parentId);
  /* 프로젝트 줄은 **파일 집계**에서 나온다. 그래서 «폴더는 만들었는데 아직 파일이 0개» 인
     프로젝트는 줄 자체가 없었고 — 그 안의 폴더로 들어갈 길도, 폴더를 더 만들 [+] 도 없었다.
     파일을 다 지우면 폴더가 통째로 숨는다는 뜻이기도 하다. 폴더가 있으면 줄을 세운다. */
  const groups = useMemo(() => {
    const seen = new Set(projectGroups.map(p => p.id));
    const extra: typeof projectGroups = [];
    for (const f of folders) {
      if (!f.project_id || seen.has(f.project_id) || !f.project_name) continue;
      seen.add(f.project_id);
      extra.push({ id: f.project_id, name: f.project_name, color: null, count: 0 });
    }
    return extra.length ? [...projectGroups, ...extra] : projectGroups;
  }, [projectGroups, folders]);
  const renderSub = (f: FileFolder, depth: number): React.ReactNode => (
    <React.Fragment key={f.id}>
      <TreeRow
        selected={selected === f.id}
        dropOver={folderDrop ? folderDrop(f.id).over : undefined}
        flash={folderDrop ? folderDrop(f.id).flash : undefined}
        dropProps={folderDrop ? folderDrop(f.id).dropProps : undefined}
        depth={depth}
        icon={<FolderIconWrap $selected={selected === f.id}><FolderSvg /></FolderIconWrap>}
        name={f.name}
        count={folderCounts[f.id] || 0}
        onClick={() => onSelectFolder && onSelectFolder(f.id)}
        actions={onCreateFolder && f.project_id ? (
          <RowPlusBtn type="button" data-testid={`docs-subfolder-new-${f.id}`}
            title={tr('docs.folder.newChildAction')} aria-label={tr('docs.folder.newChildAction')}
            onClick={() => onCreateFolder(f.project_id as number, f.id)}>
            <PlusSvg size={13} />
          </RowPlusBtn>
        ) : undefined}
      />
      {folders.filter(c => c.parent_id === f.id).map(c => renderSub(c, depth + 1))}
    </React.Fragment>
  );
  return (
    <TreeRoot>
      <TreeRow selected={selected === 'all'} onClick={() => onSelect('all')}
        icon={<FolderIconWrap $selected={selected === 'all'}><AllSvg /></FolderIconWrap>}
        name={tr('docs.folder.all', '전체')} count={total} />
      <TreeRow selected={selected === 'my'} onClick={() => onSelect('my')}
        icon={<FolderIconWrap $selected={selected === 'my'}><MyFilesSvg /></FolderIconWrap>}
        name={tr('docs.folder.my', '내 파일')} count={counts.myFiles} />
      <TreeDivider />
      {groups.map(p => {
        const key: FolderSel = `proj:${p.id}`;
        const sel = selected === key;
        const roots = foldersOf(p.id, null);
        const expanded = open.has(p.id);
        return (
          <React.Fragment key={p.id}>
            <TreeRow
              selected={sel}
              testId={`docs-project-row-${p.id}`}
              ariaExpanded={roots.length ? expanded : undefined}
              /* ★ 2026-09-20 (Irene: *"프로젝트 폴더 이름을 눌러서 선택할 때 하위도 열려야 할 것
                 같아. 자동으로. 폴더 아이콘 눌러야 하위 나오는 건 모를 것 같아"*) —
                 이름을 누르면 **고르고 동시에 펼친다.** 아이콘은 **접을 때** 쓴다. */
              onClick={() => { onSelect(key); if (roots.length && !expanded) toggle(p.id); }}
              /* 아이콘 = 여닫는 손잡이. 프로젝트 색은 **아이콘 선**에 칠한다(동그라미를 따로 두지 않는다). */
              icon={(
                <FolderIconWrap $selected={sel} $tint={p.color || '#14B8A6'}
                  role={roots.length ? 'button' : undefined}
                  aria-label={roots.length ? (expanded ? tr('docs.folder.collapse') : tr('docs.folder.expand')) : undefined}
                  onClick={roots.length ? (e => { e.stopPropagation(); toggle(p.id); }) : undefined}>
                  {roots.length > 0 && expanded ? <FolderOpenSvg /> : <FolderSvg />}
                </FolderIconWrap>
              )}
              name={p.name}
              count={p.count}
              /* 프로젝트 **안**에 폴더를 만드는 문. 아래 「워크스페이스 폴더」 [+] 는 프로젝트에
                 속하지 않은 것만 만든다 — Q file 에는 이 문이 없었다(프로젝트 상세 탭에만 있었다). */
              actions={onCreateFolder ? (
                <RowPlusBtn type="button" data-testid={`docs-project-folder-new-${p.id}`}
                  title={tr('docs.folder.newInProject')} aria-label={tr('docs.folder.newInProject')}
                  onClick={() => onCreateFolder(p.id)}>
                  <PlusSvg size={13} />
                </RowPlusBtn>
              ) : undefined}
            />
            {expanded && roots.map(f => renderSub(f, 1))}
          </React.Fragment>
        );
      })}
      <TreeDivider />
      {(['chat', 'task', 'meeting', 'post', 'mail'] as FileSource[]).map(src => (
        <TreeRow key={src} selected={selected === `src:${src}`} onClick={() => onSelect(`src:${src}`)}
          icon={<FolderIconWrap $sys={src} $selected={selected === `src:${src}`}><SystemFolderIcon src={src} /></FolderIconWrap>}
          name={sourceShortLabel(src, tr)} count={counts.bySrc[src]} />
      ))}
    </TreeRoot>
  );
};
const ProjectDot = styled.span<{ $color: string }>`
  /* 아이콘 칸(18px) 안에서 가운데. 동그라미가 칸을 벗어나면 이름 시작점이 프로젝트만 달라진다. */
  width:18px;flex-shrink:0;display:flex;align-items:center;justify-content:center;
  &::before{content:'';width:10px;height:10px;border-radius:50%;background:${p => p.$color};}
`;
const ProjectLink = styled(Link)`
  display:inline-flex;align-items:center;gap:6px;
  padding:2px 8px;background:#F1F5F9;border-radius:999px;
  font-size:0.6875rem;color:#0F172A;text-decoration:none;
  white-space:nowrap;overflow:hidden;text-overflow:ellipsis;max-width:160px;flex-shrink:1;min-width:0;
  &:hover{background:#E0F2FE;color:#075985;}
  &:focus-visible{outline:2px solid #14B8A6;outline-offset:1px;}
`;

// ─── 폴더 트리 컴포넌트 ───

interface FolderTreeProps {
  /** 워크스페이스 모드 — 폴더 섹션만 그린다.
   *  ★ 이걸 안 두면 ProjectGroups 가 이미 그린 전체·내 파일·시스템 폴더를 **한 번 더** 그린다
   *    (Irene 2026-08-31 "내 파일이 왜 두 개야?"). 트리를 통째로 얹은 것이 원인이었다. */
  foldersOnly?: boolean;
  /** 프로젝트 모드에서 «기본 폴더» 행에 쓰는 이름·색. 없으면 종전 문구로 떨어진다. */
  projectName?: string;
  projectColor?: string | null;
  folders: FileFolder[];
  counts: { total: number; bySrc: Record<FileSource, number>; byFolder: Record<number, number>; directRoot: number };
  total: number;
  selected: FolderSel;
  onSelect: (sel: FolderSel) => void;
  onCreate: (parentId: number | null, name: string) => Promise<void>;
  onRename: (id: number, name: string) => Promise<void>;
  onDelete: (id: number) => Promise<void>;
  onReorder: (id: number, direction: 'up' | 'down') => Promise<void>;
  /** 폴더 통째 다운로드 (zip). 파일을 하나씩 고르지 않고 폴더째 받는다 — Irene #417. */
  onDownloadFolder?: (id: number) => void | Promise<void>;
  /** 파일을 이 폴더로 끌어다 놓았을 때. 없으면 드롭 존 자체를 만들지 않는다. */
  onDropFiles?: (folderId: number | null, fileId: string) => void | Promise<void>;
  /** 바깥(OS)에서 끌어온 파일을 이 폴더로 올린다. */
  onDropExternal?: (folderId: number | null, files: FileList) => void | Promise<void>;
  /** 드롭 인스턴스를 밖에서 받는다 — ProjectGroups 와 **같은 것**을 써야 표시가 갈라지지 않는다. */
  folderDrop?: FolderDropFn;
  tr: (k: string, fb?: string) => string;
}

const FolderTree: React.FC<FolderTreeProps> = ({ folders, counts, total, selected, onSelect, onCreate, onRename, onDelete, onReorder, onDropFiles, onDropExternal, onDownloadFolder, folderDrop: folderDropProp, tr, foldersOnly, projectName, projectColor }) => {
  const ownDrop = useFolderDrop(onDropFiles, onDropExternal);
  const folderDrop = folderDropProp || ownDrop;
  const [creatingParent, setCreatingParent] = useState<number | null | undefined>(undefined);
  const [newName, setNewName] = useState('');
  const [renamingId, setRenamingId] = useState<number | null>(null);
  const [renameDraft, setRenameDraft] = useState('');
  const [deleteTarget, setDeleteTarget] = useState<FileFolder | null>(null);

  const rootFolders = folders.filter(f => f.parent_id === null);
  // ★ 프로젝트 폴더는 여기서 그리지 않는다 — **프로젝트 행 아래**로 갔다(ProjectGroups).
  //   한때 여기에 프로젝트 묶음을 따로 그렸는데, 그러면 좌측에 같은 프로젝트 이름이
  //   **두 번** 나온다(프로젝트 목록에 한 번, 폴더 섹션에 한 번). 프로젝트는 한 줄이다.
  const wsRootFolders = rootFolders.filter(f => !f.project_id);
  const childrenOf = (id: number) => folders.filter(f => f.parent_id === id);

  const startCreate = (parentId: number | null) => {
    setCreatingParent(parentId); setNewName('');
  };
  const commitCreate = async () => {
    if (!newName.trim()) { setCreatingParent(undefined); return; }
    await onCreate(creatingParent ?? null, newName.trim());
    setCreatingParent(undefined); setNewName('');
  };
  const startRename = (f: FileFolder) => { setRenamingId(f.id); setRenameDraft(f.name); };
  const commitRename = async () => {
    if (renamingId == null) return;
    const name = renameDraft.trim();
    if (name) await onRename(renamingId, name);
    setRenamingId(null);
  };

  const renderFolder = (f: FileFolder, depth: number): React.ReactNode => {
    const sel = selected === f.id;
    const children = childrenOf(f.id);
    const count = counts.byFolder[f.id] || 0;
    // 경계 확인 — 같은 parent 안에서의 위치
    const siblings = folders.filter(x => x.parent_id === f.parent_id).sort((a, b) => a.sort_order - b.sort_order);
    const sibIdx = siblings.findIndex(s => s.id === f.id);
    const isFirst = sibIdx === 0;
    const isLast = sibIdx === siblings.length - 1;
    return (
      <React.Fragment key={f.id}>
        <TreeRow
          selected={sel}
          dropOver={folderDrop(f.id).over}
          flash={folderDrop(f.id).flash}
          dropProps={folderDrop(f.id).dropProps as Record<string, unknown>}
          depth={depth}
          onClick={() => onSelect(f.id)}
          icon={<FolderIconWrap $selected={sel}>{sel ? <FolderOpenSvg /> : <FolderSvg />}</FolderIconWrap>}
          name={renamingId === f.id ? (
            <RenameInput autoFocus value={renameDraft}
              onClick={e => e.stopPropagation()}
              onChange={e => setRenameDraft(e.target.value)}
              onBlur={commitRename}
              onKeyDown={e => {
                if (isEnterAction(e)) { e.preventDefault(); commitRename(); }
                if (e.key === 'Escape') setRenamingId(null);
              }} />
          ) : (
            <FolderName onDoubleClick={e => { e.stopPropagation(); startRename(f); }} title={f.name}>{f.name}</FolderName>
          )}
          count={renamingId === f.id ? 0 : count}
          actionsVisible={sel}
          /* ★ 2026-09-20 (Irene: *"프로젝트>파일에도 마우스 오버하니 ... 이 이상하게 뜨네.
             마우스 오버하면 +가 뜨게 통일하면 되겠는데? Q file도 프로젝트>파일도"*) —
             두 트리가 서로 다른 것을 띄우고 있었다. 자주 쓰는 «폴더 만들기» 를 두 곳 모두 [+] 로
             앞세우고, 이름 변경·삭제·순서 같은 나머지는 ⋯ 에 남긴다(없애면 이름을 못 바꾼다).
             ★ 2026-09-17 (#417) 교훈은 그대로 — 아이콘 전용 버튼을 한 줄에 5개 세우면
             이름 칸(minmax(0,1fr))이 0 까지 줄어 폴더 이름이 한 글자가 된다. 그래서 겹쳐 띄운다. */
          actions={renamingId === f.id ? undefined : (
            <>
              <RowPlusBtn type="button" data-testid={`docs-folder-newchild-${f.id}`}
                title={tr('docs.folder.newChildAction')} aria-label={tr('docs.folder.newChildAction')}
                onClick={() => startCreate(f.id)}>
                <PlusSvg size={13} />
              </RowPlusBtn>
              <OverflowMenu
                label={tr('docs.folder.more')}
                data-testid={`docs-folder-menu-${f.id}`}
                items={[
                  { key: 'child', label: tr('docs.folder.newChild', '하위 폴더'), onClick: () => startCreate(f.id), testId: 'docs-folder-newchild' },
                  { key: 'rename', label: tr('docs.folder.rename', '이름 변경'), onClick: () => startRename(f), testId: 'docs-folder-rename' },
                  ...(onDownloadFolder && count > 0
                    ? [{ key: 'dl', label: tr('docs.folder.downloadAll'), onClick: () => { void onDownloadFolder(f.id); }, testId: 'docs-folder-download' }]
                    : []),
                  { key: 'up', label: tr('docs.folder.moveUp', '위로'), onClick: () => onReorder(f.id, 'up'), disabled: isFirst, dividerBefore: true },
                  { key: 'down', label: tr('docs.folder.moveDown', '아래로'), onClick: () => onReorder(f.id, 'down'), disabled: isLast },
                  { key: 'del', label: tr('docs.folder.delete', '삭제'), onClick: () => setDeleteTarget(f), danger: true, dividerBefore: true, testId: 'docs-folder-delete' },
                ]}
              />
            </>
          )}
        />
        {children.map(c => renderFolder(c, depth + 1))}
        {creatingParent === f.id && (
          <FolderRow style={{ paddingLeft: 8 + (depth + 1) * 18 }}>
              <FolderIconWrap><FolderSvg /></FolderIconWrap>
            <RenameInput autoFocus placeholder={tr('docs.folder.placeholder', '폴더 이름')} value={newName}
              onChange={e => setNewName(e.target.value)} onBlur={commitCreate}
              onKeyDown={e => {
                if (isEnterAction(e)) { e.preventDefault(); commitCreate(); }
                if (e.key === 'Escape') setCreatingParent(undefined);
              }} />
          </FolderRow>
        )}
      </React.Fragment>
    );
  };

  const fileCountInFolder = (folderId: number): number => counts.byFolder[folderId] || 0;

  // 삭제 확인 모달 — 두 변형(폴더 전용 / 전체 트리)이 같은 것을 쓴다.
  const deleteModal = deleteTarget && (
    <Modal onMouseDown={e => { if (e.target === e.currentTarget) setDeleteTarget(null); }}>
      <Dialog>
        <DTitle>{tr('docs.folder.deleteTitle', '폴더를 삭제할까요?')}</DTitle>
        <DBody>
          <p><strong>{deleteTarget.name}</strong></p>
          {fileCountInFolder(deleteTarget.id) > 0 ? (
            <p>{deleteWithFilesMessage(fileCountInFolder(deleteTarget.id), tr)}</p>
          ) : (
            <p>{tr('docs.folder.deleteEmpty', '이 폴더는 비어있습니다')}</p>
          )}
        </DBody>
        <DFooter>
          <SecondaryBtn type="button" onClick={() => setDeleteTarget(null)}>{tr('members.cancel', '취소')}</SecondaryBtn>
          <DangerBtn type="button" onClick={async () => { await onDelete(deleteTarget.id); setDeleteTarget(null); }}>
            {tr('docs.delete', '삭제')}
          </DangerBtn>
        </DFooter>
      </Dialog>
    </Modal>
  );

  const createRow = creatingParent === null && (
    <FolderRow style={{ paddingLeft: 22 }}>
      <FolderIconWrap><FolderSvg /></FolderIconWrap>
      <RenameInput autoFocus placeholder={tr('docs.folder.placeholder')} value={newName}
        onChange={e => setNewName(e.target.value)} onBlur={commitCreate}
        onKeyDown={e => {
          if (isEnterAction(e)) { e.preventDefault(); commitCreate(); }
          if (e.key === 'Escape') setCreatingParent(undefined);
        }} />
    </FolderRow>
  );

  // 워크스페이스 — 폴더 섹션만. 전체·내 파일·시스템 폴더는 ProjectGroups 소관이다.
  if (foldersOnly) {
    return (
      <>
        <TreeRoot>
          <TreeDivider />
          <SectionRow>
            <FolderSectionLabel>{tr('docs.folders.section')}</FolderSectionLabel>
            {/* ★ 항상 보이는 버튼 — 선택했을 때만 나타나면 "폴더를 어디서 만드는지" 알 수 없다.
                ★ 2026-09-07 — 12px `+` 아이콘 하나뿐이라 있어도 못 찾았다
                  (Irene: "여전히 폴더만들기가 없는데 폴더 관리가 안되는 거야?").
                  아이콘 전용 버튼은 자리는 먹고 뜻은 안 알려준다 → **글자를 붙인다.** */}
            <FolderNewBtn type="button" data-testid="folder-new"
              title={tr('docs.folder.new')} onClick={() => startCreate(null)}>
              <PlusSvg size={11} />
              <span>{tr('docs.folder.new')}</span>
            </FolderNewBtn>
          </SectionRow>
          {createRow}
          {rootFolders.length === 0 && creatingParent !== null && (
            <EmptyHint>{tr('docs.folders.empty')}</EmptyHint>
          )}
          {wsRootFolders.map(f => renderFolder(f, 0))}
        </TreeRoot>
        {deleteModal}
      </>
    );
  }

  return (
    <>
      <TreeRoot data-testid="file-tree">
        {/* ★ 2026-09-20 (Irene: *"지금 그냥 Q file이 잘 정돈되어 있어. 이렇게 해줘. 프로젝트>파일에서 정돈도"* ·
            *"좌측 카테고리들은 다 좌측이 맞아야지 하위폴더는 새로 만든 폴더 뿐이잖아. 직접 업로드라는
            이름을 바꿔? 그냥 프로젝트이름 나오면 될 것 같은데."*) —
            Q file 트리를 **정본**으로 삼아 같은 모양으로 맞춘다:
              · 최상단 칸(전체 · 프로젝트 · 채팅/업무/회의/문서/메일)은 **모두 같은 왼쪽 기준**
              · 들여쓰기되는 것은 **사람이 만든 폴더**뿐
              · 프로젝트 행이 곧 «기본 폴더» — 이름은 프로젝트 이름, [+] 로 그 안에 폴더를 만든다
            (2026-09-20 오전에 이 행을 «직접 업로드» 로 바꿨던 것을 되돌린다 — 그때는 폴더가
             별도 섹션으로 떨어져 있어 이름만 중복으로 보였다. 계층이 잡히면 프로젝트 이름이 맞다.) */}
        <TreeRow selected={selected === 'all'} onClick={() => onSelect('all')}
          icon={<FolderIconWrap $selected={selected === 'all'}><AllSvg /></FolderIconWrap>}
          name={tr('docs.folder.all', '전체')} count={total} />

        <TreeDivider />

        <TreeRow
          selected={selected === 'direct'}
          dropOver={folderDrop(null).over}
          flash={folderDrop(null).flash}
          dropProps={folderDrop(null).dropProps as Record<string, unknown>}
          onClick={() => onSelect('direct')}
          icon={(
            <FolderIconWrap $selected={selected === 'direct'} $tint={projectColor || '#14B8A6'}>
              {selected === 'direct' ? <FolderOpenSvg /> : <FolderSvg />}
            </FolderIconWrap>
          )}
          name={projectName || tr('docs.folder.directRoot')}
          count={counts.bySrc.direct}
          actions={(
            <RowPlusBtn type="button" data-testid="folder-new"
              title={tr('docs.folder.newInProject')} aria-label={tr('docs.folder.newInProject')}
              onClick={() => startCreate(null)}>
              <PlusSvg size={13} />
            </RowPlusBtn>
          )}
        />
        {creatingParent === null && (
          <FolderRow style={{ paddingLeft: 8 + 18 }}>
            <FolderIconWrap><FolderSvg /></FolderIconWrap>
            <RenameInput autoFocus placeholder={tr('docs.folder.placeholder', '폴더 이름')} value={newName}
              onChange={e => setNewName(e.target.value)} onBlur={commitCreate}
              onKeyDown={e => {
                if (isEnterAction(e)) { e.preventDefault(); commitCreate(); }
                if (e.key === 'Escape') setCreatingParent(undefined);
              }} />
          </FolderRow>
        )}
        {/* 사람이 만든 폴더 — **프로젝트 행 아래로 들여쓰기**. 여기만 들여쓴다. */}
        {rootFolders.map(f => renderFolder(f, 1))}

        <TreeDivider />

        {/* 자동으로 모이는 출처 — 프로젝트 행과 **같은 왼쪽 기준**이다(하위가 아니다). */}
        {(['chat', 'task', 'meeting', 'post', 'mail'] as FileSource[]).map(src => (
          <TreeRow key={src} selected={selected === `src:${src}`} onClick={() => onSelect(`src:${src}`)}
            icon={<FolderIconWrap $sys={src} $selected={selected === `src:${src}`}><SystemFolderIcon src={src} /></FolderIconWrap>}
            name={sourceShortLabel(src, tr)} count={counts.bySrc[src]} />
        ))}
      </TreeRoot>

      {deleteModal}
    </>
  );
};

// ─── 파일 메타 편집 (이름 · 설명 · 태그) ───
// 저장 버튼 없이 자동저장(프로젝트 규칙). 태그는 Enter·쉼표로 칩을 추가한다.
// ─── helpers ───

function sortLabel(s: SortKey, t: (k: string, fb?: string) => string): string {
  if (s === 'name') return t('docs.sort.name', '이름 순');
  if (s === 'size') return t('docs.sort.size', '크기 순');
  return t('docs.sort.recent', '최근 순');
}

/** 이 파일이 걸리는 출처 전부. 서버가 접으면서 합쳐 주지만, 옛 응답에는 없을 수 있다. */
function srcsOf(f: ProjectFile): FileSource[] {
  return (f.sources && f.sources.length) ? f.sources : [f.source];
}

function sourceShortLabel(s: FileSource, t: (k: string, fb?: string) => string): string {
  if (s === 'chat') return t('docs.source.chat', '채팅');
  if (s === 'task') return t('docs.source.task', '업무');
  if (s === 'meeting') return t('docs.source.meeting', '회의');
  if (s === 'post') return t('docs.source.post', '문서');
  if (s === 'mail') return t('docs.source.mail', '메일');
  return t('docs.source.direct', '직접');
}

function deleteWithFilesMessage(n: number, tr: (k: string, fb?: string) => string): string {
  // i18n 에 {{n}} 이 들어간 문구를 tr(2 arg) 로 단순 치환
  const tpl = tr('docs.folder.deleteWithFiles', '이 폴더 안 {{n}}개 파일은 “직접 업로드 루트”로 옮겨집니다');
  return tpl.replace('{{n}}', String(n));
}

function srcStyle(s: FileSource): string {
  switch (s) {
    case 'chat':    return 'background:#E0F2FE;color:#075985;';
    case 'task':    return 'background:#FEF3C7;color:#92400E;';
    case 'meeting': return 'background:#F0FDFA;color:#6B21A8;';
    case 'mail':    return 'background:#EDE9FE;color:#5B21B6;';
    default:        return 'background:#F0FDFA;color:#0F766E;';
  }
}

// ─── SVG 아이콘 (Lucide 스타일) ───


// 확장자별 색상 아이콘 (Notion/Linear 패턴)
type ExtPalette = { bg: string; fg: string };
function extPalette(ext: string): ExtPalette {
  const e = ext.toLowerCase();
  if (['pdf'].includes(e)) return { bg: '#FEE2E2', fg: '#B91C1C' };
  if (['doc', 'docx'].includes(e)) return { bg: '#DBEAFE', fg: '#1D4ED8' };
  if (['xls', 'xlsx', 'csv'].includes(e)) return { bg: '#D1FAE5', fg: '#047857' };
  if (['ppt', 'pptx'].includes(e)) return { bg: '#FED7AA', fg: '#C2410C' };
  if (['zip', 'rar', '7z', 'tar', 'gz'].includes(e)) return { bg: '#F0FDFA', fg: '#0F766E' };
  if (['png', 'jpg', 'jpeg', 'gif', 'webp', 'svg'].includes(e)) return { bg: '#FCE7F3', fg: '#BE185D' };
  if (['mp3', 'wav', 'm4a'].includes(e)) return { bg: '#FEF9C3', fg: '#854D0E' };
  if (['mp4', 'mov', 'webm'].includes(e)) return { bg: '#E0E7FF', fg: '#4338CA' };
  if (['txt', 'md'].includes(e)) return { bg: '#F1F5F9', fg: '#475569' };
  return { bg: '#F1F5F9', fg: '#64748B' };
}
const FileExtIcon: React.FC<{ ext: string; size?: number; large?: boolean }> = ({ ext, size = 32, large }) => {
  const p = extPalette(ext);
  const label = (ext || '—').toUpperCase().slice(0, 4);
  // ★ 글자 크기 배율을 따라가려면 상자도 같이 rem 이어야 한다 — 글자만 키우면 32px 상자를 넘친다.
  return (
    <FileExtBox style={{ width: `${size / 16}rem`, height: `${size / 16}rem`, background: p.bg, color: p.fg, fontSize: `${(large ? 13 : 10) / 16}rem` }}>
      {label}
    </FileExtBox>
  );
};
const FileExtBox = styled.div`
  display:flex;align-items:center;justify-content:center;
  border-radius:8px;font-weight:800;letter-spacing:.3px;flex-shrink:0;
`;

// ─── styled ───

/* ★ 2026-09-15 (Irene: *"파일탭은 상단에 여백이 없어서 노란 안내박스가 탭에 들러붙어 있어."*)
   얹는탭은 세로 여백을 상쇄해 탭 막대에 붙이는데(ProjectTabFull), 이 탭은 맨 위가 **안내 박스**라
   그대로 막대에 닿았다. 문서·노트는 본체가 자기 머리줄(PanelHeader)을 가져 이 문제가 없다.
   자기 안쪽 여백으로 띄운다 — 껍데기(ProjectTabFull)의 상쇄 값을 건드리면 3탭이 같이 틀어진다. */
const Wrap = styled.div`
  display:flex;flex-direction:column;gap:12px;
  /* ★ 2026-09-15 — 여백을 **여기 주지 않는다.** 이 상자는 탭 본문의 첫 자식이라, 여기에 주면
     문서·노트(여백이 더 안쪽 ProjBrowse 에 있다)와 시작점이 갈린다
     (실측: 얹는탭 좌 [0,20] — files 만 20). 여백은 아래 Inner 가 문서 탭과 **같은 값**으로 준다. */
`;
/* 문서 탭 ProjBrowse 와 같은 계약(배경 위 20 / ≤900px 16). 노란 안내 박스가 탭 막대에 들러붙던 것도
   여기서 풀린다 (Irene 2026-09-15: "파일탭은 상단에 여백이 없어서 노란 안내박스가 탭에 들러붙어 있어"). */
const Inner = styled.div`
  display:flex;flex-direction:column;gap:12px;
  padding:20px;
  @media (max-width: 900px){ padding:16px; }
`;

// KnowledgePage 새 지식 등록 폼과 동일 스타일 (UI 일관성 — AttachmentField 와 동일)
const Dropzone = styled.div<{ $drag: boolean }>`
  display:flex;flex-direction:column;align-items:center;justify-content:center;
  gap:8px;padding:28px 16px;
  background:${p => p.$drag ? '#F0FDFA' : '#F8FAFC'};
  border:2px dashed ${p => p.$drag ? '#14B8A6' : '#CBD5E1'};border-radius:12px;
  cursor:pointer;transition:all .15s;text-align:center;
  &:hover{background:#F0FDFA;border-color:#14B8A6;}
  &:focus-visible{outline:2px solid rgba(20,184,166,0.3);outline-offset:2px;}
`;
const DzIcon = styled.div<{ $large?: boolean }>`color:#94A3B8;margin-bottom:${p => p.$large ? 4 : 0}px;`;
const DzTitle = styled.div`font-size:0.8125rem;font-weight:600;color:#334155;`;
const DzHint = styled.div`font-size:0.6875rem;color:#94A3B8;`;
/* 업로드 진행 패널 — 파일별 한 줄 */
/** 남은 저장공간 한 줄 — 드롭존과 컴팩트 줄이 **같은 조각**을 쓴다.
 *  각자 계산하면 두 자리의 숫자가 갈라진다(memory `feedback_same_value_multiple_formulas`).
 *  한도의 80% 를 넘으면 경고 톤 — 대시보드 `UsageWarningCard` 의 WARN_THRESHOLD 와 같은 값이다.
 *  ★ 사용자가 파일을 올리는 자리에서 «언제 한도에 닿는지» 를 본다(Irene 2026-09-20).
 *    여태 경고는 대시보드에만 있어서, 올리다 막힌 사람은 이유를 그 자리에서 알 수 없었다. */
const STORAGE_WARN = 0.8;
const StorageLeft: React.FC<{ limits: UploadLimits | null }> = ({ limits }) => {
  const { t } = useTranslation('qproject');
  if (!limits || limits.bytes_quota == null || limits.bytes_quota <= 0) return null;
  const left = Math.max(0, limits.bytes_quota - limits.bytes_used);
  const pct = limits.bytes_used / limits.bytes_quota;
  return (
    <StorageLeftText $warn={pct >= STORAGE_WARN}>
      {pct >= 1
        ? (t('docs.storage.full', '저장공간이 가득 찼습니다 ({{used}} / {{quota}})', {
            used: formatBytes(limits.bytes_used), quota: formatBytes(limits.bytes_quota) }) as string)
        : (t('docs.storage.left', '남은 저장공간 {{left}} / {{quota}}', {
            left: formatBytes(left), quota: formatBytes(limits.bytes_quota) }) as string)}
    </StorageLeftText>
  );
};

const StorageLeftText = styled.span<{ $warn: boolean }>`
  font-size: 0.75rem;
  color: ${p => (p.$warn ? '#b91c1c' : '#64748b')};
  font-weight: ${p => (p.$warn ? 600 : 400)};
  white-space: nowrap;
`;


const CompactBar = styled.div`
  display:flex;align-items:center;gap:12px;flex-wrap:wrap;
  padding:8px 12px;background:#F8FAFC;border:1px dashed #CBD5E1;border-radius:10px;
`;
const CompactUploadBtn = styled.button`
  display:inline-flex;align-items:center;gap:6px;height:30px;padding:0 14px;
  background:#14B8A6;color:#fff;border:none;border-radius:8px;
  font-size:0.75rem;font-weight:600;cursor:pointer;
  &:hover{background:#0D9488;}
  &:focus-visible{outline:2px solid #0D9488;outline-offset:2px;}
`;
/* ★ 2026-09-14 — 좁은 폭에서 이 문구가 넘쳐 옆 것과 겹칠 수 있었다(말줄임이 없었다).
   ※ Irene 신고 "파일리스트 좌측 상단에 채팅/업로드 안내가 겹쳐" 는 **재현하지 못했다** —
     이건 그 계열에서 코드로 확인되는 유일한 후보라 방어로 막아 둔다. */
const CompactHint = styled.div`
  font-size:0.6875rem;color:#94A3B8;flex:1;min-width:0;
  overflow:hidden;text-overflow:ellipsis;white-space:nowrap;
`;
/** 한도 — **폰에서도 보인다.** 업로드가 막혔을 때 사용자가 찾는 단 하나의 숫자다. */
const LimitPart = styled.span``;
/** 드래그 안내 — 터치에는 뜻이 없어 폰에서만 숨긴다(한도는 남는다). */
const DragPart = styled.span`
  @media (max-width: 640px) { display:none; }
`;

const DragOverlay = styled.div`
  position:fixed;inset:0;z-index:60;background:rgba(15,23,42,0.55);
  display:flex;align-items:center;justify-content:center;pointer-events:none;
`;
const DragOverlayInner = styled.div`
  display:flex;flex-direction:column;align-items:center;gap:12px;
  padding:32px 48px;background:#fff;border:2px dashed #14B8A6;border-radius:16px;
  font-size:0.9375rem;font-weight:700;color:#0F766E;
`;

// 박스 제거 — 페이지 배경 위 inline 배치 (박스 안에 박스 X)
// ★ 2026-09-15 — Toolbar·SortWrap 의 **로컬 복사본을 지웠다.** 공용(components/Docs/assetTabLayout)
//   으로 뺀 뒤에도 원본이 여기 남아 있어서, 공용을 고쳐도 파일 탭만 옛 모양이었다
//   (memory `feedback_copied_component_drifts_extract_shell`). 지금은 문서 탭과 같은 컴포넌트다.
const ViewToggle = styled.div`display:inline-flex;background:#F1F5F9;border:1px solid #E2E8F0;border-radius:8px;padding:2px;gap:2px;`;
const VT = styled.button<{ $active: boolean }>`
  width:32px;height:30px;display:flex;align-items:center;justify-content:center;
  background:${p => p.$active ? '#fff' : 'transparent'};
  color:${p => p.$active ? '#0F766E' : '#94A3B8'};
  border:none;border-radius:6px;cursor:pointer;
  box-shadow:${p => p.$active ? '0 1px 2px rgba(15,23,42,.06)' : 'none'};
  &:hover{color:#0F172A;}
  &:focus-visible{outline:2px solid #14B8A6;outline-offset:1px;}
`;
/* ★ 2026-09-15 — 툴바 한 줄 안의 컨트롤은 **같은 높이 36px** 이다(검색 36 · 정렬 셀렉트 36).
     실측에서 버튼만 32/30 이라 줄이 들쭉날쭉했다. components/Common/filterBar 의 같은 계약. */
const SelectToggle = styled.button<{ $on: boolean }>`
  height:36px;padding:0 14px;
  background:${p => p.$on ? '#14B8A6' : '#fff'};
  color:${p => p.$on ? '#fff' : '#0F172A'};
  border:1px solid ${p => p.$on ? '#14B8A6' : '#CBD5E1'};
  border-radius:8px;font-size:0.75rem;font-weight:600;cursor:pointer;
  &:hover{border-color:${p => p.$on ? '#1E293B' : '#94A3B8'};}
  &:focus-visible{outline:2px solid #14B8A6;outline-offset:2px;}
`;

// Split layout
/* 개인 보관함(personal)은 좌측 폴더 트리를 렌더하지 않는다. 그런데 컬럼은 220px 1fr 그대로여서
   파일 영역이 **220px 칸에 갇혔다** — 카드 그리드가 항상 1열로 떨어지고 우측 1fr 이 통째로 비었다.
   (사용자 신고 — 파일탭 카드리스트가 1열로 떨어져서 우측이 다 빈다) #142 */
const Split = styled.div<{ $single?: boolean }>`
  display:grid;
  grid-template-columns:${p => (p.$single ? '1fr' : '220px 1fr')};
  gap:12px;align-items:start;
  @media (max-width: 900px){ grid-template-columns:1fr; }
`;
const FolderTreePanel = styled.div`
  /* 좌우 여백 — 6px 이라 이름이 테두리에 붙었다(2026-09-20). 8px + 행 10px. */
  background:#fff;border:1px solid #E2E8F0;border-radius:10px;padding:8px;
  /* ★ components/Docs/assetTabLayout.ts 의 같은 이름 styled 와 **같은 계약**을 읽는다
     (프로젝트 탭 안에서는 탭 막대 아래, 워크스페이스에서는 8px). */
  position:sticky;top:var(--pq-tab-sticky-top, 8px);
  /* 아래가 잘리던 것 — 손으로 적은 '100vh - 180px' 은 크롬 높이가 달라지면 거짓이 된다.
     크롬이 끝나는 y 를 토큰으로 읽는다(CLAUDE.md «100vh 를 쓰지 않는다»). */
  max-height:calc(100vh - var(--pq-chrome-bottom, 0px) - 24px);
  overflow-y:auto;overscroll-behavior:contain;
  @media (max-width: 900px){ position:static;max-height:none; }
`;
const FilesArea = styled.div`display:flex;flex-direction:column;gap:10px;min-width:0;`;


/* Skeleton */
const skShimmer = `@keyframes sk-shimmer{0%{background-position:-200px 0;}100%{background-position:calc(200px + 100%) 0;}}`;
const SkeletonCard = styled.div`
  background:#fff;border:1px solid #E2E8F0;border-radius:10px;padding:0 0 10px;
  display:flex;flex-direction:column;gap:6px;
  ${skShimmer}
`;
const SkThumb = styled.div`
  aspect-ratio:16/10;background:linear-gradient(90deg, #F1F5F9 0px, #E2E8F0 40px, #F1F5F9 80px);
  background-size:200px 100%;animation:sk-shimmer 1.2s linear infinite;
  border-radius:10px 10px 0 0;
`;
const SkLine = styled.div<{ $w: string }>`
  height:10px;width:${p => p.$w};margin:0 10px;border-radius:4px;
  background:linear-gradient(90deg, #F1F5F9 0px, #E2E8F0 40px, #F1F5F9 80px);
  background-size:200px 100%;animation:sk-shimmer 1.2s linear infinite;
`;
const SkeletonRow = styled.div`
  display:flex;align-items:center;gap:10px;padding:12px 14px;border-bottom:1px solid #F1F5F9;
  ${skShimmer}
  &:last-child{border-bottom:none;}
`;
const SkIcon = styled.div`
  width:32px;height:32px;border-radius:8px;flex-shrink:0;
  background:linear-gradient(90deg, #F1F5F9 0px, #E2E8F0 40px, #F1F5F9 80px);
  background-size:200px 100%;animation:sk-shimmer 1.2s linear infinite;
`;

// Bulk bar
// 액션 바 — UI_DESIGN_GUIDE 1.7 액션 버튼 3톤 규칙 준수.
// 흰 배경 + 옅은 그림자, Primary teal CTA / Secondary gray outline / Danger red outline.
const BulkBar = styled.div`
  position:sticky;top:0;z-index:5;
  display:flex;align-items:center;justify-content:space-between;gap:10px;flex-wrap:wrap;
  padding:10px 14px;background:#FFFFFF;color:#0F172A;border-radius:10px;
  border:1px solid #E2E8F0;
  box-shadow:0 1px 2px rgba(15,23,42,.05);
`;
const BulkBarLeft = styled.div`display:flex;gap:8px;align-items:baseline;font-size:0.8125rem;color:#0F172A;
  strong{font-weight:700;}
  span{color:#64748B;font-size:0.6875rem;}
`;
const BulkBarRight = styled.div`display:flex;gap:6px;align-items:center;flex-wrap:wrap;`;
const BulkBtnSep = styled.div`width:1px;height:18px;background:#E2E8F0;margin:0 4px;`;
const BulkBtn = styled.button<{ $danger?: boolean; $primary?: boolean }>`
  height:28px;padding:0 12px;
  background:${p => p.$primary ? '#14B8A6' : '#FFFFFF'};
  color:${p => p.$primary ? '#FFFFFF' : (p.$danger ? '#DC2626' : '#334155')};
  border:1px solid ${p => p.$primary ? '#14B8A6' : (p.$danger ? '#FECACA' : '#E2E8F0')};
  border-radius:6px;font-size:0.75rem;font-weight:600;cursor:pointer;
  transition:background .15s, border-color .15s;
  &:hover:not(:disabled){
    background:${p => p.$primary ? '#0D9488' : (p.$danger ? '#FEF2F2' : '#F8FAFC')};
    border-color:${p => p.$primary ? '#0D9488' : (p.$danger ? '#FCA5A5' : '#CBD5E1')};
  }
  &:disabled{opacity:.4;cursor:not-allowed;}
`;
/* 받는 중 표시 — 아이콘 자리에 그대로 들어가 버튼 크기를 흔들지 않는다 */
const DownloadingText = styled.span`
  font-size: 0.625rem; font-weight: 700; line-height: 1; white-space: nowrap;
`;

const ErrorBar = styled.div`
  margin-top:8px;padding:10px 14px;background:#FEF2F2;color:#DC2626;
  border:1px solid #FECACA;border-radius:8px;font-size:0.75rem;
`;
const ShareLinkBar = styled.div`
  margin-top:8px;padding:10px 14px;background:#F0FDFA;border:1px solid #CCFBF1;
  color:#0F766E;border-radius:8px;font-size:0.75rem;
  display:flex;align-items:center;gap:10px;flex-wrap:wrap;
  strong{font-weight:700;}
  small{color:#0F766E;opacity:0.7;}
`;
const ShareUrl = styled.code`
  flex:1;min-width:200px;padding:6px 10px;background:rgba(20,184,166,0.08);
  border-radius:6px;font-family:'SF Mono','Monaco','Consolas',monospace;
  font-size:0.6875rem;word-break:break-all;color:#0F766E;
`;

/* 끌어서 고르는 사각형. `position:fixed` — 좌표를 viewport 기준으로 쓰므로 스크롤·조상 변환에
   영향받지 않는다. 클릭을 먹으면 안 되므로 pointer-events 는 끈다. */
const MarqueeBox = styled.div`
  position:fixed;z-index:30;pointer-events:none;
  background:rgba(20,184,166,0.12);border:1px solid #14B8A6;border-radius:4px;
`;
const Grid = styled.div`display:grid;grid-template-columns:repeat(auto-fill,minmax(180px,1fr));gap:12px;`;
const Card = styled.div<{ $selected?: boolean }>`
  position:relative;background:#fff;
  border:2px solid ${p => p.$selected ? '#14B8A6' : '#E2E8F0'};
  border-radius:10px;overflow:hidden;cursor:pointer;
  display:flex;flex-direction:column;transition:border-color .15s, box-shadow .15s, opacity .15s;
  /* 끌 수 있는 것은 커서로 말한다 — 끌어 보기 전에는 알 수 없었다. */
  &[draggable="true"]{ cursor:grab; }
  &[draggable="true"]:active{ cursor:grabbing; }
  &[data-dragging="1"]{ opacity:.45; }
  &:hover{border-color:${p => p.$selected ? '#14B8A6' : '#14B8A6'};box-shadow:0 2px 8px rgba(20,184,166,.08);}
`;
const CardCheck = styled.div`
  position:absolute;top:6px;right:6px;z-index:2;
  width:24px;height:24px;display:flex;align-items:center;justify-content:center;
  background:rgba(255,255,255,0.92);border-radius:4px;
`;
const Thumb = styled.div`
  position:relative;aspect-ratio:16/10;background:#F8FAFC;overflow:hidden;
  display:flex;align-items:center;justify-content:center;
`;
/* #121 — 썸네일은 이미지 전체가 보이게(contain). cover 는 높이기준으로 잘려서 사용자 호소.
   여백은 Thumb 배경색이 채운다. 옛 background-image 와 **보이는 결과는 같다**. */
const ThumbImg = styled.img`
  width:100%;height:100%;object-fit:contain;display:block;
`;
/* 썸네일 좌상단의 **분류 줄** — 출처 태그와 폴더 칩이 같이 선다(각자 absolute 면 겹친다). */
const TagRow = styled.div`
  position:absolute;top:8px;left:8px;right:8px;
  /* ★ wrap 하지 않는다 — 폴더 이름이 길면 다음 줄로 떨어져 «옆에» 계약이 데이터에 따라 깨진다.
     넘치면 칩이 줄어들고 말줄임표가 된다(실측: 카드 폭 180px 에서 wrap 이면 23px 아래로 내려갔다). */
  display:flex;flex-wrap:nowrap;gap:4px;align-items:center;pointer-events:none;overflow:hidden;
`;
const SourceTag = styled.div<{ $src: FileSource }>`
  flex-shrink:0;padding:2px 8px;border-radius:999px;
  font-size:0.625rem;font-weight:700;letter-spacing:.2px;${p => srcStyle(p.$src)}
`;
const CardName = styled.div`padding:8px 10px 2px;font-size:0.875rem;font-weight:600;@media(max-width:640px){font-size:0.9375rem;}color:#0F172A;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;`;
const CardMeta = styled.div`padding:0 10px;font-size:0.6875rem;color:#64748B;display:flex;gap:4px;
  &:last-child{padding-bottom:10px;margin-top:2px;}
`;

const ListTable = styled.div`background:#fff;border:1px solid #E2E8F0;border-radius:10px;overflow:hidden;`;
const LIST_COLS = 'minmax(200px,3fr) minmax(140px,1.3fr) 80px 90px 100px 36px';
const ListHead = styled.div<{ $selectMode?: boolean }>`
  display:grid;
  grid-template-columns:${p => p.$selectMode ? `36px ${LIST_COLS}` : LIST_COLS};
  gap:8px;padding:10px 14px;background:#F8FAFC;border-bottom:1px solid #E2E8F0;
  font-size:0.6875rem;font-weight:700;color:#64748B;text-transform:uppercase;letter-spacing:.3px;
`;
const HCChk = styled.div``;
const HCName = styled.div``;
const HCSrc = styled.div``;
const HCSize = styled.div``;
const HCUp = styled.div``;
const HCDate = styled.div``;
const HCAct = styled.div``;
const ListRow = styled.div<{ $selected?: boolean; $selectMode?: boolean }>`
  display:grid;
  grid-template-columns:${p => p.$selectMode ? `36px ${LIST_COLS}` : LIST_COLS};
  gap:8px;padding:10px 14px;align-items:center;cursor:pointer;
  border-bottom:1px solid #F1F5F9;background:${p => p.$selected ? '#F0FDFA' : 'transparent'};
  transition:opacity .15s;
  &[draggable="true"]{ cursor:grab; }
  &[draggable="true"]:active{ cursor:grabbing; }
  &[data-dragging="1"]{ opacity:.45; }
  &:last-child{border-bottom:none;}
  &:hover{background:${p => p.$selected ? '#F0FDFA' : '#F8FAFC'};}
`;
const RowChk = styled.div`display:flex;justify-content:center;`;
const RowName = styled.div`display:flex;align-items:center;gap:10px;min-width:0;`;
const RowNameText = styled.div`font-size:0.8125rem;font-weight:600;color:#0F172A;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;min-width:0;`;
// 검색 매칭 이유 줄(파일명 아래)을 위한 세로 묶음 — 이유가 없으면 RowNameText 하나라 모양이 같다
const RowNameStack = styled.div`display:flex;flex-direction:column;min-width:0;flex:0 1 auto;`;
const CardReason = styled.div`padding:0 10px;min-width:0;`;
// #379 — Drive 사본이 끊긴 상태 표시. 경고가 아니라 **사실 고지**라 회색 톤(원본은 멀쩡하다).
const UnmirrorTag = styled.span`
  flex-shrink:0; padding:1px 6px; border-radius:4px;
  background:#F1F5F9; color:#64748B; font-size:0.75rem; font-weight:600; white-space:nowrap;
`;
/* 한 파일이 출처를 여럿 가진다(직접 업로드 + 채팅). 알약에 flex-shrink:0·nowrap 이 없어
   칸이 좁아지면 **눌려 겹쳤다**(2026-09-20). 넘치면 가로로 자른다 — wrap 은 행 높이를 흔든다. */
const RowSrc = styled.div`display:flex;align-items:center;gap:6px;min-width:0;overflow:hidden;`;
const SourcePill = styled.span<{ $src: FileSource }>`flex-shrink:0;white-space:nowrap;padding:2px 8px;border-radius:999px;font-size:0.625rem;font-weight:700;letter-spacing:.2px;${p => srcStyle(p.$src)}`;
const RowCtx = styled.span`font-size:0.6875rem;color:#64748B;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;min-width:0;`;
const RowSize = styled.div`font-size:0.75rem;color:#475569;`;
const RowUp = styled.div`font-size:0.75rem;color:#475569;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;`;
const RowDate = styled.div`font-size:0.75rem;color:#64748B;`;
const RowAct = styled.div`display:flex;justify-content:flex-end;align-items:center;gap:2px;`;
/* 진행률은 아이콘 자리에 그대로 들어간다 — 행 폭이 바뀌면 목록 전체가 흔들린다. */
const DlPct = styled.span`font-size:0.625rem;font-weight:700;color:#0D9488;min-width:26px;text-align:center;`;
const IconBtn = styled.button`
  width:28px;height:28px;display:flex;align-items:center;justify-content:center;
  background:transparent;border:none;color:#94A3B8;border-radius:6px;cursor:pointer;
  &:hover{background:#FEE2E2;color:#DC2626;}
`;

/* 분류 표시 — 출처 칩과 **같은 줄에 나란히**. 누르는 것이 아니다(버튼으로 만들면 이동과 헷갈린다). */
const FolderChip = styled.span<{ $onThumb?: boolean }>`
  flex-shrink:1;min-width:0;max-width:140px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;
  padding:2px 8px;border-radius:999px;font-size:0.625rem;font-weight:700;letter-spacing:.2px;
  /* 썸네일 위에서는 사진 위에 얹히므로 바탕을 덮는다. 목록 행에서는 회색 칩 그대로. */
  ${p => (p.$onThumb
    ? 'background:rgba(255,255,255,0.92);color:#334155;box-shadow:0 1px 2px rgba(15,23,42,0.12);'
    : 'background:#F1F5F9;color:#475569;')}
`;
/* 폴더로 이동 — 받기·삭제와 **같은 규격**의 아이콘 버튼. IconBtn 을 상속해 크기를 다시 적지 않는다. */
const MoveBtn = styled(IconBtn)`
  &:hover{background:#F0FDFA;color:#0F766E;}
`;

const Dim = styled.div`padding:30px;text-align:center;font-size:0.8125rem;color:#94A3B8;background:#fff;border:1px solid #E2E8F0;border-radius:10px;`;

// 드로어 내부
const PvHeaderInner = styled.div`display:flex;align-items:flex-start;gap:10px;min-width:0;width:100%;`;
/* 제목은 **첫 줄을 통째로** 쓴다 — 옆에 버튼을 두면 그만큼 줄어 긴 파일명이 두 줄로 접힌다. */
const PvHeaderText = styled.div`flex:1;min-width:0;display:flex;flex-direction:column;gap:6px;`;
const PvTitle = styled.div`font-size:0.9375rem;font-weight:700;color:#0F172A;word-break:break-all;`;
const PvSubRow = styled.div`display:flex;align-items:center;gap:8px;flex-wrap:wrap;width:100%;`;
const PvSub = styled.div`font-size:0.75rem;color:#64748B;`;
const PvActions = styled.div`display:flex;gap:4px;flex-shrink:0;margin-left:auto;`;
const HeaderIconBtn = styled.button<{ $danger?: boolean }>`
  width:32px;height:32px;display:inline-flex;align-items:center;justify-content:center;
  background:transparent;color:${p => p.$danger ? '#DC2626' : '#475569'};
  border:1px solid #E2E8F0;border-radius:8px;cursor:pointer;text-decoration:none;
  transition:background .15s, border-color .15s, color .15s;
  &:hover{
    background:${p => p.$danger ? '#FEF2F2' : '#F1F5F9'};
    color:${p => p.$danger ? '#DC2626' : '#0F172A'};
    border-color:${p => p.$danger ? '#FCA5A5' : '#CBD5E1'};
  }
  @media (max-width: 640px){ width:40px;height:40px; }
`;
const MetaList = styled.div`display:flex;flex-direction:column;gap:10px;`;
// N+67 — visibility 변경 영역 (preview drawer)
const VisibilitySection = styled.div`
  margin-top: 18px; padding-top: 14px;
  border-top: 1px solid #E2E8F0;
  display: flex; flex-direction: column; gap: 10px;
`;
const SectionLabel = styled.div`font-size: 0.6875rem; font-weight: 700; color: #64748B; text-transform: uppercase; letter-spacing: 0.4px;`;
const SecHint = styled.div`font-size: 0.6875rem; color: #94A3B8; margin-top: 6px; line-height: 1.5;`;
const MetaItem = styled.div`display:flex;align-items:flex-start;gap:10px;font-size:0.8125rem;`;
const MetaKey = styled.div`flex:0 0 74px;font-size:0.6875rem;font-weight:700;color:#94A3B8;text-transform:uppercase;letter-spacing:.3px;padding-top:2px;`;
const MetaVal = styled.div`color:#0F172A;word-break:break-all;`;
// Cue 읽기 — 읽으면 본문색, 못 읽으면 한 톤 죽인 회색. 상태 색을 버튼처럼 칠하지 않는다
//   (읽기 전용 정보다 — UI_DESIGN_GUIDE 1.7).
const CueReadVal = styled(MetaVal)<{ $ok: boolean }>`
  color: ${(p) => (p.$ok ? '#0F172A' : '#64748B')};
  word-break: keep-all;
`;

// Buttons
const SecondaryBtn = styled.button`
  height:34px;padding:0 14px;background:#fff;color:#0F172A;
  border:1px solid #CBD5E1;border-radius:8px;font-size:0.8125rem;font-weight:600;cursor:pointer;
  display:inline-flex;align-items:center;justify-content:center;text-decoration:none;
  &:hover{background:#F8FAFC;}
`;
const PrimaryBtn = styled.button`
  height:34px;padding:0 14px;background:#14B8A6;color:#fff;
  border:1px solid #14B8A6;border-radius:8px;font-size:0.8125rem;font-weight:600;cursor:pointer;
  display:inline-flex;align-items:center;justify-content:center;
  &:hover:not(:disabled){background:#0D9488;border-color:#0D9488;}
  &:disabled{opacity:0.5;cursor:not-allowed;}
  &:focus-visible{outline:2px solid #0D9488;outline-offset:2px;}
`;
const DangerBtn = styled.button`
  height:34px;padding:0 14px;background:#fff;color:#DC2626;
  border:1px solid #FCA5A5;border-radius:8px;font-size:0.8125rem;font-weight:600;cursor:pointer;
  &:hover{background:#FEF2F2;border-color:#DC2626;}
`;

// Modals (단일/대량 삭제 / 이동)
const Modal = styled.div`
  position:fixed;inset:0;z-index:80;background:rgba(15,23,42,.24);
  display:flex;align-items:center;justify-content:center;padding:20px;
  @media (max-width: 640px) { padding:0; align-items:stretch; }
`;
const Dialog = styled.div`
  background:#fff;border-radius:14px;width:100%;max-width:460px;
  box-shadow:0 20px 50px rgba(15,23,42,.2);
  display:flex;flex-direction:column;overflow:hidden;max-height:80vh;
  @media (max-width: 640px) {
    max-width:none;max-height:none;border-radius:0;
    margin-top:var(--pq-chrome-bottom, 60px);height:calc(100vh - var(--pq-chrome-bottom, 60px));height:calc(100dvh - var(--pq-chrome-bottom, 60px));
  }
`;
const DTitle = styled.div`padding:18px 20px 10px;font-size:0.9375rem;font-weight:700;color:#0F172A;`;
const DBody = styled.div`
  padding:0 20px 16px;font-size:0.8125rem;color:#475569;line-height:1.5;overflow-y:auto;
  strong{color:#0F172A;}
  p{margin:4px 0;}
`;
const DFooter = styled.div`padding:12px 20px;border-top:1px solid #E2E8F0;display:flex;gap:8px;justify-content:flex-end;`;

const BulkFileList = styled.ul`list-style:none;padding:0;margin:8px 0 12px;display:flex;flex-direction:column;gap:4px;`;
const BulkFileItem = styled.li`font-size:0.75rem;color:#0F172A;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;`;
const BulkFileMore = styled.li`font-size:0.6875rem;color:#94A3B8;`;

const MoveTargetList = styled.div`display:flex;flex-direction:column;gap:2px;max-height:320px;overflow-y:auto;`;
const MoveTargetRow = styled.button<{ $current?: boolean }>`
  display:flex;align-items:center;gap:8px;padding:10px 12px;
  background:${p => (p.$current ? '#F0FDFA' : 'transparent')};
  border:1px solid ${p => (p.$current ? '#99F6E4' : 'transparent')};border-radius:8px;
  cursor:pointer;font-size:0.8125rem;color:#0F172A;text-align:left;
  &:hover{background:${p => (p.$current ? '#F0FDFA' : '#F8FAFC')};border-color:${p => (p.$current ? '#99F6E4' : '#E2E8F0')};}
  /* 지금 자리는 고를 수 없다 — 눌러도 아무 일이 없으면 «고장» 으로 읽힌다. */
  &:disabled{ cursor:default; }
`;
/* «현재 위치» 표시 — 어디서 어디로 가는지 알려 준다. */
const MoveCurrentTag = styled.span`
  margin-left:auto;flex-shrink:0;padding:2px 8px;border-radius:999px;
  background:#CCFBF1;color:#0F766E;font-size:0.625rem;font-weight:700;letter-spacing:.2px;
`;
const MoveTargetIcon = styled.span`display:inline-flex;color:#64748B;flex-shrink:0;`;

const EmptyIcon: React.FC = () => (
  <svg width="36" height="36" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
    <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
    <polyline points="14 2 14 8 20 8" />
  </svg>
);
