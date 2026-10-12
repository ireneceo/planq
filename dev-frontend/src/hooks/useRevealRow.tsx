// 방금 추가한 항목을 목록에서 «찾아 보여 준다» — 그 행으로 스크롤 + 잠깐 강조.
//
// 왜: Q task 목록은 우선순위·마감 순이라 새 업무가 목록 중간 어딘가에 끼어든다.
//   추가한 뒤 어디 갔는지 몰라 «추가가 됐나?» 가 됐다(2026-10-12 Irene). 정렬은 목적상 그대로 두고
//   (메인 목록 = 무엇부터 할까) 위치를 알려 준다 — 성공 토스트 대신 «목적지가 말한다»(Q file 폴더 반짝임과 같은 방식).
// 지금 보기(탭·필터·검색)에 안 걸려 행이 없으면 화면 아래 안내 한 줄 + [열기] — 조용히 사라지지 않게.
//
// 행 찾기는 `[data-row-id="<id>"]` (리스트·칸반 공통). 보이지 않는 행(접힌 묶음 등 크기 0)은 없는 것으로 본다.
import { useCallback, useEffect, useRef, useState } from 'react';
import styled from 'styled-components';
import { useTranslation } from 'react-i18next';

const POLL_MS = 150;
const WAIT_MS = 3000;     // 소켓 task:new·state 반영 대기 (Cue·AI 생성은 소켓으로만 들어온다)
const FLASH_MS = 1800;
const NOTICE_MS = 8000;
// 첫 확인은 조금 늦게 — 추가 창이 닫히며 포커스를 [업무 추가] 버튼으로 돌려놓을 때 목록이 맨 위로 되감긴다(폰 실측).
//   그보다 먼저 스크롤하면 되감기에 지워진다.
const START_MS = 450;

type Id = number | string;

function findVisibleRow(id: Id): HTMLElement | null {
  const els = document.querySelectorAll<HTMLElement>(`[data-row-id="${id}"]`);
  for (const el of Array.from(els)) {
    const r = el.getBoundingClientRect();
    if (r.width > 0 && r.height > 0) return el;
  }
  return null;
}

function flash(el: HTMLElement) {
  el.setAttribute('data-pq-just-added', '1');
  try {
    el.animate(
      [{ backgroundColor: '#D1FAE5' }, { backgroundColor: '#D1FAE5', offset: 0.5 }, { backgroundColor: 'transparent' }],
      { duration: FLASH_MS, easing: 'ease-out' },
    );
  } catch { /* 애니메이션 미지원 — 표식만 */ }
  window.setTimeout(() => el.removeAttribute('data-pq-just-added'), FLASH_MS);
}

export function useRevealRow(onOpen: (id: number) => void) {
  const { t } = useTranslation('qtask');
  const [hiddenId, setHiddenId] = useState<number | null>(null);
  const timers = useRef<number[]>([]);

  useEffect(() => () => { timers.current.forEach((x) => window.clearTimeout(x)); }, []);

  const reveal = useCallback((ids: Id[]) => {
    const list = ids.filter((x) => x != null);
    if (!list.length) return;
    setHiddenId(null);
    const started = Date.now();
    const tick = () => {
      const found = list.map((id) => findVisibleRow(id));
      // 다 찾았거나 시간이 다 됐으면 끝낸다
      if (found.every(Boolean) || Date.now() - started > WAIT_MS) {
        const first = found.find(Boolean);
        if (first) first.scrollIntoView({ block: 'center' });
        found.forEach((el) => { if (el) flash(el); });
        const missing = list.find((_, i) => !found[i]);
        if (missing != null) {
          setHiddenId(Number(missing));
          timers.current.push(window.setTimeout(() => setHiddenId(null), NOTICE_MS));
        }
        return;
      }
      timers.current.push(window.setTimeout(tick, POLL_MS));
    };
    timers.current.push(window.setTimeout(tick, START_MS));
  }, []);

  const notice = hiddenId == null ? null : (
    <Notice role="status" data-testid="qtask-added-hidden">
      <span>{t('added.hiddenByView', '방금 추가한 업무는 지금 보기(탭·필터·검색)에는 안 보여요')}</span>
      <OpenBtn type="button" onClick={() => { const id = hiddenId; setHiddenId(null); onOpen(id); }}>
        {t('added.open', '열기')}
      </OpenBtn>
      <CloseBtn type="button" aria-label={t('added.dismiss', '닫기') as string} onClick={() => setHiddenId(null)}>×</CloseBtn>
    </Notice>
  );

  return { reveal, notice };
}

const Notice = styled.div`
  position: fixed; left: 50%; transform: translateX(-50%);
  bottom: calc(24px + var(--pq-safe-bottom, 0px));
  z-index: 60; display: flex; align-items: center; gap: 10px;
  max-width: calc(100vw - 32px); padding: 10px 10px 10px 16px;
  background: #0F172A; color: #F8FAFC; border-radius: 10px;
  box-shadow: 0 8px 24px rgba(15, 23, 42, 0.25);
  font-size: 0.8125rem; line-height: 1.4;
`;
const OpenBtn = styled.button`
  flex-shrink: 0; min-height: 36px; padding: 0 14px; border: none; border-radius: 8px;
  background: #14B8A6; color: #FFFFFF; font-size: 0.8125rem; font-weight: 600; cursor: pointer;
  &:hover { background: #0D9488; }
`;
const CloseBtn = styled.button`
  flex-shrink: 0; width: 36px; height: 36px; border: none; background: transparent;
  color: #94A3B8; font-size: 1.125rem; cursor: pointer; border-radius: 8px;
  &:hover { color: #F8FAFC; background: rgba(255, 255, 255, 0.08); }
`;
