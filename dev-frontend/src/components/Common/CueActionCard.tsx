// Cue 확인 카드 — **공통 한 장** (2026-10-12, 설계 docs/CUE_REGISTRY_FOLD_DESIGN.md B).
//   서버가 카탈로그 preview 로 만든 card 데이터({fields, targets, changes, notes, items})를 그린다 — 도구별 손그림 없음.
//   사람이 값을 고친 뒤 [실행] 을 누르면 POST /api/cue/execute-action → 카탈로그 runTool(행동 계층·감사·계량 각 1회).
//   필드 라벨·도구 이름·안내는 i18n 키(qhelper.field.* / qhelper.tool.* / qhelper.note.*) — 서버는 키만 보낸다.
import React, { useEffect, useMemo, useState } from 'react';
import styled from 'styled-components';
import { useTranslation } from 'react-i18next';
import { apiFetch } from '../../contexts/AuthContext';
import ActionButton from './ActionButton';
import SingleDateField from './SingleDateField';
import PlanQSelect, { type PlanQSelectOption } from './PlanQSelect';
import { formatDayTime, formatDay } from '../../utils/dateFormat';
import { useTimezones } from '../../hooks/useTimezones';
import { wallStringsToIso, toWall } from '../../pages/QCalendar/calTz';

export type CueToolName = string;

interface CardOption { value: number | string; label: string }
interface CardField {
  key: string; label_key: string; type: string; value: unknown; editable: boolean;
  options?: Array<CardOption | string>; display?: string | null;
}
interface CardTarget { type: string; id: number; title: string | null }
interface CardChange { key: string; label_key: string; before: unknown; after: unknown }
interface CardNote { key: string; count?: number; names?: string }
interface MoveItem {
  event_id: number; title: string; all_day: boolean; date: string; start_time?: string;
  from_start: string; from_end: string; to_start: string; to_end: string; blocked?: string;
}
export interface CueCard {
  summary_key: string; fields: CardField[]; targets: CardTarget[]; changes: CardChange[]; notes: CardNote[];
  items?: MoveItem[]; timezone?: string;
}
export interface CueProposal {
  tool: CueToolName;
  params: Record<string, unknown>;
  card?: CueCard;
}
export interface CueActionResult {
  tool: string;
  entity_type: string | null;
  entity_id: number | null;
  open_url?: string | null;
  replayed?: boolean;
  /** #237 — "완료로 추가" 를 요청했지만 완료까지는 못 간 사유 (업무 자체는 생성됨) */
  completed_skipped?: string;
  meet_warning?: string;
  /** 만든·붙인 화상회의 링크 (create_event·add_meeting_to_event·update_event) */
  meeting_url?: string | null;
  notified?: number;
  /** create_task 컨펌자 — 넣은 수 · 못 넣은 수(업무는 만들어졌다) */
  reviewers_added?: number;
  reviewers_failed?: number;
  /** 일정 옮기기 — 옮긴 일정 id 들과 못 옮긴 것(사유 코드) */
  moved_ids?: number[];
  failed?: { event_id: number; code: string }[];
}

interface Props {
  proposal: CueProposal;
  businessId: number | null;
  onExecuted: (r: CueActionResult) => void;   // 성공 → 부모가 카드를 ✓ 요약으로 교체
  onDismiss: () => void;                       // 취소 → 카드 제거(요약 없음)
}

const CueActionCard: React.FC<Props> = ({ proposal, onExecuted, onDismiss }) => {
  const { t } = useTranslation('common');
  const { t: tErr } = useTranslation('errors');
  const { workspaceTz } = useTimezones();
  const card: CueCard = proposal.card || { summary_key: `qhelper.tool.${proposal.tool}`, fields: [], targets: [], changes: [], notes: [] };
  const [params, setParams] = useState<Record<string, unknown>>({ ...proposal.params });
  const [items, setItems] = useState<MoveItem[]>(card.items || []);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => { setParams({ ...proposal.params }); setItems(card.items || []); }, [proposal]); // eslint-disable-line react-hooks/exhaustive-deps

  const set = (k: string, v: unknown) => setParams((p) => {
    const n = { ...p };
    if (v === undefined || v === '' || (Array.isArray(v) && !v.length && !(k in proposal.params))) delete n[k]; else n[k] = v;
    return n;
  });

  const mapError = (code?: string): string => {
    const c = String(code || '');
    const known: Record<string, string> = {
      only_creator_or_owner: t('qhelper.action.errEventOwner', '만든 사람(또는 관리자)만 바꿀 수 있는 일정이에요.'),
      recurring_use_calendar: t('qhelper.action.errRecurring', '반복 일정은 캘린더에서 직접 옮겨 주세요.'),
      booking_use_actions: t('qhelper.action.errBooking', '상담 예약은 «다른 시간 제안» 으로 바꿔 주세요.'),
      event_not_found: t('qhelper.action.errEvent', '그 일정을 찾을 수 없어요.'),
      only_assignee: t('qhelper.action.errOnlyAssignee', '이 업무의 담당자만 할 수 있어요.'),
      no_reviewers_add_first: t('qhelper.action.errNoReviewers', '먼저 컨펌자를 지정해야 검토 요청을 보낼 수 있어요.'),
      not_ready_for_complete: t('qhelper.action.errNeedsConfirm', '컨펌자 승인을 거쳐야 완료할 수 있어요.'),
      task_closed: t('qhelper.action.errClosed', '이미 종료된 업무예요.'),
      unknown_tags: t('qhelper.action.errTags', '워크스페이스에 없는 태그예요. 태그는 Q task 에서 먼저 만들어 주세요.'),
      gcal_not_connected: t('qhelper.action.errGcal', '구글 캘린더가 연결되어 있지 않아요. 설정 > 파일·외부 연동에서 연결해 주세요.'),
      gcal_scope_missing: t('qhelper.action.errGcal', '구글 캘린더가 연결되어 있지 않아요. 설정 > 파일·외부 연동에서 연결해 주세요.'),
      cannot_create_meeting_for_private_event: t('qhelper.action.errMeetPrivate', '나만 보기 일정에는 화상회의를 만들 수 없어요. 팀 공개로 바꿔 주세요.'),
      invalid_input: t('qhelper.action.errInput', '입력값을 확인해 주세요.'),
    };
    if (known[c]) return known[c];
    if (/^menu_forbidden|^forbidden/.test(c)) return t('qhelper.action.errMenu', '이 작업에 필요한 권한이 없어요.');
    if (/^cannot_assign/.test(c)) return t('qhelper.action.errAssign', '그 담당자에게는 배정할 수 없어요.');
    return tErr(c, { defaultValue: t('qhelper.action.errGeneric', '실행하지 못했어요. 잠시 후 다시 시도해주세요.') }) as string;
  };

  const movable = items.filter((x) => !x.blocked);
  const isMove = proposal.tool === 'reschedule_events';

  const execute = async () => {
    if (submitting) return;               // 중복 제출 가드(서버도 같은 인자 10분 안 재실행을 막는다)
    setSubmitting(true); setError(null);
    try {
      const body = isMove
        ? { tool: proposal.tool, params: { moves: movable.map((x) => ({ event_id: x.event_id, date: x.date, ...(x.start_time ? { start_time: x.start_time } : {}) })) } }
        : { tool: proposal.tool, params };
      const res = await apiFetch('/api/cue/execute-action', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
      const j = await res.json();
      if (!res.ok || !j.success) {
        if (res.status === 422) { setError(t('qhelper.action.errQuota', 'Cue 사용 한도를 초과했어요.')); return; }
        setError(mapError(j.code || j.message)); return;
      }
      onExecuted(j.data as CueActionResult);
    } catch {
      setError(t('qhelper.action.errGeneric', '실행하지 못했어요. 잠시 후 다시 시도해주세요.'));
    } finally {
      setSubmitting(false);
    }
  };

  const toolLabel = t(`qhelper.tool.${proposal.tool}`, { defaultValue: proposal.tool }) as string;
  const doLabel = isMove
    ? t('qhelper.action.doMove', { count: movable.length, defaultValue: `일정 ${movable.length}건 옮기기` })
    : t(`qhelper.toolDo.${proposal.tool}`, { defaultValue: t('qhelper.action.doGeneric', '실행') as string });
  const titleField = card.fields.find((f) => f.key === 'title' || f.key === 'name');
  const canSubmit = isMove ? movable.length > 0 : !(titleField && titleField.editable && !String(params[titleField.key] ?? '').trim());

  // ── 값 모양 ────────────────────────────────
  const fmtValue = (key: string, v: unknown): string => {
    if (v === null || v === undefined || v === '') return '—';
    if (Array.isArray(v)) return v.length ? v.join(', ') : '—';
    const s = String(v);
    if (/_at$/.test(key) && !/^\d{4}-\d{2}-\d{2}$/.test(s)) return formatDayTime(s, { tz: workspaceTz, weekday: true });
    if (/(^|_)date$/.test(key) || /^\d{4}-\d{2}-\d{2}$/.test(s)) return formatDay(s.slice(0, 10), { weekday: true });
    if (typeof v === 'boolean') return v ? t('qhelper.action.yes', '예') as string : t('qhelper.action.no', '아니요') as string;
    return t(`qhelper.opt.${s}`, { defaultValue: s }) as string;
  };
  const optLabel = (o: CardOption | string): PlanQSelectOption => (typeof o === 'string'
    ? { value: o, label: t(`qhelper.opt.${o}`, { defaultValue: o }) as string }
    : { value: o.value, label: o.label });

  const renderField = (f: CardField, noLabel = false) => {
    const label = noLabel ? '' : t(f.label_key, { defaultValue: f.key }) as string;
    const v = params[f.key];
    if (!f.editable || f.type === 'readonly') {
      return (
        <Field as="div" key={f.key}>
          {label && <Lbl>{label}</Lbl>}
          <ReadVal>{f.display || fmtValue(f.key, v)}</ReadVal>
        </Field>
      );
    }
    switch (f.type) {
      case 'textarea':
        return (
          <Field key={f.key}>
            {label && <Lbl>{label}</Lbl>}
            <Textarea value={String(v ?? '')} onChange={(e) => set(f.key, e.target.value)} rows={3} maxLength={20000} />
          </Field>
        );
      case 'date':
        return (
          <Field as="div" key={f.key}>
            {label && <Lbl>{label}</Lbl>}
            <SingleDateField value={String(v || '')} onChange={(d) => set(f.key, d || undefined)} size="sm" />
          </Field>
        );
      case 'datetime': {
        // 종일 일정이면 날짜만 — 서버는 날짜 문자열을 그 날로 읽는다
        if (params.all_day === true || /^\d{4}-\d{2}-\d{2}$/.test(String(v || ''))) {
          return (
            <Field as="div" key={f.key}>
              {label && <Lbl>{label}</Lbl>}
              <SingleDateField value={String(v || '').slice(0, 10)} onChange={(d) => set(f.key, d || undefined)} size="sm" />
            </Field>
          );
        }
        const w = isoToWall(String(v || ''), workspaceTz);
        if (!w) return <Field as="div" key={f.key}>{label && <Lbl>{label}</Lbl>}<ReadVal>{fmtValue(f.key, v)}</ReadVal></Field>;
        const opts = timeOptions([w.time]);
        return (
          <Field as="div" key={f.key}>
            {label && <Lbl>{label}</Lbl>}
            <DateTimeRow>
              <SingleDateField value={w.date} onChange={(d) => { if (d) set(f.key, wallStringsToIso(d, w.time, workspaceTz)); }} size="sm" />
              <PlanQSelect size="sm" options={opts} value={{ value: w.time, label: w.time }}
                onChange={(o) => { if (o) set(f.key, wallStringsToIso(w.date, String((o as PlanQSelectOption).value), workspaceTz)); }} />
            </DateTimeRow>
          </Field>
        );
      }
      case 'number':
        return (
          <Field key={f.key}>
            {label && <Lbl>{label}</Lbl>}
            <Input type="number" min={0} value={v === undefined || v === null ? '' : String(v)}
              onChange={(e) => set(f.key, e.target.value === '' ? undefined : Number(e.target.value))} />
          </Field>
        );
      case 'bool':
        return (
          <CheckRow key={f.key}>
            <input type="checkbox" checked={!!v} onChange={(e) => set(f.key, e.target.checked)} />
            <span>{label}</span>
          </CheckRow>
        );
      case 'select': {
        const opts = (f.options || []).map(optLabel);
        const cur = opts.find((o) => String(o.value) === String(v ?? '')) || null;
        return (
          <Field as="div" key={f.key}>
            {label && <Lbl>{label}</Lbl>}
            <PlanQSelect size="sm" options={opts} value={cur} onChange={(o) => set(f.key, (o as PlanQSelectOption | null)?.value ?? undefined)} />
          </Field>
        );
      }
      case 'member': {
        const opts: PlanQSelectOption[] = [{ value: '', label: t('qhelper.action.assigneeDefault', '기본(비워두기)') as string }, ...(f.options || []).map(optLabel)];
        const cur = opts.find((o) => String(o.value) === String(v ?? '')) || opts[0];
        return (
          <Field as="div" key={f.key}>
            {label && <Lbl>{label}</Lbl>}
            <PlanQSelect size="sm" options={opts} value={cur} onChange={(o) => { const x = (o as PlanQSelectOption | null)?.value; set(f.key, x ? Number(x) : undefined); }} />
          </Field>
        );
      }
      case 'members':
      case 'clients': {
        const all = (f.options || []).map(optLabel);
        const chosen = (Array.isArray(v) ? v : []).map(Number);
        const labelOf = (id: number) => all.find((o) => Number(o.value) === id)?.label || `#${id}`;
        const addable = f.type === 'members' ? all.filter((o) => !chosen.includes(Number(o.value))) : [];
        return (
          <Field as="div" key={f.key}>
            {label && <Lbl>{label}</Lbl>}
            <Chips>
              {chosen.map((id) => (
                <Chip key={id}>
                  {labelOf(id)}
                  <ChipX type="button" aria-label={t('qhelper.action.remove', '빼기') as string} onClick={() => set(f.key, chosen.filter((x) => x !== id))}>×</ChipX>
                </Chip>
              ))}
              {!chosen.length && <ReadVal>—</ReadVal>}
            </Chips>
            {addable.length > 0 && (
              <PlanQSelect size="sm" options={addable} value={null} placeholder={t('qhelper.action.addPerson', '＋ 사람 추가') as string}
                onChange={(o) => { const x = (o as PlanQSelectOption | null)?.value; if (x) set(f.key, [...chosen, Number(x)]); }} />
            )}
          </Field>
        );
      }
      case 'chips': {
        const arr = Array.isArray(v) ? v.map(String) : [];
        return (
          <Field key={f.key}>
            {label && <Lbl>{label}</Lbl>}
            <Input value={arr.join(', ')} onChange={(e) => set(f.key, e.target.value.split(',').map((x) => x.trim()).filter(Boolean))}
              placeholder={t('qhelper.action.commaHint', '쉼표로 구분') as string} />
          </Field>
        );
      }
      default:
        return (
          <Field key={f.key}>
            {label && <Lbl>{label}</Lbl>}
            <Input value={String(v ?? '')} onChange={(e) => set(f.key, e.target.value)} maxLength={300} />
          </Field>
        );
    }
  };

  // ── 일정 옮기기 줄 ──────────────────────────
  const sharedDate = items.length && items.every((x) => x.date === items[0].date) ? items[0].date : null;
  const setMoveDate = (date: string) => setItems((list) => list.map((x) => {
    if (x.all_day) {
      const delta = Date.parse(`${date}T00:00:00Z`) - Date.parse(`${x.to_start.slice(0, 10)}T00:00:00Z`);
      return { ...x, date, to_start: new Date(Date.parse(x.to_start) + delta).toISOString(), to_end: new Date(Date.parse(x.to_end) + delta).toISOString() };
    }
    const w = isoToWall(x.to_start, workspaceTz);
    if (!w) return x;
    const ns = wallStringsToIso(date, w.time, workspaceTz);
    const dur = Date.parse(x.to_end) - Date.parse(x.to_start);
    return { ...x, date, to_start: ns, to_end: new Date(Date.parse(ns) + dur).toISOString() };
  }));
  const whenOf = (x: MoveItem, which: 'from' | 'to') => {
    const s0 = which === 'from' ? x.from_start : x.to_start;
    return x.all_day ? formatDay(s0.slice(0, 10), { weekday: true }) : formatDayTime(s0, { tz: workspaceTz, weekday: true });
  };

  const notes = useMemo(() => card.notes.map((n) => t(`qhelper.note.${n.key}`, { count: n.count ?? 0, names: n.names || '', defaultValue: '' }) as string).filter(Boolean), [card.notes, t]);

  return (
    <Card role="group" aria-label={toolLabel} data-testid="cue-action-card">
      <Hdr>✦ {t('qhelper.action.proposeBy', 'Cue 제안')} · {toolLabel}</Hdr>

      {card.targets.map((tg) => (
        <Field as="div" key={`${tg.type}-${tg.id}`}>
          <Lbl>{t(`qhelper.target.${tg.type}`, { defaultValue: tg.type })}</Lbl>
          <ReadVal>{tg.title || `#${tg.id}`}</ReadVal>
        </Field>
      ))}

      {card.changes.length > 0 && (
        <ChangeList>
          {card.changes.map((c) => {
            // 바뀌는 칸은 «지금 값 →» 옆에 고칠 수 있는 칸을 바로 둔다(같은 칸이 두 번 보이지 않게)
            const f = card.fields.find((x) => x.key === c.key && x.editable && x.type !== 'readonly');
            return (
              <ChangeRow key={c.key}>
                <Lbl>{t(c.label_key, { defaultValue: c.key })}</Lbl>
                {f ? (
                  <>
                    <Before>{t('qhelper.action.now', '지금')}: {fmtValue(c.key, c.before)}</Before>
                    {renderField(f, true)}
                  </>
                ) : (
                  <span>{fmtValue(c.key, c.before)} <span aria-hidden="true">→</span> <strong>{fmtValue(c.key, params[c.key] !== undefined ? params[c.key] : c.after)}</strong></span>
                )}
              </ChangeRow>
            );
          })}
        </ChangeList>
      )}

      {isMove && (
        <>
          {sharedDate && (
            <Field as="div">
              <Lbl>{t('qhelper.action.moveTo', '옮길 날짜')}</Lbl>
              <SingleDateField value={sharedDate} onChange={(d) => { if (d) setMoveDate(d); }} size="sm" />
            </Field>
          )}
          <MoveList>
            {items.map((x) => (
              <MoveRow key={x.event_id} $blocked={!!x.blocked} data-testid="cue-move-row">
                <MoveMain>
                  <MoveTitle>{x.title}</MoveTitle>
                  <MoveWhen>{whenOf(x, 'from')} <span aria-hidden="true">→</span> <strong>{whenOf(x, 'to')}</strong></MoveWhen>
                  {x.blocked && <MoveWhy>{mapError(x.blocked)}</MoveWhy>}
                </MoveMain>
                <RemoveBtn type="button" onClick={() => setItems((l) => l.filter((y) => y.event_id !== x.event_id))}
                  aria-label={t('qhelper.action.moveRemove', '이 일정 빼기') as string} title={t('qhelper.action.moveRemove', '이 일정 빼기') as string}>×</RemoveBtn>
              </MoveRow>
            ))}
          </MoveList>
        </>
      )}

      {card.fields.filter((f) => !card.changes.some((c) => c.key === f.key)).map((f) => renderField(f))}

      {notes.map((n) => <Hint key={n}>{n}</Hint>)}
      {error && <ErrLine>! {error}</ErrLine>}

      <Actions>
        <ActionButton tone="secondary" size="sm" onClick={onDismiss} disabled={submitting}>
          {t('qhelper.action.cancel', '취소')}
        </ActionButton>
        <ActionButton tone="primary" size="sm" onClick={execute} loading={submitting} disabled={!canSubmit} data-testid="cue-action-execute">
          {doLabel}
        </ActionButton>
      </Actions>
    </Card>
  );
};

// 시각 문자열(ISO) → 그 시간대의 벽시계 날짜·시각 ('YYYY-MM-DD', 'HH:mm')
function isoToWall(iso: string, tz: string): { date: string; time: string } | null {
  if (!iso || isNaN(new Date(iso).getTime())) return null;
  const w = toWall(iso, tz);   // 캘린더와 같은 변환(calTz)
  const p2 = (n: number) => String(n).padStart(2, '0');
  return { date: `${w.getFullYear()}-${p2(w.getMonth() + 1)}-${p2(w.getDate())}`, time: `${p2(w.getHours())}:${p2(w.getMinutes())}` };
}

// 30분 단위 + 지금 값(말로 넣은 16:15 같은 값도 그대로 고를 수 있게)
function timeOptions(extra: string[]): PlanQSelectOption[] {
  const s = new Set<string>();
  for (let h = 0; h < 24; h += 1) for (const m of ['00', '30']) s.add(`${String(h).padStart(2, '0')}:${m}`);
  extra.forEach((x) => x && s.add(x));
  return [...s].sort().map((v) => ({ value: v, label: v }));
}

const Card = styled.div`
  margin-top: 8px; border: 1px solid #e2e8f0; border-radius: 12px;
  background: #f8fafc; padding: 12px; max-width: 100%;
  display: flex; flex-direction: column; gap: 8px;
`;
const Hdr = styled.div`font-size: 0.75rem; font-weight: 700; color: #0f766e; letter-spacing: -0.2px;`;
const Field = styled.label`display: flex; flex-direction: column; gap: 3px; min-width: 0;`;
const Lbl = styled.span`font-size: 0.6875rem; color: #64748b; font-weight: 600;`;
const Input = styled.input`
  border: 1px solid #cbd5e1; border-radius: 8px; padding: 7px 9px; font-size: 0.8125rem; min-height: 36px;
  background: #fff; width: 100%; &:focus { outline: none; border-color: #0f766e; }
`;
const Textarea = styled.textarea`
  border: 1px solid #cbd5e1; border-radius: 8px; padding: 7px 9px; font-size: 0.8125rem;
  background: #fff; width: 100%; resize: vertical; &:focus { outline: none; border-color: #0f766e; }
`;
const ReadVal = styled.div`font-size: 0.8125rem; color: #1e293b; padding: 4px 2px; overflow-wrap: anywhere;`;
const Hint = styled.div`font-size: 0.6875rem; color: #b45309; background: #fffbeb; border-radius: 6px; padding: 5px 8px;`;
const CheckRow = styled.label`
  display: flex; align-items: center; gap: 7px; cursor: pointer; min-height: 32px;
  font-size: 0.75rem; color: #334155; padding: 2px 0;
  input { width: 15px; height: 15px; accent-color: #0f766e; cursor: pointer; margin: 0; }
`;
const DateTimeRow = styled.div`
  display: flex; align-items: center; gap: 6px;
  & > * { flex: 1; min-width: 0; }
`;
const ChangeList = styled.div`display: flex; flex-direction: column; gap: 4px; background: #fff; border: 1px solid #e2e8f0; border-radius: 8px; padding: 7px 9px;`;
const ChangeRow = styled.div`
  display: flex; flex-direction: column; gap: 1px; font-size: 0.75rem; color: #475569;
  strong { color: #0f766e; font-weight: 600; }
`;
const Before = styled.span`font-size: 0.75rem; color: #64748b;`;
const Chips = styled.div`display: flex; flex-wrap: wrap; gap: 4px;`;
const Chip = styled.span`
  display: inline-flex; align-items: center; gap: 2px; background: #fff; border: 1px solid #cbd5e1;
  border-radius: 999px; padding: 2px 2px 2px 9px; font-size: 0.75rem; color: #1e293b;
`;
const ChipX = styled.button`
  border: none; background: none; cursor: pointer; color: #94a3b8; width: 32px; height: 32px; border-radius: 999px;
  font-size: 1rem; line-height: 1; &:hover { color: #475569; background: #f1f5f9; }
`;
const MoveList = styled.div`display: flex; flex-direction: column; gap: 6px;`;
const MoveRow = styled.div<{ $blocked: boolean }>`
  display: flex; align-items: flex-start; gap: 6px; background: #fff;
  border: 1px solid #e2e8f0; border-radius: 8px; padding: 7px 4px 7px 9px;
  opacity: ${(p) => (p.$blocked ? 0.6 : 1)};
`;
const MoveMain = styled.div`flex: 1; min-width: 0; display: flex; flex-direction: column; gap: 2px;`;
const MoveTitle = styled.div`font-size: 0.8125rem; font-weight: 600; color: #1e293b; overflow-wrap: anywhere;`;
const MoveWhen = styled.div`font-size: 0.75rem; color: #475569; strong { color: #0f766e; font-weight: 600; white-space: nowrap; }`;
const MoveWhy = styled.div`font-size: 0.6875rem; color: #b45309;`;
const RemoveBtn = styled.button`
  flex-shrink: 0; width: 36px; height: 36px; border: none; background: none; cursor: pointer;
  color: #94a3b8; font-size: 1.125rem; line-height: 1; border-radius: 6px;
  &:hover { color: #475569; background: #f1f5f9; }
`;
const ErrLine = styled.div`font-size: 0.75rem; color: #dc2626; font-weight: 600;`;
const Actions = styled.div`display: flex; justify-content: flex-end; gap: 8px; margin-top: 2px;`;

export default CueActionCard;
