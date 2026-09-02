// 출퇴근 위젯 (#208) — 사이드바와 모바일 첫 화면이 **같은 컴포넌트**를 쓴다.
//
// 두 벌로 만들면 한쪽만 고쳐지는 날이 온다(상태가 4개라 특히). variant 로 배치만 바꾼다.
//   sidebar : 어두운 teal 배경 위 (FocusWidget 과 같은 톤 — 새 색을 만들지 않는다)
//   card    : 밝은 배경, 모바일 대시보드 최상단. 터치 타겟 48px.
import React from 'react';
import styled, { css, keyframes } from 'styled-components';
import { useTranslation } from 'react-i18next';
import { useAuth } from '../../contexts/AuthContext';
import { useAttendance, formatHm, formatHours } from '../../hooks/useAttendance';
import StandardModal from '../Common/StandardModal';
import ActionButton from '../Common/ActionButton';

// 확인한 자동 기록의 시각을 박제 — 새로고침해도 같은 건으로 다시 뜨지 않게(다음 건은 at 이 달라 다시 뜬다)
const AUTO_SEEN_KEY = 'planq.attn.autoSeen';

interface Props {
  variant?: 'sidebar' | 'card';
  isCollapsed?: boolean;
  /** 업무 흐름 위젯과 한 카드 안에 들어갈 때 — 자체 테두리·배경을 벗는다.
   *  근무중인지와 무슨 업무 중인지는 사용자에게 한 덩어리다(운영 지적). */
  embedded?: boolean;
}

const AttendanceWidget: React.FC<Props> = ({ variant = 'sidebar', isCollapsed, embedded }) => {
  const { t } = useTranslation('attendance');
  const { user } = useAuth();
  // ★ 출퇴근은 **직원 기능**이다. 고객(Client)에게 "미출근 / 근무 시작" 이 뜨면 안 되고,
  //   `/api/attendance/today` 는 고객에게 403 이라 화면에 쓸 값도 없다
  //   (2026-09-02 고객 계정 재현: 사이드바에 위젯이 그대로 떠 있고 콘솔에 403).
  //   bizId 를 null 로 넘겨 훅이 아예 호출하지 않게 한다 — 훅 개수는 그대로 유지.
  const isClientUser = user?.business_role === 'client';
  const bizId = (!isClientUser && user?.business_id) ? Number(user.business_id) : null;
  const a = useAttendance(bizId);

  // ★ 이 세 줄은 **early return 앞**이어야 한다 — 아래 `return null` 뒤에 훅을 두면
  //   위젯이 로딩 중일 때와 아닐 때 훅 개수가 달라져 React #310 으로 화면이 통째로 죽는다.
  const autoAt = a.autoNotice?.at || null;
  const [seenAt, setSeenAt] = React.useState<string | null>(() => {
    try { return localStorage.getItem(AUTO_SEEN_KEY); } catch { return null; }
  });
  const showAutoModal = !!autoAt && seenAt !== autoAt;
  const closeAutoNotice = () => {
    if (autoAt) {
      try { localStorage.setItem(AUTO_SEEN_KEY, autoAt); } catch { /* 사파리 프라이빗 등 */ }
      setSeenAt(autoAt);
    }
    a.dismissNotice();
  };

  if (!bizId || a.loading) return null;

  const state = a.state;
  const dark = variant === 'sidebar';

  if (isCollapsed) {
    const key = state || 'none';
    return (
      <CollapsedDot title={t(`state.${key}`) as string} aria-label={t(`state.${key}`) as string}>
        <DotInner $state={state} />
      </CollapsedDot>
    );
  }

  const label = state ? t(`state.${state}`) : t('widget.notStarted');
  const elapsed = state === 'on_break' ? a.live.brk : a.live.work;

  return (
    <Wrap $dark={dark} $card={variant === 'card'} $embedded={!!embedded} aria-live="polite">
      <Head>
        <Dot $state={state} />
        <Label $dark={dark}>{label}</Label>
        {/* 아래 줄에 업무 시간이 또 나오므로 무엇의 시간인지 밝힌다 — 숫자 두 개가 라벨 없이
            위아래로 놓이면 어느 것이 무엇인지 알 수 없다. */}
        {(state === 'working' || state === 'on_break') && (
          <Elapsed $dark={dark}>{t('widget.workedFor', { time: formatHm(elapsed) })}</Elapsed>
        )}
        {state === 'done' && (
          <Elapsed $dark={dark}>{t('widget.todayTotal', { hours: formatHours(a.live.work) })}</Elapsed>
        )}
      </Head>
      <Actions $card={variant === 'card'}>
        {!state && (
          <Primary $dark={dark} $card={variant === 'card'} type="button" data-testid="attn-clock-in"
            onClick={a.clockIn} disabled={a.submitting}>
            <SvgPlay /> {t('widget.start')}
          </Primary>
        )}
        {state === 'working' && (
          <>
            <Secondary $dark={dark} $card={variant === 'card'} type="button" data-testid="attn-break"
              onClick={a.breakStart} disabled={a.submitting}>
              <SvgPause /> {t('widget.break')}
            </Secondary>
            <Secondary $dark={dark} $card={variant === 'card'} type="button" data-testid="attn-clock-out"
              onClick={a.clockOut} disabled={a.submitting}>
              <SvgStop /> {t('widget.clockOut')}
            </Secondary>
          </>
        )}
        {state === 'on_break' && (
          <>
            <Primary $dark={dark} $card={variant === 'card'} type="button" data-testid="attn-resume"
              onClick={a.breakEnd} disabled={a.submitting}>
              <SvgPlay /> {t('widget.resume')}
            </Primary>
            <Secondary $dark={dark} $card={variant === 'card'} type="button" data-testid="attn-clock-out"
              onClick={a.clockOut} disabled={a.submitting}>
              <SvgStop /> {t('widget.clockOut')}
            </Secondary>
          </>
        )}
        {state === 'done' && (
          <Secondary $dark={dark} $card={variant === 'card'} type="button" data-testid="attn-clock-in"
            onClick={a.clockIn} disabled={a.submitting}>
            <SvgPlay /> {t('widget.startAgain')}
          </Secondary>
        )}
      </Actions>
      {/* #208 — 시스템이 대신 바꾼 상태는 **말없이 두지 않는다.**
          나중에 기록을 보고 "내가 언제 출근을 눌렀지?" 가 되면 그 기록 전체를 못 믿게 된다.
          ★ 2026-08-24 (Irene) — 옛 방식은 사이드바에 **계속 남는 인라인 배너**였다.
            "이런 멘트가 계속 좌측메뉴에 남아있을 필요가 있어? 그냥 팝업으로 알리고 확인하고 닫게 해야지."
            근무시간 계산에 관계된 변경이라 **한 번은 반드시 보게** 하되, 확인하면 사라져야 한다.
            → 모달로 한 번 알리고, 확인한 회차는 localStorage 에 박제해 새로고침해도 다시 뜨지 않는다
              (컴포넌트 state 만으로는 새로고침마다 되살아났다). */}
      <StandardModal
        open={showAutoModal}
        onClose={closeAutoNotice}
        title={t('widget.autoClockedInTitle', { defaultValue: '출근으로 기록했어요' }) as string}
        size="sm"
        footer={(
          <AutoModalFooter>
            {a.autoNotice?.can_undo && (
              <ActionButton tone="secondary" size="sm" onClick={() => { void a.undoAuto(); closeAutoNotice(); }}>
                {t('widget.undoAuto')}
              </ActionButton>
            )}
            <ActionButton tone="primary" size="sm" onClick={closeAutoNotice} data-testid="attn-auto-ok">
              {t('widget.autoOk', { defaultValue: '확인' }) as string}
            </ActionButton>
          </AutoModalFooter>
        )}
      >
        <AutoModalBody>
          <div>{t('widget.autoClockedIn')}</div>
          {a.autoNotice?.can_undo && (
            <AutoModalHint>{t('widget.autoUndoHint', { defaultValue: '잘못 기록됐다면 지금 되돌릴 수 있어요.' }) as string}</AutoModalHint>
          )}
        </AutoModalBody>
      </StandardModal>
    </Wrap>
  );
};

export default AttendanceWidget;

// ─── icons ──────────────────────────────────────────────────────
const SvgPlay = () => <svg width="13" height="13" viewBox="0 0 24 24" fill="currentColor"><polygon points="6 4 20 12 6 20 6 4" /></svg>;
const SvgPause = () => <svg width="13" height="13" viewBox="0 0 24 24" fill="currentColor"><rect x="6" y="5" width="4" height="14" /><rect x="14" y="5" width="4" height="14" /></svg>;
const SvgStop = () => <svg width="13" height="13" viewBox="0 0 24 24" fill="currentColor"><rect x="6" y="6" width="12" height="12" rx="1.5" /></svg>;

// ─── styled ─────────────────────────────────────────────────────
const AutoModalBody = styled.div`font-size:0.875rem;color:#0F172A;line-height:1.6;`;
const AutoModalHint = styled.div`margin-top:8px;font-size:0.75rem;color:#64748B;`;
const AutoModalFooter = styled.div`display:flex;gap:8px;justify-content:flex-end;`;
const breath = keyframes`0%{transform:scale(1)}50%{transform:scale(1.15)}100%{transform:scale(1)}`;

type S = 'working' | 'on_break' | 'done' | null;
const DOT: Record<string, string> = { working: '#5EEAD4', on_break: '#FCD34D', done: '#94A3B8', none: '#CBD5E1' };

const Wrap = styled.div<{ $dark: boolean; $card: boolean; $embedded?: boolean }>`
  display: flex; flex-direction: column; gap: 8px;
  ${p => p.$embedded ? css`
    margin: 0; padding: 0; background: none; border: none;
  ` : p.$dark ? css`
    margin: -2px -4px 10px; padding: 10px 12px;
    background: rgba(255,255,255,0.06);
    border: 1px solid rgba(255,255,255,0.1); border-radius: 10px;
  ` : css`
    padding: 14px 16px; background: #FFFFFF;
    border: 1px solid #E2E8F0; border-radius: 12px;
  `}
`;
const Head = styled.div` display: flex; align-items: center; gap: 6px; `;
const Dot = styled.span<{ $state: S }>`
  width: 8px; height: 8px; border-radius: 50%; flex-shrink: 0;
  background: ${p => DOT[p.$state || 'none']};
  ${p => p.$state === 'working' && css`animation: ${breath} 1.6s ease-in-out infinite;`}
`;
const DotInner = styled.span<{ $state: S }>`
  width: 8px; height: 8px; border-radius: 50%;
  background: ${p => DOT[p.$state || 'none']};
`;
const CollapsedDot = styled.div`
  display: flex; align-items: center; justify-content: center;
  width: 100%; height: 20px; margin-bottom: 8px;
`;
const Label = styled.span<{ $dark: boolean }>`
  font-size: ${p => (p.$dark ? 11 : 13) / 16}rem; font-weight: 700; letter-spacing: 0.2px;
  color: ${p => (p.$dark ? 'rgba(255,255,255,0.85)' : '#0F172A')};
`;
const Elapsed = styled.span<{ $dark: boolean }>`
  margin-left: auto; font-variant-numeric: tabular-nums;
  font-size: ${p => (p.$dark ? 11 : 13) / 16}rem; font-weight: 600;
  color: ${p => (p.$dark ? 'rgba(255,255,255,0.6)' : '#475569')};
`;
const Actions = styled.div<{ $card: boolean }>`
  display: flex; gap: 6px;
  ${p => p.$card && css`gap: 8px;`}
`;
const btnBase = css<{ $card: boolean }>`
  flex: 1; display: inline-flex; align-items: center; justify-content: center; gap: 5px;
  border-radius: 8px; cursor: pointer; font-weight: 600;
  font-size: ${p => (p.$card ? 14 : 12) / 16}rem;
  min-height: ${p => (p.$card ? 48 : 32)}px;
  transition: background 0.15s, border-color 0.15s, opacity 0.15s;
  &:disabled { opacity: 0.55; cursor: not-allowed; }
`;
const Primary = styled.button<{ $dark: boolean; $card: boolean }>`
  ${btnBase}
  border: 1px solid transparent;
  ${p => p.$dark ? css`
    background: #5EEAD4; color: #134E4A;
    &:hover:not(:disabled) { background: #99F6E4; }
  ` : css`
    background: #F43F5E; color: #FFFFFF;
    &:hover:not(:disabled) { background: #E11D48; }
  `}
`;
const Secondary = styled.button<{ $dark: boolean; $card: boolean }>`
  ${btnBase}
  ${p => p.$dark ? css`
    background: rgba(255,255,255,0.1); color: rgba(255,255,255,0.9);
    border: 1px solid rgba(255,255,255,0.16);
    &:hover:not(:disabled) { background: rgba(255,255,255,0.16); }
  ` : css`
    background: #FFFFFF; color: #334155; border: 1px solid #CBD5E1;
    &:hover:not(:disabled) { border-color: #94A3B8; background: #F8FAFC; }
  `}
`;

// 자동 변경 안내 — 눈에 띄되 흐름을 막지 않는다(모달이 아니라 한 줄).
