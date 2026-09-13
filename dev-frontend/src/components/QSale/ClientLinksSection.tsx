// components/QSale/ClientLinksSection.tsx — 고객에 **연결된 것들**(업무·파일·프로젝트) 한 벌
//
// ★ 우측 패널(ClientPanel)과 전체 프로필(SaleDetailPage)이 **같은 것**을 쓴다.
//   각자 그리면 반드시 갈라진다 — 한쪽에만 해제 버튼이 생기거나, 한쪽만 새로고침을 안 한다
//   (memory feedback_copied_component_drifts_extract_shell).
//
// 연결·해제는 전부 **이미 있는 컬럼**을 쓴다. 새 테이블도 새 조인도 만들지 않았다:
//   업무   tasks.client_id        — PUT  /api/tasks/by-business/:biz/:id   { client_id }
//   파일   files.client_id        — PATCH /api/files/:biz/:id              { client_id }
//   프로젝트 project_clients      — POST /api/projects/:pid/clients        { client_id }
//                                   DELETE /api/projects/:pid/clients/:linkId  ← **행 id**다
//   (null 을 보내면 해제. 워크스페이스 소속은 서버가 같은 술어로 확인한다 — 400 invalid_client)
//
// ★ Q docs 글(Post)에는 고객 축이 없다(모델 확인). 그래서 "문서" 는 여기 없다 —
//   대상이 없는 버튼을 두면 눌러도 아무 일이 없는 컨트롤이 된다. 결정은 docs/FABLE_GATE_QUEUE.md 23번.
import { useCallback, useEffect, useRef, useState } from 'react';
import styled from 'styled-components';
import { useTranslation } from 'react-i18next';
import { apiFetch } from '../../contexts/AuthContext';
import { fetchClientFiles, updateFileMeta, type ClientFileRow } from '../../services/files';

type ProjectRow = { id: number; name: string; status?: string; link_id?: number };
type TaskRow = { id: number; title: string; status?: string };
type Kind = 'task' | 'file' | 'project';
type Candidate = { id: number; label: string };

interface Props {
  businessId: number;
  clientId: number;
  /** 상세 응답의 projects (link_id 포함 — 연결을 푸는 문이 그 행 id 를 받는다) */
  projects: ProjectRow[];
  /** 연결이 바뀌면 부모가 상세·히스토리를 다시 읽는다 */
  onChanged?: () => void;
  onOpenTask?: (id: number) => void;
  onOpenProject?: (id: number) => void;
  /** 읽기 전용(권한 없음)이면 연결/해제 컨트롤을 감춘다 */
  canEdit?: boolean;
}

export default function ClientLinksSection({
  businessId, clientId, projects, onChanged, onOpenTask, onOpenProject, canEdit = true,
}: Props) {
  const { t } = useTranslation('qsale');
  const label = (key: string, dv: string) => t(key, { defaultValue: dv }) as string;

  const [tasks, setTasks] = useState<TaskRow[]>([]);
  const [files, setFiles] = useState<ClientFileRow[]>([]);
  const [loading, setLoading] = useState(false);
  const [busy, setBusy] = useState(false);

  const [adding, setAdding] = useState<Kind | null>(null);
  const [q, setQ] = useState('');
  const [cands, setCands] = useState<Candidate[]>([]);
  const [searching, setSearching] = useState(false);
  const timerRef = useRef<number | null>(null);

  const loadLinked = useCallback(async () => {
    if (!businessId || !clientId) { setTasks([]); setFiles([]); return; }
    setLoading(true);
    try {
      const [tr, fr] = await Promise.all([
        apiFetch(`/api/tasks/by-business/${businessId}?client_id=${clientId}&limit=100`)
          .then((r) => (r.ok ? r.json() : null)).catch(() => null),
        fetchClientFiles(businessId, clientId),
      ]);
      const rows = Array.isArray(tr?.data) ? tr.data : [];
      setTasks(rows.map((x: { id: number; title?: string; status?: string }) => ({
        id: Number(x.id), title: String(x.title || ''), status: x.status,
      })));
      setFiles(fr);
    } catch { setTasks([]); setFiles([]); }
    finally { setLoading(false); }
  }, [businessId, clientId]);

  useEffect(() => { void loadLinked(); }, [loadLinked]);

  const afterChange = useCallback(async () => {
    setAdding(null); setQ(''); setCands([]);
    await loadLinked();
    onChanged?.();
  }, [loadLinked, onChanged]);

  // 후보 검색 — 종류마다 다른 문을 쓴다. 이미 붙어 있는 것은 후보에서 뺀다(다시 붙일 수 없다).
  const searchCands = useCallback(async (kind: Kind, query: string) => {
    setSearching(true);
    try {
      if (kind === 'task') {
        const r = await apiFetch(
          `/api/tasks/by-business/${businessId}/search?q=${encodeURIComponent(query)}&limit=8`,
        );
        const j = r.ok ? await r.json().catch(() => null) : null;
        const rows = Array.isArray(j?.data) ? j.data : [];
        const have = new Set(tasks.map((x) => x.id));
        setCands(rows
          .map((x: { id: number; title?: string }) => ({ id: Number(x.id), label: String(x.title || '') }))
          .filter((x: Candidate) => !have.has(x.id)));
        return;
      }
      if (kind === 'file') {
        // 파일 목록에는 이름 검색 필터가 없다 — 최근 것을 받아 여기서 거른다(자료는 보통 방금 올린 것이다)
        const r = await apiFetch(`/api/files/${businessId}?limit=100`);
        const j = r.ok ? await r.json().catch(() => null) : null;
        const rows = Array.isArray(j?.data) ? j.data : [];
        const needle = query.trim().toLowerCase();
        const have = new Set(files.map((x) => x.id));
        setCands(rows
          .filter((x: { client_id?: number | null }) => !x.client_id)
          .map((x: { id: number; file_name?: string }) => ({ id: Number(x.id), label: String(x.file_name || '') }))
          .filter((x: Candidate) => !have.has(x.id) && (!needle || x.label.toLowerCase().includes(needle)))
          .slice(0, 8));
        return;
      }
      const r = await apiFetch(`/api/projects?business_id=${businessId}`);
      const j = r.ok ? await r.json().catch(() => null) : null;
      const rows = Array.isArray(j?.data) ? j.data : [];
      const needle = query.trim().toLowerCase();
      const have = new Set(projects.map((p) => p.id));
      setCands(rows
        .map((x: { id: number; name?: string }) => ({ id: Number(x.id), label: String(x.name || '') }))
        .filter((x: Candidate) => !have.has(x.id) && (!needle || x.label.toLowerCase().includes(needle)))
        .slice(0, 8));
    } catch { setCands([]); }
    finally { setSearching(false); }
  }, [businessId, tasks, files, projects]);

  // 입력은 250ms 모아서 친다 — 글자마다 서버를 때리지 않는다
  useEffect(() => {
    if (!adding) return undefined;
    if (timerRef.current) window.clearTimeout(timerRef.current);
    timerRef.current = window.setTimeout(() => { void searchCands(adding, q); }, 250);
    return () => { if (timerRef.current) window.clearTimeout(timerRef.current); };
  }, [adding, q, searchCands]);

  // autosave-exempt: 연결·해제는 **액션**이다(고르는 순간이 곧 결과). 입력 칸이 아니라 버튼이라
  //   ✓ 뱃지를 붙일 자리가 없고, 되돌리기는 바로 옆의 해제 버튼이다. 결과는 목록이 다시 그려지며 보인다.
  const link = async (kind: Kind, targetId: number) => {
    if (busy) return;
    setBusy(true);
    try {
      if (kind === 'task') {
        await apiFetch(`/api/tasks/by-business/${businessId}/${targetId}`, {
          method: 'PUT', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ client_id: clientId }),
        });
      } else if (kind === 'file') {
        await updateFileMeta(businessId, `direct-${targetId}`, { client_id: clientId });
      } else {
        await apiFetch(`/api/projects/${targetId}/clients`, {
          method: 'POST', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ client_id: clientId }),
        });
      }
      await afterChange();
    } finally { setBusy(false); }
  };

  // autosave-exempt: 위 link 와 같은 이유 — 해제도 액션 버튼이다(누르는 순간이 곧 결과).
  const unlink = async (kind: Kind, targetId: number, linkId?: number) => {
    if (busy) return;
    setBusy(true);
    try {
      if (kind === 'task') {
        await apiFetch(`/api/tasks/by-business/${businessId}/${targetId}`, {
          method: 'PUT', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ client_id: null }),
        });
      } else if (kind === 'file') {
        await updateFileMeta(businessId, `direct-${targetId}`, { client_id: null });
      } else if (linkId) {
        // ★ 고객 id 가 아니라 **연결 행 id**다 (DELETE /api/projects/:pid/clients/:linkId)
        await apiFetch(`/api/projects/${targetId}/clients/${linkId}`, { method: 'DELETE' });
      }
      await afterChange();
    } finally { setBusy(false); }
  };

  const openAdd = (kind: Kind) => {
    if (adding === kind) { setAdding(null); setQ(''); setCands([]); return; } // 재클릭 토글
    setAdding(kind); setQ(''); setCands([]);
    void searchCands(kind, '');
  };

  const group = (
    kind: Kind,
    title: string,
    rows: Array<{ id: number; label: string; linkId?: number }>,
    onOpen?: (id: number) => void,
  ) => (
    <Group>
      <GroupHead>
        <GroupTitle>{title}</GroupTitle>
        <Count>{rows.length}</Count>
        {canEdit && (
          <AddBtn type="button" data-testid={`client-link-add-${kind}`}
            aria-expanded={adding === kind} onClick={() => openAdd(kind)}>
            {adding === kind ? label('links.close', '닫기') : label('links.add', '연결')}
          </AddBtn>
        )}
      </GroupHead>

      {rows.length === 0 ? (
        <Empty>{label(`links.empty.${kind}`, '연결된 항목이 없습니다')}</Empty>
      ) : (
        <Chips>
          {rows.map((r) => (
            <Chip key={r.id} $clickable={!!onOpen}>
              <ChipName type="button" disabled={!onOpen} onClick={() => onOpen?.(r.id)} title={r.label}>
                {r.label || label('links.untitled', '(제목 없음)')}
              </ChipName>
              {canEdit && (
                <ChipX type="button" disabled={busy}
                  data-testid={`client-link-remove-${kind}-${r.id}`}
                  aria-label={label('links.unlink', '연결 해제')}
                  title={label('links.unlink', '연결 해제')}
                  onClick={() => void unlink(kind, r.id, r.linkId)}>×</ChipX>
              )}
            </Chip>
          ))}
        </Chips>
      )}

      {adding === kind && (
        <AddBox>
          <SearchBox value={q} onChange={(e) => setQ(e.target.value)} autoFocus
            placeholder={label(`links.search.${kind}`, '이름으로 찾기')}
            aria-label={label(`links.search.${kind}`, '이름으로 찾기')} />
          {searching ? (
            <Hint>{label('links.searching', '찾는 중…')}</Hint>
          ) : cands.length === 0 ? (
            <Hint>{label('links.noResult', '연결할 수 있는 것이 없습니다')}</Hint>
          ) : (
            <CandList>
              {cands.map((c) => (
                <CandBtn key={c.id} type="button" disabled={busy}
                  data-testid={`client-link-pick-${kind}-${c.id}`}
                  onClick={() => void link(kind, c.id)}>
                  {c.label || label('links.untitled', '(제목 없음)')}
                </CandBtn>
              ))}
            </CandList>
          )}
        </AddBox>
      )}
    </Group>
  );

  return (
    <Wrap data-testid="client-links">
      {loading && <Hint>{label('links.loading', '불러오는 중…')}</Hint>}
      {group('task', label('links.tasks', '업무'),
        tasks.map((x) => ({ id: x.id, label: x.title })), onOpenTask)}
      {group('file', label('links.files', '파일'),
        files.map((x) => ({ id: x.id, label: x.file_name })))}
      {group('project', label('links.projects', '프로젝트'),
        projects.map((p) => ({ id: p.id, label: p.name, linkId: p.link_id })), onOpenProject)}
    </Wrap>
  );
}

const Wrap = styled.div`display: flex; flex-direction: column; gap: 14px;`;
const Group = styled.div`display: flex; flex-direction: column; gap: 6px;`;
const GroupHead = styled.div`display: flex; align-items: center; gap: 6px;`;
const GroupTitle = styled.div`font-size: 0.75rem; font-weight: 700; color: #475569;`;
const Count = styled.span`
  font-size: 0.6875rem; font-weight: 700; color: #64748B;
  background: #F1F5F9; border-radius: 999px; padding: 1px 7px;
`;
/* 보조 액션 — 36px 컨트롤 높이 규격(반응형 기본 원칙 2) */
const AddBtn = styled.button`
  margin-left: auto; min-height: 36px; padding: 0 10px;
  font-size: 0.75rem; font-weight: 600; color: #0F766E;
  background: #fff; border: 1px solid #CBD5E1; border-radius: 8px; cursor: pointer;
  &:hover { background: #F8FAFC; }
`;
const Chips = styled.div`display: flex; flex-wrap: wrap; gap: 6px;`;
const Chip = styled.span<{ $clickable: boolean }>`
  display: inline-flex; align-items: center; max-width: 100%;
  background: #F8FAFC; border: 1px solid #E2E8F0; border-radius: 999px;
  padding: 2px 4px 2px 10px;
`;
const ChipName = styled.button`
  max-width: 200px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap;
  font-size: 0.75rem; color: #0F172A; background: none; border: none; padding: 0;
  cursor: ${(p) => (p.disabled ? 'default' : 'pointer')};
  &:hover { text-decoration: ${(p) => (p.disabled ? 'none' : 'underline')}; }
`;
const ChipX = styled.button`
  margin-left: 4px; width: 20px; height: 20px; line-height: 1;
  font-size: 0.875rem; color: #94A3B8;
  background: none; border: none; border-radius: 999px; cursor: pointer;
  &:hover { background: #E2E8F0; color: #475569; }
`;
const Empty = styled.div`font-size: 0.75rem; color: #94A3B8;`;
const Hint = styled.div`font-size: 0.75rem; color: #94A3B8; padding: 2px 0;`;
const AddBox = styled.div`
  display: flex; flex-direction: column; gap: 6px;
  padding: 8px; background: #F8FAFC; border: 1px solid #E2E8F0; border-radius: 10px;
`;
const SearchBox = styled.input`
  min-height: 36px; padding: 0 10px; font-size: 0.8125rem;
  background: #fff; border: 1px solid #CBD5E1; border-radius: 8px;
  &:focus { outline: 2px solid #99F6E4; outline-offset: -1px; }
`;
const CandList = styled.div`display: flex; flex-direction: column; gap: 2px; max-height: 180px; overflow-y: auto;`;
const CandBtn = styled.button`
  text-align: left; min-height: 36px; padding: 0 10px;
  font-size: 0.8125rem; color: #0F172A;
  background: #fff; border: 1px solid transparent; border-radius: 8px; cursor: pointer;
  overflow: hidden; text-overflow: ellipsis; white-space: nowrap;
  &:hover { background: #F0FDFA; border-color: #5EEAD4; }
`;
