import { useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import OverflowMenu, { type OverflowItem } from '../../components/Common/OverflowMenu';
import { downloadFromApi } from '../../utils/download';
import { bulkDownloadZip } from '../../services/files';

// 메일 상세 머리줄의 첨부 메뉴 — Irene 2026-10-23: *"맨 아래에 있는 파일 첨부 위치로 가는게 힘들어."*
//   긴 스레드에서 첨부는 각 메시지 본문 맨 아래(MessageAttachments)에만 있다. 여기서는 스레드 전체 첨부를
//   한 목록으로 모아 «전체 다운로드» + 하나씩 내려받기를 준다. 미리보기·워크스페이스에 저장은 본문 아래 칩 그대로.
//   ★ 밴드1 오른쪽 «⋯ 하나만» 표준의 예외 — Irene 직접 지시(«우측 상단 아이콘들 앞에»).
//   받는 경로는 칩·DownloadAllButton 과 같다(하나 = /files/:biz/:id/download · 전체 = 묶음 zip) — 실패는 우측 하단 트레이가 말한다.

type Att = { id: number; file_id: number | null; file_name: string; file_size: number };
type Msg = { attachments?: Att[] };

const kb = (n: number) => (n ? ` (${Math.round(n / 1024)} KB)` : '');
// 메뉴 항목은 한 줄(nowrap)이라 긴 파일명이 폰 폭을 넘는다 — 확장자는 남기고 가운데를 줄인다.
const shortName = (name: string) => {
  if (name.length <= 40) return name;
  const dot = name.lastIndexOf('.');
  const ext = dot > 0 && name.length - dot <= 8 ? name.slice(dot) : '';
  return `${name.slice(0, 34 - ext.length)}…${ext}`;
};

const ClipIcon = () => (
  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    <path d="M21.44 11.05l-9.19 9.19a6 6 0 0 1-8.49-8.49l9.19-9.19a4 4 0 0 1 5.66 5.66l-9.2 9.19a2 2 0 0 1-2.83-2.83l8.49-8.48" />
  </svg>
);
const DownIcon = () => (
  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" /><polyline points="7 10 12 15 17 10" /><line x1="12" y1="15" x2="12" y2="3" />
  </svg>
);

export default function MailAttachmentsMenu({ businessId, messages }: { businessId: number; messages: Msg[] }) {
  const { t } = useTranslation('qmail');
  // 화면 순서(최신 메시지가 위)대로 모으고, 같은 파일이 답장마다 다시 붙어 온 것은 한 번만.
  const files = useMemo(() => {
    const seen = new Set<number>();
    const out: Att[] = [];
    for (const m of messages) {
      for (const a of m.attachments || []) {
        if (!a.file_id || seen.has(a.file_id)) continue;
        seen.add(a.file_id);
        out.push(a);
      }
    }
    return out;
  }, [messages]);

  if (!files.length) return null;

  const fallback = t('attachment.fallback', { defaultValue: '첨부파일' }) as string;
  const items: OverflowItem[] = [];
  if (files.length > 1) {
    items.push({
      key: 'all',
      label: t('common:attachList.downloadAll', { n: files.length, defaultValue: '전체 다운로드 ({{n}})' }) as string,
      icon: <DownIcon />,
      testId: 'mail-detail-attachments-all',
      onClick: () => { void bulkDownloadZip(businessId, files.map(f => `direct-${f.file_id}`)).catch(() => null); },
    });
  }
  files.forEach((f, i) => {
    items.push({
      key: `f-${f.file_id}`,
      label: `${shortName(f.file_name || fallback)}${kb(f.file_size)}`,
      icon: <DownIcon />,
      dividerBefore: i === 0 && files.length > 1,
      testId: 'mail-detail-attachment-item',
      onClick: () => { void downloadFromApi(`/api/files/${businessId}/${f.file_id}/download`, f.file_name || 'attachment').catch(() => null); },
    });
  });

  return (
    <OverflowMenu
      label={t('attachment.menu', { n: files.length, defaultValue: '첨부 {{n}}개' }) as string}
      triggerIcon={<ClipIcon />}
      data-testid="mail-detail-attachments"
      items={items}
    />
  );
}
