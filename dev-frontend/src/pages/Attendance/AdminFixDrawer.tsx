// 근태 — 관리자 정정 드로어 (#208). AttendancePage 에서 분리(컴포넌트 800줄 가드).
import React, { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import styled from 'styled-components';
import ActionButton from '../../components/Common/ActionButton';
import DetailDrawer from '../../components/Common/DetailDrawer';
import { apiFetch } from '../../contexts/AuthContext';
import { type AttendanceDay } from '../../hooks/useAttendance';
import {
  type AttendanceEventRow, toLocalInput,
  Muted, Hint, Field, FieldLabel, TextInput, TextArea, ErrorBar,
} from './shared';

// ─── 관리자 정정 드로어 ──────────────────────────────────────────
// ★ 기존 기록을 고치는 화면이 아니다 — **바로잡는 시각을 새로 얹는** 화면이다.
//   원장은 append-only 라 무엇이 원래였는지가 남고, 롤업은 서버가 다시 접어서 만든다.
//   그래서 여기서 하는 일은 "이 시각으로 다시 찍어달라" 는 요청 + 사유 남기기뿐이다.
export const AdminFixDrawer: React.FC<{
  day: AttendanceDay | null; onClose: () => void;
  nameOf: (id: number) => string; onDone: () => Promise<void>;
}> = ({ day, onClose, nameOf, onDone }) => {
  const { t } = useTranslation('attendance');
  const [events, setEvents] = useState<AttendanceEventRow[]>([]);
  const [rows, setRows] = useState<{ kind: string; at: string }[]>([]);
  const [reason, setReason] = useState('');
  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  // 여는 순간 **지금 유효한 기록을 그대로 채운다.** 빈 칸에서 시작하면 관리자가 하루를 통째로
  //   다시 입력해야 하고, 그러다 출근을 빼먹으면 근무시간이 0 이 된다.
  useEffect(() => {
    if (!day) { setEvents([]); setRows([]); setReason(''); setErr(null); return; }
    (async () => {
      const r = await apiFetch(`/api/attendance/days/${day.id}/events`);
      if (!r.ok) return;
      const j = await r.json().catch(() => null);
      if (!j?.success) return;
      const list: AttendanceEventRow[] = j.data || [];
      setEvents(list);
      setRows(list.filter((e) => !e.superseded_at).map((e) => ({ kind: e.kind, at: toLocalInput(e.at) })));
    })();
  }, [day]);

  if (!day) return null;

  const addRow = (kind: string) => setRows((p) => [...p, { kind, at: `${day.work_date}T09:00` }]);
  const submit = async () => {
    if (saving || !rows.length) return;
    setSaving(true); setErr(null);
    try {
      const r = await apiFetch(`/api/attendance/days/${day.id}`, {
        method: 'PATCH', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          fix_reason: reason,
          events: rows.map((x) => ({ kind: x.kind, at: new Date(x.at).toISOString() })),
        }),
      });
      const j = await r.json().catch(() => null);
      if (!r.ok || !j?.success) { setErr(j?.message || 'generic'); return; }
      await onDone();
      onClose();
    } finally { setSaving(false); }
  };

  const KINDS = ['clock_in', 'break_start', 'break_end', 'clock_out'];

  return (
    <DetailDrawer open={!!day} onClose={onClose} width={460} ariaLabel={t('fix.title') as string}>
      <DetailDrawer.Header onClose={onClose}>
        {t('fix.title')} — {nameOf(day.user_id)} · {day.work_date}
      </DetailDrawer.Header>
      <DetailDrawer.Body>
        <FieldLabel>{t('fix.current')}</FieldLabel>
        <LedgerBox>
          {events.length === 0 ? <Muted>–</Muted> : events.map((e) => (
            <LedgerRow key={e.id} $dead={!!e.superseded_at}>
              <b>{t(`fix.kind.${e.kind}`)}</b>
              <span>{new Date(e.at).toLocaleString()}</span>
              {e.source !== 'user' && <SourceTag>{t(`fix.source.${e.source}`)}</SourceTag>}
              {e.superseded_at && <SourceTag>{t('fix.superseded')}</SourceTag>}
            </LedgerRow>
          ))}
        </LedgerBox>
        <Hint>{t('fix.appendOnlyHint')}</Hint>

        <FieldLabel style={{ marginTop: 16 }}>{t('fix.timeline')}</FieldLabel>
        <Hint>{t('fix.timelineHint')}</Hint>
        <KindRow>
          {KINDS.map((k) => (
            <ActionButton key={k} tone="secondary" size="sm" onClick={() => addRow(k)}>
              + {t(`fix.kind.${k}`)}
            </ActionButton>
          ))}
        </KindRow>
        {rows.map((r, i) => (
          <NewRow key={i}>
            <span>{t(`fix.kind.${r.kind}`)}</span>
            <TextInput
              type="datetime-local" value={r.at}
              onChange={(e) => setRows((p) => p.map((x, j) => (j === i ? { ...x, at: e.target.value } : x)))}
            />
            <ActionButton tone="danger" size="sm" onClick={() => setRows((p) => p.filter((_, j) => j !== i))}>×</ActionButton>
          </NewRow>
        ))}

        <Field style={{ marginTop: 14 }}>
          <FieldLabel>{t('fix.reason')} *</FieldLabel>
          <TextArea rows={2} value={reason} onChange={(e) => setReason(e.target.value)}
            placeholder={t('fix.reasonPlaceholder') as string} />
        </Field>
        {err && <ErrorBar role="alert">{t(`error.${err}`, { defaultValue: t('error.generic') as string }) as string}</ErrorBar>}
      </DetailDrawer.Body>
      <DetailDrawer.Footer>
        <ActionButton tone="secondary" size="md" onClick={onClose}>{t('leave.cancel')}</ActionButton>
        <ActionButton tone="primary" size="md" loading={saving} onClick={submit}
          disabled={!rows.length || !reason.trim()} data-testid="attn-fix-submit">
          {t('fix.submit')}
        </ActionButton>
      </DetailDrawer.Footer>
    </DetailDrawer>
  );
};

const LedgerBox = styled.div`
  display: flex; flex-direction: column; gap: 4px; padding: 10px 12px;
  background: #F8FAFC; border: 1px solid #E2E8F0; border-radius: 8px;
`;

const LedgerRow = styled.div<{ $dead?: boolean }>`
  display: flex; align-items: center; gap: 8px; font-size: 12px;
  color: ${p => (p.$dead ? '#94A3B8' : '#334155')};
  text-decoration: ${p => (p.$dead ? 'line-through' : 'none')};
  b { min-width: 56px; }
`;

const SourceTag = styled.span`
  padding: 1px 6px; border-radius: 999px; background: #E2E8F0; color: #64748B; font-size: 10px; font-weight: 700;
`;

const KindRow = styled.div` display: flex; flex-wrap: wrap; gap: 6px; margin-bottom: 8px; `;

const NewRow = styled.div`
  display: grid; grid-template-columns: 70px 1fr auto; gap: 8px; align-items: center; margin-bottom: 6px;
  span { font-size: 12px; font-weight: 600; color: #475569; }
`;
