// 퇴사 인수인계 칸 — 멤버 상세의 «멤버 제거» 확인 자리 · «나간 멤버 — 남은 일» 줄이 같은 칸을 쓴다.
//   서버 GET/POST /api/businesses/:biz/members/:memberId/handover (services/memberHandover). 설계 docs/ORG_STAGE0_DESIGN.md 9절.
//   ★ 수만 보여 준다 — 제목은 받지 않는다(«나만 보기» 가 섞여 있다).
//   ★ 새 패널을 띄우지 않는다 — 멤버 상세 드로어 안의 확인 자리(팝업 위 팝업 금지).
import React, { useCallback, useEffect, useMemo, useState } from 'react';
import styled from 'styled-components';
import TrustNote from '../Common/TrustNote';
import { useTranslation } from 'react-i18next';
import { apiFetch } from '../../contexts/AuthContext';
import ActionButton from '../Common/ActionButton';
import PlanQSelect from '../Common/PlanQSelect';
import { formatDay } from '../../utils/dateFormat';

export interface HandoverCandidate { user_id: number; name: string }

interface Counts {
  assigned: number; assigned_private: number; reviewing: number; requested: number;
  unassigned_private: number; created_private_with_assignee: number;
  projects: number; clients: number; mail_assigned: number; booking_open: number;
}
interface Summary { counts: Counts; total: number; private_total: number; l1_effective: boolean; l1_effective_at: string; l1_effective_on?: string }

interface Props {
  businessId: number;
  memberId: number;
  fromUserId: number | null;
  /** remove = 멤버 제거 확인 자리(넘기고 제거 / 넘기지 않고 제거) · departed = 이미 나간 사람(넘기기만) */
  mode: 'remove' | 'departed';
  candidates: HandoverCandidate[];
  busy?: boolean;
  onCancel: () => void;
  /** remove 모드 — 넘기기가 끝났거나 넘기지 않기로 했을 때 실제 제거를 부른다 */
  onRemove?: () => Promise<void> | void;
  /** departed 모드 — 넘기기가 끝난 뒤 목록을 다시 읽는다 */
  onDone?: () => void;
}

const MemberHandoverBox: React.FC<Props> = ({ businessId, memberId, fromUserId, mode, candidates, busy, onCancel, onRemove, onDone }) => {
  const { t } = useTranslation('settings');
  const [sum, setSum] = useState<Summary | null>(null);
  const [loadErr, setLoadErr] = useState(false);
  const [toUserId, setToUserId] = useState<number | null>(null);
  const [working, setWorking] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [skipAsk, setSkipAsk] = useState(false);
  const [doneMsg, setDoneMsg] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoadErr(false);
    try {
      const r = await apiFetch(`/api/businesses/${businessId}/members/${memberId}/handover`);
      if (!r.ok) { setLoadErr(true); return; }
      const j = await r.json();
      setSum(j.data as Summary);
    } catch { setLoadErr(true); }
  }, [businessId, memberId]);
  useEffect(() => { void load(); }, [load]);

  const options = useMemo(() => candidates
    .filter((c) => c.user_id !== fromUserId)
    .map((c) => ({ value: c.user_id, label: c.name })), [candidates, fromUserId]);

  const c = sum?.counts;
  const hasWork = !!sum && (sum.total > 0 || sum.private_total > 0);
  const extras = c ? c.mail_assigned + c.booking_open : 0;
  const effectiveDate = sum ? formatDay(sum.l1_effective_on || sum.l1_effective_at, { year: 'always' }) : '';

  const doHandover = async () => {
    if (!toUserId) return;
    setWorking(true); setErr(null);
    try {
      const r = await apiFetch(`/api/businesses/${businessId}/members/${memberId}/handover`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ to_user_id: toUserId }),
      });
      if (!r.ok) {
        const j = await r.json().catch(() => ({}));
        setErr(j?.message === 'invalid_recipient'
          ? t('members.handover.errRecipient', '넘겨받을 사람을 다시 골라 주세요.') as string
          : t('members.handover.errFailed', '넘기지 못했습니다. 잠시 후 다시 시도해 주세요.') as string);
        return;
      }
      const j = await r.json();
      const m = j.data?.moved || {};
      setDoneMsg(t('members.handover.done', '업무 {{tasks}}건 · 프로젝트 {{projects}}건 · 고객 {{clients}}건을 넘겼습니다.', {
        tasks: m.tasks || 0, projects: m.projects || 0, clients: m.clients || 0,
      }) as string);
      if (mode === 'remove' && onRemove) await onRemove();
      else { onDone?.(); await load(); }
    } catch {
      setErr(t('members.handover.errFailed', '넘기지 못했습니다. 잠시 후 다시 시도해 주세요.') as string);
    } finally { setWorking(false); }
  };

  if (loadErr) {
    return (
      <Box data-testid="member-handover">
        <Text>{t('members.handover.loadFailed', '남은 일을 불러오지 못했습니다.')}</Text>
        <Row>
          <ActionButton tone="secondary" size="sm" onClick={onCancel}>{t('members.inviteCancel', '취소')}</ActionButton>
          <ActionButton tone="secondary" size="sm" onClick={() => void load()}>{t('members.handover.retry', '다시 시도')}</ActionButton>
        </Row>
      </Box>
    );
  }
  if (!sum || !c) return <Box data-testid="member-handover"><Text>{t('members.handover.loading', '남은 일을 세는 중…')}</Text></Box>;

  // 남은 일이 없으면 종전 확인 그대로
  if (!hasWork && mode === 'remove') {
    return (
      <Box data-testid="member-handover" $danger>
        <Text $danger>{t('members.drawer.removeConfirm', '이 멤버를 워크스페이스에서 제거합니다. 과거 업무 이력은 보존됩니다.')}</Text>
        <TrustNote spot="memberRemove" />
        <Row>
          <ActionButton tone="secondary" size="sm" onClick={onCancel}>{t('members.inviteCancel', '취소')}</ActionButton>
          <ActionButton tone="danger" size="sm" loading={busy} onClick={() => void onRemove?.()} data-testid="member-remove-confirm">{t('members.drawer.remove', '제거')}</ActionButton>
        </Row>
      </Box>
    );
  }

  const parts = [
    c.assigned ? t('members.handover.cAssigned', '맡은 업무 {{n}}', { n: c.assigned }) : null,
    c.reviewing ? t('members.handover.cReviewing', '컨펌 대기 {{n}}', { n: c.reviewing }) : null,
    c.requested ? t('members.handover.cRequested', '요청한 업무 {{n}}', { n: c.requested }) : null,
    c.unassigned_private ? t('members.handover.cUnassignedPrivate', '담당 없는 나만 보기 {{n}}', { n: c.unassigned_private }) : null,
    c.projects ? t('members.handover.cProjects', '프로젝트 주인·PM {{n}}', { n: c.projects }) : null,
    c.clients ? t('members.handover.cClients', '고객 담당 {{n}}', { n: c.clients }) : null,
  ].filter(Boolean) as string[];

  return (
    <Box data-testid="member-handover">
      <Title>{t('members.handover.title', '남은 일 넘기기')}</Title>
      {parts.length > 0 && <Text data-testid="member-handover-counts">{parts.join(' · ')}</Text>}
      {sum.private_total > 0 && (
        <Hint>
          {sum.l1_effective
            ? t('members.handover.privateNow', '«나만 보기» 업무 {{n}}건은 넘겨받는 사람만 볼 수 있습니다(대표에게도 열리지 않습니다).', { n: sum.private_total })
            : t('members.handover.privateLater', '«나만 보기» 업무 {{n}}건은 이용약관 시행일({{date}})부터 넘길 수 있습니다. 지금은 그대로 둡니다.', { n: sum.private_total, date: effectiveDate })}
        </Hint>
      )}
      {c.created_private_with_assignee > 0 && (
        <Hint>{t('members.handover.createdOnly', '이 사람이 만들기만 한 «나만 보기» 업무 {{n}}건은 담당자가 있어 그대로 둡니다.', { n: c.created_private_with_assignee })}</Hint>
      )}
      {extras > 0 && (
        <Hint>{t('members.handover.extras', '그 밖에 담당 메일 {{mail}}건 · 상담 예약 {{booking}}건은 직접 옮겨 주세요.', { mail: c.mail_assigned, booking: c.booking_open })}</Hint>
      )}
      <Hint>{t('members.handover.notMoved', '문서·파일·메모는 넘기지 않습니다(작성자 기록 그대로).')}</Hint>
      {mode === 'remove' && <TrustNote spot="memberRemove" />}

      {sum.total > 0 && (
        <SelectWrap data-testid="member-handover-recipient">
          <PlanQSelect
            value={options.find((o) => o.value === toUserId) || null}
            onChange={(opt) => setToUserId(((opt as { value: number } | null)?.value) ?? null)}
            options={options}
            placeholder={t('members.handover.pick', '넘겨받을 사람') as string}
            size="sm"
            isDisabled={working || busy}
          />
        </SelectWrap>
      )}
      {err && <Err>{err}</Err>}
      {doneMsg && <Done>{doneMsg}</Done>}

      {skipAsk ? (
        <>
          <Text $danger>{t('members.handover.skipConfirm', '넘기지 않고 제거하면 맡은 업무 {{n}}건이 담당자 없이 남습니다. 제거할까요?', { n: c.assigned })}</Text>
          <Row>
            <ActionButton tone="secondary" size="sm" onClick={() => setSkipAsk(false)}>{t('members.inviteCancel', '취소')}</ActionButton>
            <ActionButton tone="danger" size="sm" loading={busy} onClick={() => void onRemove?.()}>{t('members.handover.skipRemove', '넘기지 않고 제거')}</ActionButton>
          </Row>
        </>
      ) : (
        <Row>
          <ActionButton tone="secondary" size="sm" onClick={onCancel}>{mode === 'remove' ? t('members.inviteCancel', '취소') : t('members.handover.close', '닫기')}</ActionButton>
          {mode === 'remove' && (
            <ActionButton tone="danger" size="sm" disabled={working || busy} onClick={() => setSkipAsk(true)} data-testid="member-handover-skip">
              {t('members.handover.skipRemove', '넘기지 않고 제거')}
            </ActionButton>
          )}
          {sum.total > 0 && (
            <ActionButton tone="primary" size="sm" loading={working} disabled={!toUserId || busy} onClick={() => void doHandover()} data-testid="member-handover-submit">
              {mode === 'remove' ? t('members.handover.submitRemove', '넘기고 제거') : t('members.handover.submit', '넘기기')}
            </ActionButton>
          )}
        </Row>
      )}
    </Box>
  );
};

export default MemberHandoverBox;

const Box = styled.div<{ $danger?: boolean }>`
  margin-top: 10px; padding: 12px; border-radius: 10px;
  background: ${(p) => (p.$danger ? '#FEF2F2' : '#F8FAFC')};
  border: 1px solid ${(p) => (p.$danger ? '#FECACA' : '#E2E8F0')};
  display: flex; flex-direction: column; gap: 8px;
`;
const Title = styled.div`font-size: 0.8125rem; font-weight: 700; color: #0F172A;`;
const Text = styled.div<{ $danger?: boolean }>`font-size: 0.75rem; line-height: 1.5; color: ${(p) => (p.$danger ? '#7F1D1D' : '#334155')};`;
const Hint = styled.div`font-size: 0.75rem; line-height: 1.5; color: #64748B;`;
const Err = styled.div`font-size: 0.75rem; color: #DC2626;`;
const Done = styled.div`font-size: 0.75rem; color: #0F766E;`;
const Row = styled.div`display: flex; gap: 6px; justify-content: flex-end; flex-wrap: wrap;`;
const SelectWrap = styled.div`max-width: 100%;`;
