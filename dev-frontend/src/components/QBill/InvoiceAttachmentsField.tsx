// 청구서 첨부(파일·문서·업로드) — 발행 창과 상세 드로어가 **같이** 쓴다.
//
//   Irene(2026-11-25): *"청구서에 출처문서만 연결할 수 있는데 문서든 파일이든 업로드든 첨부문서/파일들도 넣을 수 있어야 해."*
//   설계 docs/INVOICE_ATTACHMENTS_DESIGN.md (Fable 설계 판정)
//
// - 출처 문서 칸(단일 · 항목·금액 자동 채움)과 **다른 칸**이다. 출처 칸은 그대로 둔다.
// - 고르는 입력은 공용 AttachmentField(업로드·기존 파일/문서·Drive) 한 벌, 보여주는 목록은 공용 AttachmentList 한 벌
//   (일정 미팅자료 EventMaterials 와 같은 조합). 업로드도 미팅자료와 같은 문 — 팀이 열 수 있는 범위(L2/L3)로 올라간다.
// - 줄마다 «고객에게 보이기» — 기본 꺼짐(내부용). 켤 수 없는 자료는 스위치를 끄고 이유를 적는다(서버가 같은 판정).
// - 저장 전(invoiceId 없음)에는 화면에만 들고 있다가 발행 창이 생성 요청에 싣는다. 저장 뒤에는 누르는 즉시 서버로.
import React, { useCallback, useEffect, useRef, useState } from 'react';
import styled from 'styled-components';
import { useTranslation } from 'react-i18next';
import AttachmentField from '../Common/AttachmentField';
import AttachmentList, { type AttachmentListItem } from '../Common/AttachmentList';
import ActionButton from '../Common/ActionButton';
import AutoSaveField from '../Common/AutoSaveField';
import { Switch, SwitchKnob } from '../Common/switchShell';
import { uploadMaterialFiles } from '../../pages/QCalendar/EventMaterials';
import { onSocket } from '../../services/socket';
import {
  listInvoiceAttachments, addInvoiceAttachments, setInvoiceAttachmentVisible, removeInvoiceAttachment,
  previewInvoiceAttachments,
  type InvoiceAttachmentRow, type InvoicePublicAttachment, type PendingAttachment,
} from '../../services/invoiceAttachments';

type Target = { file_id?: number; post_id?: number };

interface Props {
  businessId: number;
  /** 저장된 청구서 id — 없으면 저장 전(발행 창 새로 만들기) */
  invoiceId: number | null;
  canEdit: boolean;
  projectId?: number | null;
  /** 저장 전 목록(발행 창이 들고 있다가 생성 요청에 싣는다) */
  pending?: PendingAttachment[];
  onPendingChange?: (next: PendingAttachment[]) => void;
  /** 우리 쪽(멤버)인가 — 아니면 밖으로 나가는 목록만 읽기 전용으로 */
  isStaff?: boolean;
  /** 비어 있고 고칠 수 없으면 아무것도 그리지 않는다 */
  hideWhenEmpty?: boolean;
}

const MAX = 20;

export function attachErrorText(code: string | undefined, t: (k: string, o?: Record<string, unknown>) => string): string {
  if (!code) return t('attach.error.failed');
  if (code === 'too_many_attachments') return t('attach.error.tooMany', { max: MAX });
  if (code === 'attachment_target_not_found') return t('attach.error.notFound');
  if (code === 'invoice_canceled') return t('attach.error.canceled');
  if (code.startsWith('attachment_not_shareable:')) return t(`attach.reason.${code.split(':')[1]}`);
  return t('attach.error.failed');
}

/** 저장 뒤 스위치 — 누르면 화면만 바꾸고(ref) 저장은 AutoSaveField 가 한 번. 실패는 던져 ! 배지 + 되돌림. */
const VisibleSwitch: React.FC<{ on: boolean; label: string; testId: string; onSave: (v: boolean) => Promise<void> }> = ({ on: initial, label, testId, onSave }) => {
  const [on, setOn] = useState(initial);
  const ref = useRef(initial);
  useEffect(() => { setOn(initial); ref.current = initial; }, [initial]);
  return (
    <AutoSaveField type="toggle" onSave={async () => {
      try { await onSave(ref.current); } catch (e) { ref.current = !ref.current; setOn(ref.current); throw e; }
    }}>
      <Switch type="button" role="switch" aria-checked={on} aria-label={label} $on={on} data-testid={testId}
        onClick={() => { ref.current = !on; setOn(!on); }}>
        <SwitchKnob $on={on} />
      </Switch>
    </AutoSaveField>
  );
};

const InvoiceAttachmentsField: React.FC<Props> = ({
  businessId, invoiceId, canEdit, projectId = null, pending, onPendingChange, isStaff = true, hideWhenEmpty = false,
}) => {
  const { t } = useTranslation('qbill');
  const tt = t as unknown as (k: string, o?: Record<string, unknown>) => string;
  const saved = invoiceId != null;
  const [rows, setRows] = useState<Array<InvoiceAttachmentRow | InvoicePublicAttachment>>([]);
  const [loading, setLoading] = useState(saved);
  const [loadErr, setLoadErr] = useState(false);
  const [picking, setPicking] = useState(false);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);

  const load = useCallback(async (silent = false) => {
    if (!saved) return;
    if (!silent) setLoading(true);
    try { setRows(await listInvoiceAttachments(businessId, invoiceId!)); setLoadErr(false); }
    catch { if (!silent) setLoadErr(true); }
    finally { if (!silent) setLoading(false); }
  }, [saved, businessId, invoiceId]);

  useEffect(() => { setPicking(false); setMsg(null); void load(); }, [load]);
  // 다른 사람이 붙이거나 떼면 다시 읽는다(서버는 invoice:updated 신호만 보낸다)
  useEffect(() => {
    if (!saved) return undefined;
    return onSocket('invoice:updated', (p: { id?: number }) => { if (Number(p?.id) === Number(invoiceId)) void load(true); });
  }, [saved, invoiceId, load]);

  const count = saved ? rows.length : (pending?.length || 0);

  const add = useCallback(async (targets: Target[]) => {
    if (!targets.length) return;
    setBusy(true); setMsg(null);
    try {
      if (saved) {
        const r = await addInvoiceAttachments(businessId, invoiceId!, {
          file_ids: targets.filter((x) => x.file_id).map((x) => x.file_id!),
          post_ids: targets.filter((x) => x.post_id).map((x) => x.post_id!),
        });
        setRows(r.attachments);
      } else {
        const cur = pending || [];
        const keyOf = (x: { file_id?: number | null; post_id?: number | null }) => (x.file_id ? `f${x.file_id}` : `p${x.post_id}`);
        const have = new Set(cur.map(keyOf));
        const fresh = targets.filter((x) => !have.has(keyOf(x)));
        if (cur.length + fresh.length > MAX) { setMsg(tt('attach.error.tooMany', { max: MAX })); return; }
        if (fresh.length) onPendingChange?.([...cur, ...await previewInvoiceAttachments(businessId, fresh)]);
      }
    } catch (e) { setMsg(attachErrorText((e as { code?: string }).code, tt)); }
    finally { setBusy(false); }
  }, [saved, businessId, invoiceId, pending, onPendingChange, tt]);

  const onUploads = useCallback(async (files: File[]) => {
    if (!files.length) return;
    setBusy(true);
    const { ids, failed } = await uploadMaterialFiles(businessId, files, projectId);
    setBusy(false);
    if (failed) setMsg(tt('attach.error.uploadFailed'));
    await add(ids.map((file_id) => ({ file_id })));
  }, [businessId, projectId, add, tt]);

  const remove = useCallback(async (item: AttachmentListItem) => {
    setMsg(null);
    if (!saved) { onPendingChange?.((pending || []).filter((_, i) => i !== item.id)); return; }
    setBusy(true);
    try { setRows((await removeInvoiceAttachment(businessId, invoiceId!, item.id)).attachments); }
    catch (e) { setMsg(attachErrorText((e as { code?: string }).code, tt)); }
    finally { setBusy(false); }
  }, [saved, pending, onPendingChange, businessId, invoiceId, tt]);

  const reasonText = (r: string | null | undefined) => (r ? tt(`attach.reason.${r}`) : '');
  const toggleLabel = tt('attach.visible');

  const switchFor = (on: boolean, reason: string | null, testId: string, onSave: (v: boolean) => Promise<void> | void, persist: boolean) => {
    if (!canEdit) return on ? <StateTag $on>{toggleLabel}</StateTag> : <StateTag>{tt('attach.internal')}</StateTag>;
    if (reason && !on) {
      return (
        <SwitchWrap title={reasonText(reason)}>
          <Switch type="button" role="switch" aria-checked={false} aria-label={toggleLabel} $on={false} disabled data-testid={testId}>
            <SwitchKnob $on={false} />
          </Switch>
        </SwitchWrap>
      );
    }
    if (persist) return <SwitchWrap><VisibleSwitch on={on} label={toggleLabel} testId={testId} onSave={async (v) => { await onSave(v); }} /></SwitchWrap>;
    return (
      <SwitchWrap>
        {/* autosave-exempt: 저장 전 발행 창 — 생성 요청에 같이 실린다(저장 버튼이 저장) */}
        <Switch type="button" role="switch" aria-checked={on} aria-label={toggleLabel} $on={on} data-testid={testId} onClick={() => onSave(!on)}>
          <SwitchKnob $on={on} />
        </Switch>
      </SwitchWrap>
    );
  };

  let items: AttachmentListItem[] = [];
  if (!saved) {
    items = (pending || []).map((p, i) => ({
      id: i, name: p.name, size: p.size ?? null, mime: p.mime_type ?? null,
      postId: p.post_id, fileId: p.file_id, canRemove: canEdit,
      downloadUrl: p.file_id ? `/api/files/${businessId}/${p.file_id}/download` : null,
      sub: p.client_visible ? toggleLabel : (p.shareable_reason ? reasonText(p.shareable_reason) : tt('attach.internal')),
      trailing: switchFor(p.client_visible, p.shareable_reason, `invoice-attach-visible-${i}`, (v) => {
        onPendingChange?.((pending || []).map((x, j) => (j === i ? { ...x, client_visible: v as boolean } : x)));
      }, false),
    }));
  } else if (isStaff) {
    items = (rows as InvoiceAttachmentRow[]).map((r) => {
      const gone = r.deleted || r.locked;
      const name = r.deleted ? tt('attach.deleted') : r.locked ? tt('attach.locked') : (r.name || '-');
      const sub = r.public_state === 'shown' ? tt('attach.shownToClient')
        : r.client_visible ? reasonText(r.public_state) : (r.shareable_reason ? reasonText(r.shareable_reason) : tt('attach.internal'));
      return {
        id: r.id, name, size: r.size ?? null, mime: r.mime_type ?? null,
        postId: gone ? null : r.post_id, fileId: gone ? null : r.file_id, canRemove: canEdit,
        downloadUrl: !gone && r.file_id ? `/api/files/${businessId}/${r.file_id}/download` : null,
        zipId: !gone && r.file_id ? `direct-${r.file_id}` : null,
        sub,
        trailing: gone ? undefined : switchFor(r.client_visible, r.shareable_reason, `invoice-attach-visible-${r.id}`, async (v) => {
          const res = await setInvoiceAttachmentVisible(businessId, invoiceId!, r.id, v as boolean).catch((e) => {
            setMsg(attachErrorText((e as { code?: string }).code, tt)); throw e;
          });
          setRows(res.attachments);
        }, true),
      };
    });
  }

  // 고객(비멤버) — 밖으로 나가는 목록만 읽기 전용(링크로 연다)
  if (saved && !isStaff) {
    const list = rows as InvoicePublicAttachment[];
    if (!list.length) return null;
    return (
      <Wrap data-testid="invoice-attachments">
        <Label>{tt('attach.title')}</Label>
        <PubList>
          {list.map((a) => (
            <li key={a.id}>
              <a href={a.kind === 'post' ? a.url : (a.download_url || '#')} target={a.kind === 'post' ? '_blank' : undefined} rel="noopener noreferrer">
                {a.kind === 'post' ? tt('attach.docKind') : tt('attach.fileKind')} · {a.name}
              </a>
            </li>
          ))}
        </PubList>
      </Wrap>
    );
  }

  if (hideWhenEmpty && !canEdit && count === 0 && !loading) return null;

  return (
    <Wrap data-testid="invoice-attachments">
      <Label>{tt('attach.titleOptional')}</Label>
      {canEdit && <Hint>{tt('attach.hint')}</Hint>}
      {loading ? <Hint>{tt('attach.loading')}</Hint>
        : loadErr ? <Hint role="alert">{tt('attach.error.load')} <RetryBtn type="button" onClick={() => void load()}>{tt('attach.retry')}</RetryBtn></Hint>
          : count === 0 ? <Empty>{tt('attach.empty')}</Empty>
            : <AttachmentList items={items} businessId={businessId} layout="rows" onRemove={canEdit ? remove : undefined} testId="invoice-attachments-list" />}
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
            projectId={projectId}
            disabled={busy || count >= MAX}
          />
          <Row><ActionButton tone="secondary" size="xs" onClick={() => setPicking(false)}>{tt('attach.close')}</ActionButton></Row>
        </>
      ) : (
        <Row>
          <ActionButton tone="secondary" size="xs" onClick={() => setPicking(true)} disabled={count >= MAX} data-testid="invoice-attach-add">
            {tt('attach.add')}
          </ActionButton>
        </Row>
      ))}
      {busy && <Hint>{tt('attach.working')}</Hint>}
      {msg && <Hint role="status" $warn>{msg}</Hint>}
    </Wrap>
  );
};

export default InvoiceAttachmentsField;

const Wrap = styled.div` display: flex; flex-direction: column; gap: 8px; min-width: 0; `;
const Label = styled.div` font-size: 0.8125rem; font-weight: 600; color: #334155; `;
const Row = styled.div` display: flex; gap: 6px; flex-wrap: wrap; `;
const Empty = styled.div` font-size: 0.8125rem; color: #94A3B8; `;
const Hint = styled.div<{ $warn?: boolean }>` font-size: 0.75rem; color: ${(p) => (p.$warn ? '#B45309' : '#64748B')}; `;
const RetryBtn = styled.button` border: none; background: none; color: #0F766E; text-decoration: underline; cursor: pointer; font-size: inherit; padding: 0; `;
const SwitchWrap = styled.span` display: inline-flex; align-items: center; flex-shrink: 0; padding: 0 4px; `;
const StateTag = styled.span<{ $on?: boolean }>`
  flex-shrink: 0; font-size: 0.6875rem; padding: 2px 6px; border-radius: 6px;
  background: ${(p) => (p.$on ? '#F0FDFA' : '#F1F5F9')}; color: ${(p) => (p.$on ? '#0F766E' : '#64748B')};
`;
const PubList = styled.ul`
  list-style: none; margin: 0; padding: 0; display: flex; flex-direction: column; gap: 6px;
  a { color: #0F766E; font-size: 0.8125rem; text-decoration: none; word-break: break-all; }
  a:hover { text-decoration: underline; }
`;
