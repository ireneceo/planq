// 설정 › 근태 관리 › 근무 일정 «사람별» 줄의 «출퇴근 기록» 스위치 (docs/ATTENDANCE_MEMBER_TRACKING_DESIGN.md)
//
// Irene 2026-11-24: «출퇴근 안하는 그냥 일만 봐주거나 연결되어 있는 경우 … 멤버별로 출퇴근 설정을 다르게 할 수 없어?»
// 끄면 그 사람은 이 워크스페이스에서만 출퇴근을 기록하지 않는다(출근 묻기·자동 출근·위젯·지각/미출근 판정 없음 · 휴가는 그대로).
//   바로 적용 — 근무 일정(내일부터 이력)과 달리 자동저장 토글이다. 판정·저장은 서버 services/attendanceTracking 한 곳.
//   ★ 끄기는 확인을 받는다(열린 근무는 지금 퇴근 처리 · 꺼 둔 동안 판정 빠짐). 켜기는 바로.
//   ★ 자기 것은 대표만 바꾼다 — 관리자는 자기 것을 못 정한다(서버 403 self_change_not_allowed 와 같은 규칙).
import { useEffect, useRef, useState } from 'react';
import styled from 'styled-components';
import { useTranslation } from 'react-i18next';
import { apiFetch, useAuth } from '../../contexts/AuthContext';
import AutoSaveField from '../../components/Common/AutoSaveField';
import ConfirmDialog from '../../components/Common/ConfirmDialog';
import { Switch, SwitchKnob } from '../../components/Common/switchShell';

interface Props { businessId: number; userId: number; name: string; tracked: boolean; onChanged: () => void }

export default function MemberTrackingSwitch({ businessId, userId, name, tracked, onChanged }: Props) {
  const { t } = useTranslation('attendance');
  const { user } = useAuth();
  const isSelf = Number(user?.id) === userId;
  const locked = isSelf && user?.business_role !== 'owner';
  const [on, setOn] = useState(tracked);
  const wantRef = useRef(tracked);
  const serverRef = useRef(tracked);
  const [confirmOff, setConfirmOff] = useState(false);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => { setOn(tracked); wantRef.current = tracked; serverRef.current = tracked; }, [tracked]);

  const persist = async (next: boolean) => {
    const r = await apiFetch(`/api/attendance/members/${userId}/tracking`, {
      method: 'PUT', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ business_id: businessId, tracked: next }),
    });
    const j = await r.json().catch(() => null);
    if (!r.ok || !j?.success) {
      wantRef.current = serverRef.current; setOn(serverRef.current);   // 저장이 안 됐는데 화면만 바뀐 채 두지 않는다
      setError(t(`tracking.error.${j?.message || 'generic'}`, { defaultValue: t('error.generic') }) as string);
      throw new Error(j?.message || 'save_failed');
    }
    serverRef.current = next; setError(null);
    onChanged();
  };

  return (
    <Wrap>
      <Label id={`attn-tracking-label-${userId}`}>{t('tracking.label')}</Label>
      <AutoSaveField key={`attn-tracking-${businessId}-${userId}`} type="toggle"
        onSave={async () => { if (wantRef.current !== serverRef.current) await persist(wantRef.current); }}>
        <Switch type="button" role="switch" aria-checked={on} aria-labelledby={`attn-tracking-label-${userId}`}
          data-testid={`attn-tracking-toggle-${userId}`} $on={on} disabled={locked}
          title={locked ? (t('tracking.selfLocked') as string) : undefined}
          onClick={() => {
            if (on) { setConfirmOff(true); return; }   // 끄기는 확인 뒤(아래 onConfirm 이 저장)
            wantRef.current = true; setOn(true);
          }}>
          <SwitchKnob $on={on} />
        </Switch>
      </AutoSaveField>
      {error && <Err role="alert">{error}</Err>}
      <ConfirmDialog isOpen={confirmOff} onClose={() => setConfirmOff(false)} variant="warning"
        title={t('tracking.offConfirmTitle', { name })} message={t('tracking.offConfirmMsg')} confirmText={t('tracking.offConfirm') as string}
        onConfirm={() => { setConfirmOff(false); wantRef.current = false; setOn(false); persist(false).catch(() => null); }} />
    </Wrap>
  );
}

const Wrap = styled.div`display: flex; align-items: center; gap: 6px; flex: 0 0 auto; flex-wrap: wrap;`;
const Label = styled.span`font-size: 0.75rem; color: #475569; white-space: nowrap;`;
const Err = styled.span`flex-basis: 100%; font-size: 0.6875rem; color: #BE123C;`;
