// 캐시 자동 갱신 — 유저가 캐시/재설치 문제에 부딪히지 않게 새 배포를 자동 적용.
//   /api/build-version (no-store) 폴링 → 새 빌드 감지 시:
//     1) SW 강제 update() — 옛 ServiceWorker 잔존 차단 (sw.js no-cache + skipWaiting 이라 즉시 새 SW)
//     2) 입력 중이 아니면 즉시 hard reload, 입력 중이면 다음 navigation 까지 보류 (폼 데이터 보호)
//   폴링: 5분 인터벌 + focus/visibility 복귀 시 즉시 (오래 켜둔 탭도 빠르게 최신화).
//   운영: 알림 미수신이 "옛 SW 캐시"로 밝혀진 사고 (2026-06-15) → SW 강제 update 추가.
import { useEffect, useRef, useState } from 'react';
import styled, { keyframes } from 'styled-components';
import { useTranslation } from 'react-i18next';
import { useChromeLocation } from '../../hooks/useChromeNav';

const POLL_MS = 5 * 60 * 1000;  // 5분

// reload 보류 기준 (데이터·작업 흐름 보호).
//   body[data-form-dirty]     — 미저장 변경이 있음 (자동저장이 끝나면 꺼진다)
//   body[data-editing-active] — **편집 화면이 열려 있음** (저장 여부와 무관. 새 편집기는 이 플래그를 세울 것)
//   body[data-pip-active] / body[data-recording-active] — 핀 창·녹음
function isReloadSafe(): boolean {
  try {
    const el = document.activeElement as HTMLElement | null;
    if (el && (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA' || el.isContentEditable)) return false;
    if (document.body.dataset.formDirty === '1') return false;
    if (document.querySelector('[data-form-dirty="1"]')) return false;
    // ★ 편집 화면이 열려 있으면 저장할 게 남아 있지 않아도 reload 하지 않는다.
    //   formDirty 는 "미저장 변경이 있음" 이라 **자동저장이 끝나는 순간 꺼진다**.
    //   그 틈에 새 빌드가 감지되면 멀쩡히 글을 쓰는 중에 페이지가 새로고침돼 **편집이 닫힌다**
    //   (운영 신고 2026-08-21: "고치면 저장되어 버려 / 닫혀, 편집이").
    //   reload 는 사라지지 않고 pendingReloadRef 에 남아, 편집을 닫고 다른 화면으로 갈 때 적용된다.
    if (document.body.dataset.editingActive === '1') return false;
    if (document.querySelector('[data-editing-active="1"]')) return false;
    // 핀(Document PiP) 창은 opener 문서에 종속 — 이 창을 reload 하면 핀 창이 같이 죽는다.
    // 자동 갱신 때문에 사용자가 항상-위로 띄워둔 도구가 사라지면 안 된다 (utils/pinHost.ts).
    if (document.body.dataset.pipActive === '1') return false;
    // Q Note 녹음 중 reload = 마이크 사망. web_conference 캡처는 사용자가 회의 탭에 가 있는 것이
    // 정상 사용이라 이 탭은 hidden 상태 — 아래 hidden 분기에 그대로 걸려 배포 때마다 녹음이 죽었다.
    // 플래그는 QNotePage 가 녹음 phase 동안만 세운다.
    if (document.body.dataset.recordingActive === '1') return false;
  } catch { /* noop */ }
  return true;
}

async function forceSwUpdate(): Promise<void> {
  try {
    if (!('serviceWorker' in navigator)) return;
    const reg = await navigator.serviceWorker.getRegistration();
    if (reg) await reg.update();
  } catch { /* noop */ }
}

const BuildVersionGuard: React.FC = () => {
  const { t } = useTranslation('common');
  const location = useChromeLocation();
  const initialRef = useRef<string | null>(null);
  const pendingReloadRef = useRef(false);
  // ★ 2026-08-24 (Irene: "새로고침하면 알아서 반영되게 업데이트 해야지. 고객이면 어쩌려고")
  //   여태 이 컴포넌트는 새 빌드를 감지하고도 **화면에 아무것도 띄우지 않았다**(return null).
  //   reload 는 ①탭이 숨겨졌을 때 ②앱 안에서 화면을 이동할 때만 일어난다 —
  //   한 화면에서 계속 작업하면 영영 옛 코드에 머문다. 게다가 **PWA 에는 새로고침 버튼이 없다**
  //   (운영 로그 kind=pwa). 그 상태에서 옛 번들이 지워진 청크를 부르면 Failed to fetch 가 난다.
  //   → 감지되면 **눈에 보이는 배너 + 직접 누르는 새로고침**을 준다. 작업을 끊지 않는 안내이고,
  //     사용자가 누르는 시점이라 입력 손실도 없다. 자동 reload 경로는 그대로 둔다.
  const [updateReady, setUpdateReady] = useState(false);

  useEffect(() => {
    let mounted = true;
    const check = async () => {
      try {
        const r = await fetch('/api/build-version', { cache: 'no-store' });
        const j = await r.json();
        if (!mounted || !j?.success) return;
        const v: string | null = j.data?.version || null;
        if (!v) return;
        if (initialRef.current == null) { initialRef.current = v; return; }
        if (initialRef.current !== v) {
          pendingReloadRef.current = true;
          setUpdateReady(true);
          // 새 빌드 → 옛 SW 잔존 차단 위해 강제 최신화 (sw.js no-cache + skipWaiting → 즉시 새 SW)
          await forceSwUpdate();
          // 화면을 안 보고 있을 때(hidden)만 즉시 reload — 보고 있으면 다음 navigation 때 조용히 적용.
          // (잦은 배포 시 사용자가 보는 중에 화면이 튀는 것 방지. 다음 페이지 이동 effect 가 안전 적용)
          if (document.visibilityState === 'hidden' && isReloadSafe()) window.location.reload();
        }
      } catch { /* network 일시 오류 무시 */ }
    };
    check();
    const id = setInterval(check, POLL_MS);
    const onVisible = () => { if (document.visibilityState === 'visible') check(); };
    window.addEventListener('focus', check);
    document.addEventListener('visibilitychange', onVisible);
    return () => {
      mounted = false;
      clearInterval(id);
      window.removeEventListener('focus', check);
      document.removeEventListener('visibilitychange', onVisible);
    };
  }, []);

  // 새 빌드 감지됐는데 입력 중이라 보류된 경우 → 다음 navigation 시점에 안전하게 reload
  useEffect(() => {
    if (pendingReloadRef.current && isReloadSafe()) window.location.reload();
  }, [location.pathname]);

  if (!updateReady) return null;

  return (
    <Bar role="status" data-testid="build-update-bar">
      <Dot aria-hidden="true" />
      <Msg>{t('update.ready', { defaultValue: '새 버전이 준비됐어요' }) as string}</Msg>
      <ReloadBtn type="button" onClick={() => { void forceSwUpdate().finally(() => window.location.reload()); }}>
        {t('update.reload', { defaultValue: '지금 새로고침' }) as string}
      </ReloadBtn>
      <CloseBtn type="button" onClick={() => setUpdateReady(false)}
        aria-label={t('update.later', { defaultValue: '나중에' }) as string}
        title={t('update.later', { defaultValue: '나중에' }) as string}>×</CloseBtn>
    </Bar>
  );
};

const pulse = keyframes`0%,100%{opacity:1}50%{opacity:0.35}`;
// 하단 중앙 — 작업을 가리지 않는 자리. 자동저장/작업 흐름을 끊지 않는 안내다.
const Bar = styled.div`
  position: fixed; left: 50%; transform: translateX(-50%);
  bottom: calc(16px + env(safe-area-inset-bottom));
  z-index: 2147483000;
  display: flex; align-items: center; gap: 10px;
  padding: 8px 10px 8px 14px;
  background: #0F172A; color: #F8FAFC;
  border-radius: 999px; box-shadow: 0 8px 24px rgba(15,23,42,0.28);
  font-size: 13px; line-height: 1;
  max-width: calc(100vw - 32px);
  @media (max-width: 640px) { bottom: calc(72px + env(safe-area-inset-bottom)); }
`;
const Dot = styled.span`
  width: 7px; height: 7px; border-radius: 50%; background: #14B8A6; flex-shrink: 0;
  animation: ${pulse} 1.6s ease-in-out infinite;
  @media (prefers-reduced-motion: reduce) { animation: none; }
`;
const Msg = styled.span`white-space: nowrap; overflow: hidden; text-overflow: ellipsis;`;
const ReloadBtn = styled.button`
  flex-shrink: 0; border: 0; cursor: pointer;
  padding: 6px 12px; border-radius: 999px;
  background: #14B8A6; color: #fff; font-size: 12px; font-weight: 700; font-family: inherit;
  &:hover { background: #0D9488; }
  &:focus-visible { outline: none; box-shadow: 0 0 0 3px rgba(20,184,166,0.45); }
`;
const CloseBtn = styled.button`
  flex-shrink: 0; border: 0; background: none; cursor: pointer;
  color: #94A3B8; font-size: 16px; line-height: 1; padding: 0 4px;
  &:hover { color: #F8FAFC; }
`;

export default BuildVersionGuard;
