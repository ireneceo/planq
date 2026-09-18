// 노트 → Q sale 상담 기록으로 저장.
//
// Irene 2026-09-18: *"종료하고 상담 저장] 버튼을 추가하자. 그리고 상담에 저장되게 연결해줘. …
//   연결되서 상담리스트 들어가게."*
//
// ★ 상담은 **고객에 달리는 기록**이다(업무처럼 따로 서는 것이 아니다 — 2026-09-18 결정).
//   그래서 저장 대상은 언제나 «어느 고객» 이고, 저장되는 자리는 `client_interactions` —
//   전화·미팅·방문 기록이 이미 쌓이는 **같은 원장**이다. 새 테이블을 만들지 않는다.
// ★ 출처(`source_kind='qnote'`)는 화면이 고르지 않는다 — 서버가 노트 소유를 확인한 뒤 박는다
//   (dev-backend/services/qnoteOwnership.js). 화면은 노트 번호만 보낸다.
// ★ 고객을 고르면 **노트 자체도 그 고객에 연결**한다. 그래야 고객 프로필의 노트 목록에도 잡힌다
//   (services/qnoteByEntity.js 가 읽는 축이 session.client_id 다). 기록만 남기고 노트를 안 걸면
//   같은 사실이 한쪽에만 있게 된다.
import { useEffect, useMemo, useState } from 'react';
// 연결 입력 문구는 한 곳에서 온다 (화면마다 적으면 갈라진다)
import { CONNECT_PROMPT } from '../../components/Common/connectPrompts';
import styled from 'styled-components';
import { useTranslation } from 'react-i18next';
import StandardModal from '../../components/Common/StandardModal';
import ActionButton from '../../components/Common/ActionButton';
import PlanQSelect, { type PlanQSelectOption } from '../../components/Common/PlanQSelect';
import { apiFetch } from '../../contexts/AuthContext';
import { createInteraction, type InteractionKind } from '../../services/sale';
import { linkSessionEntities, type QNoteSession } from '../../services/qnote';
import { tabStore } from '../../stores/tabStore';
// 고객 이름의 정본은 `displayName()` 하나다 — `clients` 응답에 `name` 은 **없다**(null).
//   손으로 `c.name` 을 읽으면 라벨이 통째로 빈다(2026-09-18 Fable 실측: 옵션 17개 라벨 전부 공백).
import { displayName, type NameLocalizable } from '../../utils/displayName';
import { useDraftKey, useDraftText } from '../../hooks/useDraftText';

interface Props {
  open: boolean;
  onClose: () => void;
  session: QNoteSession;
  businessId: number;
  /** 저장 후 부모가 세션 상태를 갱신할 수 있게 (고객 연결이 바뀐다) */
  onSessionChange?: (s: QNoteSession) => void;
}

const KINDS: InteractionKind[] = ['meeting', 'call', 'visit', 'memo', 'other'];

export default function SaveToSaleModal({ open, onClose, session, businessId, onSessionChange }: Props) {
  const { t, i18n } = useTranslation('qnote');
  const { t: tc } = useTranslation('common');   // 연결 문구 정본
  const [clients, setClients] = useState<Array<{ id: number; name: string }>>([]);
  const [clientId, setClientId] = useState<number | null>(session.client_id ?? null);
  const [kind, setKind] = useState<InteractionKind>('meeting');
  // 요약이 있으면 메모의 출발점으로 쓴다 — 사람이 같은 것을 다시 쓰게 하지 않는다.
  //   전문이 길면 앞부분만(원문은 노트에 그대로 있고, 상담 기록은 «무슨 접점이었나» 의 요약이다).
  const summaryBase = useMemo(() => {
    const pts = (session.summary_key_points || []).filter(Boolean);
    return session.summary_full
      ? String(session.summary_full).trim().slice(0, 1500)
      : (pts.length ? pts.map((x) => `· ${x}`).join('\n') : '');
  }, [session.summary_full, session.summary_key_points]);
  // 메모는 **쓰다 만 글이 남는다** — 창을 닫아도 다음에 열면 이어서 쓴다(CLAUDE.md 입력 초안).
  //   mode 'edit' 이라 base(요약)가 그 사이 다시 만들어져 바뀌면 옛 초안을 버린다(D-C1d).
  const memoDraft = useDraftText(useDraftKey('qnote-sale-memo', session.id, businessId), { base: summaryBase });
  const memo = memoDraft.text;
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [savedId, setSavedId] = useState<number | null>(null);

  useEffect(() => {
    if (!open) return;
    setClientId(session.client_id ?? null);
    setErr(null); setSavedId(null);
    // 초안이 비어 있을 때만 요약을 넣는다 — 쓰던 글을 요약으로 덮지 않는다
    if (!memoDraft.text.trim() && summaryBase) memoDraft.setText(summaryBase);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, session.client_id, summaryBase]);

  useEffect(() => {
    if (!open || !businessId) return undefined;
    let alive = true;
    // 고객 목록은 **경로 파라미터**다 — 쿼리로 부르면 404 HTML 이라 목록이 조용히 빈다
    apiFetch(`/api/clients/${businessId}?limit=200`)
      .then((r) => r.json())
      .then((j) => {
        if (!alive || !j?.success) return;
        setClients((j.data || []).map((c: NameLocalizable & { id: number }) => ({
          id: c.id, name: displayName(c, i18n.language),
        })));
      })
      .catch(() => { /* 비면 아래 안내가 그 사실을 말한다 */ });
    return () => { alive = false; };
  }, [open, businessId, i18n.language]);

  const clientOpts: PlanQSelectOption[] = useMemo(
    () => clients.map((c) => ({ value: c.id, label: c.name })), [clients],
  );
  const curClient = clientOpts.find((o) => Number(o.value) === clientId) || null;

  const save = async () => {
    if (!clientId || busy) return;
    setBusy(true); setErr(null);
    try {
      // ① 노트를 그 고객에 연결 — 이미 같은 고객이면 건너뛴다(같은 값을 다시 쓰지 않는다)
      if (session.client_id !== clientId) {
        try {
          const updated = await linkSessionEntities(session.id, { client_id: clientId });
          onSessionChange?.(updated);
        } catch {
          // 연결 실패(작성자가 아님 등)는 기록 저장을 막지 않는다 — 기록이 더 중요하다
        }
      }
      // ② 상담 원장에 1건
      const res = await createInteraction(businessId, clientId, {
        kind,
        occurred_at: session.created_at,
        title: session.title || null,
        body: memo.trim() || null,
        qnote_session_id: session.id,
      });
      memoDraft.clear();   // 비우는 곳은 **제출 성공**뿐이다
      setSavedId(res.id);
    } catch (e) {
      const msg = (e as Error).message || '';
      setErr(
        msg.includes('qnote_session_not_found') ? (t('saveToSale.errNotMine', { defaultValue: '이 노트를 저장할 권한이 없습니다' }) as string)
        : msg.includes('qnote_unavailable') ? (t('saveToSale.errUnavailable', { defaultValue: '노트 서비스에 연결할 수 없어 저장하지 못했습니다' }) as string)
        : msg.includes('content_required') ? (t('saveToSale.errEmpty', { defaultValue: '제목이나 내용이 필요합니다' }) as string)
        : (t('saveToSale.errFailed', { defaultValue: '저장에 실패했습니다' }) as string),
      );
    } finally { setBusy(false); }
  };

  if (!open) return null;

  return (
    <StandardModal
      open={open}
      onClose={onClose}
      title={t('saveToSale.title', { defaultValue: '상담으로 저장' }) as string}
      size="sm"
      footer={savedId ? (
        <>
          <ActionButton tone="secondary" size="md" onClick={onClose}>
            {t('saveToSale.close', { defaultValue: '닫기' }) as string}
          </ActionButton>
          <ActionButton
            tone="primary" size="md" data-testid="qnote-save-sale-open"
            onClick={() => { tabStore.openInNewTab(`/sale/${clientId}`); onClose(); }}
          >
            {t('saveToSale.openClient', { defaultValue: '상담 열기' }) as string}
          </ActionButton>
        </>
      ) : (
        <>
          <ActionButton tone="secondary" size="md" onClick={onClose} disabled={busy}>
            {t('saveToSale.cancel', { defaultValue: '취소' }) as string}
          </ActionButton>
          <ActionButton
            tone="primary" size="md" loading={busy} disabled={!clientId || busy}
            data-testid="qnote-save-sale-submit" onClick={save}
          >
            {t('saveToSale.submit', { defaultValue: '상담으로 저장' }) as string}
          </ActionButton>
        </>
      )}
    >
      {savedId ? (
        <Done data-testid="qnote-save-sale-done">
          {t('saveToSale.done', { defaultValue: '이 노트를 상담 기록으로 저장했습니다. 고객 상담 목록에서 볼 수 있습니다.' }) as string}
        </Done>
      ) : (
        <>
          <Label htmlFor="pq-save-sale-client">{t('saveToSale.client', { defaultValue: '어느 고객의 상담인가요' }) as string}</Label>
          <PlanQSelect
            inputId="pq-save-sale-client"
            size="md"
            options={clientOpts}
            value={curClient}
            onChange={(o) => setClientId(o ? Number((o as PlanQSelectOption).value) : null)}
            placeholder={clients.length === 0
              ? (t('saveToSale.clientEmpty', { defaultValue: '등록된 고객이 없습니다' }) as string)
              : (tc(CONNECT_PROMPT.clientPick) as string)}
            isSearchable
            isDisabled={busy}
          />
          <Label as="div">{t('saveToSale.kind', { defaultValue: '접점 종류' }) as string}</Label>
          <KindRow role="group">
            {KINDS.map((k) => (
              <KindBtn key={k} type="button" $on={kind === k} disabled={busy} onClick={() => setKind(k)}>
                {t(`saveToSale.kind_${k}`, {
                  defaultValue: ({ meeting: '미팅', call: '통화', visit: '방문', memo: '메모', other: '기타' } as Record<string, string>)[k],
                }) as string}
              </KindBtn>
            ))}
          </KindRow>
          <Label htmlFor="pq-save-sale-memo">{t('saveToSale.memo', { defaultValue: '메모 (선택)' }) as string}</Label>
          <Memo
            id="pq-save-sale-memo"
            {...memoDraft.bind}
            disabled={busy}
            rows={3}
            placeholder={t('saveToSale.memoPh', { defaultValue: '상담에서 결정된 것 · 다음 할 일' }) as string}
          />
          <Hint>{t('saveToSale.hint', { defaultValue: '노트 전문은 그대로 Q note 에 남고, 상담 기록에서 이 노트로 이어집니다.' }) as string}</Hint>
          {err && <ErrText role="alert">{err}</ErrText>}
        </>
      )}
    </StandardModal>
  );
}

const Label = styled.label`
  display: block; font-size: 0.75rem; font-weight: 700; color: #475569;
  margin: 14px 0 6px;
  &:first-child { margin-top: 0; }
`;
const KindRow = styled.div`display: flex; flex-wrap: wrap; gap: 6px;`;
const KindBtn = styled.button<{ $on: boolean }>`
  min-height: 36px; padding: 0 12px; border-radius: 8px; cursor: pointer;
  font-size: 0.8125rem; font-weight: 600;
  border: 1px solid ${(p) => (p.$on ? '#0D9488' : '#E2E8F0')};
  background: ${(p) => (p.$on ? '#F0FDFA' : '#FFFFFF')};
  color: ${(p) => (p.$on ? '#0F766E' : '#475569')};
  &:disabled { opacity: 0.6; cursor: default; }
`;
const Memo = styled.textarea`
  width: 100%; border: 1px solid #E2E8F0; border-radius: 8px; padding: 10px 12px;
  font-size: 0.875rem; color: #0F172A; resize: vertical; font-family: inherit;
  &:focus { outline: none; border-color: #0D9488; }
`;
const Hint = styled.div`font-size: 0.75rem; color: #94A3B8; margin-top: 8px;`;
const ErrText = styled.div`font-size: 0.75rem; color: #B91C1C; margin-top: 8px;`;
const Done = styled.div`font-size: 0.875rem; color: #0F172A; line-height: 1.6;`;
