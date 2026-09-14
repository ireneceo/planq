// 상담 메모 = **댓글 스레드**. (2026-09-14 · 파일 비대로 SaleInboxList 에서 분리)
//   분리 이유: SaleInboxList 가 814줄이 되어 god-file 가드에 걸렸다(컴포넌트 >800).
//   동작은 한 줄도 바꾸지 않고 파일만 옮겼다.
import { useCallback, useEffect, useMemo, useState } from 'react';
import styled from 'styled-components';
import { useTranslation } from 'react-i18next';
import NoteThread from '../Common/NoteThread';
import { useTimeFormat } from '../../hooks/useTimeFormat';
import {
  listConsultNotes, addConsultNote, deleteConsultNote,
  type SaleNote, type ConsultRefKind, type SaleInboxItem,
} from '../../services/sale';

/** 상담 메모 = **댓글 스레드**. (2026-09-14)
 *
 *  Irene: *"이 메모를 고객응대 내역이랑 섞은 거야? 그냥 담당자 메모야. … 리스트에 댓글이 달리는 것처럼
 *  붙여달라는 거고 그걸 열였다 접었다 할 수 잇게 해줘. … 채팅방 보면 메모를 공개범위 선택해서 할 수
 *  잇잖아. 그거 그대로 하자."*
 *
 *  ★ 여기 있던 것은 **고객응대 내역(ClientInteraction) 타임라인 전체**였다 — [메모] 를 누르면
 *    원장이 통째로 펼쳐졌다. 그건 메모가 아니다. 원장은 [보기]·우측 패널에서 본다.
 *  ★ 컴포넌트는 채팅방·메일 맥락 패널과 **같은 것**(`components/Common/NoteThread`) —
 *    공개범위 고르기·초안 보존·본인 것만 삭제가 이미 그 안에 있다. 새로 그리지 않는다.
 *  ★ 어떤 문의를 기준으로 남겼는지는 **저장 대상 자체**가 말한다(메일 스레드·대화방·고객).
 */
function SaleNoteThread({ businessId, item, myUserId, onChanged }: {
  businessId: number; item: SaleInboxItem; myUserId: number | null; onChanged: () => void;
}) {
  const { t } = useTranslation('qsale');
  const { formatTimeAgo } = useTimeFormat();
  const [notes, setNotes] = useState<SaleNote[] | null>(null);

  // 이 행의 메모가 어디에 붙는가 — 메일이면 스레드, 게스트/채팅이면 대화방, 등록된 상담이면 고객.
  const target = useMemo((): { kind: ConsultRefKind; id: number } | null => {
    const r = item.ref;
    if (r.kind === 'email_thread') return { kind: 'email_thread', id: r.id };
    if (r.kind === 'conversation') return { kind: 'conversation', id: r.id };
    if (r.kind === 'guest_link' && r.conversation_id) return { kind: 'conversation', id: r.conversation_id };
    if (r.kind === 'client') return { kind: 'client', id: r.id };
    if (item.client_id) return { kind: 'client', id: item.client_id };
    return null;
  }, [item]);

  const reload = useCallback(() => {
    if (!target) { setNotes([]); return; }
    listConsultNotes(businessId, target.kind, target.id)
      .then(setNotes).catch(() => setNotes([]));
  }, [businessId, target]);

  useEffect(() => { reload(); }, [reload]);

  if (!target) return <MemoDim>{t('note.noTarget', { defaultValue: '이 행에는 메모를 붙일 수 없습니다.' }) as string}</MemoDim>;

  return (
    <NoteThread
      notes={(notes || []).map((n) => ({
        id: n.id, body: n.body, visibility: n.visibility,
        author_user_id: n.author_user_id, author_name: n.author_name, created_at: n.created_at,
      }))}
      myUserId={myUserId}
      canChooseVisibility
      formatTime={formatTimeAgo}
      onAdd={async (body, visibility) => {
        // ★ 성공 여부를 돌려준다 — NoteThread 는 true 일 때만 쓰던 글을 비운다(실패하면 글이 남아야 한다)
        try {
          await addConsultNote(businessId, target.kind, target.id, body, visibility);
          reload(); onChanged();
          return true;
        } catch { return false; }
      }}
      onDelete={async (id) => {
        try { await deleteConsultNote(businessId, target.kind, target.id, id); reload(); onChanged(); }
        catch { /* 실패는 목록 그대로 둔다 */ }
      }}
      draftKind="sale-note"
      draftEntityId={`${target.kind}:${target.id}`}
      draftBizId={businessId}
      emptyText={t('note.empty', { defaultValue: '아직 메모가 없습니다' }) as string}
      placeholder={t('note.placeholder', { defaultValue: '메모 작성... (⌘/Ctrl+Enter 저장)' }) as string}
    />
  );
}

export default SaleNoteThread;

const MemoDim = styled.div`padding: 12px 0; text-align: center; color: #94A3B8; font-size: 0.8125rem;`;
