// 사이클 Q-D Phase 3 — PWA Share Target 수신 페이지 (파일 + 텍스트 + URL).
//
// manifest.json 의 share_target.action='/share-receive' (POST + multipart/form-data, files 포함)
// 외부 앱(카톡·갤러리·브라우저·파일앱) "공유" → PlanQ 선택 시 이 페이지 진입.
//
// 흐름:
//   1) ?shared=1 이면 SW 의 Cache 에서 share payload 읽기 (파일 포함)
//   2) URL 쿼리만 있는 경우 그대로 (legacy GET fallback)
//   3) 사용자에게 "어디로 보낼까요?" 선택 (채팅·업무·메모·문서·파일)
//   4) 선택 → 해당 영역에 파일 업로드 + 텍스트 prefill
//
// 사이클 N+53 — 새로고침 안전망: cache.delete 를 destination 선택 완료 후로 미룸.
// 사용자가 destination 선택 전 새로고침해도 cache 가 살아있어 데이터 복원됨.
// stale 차단: payload.ts 가 10분 이상 지났으면 자동 정리.

import { useEffect, useMemo, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import styled from 'styled-components';
import { useTranslation } from 'react-i18next';
import PageShell from '../../components/Layout/PageShell';
import { ChatIcon, CheckIcon, FileIcon, FileTextIcon, FolderIcon, NoteIcon, SearchIcon, TaskIcon } from '../../components/Common/Icons';
import { useAuth, apiFetch } from '../../contexts/AuthContext';
import { listBusinessConversations, listProjects, type ApiConversation, type ApiProject } from '../../services/qtalk';
import { fetchFolders, fetchWorkspaceFolders, createFolder, createWorkspaceFolder, type FileFolder } from '../../services/files';
import { detectChatExport, chatExportFileName, type ChatExportInfo } from '../../utils/chatExport';
import { textMatches } from '../../utils/searchMatch';
import { useBackToClose } from '../../hooks/useBackToClose';

interface SharePayload {
  title: string;
  text: string;
  url: string;
  fileCount: number;
  ts: number;
}

const SHARE_CACHE = 'planq-share-v1';
const SHARE_TTL_MS = 10 * 60 * 1000; // 10분 — share 받고 10분 안에 destination 선택해야

async function loadSharePayload(): Promise<{ payload: SharePayload | null; files: File[]; stale: boolean }> {
  if (typeof caches === 'undefined') return { payload: null, files: [], stale: false };
  try {
    const cache = await caches.open(SHARE_CACHE);
    const meta = await cache.match('/_share_payload');
    if (!meta) return { payload: null, files: [], stale: false };
    const payload = await meta.json() as SharePayload;
    // stale 검사 — 10분 이상 지났으면 자동 정리 (다른 사용자 share 였을 수도 있고)
    if (payload.ts && Date.now() - payload.ts > SHARE_TTL_MS) {
      await cleanupShareCache(payload.fileCount || 0);
      return { payload: null, files: [], stale: true };
    }
    const files: File[] = [];
    for (let i = 0; i < (payload.fileCount || 0); i++) {
      const r = await cache.match(`/_share_file_${i}`);
      if (!r) continue;
      const blob = await r.blob();
      const filename = decodeURIComponent(r.headers.get('X-Filename') || `share-${i}`);
      files.push(new File([blob], filename, { type: blob.type }));
    }
    // 사이클 N+53 — cache.delete 는 destination 선택 완료 후 (cleanupShareCache) 로 미룸.
    // 사용자 새로고침 시 데이터 잃지 않게.
    return { payload, files, stale: false };
  } catch { return { payload: null, files: [], stale: false }; }
}

async function cleanupShareCache(fileCount: number): Promise<void> {
  if (typeof caches === 'undefined') return;
  try {
    const cache = await caches.open(SHARE_CACHE);
    await cache.delete('/_share_payload');
    for (let i = 0; i < fileCount; i++) await cache.delete(`/_share_file_${i}`);
  } catch { /* best-effort */ }
}

// ── 받은 뒤 화면 — «대상 먼저, 형태는 다음» (2026-10-16, Fable UX 판정 · docs/NATIVE_SHARE_RECEIVE.md)
//   Irene: "파일 공유할 때 어디로 갈지 우리 앱을 너무 어려울 것 같아. 제대로 디렉션이 되게 안내가 가능할까?"
//   예전엔 같은 크기 카드 5장(채팅·업무·메모·문서·Q File)을 내밀어 «PlanQ 의 어느 메뉴냐» 를 먼저 물었다.
//   이제 내용 종류로 **추천 하나**를 앞에 두고, 그 안에 최근 목적지를 칩으로 둔다. 나머지는 아래 행 목록.

type RecentDest =
  | { kind: 'chat'; id: number; label: string; ts: number }
  | { kind: 'place'; projectId: number | null; folderId: number | null; label: string; ts: number };

const RECENT_MAX = 5;
const recentKey = (uid: unknown, biz: unknown) => `planq:share-recent:${uid}:${biz}`;
function readRecents(key: string): RecentDest[] {
  try { const v = JSON.parse(localStorage.getItem(key) || '[]'); return Array.isArray(v) ? v : []; } catch { return []; }
}
function writeRecent(key: string, d: RecentDest) {
  try {
    const same = (x: RecentDest) => x.kind === d.kind && (d.kind === 'chat'
      ? (x as { id: number }).id === d.id
      : (x as { projectId: number | null }).projectId === d.projectId && (x as { folderId: number | null }).folderId === d.folderId);
    const next = [d, ...readRecents(key).filter((x) => !same(x))].slice(0, RECENT_MAX);
    localStorage.setItem(key, JSON.stringify(next));
  } catch { /* 기기 저장소를 못 쓰면 최근 칩만 없다 */ }
}

// 내용 종류별 추천 — 사진·영상·글·링크는 «누구에게 보낼까», 문서·압축은 «어디에 둘까» 가 먼저 떠오른다
type Recommend = 'chat' | 'file';
function recommendFor(files: File[], canFile: boolean): Recommend {
  if (!canFile || files.length === 0) return 'chat';
  const media = files.every((f) => /^(image|video)\//.test(f.type) || /\.(jpe?g|png|gif|heic|webp|mp4|mov)$/i.test(f.name));
  return media ? 'chat' : 'file';
}

const GROUP_LIMIT = 5;

const ShareReceivePage: React.FC = () => {
  const { t } = useTranslation('common');
  const [params] = useSearchParams();
  const navigate = useNavigate();
  const { user } = useAuth();
  const businessId = user?.business_id ? Number(user.business_id) : null;
  // 서버와 같은 술어 — 고객은 워크스페이스 파일·업무·문서를 만들 수 없다(files.js 403). 채팅만 보인다.
  const role = user?.business_role;
  const isMember = role === 'owner' || role === 'admin' || role === 'member';
  const rKey = recentKey(user?.id, businessId);

  const [title, setTitle] = useState(params.get('title') || '');
  const [text, setText] = useState(params.get('text') || '');
  const [url, setUrl] = useState(params.get('url') || '');
  const [files, setFiles] = useState<File[]>([]);
  const [fileCount, setFileCount] = useState(0); // cleanup 시 사용 — file 인덱스 개수
  const [loading, setLoading] = useState(params.get('shared') === '1');
  const [busy, setBusy] = useState<string | null>(null);
  const [progress, setProgress] = useState<{ done: number; total: number } | null>(null);
  const [stale, setStale] = useState(false);
  const [step, setStep] = useState<'dest' | 'conv' | 'place' | 'done'>('dest');
  const [convs, setConvs] = useState<ApiConversation[] | null>(null);
  const [projects, setProjects] = useState<ApiProject[]>([]);
  // undefined = 아직 어느 프로젝트인지 고르는 중 · null = 회사 파일
  const [placeProject, setPlaceProject] = useState<number | null | undefined>(undefined);
  const [allFolders, setAllFolders] = useState<FileFolder[]>([]);
  const [placeFolder, setPlaceFolder] = useState<number | null>(null);
  const [newFolderName, setNewFolderName] = useState('');
  const [query, setQuery] = useState('');
  const [expanded, setExpanded] = useState<Record<string, boolean>>({});
  const [recents, setRecents] = useState<RecentDest[]>(() => readRecents(rKey));
  const [saved, setSaved] = useState<{ projectId: number | null; folderId: number | null; count: number } | null>(null);
  // 이미 올린 파일 id — «다른 곳에도 보내기» 로 채팅·업무에 붙일 때 다시 올리지 않는다(내 파일에 같은 행이 두 개 생겼다)
  const [uploadedIds, setUploadedIds] = useState<number[]>([]);
  const [err, setErr] = useState<string | null>(null);
  // 카카오톡·왓츠앱 «대화 내보내기» 파일이면 알아보고 이름을 읽을 수 있게 바꾼다 — 보관을 먼저 권한다(utils/chatExport)
  const [chatExport, setChatExport] = useState<ChatExportInfo | null>(null);

  // 이 화면에선 알림 권한 배너를 숨긴다 — 폰에서 상단 180px 가 크롬이라 «어디로» 가 밀렸다(PushPromptBanner 가 이 표식을 본다)
  useEffect(() => {
    document.body.dataset.shareReceive = '1';
    return () => { delete document.body.dataset.shareReceive; };
  }, []);

  // 안드로이드 뒤로 가기 = 고르기 단계에서 한 칸 뒤로(공유 화면을 통째로 나가지 않게) — 폰 패널 규칙과 같은 훅
  useBackToClose(step === 'conv' || step === 'place', () => setStep('dest'));

  // POST 공유 — SW(웹)·앱 플러그인이 파일 + 텍스트를 Cache 에 저장 후 ?shared=1 로 redirect.
  // 사이클 N+53: cache.delete 는 저장 완료 후 (새로고침 안전망).
  useEffect(() => {
    if (params.get('shared') !== '1') return;
    let cancelled = false;
    loadSharePayload().then(({ payload, files: f, stale: s }) => {
      if (cancelled) return;
      if (s) setStale(true);
      if (!payload) { setLoading(false); return; }
      setFileCount(payload.fileCount || 0);
      return detectChatExport(f, payload.title || '').then((ce) => {
        if (cancelled) return;
        if (ce) {
          // 이름만 바꾼다(내용은 그대로). 함께 온 제목·안내문(«대화가 첨부되었습니다» 류)은 파일과 같은 말이라 버린다
          const label = t(`shareReceive.chatExport.label.${ce.app}`, ce.app === 'kakao' ? '카카오톡 대화' : 'WhatsApp 대화') as string;
          const src = f[ce.index];
          f = f.map((x, i) => (i === ce.index ? new File([src], chatExportFileName(src.name, label, ce.room), { type: src.type || 'text/plain' }) : x));
          setChatExport(ce);
        } else {
          setTitle(payload.title || '');
          setText(payload.text || '');
        }
        setUrl(ce ? '' : (payload.url || ''));
        setFiles(f);
        setLoading(false);
      });
    }).catch(() => setLoading(false));
    return () => { cancelled = true; };
  }, [params]);

  // 목적지 후보는 처음에 한 번 읽는다 — 최근 칩을 살아 있는 목록과 대조하고, 검색을 바로 할 수 있게
  useEffect(() => {
    if (!businessId) return;
    let cancelled = false;
    listBusinessConversations(businessId)
      .then((list) => { if (!cancelled) setConvs(list.filter((c) => c.status !== 'archived')); })
      .catch(() => { if (!cancelled) setConvs([]); });
    if (isMember) {
      Promise.all([listProjects(businessId, 'active'), fetchWorkspaceFolders(businessId)])
        .then(([ps, ws]) => { if (cancelled) return; setProjects(ps); setAllFolders((prev) => [...prev.filter((f) => f.project_id), ...ws]); })
        .catch(() => { /* 파일 고르기에서 다시 알린다 */ });
    }
    return () => { cancelled = true; };
  }, [businessId, isMember]);

  // 이미지 미리보기 — 고른 사진이 맞는지 눈으로 확인할 길이 없었다
  const thumbs = useMemo(() => files.map((f) => (/^image\//.test(f.type) ? URL.createObjectURL(f) : null)), [files]);
  useEffect(() => () => { thumbs.forEach((u) => { if (u) URL.revokeObjectURL(u); }); }, [thumbs]);

  const content = useMemo(() => {
    const parts: string[] = [];
    if (title) parts.push(title);
    if (text) parts.push(text);
    if (url) parts.push(url);
    return parts.filter(Boolean).join('\n');
  }, [title, text, url]);

  const fmtSize = (n: number) => n < 1024 ? `${n} B` : n < 1024*1024 ? `${(n/1024).toFixed(1)} KB` : `${(n/1024/1024).toFixed(1)} MB`;
  const convLabel = (c: ApiConversation) => c.display_name || c.title || c.Client?.display_name || c.Client?.company_name || `#${c.id}`;
  const projectName = (pid: number | null) => (pid === null ? (t('shareReceive.place.company', '회사 파일') as string) : (projects.find((p) => p.id === pid)?.name || `#${pid}`));
  const placeLabel = (pid: number | null, fid: number | null) => {
    const f = fid ? allFolders.find((x) => x.id === fid) : null;
    return f ? `${projectName(pid)} › ${f.name}` : projectName(pid);
  };

  const recommend = recommendFor(files, isMember);
  const canFile = isMember && files.length > 0;

  // 최근 칩 — 사라진 대화방(보관·나감)·프로젝트(종료)는 버린다
  const liveRecents = useMemo(() => {
    if (convs === null) return [];
    return recents.filter((r) => {
      if (r.kind === 'chat') return convs.some((c) => c.id === r.id);
      if (!canFile) return false;
      return r.projectId === null || projects.some((p) => p.id === r.projectId);
    }).slice(0, 3);
  }, [recents, convs, projects, canFile]);

  // 파일 업로드 (배열) — 워크스페이스 파일로. 저장된 위치는 서버 응답으로 돌려준다(화면이 기억한 값을 쓰지 않는다)
  const uploadFilesToWorkspace = async (loc?: { projectId: number | null; folderId: number | null }) => {
    const out = { ids: [] as number[], projectId: null as number | null, folderId: null as number | null };
    if (!businessId || files.length === 0) return out;
    setProgress({ done: 0, total: files.length });
    for (const f of files) {
      const fd = new FormData();
      fd.append('file', f);
      if (loc?.projectId) fd.append('project_id', String(loc.projectId));
      if (loc?.folderId) fd.append('folder_id', String(loc.folderId));
      const r = await apiFetch(`/api/files/${businessId}`, { method: 'POST', body: fd });
      const j = await r.json().catch(() => ({}));
      if (j.success && j.data?.id) {
        out.ids.push(Number(j.data.id));
        if (out.ids.length === 1) {
          out.projectId = j.data.project_id ? Number(j.data.project_id) : null;
          out.folderId = j.data.folder_id ? Number(j.data.folder_id) : null;
        }
      }
      setProgress({ done: out.ids.length, total: files.length });
    }
    // 하나라도 못 올렸으면 말한다 — 조용히 줄어든 채 넘어가면 «보냈는데 없다» 가 된다
    if (out.ids.length < files.length) throw new Error('upload_failed');
    return out;
  };

  const loadProjectFolders = async (pid: number) => {
    try { const fs = await fetchFolders(pid); setAllFolders((prev) => [...prev.filter((f) => f.project_id !== pid), ...fs.map((f) => ({ ...f, project_id: pid }))]); }
    catch { /* 목록만 비어 보인다 */ }
  };
  const openPlacePicker = (preset?: { projectId: number | null; folderId: number | null }) => {
    setErr(null); setQuery(''); setStep('place');
    if (preset) {
      setPlaceProject(preset.projectId); setPlaceFolder(preset.folderId);
      if (preset.projectId) void loadProjectFolders(preset.projectId).then(() => undefined);
    } else { setPlaceProject(undefined); setPlaceFolder(null); }
  };
  const pickProject = (pid: number | null) => {
    setPlaceProject(pid); setPlaceFolder(null); setQuery('');
    if (pid) void loadProjectFolders(pid);
  };
  const openConvPicker = () => { setErr(null); setQuery(''); setStep('conv'); };

  // 지금 고른 범위의 폴더를 트리 순서(부모 → 자식)로 펼친다
  const scopedFolders = useMemo(() => {
    if (placeProject === undefined) return [];
    const inScope = allFolders.filter((f) => (placeProject ? f.project_id === placeProject : !f.project_id));
    const byParent = new Map<number | null, FileFolder[]>();
    for (const f of inScope) { const k = f.parent_id ?? null; byParent.set(k, [...(byParent.get(k) || []), f]); }
    const out: { f: FileFolder; depth: number }[] = [];
    const walk = (pid: number | null, depth: number) => {
      for (const f of (byParent.get(pid) || []).sort((a, b) => (a.sort_order ?? 0) - (b.sort_order ?? 0))) { out.push({ f, depth }); walk(f.id, depth + 1); }
    };
    walk(null, 0);
    return out;
  }, [allFolders, placeProject]);
  // 최근 칩으로 들어왔는데 그 폴더가 지워졌으면 맨 위로 떨어뜨린다
  useEffect(() => {
    if (placeFolder && placeProject !== undefined && allFolders.length > 0 && !allFolders.some((f) => f.id === placeFolder)) setPlaceFolder(null);
  }, [allFolders, placeFolder, placeProject]);

  const addFolder = async () => {
    const name = newFolderName.trim();
    if (!name || !businessId || busy || placeProject === undefined) return;
    setBusy('folder'); setErr(null);
    try {
      const f = placeProject
        ? await createFolder(placeProject, name, placeFolder)
        : await createWorkspaceFolder(businessId, name, placeFolder);
      setAllFolders((prev) => [...prev, { ...f, project_id: placeProject }]);
      setPlaceFolder(f.id);
      setNewFolderName('');
    } catch { setErr(t('shareReceive.place.createFailed', '폴더를 만들지 못했습니다') as string); }
    finally { setBusy(null); }
  };

  const saveToPlace = async () => {
    if (busy || files.length === 0 || placeProject === undefined) return;
    setBusy('file'); setErr(null);
    try {
      const r = await uploadFilesToWorkspace({ projectId: placeProject, folderId: placeFolder });
      await cleanupShareCache(fileCount);
      const label = placeLabel(r.projectId, r.folderId);
      writeRecent(rKey, { kind: 'place', projectId: r.projectId, folderId: r.folderId, label, ts: Date.now() });
      setRecents(readRecents(rKey));
      setSaved({ projectId: r.projectId, folderId: r.folderId, count: r.ids.length });
      setUploadedIds(r.ids);
      setStep('done');
    } catch { setErr(t('shareReceive.uploadFailed', '파일을 올리지 못했습니다. 다시 시도해 주세요.') as string); }
    finally { setBusy(null); setProgress(null); }
  };

  // 받는 화면이 글자(prefill)와 첨부(attachFileIds)를 **실제로 읽는다** — 업무·채팅·메모·문서 넷 다(#434).
  //   파일은 먼저 워크스페이스에 올리고(개인 L1) 그 id 를 넘긴다 — 받는 화면이 기존 파일 첨부로 붙인다.
  //   고객은 워크스페이스에 못 올린다(서버 403) — 글만 담고, 화면이 미리 그렇게 말한다.
  const sendTo = async (target: 'chat' | 'task' | 'note' | 'doc', conv?: ApiConversation) => {
    if (busy) return;
    setBusy(target); setErr(null);
    try {
      const encoded = encodeURIComponent(content);
      let attachQuery = '';
      if (files.length > 0 && isMember) {
        const ids = uploadedIds.length > 0 ? uploadedIds : (await uploadFilesToWorkspace()).ids;
        if (ids.length > 0) attachQuery = `&attachFileIds=${ids.join(',')}`;
      }
      if (target === 'chat' && conv) {
        writeRecent(rKey, { kind: 'chat', id: conv.id, label: convLabel(conv), ts: Date.now() });
        navigate(`/talk/${conv.id}?prefill=${encoded}${attachQuery}`);
      }
      else if (target === 'task') navigate(`/tasks?prefill=${encoded}${attachQuery}`);
      // 라우트는 /notes 다 (App.tsx). /qnote 는 존재하지 않아 catch-all 로 대시보드에 튕겼다.
      else if (target === 'note') navigate(`/notes?prefill=${encoded}${attachQuery}`);
      else navigate(`/docs?prefill=${encoded}${attachQuery}`);
      // 사이클 N+53 — destination 선택 완료 시 cache 정리 (새로고침 안전망 해제)
      await cleanupShareCache(fileCount);
    } catch {
      setErr(t('shareReceive.uploadFailed', '파일을 올리지 못했습니다. 다시 시도해 주세요.') as string);
    } finally {
      setBusy(null); setProgress(null);
    }
  };

  const tapRecent = (r: RecentDest) => {
    if (r.kind === 'chat') { const c = convs?.find((x) => x.id === r.id); if (c) void sendTo('chat', c); }
    else openPlacePicker({ projectId: r.projectId, folderId: r.folderId });
  };

  // 대화방 정렬 — 고정 먼저, 그다음 최근 대화순(목록 응답에 이미 있는 값)
  const sortedConvs = useMemo(() => {
    const ts = (v?: string | null) => (v ? new Date(v).getTime() : 0);
    return [...(convs || [])].sort((a, b) => {
      const pa = ts(a.my_pinned_at), pb = ts(b.my_pinned_at);
      if (!!pa !== !!pb) return pa ? -1 : 1;
      if (pa && pb && pa !== pb) return pb - pa;
      return ts(b.last_message_at) - ts(a.last_message_at);
    });
  }, [convs]);
  const convMatches = (c: ApiConversation) => [convLabel(c), c.Client?.display_name, c.Client?.company_name, c.title].some((x) => textMatches(x, query));
  const convGroups = useMemo(() => {
    const recentIds = liveRecents.filter((r) => r.kind === 'chat').map((r) => (r as { id: number }).id);
    const byId = new Map(sortedConvs.map((c) => [c.id, c]));
    const recent = recentIds.map((id) => byId.get(id)).filter(Boolean) as ApiConversation[];
    const rest = sortedConvs.filter((c) => !recentIds.includes(c.id));
    return [
      { key: 'recent', label: t('shareReceive.group.recent', '최근 보낸 곳'), rows: recent },
      { key: 'pinned', label: t('shareReceive.group.pinned', '고정한 대화방'), rows: rest.filter((c) => c.my_pinned_at) },
      { key: 'customer', label: t('shareReceive.group.customer', '고객 대화방'), rows: rest.filter((c) => !c.my_pinned_at && c.channel_type === 'customer') },
      { key: 'team', label: t('shareReceive.group.team', '팀 대화방'), rows: rest.filter((c) => !c.my_pinned_at && c.channel_type !== 'customer') },
    ].filter((g) => g.rows.length > 0);
  }, [sortedConvs, liveRecents, t]);

  const renderConvRow = (c: ApiConversation) => (
    <PickRow key={c.id} type="button" data-testid="share-conv-row" data-conv-id={c.id} disabled={busy !== null}
      onClick={() => void sendTo('chat', c)}>
      <span>{convLabel(c)}</span>
      <PickMeta>{c.channel_type === 'customer' ? t('shareReceive.convCustomer', '고객') : t('shareReceive.convTeam', '팀')}</PickMeta>
    </PickRow>
  );

  if (loading) {
    return (
      <PageShell title={t('shareReceive.title', 'PlanQ 로 공유') as string}>
        <Wrap><PreviewBox>{t('common.loading', '불러오는 중...')}</PreviewBox></Wrap>
      </PageShell>
    );
  }

  const fileFirstNote = files.length > 0 && isMember ? ` · ${t('shareReceive.row.fileFirst', '파일은 내 파일에 먼저 올라갑니다')}` : '';
  const otherRows: { key: string; icon: React.ReactNode; title: string; desc: string; onClick: () => void }[] = [];
  if (recommend !== 'chat') otherRows.push({ key: 'chat', icon: <ChatIcon size={18} />, title: t('shareReceive.row.chat', '채팅으로 보내기') as string, desc: t('shareReceive.row.chatDesc', '대화방을 골라 메시지로 보냅니다') as string, onClick: openConvPicker });
  if (canFile && recommend !== 'file') otherRows.push({ key: 'file', icon: <FolderIcon size={18} />, title: t('shareReceive.row.file', '프로젝트 파일로 저장') as string, desc: t('shareReceive.row.fileDesc', '폴더를 골라 둡니다 — 팀이 같이 봅니다') as string, onClick: () => openPlacePicker() });
  if (isMember) {
    otherRows.push({ key: 'task', icon: <TaskIcon size={18} />, title: t('shareReceive.row.task', '새 업무 만들기') as string, desc: `${t('shareReceive.row.taskDesc', '업무 등록 창에 담아 엽니다')}${fileFirstNote}`, onClick: () => void sendTo('task') });
    otherRows.push({ key: 'doc', icon: <FileTextIcon size={18} />, title: t('shareReceive.row.doc', '새 문서에 넣기') as string, desc: `${t('shareReceive.row.docDesc', '새 문서 본문에 담아 엽니다')}${fileFirstNote}`, onClick: () => void sendTo('doc') });
    otherRows.push({ key: 'note', icon: <NoteIcon size={18} />, title: t('shareReceive.row.note', 'Q note 메모로') as string, desc: `${t('shareReceive.row.noteDesc', '내 메모로 저장합니다')}${fileFirstNote}`, onClick: () => void sendTo('note') });
  }

  const shownThumbs = files.slice(0, 3);
  const projRows = query.trim() ? projects.filter((p) => textMatches(p.name, query) || textMatches(p.client_company, query)) : projects;

  return (
    <PageShell title={t('shareReceive.title', 'PlanQ 로 공유') as string}>
      <Wrap>
        {stale && (
          <StaleNote>
            {t('shareReceive.staleNote', '공유 받은 데이터가 오래되어 자동 정리되었습니다. 다시 공유해주세요.')}
          </StaleNote>
        )}

        {(content || files.length > 0) && step !== 'done' && (
          <PreviewBox data-testid="share-preview">
            <PreviewLabel>{t('shareReceive.received', '받은 내용')}</PreviewLabel>
            {files.length > 0 && (
              <FilesList>
                {shownThumbs.map((f, i) => (
                  thumbs[i]
                    ? <Thumb key={i} src={thumbs[i] as string} alt={f.name} title={f.name} data-testid="share-thumb" />
                    : (
                      <FileChip key={i} title={f.name}>
                        <FileIcon size={14} />
                        <FileChipName>{f.name}</FileChipName>
                        <FileChipSize>{fmtSize(f.size)}</FileChipSize>
                      </FileChip>
                    )
                ))}
                {files.length > 3 && <MoreBadge data-testid="share-more-files">+{files.length - 3}</MoreBadge>}
              </FilesList>
            )}
            {content && <PreviewContent>{content}</PreviewContent>}
          </PreviewBox>
        )}
        {busy && busy !== 'folder' && (
          <ProgressLine role="status" data-testid="share-progress">
            {progress && progress.total > 0
              ? t('shareReceive.uploadingN', { done: progress.done, total: progress.total, defaultValue: '올리는 중… {{done}}/{{total}}' })
              : t('shareReceive.uploading', '업로드 중...')}
          </ProgressLine>
        )}
        {!stale && !content && files.length === 0 && step !== 'done' && (
          <PreviewBox>{t('shareReceive.empty', '(빈 내용)')}</PreviewBox>
        )}

        {step === 'dest' && chatExport && (
          <ExportCard data-testid="share-chat-export">
            <ExportTitle>
              {chatExport.room
                ? t(`shareReceive.chatExport.titleRoom.${chatExport.app}`, { room: chatExport.room, defaultValue: chatExport.app === 'kakao' ? '카카오톡 «{{room}}» 대화를 받았어요' : 'WhatsApp «{{room}}» 대화를 받았어요' })
                : t(`shareReceive.chatExport.title.${chatExport.app}`, chatExport.app === 'kakao' ? '카카오톡 대화를 받았어요' : 'WhatsApp 대화를 받았어요')}
            </ExportTitle>
            <ExportDesc>{t('shareReceive.chatExport.desc', '대화 내용을 파일 그대로 보관합니다. 고객의 프로젝트 폴더에 두면 팀이 같이 봅니다.')}</ExportDesc>
            <SaveBtn type="button" data-testid="share-chat-export-save" onClick={() => openPlacePicker()} disabled={busy !== null || !isMember}>
              {t('shareReceive.chatExport.save', '대화 기록으로 보관')}
            </SaveBtn>
            {chatExport.app === 'whatsapp' && (
              <Hint>{t('shareReceive.chatExport.waMedia', '사진·음성이 많은 대화는 왓츠앱에서 «미디어 없이» 내보내면 가볍고 빠릅니다.')}</Hint>
            )}
          </ExportCard>
        )}

        {step === 'dest' && !chatExport && (
          <RecoCard data-testid={`share-reco-${recommend}`}>
            <RecoTag>{t('shareReceive.recommendTag', '추천')}</RecoTag>
            <RecoTitle>
              {recommend === 'chat'
                ? <><ChatIcon size={18} />{t('shareReceive.reco.chat', '채팅으로 보내기')}</>
                : <><FolderIcon size={18} />{t('shareReceive.reco.file', '프로젝트 파일로 저장')}</>}
            </RecoTitle>
            <RecoDesc>
              {recommend === 'chat'
                ? t('shareReceive.reco.chatDesc', '대화방을 고르면 글과 파일이 입력칸에 담깁니다. 보내기는 직접 누릅니다.')
                : t('shareReceive.reco.fileDesc', '프로젝트 폴더에 두면 그 프로젝트 팀이 같이 봅니다.')}
            </RecoDesc>
            {liveRecents.length > 0 && (
              <RecentRow>
                <RecentLabel>{t('shareReceive.recentLabel', '최근')}</RecentLabel>
                {liveRecents.map((r, i) => (
                  <RecentChip key={i} type="button" data-testid="share-recent-chip" disabled={busy !== null} onClick={() => tapRecent(r)} title={r.label}>
                    {r.kind === 'chat' ? <ChatIcon size={13} /> : <FolderIcon size={13} />}
                    <span>{r.label}</span>
                  </RecentChip>
                ))}
              </RecentRow>
            )}
            <SaveBtn type="button" data-testid="share-reco-go" disabled={busy !== null}
              onClick={() => (recommend === 'chat' ? openConvPicker() : openPlacePicker())}>
              {recommend === 'chat'
                ? t('shareReceive.reco.chatGo', '대화방 고르기')
                : t('shareReceive.reco.fileGo', '저장할 곳 고르기')}
            </SaveBtn>
            {!isMember && files.length > 0 && <Hint>{t('shareReceive.clientFiles', '파일은 대화방에서 직접 첨부해 주세요 — 지금은 글만 담깁니다.')}</Hint>}
          </RecoCard>
        )}

        {step === 'dest' && otherRows.length > 0 && (
          <OtherBox>
            <ChooseLabel>{t('shareReceive.others', '다른 곳에 두기')}</ChooseLabel>
            {otherRows.map((r) => (
              <OtherRow key={r.key} type="button" data-testid={`share-dest-${r.key}`} onClick={r.onClick} disabled={busy !== null}>
                <OtherIcon>{r.icon}</OtherIcon>
                <OtherText><OtherTitle>{r.title}</OtherTitle><OtherDesc>{r.desc}</OtherDesc></OtherText>
              </OtherRow>
            ))}
          </OtherBox>
        )}

        {step === 'conv' && (
          <PickBox data-testid="share-conv-picker">
            <PickHead>
              <BackLink type="button" onClick={() => setStep('dest')}>{t('shareReceive.back', '← 다른 곳')}</BackLink>
              <ChooseLabel>{t('shareReceive.pickConv', '어느 대화방에 보낼까요?')}</ChooseLabel>
            </PickHead>
            <SearchWrap>
              <SearchIcon size={16} />
              <SearchInput value={query} onChange={(e) => setQuery(e.target.value)} data-testid="share-search"
                placeholder={t('shareReceive.searchConv', '대화방·고객 이름으로 찾기') as string} />
            </SearchWrap>
            {convs === null && <Hint>{t('common.loading', '불러오는 중...')}</Hint>}
            {convs && convs.length === 0 && <Hint>{t('shareReceive.convEmpty', '보낼 수 있는 대화방이 없습니다')}</Hint>}
            {convs && query.trim() && (() => {
              const hits = sortedConvs.filter(convMatches);
              return hits.length ? hits.slice(0, 30).map(renderConvRow) : <Hint>{t('shareReceive.noMatch', '맞는 곳이 없습니다')}</Hint>;
            })()}
            {convs && !query.trim() && convGroups.map((g) => {
              const open = expanded[g.key];
              const rows = open ? g.rows : g.rows.slice(0, GROUP_LIMIT);
              return (
                <Group key={g.key} data-testid={`share-group-${g.key}`}>
                  <GroupLabel>{g.label}</GroupLabel>
                  {rows.map(renderConvRow)}
                  {!open && g.rows.length > GROUP_LIMIT && (
                    <MoreBtn type="button" onClick={() => setExpanded((p) => ({ ...p, [g.key]: true }))}>
                      {t('shareReceive.more', { n: g.rows.length - GROUP_LIMIT, defaultValue: '더 보기 ({{n}})' })}
                    </MoreBtn>
                  )}
                </Group>
              );
            })}
          </PickBox>
        )}

        {step === 'place' && placeProject === undefined && (
          <PickBox data-testid="share-place-picker">
            <PickHead>
              <BackLink type="button" onClick={() => setStep('dest')}>{t('shareReceive.back', '← 다른 곳')}</BackLink>
              <ChooseLabel>{t('shareReceive.place.pickProject', '어느 프로젝트에 둘까요?')}</ChooseLabel>
            </PickHead>
            {projects.length > 6 && (
              <SearchWrap>
                <SearchIcon size={16} />
                <SearchInput value={query} onChange={(e) => setQuery(e.target.value)} data-testid="share-search"
                  placeholder={t('shareReceive.searchProject', '프로젝트·고객 이름으로 찾기') as string} />
              </SearchWrap>
            )}
            {projRows.map((p) => (
              <PickRow key={p.id} type="button" data-testid="share-project-row" onClick={() => pickProject(p.id)}>
                <span>{p.name}</span>
                {p.client_company && <PickMeta>{p.client_company}</PickMeta>}
              </PickRow>
            ))}
            {query.trim() && projRows.length === 0 && <Hint>{t('shareReceive.noMatch', '맞는 곳이 없습니다')}</Hint>}
            <PickRow type="button" data-testid="share-project-company" onClick={() => pickProject(null)}>
              <span>{t('shareReceive.place.company', '회사 파일')}</span>
              <PickMeta>{t('shareReceive.place.companyMeta', '프로젝트 밖 · 나만 봄')}</PickMeta>
            </PickRow>
          </PickBox>
        )}

        {step === 'place' && placeProject !== undefined && (
          <PickBox data-testid="share-place-picker">
            <PickHead>
              <BackLink type="button" onClick={() => { setPlaceProject(undefined); setQuery(''); }}>{t('shareReceive.place.backToProjects', '← 다른 프로젝트')}</BackLink>
              <ChooseLabel>{projectName(placeProject)}</ChooseLabel>
            </PickHead>
            <PickRow type="button" $on={placeFolder === null} onClick={() => setPlaceFolder(null)}>
              <span>{t('shareReceive.place.root', '맨 위 (폴더 없이)')}</span>
            </PickRow>
            {scopedFolders.map(({ f, depth }) => (
              <PickRow key={f.id} type="button" data-testid="share-folder-row" $on={placeFolder === f.id} $depth={depth} onClick={() => setPlaceFolder(f.id)}>
                <span>{f.name}</span>
              </PickRow>
            ))}
            <NewFolderRow>
              <NewFolderInput
                value={newFolderName}
                onChange={(e) => setNewFolderName(e.target.value)}
                placeholder={t('shareReceive.place.newFolderPh', '새 폴더 이름 (고른 폴더 안에 만듭니다)') as string}
                maxLength={100}
                data-testid="share-new-folder"
              />
              <SmallBtn type="button" onClick={() => void addFolder()} disabled={!newFolderName.trim() || busy !== null}>
                {t('shareReceive.place.create', '+ 폴더')}
              </SmallBtn>
            </NewFolderRow>
            <SaveBtn type="button" data-testid="share-place-save" onClick={() => void saveToPlace()} disabled={busy !== null || files.length === 0}>
              {t('shareReceive.place.saveN', { n: files.length, defaultValue: '여기에 저장 (파일 {{n}}개)' })}
            </SaveBtn>
            <Hint>
              {placeProject !== null
                ? t('shareReceive.place.projectNote', '프로젝트에 저장한 파일은 그 프로젝트 멤버가 봅니다.')
                : t('shareReceive.place.companyNote', '회사 파일은 나만 봅니다. 팀과 나누려면 공유 범위를 바꿔 주세요.')}
            </Hint>
          </PickBox>
        )}

        {step === 'done' && saved && (
          <DoneCard data-testid="share-done" role="status">
            <DoneIcon><CheckIcon size={22} /></DoneIcon>
            <DoneTitle data-testid="share-done-where">
              {t('shareReceive.done.title', { where: placeLabel(saved.projectId, saved.folderId), defaultValue: '«{{where}}» 에 저장했어요' })}
            </DoneTitle>
            <DoneDesc>{t('shareReceive.done.files', { n: saved.count, defaultValue: '파일 {{n}}개' })}</DoneDesc>
            <DoneActions>
              <SaveBtn type="button" data-testid="share-done-open"
                onClick={() => navigate(saved.projectId ? `/projects/p/${saved.projectId}?tab=files` : '/files')}>
                {t('shareReceive.done.open', '열어 보기')}
              </SaveBtn>
              <SmallBtn type="button" onClick={() => { setSaved(null); setStep('dest'); }}>{t('shareReceive.done.again', '다른 곳에도 보내기')}</SmallBtn>
              <SmallBtn type="button" onClick={() => navigate('/dashboard')}>{t('shareReceive.done.close', '닫기')}</SmallBtn>
            </DoneActions>
          </DoneCard>
        )}

        {err && <ErrLine role="alert">{err}</ErrLine>}
      </Wrap>
    </PageShell>
  );
};

export default ShareReceivePage;

// 아래 여백 — 우하단 공용 버튼(FAB)이 마지막 행을 덮지 않게
const Wrap = styled.div`max-width: 560px; margin: 0 auto; display: flex; flex-direction: column; gap: 16px; padding-bottom: 72px;`;
const ProgressLine = styled.div`
  position: sticky; top: 0; z-index: 1; padding: 10px 12px; border-radius: 8px;
  background: #F0FDFA; border: 1px solid #99F6E4; color: #0F766E; font-size: 0.8125rem; font-weight: 600;
`;
const PreviewBox = styled.div`background: #F8FAFC; border: 1px solid #E2E8F0; border-radius: 12px; padding: 12px 14px;`;
const PreviewLabel = styled.div`font-size: 0.6875rem; font-weight: 700; color: #64748B; letter-spacing: 0.4px; margin-bottom: 8px;`;
const PreviewContent = styled.div`
  margin-top: 8px; font-size: 0.8125rem; color: #0F172A; white-space: pre-wrap; word-break: break-word; line-height: 1.5;
  display: -webkit-box; -webkit-line-clamp: 2; -webkit-box-orient: vertical; overflow: hidden;
`;
const ChooseLabel = styled.h3`font-size: 0.875rem; font-weight: 700; color: #0F172A; margin: 0;`;
const FilesList = styled.div`display: flex; flex-wrap: wrap; gap: 6px; align-items: center;`;
const Thumb = styled.img`width: 64px; height: 64px; object-fit: cover; border-radius: 8px; border: 1px solid #E2E8F0; background: #FFFFFF;`;
const MoreBadge = styled.span`
  display: inline-flex; align-items: center; justify-content: center; width: 64px; height: 64px; border-radius: 8px;
  background: #E2E8F0; color: #334155; font-size: 0.875rem; font-weight: 700;
`;
const FileChip = styled.div`display: inline-flex; align-items: center; gap: 6px; padding: 4px 10px; background: #FFFFFF; border: 1px solid #CBD5E1; border-radius: 999px; font-size: 0.6875rem; color: #475569; max-width: 240px;`;
const FileChipName = styled.span`white-space: nowrap; overflow: hidden; text-overflow: ellipsis; max-width: 150px; font-weight: 600; color: #0F172A;`;
const FileChipSize = styled.span`color: #94A3B8;`;
const RecoCard = styled.div`
  display: flex; flex-direction: column; gap: 8px; position: relative;
  background: #F0FDFA; border: 1px solid #14B8A6; border-radius: 12px; padding: 14px 16px;
`;
const RecoTag = styled.span`
  align-self: flex-start; font-size: 0.6875rem; font-weight: 700; color: #0F766E;
  background: #CCFBF1; border-radius: 999px; padding: 2px 8px;
`;
const RecoTitle = styled.div`display: flex; align-items: center; gap: 8px; font-size: 1rem; font-weight: 700; color: #0F172A; svg { color: #0F766E; flex-shrink: 0; }`;
const RecoDesc = styled.div`font-size: 0.8125rem; color: #475569; line-height: 1.5;`;
const RecentRow = styled.div`display: flex; flex-wrap: wrap; align-items: center; gap: 6px;`;
const RecentLabel = styled.span`font-size: 0.75rem; font-weight: 600; color: #64748B; margin-right: 2px;`;
const RecentChip = styled.button`
  display: inline-flex; align-items: center; gap: 6px; min-height: 36px; max-width: 100%; padding: 0 12px;
  background: #FFFFFF; border: 1px solid #99F6E4; border-radius: 999px; cursor: pointer;
  font-size: 0.8125rem; font-weight: 600; color: #0F172A;
  span { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; max-width: 200px; }
  svg { color: #0F766E; flex-shrink: 0; }
  @media (hover: hover) { &:hover:not(:disabled) { border-color: #14B8A6; } }
  &:disabled { opacity: 0.5; cursor: not-allowed; }
`;
const OtherBox = styled.div`display: flex; flex-direction: column; gap: 6px;`;
const OtherRow = styled.button`
  display: flex; align-items: center; gap: 12px; min-height: 52px; padding: 8px 14px;
  background: #FFFFFF; border: 1px solid #E2E8F0; border-radius: 10px; text-align: left; cursor: pointer;
  @media (hover: hover) { &:hover:not(:disabled) { border-color: #14B8A6; background: #F8FAFC; } }
  &:focus-visible { outline: none; box-shadow: 0 0 0 3px rgba(20,184,166,0.3); }
  &:disabled { opacity: 0.5; cursor: not-allowed; }
`;
const OtherIcon = styled.span`display: inline-flex; color: #0F766E; flex-shrink: 0;`;
const OtherText = styled.span`display: flex; flex-direction: column; gap: 2px; min-width: 0;`;
const OtherTitle = styled.span`font-size: 0.875rem; font-weight: 600; color: #0F172A;`;
const OtherDesc = styled.span`font-size: 0.75rem; color: #64748B; line-height: 1.4;`;
const Hint = styled.div`font-size: 0.75rem; color: #64748B; padding: 4px 0; line-height: 1.5;`;
const StaleNote = styled.div`
  background: #FEF3C7; border: 1px solid #F59E0B; border-radius: 10px;
  padding: 12px 14px; font-size: 0.8125rem; color: #92400E; line-height: 1.5;
`;
const ExportCard = styled.div`
  display: flex; flex-direction: column; gap: 6px;
  background: #F0FDFA; border: 1px solid #14B8A6; border-radius: 12px; padding: 16px;
`;
const ExportTitle = styled.div`font-size: 0.9375rem; font-weight: 700; color: #0F172A; word-break: break-word;`;
const ExportDesc = styled.div`font-size: 0.8125rem; color: #475569; line-height: 1.5;`;
const PickBox = styled.div`display: flex; flex-direction: column; gap: 8px;`;
const PickHead = styled.div`display: flex; flex-direction: column; gap: 6px; margin-bottom: 4px;`;
const BackLink = styled.button`
  align-self: flex-start; background: none; border: none; padding: 0; min-height: 32px;
  color: #0F766E; font-size: 0.8125rem; font-weight: 600; cursor: pointer;
`;
const SearchWrap = styled.label`
  display: flex; align-items: center; gap: 8px; height: 40px; padding: 0 12px;
  background: #FFFFFF; border: 1px solid #E2E8F0; border-radius: 8px; color: #94A3B8;
  &:focus-within { border-color: #14B8A6; box-shadow: 0 0 0 3px rgba(20,184,166,0.2); }
`;
const SearchInput = styled.input`
  flex: 1; min-width: 0; border: none; outline: none; background: transparent; font-size: 1rem; color: #0F172A;
`;
const Group = styled.div`display: flex; flex-direction: column; gap: 6px; margin-top: 4px;`;
const GroupLabel = styled.div`font-size: 0.75rem; font-weight: 700; color: #64748B;`;
const MoreBtn = styled.button`
  align-self: flex-start; background: none; border: none; padding: 0; min-height: 32px;
  color: #0F766E; font-size: 0.8125rem; font-weight: 600; cursor: pointer;
`;
const PickRow = styled.button<{ $on?: boolean; $depth?: number }>`
  display: flex; align-items: center; justify-content: space-between; gap: 8px;
  min-height: 44px; padding: 10px 14px; padding-left: ${p => 14 + (p.$depth || 0) * 18}px;
  background: ${p => p.$on ? '#F0FDFA' : '#FFFFFF'};
  border: 1px solid ${p => p.$on ? '#14B8A6' : '#E2E8F0'}; border-radius: 10px;
  font-size: 0.875rem; color: #0F172A; text-align: left; cursor: pointer;
  span:first-child { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; min-width: 0; }
  @media (hover: hover) { &:hover:not(:disabled) { border-color: #14B8A6; } }
  &:disabled { opacity: 0.5; cursor: not-allowed; }
`;
const PickMeta = styled.span`font-size: 0.6875rem; color: #64748B; flex-shrink: 0; max-width: 40%; overflow: hidden; text-overflow: ellipsis; white-space: nowrap;`;
const NewFolderRow = styled.div`display: flex; gap: 8px; margin-top: 4px;`;
const NewFolderInput = styled.input`
  flex: 1; min-width: 0; height: 40px; padding: 0 12px; border: 1px solid #E2E8F0; border-radius: 8px;
  font-size: 1rem; color: #0F172A;
  &:focus { outline: none; border-color: #14B8A6; box-shadow: 0 0 0 3px rgba(20,184,166,0.2); }
`;
const SmallBtn = styled.button`
  flex-shrink: 0; height: 40px; padding: 0 14px; border-radius: 8px; cursor: pointer;
  background: #FFFFFF; border: 1px solid #CBD5E1; color: #334155; font-size: 0.8125rem; font-weight: 600;
  &:disabled { opacity: 0.5; cursor: not-allowed; }
`;
const SaveBtn = styled.button`
  margin-top: 4px; height: 44px; border-radius: 10px; cursor: pointer;
  background: #14B8A6; border: 1px solid #14B8A6; color: #FFFFFF; font-size: 0.9375rem; font-weight: 700;
  &:hover:not(:disabled) { background: #0D9488; }
  &:disabled { opacity: 0.5; cursor: not-allowed; }
`;
const DoneCard = styled.div`
  display: flex; flex-direction: column; align-items: flex-start; gap: 8px;
  background: #FFFFFF; border: 1px solid #E2E8F0; border-radius: 12px; padding: 18px 16px;
`;
const DoneIcon = styled.span`
  display: inline-flex; align-items: center; justify-content: center; width: 40px; height: 40px; border-radius: 50%;
  background: #CCFBF1; color: #0F766E;
`;
const DoneTitle = styled.div`font-size: 1rem; font-weight: 700; color: #0F172A; word-break: break-word;`;
const DoneDesc = styled.div`font-size: 0.8125rem; color: #64748B;`;
const DoneActions = styled.div`
  display: flex; flex-wrap: wrap; gap: 8px; width: 100%; margin-top: 4px;
  & > button:first-child { flex: 1 1 100%; }
`;
const ErrLine = styled.div`font-size: 0.8125rem; color: #B91C1C; background: #FEF2F2; border: 1px solid #FECACA; border-radius: 8px; padding: 10px 12px;`;
