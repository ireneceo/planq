// 첨부파일 열기 — 미리보기 드로어 (다운로드는 그 안에서 선택).
//
// ★ #404 (Irene 2026-09-03): "첨부파일들 안열리고 그대로 다운로드 되는 거 불편해.
//    열리고 다운로드 할건지 기능 넣어야지. 매번 무슨 다운로드야?"
//   업무 첨부는 파일명을 누르면 곧장 내려받았다. 열어보려면 매번 내려받아야 했다는 뜻이다.
//   Q File 쪽은 이미 같은 지적(2026-08-31)을 받고 PreviewArea 로 앱 안에서 연다 —
//   업무 첨부만 규칙이 갈라져 있었다. 여기서 그 뷰어를 그대로 쓴다.
//
//   **베끼지 않고 한 곳에서 뺀다.** 업무 첨부(TaskAttachments)와 의뢰 첨부
//   (DescriptionAttachments)가 각자 드로어를 만들면 반드시 갈라진다.
import React, { useState } from 'react';
import styled from 'styled-components';
import { useTranslation } from 'react-i18next';
import DetailDrawer from './DetailDrawer';
import ActionButton from './ActionButton';
import { openDriveEditor } from '../../utils/driveEdit';
import { PreviewArea } from '../../pages/QProject/docs/PreviewArea';
import type { ProjectFile } from '../../services/files';

export interface PreviewAttachment {
  id: number;
  original_name: string;
  file_size: number;
  mime_type: string | null;
  download_url: string;
  preview_url: string | null;
  /** 이 첨부의 원본 File 레코드 id — 있으면 Drive 편집기로 열 수 있다(없으면 편집 버튼을 감춘다). */
  file_id?: number | null;
  /** 서버가 판단한 "Drive 편집 가능" — 실제 권한은 여는 순간 서버가 다시 본다. */
  drive_editable?: boolean;
}

interface Props {
  attachment: PreviewAttachment | null;
  businessId: number;
  onClose: () => void;
  onDownload: (a: PreviewAttachment) => void;
}

/** 첨부 행 → PreviewArea 가 받는 모양.
 *  id 는 반드시 `task-` 접두다. PreviewArea 의 영상·음성 분기는 `requestMediaUrl` 로
 *  **파일 id** 를 조회하는데, 첨부 id 를 `direct-` 로 넘기면 같은 번호의 **다른 파일**이
 *  열릴 수 있다. `task-` 는 그 조회가 null 을 돌려주고 폴백으로 떨어진다. */
function toProjectFile(a: PreviewAttachment): ProjectFile {
  return {
    id: `task-${a.id}`,
    source: 'task',
    file_name: a.original_name,
    file_size: a.file_size,
    mime_type: a.mime_type,
    uploader_id: null,
    uploader_name: '',
    uploaded_at: '',
    download_url: a.download_url,
    preview_url: a.preview_url || undefined,
    folder_id: null,
    deletable: false,
    storage_provider: 'planq',
  } as ProjectFile;
}

const AttachmentPreviewDrawer: React.FC<Props> = ({ attachment, businessId, onClose, onDownload }) => {
  const { t } = useTranslation('common');
  const [editing, setEditing] = useState(false);
  const [editNote, setEditNote] = useState<string | null>(null);
  const canEdit = !!attachment?.drive_editable && !!attachment?.file_id;
  return (
    <DetailDrawer
      open={!!attachment}
      onClose={onClose}
      width={480}
      ariaLabel={t('attachments.previewAria', { defaultValue: '첨부파일 미리보기' }) as string}
    >
      {attachment && (
        <>
          <DetailDrawer.Header onClose={onClose}>
            <HeadTitle title={attachment.original_name}>{attachment.original_name}</HeadTitle>
          </DetailDrawer.Header>
          <DetailDrawer.Body>
            <PreviewArea file={toProjectFile(attachment)} businessId={businessId} />
          </DetailDrawer.Body>
          <DetailDrawer.Footer>
            {/* Drive 에 있는 파일은 여기서 바로 고칠 수 있다 — 내려받아 고치고 다시 올리는 왕복을 없앤다.
                자체 저장 파일에는 편집기가 없으므로 버튼 자체를 만들지 않는다(눌러도 안 되는 버튼 금지). */}
            {canEdit && (
              <ActionButton
                tone="secondary"
                data-testid="attachment-preview-edit"
                disabled={editing}
                onClick={async () => {
                  if (editing) return;
                  setEditing(true);
                  setEditNote(null);
                  const r = await openDriveEditor(businessId, attachment.file_id as number);
                  if (!r.ok) {
                    setEditNote(t('attachments.driveEditFailed', { defaultValue: '편집기를 열지 못했어요' }) as string);
                  } else if (r.accessReason === 'no_google_account') {
                    setEditNote(t('attachments.driveEditNoGoogle', { defaultValue: '이 계정의 이메일로는 편집 권한을 줄 수 없어요. 구글 계정으로 로그인한 뒤 다시 눌러 주세요.' }) as string);
                  }
                  setEditing(false);
                }}
              >
                {t('attachments.driveEdit', { defaultValue: 'Drive 에서 편집' }) as string}
              </ActionButton>
            )}
            <ActionButton
              tone="secondary"
              data-testid="attachment-preview-download"
              onClick={() => onDownload(attachment)}
            >
              {t('attachments.download', { defaultValue: '다운로드' }) as string}
            </ActionButton>
            {editNote && <EditNote role="status">{editNote}</EditNote>}
          </DetailDrawer.Footer>
        </>
      )}
    </DetailDrawer>
  );
};

const EditNote = styled.div`
  flex: 1 1 100%;
  font-size: 0.75rem; color: #B45309; line-height: 1.5;
`;

const HeadTitle = styled.div`
  font-size: 1rem; font-weight: 700; color: #0F172A;
  overflow: hidden; text-overflow: ellipsis; white-space: nowrap;
`;

export default AttachmentPreviewDrawer;
