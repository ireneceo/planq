// 메일 분류 규칙 (학습형) — 투명성 화면.
//
// PlanQ 는 같은 발신자를 두 번 "답변 완료" 하면 "답장 안 해도 되는 발신자" 로 학습한다.
// 그런데 사용자가 모르는 사이 메일이 조용히 걸러지면 안 된다 → 학습된 규칙과 그 근거를
// 여기서 전부 보여주고, 언제든 지울 수 있게 한다. 규칙 삭제 = 즉시 원상복구(원본 메일 무손상).
import { useCallback, useEffect, useState } from 'react';
import styled from 'styled-components';
import { useTranslation } from 'react-i18next';
import ActionButton from '../../components/Common/ActionButton';
import EmptyState from '../../components/Common/EmptyState';
import PlanQSelect, { type PlanQSelectOption } from '../../components/Common/PlanQSelect';
import {
  listMailRules, addMailRule, deleteMailRule, type MailSenderRule,
} from '../../services/mail';

interface Props { businessId: number; }

const VERDICT_TONE: Record<MailSenderRule['verdict'], { bg: string; fg: string }> = {
  no_reply: { bg: '#F1F5F9', fg: '#475569' },
  always_reply: { bg: '#F0FDFA', fg: '#0F766E' },
  marketing: { bg: '#FEF9C3', fg: '#A16207' },
  spam: { bg: '#FEE2E2', fg: '#B91C1C' },
};

export default function MailRulesSection({ businessId }: Props) {
  const { t } = useTranslation('qmail');
  const [rules, setRules] = useState<MailSenderRule[]>([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [pattern, setPattern] = useState('');
  const [verdict, setVerdict] = useState<MailSenderRule['verdict']>('no_reply');
  const [err, setErr] = useState<string | null>(null);

  const load = useCallback(async () => {
    try { setRules(await listMailRules(businessId)); }
    catch { setRules([]); }
    finally { setLoading(false); }
  }, [businessId]);
  useEffect(() => { load(); }, [load]);

  const onAdd = async () => {
    const p = pattern.trim();
    if (!p || busy) return;
    setBusy(true); setErr(null);
    try {
      await addMailRule(businessId, p, verdict);
      setPattern('');
      await load();
    } catch {
      setErr(t('rules.addFailed', { defaultValue: '주소나 도메인 형식을 확인해 주세요 (예: noreply@company.com 또는 company.com)' }) as string);
    } finally { setBusy(false); }
  };

  const onDelete = async (id: number) => {
    setBusy(true);
    try { await deleteMailRule(businessId, id); await load(); }
    catch { /* 목록 재조회로 정합 */ }
    finally { setBusy(false); }
  };

  const verdictLabel = (v: MailSenderRule['verdict']) => t(`rules.verdict.${v}`, {
    defaultValue: { no_reply: '답장 불필요', always_reply: '항상 답변 필요', marketing: '마케팅', spam: '스팸' }[v],
  }) as string;

  const evidenceText = (r: MailSenderRule) => {
    const sig = r.evidence?.signal || '';
    if (r.source === 'manual') return t('rules.evidence.manual', { defaultValue: '직접 추가함' }) as string;
    if (sig.startsWith('dismiss_x')) {
      const n = sig.replace('dismiss_x', '');
      return t('rules.evidence.dismiss', { n, defaultValue: `"답변 완료" 를 ${n}번 눌러서 학습됨` }) as string;
    }
    if (sig.startsWith('spam_x')) {
      const n = sig.replace('spam_x', '');
      return t('rules.evidence.spam', { n, defaultValue: `스팸으로 ${n}번 표시해서 학습됨` }) as string;
    }
    if (sig.startsWith('domain_promote')) {
      return t('rules.evidence.domain', { defaultValue: '같은 도메인 주소 여러 개가 답장 불필요로 학습되어 도메인 전체로 확장됨' }) as string;
    }
    return sig;
  };

  return (
    <Section>
      <Head>
        <div>
          <Title>{t('rules.title', { defaultValue: '메일 분류 규칙' })}</Title>
          <Desc>
            {t('rules.desc', { defaultValue: '같은 발신자를 두 번 "답변 완료" 하면 앞으로 그 발신자는 "답변 필요" 에 나타나지 않도록 자동으로 학습합니다. 학습된 규칙은 아래에서 전부 확인하고 지울 수 있습니다. 규칙을 지우면 원래대로 돌아갑니다 — 메일 자체는 삭제되지 않습니다.' })}
          </Desc>
        </div>
      </Head>

      <AddRow>
        <PatternInput
          type="text"
          value={pattern}
          onChange={(e) => setPattern(e.target.value)}
          placeholder={t('rules.placeholder', { defaultValue: 'noreply@company.com 또는 company.com' }) as string}
          disabled={busy}
        />
        <SelectWrap>
          <PlanQSelect
            size="sm"
            isSearchable={false}
            value={{ value: verdict, label: verdictLabel(verdict) }}
            onChange={(opt) => setVerdict(((opt as PlanQSelectOption | null)?.value as MailSenderRule['verdict']) || 'no_reply')}
            options={(['no_reply', 'always_reply', 'marketing', 'spam'] as const).map((v) => ({ value: v, label: verdictLabel(v) }))}
          />
        </SelectWrap>
        <ActionButton tone="secondary" size="sm" onClick={onAdd} loading={busy} disabled={!pattern.trim()}>
          {t('rules.add', { defaultValue: '규칙 추가' })}
        </ActionButton>
      </AddRow>
      {err && <ErrText>{err}</ErrText>}

      {loading ? (
        <Muted>{t('common.loading', { defaultValue: '불러오는 중…' })}</Muted>
      ) : rules.length === 0 ? (
        <EmptyState
          title={t('rules.empty.title', { defaultValue: '아직 학습된 규칙이 없어요' }) as string}
          description={t('rules.empty.body', { defaultValue: '같은 발신자를 두 번 "답변 완료" 하면 자동으로 규칙이 만들어집니다. 직접 추가할 수도 있습니다.' }) as string}
        />
      ) : (
        <List>
          {rules.map((r) => {
            const tone = VERDICT_TONE[r.verdict];
            return (
              <Row key={r.id}>
                <Main>
                  <PatternText>{r.pattern}</PatternText>
                  <Meta>
                    <Chip $bg={tone.bg} $fg={tone.fg}>{verdictLabel(r.verdict)}</Chip>
                    <Kind>{r.pattern_type === 'domain'
                      ? t('rules.kind.domain', { defaultValue: '도메인 전체' })
                      : t('rules.kind.address', { defaultValue: '이 주소만' })}</Kind>
                    {r.hit_count > 0 && (
                      <Kind>{t('rules.hits', { n: r.hit_count, defaultValue: `${r.hit_count}번 적용됨` }) as string}</Kind>
                    )}
                  </Meta>
                  <Evidence>{evidenceText(r)}</Evidence>
                </Main>
                <ActionButton tone="secondary" size="sm" onClick={() => onDelete(r.id)} disabled={busy}>
                  {t('rules.delete', { defaultValue: '삭제' })}
                </ActionButton>
              </Row>
            );
          })}
        </List>
      )}
    </Section>
  );
}

const Section = styled.section`
  background: #fff; border: 1px solid #E2E8F0; border-radius: 12px;
  padding: 20px; display: flex; flex-direction: column; gap: 16px;
`;
const Head = styled.div`display: flex; align-items: flex-start; justify-content: space-between; gap: 12px;`;
const Title = styled.h3`margin: 0 0 6px; font-size: 15px; font-weight: 700; color: #0F172A;`;
const Desc = styled.p`margin: 0; font-size: 13px; line-height: 1.6; color: #64748B;`;
const AddRow = styled.div`display: flex; align-items: center; gap: 8px; flex-wrap: wrap;`;
const PatternInput = styled.input`
  flex: 1; min-width: 220px; height: 36px; padding: 0 12px;
  border: 1px solid #E2E8F0; border-radius: 8px; font-size: 13px; color: #334155;
  &:focus { outline: none; border-color: #14B8A6; box-shadow: 0 0 0 3px rgba(20,184,166,.15); }
`;
const SelectWrap = styled.div`min-width: 150px;`;
const ErrText = styled.div`font-size: 12px; font-weight: 600; color: #B45309;`;
const Muted = styled.div`font-size: 13px; color: #94A3B8;`;
const List = styled.ul`list-style: none; margin: 0; padding: 0; display: flex; flex-direction: column; gap: 8px;`;
const Row = styled.li`
  display: flex; align-items: center; justify-content: space-between; gap: 12px;
  padding: 12px 14px; background: #F8FAFC; border: 1px solid #E2E8F0; border-radius: 10px;
`;
const Main = styled.div`min-width: 0; display: flex; flex-direction: column; gap: 4px;`;
const PatternText = styled.div`font-size: 13px; font-weight: 600; color: #0F172A; word-break: break-all;`;
const Meta = styled.div`display: flex; align-items: center; gap: 6px; flex-wrap: wrap;`;
const Chip = styled.span<{ $bg: string; $fg: string }>`
  padding: 2px 8px; border-radius: 999px; font-size: 11px; font-weight: 700;
  background: ${(p) => p.$bg}; color: ${(p) => p.$fg};
`;
const Kind = styled.span`font-size: 11px; color: #94A3B8;`;
const Evidence = styled.div`font-size: 12px; color: #64748B;`;
