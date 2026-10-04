// 다운로드 트레이 — 지금 받고 있는 첨부를 **한 곳**에서 보여준다 (2026-10-04).
//
// Irene: *"다운로드 중인 거 %나 어느 정도 되었는지 다 보이게 해줘."*
//   상태는 services/downloadManager 가 쥐고, 이 컴포넌트는 그리기만 한다. 어느 화면에서 눌렀든
//   (업무 첨부·채팅·메일·이미지 보기·파일·문서·전체 다운로드) 같은 카드가 같은 숫자로 뜬다.
//
//   · 진행 중: 파일명 · 막대 · «43% · 3.4MB / 8.0MB»(전체를 모르면 «3.4MB 받음») · [취소]
//   · 앱에서 기기에 저장하는 동안: «저장 중…»
//   · 끝나면 «완료» 로 잠깐 바뀌었다가 **조용히** 사라진다 — 성공 토스트가 아니라 진행 표시가 끝난 것이다.
//   · 실패: 사용자 언어 문구 + [다시 시도] · [닫기] — 사용자가 닫을 때까지 남는다.
//
// ★ App 루트 한 곳에 둔다 — ModeGate 가 탭 모드(TabAppShell)·미러 모드 두 트리로 갈라지므로 트리 안에 두면
//   한쪽에서만 보인다(memory: 전역 컴포넌트는 두 렌더 트리).
// ★ 비모달 알림이라 role="dialog" 가 아니다(검사 하니스의 aria-modal 스코핑을 오염시키지 않게) — role="status".
import { useEffect, useState } from 'react';
import { createPortal } from 'react-dom';
import styled from 'styled-components';
import { useTranslation } from 'react-i18next';
import {
  subscribeDownloads, cancelDownload, retryDownload, dismissDownload,
  progressPercent, humanBytes, type DownloadItem,
} from '../../services/downloadManager';
import { mapApiError } from '../../utils/apiError';

export default function DownloadTray() {
  const { t } = useTranslation('common');
  const { t: tErr } = useTranslation('errors');
  const [items, setItems] = useState<DownloadItem[]>([]);
  useEffect(() => subscribeDownloads(setItems), []);
  if (items.length === 0 || typeof document === 'undefined') return null;

  // 내려받기에서 실제로 나는 실패는 몇 가지뿐이다 — 코드(file_missing 등)를 그대로 보이지 않고 사람 말로.
  //   그 외는 공용 오류 문구(mapApiError)로, 그래도 비면 «내려받지 못했어요».
  const errorText = (code: string): string => {
    if (code === 'file_missing' || code === 'File not found' || code === 'not_found' || code === 'attachment_not_found') {
      return t('downloadTray.errMissing', { defaultValue: '원본 파일을 찾을 수 없어요' }) as string;
    }
    if (/^drive_/.test(code)) return t('downloadTray.errDrive', { defaultValue: 'Google Drive 에서 받아오지 못했어요. 연결 상태를 확인해 주세요' }) as string;
    if (code === 'forbidden' || code === 'HTTP 403') return t('downloadTray.errForbidden', { defaultValue: '이 파일을 받을 권한이 없어요' }) as string;
    if (/^HTTP \d+$/.test(code) || !code || /fetch|network|load failed/i.test(code)) {
      return t('downloadTray.errGeneric', { defaultValue: '내려받지 못했어요. 다시 시도해 주세요' }) as string;
    }
    return mapApiError(new Error(code), tErr);
  };

  const metaOf = (it: DownloadItem): string => {
    if (it.phase === 'saving') return t('downloadTray.saving', { defaultValue: '저장 중…' }) as string;
    if (it.phase === 'done') return t('downloadTray.done', { defaultValue: '완료' }) as string;
    if (it.phase === 'error') return errorText(it.error || '');
    const pct = progressPercent(it.received, it.total);
    if (pct !== null && it.total) {
      return t('downloadTray.progress', {
        defaultValue: '{{pct}}% · {{got}} / {{total}}', pct, got: humanBytes(it.received), total: humanBytes(it.total),
      }) as string;
    }
    if (it.received > 0) return t('downloadTray.received', { defaultValue: '{{got}} 받음', got: humanBytes(it.received) }) as string;
    return t('downloadTray.preparing', { defaultValue: '준비 중…' }) as string;
  };

  return createPortal(
    <Tray role="status" aria-live="polite" aria-label={t('downloadTray.aria', { defaultValue: '다운로드 진행' }) as string} data-testid="download-tray">
      {items.map((it) => {
        const pct = progressPercent(it.received, it.total);
        const width = it.phase === 'done' || it.phase === 'saving' ? 100 : (pct ?? 0);
        const indeterminate = it.phase === 'running' && pct === null;
        return (
          <Card key={it.id} data-testid={`download-item-${it.id}`} data-phase={it.phase} $error={it.phase === 'error'}>
            <Top>
              <Icon $phase={it.phase} aria-hidden>
                {it.phase === 'done' ? (
                  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round"><polyline points="5 12 10 17 19 7" /></svg>
                ) : it.phase === 'error' ? (
                  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round"><path d="M12 8v5" /><path d="M12 16.5v.5" /><circle cx="12" cy="12" r="9" /></svg>
                ) : (
                  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round"><path d="M12 3v12" /><polyline points="7 10 12 15 17 10" /><path d="M5 21h14" /></svg>
                )}
              </Icon>
              <Body>
                <Name title={it.name}>{it.name}</Name>
                <Meta $error={it.phase === 'error'} data-testid="download-item-meta">{metaOf(it)}</Meta>
              </Body>
              {it.phase === 'running' && (
                <IconBtn type="button" onClick={() => cancelDownload(it.id)}
                  aria-label={`${t('downloadTray.cancel', { defaultValue: '취소' }) as string}: ${it.name}`}
                  title={t('downloadTray.cancel', { defaultValue: '취소' }) as string} data-testid="download-item-cancel">
                  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round"><path d="M6 6l12 12" /><path d="M18 6L6 18" /></svg>
                </IconBtn>
              )}
              {it.phase === 'error' && (
                <IconBtn type="button" onClick={() => dismissDownload(it.id)}
                  aria-label={`${t('downloadTray.dismiss', { defaultValue: '닫기' }) as string}: ${it.name}`}
                  title={t('downloadTray.dismiss', { defaultValue: '닫기' }) as string} data-testid="download-item-dismiss">
                  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round"><path d="M6 6l12 12" /><path d="M18 6L6 18" /></svg>
                </IconBtn>
              )}
            </Top>
            {it.phase !== 'error' && (
              <Bar aria-hidden><Fill $w={width} $indeterminate={indeterminate} $done={it.phase === 'done'} /></Bar>
            )}
            {it.phase === 'error' && (
              <RetryRow>
                <RetryBtn type="button" onClick={() => retryDownload(it.id)} data-testid="download-item-retry">
                  {t('downloadTray.retry', { defaultValue: '다시 시도' }) as string}
                </RetryBtn>
              </RetryRow>
            )}
          </Card>
        );
      })}
    </Tray>,
    document.body,
  );
}

const Tray = styled.div`
  position: fixed;
  /* 우측 하단 퀵메뉴(FAB 52px, bottom 16px) 위에 앉는다 — 둘이 겹치지 않게 */
  right: 20px;
  bottom: 84px;
  /* 이미지 보기(99999) 위에서도 보여야 한다 — 거기서 누른 다운로드의 진행이 안 보이면 의미가 없다 */
  z-index: 100000;
  width: min(340px, calc(100vw - 32px));
  display: flex; flex-direction: column; gap: 8px;
  pointer-events: none;
  /* 폰·태블릿 — 하단 입력줄(채팅·댓글) 위로, 홈 인디케이터(안전영역) 위로 */
  @media (max-width: 1024px) {
    right: 16px;
    bottom: calc(88px + var(--pq-safe-bottom, 0px));
  }
  /* 입력 중(키보드)에는 접는다 — 키보드 위에 떠 입력란을 가리지 않게. 받는 일은 계속되고 내리면 다시 보인다. */
  @media (max-width: 768px) {
    body[data-keyboard-up='1'] & { display: none; }
  }
`;

const Card = styled.div<{ $error?: boolean }>`
  pointer-events: auto;
  background: #FFFFFF;
  border: 1px solid ${(p) => (p.$error ? '#FECACA' : '#E2E8F0')};
  border-radius: 12px;
  box-shadow: 0 8px 24px rgba(15, 23, 42, 0.14);
  padding: 10px 10px 10px 12px;
  animation: pqDlIn 0.16s ease-out;
  @keyframes pqDlIn { from { opacity: 0; transform: translateY(6px); } to { opacity: 1; transform: none; } }
`;

const Top = styled.div`
  display: flex; align-items: center; gap: 10px;
`;

const Icon = styled.span<{ $phase: string }>`
  flex-shrink: 0;
  width: 32px; height: 32px; border-radius: 8px;
  display: inline-flex; align-items: center; justify-content: center;
  background: ${(p) => (p.$phase === 'error' ? '#FEF2F2' : p.$phase === 'done' ? '#ECFDF5' : '#F0FDFA')};
  color: ${(p) => (p.$phase === 'error' ? '#DC2626' : p.$phase === 'done' ? '#059669' : '#0F766E')};
  svg { flex-shrink: 0; }
`;

const Body = styled.div`
  flex: 1; min-width: 0;
  display: flex; flex-direction: column; gap: 2px;
`;

const Name = styled.span`
  font-size: 0.8125rem; font-weight: 600; color: #0F172A;
  white-space: nowrap; overflow: hidden; text-overflow: ellipsis;
`;

const Meta = styled.span<{ $error?: boolean }>`
  font-size: 0.75rem; color: ${(p) => (p.$error ? '#B91C1C' : '#64748B')};
  font-variant-numeric: tabular-nums;
  white-space: nowrap; overflow: hidden; text-overflow: ellipsis;
`;

const IconBtn = styled.button`
  flex-shrink: 0;
  width: 36px; height: 36px; border-radius: 8px;
  display: inline-flex; align-items: center; justify-content: center;
  border: none; background: transparent; color: #64748B; cursor: pointer;
  svg { flex-shrink: 0; }
  &:hover { background: #F1F5F9; color: #0F172A; }
  &:focus-visible { outline: 2px solid rgba(15, 118, 110, 0.5); outline-offset: 1px; }
  @media (max-width: 640px) { width: 40px; height: 40px; }
`;

const Bar = styled.div`
  margin-top: 8px;
  height: 4px; border-radius: 999px;
  background: #E2E8F0;
  overflow: hidden;
  position: relative;
`;

const Fill = styled.div<{ $w: number; $indeterminate: boolean; $done: boolean }>`
  height: 100%;
  border-radius: 999px;
  background: ${(p) => (p.$done ? '#059669' : '#0F766E')};
  width: ${(p) => (p.$indeterminate ? '35%' : `${p.$w}%`)};
  transition: width 0.2s linear;
  ${(p) => (p.$indeterminate ? `
    position: absolute; left: 0; top: 0;
    animation: pqDlSlide 1.1s ease-in-out infinite;
    @keyframes pqDlSlide { from { transform: translateX(-100%); } to { transform: translateX(290%); } }
  ` : '')}
`;

const RetryRow = styled.div`
  display: flex; justify-content: flex-end; margin-top: 6px;
`;

const RetryBtn = styled.button`
  height: 32px; padding: 0 12px; border-radius: 8px;
  border: 1px solid #CBD5E1; background: #FFFFFF; color: #0F172A;
  font-size: 0.75rem; font-weight: 600; cursor: pointer;
  &:hover { background: #F8FAFC; }
  &:focus-visible { outline: 2px solid rgba(15, 118, 110, 0.5); outline-offset: 1px; }
  @media (max-width: 640px) { height: 40px; }
`;
