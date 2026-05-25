// Visibility 변경 모달 — 사이클 N+9 (N+66 리팩토링: 내부 VisibilityField 사용)
//
// 4 단계 통일 (L1 본인 / L2 팀 / L3 워크스페이스 / L4 외부).
// L4 (외부 공개) 옵션 — onOpenShare 제공 시 라디오에서 hide 처리되고 별도 link 로 안내.
//
// onConfirm({ level, projectId?, targetMemberIds? }) — L2 분기에 따라 sub-target 전달.
import React, { useState, useEffect } from 'react';
import styled from 'styled-components';
import { useTranslation } from 'react-i18next';
import type { VLevel } from './VisibilityBadge';
import VisibilityField, { serializeVisibility, type VisibilityValue, type VVariant } from './VisibilityField';

interface Props {
  open: boolean;
  current: VLevel;
  canChooseL2?: boolean;
  projects?: Array<{ id: number; name: string }>;
  members?: Array<{ user_id: number; name: string; role: string }>;
  clients?: Array<{ id: number; display_name?: string | null; biz_name?: string | null; company_name?: string | null }>;
  // L2-project 또는 L2-members 선택 시 projectId/targetMemberIds 한쪽만 전달
  onConfirm: (next: { level: 'L1' | 'L2' | 'L3' | 'L4'; projectId?: number; targetMemberIds?: number[]; targetClientIds?: number[] }) => Promise<void> | void;
  onClose: () => void;
  onOpenShare?: () => void;  // L4 → ShareModal 안내 (제공 시 L4 라디오 hide)
}

const VisibilityChangeModal: React.FC<Props> = ({ open, current, canChooseL2 = true, projects = [], members = [], clients = [], onConfirm, onClose, onOpenShare }) => {
  const { t } = useTranslation('common');
  const cur = (current || 'L3') as string;
  const initial: VisibilityValue = {
    vlevel: (['L1','L2','L3','L4'].includes(cur) ? cur : 'L3') as VisibilityValue['vlevel'],
    variant: (['L1','L3','L4'].includes(cur) ? cur : 'L2_project') as VVariant,
    project_id: null,
    client_ids: [],
    target_member_ids: [],
  };
  const [vis, setVis] = useState<VisibilityValue>(initial);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (open) setVis(initial);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, current]);

  if (!open) return null;

  const submit = async () => {
    if (busy) return;
    // L2-project 인데 projectId 미선택 차단
    if (vis.variant === 'L2_project' && canChooseL2 && projects.length > 0 && !vis.project_id) return;
    if (vis.variant === 'L2_members' && vis.target_member_ids.length === 0) return;
    if (vis.variant === 'L4' && vis.client_ids.length === 0) return;
    setBusy(true);
    try {
      const ser = serializeVisibility(vis);
      await onConfirm({
        level: vis.vlevel,
        projectId: vis.variant === 'L2_project' ? (ser.project_id || undefined) : undefined,
        targetMemberIds: vis.variant === 'L2_members' ? ser.target_member_ids : undefined,
        targetClientIds: vis.variant === 'L4' ? ser.client_ids : undefined,
      });
      onClose();
    } finally {
      setBusy(false);
    }
  };

  // L4 는 onOpenShare 있을 때 hide — 외부 공유는 별도 ShareModal 흐름 사용
  const hide = onOpenShare ? { L4: true } as const : {};

  return (
    <Backdrop role="dialog" aria-modal="true" onClick={onClose}>
      <Card onClick={(e) => e.stopPropagation()}>
        <Title>{t('vault.changeVis.title', { defaultValue: '공개 범위 변경' }) as string}</Title>
        <Hint>{t('vault.changeVis.hint', { defaultValue: '누가 이 자료를 볼 수 있는지 선택하세요.' }) as string}</Hint>

        {/* N+66 — 공통 VisibilityField 사용 (등록/상세 패널과 동일 UI) */}
        <VisibilityField
          value={vis}
          onChange={setVis}
          projects={projects}
          clients={clients}
          members={members}
          hide={hide}
        />

        {onOpenShare && (
          <ExternalLink type="button" onClick={() => { onClose(); onOpenShare(); }}>
            {t('vault.changeVis.external', { defaultValue: '외부에 공유 링크로 보내기 →' }) as string}
          </ExternalLink>
        )}

        <Actions>
          <Secondary type="button" onClick={onClose}>{t('vault.changeVis.cancel', { defaultValue: '취소' }) as string}</Secondary>
          <Primary type="button"
            disabled={busy
              || (vis.variant === 'L2_project' && canChooseL2 && projects.length > 0 && !vis.project_id)
              || (vis.variant === 'L2_members' && vis.target_member_ids.length === 0)
              || (vis.variant === 'L4' && vis.client_ids.length === 0)}
            onClick={submit}>
            {busy ? t('vault.changeVis.saving', { defaultValue: '저장 중...' }) as string : t('vault.changeVis.save', { defaultValue: '적용' }) as string}
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
  width: 100%; max-width: 560px;
  background: #FFFFFF; border-radius: 14px; padding: 24px 24px 20px;
  display: flex; flex-direction: column; gap: 12px;
  box-shadow: 0 20px 60px rgba(15,23,42,0.25);
  max-height: 90vh; overflow-y: auto;
  @media (max-width: 640px) { padding: 20px 16px; }
`;
const Title = styled.h2` margin: 0; font-size: 16px; font-weight: 700; color: #0F172A; `;
const Hint = styled.p` margin: 0; font-size: 12px; color: #64748B; line-height: 1.5; `;
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
