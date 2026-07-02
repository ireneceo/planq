// KNOWLEDGE_LOOP 축1 — Cue 워크스페이스 지식 카드 관리 (설정 > Cue 탭)
//   자동 채굴 제안(pending) 수락/거절 + 직접 추가/삭제. active 카드만 Cue 답변에 주입된다.
import React, { useCallback, useEffect, useState } from 'react';
import styled from 'styled-components';
import { useTranslation } from 'react-i18next';
import { apiFetch } from '../../contexts/AuthContext';
import PlanQSelect, { type PlanQSelectOption } from '../../components/Common/PlanQSelect';
import ActionButton from '../../components/Common/ActionButton';

interface KnowledgeCard {
  id: number;
  kind: 'work_pattern' | 'client_trait' | 'terminology' | 'decision' | 'custom';
  title: string;
  body: string;
  source: 'auto_mined' | 'user';
  status: 'pending' | 'active' | 'rejected';
}

const KINDS: KnowledgeCard['kind'][] = ['work_pattern', 'client_trait', 'terminology', 'decision', 'custom'];

const CueKnowledgeSection: React.FC<{ businessId: number; isAdmin: boolean }> = ({ businessId, isAdmin }) => {
  const { t } = useTranslation('settings');
  const [cards, setCards] = useState<KnowledgeCard[]>([]);
  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);
  const [addOpen, setAddOpen] = useState(false);
  const [form, setForm] = useState<{ kind: KnowledgeCard['kind']; title: string; body: string }>({ kind: 'custom', title: '', body: '' });

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const j = await apiFetch(`/api/businesses/${businessId}/cue-knowledge`).then((r) => r.json());
      if (j.success) setCards((j.data || []).filter((c: KnowledgeCard) => c.status !== 'rejected'));
    } finally { setLoading(false); }
  }, [businessId]);

  useEffect(() => { load(); }, [load]);

  const decide = useCallback(async (id: number, status: 'active' | 'rejected') => {
    if (!isAdmin || submitting) return;
    setSubmitting(true);
    try {
      const r = await apiFetch(`/api/businesses/${businessId}/cue-knowledge/${id}`, {
        method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ status }),
      });
      if (r.ok) await load();
    } finally { setSubmitting(false); }
  }, [businessId, isAdmin, submitting, load]);

  const remove = useCallback(async (id: number) => {
    if (!isAdmin || submitting) return;
    setSubmitting(true);
    try {
      const r = await apiFetch(`/api/businesses/${businessId}/cue-knowledge/${id}`, { method: 'DELETE' });
      if (r.ok) await load();
    } finally { setSubmitting(false); }
  }, [businessId, isAdmin, submitting, load]);

  const add = useCallback(async () => {
    if (!isAdmin || submitting) return;
    if (!form.title.trim() || !form.body.trim()) {
      setFormError(t('cueKnowledge.addRequired', '제목과 내용을 입력해 주세요') as string);
      return;
    }
    setSubmitting(true);
    setFormError(null);
    try {
      const r = await apiFetch(`/api/businesses/${businessId}/cue-knowledge`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(form),
      });
      const j = await r.json();
      if (!r.ok || !j.success) { setFormError(j.message || 'failed'); return; }
      setForm({ kind: 'custom', title: '', body: '' });
      setAddOpen(false);
      await load();
    } finally { setSubmitting(false); }
  }, [businessId, isAdmin, submitting, form, load, t]);

  const pending = cards.filter((c) => c.status === 'pending');
  const active = cards.filter((c) => c.status === 'active');
  const kindLabel = (k: KnowledgeCard['kind']) => t(`cueKnowledge.kind.${k}`, k) as string;

  return (
    <Wrap>
      <Head>
        <div>
          <Title>{t('cueKnowledge.title', '워크스페이스 지식')}</Title>
          <Desc>{t('cueKnowledge.desc', 'Cue 가 답변할 때 우선 반영하는, 이 워크스페이스에서 확정된 사실입니다. 자동 제안은 수락해야 반영됩니다.')}</Desc>
        </div>
        {isAdmin && (
          <ActionButton size="sm" tone="secondary" onClick={() => setAddOpen((v) => !v)}>
            {t('cueKnowledge.add', '지식 추가')}
          </ActionButton>
        )}
      </Head>

      {addOpen && isAdmin && (
        <AddForm>
          <PlanQSelect
            size="sm" isSearchable={false}
            value={{ value: form.kind, label: kindLabel(form.kind) }}
            onChange={(opt) => setForm((f) => ({ ...f, kind: ((opt as PlanQSelectOption | null)?.value as KnowledgeCard['kind']) || 'custom' }))}
            options={KINDS.map((k) => ({ value: k, label: kindLabel(k) }))}
          />
          <AddInput
            value={form.title}
            onChange={(e) => setForm((f) => ({ ...f, title: e.target.value }))}
            placeholder={t('cueKnowledge.titlePh', '예: 로고 시안 작업 기준') as string}
          />
          <AddTextarea
            value={form.body}
            onChange={(e) => setForm((f) => ({ ...f, body: e.target.value }))}
            placeholder={t('cueKnowledge.bodyPh', '예: 로고 시안은 항상 3안 제시, 1차 시안까지 평균 3일 소요') as string}
            rows={3}
          />
          {formError && <ErrMsg>{formError}</ErrMsg>}
          <AddActions>
            <ActionButton size="sm" tone="primary" disabled={submitting} onClick={add}>
              {t('cueKnowledge.addConfirm', '추가')}
            </ActionButton>
          </AddActions>
        </AddForm>
      )}

      {loading ? (
        <Empty>{t('cueKnowledge.loading', '불러오는 중…')}</Empty>
      ) : (
        <>
          {pending.length > 0 && (
            <>
              <GroupLabel $tone="pending">{t('cueKnowledge.pendingGroup', '자동 제안 — 검토 필요')} ({pending.length})</GroupLabel>
              {pending.map((c) => (
                <CardRow key={c.id} $pending>
                  <CardBody>
                    <CardTop><KindBadge>{kindLabel(c.kind)}</KindBadge><CardTitle>{c.title}</CardTitle></CardTop>
                    <CardText>{c.body}</CardText>
                  </CardBody>
                  {isAdmin && (
                    <CardActions>
                      <ActionButton size="sm" tone="primary" disabled={submitting} onClick={() => decide(c.id, 'active')}>
                        {t('cueKnowledge.accept', '수락')}
                      </ActionButton>
                      <ActionButton size="sm" tone="secondary" disabled={submitting} onClick={() => decide(c.id, 'rejected')}>
                        {t('cueKnowledge.reject', '거절')}
                      </ActionButton>
                    </CardActions>
                  )}
                </CardRow>
              ))}
            </>
          )}

          <GroupLabel>{t('cueKnowledge.activeGroup', '반영 중')} ({active.length})</GroupLabel>
          {active.length === 0 ? (
            <Empty>{t('cueKnowledge.empty', '아직 등록된 지식이 없습니다. 완료 업무가 쌓이면 자동 제안이 생성됩니다.')}</Empty>
          ) : active.map((c) => (
            <CardRow key={c.id}>
              <CardBody>
                <CardTop>
                  <KindBadge>{kindLabel(c.kind)}</KindBadge>
                  <CardTitle>{c.title}</CardTitle>
                  {c.source === 'auto_mined' && <AutoBadge>{t('cueKnowledge.autoBadge', '자동 제안됨')}</AutoBadge>}
                </CardTop>
                <CardText>{c.body}</CardText>
              </CardBody>
              {isAdmin && (
                <CardActions>
                  <ActionButton size="sm" tone="danger" disabled={submitting} onClick={() => remove(c.id)}>
                    {t('cueKnowledge.remove', '삭제')}
                  </ActionButton>
                </CardActions>
              )}
            </CardRow>
          ))}
        </>
      )}
    </Wrap>
  );
};

const Wrap = styled.div`margin-top: 8px;`;
const Head = styled.div`display: flex; align-items: flex-start; justify-content: space-between; gap: 12px; margin-bottom: 12px;`;
const Title = styled.div`font-size: 14px; font-weight: 600; color: #0f172a;`;
const Desc = styled.div`font-size: 12px; color: #64748b; margin-top: 2px; line-height: 1.5;`;
const GroupLabel = styled.div<{ $tone?: 'pending' }>`
  font-size: 12px; font-weight: 700; margin: 14px 0 8px;
  color: ${(p) => (p.$tone === 'pending' ? '#B45309' : '#64748B')};
`;
const CardRow = styled.div<{ $pending?: boolean }>`
  display: flex; align-items: flex-start; justify-content: space-between; gap: 12px;
  padding: 10px 12px; border-radius: 8px; margin-bottom: 8px;
  background: ${(p) => (p.$pending ? '#FFFBEB' : '#F8FAFC')};
  border: 1px solid ${(p) => (p.$pending ? '#FDE68A' : '#E2E8F0')};
`;
const CardBody = styled.div`min-width: 0; flex: 1;`;
const CardTop = styled.div`display: flex; align-items: center; gap: 6px; flex-wrap: wrap;`;
const CardTitle = styled.span`font-size: 13px; font-weight: 600; color: #0f172a;`;
const KindBadge = styled.span`
  font-size: 10px; font-weight: 700; padding: 2px 8px; border-radius: 999px;
  background: #F0FDFA; color: #0F766E; border: 1px solid #99F6E4;
`;
const AutoBadge = styled.span`font-size: 10px; color: #94A3B8;`;
const CardText = styled.div`font-size: 12px; color: #475569; margin-top: 4px; line-height: 1.5; white-space: pre-wrap;`;
const CardActions = styled.div`display: flex; gap: 6px; flex-shrink: 0;`;
const AddForm = styled.div`
  display: flex; flex-direction: column; gap: 8px; padding: 12px;
  background: #F8FAFC; border: 1px solid #E2E8F0; border-radius: 8px; margin-bottom: 12px;
`;
const AddInput = styled.input`
  height: 36px; padding: 0 10px; border: 1px solid #E2E8F0; border-radius: 8px; font-size: 13px;
  &:focus { outline: none; border-color: #14B8A6; }
`;
const AddTextarea = styled.textarea`
  padding: 8px 10px; border: 1px solid #E2E8F0; border-radius: 8px; font-size: 13px; resize: vertical; font-family: inherit;
  &:focus { outline: none; border-color: #14B8A6; }
`;
const AddActions = styled.div`display: flex; justify-content: flex-end;`;
const ErrMsg = styled.div`font-size: 12px; color: #B91C1C;`;
const Empty = styled.div`font-size: 12px; color: #94A3B8; padding: 10px 0;`;

export default CueKnowledgeSection;
