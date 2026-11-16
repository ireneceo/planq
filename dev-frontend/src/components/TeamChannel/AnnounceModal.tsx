// 공지 쓰기·고치기 — 워크스페이스 «전체» 방에 제목 + 본문 공지를 올린다(2026-11-16 Fable 설계 B).
//   올리면 «전체» 방 메시지로 남고 자동 핀(방 위 공지 띠) · 멤버 전원에게 알림(방 알림을 꺼도 간다).
//   껍데기는 공용 StandardModal(가운데 모달). 새 공지 본문은 입력 초안으로 남는다(hooks/draftKinds 'team-announcement').
//   부모는 열 때만 그린다({open && <AnnounceModal …/>}) — 초안·원문을 열 때마다 새로 읽는다.
import React, { useEffect, useRef, useState } from 'react';
import styled from 'styled-components';
import { useTranslation } from 'react-i18next';
import StandardModal from '../Common/StandardModal';
import ActionButton from '../Common/ActionButton';
import { useDraftKey, useDraftText } from '../../hooks/useDraftText';
import { isEnterAction, enterSends } from '../../utils/imeKey';
import { postAnnouncement, editAnnouncement, TeamChannelError, type Announcement } from '../../services/teamChannel';

interface Props {
  businessId: number;
  /** 있으면 고치기 */
  editing?: Pick<Announcement, 'id' | 'title' | 'content'> | null;
  onClose: () => void;
  onDone: (r: { id: number; conversation_id?: number }) => void;
}

const TITLE_MAX = 100;
const BODY_MAX = 5000;

const AnnounceModal: React.FC<Props> = ({ businessId, editing, onClose, onDone }) => {
  const { t } = useTranslation('qtalk');
  const draft = useDraftText(useDraftKey('team-announcement', editing ? null : 'new', businessId));
  const [title, setTitle] = useState(editing?.title || '');
  const [editBody, setEditBody] = useState(editing?.content || '');
  const body = editing ? editBody : draft.text;
  const setBody = editing ? setEditBody : draft.setText;
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const titleRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    // 터치 기기는 열자마자 키보드를 올리지 않는다(ui-overlays — 폼 절반을 덮는다)
    if (enterSends()) { const id = window.setTimeout(() => titleRef.current?.focus(), 50); return () => window.clearTimeout(id); }
    return undefined;
  }, []);

  const submit = async () => {
    if (busy) return;
    const tt = title.trim();
    const bb = body.trim();
    if (!tt) { setErr(t('team.announce.titleRequired', '제목을 입력하세요')); return; }
    if (!bb) { setErr(t('team.announce.bodyRequired', '내용을 입력하세요')); return; }
    setBusy(true); setErr(null);
    try {
      if (editing) {
        await editAnnouncement(businessId, editing.id, tt, bb);
        onDone({ id: editing.id });
      } else {
        const r = await postAnnouncement(businessId, tt, bb);
        draft.clear();
        onDone(r);
      }
    } catch (e) {
      const code = e instanceof TeamChannelError ? e.code : '';
      setErr(code === 'announce_admin_only' || code === 'forbidden'
        ? t('team.announce.forbidden', '대표·관리자만 공지를 올릴 수 있습니다')
        : t('team.announce.failed', '공지를 올리지 못했습니다. 잠시 뒤 다시 시도하세요'));
      setBusy(false);
    }
  };

  return (
    <StandardModal open onClose={onClose} size="md"
      title={editing ? t('team.announce.editTitle', '공지 고치기') : t('team.announce.title', '공지 보내기')}
      footer={(
        <>
          <ActionButton tone="secondary" size="md" onClick={onClose}>{t('team.announce.cancel', '취소')}</ActionButton>
          <ActionButton tone="primary" size="md" onClick={() => void submit()} loading={busy} disabled={busy} data-testid="team-announce-submit">
            {editing ? t('team.announce.save', '저장') : t('team.announce.send', '공지 올리기')}
          </ActionButton>
        </>
      )}>
      {!editing && <Hint>{t('team.announce.hint', '«전체» 대화방에 올라가고 맨 위 공지로 고정됩니다. 멤버 모두에게 알림이 가고, 읽은 사람은 공지 목록에서 볼 수 있습니다.')}</Hint>}
      {!editing && draft.restored && <Hint data-testid="team-announce-restored">{t('team.announce.restored', '쓰던 내용을 불러왔습니다')}</Hint>}
      <Field>
        <Label htmlFor="team-announce-title">{t('team.announce.titleLabel', '제목')}</Label>
        <Input id="team-announce-title" ref={titleRef} value={title} maxLength={TITLE_MAX} data-testid="team-announce-title"
          placeholder={t('team.announce.titlePh', '예: 다음 주 월요일 전체 회의') as string}
          onChange={(e) => setTitle(e.target.value)} />
      </Field>
      <Field>
        <Label htmlFor="team-announce-body">{t('team.announce.bodyLabel', '내용')}</Label>
        <Textarea id="team-announce-body" rows={8} maxLength={BODY_MAX} data-testid="team-announce-body"
          placeholder={t('team.announce.bodyPh', '멤버에게 알릴 내용을 적으세요') as string}
          {...(editing ? { value: editBody, onChange: (e: React.ChangeEvent<HTMLTextAreaElement>) => setBody(e.target.value) } : draft.bind)}
          onKeyDown={(e) => { if (isEnterAction(e) && (e.metaKey || e.ctrlKey)) void submit(); }} />
        <Count>{body.length} / {BODY_MAX}</Count>
      </Field>
      {err && <Err role="alert">{err}</Err>}
    </StandardModal>
  );
};
export default AnnounceModal;

const Field = styled.div`display: flex; flex-direction: column; gap: 6px;`;
const Label = styled.label`font-size: 0.8125rem; font-weight: 600; color: #475569;`;
const inputCss = `
  width: 100%; box-sizing: border-box; padding: 9px 12px; min-height: 40px;
  border: 1px solid #E2E8F0; border-radius: 8px; font-size: 0.875rem; color: #0F172A; background: #FFFFFF;
  outline: none; font-family: inherit;
  &:focus { border-color: #14B8A6; }
  &::placeholder { color: #CBD5E1; }
`;
const Input = styled.input`${inputCss}`;
const Textarea = styled.textarea`${inputCss} resize: vertical; line-height: 1.6; min-height: 160px;`;
const Hint = styled.div`font-size: 0.75rem; color: #64748B; line-height: 1.5;`;
const Count = styled.div`font-size: 0.6875rem; color: #94A3B8; text-align: right;`;
const Err = styled.div`font-size: 0.8125rem; color: #B91C1C;`;
