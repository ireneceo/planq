// 파일 공개 범위를 좁힐 때 «연결된 곳» 을 먼저 보여 주고 묻는다 (2026-11-25 · docs/FILE_USAGE_DESIGN.md §9)
//   좁아질 때만(등급 내려감 · L2 프로젝트 바뀜). 넓히기·연결 0이면 묻지 않고 바로 바꾼다.
import { useCallback, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Modal, ModalButton } from '../UI/Modal';
import { fetchUsageSummary, isNarrowing, type UsageSummary } from './fileUsageApi';
import UsageWarning from './UsageWarning';

type Level = { level?: string | null; projectId?: number | null };

export function useNarrowConfirm(businessId: number | null | undefined) {
  const { t } = useTranslation('qfile');
  const { t: tc } = useTranslation('common');
  const [summary, setSummary] = useState<UsageSummary | null>(null);
  const runRef = useRef<null | (() => void | Promise<void>)>(null);

  /** 바꾸기 전에 부른다 — 물을 필요가 없으면 run 을 바로 부른다. */
  const guard = useCallback(async (fileId: number | null, prev: Level, next: Level, run: () => void | Promise<void>) => {
    if (!businessId || !fileId || !isNarrowing(prev, next)) { await run(); return; }
    const s = await fetchUsageSummary(businessId, { file_ids: [fileId] }).catch(() => null);
    if (!s || s.live_places === 0) { await run(); return; }
    runRef.current = run;
    setSummary(s);
  }, [businessId]);

  const close = () => { runRef.current = null; setSummary(null); };
  const proceed = async () => { const r = runRef.current; close(); if (r) await r(); };

  const dialog = (
    <Modal isOpen={!!summary} onClose={close} title={t('usage.narrowTitle', { defaultValue: '공개 범위를 좁힐까요?' }) as string}
      footer={<>
        <ModalButton variant="secondary" onClick={close}>{tc('button.cancel', { defaultValue: '취소' })}</ModalButton>
        <ModalButton variant="primary" data-testid="usage-narrow-confirm" onClick={() => { void proceed(); }}>{t('usage.narrowConfirm', { defaultValue: '좁히기' })}</ModalButton>
      </>}>
      <UsageWarning summary={summary} mode="narrow" />
    </Modal>
  );
  return { guard, dialog };
}
