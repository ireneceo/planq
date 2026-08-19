// 개인 Google 캘린더 일정 상세 — 쓰기 권한이 있으면 여기서 바로 고친다.
//
// ★ 이 화면은 오랫동안 "개인 캘린더 (읽기 전용)" 이라고 **거짓말**하고 있었다. 처음엔 읽기 전용
//   스코프(calendar.readonly)만 받았고, 나중에 쓰기(calendar.events)가 열렸는데 서버가 응답에
//   read_only 를 하드코딩하고 이 파일의 문구도 옛 동작을 그대로 서술한 채 남았다.
//   (Irene: "이거 개인캘린더가 내 껀데 왜 내가 읽기전용이야?")
//
// 반복 일정은 서버가 인스턴스를 펼쳐 내려주므로, 여기서 고치면 **그 회차만** 바뀐다.
// 시리즈 전체 수정은 Google Calendar 로 보낸다 — 그 사실을 화면에 밝힌다.
import { useCallback, useMemo, useState } from 'react';
import styled from 'styled-components';
import { useTranslation } from 'react-i18next';
import DetailDrawer from '../../components/Common/DetailDrawer';
import ActionButton from '../../components/Common/ActionButton';
import AutoSaveField from '../../components/Common/AutoSaveField';
import CalendarPicker from '../../components/Common/CalendarPicker';
import PlanQSelect from '../../components/Common/PlanQSelect';
import { apiFetch } from '../../contexts/AuthContext';
import { useTimeFormat } from '../../hooks/useTimeFormat';
import { toDateKey, formatTime } from './dateUtils';
import { personalToEvent } from './taskToEvent';
import type { PersonalCalendarEvent } from './types';
import { OVERLAY_DRAWER } from '../../theme/panelWidth';

const TIME_OPTIONS = (() => {
  const arr: Array<{ value: string; label: string }> = [];
  for (let h = 0; h < 24; h += 1) {
    for (const m of [0, 30]) {
      arr.push({ value: `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`, label: `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}` });
    }
  }
  return arr;
})();

interface Props {
  event: PersonalCalendarEvent;
  businessId: number;
  onClose: () => void;
  onChanged: (next: PersonalCalendarEvent | null) => void;   // null = 삭제됨
}

export default function PersonalEventDrawer({ event, businessId, onClose, onChanged }: Props) {
  const { t } = useTranslation('qcalendar');
  const { formatDateTime } = useTimeFormat();

  const canEdit = !event.read_only && event.is_organizer && !!event.gcal_event_id && !!event.connection_id;

  const [title, setTitle] = useState(event.title);
  const [location, setLocation] = useState(event.location || '');
  const [description, setDescription] = useState(event.description || '');
  const [startDate, setStartDate] = useState(() => toDateKey(new Date(event.start_at)));
  const [endDate, setEndDate] = useState(() => toDateKey(new Date(event.end_at)));
  const [startTime, setStartTime] = useState(() => formatTime(new Date(event.start_at)));
  const [endTime, setEndTime] = useState(() => formatTime(new Date(event.end_at)));
  // etag 는 저장할 때마다 갱신해야 한다 — 안 그러면 두 번째 필드 저장부터 매번 충돌로 막힌다.
  const [etag, setEtag] = useState(event.etag);
  const [datePickerOpen, setDatePickerOpen] = useState(false);
  const [conflict, setConflict] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [deleting, setDeleting] = useState(false);

  const base = `/api/me/calendar/events/${event.connection_id}/${encodeURIComponent(event.gcal_event_id)}`;

  /** 서버가 돌려준 최신본으로 화면을 통째로 맞춘다 (충돌 복구 · 저장 후 etag 갱신 공용). */
  const applyFresh = useCallback((raw: unknown) => {
    const next = personalToEvent(raw as Parameters<typeof personalToEvent>[0]);
    setTitle(next.title);
    setLocation(next.location || '');
    setDescription(next.description || '');
    setStartDate(toDateKey(new Date(next.start_at)));
    setEndDate(toDateKey(new Date(next.end_at)));
    setStartTime(formatTime(new Date(next.start_at)));
    setEndTime(formatTime(new Date(next.end_at)));
    setEtag(next.etag);
    onChanged(next);
    return next;
  }, [onChanged]);

  const patch = useCallback(async (body: Record<string, unknown>) => {
    const r = await apiFetch(base, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ business_id: businessId, etag, ...body }),
    });
    const j = await r.json().catch(() => ({}));
    if (r.status === 409) {
      // 구글에서 이미 바뀐 일정 — 옛 값으로 덮어쓰지 않고 최신본을 받아 화면을 맞춘다.
      setConflict(true);
      if (j?.data?.event) applyFresh(j.data.event);
      throw new Error('conflict');
    }
    // apiFetch 는 실패해도 throw 하지 않는다 — res.ok 를 안 보면 실패가 성공인 척 지나간다.
    if (!r.ok || !j.success) throw new Error(j?.message || 'save_failed');
    setConflict(false);
    if (j.data?.event) applyFresh(j.data.event);
  }, [base, businessId, etag, applyFresh]);

  const saveSchedule = useCallback(async (sd: string, ed: string, st: string, et: string) => {
    if (event.all_day) {
      await patch({ start_at: `${sd}T00:00:00`, end_at: `${ed}T23:59:59`, all_day: true });
    } else {
      await patch({ start_at: `${sd}T${st}:00`, end_at: `${ed}T${et}:00`, all_day: false });
    }
  }, [event.all_day, patch]);

  const remove = useCallback(async () => {
    setDeleting(true);
    try {
      const r = await apiFetch(`${base}?business_id=${businessId}`, { method: 'DELETE' });
      if (!r.ok) return;
      onChanged(null);
      onClose();
    } finally { setDeleting(false); }
  }, [base, businessId, onChanged, onClose]);

  // 편집이 막힌 이유를 정확히 말한다 — "PlanQ 에서는 수정하지 않습니다" 는 권한 문제인지
  //   정책인지 알 수 없어 사용자가 자기 캘린더인데도 포기하게 만든다.
  const blockedReason = useMemo(() => {
    if (canEdit) return null;
    if (event.read_only) return t('personal.needReconnect', { defaultValue: '이 연결은 읽기 권한만 승인되어 있어요. 설정에서 다시 연결하면 여기서 바로 수정할 수 있어요.' }) as string;
    if (!event.is_organizer) return t('personal.notOrganizer', { defaultValue: '주최자가 관리하는 일정이라 여기서는 수정할 수 없어요.' }) as string;
    return t('personal.readOnlyHint', { defaultValue: '이 일정은 여기서 수정할 수 없어요.' }) as string;
  }, [canEdit, event.read_only, event.is_organizer, t]);

  return (
    <DetailDrawer open onClose={onClose} width={OVERLAY_DRAWER.default} ariaLabel={t('personal.ariaLabel', { defaultValue: '개인 일정 상세' }) as string}>
      <DetailDrawer.Header onClose={onClose}>
        <HeadWrap>
          {canEdit ? (
            <AutoSaveField onSave={async () => { await patch({ title }); }}>
              <TitleInput
                value={title}
                onChange={(e) => setTitle(e.target.value)}
                placeholder={t('personal.titlePh', { defaultValue: '일정 제목' }) as string}
              />
            </AutoSaveField>
          ) : (
            <Title>{event.title}</Title>
          )}
          <Badge>
            {canEdit
              ? t('personal.badgeEditable', { defaultValue: '개인 캘린더' }) as string
              : t('personal.badge', { defaultValue: '개인 캘린더 (읽기 전용)' }) as string}
          </Badge>
        </HeadWrap>
      </DetailDrawer.Header>

      <DetailDrawer.Body>
        {event.recurring_event_id && canEdit && (
          <Notice>
            {t('personal.recurringNote', { defaultValue: '반복 일정이에요. 여기서 고치면 이 회차만 바뀝니다. 전체 반복을 바꾸려면 Google Calendar 에서 열어 주세요.' }) as string}
          </Notice>
        )}
        {conflict && (
          <Warn>
            {t('personal.conflict', { defaultValue: 'Google 에서 이미 변경된 일정이에요. 최신 내용을 불러왔어요.' }) as string}
          </Warn>
        )}

        <Row>
          <Label>{t('personal.when', { defaultValue: '일시' }) as string}</Label>
          {canEdit ? (
            <Value>
              <DateTimeRow>
                <DateTrigger type="button" onClick={() => setDatePickerOpen((x) => !x)}>{startDate}</DateTrigger>
                {!event.all_day && (
                  <AutoSaveField type="select" onSave={async () => { await saveSchedule(startDate, endDate, startTime, endTime); }}>
                    <TimeWrap>
                      <PlanQSelect
                        size="sm" density="compact" options={TIME_OPTIONS}
                        value={{ value: startTime, label: startTime }}
                        onChange={(opt) => { if (opt) setStartTime((opt as { value: string }).value); }}
                      />
                    </TimeWrap>
                  </AutoSaveField>
                )}
                <Dash>—</Dash>
                {!event.all_day && (
                  <AutoSaveField type="select" onSave={async () => { await saveSchedule(startDate, endDate, startTime, endTime); }}>
                    <TimeWrap>
                      <PlanQSelect
                        size="sm" density="compact" options={TIME_OPTIONS}
                        value={{ value: endTime, label: endTime }}
                        onChange={(opt) => { if (opt) setEndTime((opt as { value: string }).value); }}
                      />
                    </TimeWrap>
                  </AutoSaveField>
                )}
                {event.all_day && <Value>{endDate}</Value>}
              </DateTimeRow>
              {datePickerOpen && (
                <CalendarPicker
                  isOpen={datePickerOpen}
                  startDate={startDate}
                  endDate={endDate}
                  onRangeSelect={(s, e) => {
                    setStartDate(s); setEndDate(e || s);
                    setDatePickerOpen(false);
                    saveSchedule(s, e || s, startTime, endTime).catch(() => {});
                  }}
                  onClose={() => setDatePickerOpen(false)}
                />
              )}
            </Value>
          ) : (
            <Value>
              {event.all_day
                ? t('personal.allDay', { defaultValue: '하루 종일' }) as string
                : `${formatDateTime(event.start_at)} — ${formatDateTime(event.end_at)}`}
            </Value>
          )}
        </Row>

        {(canEdit || event.location) && (
          <Row>
            <Label>{t('personal.location', { defaultValue: '장소' }) as string}</Label>
            {canEdit ? (
              <Value>
                <AutoSaveField onSave={async () => { await patch({ location }); }}>
                  <TextInput
                    value={location}
                    onChange={(e) => setLocation(e.target.value)}
                    placeholder={t('personal.locationPh', { defaultValue: '장소 (선택)' }) as string}
                  />
                </AutoSaveField>
              </Value>
            ) : <Value>{event.location}</Value>}
          </Row>
        )}

        {event.account_email && (
          <Row>
            <Label>{t('personal.account', { defaultValue: '계정' }) as string}</Label>
            <Value>{event.account_email}</Value>
          </Row>
        )}

        {(canEdit || event.description) && (
          <Row>
            <Label>{t('personal.description', { defaultValue: '설명' }) as string}</Label>
            {canEdit ? (
              <Value>
                <AutoSaveField onSave={async () => { await patch({ description }); }}>
                  <TextArea
                    value={description}
                    onChange={(e) => setDescription(e.target.value)}
                    placeholder={t('personal.descriptionPh', { defaultValue: '설명 (선택)' }) as string}
                  />
                </AutoSaveField>
              </Value>
            ) : <Desc>{event.description}</Desc>}
          </Row>
        )}

        <Hint>
          {canEdit
            ? t('personal.editableHint', { defaultValue: '나에게만 보입니다. 수정하면 Google 캘린더에 바로 반영됩니다.' }) as string
            : blockedReason}
        </Hint>

        {canEdit && (
          confirmDelete ? (
            <DeleteConfirm>
              <ConfirmText>
                {event.recurring_event_id
                  ? t('personal.deleteConfirmRecurring', { defaultValue: '이 회차만 Google 캘린더에서 삭제합니다.' }) as string
                  : t('personal.deleteConfirm', { defaultValue: '이 일정을 Google 캘린더에서 삭제합니다.' }) as string}
              </ConfirmText>
              <ConfirmActions>
                <ActionButton tone="secondary" size="sm" onClick={() => setConfirmDelete(false)}>
                  {t('personal.cancel', { defaultValue: '취소' }) as string}
                </ActionButton>
                <ActionButton tone="danger" size="sm" onClick={remove} loading={deleting}>
                  {t('personal.delete', { defaultValue: '삭제' }) as string}
                </ActionButton>
              </ConfirmActions>
            </DeleteConfirm>
          ) : (
            <DeleteRow>
              <LinkDanger type="button" onClick={() => setConfirmDelete(true)}>
                {t('personal.delete', { defaultValue: '삭제' }) as string}
              </LinkDanger>
            </DeleteRow>
          )
        )}
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
const TitleInput = styled.input`
  width: 100%; border: 1px solid transparent; border-radius: 8px; padding: 4px 8px;
  font-size: 16px; font-weight: 700; color: #0F172A; background: transparent;
  &:hover { border-color: #E2E8F0; }
  &:focus { outline: none; border-color: #14B8A6; box-shadow: 0 0 0 3px rgba(20,184,166,.15); background: #fff; }
`;
const Badge = styled.span`
  align-self: flex-start; padding: 2px 8px; border-radius: 999px;
  background: #F0FDFA; color: #0F766E; font-size: 11px; font-weight: 700;
`;
const Row = styled.div`display: flex; gap: 12px; padding: 10px 0; border-bottom: 1px solid #F1F5F9;`;
const Label = styled.div`flex: 0 0 64px; font-size: 12px; font-weight: 600; color: #94A3B8;`;
const Value = styled.div`flex: 1; min-width: 0; font-size: 13px; color: #334155; word-break: break-word; position: relative;`;
const Desc = styled.div`flex: 1; min-width: 0; font-size: 13px; color: #334155; white-space: pre-wrap; word-break: break-word;`;
const DateTimeRow = styled.div`display: flex; align-items: center; gap: 6px; flex-wrap: wrap;`;
const DateTrigger = styled.button`
  height: 30px; padding: 0 10px; border: 1px solid #E2E8F0; border-radius: 8px;
  background: #fff; font-size: 12px; color: #334155; cursor: pointer;
  &:hover { border-color: #14B8A6; }
`;
const TimeWrap = styled.div`width: 96px;`;
const Dash = styled.span`color: #94A3B8; font-size: 12px;`;
const TextInput = styled.input`
  width: 100%; height: 32px; padding: 0 10px;
  border: 1px solid #E2E8F0; border-radius: 8px; font-size: 13px; color: #334155;
  &:focus { outline: none; border-color: #14B8A6; box-shadow: 0 0 0 3px rgba(20,184,166,.15); }
`;
const TextArea = styled.textarea`
  width: 100%; min-height: 84px; padding: 8px 10px; resize: vertical;
  border: 1px solid #E2E8F0; border-radius: 8px; font-size: 13px; color: #334155; line-height: 1.6;
  font-family: inherit;
  &:focus { outline: none; border-color: #14B8A6; box-shadow: 0 0 0 3px rgba(20,184,166,.15); }
`;
const Hint = styled.p`margin: 14px 0 0; font-size: 12px; color: #94A3B8; line-height: 1.6;`;
const Notice = styled.div`
  margin-bottom: 10px; padding: 8px 10px; border-radius: 8px;
  background: #F8FAFC; border: 1px solid #E2E8F0; font-size: 11px; color: #64748B; line-height: 1.6;
`;
const Warn = styled(Notice)`background: #FFFBEB; border-color: #FDE68A; color: #92400E; font-weight: 600;`;
const DeleteRow = styled.div`margin-top: 16px; display: flex; justify-content: flex-end;`;
const LinkDanger = styled.button`
  border: none; background: none; padding: 0; cursor: pointer;
  font-size: 12px; font-weight: 600; color: #94A3B8;
  &:hover { color: #DC2626; text-decoration: underline; }
`;
const DeleteConfirm = styled.div`
  margin-top: 16px; padding: 12px; border-radius: 10px;
  background: #FEF2F2; border: 1px solid #FECACA;
  display: flex; flex-direction: column; gap: 10px;
`;
const ConfirmText = styled.div`font-size: 12px; color: #991B1B; font-weight: 600;`;
const ConfirmActions = styled.div`display: flex; gap: 8px; justify-content: flex-end;`;
