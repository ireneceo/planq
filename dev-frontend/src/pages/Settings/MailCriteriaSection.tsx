// 메일 분류 기준 — 공개 목록 + 끄기 + 학습 안내 (2026-10-15, docs/MAIL_CRITERIA_DESIGN.md §3.5)
//
// Irene: *"상세 조건들을 모두 설정에 나오게 하고 우리끼리 가지고 있지 말고 투명하게 공개하자.
//   그리고 그에 대해 학습하며 업데이트 하는 걸 안내하고 싫으면 삭제하고 추가도 할 수 있게 하자."*
//   목록은 서버 카탈로그(services/mailCriteriaCatalog.js — 판정 엔진이 읽는 바로 그 목록)를 그린다.
//   글을 따로 쓰지 않는다 — 설명은 id → i18n 키(qmail:criteria.<id>.*), 찾는 말은 서버가 준 그대로.
//   끄기 전에 «이미 받은 메일 몇 건이 어디로 옮겨지는지» 를 세어 확인창으로 묻는다(0건이면 묻지 않는다).
import React, { useCallback, useEffect, useState } from 'react';
import styled from 'styled-components';
import { useTranslation } from 'react-i18next';
import CriteriaList, { type CriteriaGroup } from '../../components/Common/CriteriaList';
import ConfirmDialog from '../../components/Common/ConfirmDialog';
import {
  getMailCriteria, previewMailCriterion, setMailCriterion, untrustMailDomain,
  type MailCriteriaResponse, type MailCriterionImpact, type MailCriterionFolder,
} from '../../services/mail';

interface Props { businessId: number }

const FOLDERS: MailCriterionFolder[] = ['reply', 'review', 'demote', 'spam'];

const MailCriteriaSection: React.FC<Props> = ({ businessId }) => {
  const { t } = useTranslation('qmail');
  const [data, setData] = useState<MailCriteriaResponse | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [ask, setAsk] = useState<{ id: string; next: boolean; impact: MailCriterionImpact } | null>(null);
  const [done, setDone] = useState<{ id: string; next: boolean; moved: number } | null>(null);
  const [untrust, setUntrust] = useState<string | null>(null);

  const load = useCallback(async () => {
    try { setData(await getMailCriteria(businessId)); setErr(null); }
    catch { setErr(t('criteria.loadFailed', { defaultValue: '분류 기준을 불러오지 못했어요.' }) as string); }
  }, [businessId, t]);
  useEffect(() => { void load(); }, [load]);

  const title = (id: string) => t(`criteria.${id}.title`) as string;

  const commit = async (id: string, next: boolean) => {
    setBusyId(id);
    try {
      const r = await setMailCriterion(businessId, id, next);
      setDone({ id, next, moved: r.applied.moved });
      await load();
    } catch {
      setErr(t('criteria.saveFailed', { defaultValue: '저장하지 못했어요. 잠시 후 다시 시도해 주세요.' }) as string);
    } finally { setBusyId(null); }
  };

  const onToggle = async (id: string, next: boolean) => {
    if (busyId) return;
    setBusyId(id); setErr(null); setDone(null);
    try {
      const impact = await previewMailCriterion(businessId, id, next);
      setBusyId(null);
      if (impact.moved === 0) { await commit(id, next); return; }
      setAsk({ id, next, impact });
    } catch {
      setBusyId(null);
      setErr(t('criteria.previewFailed', { defaultValue: '몇 건이 옮겨지는지 세지 못했어요. 잠시 후 다시 시도해 주세요.' }) as string);
    }
  };

  if (!data) return err ? <Err>{err}</Err> : <Muted>{t('common.loading', { defaultValue: '불러오는 중…' }) as string}</Muted>;

  const folderLabel = (f: string) => t(`criteria.folder.${f}`) as string;
  const groups: CriteriaGroup[] = FOLDERS.map((f) => ({
    key: f,
    title: folderLabel(f),
    hint: t(`criteria.folderHint.${f}`) as string,
    items: data.items.filter((c) => c.folder === f).map((c) => ({
      id: c.id,
      title: title(c.id),
      desc: t(`criteria.${c.id}.desc`) as string,
      lockable: c.lockable, enabled: c.enabled,
      terms: c.terms, examples: c.examples, hits: c.hits_30d,
    })),
  }));

  const moveText = (impact: MailCriterionImpact) => Object.entries(impact.by)
    .map(([k, n]) => { const [a, b] = k.split('>'); return t('criteria.moveLine', { n, from: folderLabel(a), to: folderLabel(b), defaultValue: '{{from}} → {{to}} {{n}}건' }) as string; })
    .join(' · ');

  return (
    <Wrap data-testid="mail-criteria-section">
      <Learn data-testid="mail-criteria-learn">
        <LearnTitle>{t('criteria.learn.title', { defaultValue: 'PlanQ 는 여러분이 누르는 것을 보고 배웁니다' }) as string}</LearnTitle>
        <LearnBody>
          {t('criteria.learn.body', {
            n: data.learning.mark, d: data.learning.dismiss,
            defaultValue: '같은 보낸 사람을 {{d}}번 «답변 불필요» 하면 답장 안 해도 되는 곳으로, {{n}}번 «답변 필요로» 올리면 항상 답변 필요로, {{n}}번 «확인 권장으로» 올리면 확인 권장으로 배웁니다. 배운 규칙은 아래 «메일 분류 규칙» 목록에 전부 보이고 언제든 지울 수 있습니다 — 지우면 원래대로 돌아갑니다.',
          }) as string}
        </LearnBody>
      </Learn>
      {!data.can_edit && <Muted>{t('criteria.ownerOnly', { defaultValue: '기준을 끄고 켜는 것은 워크스페이스 대표·관리자만 할 수 있어요. 학습 규칙 추가·삭제는 아래에서 누구나 할 수 있어요.' }) as string}</Muted>}
      <CriteriaList groups={groups} canEdit={data.can_edit} busyId={busyId} onToggle={onToggle} testIdPrefix="mail-criteria" />
      {done && (
        <Result data-testid="mail-criteria-result">
          {done.moved > 0
            ? t('criteria.doneMoved', { name: title(done.id), n: done.moved, state: t(done.next ? 'criteria.stateOn' : 'criteria.stateOff') as string, defaultValue: '«{{name}}» 을(를) {{state}} 이미 받은 메일 {{n}}건을 옮겼습니다.' }) as string
            : t('criteria.doneNone', { name: title(done.id), state: t(done.next ? 'criteria.stateOn' : 'criteria.stateOff') as string, defaultValue: '«{{name}}» 을(를) {{state}} 옮겨진 메일은 없고, 앞으로 오는 메일부터 적용됩니다.' }) as string}
        </Result>
      )}
      {err && <Err>{err}</Err>}
      {/* 사칭 검사의 «안전한 도메인»(관계사) — 등록은 메일 상세 «사칭 의심» 안내 줄에서(docs/MAIL_IMPERSONATION_DESIGN.md §10) */}
      <Trusted data-testid="mail-trusted-domains">
        <LearnTitle>{t('impersonation.trust.listTitle') as string}</LearnTitle>
        <Muted>{t('impersonation.trust.listHint') as string}</Muted>
        {(data.trusted_domains || []).length === 0
          ? <Muted>{t('impersonation.trust.listEmpty') as string}</Muted>
          : (
            <TrustedList>
              {(data.trusted_domains || []).map((d) => (
                <li key={d}>
                  <span>{d}</span>
                  {data.can_edit && (
                    <RemoveBtn type="button" data-testid="mail-trusted-remove" aria-label={t('impersonation.trust.remove', { domain: d }) as string}
                      onClick={() => setUntrust(d)}>×</RemoveBtn>
                  )}
                </li>
              ))}
            </TrustedList>
          )}
      </Trusted>
      <ConfirmDialog
        isOpen={!!untrust}
        title={t('impersonation.trust.removeTitle') as string}
        message={(untrust ? t('impersonation.trust.removeMessage', { domain: untrust }) : '') as string}
        confirmText={t('impersonation.trust.removeConfirm') as string}
        cancelText={t('compose.cancel', { defaultValue: '취소' }) as string}
        onClose={() => setUntrust(null)}
        onConfirm={() => {
          const d = untrust; setUntrust(null);
          if (d) void untrustMailDomain(businessId, d).then(load).catch(() => setErr(t('criteria.saveFailed', { defaultValue: '저장하지 못했어요. 잠시 후 다시 시도해 주세요.' }) as string));
        }}
      />
      <ConfirmDialog
        isOpen={!!ask}
        title={(ask ? t(ask.next ? 'criteria.confirmOnTitle' : 'criteria.confirmOffTitle', { name: title(ask.id) }) : '') as string}
        message={(ask ? t('criteria.confirmBody', {
          n: ask.impact.moved, more: ask.impact.capped ? '+' : '', moves: moveText(ask.impact),
          defaultValue: '이미 받은 메일 {{n}}{{more}}건이 옮겨집니다 ({{moves}}). 언제든 다시 켜고 끌 수 있고, 메일 자체는 지워지지 않습니다.',
        }) : '') as string}
        confirmText={(ask ? t(ask.next ? 'criteria.confirmOn' : 'criteria.confirmOff') : '') as string}
        cancelText={t('compose.cancel', { defaultValue: '취소' }) as string}
        onClose={() => setAsk(null)}
        onConfirm={() => { const a = ask; setAsk(null); if (a) void commit(a.id, a.next); }}
      />
    </Wrap>
  );
};

export default MailCriteriaSection;

const Wrap = styled.div`display: flex; flex-direction: column; gap: 12px;`;
const Learn = styled.div`background: #F0FDFA; border: 1px solid #99F6E4; border-radius: 10px; padding: 10px 12px;`;
const LearnTitle = styled.div`font-size: 0.8125rem; font-weight: 700; color: #0F766E; margin-bottom: 4px;`;
const LearnBody = styled.div`font-size: 0.75rem; color: #115E59; line-height: 1.6;`;
const Result = styled.div`
  padding: 8px 12px; border-radius: 8px; font-size: 0.75rem; line-height: 1.6;
  background: #F0FDFA; border: 1px solid #99F6E4; color: #0F766E;
`;
const Err = styled.div`font-size: 0.75rem; font-weight: 600; color: #B45309;`;
const Trusted = styled.div`
  display: flex; flex-direction: column; gap: 6px; padding: 10px 12px;
  border: 1px solid #E2E8F0; border-radius: 10px; background: #FFFFFF;
  ${LearnTitle} { color: #0F172A; margin-bottom: 0; }
`;
const TrustedList = styled.ul`
  list-style: none; margin: 0; padding: 0; display: flex; flex-wrap: wrap; gap: 6px;
  li { display: inline-flex; align-items: center; gap: 4px; padding: 2px 4px 2px 10px; min-height: 32px;
    border-radius: 999px; background: #F1F5F9; font-size: 0.8125rem; color: #0F172A; max-width: 100%; }
  li span { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
`;
const RemoveBtn = styled.button`
  width: 32px; height: 32px; border: 0; border-radius: 999px; background: transparent; color: #64748B;
  font-size: 1rem; line-height: 1; cursor: pointer;
  &:hover { background: #E2E8F0; color: #0F172A; }
`;
const Muted = styled.div`font-size: 0.75rem; color: #94A3B8; line-height: 1.5;`;
