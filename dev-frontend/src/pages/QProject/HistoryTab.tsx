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
import SingleDateField from '../../components/Common/SingleDateField';
// 쓰다 나가도 남는다 — 자유 텍스트는 서버에 즉시 안 가므로 초안이 필요하다(가드 --category=draft)
import { useDraftKey, useDraftText } from '../../hooks/useDraftText';
import { Link } from 'react-router-dom';
import { apiFetch } from '../../contexts/AuthContext';
import ActionButton from '../../components/Common/ActionButton';
import { joinRoom, leaveRoom, onSocket } from '../../services/socket';
import { useVisibilityRefresh } from '../../hooks/useVisibilityRefresh';
import { formatDay, formatDayTime } from '../../utils/dateFormat';
import AutoSaveField from '../../components/Common/AutoSaveField';
import { Switch, SwitchKnob } from '../../components/Common/switchShell';
// 자동 기록 한 줄의 «설명 줄» 고치기 — 업무 상세·상태 이력 카드와 같은 컴포넌트(docs/HISTORY_OVERRIDE_DESIGN.md)
import HistoryNote, { type HistoryNoteFields } from '../../components/Common/HistoryNote';
import { useAuth } from '../../contexts/AuthContext';

interface HistoryEvent extends HistoryNoteFields {
  id: string;
  // ★ 'note' 는 프로젝트 메모, 'qnote' 는 Q Note 회의록이다 — 다른 원장이다.
  //   같은 이름에 담으면 어느 쪽이 빠졌는지 알 수 없다(회의록이 여태 통째로 빠져 있었다).
  source: 'project' | 'task' | 'post' | 'file' | 'note' | 'qnote' | 'invoice' | 'manual' | 'interaction';
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
  /** 업무 추가처럼 낱개로는 의미가 옅어 접어야 하는 사건 */
  groupable?: boolean;
  /** 사람이 적은 주요 이슈(manual)만 — 고객 프로젝트 링크에 보이는가(GUEST_PROJECT_VIEW_DECISIONS §I-2) */
  client_visible?: boolean;
  /** 사람이 적은 주요 이슈(manual) 본문 앞 120자 */
  preview?: string | null;
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
  // 사람이 직접 적은 주요 이슈 · 연결된 고객의 상담 기록 (2026-09-13)
  manual: '★', interaction: '☎', qnote: '🎙',
};

export default function HistoryTab({ projectId }: Props) {
  const { t } = useTranslation('qproject');
  const { user } = useAuth();
  // 지금 글을 고치는 줄 — 그 줄은 링크를 끈다(입력칸이 링크 안이면 누르는 순간 이동한다)
  const [editingId, setEditingId] = useState<string | null>(null);
  const onEditing = useCallback((id: string) => (v: boolean) => {
    setEditingId((cur) => (v ? id : (cur === id ? null : cur)));
  }, []);
  // 사람이 적은 항목 고치기 — 제목·본문·날짜(적은 사람 또는 관리자, 서버와 같은 선)
  const [manualEdit, setManualEdit] = useState<ManualEditTarget | null>(null);
  const canEditManual = (e: HistoryEvent) => !!user && (
    Number(e.actor_user_id) === Number(user.id)
    || user.business_role === 'owner' || user.business_role === 'admin' || user.platform_role === 'platform_admin');
  const [events, setEvents] = useState<HistoryEvent[]>([]);
  const [loading, setLoading] = useState(true);
  const [more, setMore] = useState(false);
  const [loadingMore, setLoadingMore] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  // 수동 히스토리 추가 (2026-09-13) — 날짜는 사람이 정한다(오늘이 기본)
  const [addOpen, setAddOpen] = useState(false);
  const [addDate, setAddDate] = useState(() => new Date().toISOString().slice(0, 10));
  const [addTitle, setAddTitle] = useState('');
  // 본문은 길다 — 탭을 옮기거나 새로고침해도 남는다. 비우는 곳은 **제출 성공**뿐이다.
  const bodyDraft = useDraftText(useDraftKey('project-history-entry', projectId, null));
  const addBody = bodyDraft.text;
  const [addBusy, setAddBusy] = useState(false);
  // 고객 링크에 보이기 — 기본 꺼짐(§I-2). 사람이 켠 항목만 고객 프로젝트 링크의 «주요 이슈» 에 나간다.
  const [addClientVisible, setAddClientVisible] = useState(false);
  const [addErr, setAddErr] = useState<string | null>(null);
  const reloadTimer = useRef<number | null>(null);
  // «고객 공개» 토글의 최신 값 — 훅이라 early return 위에 둔다.
  const eventsRef = useRef<HistoryEvent[]>([]);
  eventsRef.current = events;
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
      case 'qnote': return e.entity_id ? `/notes?session=${e.entity_id}` : '/notes';   // 회의록은 Q Note 로
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

  // «고객 공개» 토글 — flip=화면만, persist=래퍼(AutoSaveField)가 부르는 저장. 최신 값은 ref 로 읽는다
  //   (클릭으로 이미 뒤집힌 값을 저장해야 하는데 클로저는 뒤집기 전 값을 본다 — CLAUDE.md 자동저장 절).
  const setVisible = (id: string, v: boolean) =>
    setEvents((prev) => prev.map((x) => (x.id === id ? { ...x, client_visible: v } : x)));
  const persistVisible = async (ev: HistoryEvent) => {
    const cur = eventsRef.current.find((x) => x.id === ev.id);
    if (!cur || !cur.entity_id) return;
    const want = !!cur.client_visible;
    const r = await apiFetch(`/api/projects/${projectId}/history-entries/${cur.entity_id}`, {
      method: 'PATCH', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ client_visible: want }),
    });
    const j = await r.json().catch(() => null);
    if (!r.ok || !j?.success) {
      setVisible(cur.id, !want);                          // 화면이 서버와 다른 값을 보이면 안 된다
      throw new Error(j?.message || 'save_failed');       // 던져야 ! 뱃지가 뜬다
    }
  };

  const submitEntry = async () => {
    if (addBusy || !addTitle.trim()) return;       // 중복 제출 가드 (UI_DESIGN_GUIDE §1.8)
    setAddBusy(true); setAddErr(null);
    try {
      // 날짜만 고르면 그 날 정오로 — 자정으로 보내면 시간대에 따라 전날로 밀린다
      const occurredAt = new Date(`${addDate}T12:00:00`).toISOString();
      const r = await apiFetch(`/api/projects/${projectId}/history-entries`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ title: addTitle.trim(), body: addBody.trim() || null, occurred_at: occurredAt, client_visible: addClientVisible }),
      });
      const j = await r.json().catch(() => null);
      if (!r.ok || !j?.success) {
        // 실패를 삼키지 않는다 — 이유를 그대로 보여준다
        setAddErr(j?.message === 'occurred_in_future'
          ? (t('history.add.futureNotAllowed', '앞으로의 날짜는 넣을 수 없습니다.') as string)
          : (t('history.add.failed', '추가하지 못했습니다.') as string));
        return;
      }
      setAddTitle(''); bodyDraft.clear(); setAddOpen(false); setAddClientVisible(false);   // 성공에만 비운다
      await load();                                  // 목록을 다시 읽어 방금 것이 보이게
    } catch {
      setAddErr(t('history.add.failed', '추가하지 못했습니다.') as string);
    } finally { setAddBusy(false); }
  };

  // 사람이 적은 항목 고치기 — 본문 전체는 목록 응답(앞 120자)에 없어서 열 때 한 번 읽는다
  const openManualEdit = async (ev: React.SyntheticEvent, e: HistoryEvent) => {
    ev.preventDefault(); ev.stopPropagation();
    if (!e.entity_id) return;
    let body = e.preview || '';
    try {
      const r = await apiFetch(`/api/projects/${projectId}/history-entries?limit=300`);
      const j = await r.json().catch(() => null);
      const row = Array.isArray(j?.data) ? j.data.find((x: { id: number }) => x.id === e.entity_id) : null;
      if (row) body = row.body || '';
    } catch { /* 앞 120자로 연다 */ }
    const d = new Date(e.at);
    const date = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
    setManualEdit({ eventId: e.id, entryId: e.entity_id, date, title: e.title || '', body, clientVisible: !!e.client_visible });
  };

  return (
    <Wrap>
      {/* ★ 2026-09-13 (Irene: *"프로젝트 히스토리 탭에 수동으로 히스토리 추가하는 기능이 없어.
          프로젝트 히스토리는 주요 이슈를 직접 넣는 거야. 날짜 제목 내용 등"*)
          날짜는 **사람이 정한다** — 지난주 일을 오늘 적을 수 있어야 히스토리가 사실과 맞는다. */}
      <AddBar>
        {!addOpen ? (
          <ActionButton tone="secondary" size="sm" data-testid="history-add-open"
            onClick={() => setAddOpen(true)}>
            {t('history.add.open', '히스토리 추가') as string}
          </ActionButton>
        ) : (
          <AddForm>
            <AddRow>
              <SingleDateField value={addDate} onChange={setAddDate} size="md" />
              <AddInput value={addTitle} onChange={(e) => setAddTitle(e.target.value)}
                data-testid="history-add-title"
                placeholder={t('history.add.titlePlaceholder', '제목 — 무슨 일이 있었나') as string} />
            </AddRow>
            <AddArea rows={3} data-testid="history-add-body" data-draft-kind="project-history-entry"
              placeholder={t('history.add.bodyPlaceholder', '내용 (선택)') as string}
              {...bodyDraft.bind} />
            <AddCheck>
              {/* autosave-exempt: 생성 폼의 제출값 — [추가] 를 누를 때 같이 보낸다 */}
              <input type="checkbox" checked={addClientVisible} data-testid="history-add-client-visible"
                onChange={(e) => setAddClientVisible(e.target.checked)} />
              <span>{t('history.clientVisible.add', '고객 프로젝트 링크에 보이기') as string}</span>
            </AddCheck>
            {bodyDraft.restored && <AddHint>{t('history.add.draftRestored', '쓰던 내용을 되살렸습니다.') as string}</AddHint>}
            {addErr && <AddErr role="alert">{addErr}</AddErr>}
            <AddActions>
              <ActionButton tone="secondary" size="sm"
                onClick={() => { setAddOpen(false); setAddErr(null); }}>
                {t('history.add.cancel', '취소') as string}
              </ActionButton>
              <ActionButton tone="primary" size="sm" loading={addBusy} disabled={!addTitle.trim()}
                data-testid="history-add-submit" onClick={submitEntry}>
                {t('history.add.submit', '추가') as string}
              </ActionButton>
            </AddActions>
          </AddForm>
        )}
      </AddBar>

      {groups.map((g) => (
        <Group key={g.key}>
          <GroupHead>{g.label}</GroupHead>
          {g.items.map((en) => {
            if (en.type === 'bundle') {
              const first = en.items[en.items.length - 1];
              const last = en.items[0];
              const span = sameDay(first.at, last.at)
                ? formatDay(last.at, { year: 'always' })
                : `${formatDay(first.at, { year: 'always' })} ~ ${formatDay(last.at, { year: 'always' })}`;
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
                  {on && en.items.map((e) => {
                    const inner = (
                      <>
                        <BundleDot aria-hidden="true">·</BundleDot>
                        <BundleTitle title={e.title || ''}>{e.title}</BundleTitle>
                        <BundleWhen>{formatDay(e.at, { year: 'always' })}</BundleWhen>
                        {/* 묶음 안 항목에도 설명을 남길 수 있다 — 남긴 줄은 서버가 묶음에서 빼 낱개로 보인다 */}
                        <HistoryNote row={e} projectId={projectId} onChanged={() => load(true)} onEditingChange={onEditing(e.id)} editing={editingId === e.id} />
                      </>
                    );
                    return editingId === e.id
                      ? <BundleItemPlain key={e.id} data-history-row>{inner}</BundleItemPlain>
                      : <BundleItem key={e.id} to={linkFor(e) || '#'} data-history-row>{inner}</BundleItem>;
                  })}
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
                  {e.source !== 'manual' && (
                    <HistoryNote row={e} projectId={projectId} onChanged={() => load(true)} onEditingChange={onEditing(e.id)} editing={editingId === e.id} />
                  )}
                  {e.source === 'manual' && e.preview && manualEdit?.eventId !== e.id && <ManualPreview>{e.preview}</ManualPreview>}
                  {manualEdit?.eventId === e.id && (
                    <ManualEditForm projectId={projectId} target={manualEdit}
                      onCancel={() => setManualEdit(null)}
                      onDone={async () => { setManualEdit(null); await load(true); }} />
                  )}
                  <Row2>
                    <span>{formatDayTime(e.at, { year: 'always' })}</span>
                    {e.actor_name && <><Sep>·</Sep><span>{e.actor_name}{e.actor_is_ai ? ' (AI)' : ''}</span></>}
                    {e.source === 'manual' && e.entity_id && canEditManual(e) && manualEdit?.eventId !== e.id && (
                      <ManualEditBtn type="button" data-testid={`history-manual-edit-open-${e.entity_id}`}
                        onClick={(ev) => openManualEdit(ev, e)}>
                        {t('history.edit.open', '고치기') as string}
                      </ManualEditBtn>
                    )}
                    {e.source === 'manual' && e.entity_id && (
                      <VisibleSlot data-testid={`history-client-visible-${e.entity_id}`}>
                        <VisibleLabel>{t('history.clientVisible.label', '고객 공개') as string}</VisibleLabel>
                        <AutoSaveField key={`${projectId}:${e.id}`} type="toggle" onSave={() => persistVisible(e)}>
                          <Switch type="button" role="switch" aria-checked={!!e.client_visible} $on={!!e.client_visible}
                            aria-label={t('history.clientVisible.aria', '고객 프로젝트 링크에 보이기') as string}
                            onClick={() => setVisible(e.id, !e.client_visible)}>
                            <SwitchKnob $on={!!e.client_visible} />
                          </Switch>
                        </AutoSaveField>
                      </VisibleSlot>
                    )}
                  </Row2>
                </Body>
              </>
            );
            // 글을 고치는 동안은 링크를 끈다
            const linkOn = href && editingId !== e.id && manualEdit?.eventId !== e.id;
            return linkOn
              ? <ItemLink key={e.id} to={href} data-history-row>{body}</ItemLink>
              : <Item key={e.id} data-history-row>{body}</Item>;
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


interface ManualEditTarget { eventId: string; entryId: number; date: string; title: string; body: string; clientVisible: boolean; }

/** 사람이 적은 항목 고치기 — 추가 폼과 같은 모양. 본문은 쓰다 나가도 남는다(초안 kind 'project-history-entry-edit') */
function ManualEditForm({ projectId, target, onDone, onCancel }: {
  projectId: number; target: ManualEditTarget; onDone: () => void | Promise<void>; onCancel: () => void;
}) {
  const { t } = useTranslation('qproject');
  const [date, setDate] = useState(target.date);
  const [title, setTitle] = useState(target.title);
  const bodyDraft = useDraftText(useDraftKey('project-history-entry-edit', target.entryId, null), { base: target.body });
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  // 처음 열 때 — 남겨 둔 초안이 없으면 지금 본문에서 시작한다
  useEffect(() => {
    if (!bodyDraft.restored && !bodyDraft.text && target.body) bodyDraft.setText(target.body);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const save = async () => {
    if (busy || !title.trim()) return;   // 중복 제출 가드
    setBusy(true); setErr(null);
    try {
      const payload: Record<string, unknown> = { title: title.trim(), body: bodyDraft.text.trim() || null };
      // 날짜를 바꿨을 때만 보낸다 — 같은 날이면 사람이 정한 시각을 정오로 덮지 않는다
      if (date !== target.date) payload.occurred_at = new Date(`${date}T12:00:00`).toISOString();
      const r = await apiFetch(`/api/projects/${projectId}/history-entries/${target.entryId}`, {
        method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload),
      });
      const j = await r.json().catch(() => null);
      if (!r.ok || !j?.success) {
        setErr(j?.message === 'occurred_in_future'
          ? (t('history.add.futureNotAllowed', '앞으로의 날짜는 넣을 수 없습니다.') as string)
          : r.status === 403
            ? (t('history.edit.forbidden', '적은 사람이나 관리자만 고칠 수 있어요.') as string)
            : (t('history.edit.failed', '저장하지 못했어요.') as string));
        return;
      }
      bodyDraft.clear();                     // 비우는 곳은 성공·명시 취소뿐
      await onDone();
    } catch {
      setErr(t('history.edit.failed', '저장하지 못했어요.') as string);
    } finally { setBusy(false); }
  };

  return (
    <AddForm data-testid="history-manual-edit" onClick={(ev) => ev.stopPropagation()}>
      <AddRow>
        <SingleDateField value={date} onChange={setDate} size="md" />
        {/* autosave-exempt: 항목 고치기 폼 — [저장] 을 누를 때 같이 보낸다(추가 폼과 같은 모양) */}
        <AddInput value={title} data-testid="history-manual-edit-title" onChange={(ev) => setTitle(ev.target.value)}
          placeholder={t('history.add.titlePlaceholder', '제목 — 무슨 일이 있었나') as string} />
      </AddRow>
      {/* autosave-exempt: 위와 같다 — 본문은 초안으로 남는다 */}
      <AddArea rows={3} data-testid="history-manual-edit-body" data-draft-kind="project-history-entry-edit"
        placeholder={t('history.add.bodyPlaceholder', '내용 (선택)') as string} {...bodyDraft.bind} />
      {target.clientVisible && <AddHint>{t('history.edit.clientLinkSees', '고객 링크에 공개된 항목입니다 — 바뀐 글이 고객에게도 보입니다.') as string}</AddHint>}
      {err && <AddErr role="alert">{err}</AddErr>}
      <AddActions>
        <ActionButton tone="secondary" size="sm" onClick={() => { bodyDraft.clear(); onCancel(); }}>
          {t('history.edit.cancel', '취소') as string}
        </ActionButton>
        <ActionButton tone="primary" size="sm" loading={busy} disabled={!title.trim()}
          data-testid="history-manual-edit-save" onClick={save}>
          {t('history.edit.save', '저장') as string}
        </ActionButton>
      </AddActions>
    </AddForm>
  );
}

// 상단 4px 제거 (2026-09-14) — 이 탭만 내용이 4px 아래에서 시작했다. 하단 여백은 유지.
const Wrap = styled.div`display: flex; flex-direction: column; gap: 18px; padding: 0 0 24px;`;
const Dim = styled.div`padding: 40px 0; text-align: center; font-size: 0.8125rem; color: #94A3B8; line-height: 1.7;`;
const Group = styled.div`display: flex; flex-direction: column; gap: 4px;`;
const GroupHead = styled.div`
  position: sticky; top: 0; z-index: 1;
  padding: 6px 2px; background: #F8FAFC;
  font-size: 0.75rem; font-weight: 700; color: #64748B;
`;
const itemCss = `
  position: relative;   /* 설명이 없는 줄의 [설명 남기기] 단추가 줄 오른쪽 위에 겹친다(HistoryNote) */
  display: flex; align-items: flex-start; gap: 10px;
  padding: 10px 44px 10px 12px; border: 1px solid #E2E8F0;   /* 오른쪽 44 — [설명 남기기] 단추 자리(글자와 안 겹친다) */
  border-radius: 10px; background: #fff;
  text-decoration: none; color: inherit;
  @media (max-width: 640px) { padding-right: 52px; }
`;
const Item = styled.div`${itemCss}`;
/* 사건 부가 설명 — "기획 → 진행중", "→ 이수민", "R2" */
const Detail = styled.span`
  font-size:0.78125rem;color:#0F766E;font-weight:600;white-space:nowrap;
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
  position:relative;display:flex;align-items:center;flex-wrap:wrap;gap:4px 8px;padding:5px 40px 5px 34px;
  text-decoration:none;color:inherit;
  &:hover{background:#F8FAFC;}
`;
/* 글을 고치는 동안의 묶음 안 항목 — 링크가 아니다 */
const BundleItemPlain = styled.div`
  position:relative;display:flex;align-items:center;flex-wrap:wrap;gap:4px 8px;padding:5px 40px 5px 34px;
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

/* 수동 히스토리 추가 (2026-09-13) — 목록 위 한 줄. 접혀 있다가 누르면 펴진다 */
const AddBar = styled.div`margin-bottom: 14px;`;
const AddForm = styled.div`
  display: flex; flex-direction: column; gap: 8px;
  padding: 12px; background: #F8FAFC; border: 1px solid #E2E8F0; border-radius: 10px;
`;
const AddRow = styled.div`
  display: grid; grid-template-columns: 160px 1fr; gap: 8px;
  @media (max-width: 640px) { grid-template-columns: 1fr; }
`;
const AddInput = styled.input`
  height: 40px; padding: 0 10px; border: 1px solid #E2E8F0; border-radius: 8px;
  font-size: 0.8125rem; color: #0F172A; font-family: inherit; width: 100%;
  &:focus { outline: none; border-color: #5EEAD4; }
`;
const AddArea = styled.textarea`
  padding: 8px 10px; border: 1px solid #E2E8F0; border-radius: 8px; resize: vertical;
  font-size: 0.8125rem; color: #0F172A; font-family: inherit; line-height: 1.5; width: 100%;
  &:focus { outline: none; border-color: #5EEAD4; }
`;
const AddActions = styled.div`display: flex; justify-content: flex-end; gap: 8px;`;
const AddErr = styled.div`font-size: 0.75rem; color: #B91C1C;`;
const AddHint = styled.div`font-size: 0.6875rem; color: #94A3B8;`;
const AddCheck = styled.label`
  display: inline-flex; align-items: center; gap: 6px; font-size: 0.75rem; color: #475569; cursor: pointer;
  align-self: flex-start;
  input { width: 16px; height: 16px; accent-color: #14B8A6; cursor: pointer; }
`;
/* 주요 이슈 행의 «고객 공개» — 줄 오른쪽 끝(margin-left:auto) */
/* 사람이 적은 항목의 본문 앞부분 */
const ManualPreview = styled.div`
  margin-top:3px;font-size:0.78125rem;color:#475569;line-height:1.5;white-space:pre-wrap;word-break:break-word;
`;
/* 사람이 적은 항목 [고치기] — 줄 아래 메타 줄의 작은 글자 단추 */
const ManualEditBtn = styled.button`
  margin-left: 6px; padding: 0 10px; height: 32px; border: 1px solid #E2E8F0; border-radius: 6px;
  background: #fff; color: #475569; font-size: 0.6875rem; font-family: inherit; cursor: pointer;
  &:hover { border-color: #5EEAD4; color: #0F766E; }
  &:focus-visible { outline: 2px solid #0D9488; outline-offset: 1px; }
  @media (max-width: 640px) { height: 40px; }
`;
const VisibleSlot = styled.span`margin-left: auto; display: inline-flex; align-items: center; gap: 6px;`;
const VisibleLabel = styled.span`font-size: 0.6875rem; color: #64748B;`;
