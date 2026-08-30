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
  // 사건을 문장으로 만드는 재료 (2026-08-25). 옛 응답엔 없어서 "라벨 + 엔티티 이름" 밖에 못 그렸다.
  target_name?: string | null;
  round?: number | null;
  note?: string | null;
  /** 업무 추가처럼 낱개로는 의미가 옅어 접어야 하는 사건 */
  groupable?: boolean;
}

/** 화면 한 줄 — 낱개 사건이거나, 접힌 업무 추가 묶음 */
type Entry =
  | { type: 'one'; event: HistoryEvent }
  | { type: 'bundle'; items: HistoryEvent[] };

const sameMonth = (a: string, b: string) => a.slice(0, 7) === b.slice(0, 7);
const sameDay = (a: string, b: string) => a.slice(0, 10) === b.slice(0, 10);
const bundleKey = (en: { items: HistoryEvent[] }) => `bundle:${en.items[0].id}`;

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
  // 접힌 업무 묶음 중 펼쳐 둔 것
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const toggleBundle = useCallback((k: string) => {
    setExpanded((prev) => {
      const n = new Set(prev);
      if (n.has(k)) n.delete(k); else n.add(k);
      return n;
    });
  }, []);

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

  // ★ 2026-08-25 (Irene: "마우스오버가 되는데 클릭해서 볼 수 있는 거 없어? 클릭이 안되네")
  //   여태 hover 는 모든 줄에 걸려 있고 링크는 일부 줄에만 있어서, **눌러도 될 것처럼 보이는데
  //   안 눌리는** 상태였다. 갈 곳이 있는 것은 전부 링크로 만들고, 없는 것은 hover 도 끈다.
  const linkFor = (e: HistoryEvent): string | null => {
    switch (e.entity_type) {
      case 'task': return e.entity_id ? `/projects/p/${projectId}?tab=tasks&task=${e.entity_id}` : null;
      case 'post': return e.entity_id ? `/projects/p/${projectId}?tab=docs&post=${e.entity_id}` : null;
      case 'file': return `/projects/p/${projectId}?tab=files`;
      case 'note': return `/projects/p/${projectId}?tab=overview`;      // 메모는 개요 탭에 모인다
      case 'invoice': return e.entity_id ? `/bills?invoice=${e.entity_id}` : null;
      case 'project': return `/projects/p/${projectId}?tab=details`;    // 상태 변경 → 상세정보(상태 이력 카드)
      default: return null;
    }
  };

  const label = (e: HistoryEvent) => t(`history.kind.${e.kind}`, { defaultValue: e.kind });

  // 사건 부가 설명 — "무엇이 어떻게 바뀌었는지". 서버가 from/to·대상·회차를 주는데 여태 안 썼다.
  const detail = (e: HistoryEvent): string | null => {
    const parts: string[] = [];
    if (e.from_status && e.to_status && e.from_status !== e.to_status) {
      parts.push(`${t(`history.status.${e.from_status}`, { defaultValue: e.from_status })} → ${t(`history.status.${e.to_status}`, { defaultValue: e.to_status })}`);
    }
    if (e.target_name) parts.push(`→ ${e.target_name}`);
    if (e.round) parts.push(`R${e.round}`);
    return parts.length ? parts.join('  ') : null;
  };

  if (loading) return <Wrap><Dim>{t('history.loading', { defaultValue: '불러오는 중…' }) as string}</Dim></Wrap>;
  if (err) return <Wrap><Dim>{err}</Dim></Wrap>;
  if (events.length === 0) {
    return <Wrap><Dim>{t('history.empty', { defaultValue: '아직 기록이 없어요. 업무·문서·파일이 쌓이면 여기 시간순으로 모입니다.' }) as string}</Dim></Wrap>;
  }

  // 연·월 그룹 — 최신이 위
  const groups: { key: string; label: string; items: Entry[] }[] = [];
  // 연속한 groupable(업무 추가)은 한 줄로 접는다 — 낱개로 두면 화면의 89%가 "업무 추가" 가 된다
  //   (운영 실측: 업무 41개 프로젝트에서 히스토리 62행 중 55행). 접되 지우지는 않는다.
  const entries: Entry[] = [];
  for (const e of events) {
    const last = entries[entries.length - 1];
    if (e.groupable && last && last.type === 'bundle' && sameMonth(last.items[0].at, e.at)) {
      last.items.push(e);
      continue;
    }
    if (e.groupable) { entries.push({ type: 'bundle', items: [e] }); continue; }
    entries.push({ type: 'one', event: e });
  }
  // 1건짜리 묶음은 묶을 이유가 없다 — "업무 1개 추가" 를 접어 두면 오히려 한 번 더 눌러야 한다
  for (let i = 0; i < entries.length; i++) {
    const en = entries[i];
    if (en.type === 'bundle' && en.items.length === 1) entries[i] = { type: 'one', event: en.items[0] };
  }
  for (const en of entries) {
    const at = en.type === 'one' ? en.event.at : en.items[0].at;
    const d = new Date(at);
    const key = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
    const g = groups.find((x) => x.key === key);
    const gl = t('history.monthLabel', { defaultValue: '{{year}}년 {{month}}월', year: d.getFullYear(), month: d.getMonth() + 1 }) as string;
    if (g) g.items.push(en); else groups.push({ key, label: gl, items: [en] });
  }

  return (
    <Wrap>
      {groups.map((g) => (
        <Group key={g.key}>
          <GroupHead>{g.label}</GroupHead>
          {g.items.map((en) => {
            if (en.type === 'bundle') {
              const first = en.items[en.items.length - 1];
              const last = en.items[0];
              const span = sameDay(first.at, last.at)
                ? new Date(last.at).toLocaleDateString()
                : `${new Date(first.at).toLocaleDateString()} ~ ${new Date(last.at).toLocaleDateString()}`;
              const on = expanded.has(bundleKey(en));
              return (
                <BundleWrap key={bundleKey(en)}>
                  <BundleHead type="button" onClick={() => toggleBundle(bundleKey(en))} aria-expanded={on}>
                    <Icon $src="task">{on ? '▾' : '▸'}</Icon>
                    <Body>
                      <Row1>
                        <Kind>{t('history.bundle.taskCreated', { defaultValue: '업무 {{n}}개 추가', n: en.items.length }) as string}</Kind>
                      </Row1>
                      <Row2><span>{span}</span></Row2>
                    </Body>
                  </BundleHead>
                  {on && en.items.map((e) => (
                    <BundleItem key={e.id} to={linkFor(e) || '#'}>
                      <BundleDot aria-hidden="true">·</BundleDot>
                      <BundleTitle title={e.title || ''}>{e.title}</BundleTitle>
                      <BundleWhen>{new Date(e.at).toLocaleDateString()}</BundleWhen>
                    </BundleItem>
                  ))}
                </BundleWrap>
              );
            }
            const e = en.event;
            const href = linkFor(e);
            const dt = detail(e);
            const body = (
              <>
                <Icon $src={e.source}>{SOURCE_ICON[e.source] || '·'}</Icon>
                <Body>
                  <Row1>
                    <Kind>{label(e)}</Kind>
                    {e.title && <Title title={e.title}>{e.title}</Title>}
                    {dt && <Detail>{dt}</Detail>}
                  </Row1>
                  {e.note && <NoteLine>{e.note}</NoteLine>}
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
const Dim = styled.div`padding: 40px 0; text-align: center; font-size: 0.8125rem; color: #94A3B8; line-height: 1.7;`;
const Group = styled.div`display: flex; flex-direction: column; gap: 4px;`;
const GroupHead = styled.div`
  position: sticky; top: 0; z-index: 1;
  padding: 6px 2px; background: #F8FAFC;
  font-size: 0.75rem; font-weight: 700; color: #64748B;
`;
const itemCss = `
  display: flex; align-items: flex-start; gap: 10px;
  padding: 10px 12px; border: 1px solid #E2E8F0; border-radius: 10px; background: #fff;
  text-decoration: none; color: inherit;
`;
const Item = styled.div`${itemCss}`;
/* 사건 부가 설명 — "기획 → 진행중", "→ 이수민", "R2" */
const Detail = styled.span`
  font-size:0.78125rem;color:#0F766E;font-weight:600;white-space:nowrap;
`;
/* 상태를 바꾸며 남긴 사유 — 여태 응답에도 화면에도 없었다 */
const NoteLine = styled.div`
  margin-top:3px;padding:6px 10px;background:#F8FAFC;border-left:2px solid #CBD5E1;
  border-radius:0 6px 6px 0;font-size:0.78125rem;color:#475569;line-height:1.5;
`;
/* 접힌 업무 추가 묶음 */
const BundleWrap = styled.div`display:flex;flex-direction:column;`;
const BundleHead = styled.button`
  display:flex;align-items:flex-start;gap:10px;width:100%;padding:10px 4px;
  background:transparent;border:none;cursor:pointer;text-align:left;
  &:hover{background:#F8FAFC;}
  &:focus-visible{outline:2px solid #0D9488;outline-offset:-2px;}
`;
const BundleItem = styled(Link)`
  display:flex;align-items:center;gap:8px;padding:5px 4px 5px 34px;
  text-decoration:none;color:inherit;
  &:hover{background:#F8FAFC;}
`;
const BundleDot = styled.span`color:#CBD5E1;font-size:0.8125rem;`;
const BundleTitle = styled.span`
  flex:1;min-width:0;font-size:0.8125rem;color:#334155;
  overflow:hidden;text-overflow:ellipsis;white-space:nowrap;
`;
const BundleWhen = styled.span`font-size:0.75rem;color:#94A3B8;flex-shrink:0;`;

const ItemLink = styled(Link)`${itemCss} &:hover { border-color: #14B8A6; background: #F0FDFA; }`;
const Icon = styled.span<{ $src: string }>`
  flex-shrink: 0; width: 22px; height: 22px; border-radius: 6px;
  display: inline-flex; align-items: center; justify-content: center;
  font-size: 0.75rem; background: #F1F5F9; color: #475569;
`;
const Body = styled.div`flex: 1; min-width: 0; display: flex; flex-direction: column; gap: 2px;`;
const Row1 = styled.div`display: flex; align-items: baseline; gap: 8px; min-width: 0;`;
const Kind = styled.span`flex-shrink: 0; font-size: 0.75rem; font-weight: 700; color: #0F172A;`;
const Title = styled.span`
  flex: 1; min-width: 0; font-size: 0.75rem; color: #475569;
  overflow: hidden; text-overflow: ellipsis; white-space: nowrap;
`;
const Row2 = styled.div`display: flex; align-items: center; gap: 6px; font-size: 0.6875rem; color: #94A3B8;`;
const Sep = styled.span`color: #CBD5E1;`;
const MoreRow = styled.div`display: flex; justify-content: center; padding: 8px 0;`;
