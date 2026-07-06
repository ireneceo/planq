// #117 — Cue(워크스페이스 AI 팀원) 친절 안내. 여러 접점(업무 담당자·채팅·업무 결과 배지 등)에
//   재사용하는 작은 "Cue란?" 팝오버. 클릭 시 Cue 가 무엇을 하는지 쉬운 말로 설명.
import React, { useEffect, useRef, useState } from 'react';
import styled from 'styled-components';
import { useTranslation } from 'react-i18next';

const CueTip: React.FC<{ compact?: boolean }> = ({ compact = false }) => {
  const { t } = useTranslation('common');
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLSpanElement>(null);

  useEffect(() => {
    if (!open) return;
    const onDoc = (e: MouseEvent) => { if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false); };
    const onEsc = (e: KeyboardEvent) => { if (e.key === 'Escape') setOpen(false); };
    document.addEventListener('mousedown', onDoc);
    document.addEventListener('keydown', onEsc);
    return () => { document.removeEventListener('mousedown', onDoc); document.removeEventListener('keydown', onEsc); };
  }, [open]);

  return (
    <Wrap ref={ref}>
      <TipBtn type="button" onClick={(e) => { e.stopPropagation(); setOpen((v) => !v); }}
        $active={open} aria-label={t('cueTip.aria', 'Cue 란?') as string} title={t('cueTip.aria', 'Cue 란?') as string}>
        {compact ? '?' : t('cueTip.label', 'Cue?')}
      </TipBtn>
      {open && (
        <Pop role="dialog" onClick={(e) => e.stopPropagation()}>
          <PopHead>
            <Star aria-hidden>★</Star>
            {t('cueTip.title', 'Cue — 워크스페이스 AI 팀원')}
          </PopHead>
          <PopBody>{t('cueTip.body', '업무를 맡기면 알아서 처리하고, 고객 채팅에 답하고, 자료를 요약·정리해요. 사람 팀원처럼 담당자로 지정하거나 대화에 부를 수 있어요.')}</PopBody>
          <PopList>
            <li>{t('cueTip.point1', '업무 담당자로 지정 → 결과물 자동 생성')}</li>
            <li>{t('cueTip.point2', '고객 채팅 자동 응답 (내가 확인 후 발송)')}</li>
            <li>{t('cueTip.point3', '자료·회의 내용 요약과 정리')}</li>
          </PopList>
        </Pop>
      )}
    </Wrap>
  );
};

const Wrap = styled.span`position:relative;display:inline-flex;`;
const TipBtn = styled.button<{ $active?: boolean }>`
  display:inline-flex;align-items:center;justify-content:center;height:18px;min-width:18px;padding:0 6px;
  font-size:10px;font-weight:700;line-height:1;cursor:pointer;font-family:inherit;
  border-radius:999px;border:1px solid ${p => p.$active ? '#F43F5E' : '#FECDD3'};
  background:${p => p.$active ? '#FFE4E6' : '#FFF1F2'};color:#9F1239;
  &:hover{border-color:#F43F5E;background:#FFE4E6;}
`;
const Pop = styled.div`
  position:absolute;top:calc(100% + 6px);left:0;z-index:200;width:260px;max-width:78vw;
  background:#FFFFFF;border:1px solid #FECDD3;border-radius:12px;padding:12px 14px;
  box-shadow:0 12px 32px rgba(159,18,57,0.14);
  @media (max-width:640px){ left:auto; right:0; }
`;
const PopHead = styled.div`display:flex;align-items:center;gap:6px;font-size:12px;font-weight:800;color:#9F1239;margin-bottom:6px;`;
const Star = styled.span`color:#F43F5E;font-size:12px;line-height:1;`;
const PopBody = styled.p`margin:0 0 8px;font-size:12px;line-height:1.6;color:#334155;`;
const PopList = styled.ul`margin:0;padding-left:16px;display:flex;flex-direction:column;gap:3px;
  li{font-size:11px;line-height:1.5;color:#64748B;}`;

export default CueTip;
