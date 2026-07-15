// CreateDrawer — 신규 엔티티 '추가/등록' 전용 우측 드로어 (Fable 감사 2026-07-15 통일 표준).
//
// PlanQ 전반이 "우측 패널로 보는" 구조라, 생성 폼도 센터 모달이 아니라 상세 조회와 같은 자리
// (우측 오버레이 드로어)에 나타나야 일관적이다. 이 컴포넌트는 공통 DetailDrawer 위에
//   · 표준 헤더(제목 + 닫기 X)
//   · 표준 푸터(취소 + Primary 제출, 중복제출 가드)
// 를 얹은 얇은 컨벤션이다. 접근성(scroll lock·focus trap·Esc·backdrop·aria-modal)은 DetailDrawer 내장.
//
// 사용:
//   <CreateDrawer open={creating} onClose={close} title={t('event.new')}
//       onSubmit={save} submitting={submitting} submitLabel={t('common:save')}>
//     {/* 폼 필드 */}
//   </CreateDrawer>
//
// 규칙(UI_DESIGN_GUIDE §1.8): 제출 버튼은 submitting 중 disabled(중복 제출 차단).
// Enter 단독 저장 금지 — 폼 내부에서 Ctrl/Cmd+Enter 만 onSubmit 에 연결할 것.
import React from 'react';
import { useTranslation } from 'react-i18next';
import DetailDrawer from './DetailDrawer';
import DrawerFooter from './DrawerFooter';
import ActionButton from './ActionButton';
import { OVERLAY_DRAWER } from '../../theme/panelWidth';

export interface CreateDrawerProps {
  open: boolean;
  onClose: () => void;
  title: React.ReactNode;
  children: React.ReactNode;
  onSubmit: () => void;
  submitting?: boolean;         // 중복 제출 가드 — 제출 중 버튼 disabled
  submitLabel?: React.ReactNode; // 기본 common:save
  submitDisabled?: boolean;     // 폼 유효성 실패 등으로 제출 비활성
  submitTone?: 'primary' | 'danger';
  width?: number;               // 기본 OVERLAY_DRAWER.default(480). 복합 폼은 OVERLAY_DRAWER.wide
  ariaLabel?: string;
  leftSlot?: React.ReactNode;   // 푸터 좌측 보조 슬롯(옵션)
}

const CreateDrawer: React.FC<CreateDrawerProps> = ({
  open, onClose, title, children,
  onSubmit, submitting, submitLabel, submitDisabled, submitTone = 'primary',
  width = OVERLAY_DRAWER.default, ariaLabel, leftSlot,
}) => {
  const { t } = useTranslation('common');
  const label = ariaLabel || (typeof title === 'string' ? title : undefined);

  return (
    <DetailDrawer open={open} onClose={onClose} width={width} ariaLabel={label}>
      <DetailDrawer.Header onClose={onClose}>{title}</DetailDrawer.Header>
      <DetailDrawer.Body>{children}</DetailDrawer.Body>
      <DrawerFooter left={leftSlot} align={leftSlot ? 'space-between' : 'right'}>
        <ActionButton tone="secondary" size="md" onClick={onClose} disabled={submitting}>
          {t('cancel')}
        </ActionButton>
        <ActionButton
          tone={submitTone}
          size="md"
          onClick={onSubmit}
          loading={submitting}
          disabled={submitDisabled}
        >
          {submitLabel || t('save')}
        </ActionButton>
      </DrawerFooter>
    </DetailDrawer>
  );
};

export default CreateDrawer;
