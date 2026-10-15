// 팝아웃 업무리스트 맨 위 «긴급 요청» 띠 (2026-10-15, Irene: *"긴급으로 선택한 업무요청은 … 팝아웃 업무리스트에도 보내고 … 무조건 보게"*)
//
//   데이터 = /api/tasks/my-week 의 `urgent_requests`(나에게 온 **미확인 긴급 요청** — 서버 술어 services/urgentTaskNotify).
//   이번 주 목록과 따로 싣는 이유: 마감이 없거나 다음 주인 요청은 이번 주 집합에 안 들어와 목록에서 안 보인다.
//   · 새 요청이 생기면 소리 한 번 + 창이 뒤에 있으면 창 제목이 깜빡인다(팝아웃은 앱 안 토스트를 일부러 끈 창이다 — #84).
//   · [확인] = 요청 확인(ack) — 확인필요 «요청 확인» 과 같은 문(POST /api/tasks/:id/ack). 확인하면 띠에서 빠진다.
//   · 제목을 누르면 이 창의 업무 상세가 열린다.
import React, { useEffect, useRef, useState } from 'react';
import styled from 'styled-components';
import { useTranslation } from 'react-i18next';
import { apiFetch } from '../../contexts/AuthContext';
import { listRowTitleCss } from '../../theme/tokens';

export interface UrgentRequestItem {
  id: number;
  title: string;
  due_date?: string | null;
  requester?: { id: number; name: string } | null;
}

interface Props {
  items: UrgentRequestItem[];
  onOpen: (id: number) => void;
  onAcked: () => void;
}

const PING_MP3 = '/sounds/notification.mp3';

const PopoutUrgentBand: React.FC<Props> = ({ items, onOpen, onAcked }) => {
  const { t } = useTranslation('qtask');
  const [busyId, setBusyId] = useState<number | null>(null);
  const [failed, setFailed] = useState(false);
  const seenRef = useRef<Set<number> | null>(null);

  // 새로 생긴 긴급 요청에만 소리 — 첫 로드(창을 연 순간)는 띠가 보이는 것으로 충분하다.
  useEffect(() => {
    const ids = items.map((i) => i.id);
    if (seenRef.current === null) { seenRef.current = new Set(ids); return; }
    const fresh = ids.some((id) => !seenRef.current!.has(id));
    ids.forEach((id) => seenRef.current!.add(id));
    if (fresh) {
      try { const a = new Audio(PING_MP3); a.volume = 0.8; a.play().catch(() => { /* 자동재생 차단 — 띠·제목 깜빡임이 남는다 */ }); } catch { /* ignore */ }
    }
  }, [items]);

  // 창이 뒤에 있는 동안 제목 깜빡임 — 작업표시줄·탭에서 보이게. 앞으로 오면 원래 제목으로.
  const count = items.length;
  const flashText = t('popout.urgent.flash', { n: count, defaultValue: '(긴급 요청 {{n}}건)' }) as string;
  useEffect(() => {
    if (!count) return;
    const base = document.title;
    let on = false;
    const id = window.setInterval(() => {
      if (document.visibilityState === 'visible' && document.hasFocus()) { if (on) { document.title = base; on = false; } return; }
      on = !on;
      document.title = on ? `${flashText} ${base}` : base;
    }, 1000);
    return () => { window.clearInterval(id); document.title = base; };
  }, [count, flashText]);

  if (!count) return null;

  const ack = async (id: number) => {
    if (busyId) return;
    setBusyId(id);
    setFailed(false);
    try {
      const r = await apiFetch(`/api/tasks/${id}/ack`, { method: 'POST' });
      // apiFetch 는 throw 하지 않는다 — res.ok 를 본다
      if (!r.ok) throw new Error(String(r.status));
      onAcked();
    } catch {
      setFailed(true);
    } finally {
      setBusyId(null);
    }
  };

  return (
    <Band role="region" aria-label={t('popout.urgent.title', '긴급 요청') as string} data-testid="task-popout-urgent">
      <BandHead>
        <Mark aria-hidden>!</Mark>
        {t('popout.urgent.head', { n: count, defaultValue: '긴급 요청 {{n}}건 — 확인해 주세요' })}
      </BandHead>
      {items.map((it) => (
        <Item key={it.id} data-testid="task-popout-urgent-item">
          <ItemMain type="button" onClick={() => onOpen(it.id)}>
            <ItemTitle>{it.title}</ItemTitle>
            <ItemMeta>
              {it.requester?.name ? t('popout.urgent.from', { name: it.requester.name, defaultValue: '{{name}} 님 요청' }) : ''}
              {it.due_date ? ` · ${t('popout.urgent.due', { date: String(it.due_date).slice(0, 10), defaultValue: '마감 {{date}}' })}` : ''}
            </ItemMeta>
          </ItemMain>
          <AckBtn type="button" disabled={busyId !== null} onClick={() => ack(it.id)} data-testid="task-popout-urgent-ack">
            {busyId === it.id ? '…' : t('popout.urgent.ack', '확인')}
          </AckBtn>
        </Item>
      ))}
      {failed && <ErrLine role="alert">{t('popout.urgent.ackFailed', '확인하지 못했습니다. 다시 눌러 주세요.')}</ErrLine>}
    </Band>
  );
};

export default PopoutUrgentBand;

const Band = styled.div`
  flex-shrink: 0;
  margin: 8px 12px 0;
  padding: 8px 10px;
  background: #FFF1F2;
  border: 1px solid #FECDD3;
  border-left: 4px solid #E11D48;
  border-radius: 8px;
  display: flex;
  flex-direction: column;
  gap: 6px;
`;
const BandHead = styled.div`
  display: flex; align-items: center; gap: 6px;
  font-size: 0.8125rem; font-weight: 700; color: #BE123C;
`;
const Mark = styled.span`
  display: inline-block; padding: 0 6px; line-height: 1.5; border-radius: 4px;
  background: #E11D48; color: #FFFFFF; font-size: 0.75rem; font-weight: 800;
`;
const Item = styled.div`
  display: flex; align-items: center; gap: 8px;
  background: #FFFFFF; border: 1px solid #FECDD3; border-radius: 6px; padding: 4px 4px 4px 8px;
`;
const ItemMain = styled.button`
  flex: 1 1 auto; min-width: 0; min-height: 36px;
  display: flex; flex-direction: column; align-items: flex-start; justify-content: center;
  background: transparent; border: none; padding: 0; cursor: pointer; text-align: left; font-family: inherit;
`;
const ItemTitle = styled.span`
  max-width: 100%; ${listRowTitleCss} color: #0F172A;
  white-space: nowrap; overflow: hidden; text-overflow: ellipsis;
`;
const ItemMeta = styled.span`
  max-width: 100%; font-size: 0.6875rem; color: #64748B;
  white-space: nowrap; overflow: hidden; text-overflow: ellipsis;
`;
const AckBtn = styled.button`
  flex: 0 0 auto; height: 36px; min-width: 56px; padding: 0 12px;
  font-size: 0.8125rem; font-weight: 600; color: #FFFFFF; background: #14B8A6;   /* Primary — 상태 색(빨강)은 띠가 말한다 */
  border: none; border-radius: 6px; cursor: pointer; font-family: inherit;
  &:hover:not(:disabled) { background: #0D9488; }
  &:disabled { opacity: 0.6; cursor: default; }
  &:focus-visible { outline: none; box-shadow: 0 0 0 2px rgba(20, 184, 166, 0.3); }
`;
const ErrLine = styled.div`font-size: 0.75rem; color: #BE123C;`;
