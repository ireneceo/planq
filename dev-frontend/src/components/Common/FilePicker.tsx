// 공용 파일 선택 모달/드로어 — KnowledgePage 새 지식 등록 폼과 동일한 UI 패턴.
// 한 화면에 "새 파일 업로드" + "기존 파일 검색·연결" 둘 다 같이.
// 호출부가 onPick 으로 결과를 받아 자체 API 호출.
//   - uploaded: 로컬 File 배열 (멀티 업로드)
//   - existing: 워크스페이스에 이미 있는 파일 id 배열 (참조 링크)
//
// 변경 (2026-05-03): 탭 두 개 → 한 화면 통합. AttachmentField 컴포넌트 재사용.
import React, { useEffect, useState } from 'react';
import styled from 'styled-components';
import { useTranslation } from 'react-i18next';
import DetailDrawer from './DetailDrawer';
import AttachmentField from './AttachmentField';
import { useBodyScrollLock } from '../../hooks/useBodyScrollLock';
import { useEscapeStack } from '../../hooks/useEscapeStack';

export interface FilePickerResult {
  uploaded?: File[];
  existingFileIds?: number[];
  existingPostIds?: number[];
}

interface Props {
  open: boolean;
  onClose: () => void;
  businessId: number;
  onPick: (result: FilePickerResult) => Promise<void> | void;
  title?: string;
  accept?: string;
  multiple?: boolean;              // default true
  mode?: 'both' | 'upload' | 'existing';  // 호환용 — 새 통합 UI 에선 항상 둘 다 표시
  variant?: 'drawer' | 'modal';    // default 'drawer' — 편집 폼 내부엔 'modal' 권장
  // 옵션 — Q Talk 채팅 첨부에선 기존 문서(post)도 같이 첨부 가능하게
  includePosts?: boolean;
}

const FilePicker: React.FC<Props> = ({
  open, onClose, businessId, onPick, title, accept, variant = 'drawer', includePosts = false,
}) => {
  const { t } = useTranslation('common');
  const [uploads, setUploads] = useState<File[]>([]);
  const [existingIds, setExistingIds] = useState<number[]>([]);
  const [existingPostIds, setExistingPostIds] = useState<number[]>([]);
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    if (!open) {
      setUploads([]);
      setExistingIds([]);
      setExistingPostIds([]);
    }
  }, [open]);

  const totalPicked = uploads.length + existingIds.length + existingPostIds.length;
  const canSubmit = totalPicked > 0;

  const onSubmit = async () => {
    if (!canSubmit || submitting) return;
    setSubmitting(true);
    try {
      const result: FilePickerResult = {};
      if (uploads.length > 0) result.uploaded = uploads;
      if (existingIds.length > 0) result.existingFileIds = existingIds;
      if (existingPostIds.length > 0) result.existingPostIds = existingPostIds;
      await onPick(result);
      onClose();
    } finally { setSubmitting(false); }
  };

  const headerNode = <Title>{title || t('filepicker.title', '파일 선택')}</Title>;

  const bodyNode = (
    <BodyInner>
      <AttachmentField
        businessId={businessId}
        uploads={uploads}
        onUploadsChange={setUploads}
        existingFileIds={existingIds}
        onExistingFileIdsChange={setExistingIds}
        includePosts={includePosts}
        existingPostIds={existingPostIds}
        onExistingPostIdsChange={setExistingPostIds}
        accept={accept}
      />
    </BodyInner>
  );

  const footerNode = (
    <>
      <Spacer />
      <SecondaryBtn type="button" disabled={submitting} onClick={onClose}>
        {t('cancel', '취소') as string}
      </SecondaryBtn>
      <PrimaryBtn type="button" disabled={!canSubmit || submitting} onClick={onSubmit}>
        {submitting
          ? (t('saving', '처리 중…') as string)
          : (t('filepicker.attach', `첨부 ({{n}})`, { n: totalPicked }) as string)}
      </PrimaryBtn>
    </>
  );

  if (variant === 'modal') {
    return (
      <ModalShell open={open} onClose={onClose}
        title={title || (t('filepicker.title', '파일 선택') as string)}
        body={bodyNode} footer={footerNode}
      />
    );
  }

  return (
    <DetailDrawer open={open} onClose={onClose} width={480} ariaLabel={title || t('filepicker.title', '파일 선택') as string}>
      <DetailDrawer.Header onClose={onClose}>{headerNode}</DetailDrawer.Header>
      <DetailDrawer.Body>{bodyNode}</DetailDrawer.Body>
      <DetailDrawer.Footer>{footerNode}</DetailDrawer.Footer>
    </DetailDrawer>
  );
};

// 센터 모달 껍데기 — 편집 폼 안에서 호출할 때 사용
const ModalShell: React.FC<{
  open: boolean; onClose: () => void;
  title: string;
  body: React.ReactNode;
  footer: React.ReactNode;
}> = ({ open, onClose, title, body, footer }) => {
  useBodyScrollLock(open);
  useEscapeStack(open, onClose);
  if (!open) return null;
  return (
    <Backdrop onClick={onClose}>
      <Dialog onClick={e => e.stopPropagation()} role="dialog" aria-modal="true" aria-label={title}>
        <Header>
          <Title>{title}</Title>
          <CloseBtn type="button" onClick={onClose} aria-label="close">
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><path d="M18 6L6 18M6 6l12 12"/></svg>
          </CloseBtn>
        </Header>
        <Body>{body}</Body>
        <Footer>{footer}</Footer>
      </Dialog>
    </Backdrop>
  );
};

export default FilePicker;

// ─── styled ───
const Title = styled.h3`font-size: 15px; font-weight: 700; color: #0F172A; margin: 0;`;
const Spacer = styled.span`flex: 1;`;
const SecondaryBtn = styled.button`
  height: 36px; padding: 0 14px;
  background: #FFFFFF; color: #475569;
  border: 1px solid #E2E8F0; border-radius: 8px;
  font-size: 13px; font-weight: 600; cursor: pointer;
  &:hover:not(:disabled) { background: #F8FAFC; border-color: #CBD5E1; }
  &:disabled { opacity: 0.5; cursor: not-allowed; }
`;
const PrimaryBtn = styled.button`
  height: 36px; padding: 0 18px;
  background: #14B8A6; color: #FFFFFF;
  border: none; border-radius: 8px;
  font-size: 13px; font-weight: 600; cursor: pointer;
  &:hover:not(:disabled) { background: #0D9488; }
  &:disabled { background: #CBD5E1; cursor: not-allowed; }
`;

const BodyInner = styled.div`
  display: flex; flex-direction: column; gap: 0;
  padding: 4px 0;
`;

// modal variant styled
const Backdrop = styled.div`
  position: fixed; inset: 0; background: rgba(15,23,42,0.4);
  display: flex; align-items: center; justify-content: center; z-index: 1100;
  padding: 20px;
`;
const Dialog = styled.div`
  background: #fff; border-radius: 14px;
  width: 100%; max-width: 560px;
  max-height: 90vh; display: flex; flex-direction: column;
  box-shadow: 0 24px 48px rgba(15,23,42,0.18);
  @media (max-width: 640px) { max-height: 100vh; height: 100vh; border-radius: 0; }
`;
const Header = styled.div`
  display: flex; align-items: center; justify-content: space-between;
  padding: 18px 22px 14px; border-bottom: 1px solid #F1F5F9;
  flex-shrink: 0;
`;
const CloseBtn = styled.button`
  width: 28px; height: 28px;
  display: inline-flex; align-items: center; justify-content: center;
  background: transparent; border: none; border-radius: 6px;
  color: #64748B; cursor: pointer;
  &:hover { background: #F1F5F9; color: #0F172A; }
`;
const Body = styled.div`
  flex: 1; overflow-y: auto; padding: 16px 22px; min-height: 0;
`;
const Footer = styled.div`
  display: flex; gap: 8px; align-items: center;
  padding: 14px 22px; border-top: 1px solid #F1F5F9;
  flex-shrink: 0; background: #fff;
`;
