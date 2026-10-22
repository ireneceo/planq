// 일정 추가 창 «구글 캘린더 연동» 의 두 줄(팀 · 내 것) — NewEventModal 에서 뺐다(800줄 문턱).
//
// 2026-10-20 Irene: «일정 추가할 때 구글캘린더 종류는 선택이 안돼? 선택할 수 없으면 기준이 되는 캘린더 이름 표시라도 해줘. 어디로 들어가는지 모르잖아.»
//   올릴 캘린더는 일정마다가 아니라 **연결마다 하나**다(개인: 내 프로필 > 외부 연동 · 팀: 워크스페이스 설정 > 파일·외부 연동, 대표만).
//   그래서 여기서는 고르지 않고 «Google 「이름」 · 계정» 을 적고, 바꾸는 곳으로 «바꾸기» 를 잇는다(새 탭 — 쓰던 일정 입력을 잃지 않게).
//   ★ 폰·좁은 화면(미러 모드)엔 탭이 없어 «새 탭» 이 곧 이 화면 이동이다 — 쓰던 일정이 통째로 사라진다(Fable 2026-10-22 FAIL).
//     거기선 누르는 문 대신 바꾸는 곳을 글로 적는다(앱 안에서 window.open 은 바깥 브라우저로 나가 로그인도 없다).
//   이름은 GET /api/calendar/video/status 가 실제 올리는 곳과 같은 값(calendarIdOf)으로 준다.
import React, { useSyncExternalStore } from 'react';
import styled from 'styled-components';
import { useTranslation } from 'react-i18next';
import { tabStore } from '../../stores/tabStore';

export interface GcalTarget {
  teamEmail: string | null; teamCal: string | null;
  personalEmail: string | null; personalCal: string | null;
  /** 팀 캘린더는 대표만 바꿀 수 있다 — 아니면 «바꾸기» 를 그리지 않는다 */
  canChangeTeam: boolean;
}
interface Toggle { checked: boolean; onChange: (v: boolean) => void }

const GcalSyncRows: React.FC<{ team: Toggle | null; personal: Toggle | null; isPrivateVis: boolean; target: GcalTarget | null }> = ({
  team, personal, isPrivateVis, target,
}) => {
  const { t } = useTranslation('qcalendar');
  const mirror = useSyncExternalStore(tabStore.subscribe, () => tabStore.getSnapshot().mirror);

  // 이름을 못 읽었으면(옛 서버·연결 정보 없음) 종전 안내 문구로 떨어진다.
  const targetLine = (kind: 'team' | 'personal', cal: string | null, email: string | null, changeTo: string | null, fallback: string) => {
    if (!target || (!email && !cal)) return <GcalHint>{fallback}</GcalHint>;
    const name = cal || (t('layer.googleDefault') as string);
    const where = changeTo && mirror
      ? <GcalHint data-testid={`event-new-gcal-${kind}-where`}>{t(kind === 'team' ? 'form.gcalTargetWhereTeam' : 'form.gcalTargetWherePersonal')}</GcalHint>
      : null;
    return (
      <>
      <TargetLine data-testid={`event-new-gcal-${kind}-target`}>
        <TargetText title={email ? `${name} · ${email}` : name}>
          {email ? t('form.gcalTarget', { name, email }) : t('form.gcalTargetNoEmail', { name })}
        </TargetText>
        {changeTo && !mirror && (
          <Change type="button" onClick={(e) => { e.preventDefault(); tabStore.openInNewTab(changeTo); }}>
            {t('form.gcalTargetChange')}
          </Change>
        )}
      </TargetLine>
      {where}
      </>
    );
  };

  return (
    <>
      {team && (
        <GcalRow $disabled={isPrivateVis}>
          <input
            type="checkbox"
            checked={team.checked && !isPrivateVis}
            disabled={isPrivateVis}
            onChange={(e) => team.onChange(e.target.checked)}
          />
          <span>
            {t('form.gcalTeam')}
            {isPrivateVis
              ? <GcalHint>{t('form.gcalTeamBlocked')}</GcalHint>
              : targetLine('team', target?.teamCal ?? null, target?.teamEmail ?? null,
                target?.canChangeTeam ? '/business/settings/storage' : null, t('form.gcalTeamHint'))}
          </span>
        </GcalRow>
      )}
      {personal && (
        <GcalRow>
          <input
            type="checkbox"
            checked={personal.checked}
            onChange={(e) => personal.onChange(e.target.checked)}
          />
          <span>
            {t('form.gcalPersonal')}
            {targetLine('personal', target?.personalCal ?? null, target?.personalEmail ?? null,
              '/profile/integrations', t('form.gcalPersonalHint'))}
          </span>
        </GcalRow>
      )}
    </>
  );
};

export default GcalSyncRows;

const GcalRow = styled.label<{ $disabled?: boolean }>`
  display: flex; align-items: flex-start; gap: 8px;
  padding: 6px 0; font-size: 0.8125rem; color: #334155;
  cursor: ${p => (p.$disabled ? 'not-allowed' : 'pointer')};
  opacity: ${p => (p.$disabled ? 0.55 : 1)};
  & > span { flex: 1; min-width: 0; }
`;
const GcalHint = styled.small`display:block;margin-top:2px;font-size:0.71875rem;color:#94A3B8;line-height:1.45;`;
const TargetLine = styled.small`display:flex;align-items:center;gap:8px;min-width:0;margin-top:2px;font-size:0.71875rem;line-height:1.45;color:#64748B;`;
const TargetText = styled.span`min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;`;
const Change = styled.button`
  flex-shrink:0;padding:0;border:none;background:none;cursor:pointer;
  font-size:inherit;font-weight:600;color:#0D9488;
  &:hover{text-decoration:underline;}
  &:focus-visible{outline:2px solid #14B8A6;outline-offset:2px;border-radius:2px;}
`;
