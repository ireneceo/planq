// 업체 보낸편지함·스팸함 가져오기 — 계정마다 켜고 끈다 (docs/MAIL_SENT_SPAM_SYNC_DESIGN.md).
//
//   Gmail·네이버 웹/앱에서 직접 보낸 메일은 업체 보낸편지함에만 있고, 업체가 스팸으로 보낸 메일은
//   받은편지함에 들어온 적이 없다. 둘 다 **읽기만** 해서 Q mail 에 비춘다(업체 쪽은 아무것도 바꾸지 않는다).
//   폴더 이름은 서버가 업체에서 찾아낸 것을 그대로 보여준다 — 못 찾았으면 «찾지 못함» 이라고 말한다.
//   저장 버튼 없음 — 누르면 바로 저장(AutoSaveField · PlanQ 표준).
import { useRef, useState } from 'react';
import styled from 'styled-components';
import { useTranslation } from 'react-i18next';
import AutoSaveField from '../../components/Common/AutoSaveField';
import { Switch, SwitchKnob } from '../../components/Common/switchShell';
import {
  setMailExtraFolder,
  type MailExtraFolders, type MailExtraFolderRole, type MailExtraFolderState,
} from '../../services/mail';

interface Props {
  businessId: number;
  accountId: number;
  initial?: MailExtraFolders;
}

const DEFAULT_STATE: MailExtraFolderState = {
  enabled: true, folder: null, found: false, discovered: false, last_synced_at: null, has_error: false,
};

const ROLES: MailExtraFolderRole[] = ['sent', 'spam'];

export default function MailExtraFoldersSection({ businessId, accountId, initial }: Props) {
  const { t } = useTranslation('qmail');
  const [state, setState] = useState<MailExtraFolders>(() => initial || {
    global_off: false, sent: DEFAULT_STATE, spam: DEFAULT_STATE,
  });
  // 클릭으로 이미 뒤집힌 값을 저장해야 한다 — 클로저는 뒤집기 전 값을 본다(AutoSaveField 계약: 최신값은 ref)
  const stateRef = useRef(state);
  stateRef.current = state;

  const persist = async (role: MailExtraFolderRole) => {
    const want = stateRef.current[role].enabled;
    try {
      const next = await setMailExtraFolder(businessId, accountId, role, want);
      // savemerge-exempt: 응답이 이 상태의 **전체**다 — 목록 GET 의 extra_folders 와 같은 서버 함수(services/mailExtraFolders.serializeExtraFolders)가 만든다
      setState(next);
    } catch (e) {
      // 실패하면 화면도 되돌리고 던진다 — 래퍼가 ! 를 띄운다(저장된 척 금지)
      setState((s) => ({ ...s, [role]: { ...s[role], enabled: !want } }));
      throw e;
    }
  };

  const folderLine = (st: MailExtraFolderState) => {
    if (!st.discovered) return t('extraFolders.pending', { defaultValue: '다음 동기화 때 폴더를 찾습니다' }) as string;
    if (!st.found) return t('extraFolders.notFound', { defaultValue: '이 메일함에서 폴더를 찾지 못했어요' }) as string;
    return t('extraFolders.folderName', { folder: st.folder, defaultValue: '업체 폴더: {{folder}}' }) as string;
  };

  return (
    <Wrap data-testid={`mail-extra-folders-${accountId}`}>
      <Title>{t('extraFolders.title', { defaultValue: '업체 메일함 가져오기' }) as string}</Title>
      <Desc>{t('extraFolders.desc', { defaultValue: 'Gmail·네이버 등 메일 업체의 보낸편지함·스팸함을 읽기만 해서 함께 보여 줍니다. 업체 쪽 메일은 옮기거나 지우지 않아요.' }) as string}</Desc>
      {state.global_off && (
        <Note role="note">{t('extraFolders.globalOff', { defaultValue: '지금은 서비스 점검으로 업체 메일함 가져오기가 잠시 멈춰 있어요.' }) as string}</Note>
      )}
      <Rows>
        {ROLES.map((role) => {
          const st = state[role];
          const labelId = `mail-extra-${accountId}-${role}-label`;
          return (
            <Row key={role}>
              <Text>
                <Label id={labelId}>
                  {role === 'sent'
                    ? t('extraFolders.sent', { defaultValue: '보낸편지함 가져오기' }) as string
                    : t('extraFolders.spam', { defaultValue: '스팸함 가져오기' }) as string}
                </Label>
                <Sub>
                  {role === 'sent'
                    ? t('extraFolders.sentDesc', { defaultValue: '업체에서 직접 보낸 메일도 «보낸메일» 에 보이고, 답장한 대화로 인식합니다. 처음에는 최근 30일을 가져와요.' }) as string
                    : t('extraFolders.spamDesc', { defaultValue: '업체가 스팸으로 분류한 메일을 «스팸» 탭에 보여 줍니다. 처음에는 최근 14일, 들어온 지 30일이 지나면 자동으로 지워져요.' }) as string}
                </Sub>
                <FolderName $muted={!st.found} data-testid={`mail-extra-folder-${role}`}>{folderLine(st)}</FolderName>
              </Text>
              <AutoSaveField key={`extra-${accountId}-${role}`} type="toggle" onSave={() => persist(role)}>
                <Switch
                  type="button"
                  role="switch"
                  aria-checked={st.enabled}
                  aria-labelledby={labelId}
                  data-testid={`mail-extra-toggle-${role}`}
                  $on={st.enabled}
                  onClick={() => setState((s) => ({ ...s, [role]: { ...s[role], enabled: !s[role].enabled } }))}
                >
                  <SwitchKnob $on={st.enabled} />
                </Switch>
              </AutoSaveField>
            </Row>
          );
        })}
      </Rows>
    </Wrap>
  );
}

const Wrap = styled.div`
  display: flex; flex-direction: column; gap: 8px;
  margin-top: 14px; padding-top: 14px; border-top: 1px solid #F1F5F9;
`;
const Title = styled.div`font-size: 0.8125rem; font-weight: 700; color: #0F172A;`;
const Desc = styled.p`margin: 0; font-size: 0.75rem; color: #94A3B8; line-height: 1.6;`;
const Note = styled.p`
  margin: 0; padding: 6px 10px; border-radius: 8px;
  background: #FFFBEB; border: 1px solid #FDE68A;
  font-size: 0.6875rem; color: #92400E; line-height: 1.6;
`;
const Rows = styled.div`
  display: flex; flex-direction: column; gap: 8px;
  @media (min-width: 769px) { flex-direction: row; }
`;
const Row = styled.div`
  flex: 1; min-width: 0;
  display: flex; align-items: flex-start; justify-content: space-between; gap: 12px;
  padding: 12px; border-radius: 10px; border: 1px solid #E2E8F0; background: #FFFFFF;
`;
const Text = styled.div`display: flex; flex-direction: column; gap: 2px; min-width: 0;`;
const Label = styled.span`font-size: 0.8125rem; font-weight: 600; color: #0F172A;`;
const Sub = styled.span`font-size: 0.6875rem; color: #64748B; line-height: 1.5;`;
const FolderName = styled.span<{ $muted: boolean }>`
  margin-top: 2px; font-size: 0.6875rem; line-height: 1.5;
  color: ${(p) => (p.$muted ? '#94A3B8' : '#0F766E')};
  overflow-wrap: anywhere;
`;
