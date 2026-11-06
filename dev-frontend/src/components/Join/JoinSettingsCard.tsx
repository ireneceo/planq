// 설정 › 일반 «멤버 참여» 카드 — 대표만 (2026-11-06 · docs/SIGNUP_START_JOIN_DESIGN.md §6-4)
//   ① 회사 메일 도메인이 같은 사람에게 «참여 신청» 을 보여 주기 ② 참여 코드(표시·복사·새로 만들기).
//   켤 수 있는지는 서버 술어(domain_open · owner_domains) 그대로 말한다 — 화면이 따로 판정하지 않는다.
import React, { useCallback, useEffect, useRef, useState } from 'react';
import styled from 'styled-components';
import { useTranslation } from 'react-i18next';
import AutoSaveField from '../Common/AutoSaveField';
import ActionButton from '../Common/ActionButton';
import ConfirmDialog from '../Common/ConfirmDialog';
import { Switch, SwitchKnob } from '../Common/switchShell';
import { getJoinSettings, putJoinSettings, rotateJoinCode, type JoinSettings } from '../../services/join';

const Toggle: React.FC<{ on: boolean; disabled?: boolean; label: string; testId: string; onSave: (v: boolean) => Promise<void> }> = ({ on: initial, disabled, label, testId, onSave }) => {
  const [on, setOn] = useState(initial);
  const ref = useRef(initial);
  useEffect(() => { setOn(initial); ref.current = initial; }, [initial]);
  return (
    <AutoSaveField type="toggle" onSave={() => onSave(ref.current)}>
      <Switch type="button" role="switch" aria-checked={on} aria-label={label} $on={on} disabled={disabled} data-testid={testId}
        onClick={() => { if (disabled) return; ref.current = !on; setOn(!on); }}>
        <SwitchKnob $on={on} />
      </Switch>
    </AutoSaveField>
  );
};

const JoinSettingsCard: React.FC<{ businessId: number }> = ({ businessId }) => {
  const { t } = useTranslation('settings');
  const [s, setS] = useState<JoinSettings | null>(null);
  const [hidden, setHidden] = useState(false);
  const [copied, setCopied] = useState(false);
  const [rotateOpen, setRotateOpen] = useState(false);
  const [rotating, setRotating] = useState(false);

  const load = useCallback(async () => {
    try { setS(await getJoinSettings(businessId)); } catch { setHidden(true); }   // 대표가 아니면(403) 그리지 않는다
  }, [businessId]);
  useEffect(() => { void load(); }, [load]);

  if (hidden || !s) return null;
  const canDomain = s.owner_domains.length > 0;
  const domain = s.join_domain || s.owner_domains[0] || '';

  const saveDomain = async (v: boolean) => { setS(await putJoinSettings(businessId, { join_by_domain: v, ...(v ? { join_domain: domain } : {}) })); };
  const saveCode = async (v: boolean) => { setS(await putJoinSettings(businessId, { code_enabled: v })); };
  const copy = async () => {
    if (!s.join_code) return;
    try { await navigator.clipboard.writeText(s.join_code); setCopied(true); setTimeout(() => setCopied(false), 2000); } catch { /* 복사 실패 — 코드가 화면에 보인다 */ }
  };
  const rotate = async () => {
    setRotateOpen(false); setRotating(true);
    try { setS(await rotateJoinCode(businessId)); } finally { setRotating(false); }
  };

  return (
    <Card data-testid="join-settings-card">
      <Title>{t('joinSettings.title', '멤버 참여')}</Title>
      <Desc>{t('joinSettings.desc', '초대 없이도 같은 회사 사람이 «참여 신청» 을 보낼 수 있게 합니다. 신청은 대표·관리자가 승인해야 들어옵니다.')}</Desc>

      <Row>
        <RowText>
          <RowLabel>{t('joinSettings.domainLabel', '회사 메일로 찾기')}</RowLabel>
          <RowHint>
            {canDomain
              ? t('joinSettings.domainHint', { domain, defaultValue: '@{{domain}} 메일을 인증한 사람에게 이 워크스페이스가 보입니다.' })
              : t('joinSettings.domainUnavailable', '대표의 인증된 회사 메일이 없어 켤 수 없습니다(gmail·naver 같은 공용 메일은 안 됩니다).')}
          </RowHint>
          {s.join_by_domain && !s.domain_open && canDomain && (
            <Warn>{t('joinSettings.domainClosed', '지금은 닫혀 있습니다 — 대표 메일 도메인이 바뀌었습니다. 다시 켜 주세요.')}</Warn>
          )}
        </RowText>
        <Toggle on={s.join_by_domain && s.domain_open} disabled={!canDomain} label={t('joinSettings.domainLabel', '회사 메일로 찾기') as string}
          testId="join-domain-toggle" onSave={saveDomain} />
      </Row>

      <Row>
        <RowText>
          <RowLabel>{t('joinSettings.codeLabel', '참여 코드')}</RowLabel>
          <RowHint>{t('joinSettings.codeHint', '코드를 받은 사람은 «시작하기» 에서 코드로 이 워크스페이스를 찾아 신청합니다.')}</RowHint>
          {s.code_enabled && s.join_code && (
            <CodeLine>
              <Code data-testid="join-code">{s.join_code}</Code>
              <ActionButton tone="secondary" size="sm" onClick={() => { void copy(); }} data-testid="join-code-copy">
                {copied ? t('joinSettings.copied', '복사됨') : t('joinSettings.copy', '복사')}
              </ActionButton>
              <ActionButton tone="secondary" size="sm" loading={rotating} onClick={() => setRotateOpen(true)} data-testid="join-code-rotate">
                {t('joinSettings.rotate', '새 코드')}
              </ActionButton>
            </CodeLine>
          )}
        </RowText>
        <Toggle on={s.code_enabled} label={t('joinSettings.codeLabel', '참여 코드') as string} testId="join-code-toggle" onSave={saveCode} />
      </Row>

      <ConfirmDialog
        isOpen={rotateOpen}
        onClose={() => setRotateOpen(false)}
        onConfirm={() => { void rotate(); }}
        title={t('joinSettings.rotateTitle', '새 참여 코드를 만들까요?') as string}
        message={t('joinSettings.rotateBody', '지금 코드는 바로 쓸 수 없게 됩니다. 이미 들어온 신청은 그대로 남습니다.') as string}
        confirmText={t('joinSettings.rotateConfirm', '새로 만들기') as string}
        cancelText={t('joinSettings.cancel', '취소') as string}
        variant="warning"
      />
    </Card>
  );
};

export default JoinSettingsCard;

const Card = styled.section`
  background: #ffffff; border: 1px solid #e2e8f0; border-radius: 12px; padding: 24px; margin-bottom: 16px;
`;
const Title = styled.h2`font-size: 1rem; font-weight: 700; color: #0f172a; margin: 0 0 4px;`;
const Desc = styled.p`font-size: 0.8125rem; color: #64748b; margin: 0 0 16px;`;
const Row = styled.div`
  display: flex; align-items: flex-start; justify-content: space-between; gap: 16px;
  padding: 14px 0; border-top: 1px solid #f1f5f9;
`;
const RowText = styled.div`flex: 1; min-width: 0; display: flex; flex-direction: column; gap: 4px;`;
const RowLabel = styled.div`font-size: 0.875rem; font-weight: 600; color: #0f172a;`;
const RowHint = styled.div`font-size: 0.75rem; color: #64748b; line-height: 1.5;`;
const Warn = styled.div`font-size: 0.75rem; color: #b45309;`;
const CodeLine = styled.div`display: flex; align-items: center; gap: 8px; flex-wrap: wrap; margin-top: 6px;`;
const Code = styled.code`
  font-size: 1rem; font-weight: 700; letter-spacing: 1px; color: #0f172a;
  background: #f1f5f9; border-radius: 8px; padding: 6px 10px;
`;
