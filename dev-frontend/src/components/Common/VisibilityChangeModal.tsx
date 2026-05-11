// Visibility 변경 모달 — 사이클 N+9
//
// 4 단계 (L1 본인 / L2 팀 / L3 워크스페이스 / L4 외부) 중 하나 선택.
// L4 (외부 공개) 는 ShareModal 인프라 (share_token) 안내만, 모달 안에서 직접 변경 X.
//
// onConfirm({ level, projectId? }) — L2 선택 시 projectId 필요 (현재 project_id 없으면).
import React, { useState } from 'react';
import styled from 'styled-components';
import { useTranslation } from 'react-i18next';
import type { VLevel } from './VisibilityBadge';

interface Props {
  open: boolean;
  current: VLevel;
  canChooseL2?: boolean;  // project 선택 가능 여부 (사용자가 어떤 프로젝트 멤버인지 부모가 알려야)
  projects?: Array<{ id: number; name: string }>;
  onConfirm: (next: { level: 'L1' | 'L2' | 'L3'; projectId?: number }) => Promise<void> | void;
  onClose: () => void;
  onOpenShare?: () => void;  // L4 안내 → ShareModal 열기
}

const VisibilityChangeModal: React.FC<Props> = ({ open, current, canChooseL2 = true, projects = [], onConfirm, onClose, onOpenShare }) => {
  const { t } = useTranslation('common');
  const [picked, setPicked] = useState<'L1' | 'L2' | 'L3'>(
    (current === 'L1' || current === 'L2' || current === 'L3') ? current : 'L3'
  );
  const [projectId, setProjectId] = useState<number | null>(null);
  const [busy, setBusy] = useState(false);

  if (!open) return null;

  const submit = async () => {
    if (busy) return;
    if (picked === 'L2' && canChooseL2 && projects.length > 0 && !projectId) return;
    setBusy(true);
    try {
      await onConfirm({ level: picked, projectId: picked === 'L2' ? (projectId || undefined) : undefined });
      onClose();
    } finally {
      setBusy(false);
    }
  };

  return (
    <Backdrop role="dialog" aria-modal="true" onClick={onClose}>
      <Card onClick={(e) => e.stopPropagation()}>
        <Title>{t('vault.changeVis.title', '공개 범위 변경') as string}</Title>
        <Hint>{t('vault.changeVis.hint', '누가 이 자료를 볼 수 있는지 선택하세요.') as string}</Hint>

        <Options role="radiogroup">
          {(['L1', 'L2', 'L3'] as const).map(lv => (
            <Opt key={lv} type="button" role="radio" aria-checked={picked === lv}
              $active={picked === lv} onClick={() => setPicked(lv)}>
              <OptTitle>
                {t(`vault.visLong.${lv}`, {
                  defaultValue: { L1: '본인만', L2: '프로젝트 멤버', L3: '워크스페이스 공개' }[lv]
                }) as string}
              </OptTitle>
              <OptDesc>
                {t(`vault.changeVis.${lv}Desc`, {
                  defaultValue: {
                    L1: '이 자료는 본인만 볼 수 있어요. 개인 보관함에 모입니다.',
                    L2: '선택한 프로젝트의 멤버만 볼 수 있어요.',
                    L3: '워크스페이스의 모든 멤버가 볼 수 있어요.',
                  }[lv]
                }) as string}
              </OptDesc>
            </Opt>
          ))}
        </Options>

        {picked === 'L2' && canChooseL2 && projects.length > 0 && (
          <ProjectRow>
            <ProjectLabel>{t('vault.changeVis.projectPick', '연결할 프로젝트') as string}</ProjectLabel>
            <ProjectSelect value={projectId ?? ''} onChange={(e) => setProjectId(e.target.value ? Number(e.target.value) : null)}>
              <option value="">{t('vault.changeVis.projectPlaceholder', '프로젝트 선택') as string}</option>
              {projects.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}
            </ProjectSelect>
          </ProjectRow>
        )}

        {onOpenShare && (
          <ExternalLink type="button" onClick={() => { onClose(); onOpenShare(); }}>
            {t('vault.changeVis.external', '외부에 공유 링크로 보내기 →') as string}
          </ExternalLink>
        )}

        <Actions>
          <Secondary type="button" onClick={onClose}>{t('vault.changeVis.cancel', '취소') as string}</Secondary>
          <Primary type="button" disabled={busy || (picked === 'L2' && canChooseL2 && projects.length > 0 && !projectId)} onClick={submit}>
            {busy ? t('vault.changeVis.saving', '저장 중...') as string : t('vault.changeVis.save', '적용') as string}
          </Primary>
        </Actions>
      </Card>
    </Backdrop>
  );
};

export default VisibilityChangeModal;

const Backdrop = styled.div`
  position: fixed; inset: 0; z-index: 9000;
  background: rgba(15, 23, 42, 0.5);
  display: flex; align-items: center; justify-content: center; padding: 16px;
`;
const Card = styled.div`
  width: 100%; max-width: 480px;
  background: #FFFFFF; border-radius: 14px; padding: 24px 24px 20px;
  display: flex; flex-direction: column; gap: 12px;
  box-shadow: 0 20px 60px rgba(15,23,42,0.25);
  @media (max-width: 640px) { padding: 20px 16px; }
`;
const Title = styled.h2` margin: 0; font-size: 16px; font-weight: 700; color: #0F172A; `;
const Hint = styled.p` margin: 0; font-size: 12px; color: #64748B; line-height: 1.5; `;
const Options = styled.div` display: flex; flex-direction: column; gap: 6px; margin-top: 4px; `;
const Opt = styled.button<{ $active: boolean }>`
  text-align: left; padding: 10px 12px; border-radius: 8px; cursor: pointer;
  border: 1px solid ${p => p.$active ? '#14B8A6' : '#E2E8F0'};
  background: ${p => p.$active ? '#F0FDFA' : '#FFFFFF'};
  display: flex; flex-direction: column; gap: 2px;
  &:hover { border-color: #CBD5E1; }
`;
const OptTitle = styled.div` font-size: 13px; font-weight: 600; color: #0F172A; `;
const OptDesc = styled.div` font-size: 11px; color: #64748B; line-height: 1.4; `;
const ProjectRow = styled.div` display: flex; flex-direction: column; gap: 4px; `;
const ProjectLabel = styled.label` font-size: 11px; font-weight: 600; color: #475569; `;
const ProjectSelect = styled.select`
  padding: 8px 10px; border: 1px solid #E2E8F0; border-radius: 6px; font-size: 13px;
  &:focus { outline: none; border-color: #14B8A6; }
`;
const ExternalLink = styled.button`
  align-self: flex-start; background: none; border: 0; padding: 4px 0;
  color: #C2410C; font-size: 12px; font-weight: 600; cursor: pointer; text-decoration: underline;
  &:hover { color: #9A3412; }
`;
const Actions = styled.div` display: flex; justify-content: flex-end; gap: 8px; margin-top: 8px; `;
const Primary = styled.button`
  padding: 8px 16px; border-radius: 8px; border: 0;
  background: #14B8A6; color: #fff; font-size: 13px; font-weight: 600; cursor: pointer;
  &:hover { background: #0D9488; }
  &:disabled { opacity: 0.5; cursor: not-allowed; }
`;
const Secondary = styled.button`
  padding: 8px 16px; border-radius: 8px;
  background: #fff; color: #334155; border: 1px solid #CBD5E1;
  font-size: 13px; font-weight: 500; cursor: pointer;
  &:hover { background: #F8FAFC; }
`;
