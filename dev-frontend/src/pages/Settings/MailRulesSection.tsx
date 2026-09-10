// 메일 분류 규칙 (학습형) — 투명성 화면.
//
// PlanQ 는 같은 발신자를 두 번 "답변 불필요" 하면 "답장 안 해도 되는 발신자" 로 학습한다.
// 그런데 사용자가 모르는 사이 메일이 조용히 걸러지면 안 된다 → 학습된 규칙과 그 근거를
// 여기서 전부 보여주고, 언제든 지울 수 있게 한다. 규칙 삭제 = 즉시 원상복구(원본 메일 무손상).
import { useCallback, useEffect, useState } from 'react';
import styled from 'styled-components';
import { useTranslation } from 'react-i18next';
import ActionButton from '../../components/Common/ActionButton';
import EmptyState from '../../components/Common/EmptyState';
import PlanQSelect, { type PlanQSelectOption } from '../../components/Common/PlanQSelect';
import {
  listMailRules, addMailRule, deleteMailRule, previewMailRule,
  type MailSenderRule, type MailRulePreview,
} from '../../services/mail';

interface Props { businessId: number; }

/**
 * 예시 프리셋 — **폼을 채워 주기만** 한다. 브랜드 이름을 판정 엔진에 박지 않는다.
 *   워크스페이스마다 운영하는 것이 다르므로(에어비앤비를 하는 곳도, 안 하는 곳도 있다)
 *   "무엇을 운영하는지" 는 그 워크스페이스가 선언해야 한다. 엔진에 넣으면 남의 워크스페이스에도 새고,
 *   지울 수도 없다. 여기 있는 것은 사용자가 고쳐 쓰는 출발점이다.
 */
const PRESETS: Array<{
  key: string; kind: 'address' | 'keyword';
  /** 문구 프리셋의 예시어는 **언어를 탄다** — 영어 워크스페이스에 '문의' 를 채우면 안 된다.
   *  그래서 값도 i18n 키로 둔다(patternKey). 주소 프리셋은 도메인이라 언어 무관. */
  pattern?: string; patternKey?: string;
  verdict: MailSenderRule['verdict']; matchField?: MailSenderRule['match_field'];
}> = [
  { key: 'airbnb', kind: 'address', pattern: 'airbnb.com', verdict: 'review' },
  { key: 'siteInquiry', kind: 'keyword', patternKey: 'rules.preset.siteInquiryPattern', verdict: 'review', matchField: 'subject' },
  { key: 'industry', kind: 'address', pattern: '', verdict: 'review' },
];

const VERDICT_TONE: Record<MailSenderRule['verdict'], { bg: string; fg: string }> = {
  no_reply: { bg: '#F1F5F9', fg: '#475569' },
  always_reply: { bg: '#F0FDFA', fg: '#0F766E' },
  marketing: { bg: '#FEF9C3', fg: '#A16207' },
  spam: { bg: '#FEE2E2', fg: '#B91C1C' },
  review: { bg: '#EEF2FF', fg: '#4338CA' },
};

export default function MailRulesSection({ businessId }: Props) {
  const { t } = useTranslation('qmail');
  const [rules, setRules] = useState<MailSenderRule[]>([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [pattern, setPattern] = useState('');
  const [verdict, setVerdict] = useState<MailSenderRule['verdict']>('no_reply');
  // #344 — 주소 규칙과 문구 규칙은 성격이 달라 입력 자체를 나눈다.
  //   주소: "이 사람이 보낸 것" · 문구: "제목·본문에 이 말이 들어간 것"
  const [kind, setKind] = useState<'address' | 'keyword'>('address');
  const [matchField, setMatchField] = useState<MailSenderRule['match_field']>('subject');
  const [markImportant, setMarkImportant] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  // 저장 전 미리보기 · 저장 후 소급 적용 결과 — 둘 다 "이 조건이 무엇을 잡았는지" 를 말한다.
  const [preview, setPreview] = useState<MailRulePreview | null>(null);
  const [applied, setApplied] = useState<{ matched: number; changed: number; verdict: MailSenderRule['verdict'] } | null>(null);

  const load = useCallback(async () => {
    try { setRules(await listMailRules(businessId)); }
    catch { setRules([]); }
    finally { setLoading(false); }
  }, [businessId]);
  useEffect(() => { load(); }, [load]);

  // 조건을 바꾸면 앞의 미리보기 숫자는 거짓이 된다 — 남겨두면 다른 조건의 결과를 보고 판단한다.
  useEffect(() => { setPreview(null); }, [pattern, kind, matchField]);

  const onPreview = async () => {
    const p = pattern.trim();
    if (!p || busy) return;
    setBusy(true); setErr(null); setApplied(null);
    try {
      setPreview(await previewMailRule(businessId, p, kind === 'keyword'
        ? { pattern_type: 'keyword', match_field: matchField }
        : {}));
    } catch {
      setPreview(null);
      setErr(t('rules.previewFailed', { defaultValue: '조건을 확인하지 못했습니다. 주소·도메인 형식이나 문구 길이를 확인해 주세요.' }) as string);
    } finally { setBusy(false); }
  };

  const onAdd = async () => {
    const p = pattern.trim();
    if (!p || busy) return;
    setBusy(true); setErr(null);
    try {
      const saved = await addMailRule(businessId, p, verdict, kind === 'keyword'
        ? { pattern_type: 'keyword', match_field: matchField, mark_important: markImportant }
        : { mark_important: markImportant });
      // 소급 적용 결과 — 규칙은 **이미 받은 메일에도** 적용된다(2026-09-10). 몇 건이 움직였는지 말한다.
      setApplied(saved.applied ? { ...saved.applied, verdict } : null);
      setPreview(null);
      setPattern('');
      await load();
    } catch {
      setErr(kind === 'keyword'
        ? t('rules.addFailedKeyword', { defaultValue: '두 글자 이상 입력해 주세요. 너무 짧으면 관계없는 메일까지 걸립니다.' }) as string
        : t('rules.addFailed', { defaultValue: '주소나 도메인 형식을 확인해 주세요 (예: noreply@company.com 또는 company.com)' }) as string);
    } finally { setBusy(false); }
  };

  const onDelete = async (id: number) => {
    setBusy(true);
    try { await deleteMailRule(businessId, id); await load(); }
    catch { /* 목록 재조회로 정합 */ }
    finally { setBusy(false); }
  };

  const verdictLabel = (v: MailSenderRule['verdict']) => t(`rules.verdict.${v}`, {
    defaultValue: { no_reply: '답장 불필요', always_reply: '항상 답변 필요', marketing: '마케팅', spam: '스팸', review: '확인 권장' }[v],
  }) as string;
  const fieldLabel = (f: MailSenderRule['match_field']) => t(`rules.field.${f}`, {
    defaultValue: { from: '보낸 주소', subject: '제목', body: '본문', any: '제목·본문' }[f],
  }) as string;

  const evidenceText = (r: MailSenderRule) => {
    const sig = r.evidence?.signal || '';
    if (r.source === 'manual') return t('rules.evidence.manual', { defaultValue: '직접 추가함' }) as string;
    if (sig.startsWith('dismiss_x')) {
      const n = sig.replace('dismiss_x', '');
      return t('rules.evidence.dismiss', { n, defaultValue: `"답변 불필요" 를 ${n}번 눌러서 학습됨` }) as string;
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
            {t('rules.desc', { defaultValue: '같은 발신자를 두 번 "답변 불필요" 하면 앞으로 그 발신자는 "답변 필요" 에 나타나지 않도록 자동으로 학습합니다. 학습된 규칙은 아래에서 전부 확인하고 지울 수 있습니다. 규칙을 지우면 원래대로 돌아갑니다 — 메일 자체는 삭제되지 않습니다.' })}
          </Desc>
        </div>
      </Head>

      {/* ★ 2026-09-10 (Irene): "이런 조건화를 메일 설정에서 이해하게 해줘."
          규칙을 만들려면 **지금 어떤 기준으로 나뉘는지**부터 알아야 한다. 규칙 설명서를 쓰지 않고
          네 칸이 각각 무엇인지만 짧게 말한다 (feedback_rules_must_be_explained_briefly). */}
      <HowBox>
        <HowTitle>{t('rules.how.title', { defaultValue: 'PlanQ 가 받은 메일을 나누는 기준' }) as string}</HowTitle>
        <HowList>
          <li><b>{t('rules.how.replyLabel', { defaultValue: '답변 필요' }) as string}</b>{' — '}
            {t('rules.how.reply', { defaultValue: '사람이 우리 주소로 보낸 문의·회신, 고객·멤버가 직접 쓴 메일' }) as string}</li>
          <li><b>{t('rules.how.reviewLabel', { defaultValue: '확인 권장' }) as string}</b>{' — '}
            {t('rules.how.review', { defaultValue: '답장할 상대는 없지만 봐야 하는 것. 자동발송이어도 결제·입금·증빙·보고서·서명·로그인 코드·발송 실패는 여기로 올립니다' }) as string}</li>
          <li><b>{t('rules.how.autoLabel', { defaultValue: '자동·마케팅' }) as string}</b>{' — '}
            {t('rules.how.auto', { defaultValue: '수신거부 링크가 달린 대량 발송, (광고) 표기, 주문·배송 알림' }) as string}</li>
          <li><b>{t('rules.how.spamLabel', { defaultValue: '스팸' }) as string}</b>{' — '}
            {t('rules.how.spam', { defaultValue: '스팸 판정을 받은 메일' }) as string}</li>
        </HowList>
        <HowNote>
          {t('rules.how.note', { defaultValue: '기계는 우리가 무엇을 운영하는지 모릅니다 — 에어비앤비 예약 알림, 우리 웹사이트 문의 알림, 같은 업계 소식처럼 "자동발송이지만 우리에겐 중요한 것" 은 아래에서 규칙으로 알려주세요. 규칙은 이미 받은 메일에도 바로 적용됩니다.' }) as string}
        </HowNote>
        <PresetRow>
          <PresetLabel>{t('rules.preset.label', { defaultValue: '예시로 시작' }) as string}</PresetLabel>
          {PRESETS.map((ps) => (
            <PresetBtn key={ps.key} type="button" disabled={busy} onClick={() => {
              setKind(ps.kind);
              setPattern(ps.patternKey ? (t(ps.patternKey) as string) : (ps.pattern || ''));
              setVerdict(ps.verdict);
              if (ps.matchField) setMatchField(ps.matchField);
            }}>
              {t(`rules.preset.${ps.key}`) as string}
            </PresetBtn>
          ))}
        </PresetRow>
      </HowBox>

      <KindTabs role="tablist">
        <KindTab role="tab" type="button" $on={kind === 'address'} onClick={() => setKind('address')}>
          {t('rules.kind.address', { defaultValue: '보낸 사람으로' }) as string}
        </KindTab>
        <KindTab role="tab" type="button" $on={kind === 'keyword'} onClick={() => setKind('keyword')}>
          {t('rules.kind.keyword', { defaultValue: '문구로' }) as string}
        </KindTab>
      </KindTabs>

      <AddRow>
        <PatternInput
          type="text"
          value={pattern}
          onChange={(e) => setPattern(e.target.value)}
          placeholder={(kind === 'keyword'
            ? t('rules.placeholderKeyword', { defaultValue: '예: 계약서, 세금계산서, 견적' })
            : t('rules.placeholder', { defaultValue: 'noreply@company.com 또는 company.com' })) as string}
          disabled={busy}
        />
        {kind === 'keyword' && (
          <SelectWrap>
            <PlanQSelect
              size="sm"
              isSearchable={false}
              value={{ value: matchField, label: fieldLabel(matchField) }}
              onChange={(opt) => setMatchField(((opt as PlanQSelectOption | null)?.value as MailSenderRule['match_field']) || 'subject')}
              options={(['subject', 'body', 'any'] as const).map((f) => ({ value: f, label: fieldLabel(f) }))}
            />
          </SelectWrap>
        )}
        <SelectWrap>
          <PlanQSelect
            size="sm"
            isSearchable={false}
            value={{ value: verdict, label: verdictLabel(verdict) }}
            onChange={(opt) => setVerdict(((opt as PlanQSelectOption | null)?.value as MailSenderRule['verdict']) || 'no_reply')}
            options={(['no_reply', 'always_reply', 'review', 'marketing', 'spam'] as const).map((v) => ({ value: v, label: verdictLabel(v) }))}
          />
        </SelectWrap>
        <ActionButton tone="secondary" size="sm" onClick={onPreview} loading={busy} disabled={!pattern.trim()}>
          {t('rules.preview', { defaultValue: '몇 건인지 보기' })}
        </ActionButton>
        <ActionButton tone="primary" size="sm" onClick={onAdd} loading={busy} disabled={!pattern.trim()}>
          {t('rules.add', { defaultValue: '규칙 추가' })}
        </ActionButton>
      </AddRow>
      {/* #344 — 중요 표시는 분류와 다른 축이다. 답변 필요이면서 중요할 수도 있다. */}
      <ImportantRow>
        <ImportantCheck
          type="checkbox" id="rule-important"
          checked={markImportant}
          onChange={(e) => setMarkImportant(e.target.checked)}
        />
        <ImportantLabel htmlFor="rule-important">
          {t('rules.markImportant', { defaultValue: '이 규칙에 걸리면 별표(중요) 표시' }) as string}
        </ImportantLabel>
      </ImportantRow>
      {/* 조건이 무엇을 잡는지 **저장 전에** 보여준다 — 수백 건이 옮겨진 뒤에 아는 것은 확인이 아니다. */}
      {preview && (
        <ResultBox>
          {preview.matched === 0
            ? t('rules.previewNone', { defaultValue: '지금 받은 메일 중 이 조건에 걸리는 것은 없습니다. 규칙은 앞으로 오는 메일에만 적용됩니다.' }) as string
            : t('rules.previewCount', {
                n: preview.matched, more: preview.capped ? '+' : '',
                defaultValue: '지금 받은 메일 {{n}}{{more}}건이 이 조건에 걸립니다',
              }) as string}
          {preview.samples.length > 0 && (
            <SampleList>
              {preview.samples.map((sm) => <li key={sm.id}>{sm.subject || t('rules.noSubject', { defaultValue: '(제목 없음)' }) as string}</li>)}
            </SampleList>
          )}
        </ResultBox>
      )}
      {applied && (
        <ResultBox $ok>
          {applied.changed > 0
            ? t('rules.appliedCount', {
                n: applied.changed, where: verdictLabel(applied.verdict),
                defaultValue: '이미 받은 메일 {{n}}건을 "{{where}}" 로 옮겼습니다',
              }) as string
            : t('rules.appliedNone', { defaultValue: '규칙을 저장했습니다. 앞으로 오는 메일부터 적용됩니다.' }) as string}
        </ResultBox>
      )}
      {err && <ErrText>{err}</ErrText>}

      {loading ? (
        <Muted>{t('common.loading', { defaultValue: '불러오는 중…' })}</Muted>
      ) : rules.length === 0 ? (
        <EmptyState
          title={t('rules.empty.title', { defaultValue: '아직 학습된 규칙이 없어요' }) as string}
          description={t('rules.empty.body', { defaultValue: '같은 발신자를 두 번 "답변 불필요" 하면 자동으로 규칙이 만들어집니다. 직접 추가할 수도 있습니다.' }) as string}
        />
      ) : (
        <List>
          {rules.map((r) => {
            const tone = VERDICT_TONE[r.verdict];
            return (
              <Row key={r.id}>
                <Main>
                  <PatternText>
                    {r.pattern_type === 'keyword'
                      ? `“${r.pattern}” · ${fieldLabel(r.match_field)}`
                      : r.pattern}
                    {r.mark_important && <ImportantTag>{t('rules.importantTag', { defaultValue: '중요' }) as string}</ImportantTag>}
                  </PatternText>
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
const Title = styled.h3`margin: 0 0 6px; font-size: 0.9375rem; font-weight: 700; color: #0F172A;`;
const Desc = styled.p`margin: 0; font-size: 0.8125rem; line-height: 1.6; color: #64748B;`;
const AddRow = styled.div`display: flex; align-items: center; gap: 8px; flex-wrap: wrap;`;
const PatternInput = styled.input`
  /* 넓은 화면에서 한 줄 입력이 1,150px 까지 늘어나던 것 — 다른 설정 입력과 같은 상한. */
  flex: 1; max-width: 420px; min-width: 220px; height: 36px; padding: 0 12px;
  border: 1px solid #E2E8F0; border-radius: 8px; font-size: 0.8125rem; color: #334155;
  &:focus { outline: none; border-color: #14B8A6; box-shadow: 0 0 0 3px rgba(20,184,166,.15); }
`;
const SelectWrap = styled.div`min-width: 150px;`;
const HowBox = styled.div`
  background: #F8FAFC; border: 1px solid #E2E8F0; border-radius: 10px;
  padding: 12px 14px; margin-bottom: 14px;
`;
const HowTitle = styled.div`font-size: 0.8125rem; font-weight: 700; color: #0F172A; margin-bottom: 6px;`;
const HowList = styled.ul`
  margin: 0 0 8px; padding-left: 16px;
  li { font-size: 0.78125rem; color: #475569; line-height: 1.6; }
  b { color: #0F172A; }
`;
const HowNote = styled.div`font-size: 0.78125rem; color: #64748B; line-height: 1.6;`;
const PresetRow = styled.div`display: flex; flex-wrap: wrap; align-items: center; gap: 6px; margin-top: 10px;`;
const PresetLabel = styled.span`font-size: 0.6875rem; font-weight: 700; color: #94A3B8;`;
const PresetBtn = styled.button`
  min-height: 36px; padding: 6px 12px; border: 1px solid #CBD5E1; border-radius: 999px;   /* 터치 타겟 토큰 36 */
  background: #FFFFFF; color: #334155; font-size: 0.75rem; cursor: pointer;
  &:hover:not(:disabled) { border-color: #14B8A6; color: #0F766E; }
  &:disabled { opacity: 0.5; cursor: default; }
`;
const ResultBox = styled.div<{ $ok?: boolean }>`
  margin: 8px 0 4px; padding: 10px 12px; border-radius: 8px;
  font-size: 0.78125rem; line-height: 1.6;
  background: ${(p) => (p.$ok ? '#F0FDFA' : '#EEF2FF')};
  border: 1px solid ${(p) => (p.$ok ? '#99F6E4' : '#C7D2FE')};
  color: ${(p) => (p.$ok ? '#0F766E' : '#3730A3')};
`;
const SampleList = styled.ul`
  margin: 6px 0 0; padding-left: 16px;
  li { font-size: 0.75rem; color: #475569; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
`;
const ErrText = styled.div`font-size: 0.75rem; font-weight: 600; color: #B45309;`;
const Muted = styled.div`font-size: 0.8125rem; color: #94A3B8;`;
const List = styled.ul`list-style: none; margin: 0; padding: 0; display: flex; flex-direction: column; gap: 8px;`;
const Row = styled.li`
  display: flex; align-items: center; justify-content: space-between; gap: 12px;
  padding: 12px 14px; background: #F8FAFC; border: 1px solid #E2E8F0; border-radius: 10px;
`;
const Main = styled.div`min-width: 0; display: flex; flex-direction: column; gap: 4px;`;
const PatternText = styled.div`font-size: 0.8125rem; font-weight: 600; color: #0F172A; word-break: break-all;`;
const Meta = styled.div`display: flex; align-items: center; gap: 6px; flex-wrap: wrap;`;
const Chip = styled.span<{ $bg: string; $fg: string }>`
  padding: 2px 8px; border-radius: 999px; font-size: 0.6875rem; font-weight: 700;
  background: ${(p) => p.$bg}; color: ${(p) => p.$fg};
`;
const Kind = styled.span`font-size: 0.6875rem; color: #94A3B8;`;
const Evidence = styled.div`font-size: 0.75rem; color: #64748B;`;

// #344 — 주소 규칙 / 문구 규칙 입력 전환
const KindTabs = styled.div` display: flex; gap: 4px; margin-bottom: 10px; `;
const KindTab = styled.button<{ $on: boolean }>`
  padding: 6px 12px; min-height: 32px;
  background: ${p => (p.$on ? '#0F172A' : '#fff')};
  color: ${p => (p.$on ? '#fff' : '#475569')};
  border: 1px solid ${p => (p.$on ? '#0F172A' : '#CBD5E1')};
  border-radius: 999px; cursor: pointer; font-size: 0.75rem; font-weight: 600;
  &:hover { border-color: #94A3B8; }
`;
const ImportantRow = styled.div` display: flex; align-items: center; gap: 6px; margin: 8px 0 4px; `;
const ImportantCheck = styled.input` width: 16px; height: 16px; accent-color: #F43F5E; cursor: pointer; `;
const ImportantLabel = styled.label` font-size: 0.75rem; color: #475569; cursor: pointer; `;
const ImportantTag = styled.span`
  margin-left: 6px; padding: 1px 6px; border-radius: 999px;
  background: #FFE4E6; color: #BE123C; font-size: 0.625rem; font-weight: 700;
`;
