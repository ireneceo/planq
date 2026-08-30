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
import styled from 'styled-components';
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
  width?: number;               // 명시 폭 override. 미지정 시 wide 여부로 결정
  wide?: boolean;               // 복합 다중섹션 폼 — OVERLAY_DRAWER.wide(560). 기본 false → 480
  ariaLabel?: string;
  leftSlot?: React.ReactNode;   // 푸터 좌측 보조 슬롯(옵션)
}

const CreateDrawer: React.FC<CreateDrawerProps> = ({
  open, onClose, title, children,
  onSubmit, submitting, submitLabel, submitDisabled, submitTone = 'primary',
  width, wide, ariaLabel, leftSlot,
}) => {
  const resolvedWidth = width ?? (wide ? OVERLAY_DRAWER.wide : OVERLAY_DRAWER.default);
  const { t } = useTranslation('common');
  const label = ariaLabel || (typeof title === 'string' ? title : undefined);

  return (
    <DetailDrawer open={open} onClose={onClose} width={resolvedWidth} ariaLabel={label}>
      <DetailDrawer.Header onClose={onClose}><DrawerTitle>{title}</DrawerTitle></DetailDrawer.Header>
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

// 운영 #265 — "제목이 없는데? 이 팝업만 헤더가 달라 보여".
//   DetailDrawer.Header 의 HeaderContent 에는 타이포그래피가 없다(자체 제목을 넣는 상세 드로어들을
//   위해 의도적으로 비어 있다). CreateDrawer 는 title 을 **문자열**로 받아 그대로 흘려보내고 있어서
//   제목이 본문 텍스트 크기로 렌더됐다. 표준값은 페이지 헤더와 같은 18px/700/-0.2px
//   (CLAUDE.md '페이지 레이아웃 표준' — PageShell·PanelHeader 와 한 몸으로 보이게).
//   ★ 스타일은 여기(CreateDrawer)에만 둔다 — DetailDrawer 쪽에 넣으면 자체 제목을 가진
//     십수 개 상세 드로어로 캐스케이드돼 이중 스타일이 된다.
const DrawerTitle = styled.div`
  font-size: 1.125rem; font-weight: 700; letter-spacing: -0.2px; color: #0F172A;
  line-height: 1.35;
  overflow: hidden; text-overflow: ellipsis; white-space: nowrap;
`;
