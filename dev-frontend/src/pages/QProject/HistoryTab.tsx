// 프로젝트 히스토리 (#229) — 이 프로젝트에 무슨 일이 있었는지 시간 역순으로.
//
// Irene: "날짜 연도 기준으로 최신이 위에 과거가 아래로 … 날짜, 요약 내용, 업무 등 텍스트로 알려주고,
//         파일이나 노트, 문서도 아이콘으로 붙어서 연결"
//
// 여러 원장(업무·문서·파일·노트·청구·프로젝트 상태)을 서버가 병합해 내려준다. 병합 스트림이라
// 페이지 번호가 성립하지 않아 **커서(before) + 더보기** 방식이다.
import { useCallback, useEffect, useRef, useState } from 'react';
import styled from 'styled-components';
import { useTranslation } from 'react-i18next';
import { Link } from 'react-router-dom';
import { apiFetch } from '../../contexts/AuthContext';
import ActionButton from '../../components/Common/ActionButton';
import { joinRoom, leaveRoom, onSocket } from '../../services/socket';
import { useVisibilityRefresh } from '../../hooks/useVisibilityRefresh';

interface HistoryEvent {
  id: string;
  source: 'project' | 'task' | 'post' | 'file' | 'note' | 'invoice';
  kind: string;
  at: string;
  actor_user_id: number | null;
  actor_name: string | null;
  actor_is_ai: boolean;
  entity_type: string | null;
  entity_id: number | null;
  from_status: string | null;
  to_status: string | null;
  title: string | null;
}

// businessId 는 받지 않는다 — 서버가 프로젝트로부터 워크스페이스를 판정한다(클라이언트를 믿지 않는다).
interface Props { projectId: number; }

const PAGE = 50;

const SOURCE_ICON: Record<string, string> = {
  project: '◈', task: '✓', post: '📄', file: '📎', note: '✎', invoice: '₩',
};

export default function HistoryTab({ projectId }: Props) {
  const { t } = useTranslation('qproject');
  const [events, setEvents] = useState<HistoryEvent[]>([]);
  const [loading, setLoading] = useState(true);
  const [more, setMore] = useState(false);
  const [loadingMore, setLoadingMore] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const reloadTimer = useRef<number | null>(null);

  const load = useCallback(async (silent = false) => {
    if (!silent) setLoading(true);
    try {
      const r = await apiFetch(`/api/projects/${projectId}/history?limit=${PAGE}`);
      if (!r.ok) {
        // apiFetch 는 실패해도 throw 하지 않는다 — res.ok 를 안 보면 실패가 성공인 척 지나간다.
        setErr(r.status === 403
          ? (t('history.memberOnly', { defaultValue: '프로젝트 멤버만 볼 수 있어요.' }) as string)
          : (t('history.loadFailed', { defaultValue: '히스토리를 불러오지 못했어요.' }) as string));
        setEvents([]);
        return;
      }
      const j = await r.json();
      // 실시간 갱신은 **서버 응답으로 통째로 교체**한다 — 신규만 병합하면 삭제된 항목이 영영 남는다.
      setEvents(j?.data?.events || []);
      setMore(!!j?.data?.has_more);
      setErr(null);
    } catch {
      setErr(t('history.loadFailed', { defaultValue: '히스토리를 불러오지 못했어요.' }) as string);
    } finally { setLoading(false); }
  }, [projectId, t]);

  useEffect(() => { load(); }, [load]);
  useVisibilityRefresh(() => load(true));

  // 실시간 — 다른 사람이 업무를 끝내면 새로고침 없이 보여야 한다.
  useEffect(() => {
    if (!projectId) return;
    const debounced = () => {
      if (reloadTimer.current) return;
      reloadTimer.current = window.setTimeout(() => { reloadTimer.current = null; load(true); }, 250);
    };
    joinRoom(`project:${projectId}`);
    const offs = [
      onSocket('task:new', debounced), onSocket('task:updated', debounced),
      onSocket('task:deleted', debounced), onSocket('project:updated', debounced),
    ];
    return () => {
      if (reloadTimer.current) window.clearTimeout(reloadTimer.current);
      leaveRoom(`project:${projectId}`);
      offs.forEach((off) => off());
    };
  }, [projectId, load]);

  const loadMore = async () => {
    const last = events[events.length - 1];
    if (!last || loadingMore) return;
    setLoadingMore(true);
    try {
      // 시각만 보내면 같은 초에 묶인 항목이 경계에서 잘린다 — 마지막 항목의 id 도 같이 보낸다.
      const r = await apiFetch(`/api/projects/${projectId}/history?limit=${PAGE}&before=${encodeURIComponent(last.at)}&before_id=${encodeURIComponent(last.id)}`);
      if (!r.ok) return;
      const j = await r.json();
      const next: HistoryEvent[] = j?.data?.events || [];
      setEvents((prev) => [...prev, ...next.filter((e) => !prev.some((x) => x.id === e.id))]);
      setMore(!!j?.data?.has_more);
    } finally { setLoadingMore(false); }
  };

  const linkFor = (e: HistoryEvent): string | null => {
    if (!e.entity_id) return null;
    switch (e.entity_type) {
      case 'task': return `/projects/p/${projectId}?tab=tasks&task=${e.entity_id}`;
      case 'post': return `/projects/p/${projectId}?tab=docs&post=${e.entity_id}`;
      case 'file': return `/projects/p/${projectId}?tab=files`;
      case 'invoice': return `/bills?invoice=${e.entity_id}`;
      default: return null;
    }
  };

  const label = (e: HistoryEvent) => t(`history.kind.${e.kind}`, { defaultValue: e.kind });

  if (loading) return <Wrap><Dim>{t('history.loading', { defaultValue: '불러오는 중…' }) as string}</Dim></Wrap>;
  if (err) return <Wrap><Dim>{err}</Dim></Wrap>;
  if (events.length === 0) {
    return <Wrap><Dim>{t('history.empty', { defaultValue: '아직 기록이 없어요. 업무·문서·파일이 쌓이면 여기 시간순으로 모입니다.' }) as string}</Dim></Wrap>;
  }

  // 연·월 그룹 — 최신이 위
  const groups: { key: string; label: string; items: HistoryEvent[] }[] = [];
  for (const e of events) {
    const d = new Date(e.at);
    const key = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
    const g = groups.find((x) => x.key === key);
    const gl = t('history.monthLabel', { defaultValue: '{{year}}년 {{month}}월', year: d.getFullYear(), month: d.getMonth() + 1 }) as string;
    if (g) g.items.push(e); else groups.push({ key, label: gl, items: [e] });
  }

  return (
    <Wrap>
      {groups.map((g) => (
        <Group key={g.key}>
          <GroupHead>{g.label}</GroupHead>
          {g.items.map((e) => {
            const href = linkFor(e);
            const body = (
              <>
                <Icon $src={e.source}>{SOURCE_ICON[e.source] || '·'}</Icon>
                <Body>
                  <Row1>
                    <Kind>{label(e)}</Kind>
                    {e.title && <Title title={e.title}>{e.title}</Title>}
                  </Row1>
                  <Row2>
                    <span>{new Date(e.at).toLocaleString()}</span>
                    {e.actor_name && <><Sep>·</Sep><span>{e.actor_name}{e.actor_is_ai ? ' (AI)' : ''}</span></>}
                  </Row2>
                </Body>
              </>
            );
            return href
              ? <ItemLink key={e.id} to={href}>{body}</ItemLink>
              : <Item key={e.id}>{body}</Item>;
          })}
        </Group>
      ))}
      {more && (
        <MoreRow>
          <ActionButton tone="secondary" size="sm" onClick={loadMore} loading={loadingMore}>
            {t('history.more', { defaultValue: '더보기' }) as string}
          </ActionButton>
        </MoreRow>
      )}
    </Wrap>
  );
}

const Wrap = styled.div`display: flex; flex-direction: column; gap: 18px; padding: 4px 0 24px;`;
const Dim = styled.div`padding: 40px 0; text-align: center; font-size: 13px; color: #94A3B8; line-height: 1.7;`;
const Group = styled.div`display: flex; flex-direction: column; gap: 4px;`;
const GroupHead = styled.div`
  position: sticky; top: 0; z-index: 1;
  padding: 6px 2px; background: #F8FAFC;
  font-size: 12px; font-weight: 700; color: #64748B;
`;
const itemCss = `
  display: flex; align-items: flex-start; gap: 10px;
  padding: 10px 12px; border: 1px solid #E2E8F0; border-radius: 10px; background: #fff;
  text-decoration: none; color: inherit;
`;
const Item = styled.div`${itemCss}`;
const ItemLink = styled(Link)`${itemCss} &:hover { border-color: #14B8A6; background: #F0FDFA; }`;
const Icon = styled.span<{ $src: string }>`
  flex-shrink: 0; width: 22px; height: 22px; border-radius: 6px;
  display: inline-flex; align-items: center; justify-content: center;
  font-size: 12px; background: #F1F5F9; color: #475569;
`;
const Body = styled.div`flex: 1; min-width: 0; display: flex; flex-direction: column; gap: 2px;`;
const Row1 = styled.div`display: flex; align-items: baseline; gap: 8px; min-width: 0;`;
const Kind = styled.span`flex-shrink: 0; font-size: 12px; font-weight: 700; color: #0F172A;`;
const Title = styled.span`
  flex: 1; min-width: 0; font-size: 12px; color: #475569;
  overflow: hidden; text-overflow: ellipsis; white-space: nowrap;
`;
const Row2 = styled.div`display: flex; align-items: center; gap: 6px; font-size: 11px; color: #94A3B8;`;
const Sep = styled.span`color: #CBD5E1;`;
const MoreRow = styled.div`display: flex; justify-content: center; padding: 8px 0;`;
