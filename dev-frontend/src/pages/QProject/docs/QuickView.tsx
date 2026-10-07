// 파일 목록 «빠른 보기» — 우측 패널 없이 크게 본다(2026-10-07 Irene: «크게보기는 목록에도 … 무조건 우측패널 열리는 거 불편해»).
//   버튼: 데스크탑은 카드·행에 올렸을 때(또는 키보드 초점) 나타나고, 터치 폭(≤1024)은 늘 보인다(hover 가 없다).
//     ★ 분기를 (hover:none) 으로 두지 않는다 — 헤드리스가 hover:none 이라 그 분기는 측정이 안 된다(CLAUDE.md 트리 계약).
//   창: 상세 패널과 **같은 부품**(PreviewArea mode='full') — 목록과 상세가 다른 것을 보여 주지 않는다.
import React from 'react';
import styled from 'styled-components';
import { useTranslation } from 'react-i18next';
import StandardModal from '../../../components/Common/StandardModal';
import PreviewArea, { canQuickView } from './PreviewArea';
import type { ProjectFile } from '../../../services/files';

export const QuickViewButton: React.FC<{ file: ProjectFile; onCard?: boolean; onOpen: (f: ProjectFile) => void }> = ({ file, onCard, onOpen }) => {
  const { t } = useTranslation('qproject');
  if (!canQuickView(file)) return null;
  const label = t('docs.preview.quickView', '크게 보기') as string;
  return (
    <Btn type="button" data-testid="file-quickview" $onCard={onCard} title={label} aria-label={label}
      onClick={(e) => { e.stopPropagation(); onOpen(file); }}>
      <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
        <circle cx="11" cy="11" r="7" /><line x1="21" y1="21" x2="16.65" y2="16.65" /><line x1="11" y1="8" x2="11" y2="14" /><line x1="8" y1="11" x2="14" y2="11" />
      </svg>
    </Btn>
  );
};

export const QuickViewModal: React.FC<{ file: ProjectFile | null; businessId: number; onClose: () => void }> = ({ file, businessId, onClose }) => (
  <StandardModal open={!!file} onClose={onClose} title={file?.file_name || ''} size="full">
    <StandardModal.Body data-testid="file-quickview-full">
      {file && <PreviewArea key={file.id} file={file} businessId={businessId} mode="full" />}
    </StandardModal.Body>
  </StandardModal>
);

const Btn = styled.button<{ $onCard?: boolean }>`
  ${(p) => (p.$onCard ? 'position:absolute;right:8px;bottom:8px;z-index:2;' : 'margin-left:auto;flex-shrink:0;')}
  width:32px;height:32px;display:inline-flex;align-items:center;justify-content:center;
  border:1px solid #E2E8F0;border-radius:8px;background:rgba(255,255,255,0.95);color:#334155;cursor:zoom-in;
  box-shadow:0 1px 3px rgba(15,23,42,0.12);
  opacity:0;transition:opacity .12s;
  &:hover{color:#0F766E;border-color:#14B8A6;background:#fff;}
  &:focus-visible{opacity:1;outline:2px solid #14B8A6;outline-offset:2px;}
  [data-testid="file-card"]:hover &, [data-file-id]:hover &{opacity:1;}
  @media (max-width:1024px){opacity:1;width:36px;height:36px;}
`;
