// 일정 미팅자료(#411) — 붙이기·떼기·«참석자에게 알릴까요?»
//
//   Irene(#411): *"파일첨부 문서찾기 하게 해서 사전 준비한 미팅자료 연결하게 해줘. 미리 참석자들이 보게.
//   그리고 연결된 파일이나 문서가 있으면 참석자에게 알릴건지 묻게 하고. 수정을 해도 알릴건지 물어야 해."*
//
// - 고르는 입력은 공용 AttachmentField(업로드·기존 파일/문서·Drive) 한 벌이다. 새로 그리지 않는다.
// - 보여주는 목록도 공용 AttachmentList(이미지 보기·미리보기·내려받기·전체 다운로드) 한 벌이다.
// - 알리기는 **자동으로 보내지 않는다.** 자료가 바뀌면 안내 줄이 «누구에게» 를 적어 묻고, 고른 경우에만 보낸다.
//   «누구에게» 는 서버가 실제로 보낼 대상과 같은 함수(dry)에서 읽는다 — 화면이 참석자 목록으로 따로 세지 않는다.
import React, { useCallback, useEffect, useState } from 'react';
import styled from 'styled-components';
import { useTranslation } from 'react-i18next';
import AttachmentField from '../../components/Common/AttachmentField';
import AttachmentList, { type AttachmentListItem } from '../../components/Common/AttachmentList';
import ActionButton from '../../components/Common/ActionButton';
import { uploadMyFile } from '../../services/files';
import { addEventMaterials, removeEventMaterial, notifyEventMaterials } from '../../services/calendar';
import type { CalendarEvent, CalendarEventMaterial } from './types';

/** 고른 업로드를 파일 id 로 바꾼다 — 미팅자료로 올리면 서버가 참석자가 열 수 있는 범위(L2/L3)로 올린다. */
export async function uploadMaterialFiles(businessId: number, files: File[], projectId: number | null): Promise<{ ids: number[]; failed: number }> {
  const ids: number[] = [];
  let failed = 0;
  for (const f of files) {
    const r = await uploadMyFile(businessId, f, { projectId, attachFor: 'event' });
    const fid = r.success && r.file ? Number(String(r.file.id).replace(/^direct-/, '')) : NaN;
    if (Number.isFinite(fid)) ids.push(fid); else failed += 1;
  }
  return { ids, failed };
}

export function materialItems(list: CalendarEventMaterial[], businessId: number, docKind: string, canRemove: boolean): AttachmentListItem[] {
  return list.map((a) => (a.post_id
    ? { id: a.id, name: a.post?.title || '-', postId: a.post_id, sub: docKind, canRemove }
    : {
      id: a.id, name: a.file?.file_name || '-', size: a.file?.file_size ?? null, mime: a.file?.mime_type ?? null,
      fileId: a.file_id, zipId: `direct-${a.file_id}`, canRemove,
      downloadUrl: `/api/files/${businessId}/${a.file_id}/download`,
    }));
}

interface Props {
  event: CalendarEvent;
  businessId: number;
  canEdit: boolean;
  /** 서버가 돌려준 목록을 화면에만 반영(PUT 없음) */
  onChange: (attachments: CalendarEventMaterial[]) => void;
}

const EventMaterials: React.FC<Props> = ({ event, businessId, canEdit, onChange }) => {
  const { t } = useTranslation('qcalendar');
  const list = event.attachments || [];
  const [picking, setPicking] = useState(false);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  // 자료가 바뀐 뒤 «알릴까요?» — 대상은 서버 dry 응답
  const [ask, setAsk] = useState<{ count: number; names: string[] } | null>(null);
  const [notifying, setNotifying] = useState(false);

  // 다른 일정으로 바뀌면 묻던 것을 버린다(떠난 일정의 질문이 새 일정에 남지 않게)
  useEffect(() => { setAsk(null); setMsg(null); setPicking(false); }, [event.id]);

  const afterChange = useCallback(async () => {
    try {
      const r = await notifyEventMaterials(businessId, event.id, true);
      setAsk(r.count ? { count: r.count, names: r.names || [] } : null);
    } catch { setAsk(null); }
  }, [businessId, event.id]);

  const add = useCallback(async (atts: Array<{ file_id?: number; post_id?: number }>) => {
    if (!atts.length) return;
    setBusy(true); setMsg(null);
    try {
      const r = await addEventMaterials(businessId, event.id, atts);
      onChange(r.attachments);
      if (r.added < atts.length) setMsg(t('materials.skipped', { count: atts.length - r.added }) as string);
      if (r.added > 0) await afterChange();
    } catch { setMsg(t('materials.failed') as string); }
    finally { setBusy(false); }
  }, [businessId, event.id, onChange, afterChange, t]);

  const onUploads = useCallback(async (files: File[]) => {
    if (!files.length) return;
    setBusy(true);
    const { ids, failed } = await uploadMaterialFiles(businessId, files, event.project_id ?? null);
    setBusy(false);
    if (failed) setMsg(t('materials.failed') as string);
    await add(ids.map((file_id) => ({ file_id })));
  }, [businessId, event.project_id, add, t]);

  const remove = useCallback(async (item: AttachmentListItem) => {
    setBusy(true); setMsg(null);
    try {
      const r = await removeEventMaterial(businessId, event.id, item.id);
      onChange(r.attachments);
      await afterChange();
    } catch { setMsg(t('materials.failed') as string); }
    finally { setBusy(false); }
  }, [businessId, event.id, onChange, afterChange, t]);

  const sendNotify = async () => {
    setNotifying(true);
    try {
      const r = await notifyEventMaterials(businessId, event.id, false);
      setAsk(null);
      setMsg(t('materials.notified', { count: r.notified || 0 }) as string);
    } catch { setMsg(t('materials.notifyFailed') as string); }
    finally { setNotifying(false); }
  };

  if (!canEdit && list.length === 0) return null;

  return (
    <Wrap data-testid="event-materials">
      {list.length === 0
        ? <Empty>{t('materials.empty')}</Empty>
        : <AttachmentList items={materialItems(list, businessId, t('materials.docKind') as string, canEdit)} businessId={businessId}
            layout="rows" onRemove={canEdit ? remove : undefined} testId="event-materials-list" />}
      {canEdit && (picking ? (
        <>
          <AttachmentField
            businessId={businessId}
            uploads={[]}
            onUploadsChange={onUploads}
            existingFileIds={[]}
            onExistingFileIdsChange={(ids) => add(ids.map((file_id) => ({ file_id })))}
            includePosts
            existingPostIds={[]}
            onExistingPostIdsChange={(ids) => add(ids.map((post_id) => ({ post_id })))}
            projectId={event.project_id ?? null}
            disabled={busy}
          />
          <Hint>{t('materials.visibilityHint')}</Hint>
          <Row><ActionButton tone="secondary" size="xs" onClick={() => setPicking(false)}>{t('materials.close')}</ActionButton></Row>
        </>
      ) : (
        <Row><ActionButton tone="secondary" size="xs" onClick={() => setPicking(true)} data-testid="event-materials-add">{t('materials.add')}</ActionButton></Row>
      ))}
      {busy && <Hint>{t('materials.uploading')}</Hint>}
      {ask && (
        <AskBar role="status" data-testid="event-materials-ask">
          <span>{t('materials.askNotify', { count: ask.count, names: ask.names.join(', ') })}</span>
          <Row>
            <ActionButton tone="primary" size="xs" loading={notifying} disabled={notifying} onClick={sendNotify} data-testid="event-materials-notify">
              {t('materials.notify')}
            </ActionButton>
            <ActionButton tone="secondary" size="xs" disabled={notifying} onClick={() => setAsk(null)}>{t('materials.notNow')}</ActionButton>
          </Row>
        </AskBar>
      )}
      {msg && <Hint role="status">{msg}</Hint>}
    </Wrap>
  );
};

export default EventMaterials;

const Wrap = styled.div` display: flex; flex-direction: column; gap: 8px; min-width: 0; `;
const Row = styled.div` display: flex; gap: 6px; flex-wrap: wrap; `;
const Empty = styled.div` font-size: 0.8125rem; color: #94A3B8; `;
const Hint = styled.div` font-size: 0.75rem; color: #64748B; `;
const AskBar = styled.div`
  display: flex; flex-direction: column; gap: 8px;
  padding: 10px 12px; border-radius: 8px;
  background: #F0FDFA; border: 1px solid #99F6E4;
  font-size: 0.8125rem; color: #0F172A;
`;
