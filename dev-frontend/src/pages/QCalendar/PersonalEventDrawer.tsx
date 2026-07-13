// 개인 Google 캘린더 일정 — 읽기 전용 상세.
//
// 개인 캘린더는 PlanQ 가 쓰기 권한을 갖지 않는다(calendar.readonly). 그래도 클릭하면 곧바로
// Google 새 탭으로 튕겨나가는 건 이상하다 — 내용은 PlanQ 안에서 보고, 고칠 때만 Google 로 간다.
import { useTranslation } from 'react-i18next';
import styled from 'styled-components';
import DetailDrawer from '../../components/Common/DetailDrawer';
import ActionButton from '../../components/Common/ActionButton';
import { useTimeFormat } from '../../hooks/useTimeFormat';
import type { PersonalCalendarEvent } from './types';

interface Props {
  event: PersonalCalendarEvent;
  onClose: () => void;
}

export default function PersonalEventDrawer({ event, onClose }: Props) {
  const { t } = useTranslation('qcalendar');
  const { formatDateTime } = useTimeFormat();

  return (
    <DetailDrawer open onClose={onClose} width={420} ariaLabel={t('personal.ariaLabel', { defaultValue: '개인 일정 상세' }) as string}>
      <DetailDrawer.Header onClose={onClose}>
        <HeadWrap>
          <Title>{event.title}</Title>
          <Badge>{t('personal.badge', { defaultValue: '개인 캘린더 (읽기 전용)' }) as string}</Badge>
        </HeadWrap>
      </DetailDrawer.Header>

      <DetailDrawer.Body>
        <Row>
          <Label>{t('personal.when', { defaultValue: '일시' }) as string}</Label>
          <Value>
            {event.all_day
              ? t('personal.allDay', { defaultValue: '하루 종일' }) as string
              : `${formatDateTime(event.start_at)} — ${formatDateTime(event.end_at)}`}
          </Value>
        </Row>
        {event.location && (
          <Row>
            <Label>{t('personal.location', { defaultValue: '장소' }) as string}</Label>
            <Value>{event.location}</Value>
          </Row>
        )}
        {event.account_email && (
          <Row>
            <Label>{t('personal.account', { defaultValue: '계정' }) as string}</Label>
            <Value>{event.account_email}</Value>
          </Row>
        )}
        {event.description && (
          <Row>
            <Label>{t('personal.description', { defaultValue: '설명' }) as string}</Label>
            <Desc>{event.description}</Desc>
          </Row>
        )}
        <Hint>
          {t('personal.readOnlyHint', { defaultValue: '내 개인 캘린더의 일정이라 PlanQ 에서는 수정하지 않습니다. 나에게만 보입니다.' }) as string}
        </Hint>
      </DetailDrawer.Body>

      {event.html_link && (
        <DetailDrawer.Footer>
          <ActionButton
            tone="secondary"
            size="md"
            onClick={() => window.open(event.html_link as string, '_blank', 'noopener')}
          >
            {t('personal.openInGoogle', { defaultValue: 'Google Calendar 에서 열기' }) as string}
          </ActionButton>
        </DetailDrawer.Footer>
      )}
    </DetailDrawer>
  );
}

const HeadWrap = styled.div`display: flex; flex-direction: column; gap: 6px; min-width: 0;`;
const Title = styled.h3`margin: 0; font-size: 16px; font-weight: 700; color: #0F172A; word-break: break-word;`;
const Badge = styled.span`
  align-self: flex-start; padding: 2px 8px; border-radius: 999px;
  font-size: 11px; font-weight: 700; color: #6D28D9; background: #F5F3FF; border: 1px solid #DDD6FE;
`;
const Row = styled.div`display: flex; flex-direction: column; gap: 4px; margin-bottom: 16px;`;
const Label = styled.span`font-size: 12px; font-weight: 600; color: #64748B;`;
const Value = styled.span`font-size: 14px; color: #334155;`;
const Desc = styled.div`font-size: 14px; color: #334155; line-height: 1.6; white-space: pre-wrap; word-break: break-word;`;
const Hint = styled.p`margin: 0; font-size: 12px; color: #94A3B8; line-height: 1.6;`;
