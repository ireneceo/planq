// 일정 추가 «장소» 칸 — [오프라인 | 온라인] 중 고른 쪽 칸만 보인다(2026-10-21 Irene «권고대로»).
//   둘 다 쓰는 회의는 «+ … 도» 로 나머지 칸을 연다. 저장할 때 무엇을 보낼지는 NewEventModal 이 정한다(보이는 칸만).
import React from 'react';
import { useTranslation } from 'react-i18next';
import { SegmentedBtn } from '../../components/Common/segmentedToggle';
import { Field, Label, AttachToggle, CheckboxLabel, Input, AutoMeetingRow, AutoMeetingText, PlaceToggle } from './eventFormStyles';
import LocationAutocomplete from './LocationAutocomplete';

export type PlaceMode = 'offline' | 'online';

interface Props {
  placeMode: PlaceMode; setPlaceMode: (v: PlaceMode) => void;
  placeBoth: boolean; setPlaceBoth: (v: boolean) => void;
  location: string; setLocation: (v: string) => void;
  meetingUrl: string; setMeetingUrl: (v: string) => void;
  autoCreateMeeting: boolean; setAutoCreateMeeting: (v: boolean) => void;
  gcalConfigured: boolean; gcalCanWrite: boolean; isPrivateVis: boolean;
  meetSource: 'personal' | 'workspace' | null; personalConnected: boolean;
  /** 오너이고 워크스페이스 연동에 쓰기 권한이 없을 때만 — 누를 수 없는 경로는 보여주지 않는다 */
  showWorkspaceReconnect: boolean;
}

const EventPlaceField: React.FC<Props> = ({
  placeMode, setPlaceMode, placeBoth, setPlaceBoth, location, setLocation, meetingUrl, setMeetingUrl,
  autoCreateMeeting, setAutoCreateMeeting, gcalConfigured, gcalCanWrite, isPrivateVis,
  meetSource, personalConnected, showWorkspaceReconnect,
}) => {
  const { t } = useTranslation('qcalendar');
  const showLocation = placeMode === 'offline' || placeBoth;
  const showOnline = placeMode === 'online' || placeBoth;
  return (
    <Field data-testid="new-event-place">
      <Label>{t('form.place')}</Label>
      <PlaceToggle role="group" aria-label={t('form.place') as string} data-testid="new-event-place-toggle">
        <SegmentedBtn type="button" $active={!placeBoth && placeMode === 'offline'} aria-pressed={!placeBoth && placeMode === 'offline'}
          data-testid="new-event-place-offline" onClick={() => { setPlaceMode('offline'); setPlaceBoth(false); }}>
          {t('form.placeOffline')}
        </SegmentedBtn>
        <SegmentedBtn type="button" $active={!placeBoth && placeMode === 'online'} aria-pressed={!placeBoth && placeMode === 'online'}
          data-testid="new-event-place-online" onClick={() => { setPlaceMode('online'); setPlaceBoth(false); }}>
          {t('form.placeOnline')}
        </SegmentedBtn>
      </PlaceToggle>
      {showLocation && (
        <LocationAutocomplete
          data-testid="new-event-location"
          value={location} onChange={setLocation}
          placeholder={t('form.locationPlaceholder')}
          aria-label={t('form.location') as string}
        />
      )}
      {showOnline && (<>
      {/* Google Meet 자동 생성 — 워크스페이스가 Google Calendar 연결되어 있을 때만 노출.
          연결 안 됨 + 서버 OAuth 설정은 정상 → "Google 계정 연결하기" CTA 안내. */}
      {/* 비공개(L1/L2) 일정에는 Meet 을 걸 수 없다 — 백엔드가 400 으로 **일정 생성 자체를
          거부**하므로(유출 차단), 체크할 수 있게 두면 저장이 통째로 실패한다. */}
      {gcalCanWrite && !isPrivateVis && (
        <AutoMeetingRow>
          <CheckboxLabel>
            <input
              type="checkbox"
              checked={autoCreateMeeting}
              onChange={(e) => setAutoCreateMeeting(e.target.checked)}
            />
            <AutoMeetingText>
              <strong>{t('form.autoCreateMeeting')}</strong>
              <small>
                {meetSource === 'personal'
                  ? t('form.autoCreateMeetingPersonal')
                  : t('form.autoCreateMeetingHelp')}
              </small>
            </AutoMeetingText>
          </CheckboxLabel>
        </AutoMeetingRow>
      )}
      {/* Meet 을 못 만드는 상태의 안내 — **그 사용자가 스스로 할 수 있는 행동**만 가리킨다.
          개인 연동(/profile/integrations)은 누구나 할 수 있고, 워크스페이스 연동
          (/business/settings/storage)은 오너 전용이다. 옛 코드는 둘 다 워크스페이스로
          보내서, 직원에게는 눌러도 403 이 나는 죽은 안내였다(#246 과 같은 계열).
          Meet 은 이미 개인 연동 우선으로 동작하므로 개인 경로가 주 CTA 가 맞다. */}
      {gcalConfigured && !gcalCanWrite && (
        <>
          <AutoMeetingRow as="a" href="/profile/integrations" style={{ textDecoration: 'none', cursor: 'pointer' }}>
            <AutoMeetingText>
              <strong>
                {personalConnected
                  ? t('form.gcalPersonalReconnectPrompt')
                  : t('form.gcalPersonalConnectPrompt')}
              </strong>
              <small>
                {personalConnected
                  ? t('form.gcalPersonalReconnectHelp')
                  : t('form.gcalPersonalConnectHelp')}
              </small>
            </AutoMeetingText>
          </AutoMeetingRow>
          {/* 오너에게만 — 워크스페이스 연동도 권한이 없으면 그쪽도 고칠 수 있다고 알린다.
              오너가 아니면 이 줄은 뜨지 않는다(누를 수 없는 경로를 보여주지 않기 위해). */}
          {showWorkspaceReconnect && (
            <AutoMeetingRow as="a" href="/business/settings/storage" style={{ textDecoration: 'none', cursor: 'pointer' }}>
              <AutoMeetingText>
                <strong>{t('form.gcalWorkspaceReconnectPrompt')}</strong>
                <small>{t('form.gcalWorkspaceReconnectHelp')}</small>
              </AutoMeetingText>
            </AutoMeetingRow>
          )}
        </>
      )}
      <Input
        data-testid="new-event-meeting-url"
        aria-label={t('form.meetingUrl') as string}
        value={meetingUrl} onChange={(e) => setMeetingUrl(e.target.value)}
        placeholder={t('form.meetingUrlPlaceholder')}
        disabled={autoCreateMeeting}
      />
      </>)}
      {!placeBoth && (
        <AttachToggle type="button" data-testid="new-event-place-both" onClick={() => setPlaceBoth(true)}>
          + {placeMode === 'offline' ? t('form.addOnlineToo') : t('form.addPlaceToo')}
        </AttachToggle>
      )}
    </Field>
  );
};

export default EventPlaceField;
