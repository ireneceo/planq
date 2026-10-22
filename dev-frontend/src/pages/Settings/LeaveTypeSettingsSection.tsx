// 설정 › 근태 관리 — 맨 위 「휴가 설정」 (2026-10-22). 설계 docs/LEAVE_TYPES_DESIGN.md §6.1
//
// 회사가 휴가 종류를 직접 등록·관리한다 — 이름 · 유급/무급 · 연간 기본 일수 · 사용 여부.
//   규칙(이름 중복·유급/무급 잠금·시스템 종류·마지막 활성)은 전부 서버 services/leaveTypes 가 판정하고,
//   이 화면은 그 결과(in_use · can_edit)를 보여주고 거절 이유를 말할 뿐이다.
// ★ 유급/무급은 **한 번 쓰인 뒤 바꿀 수 없다** — 바꾸면 이미 쓴 휴가의 잔여가 흔들린다. 새 종류를 만들고 옛것을 끈다.
// ★ 기본 종류(연차·병가·경조사·기타·무급휴가)는 이름을 비우면 기본 이름으로 돌아간다. 지우지 못하고 끄기만 한다.
// ★ «연간 기본 일수» 는 연간 부여 폼에 미리 채워지는 값이다 — 자동으로 부여하지 않는다.
import { useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import styled from 'styled-components';
import { apiFetch } from '../../contexts/AuthContext';
import AutoSaveField from '../../components/Common/AutoSaveField';
import ActionButton from '../../components/Common/ActionButton';
import { Switch, SwitchKnob } from '../../components/Common/switchShell';
import { useLeaveTypes, labelOf, type LeaveTypeRow } from '../Attendance/leaveTypes';
import { Section, Head, Title, Hint, AddRow, NameInput, ErrText, Empty, List, Row, Badge, DelBtn } from './attendanceSectionShell';

type Draft = { name: string; days: string; pay: 'paid' | 'unpaid'; active: boolean };
const toDraft = (x: LeaveTypeRow): Draft => ({
  name: x.name || '', days: x.default_days === null ? '' : String(x.default_days), pay: x.pay, active: x.is_active,
});

export default function LeaveTypeSettingsSection({ businessId }: { businessId: number }) {
  const { t } = useTranslation('settings');
  const { types, canEdit, loaded, error, reload } = useLeaveTypes(businessId, { includeInactive: true });
  const [drafts, setDrafts] = useState<Record<number, Draft>>({});
  const draftsRef = useRef(drafts);
  draftsRef.current = drafts;
  const [rowErr, setRowErr] = useState<Record<number, string>>({});
  // 서버 값이 바뀌면(다른 사람이 고침·저장 후 재조회) 화면 값을 맞춘다
  useEffect(() => {
    setDrafts(Object.fromEntries(types.map((x) => [x.id, toDraft(x)])));
  }, [types]);

  const stage = (id: number, patch: Partial<Draft>) =>
    setDrafts((d) => ({ ...d, [id]: { ...(d[id] || toDraft(types.find((x) => x.id === id)!)), ...patch } }));

  const errText = (code: string) => t(`leaveTypes.err.${code}`, { defaultValue: t('leaveTypes.err.generic', '저장하지 못했습니다. 다시 시도하세요.') as string }) as string;

  // 저장 — 실패는 던진다(AutoSaveField 가 ! 뱃지를 띄운다). 거절 이유는 그 행 아래에 한 줄로.
  const persist = async (id: number, body: Record<string, unknown>) => {
    const r = await apiFetch(`/api/businesses/${businessId}/leave-types/${id}`, {
      method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body),
    });
    const j = await r.json().catch(() => null);
    if (!r.ok || !j?.success) {
      setRowErr((e) => ({ ...e, [id]: errText(j?.message || 'generic') }));
      await reload();   // 화면 값을 서버 값으로 되돌린다
      throw new Error(j?.message || 'save_failed');
    }
    setRowErr((e) => { const n = { ...e }; delete n[id]; return n; });
    await reload();
  };
  const persistName = (id: number) => persist(id, { name: draftsRef.current[id]?.name ?? '' });
  const persistDays = (id: number) => {
    const v = draftsRef.current[id]?.days ?? '';
    return persist(id, { default_days: v === '' ? null : Number(v) });
  };
  const persistPay = (id: number) => persist(id, { pay: draftsRef.current[id]?.pay });
  const persistActive = (id: number) => persist(id, { is_active: draftsRef.current[id]?.active });

  // ─── 추가 ───
  const [newName, setNewName] = useState('');
  const [newPay, setNewPay] = useState<'paid' | 'unpaid'>('paid');
  const [newDays, setNewDays] = useState('');
  const [addErr, setAddErr] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const submitAdd = async () => {
    if (submitting || !newName.trim()) return;
    setSubmitting(true); setAddErr(null);
    try {
      const r = await apiFetch(`/api/businesses/${businessId}/leave-types`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: newName.trim(), pay: newPay, default_days: newPay === 'paid' && newDays !== '' ? Number(newDays) : null }),
      });
      const j = await r.json().catch(() => null);
      if (!r.ok || !j?.success) { setAddErr(errText(j?.message || 'generic')); return; }
      setNewName(''); setNewDays(''); setNewPay('paid');
      await reload();
    } finally { setSubmitting(false); }
  };
  const remove = async (id: number) => {
    const r = await apiFetch(`/api/businesses/${businessId}/leave-types/${id}`, { method: 'DELETE' });
    const j = await r.json().catch(() => null);
    if (!r.ok || !j?.success) { setRowErr((e) => ({ ...e, [id]: errText(j?.message || 'generic') })); return; }
    await reload();
  };

  if (error && !loaded) return null;
  if (!loaded) return null;
  if (error && !types.length) return <Section><Hint>{t('leaveTypes.loadError', '휴가 종류를 불러오지 못했습니다.') as string}</Hint></Section>;

  return (
    <Section data-testid="leave-types-section">
      <Head><Title>{t('leaveTypes.title', '휴가 설정') as string}</Title></Head>
      <Hint>{t('leaveTypes.desc', '회사에서 쓰는 휴가 종류를 정합니다. 유급 종류는 연간 부여한 일수에서 빠지고, 무급 종류는 남은 휴가를 깎지 않습니다(급여의 무급휴가 일할에 들어갑니다). 연간 기본 일수는 아래 «연간 부여» 에 미리 채워지는 값입니다.') as string}</Hint>
      {!canEdit && <Hint>{t('leaveTypes.readOnly', '워크스페이스 관리자만 변경할 수 있습니다.') as string}</Hint>}

      {types.length === 0 ? <Empty>{t('leaveTypes.empty', '휴가 종류가 없습니다.') as string}</Empty> : (
        <>
          <ColHead aria-hidden>
            <span>{t('leaveTypes.col.name', '이름') as string}</span>
            <span>{t('leaveTypes.col.pay', '유급') as string}</span>
            <span>{t('leaveTypes.col.days', '연간 기본 일수') as string}</span>
            <span>{t('leaveTypes.col.active', '사용') as string}</span>
            <span />
          </ColHead>
          <List>
            {types.map((x) => {
              const d = drafts[x.id] || toDraft(x);
              const payLocked = !!x.in_use;
              return (
                <TypeRow key={x.id} data-testid={`leave-type-row-${x.id}`} $muted={!x.is_active}>
                  <NameSlot>
                    <AutoSaveField key={`lt-name-${x.id}`} type="input" onSave={() => persistName(x.id)}>
                      <NameInput
                        value={d.name} maxLength={50} disabled={!canEdit}
                        data-testid={`leave-type-name-${x.id}`}
                        aria-label={t('leaveTypes.col.name', '이름') as string}
                        placeholder={x.code ? labelOf({ code: x.code, name: null }, t) : (t('leaveTypes.namePh', '이름') as string)}
                        onChange={(e) => stage(x.id, { name: e.target.value })}
                      />
                    </AutoSaveField>
                    {x.code && <Badge $accent={false}>{t('leaveTypes.system', '기본') as string}</Badge>}
                  </NameSlot>
                  <Cell title={payLocked ? t('leaveTypes.payLocked', '이미 쓰인 종류는 유급/무급을 바꿀 수 없어요') as string : undefined}>
                    <AutoSaveField key={`lt-pay-${x.id}`} type="toggle" onSave={() => persistPay(x.id)}>
                      <Switch
                        type="button" role="switch" aria-checked={d.pay === 'paid'} $on={d.pay === 'paid'}
                        aria-label={t('leaveTypes.col.pay', '유급') as string}
                        data-testid={`leave-type-pay-${x.id}`}
                        disabled={!canEdit || payLocked}
                        onClick={() => stage(x.id, { pay: d.pay === 'paid' ? 'unpaid' : 'paid', ...(d.pay === 'paid' ? { days: '' } : {}) })}
                      >
                        <SwitchKnob $on={d.pay === 'paid'} />
                      </Switch>
                    </AutoSaveField>
                    <PayText>{d.pay === 'paid' ? t('leaveTypes.paid', '유급') as string : t('leaveTypes.unpaid', '무급') as string}</PayText>
                  </Cell>
                  <Cell>
                    {d.pay === 'paid' ? (
                      <AutoSaveField key={`lt-days-${x.id}`} type="input" onSave={() => persistDays(x.id)}>
                        <DaysInput
                          type="number" step="0.5" min="0.5" max="366" inputMode="decimal"
                          value={d.days} disabled={!canEdit}
                          data-testid={`leave-type-days-${x.id}`}
                          aria-label={t('leaveTypes.col.days', '연간 기본 일수') as string}
                          placeholder="—"
                          onChange={(e) => stage(x.id, { days: e.target.value })}
                        />
                      </AutoSaveField>
                    ) : <Dash>—</Dash>}
                  </Cell>
                  <Cell>
                    <AutoSaveField key={`lt-active-${x.id}`} type="toggle" onSave={() => persistActive(x.id)}>
                      <Switch
                        type="button" role="switch" aria-checked={d.active} $on={d.active}
                        aria-label={t('leaveTypes.col.active', '사용') as string}
                        data-testid={`leave-type-active-${x.id}`}
                        disabled={!canEdit}
                        onClick={() => stage(x.id, { active: !d.active })}
                      >
                        <SwitchKnob $on={d.active} />
                      </Switch>
                    </AutoSaveField>
                  </Cell>
                  <Cell>
                    {canEdit && !x.code && !x.in_use && (
                      // autosave-exempt: 삭제는 액션이다
                      <DelBtn type="button" data-testid={`leave-type-delete-${x.id}`}
                        aria-label={t('leaveTypes.delete', '삭제') as string} title={t('leaveTypes.delete', '삭제') as string}
                        onClick={() => void remove(x.id)}>
                        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
                      </DelBtn>
                    )}
                  </Cell>
                  {rowErr[x.id] && <ErrText role="alert">{rowErr[x.id]}</ErrText>}
                </TypeRow>
              );
            })}
          </List>
        </>
      )}

      {canEdit && (
        <AddRow data-testid="leave-type-add">
          <NameInput
            value={newName} maxLength={50}
            placeholder={t('leaveTypes.addNamePh', '새 종류 이름 (예: 리프레시 휴가)') as string}
            aria-label={t('leaveTypes.addNamePh', '새 종류 이름 (예: 리프레시 휴가)') as string}
            onChange={(e) => setNewName(e.target.value)}
            onKeyDown={(e) => { if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) void submitAdd(); }}
          />
          <PaySeg role="radiogroup" aria-label={t('leaveTypes.col.pay', '유급') as string}>
            {(['paid', 'unpaid'] as const).map((p) => (
              // autosave-exempt: 추가 폼의 선택 — [추가] 를 눌러야 반영된다
              <SegBtn key={p} type="button" role="radio" aria-checked={newPay === p} $on={newPay === p} onClick={() => setNewPay(p)}>
                {p === 'paid' ? t('leaveTypes.paid', '유급') as string : t('leaveTypes.unpaid', '무급') as string}
              </SegBtn>
            ))}
          </PaySeg>
          {newPay === 'paid' && (
            <DaysInput type="number" step="0.5" min="0.5" max="366" inputMode="decimal"
              value={newDays} placeholder={t('leaveTypes.col.days', '연간 기본 일수') as string}
              aria-label={t('leaveTypes.col.days', '연간 기본 일수') as string}
              onChange={(e) => setNewDays(e.target.value)} />
          )}
          {/* autosave-exempt: 추가는 액션이다(입력을 다 채우고 누른다) */}
          <ActionButton size="sm" tone="primary" data-testid="leave-type-add-submit"
            disabled={submitting || !newName.trim()} onClick={() => void submitAdd()}>
            + {t('leaveTypes.add', '종류 추가') as string}
          </ActionButton>
          {addErr && <ErrText role="alert">{addErr}</ErrText>}
        </AddRow>
      )}
    </Section>
  );
}

// 칸 폭 — 이름은 늘고 나머지는 고정. 폰(≤640)에서는 이름 한 줄 / 나머지 한 줄로 감는다.
const grid = `
  display: grid; grid-template-columns: minmax(0, 1fr) 104px 112px 56px 36px; align-items: center; column-gap: 12px;
  @media (max-width: 640px) { grid-template-columns: minmax(0, 1fr) auto auto 36px; row-gap: 6px; }
`;
const ColHead = styled.div`
  ${grid}
  padding: 0 0 4px; font-size: 0.75rem; font-weight: 600; color: #64748B;
  @media (max-width: 640px) { display: none; }
`;
const TypeRow = styled(Row)`
  ${grid}
  @media (max-width: 640px) { > :first-child { grid-column: 1 / -1; } }
`;
const NameSlot = styled.div` display: flex; align-items: center; gap: 6px; min-width: 0; > div { flex: 1 1 auto; min-width: 0; } `;
const Cell = styled.div` display: flex; align-items: center; gap: 6px; min-width: 0; `;
const PayText = styled.span` font-size: 0.8125rem; color: #475569; `;
const Dash = styled.span` font-size: 0.8125rem; color: #94A3B8; padding-left: 10px; `;
const DaysInput = styled.input`
  width: 96px; height: 36px; padding: 0 10px;
  border: 1px solid #CBD5E1; border-radius: 8px; font-size: 0.875rem; font-variant-numeric: tabular-nums;
  &:focus { outline: none; border-color: #14B8A6; }
  &:disabled { background: #F8FAFC; color: #94A3B8; }
`;
const PaySeg = styled.div` display: inline-flex; height: 36px; padding: 2px; border-radius: 8px; background: #F1F5F9; `;
const SegBtn = styled.button<{ $on: boolean }>`
  min-width: 52px; padding: 0 10px; border: none; border-radius: 6px; cursor: pointer;
  font-size: 0.8125rem; font-weight: 600;
  background: ${(p) => (p.$on ? '#fff' : 'transparent')};
  color: ${(p) => (p.$on ? '#0F172A' : '#64748B')};
  box-shadow: ${(p) => (p.$on ? '0 1px 2px rgba(15,23,42,0.08)' : 'none')};
  &:focus-visible { outline: 2px solid #14B8A6; outline-offset: 2px; }
`;
