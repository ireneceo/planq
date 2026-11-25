// 채팅 «+» → 업무 추가 · 일정 추가 (2026-11-25, Irene «일정이랑 업무도 채팅으로 공유할 수 있잖아. 그럼 채팅에서도 추가할 수 있어야지»).
//
// ★ 새 폼을 그리지 않는다(ui-components «기존 것을 찾아 쓴다») — 업무는 공용 TaskCreateForm(drawer),
//   일정은 캘린더와 같은 NewEventModal. 만든 뒤 카드를 꽂는 문도 이미 있는 것 하나 — POST /api/share/chat
//   (업무·일정 «공유 → 채팅방» 과 같은 문 · 권한·보안등급·대화방 접근·방송·알림을 서버가 본다).
// ★ 만들기는 됐는데 카드가 못 가는 경우(나만/팀 비공개 일정 · 보안등급 업무)를 삼키지 않는다 — 안내 줄로 알린다.
// ★ 참석자를 대화방 사람으로 미리 넣지 않는다 — 고객에게 초대 메일이 나갈 수 있다(외부 발송은 폼에서 사람이 고른다).
import React, { useCallback, useEffect, useState } from 'react';
import styled from 'styled-components';
import { useTranslation } from 'react-i18next';
import { apiFetch, useAuth } from '../../contexts/AuthContext';
import TaskCreateForm from '../../components/QTask/TaskCreateForm';
import NewEventModal from '../QCalendar/NewEventModal';
import { createEvent } from '../../services/calendar';
import { listProjects } from '../../services/qtalk';
import { toWall } from '../QCalendar/calTz';
import { nextSlot } from '../QCalendar/dateUtils';
import { detectBrowserTz } from '../../utils/timezones';
import { mapApiError } from '../../utils/apiError';
import type { CalendarEvent } from '../QCalendar/types';

export type ChatAddKind = 'task' | 'event';

interface Props {
  kind: ChatAddKind | null;
  businessId: number;
  conversationId: number;
  /** 프로젝트 방이면 그 프로젝트로 시작한다(바꿀 수 있다) */
  projectId: number | null;
  /** 고객이 있는 방 — 카드(미리보기)를 고객도 본다 */
  customerVisible: boolean;
  onClose: () => void;
  onNotice: (n: { kind: 'hint' | 'error'; text: string }) => void;
}

const ChatAddEntity: React.FC<Props> = ({ kind, businessId, conversationId, projectId, customerVisible, onClose, onNotice }) => {
  const { t } = useTranslation('qtalk');
  const { t: tErr } = useTranslation('errors');
  const { user } = useAuth();
  const [projects, setProjects] = useState<Array<{ id: number; name: string; color?: string | null }>>([]);
  const [eventStart, setEventStart] = useState<Date>(() => new Date());

  useEffect(() => {
    if (kind !== 'event') return;
    setEventStart(nextSlot(toWall(new Date(), user?.workspace_timezone || detectBrowserTz())));
    listProjects(businessId)
      .then((rows) => setProjects(rows.map((p) => ({ id: Number(p.id), name: p.name, color: p.color }))))
      .catch(() => { /* 프로젝트 연결은 선택 */ });
  }, [kind, businessId, user?.workspace_timezone]);

  // 만든 것을 이 대화방에 카드로 — 실패해도 만든 것은 남는다. 사유를 말한다.
  const postCard = useCallback(async (entityType: 'task' | 'calendar_event', entityId: number) => {
    const what = entityType === 'task' ? t('chat.add.taskWord', '업무') : t('chat.add.eventWord', '일정');
    try {
      const r = await apiFetch('/api/share/chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ entity_type: entityType, entity_id: entityId, conversation_id: conversationId }),
      });
      const j = await r.json().catch(() => ({}));
      if (r.ok && j?.success) return;
      const code = j?.code || j?.message;
      const why = code === 'cannot_share_private_event'
        ? t('chat.add.whyPrivateEvent', '나만 보기·팀 비공개 일정이라')
        : code === 'security_level_blocks_share'
          ? t('chat.add.whySecurity', '보안 등급이 있는 업무라')
          : t('chat.add.whyOther', '카드를 보내지 못해');
      onNotice({ kind: 'error', text: t('chat.add.cardFailed', { what, why, defaultValue: '{{what}}은(는) 만들었지만 {{why}} 이 대화방에 카드로 보내지 않았어요.' }) as string });
    } catch {
      onNotice({ kind: 'error', text: t('chat.add.cardFailed', { what, why: t('chat.add.whyOther', '카드를 보내지 못해'), defaultValue: '{{what}}은(는) 만들었지만 {{why}} 이 대화방에 카드로 보내지 않았어요.' }) as string });
    }
  }, [conversationId, onNotice, t]);

  const sendsTo = customerVisible
    ? t('chat.add.sendsToCustomer', '만들면 이 대화방에 카드로 올라갑니다 — 고객도 봅니다.')
    : t('chat.add.sendsTo', '만들면 이 대화방에 카드로 올라갑니다.');

  if (kind === 'task') {
    return (
      <TaskCreateForm
        businessId={businessId}
        layout="drawer"
        initial={projectId ? { projectId } : null}
        drawerTitle={customerVisible
          ? t('chat.add.taskTitleCustomer', '업무 추가 · 이 대화방에 카드로 (고객도 봄)')
          : t('chat.add.taskTitle', '업무 추가 · 이 대화방에 카드로')}
        onClose={onClose}
        onCreated={(task) => {
          onClose();
          if (task?.id) void postCard('task', Number(task.id));
        }}
      />
    );
  }

  if (kind === 'event') {
    return (
      <NewEventModal
        initialStart={eventStart}
        projects={projects}
        initialProjectId={projectId}
        businessId={businessId}
        notice={<SendsTo data-testid="chat-add-event-notice">{sendsTo}</SendsTo>}
        onClose={onClose}
        onCreate={async (payload: Partial<CalendarEvent>) => {
          try {
            const created = await createEvent(businessId, payload as Parameters<typeof createEvent>[1]);
            onClose();
            if (created?.meet_warning) onNotice({ kind: 'error', text: t('chat.add.meetFailed', '일정은 만들었지만 화상 미팅 링크를 만들지 못했어요. 일정 상세에서 다시 만들 수 있어요.') as string });
            if (created?.id) await postCard('calendar_event', Number(created.id));
            return created;   // 미팅자료 알림(#411)이 이어 쓴다 — 캘린더 handleCreate 와 같은 모양
          } catch (e) {
            onNotice({ kind: 'error', text: mapApiError(e, tErr) });
            return undefined;
          }
        }}
      />
    );
  }
  return null;
};

// 폼 위 한 줄 — 어디로 가는지(고객도 보는지) 누르기 전에 보인다
const SendsTo = styled.div`
  font-size: 0.78125rem; color: #0F766E; background: #F0FDFA; border: 1px solid #CCFBF1;
  border-radius: 8px; padding: 8px 12px; margin-bottom: 12px;
`;

export default ChatAddEntity;
