// 고객 프로젝트 링크 — **PDF 보기** (docs/GUEST_PROJECT_VIEW_DECISIONS.md §I-3)
//
// 서버가 한 쪽씩 그린 그림(`/api/guest/:token/files/:id/preview?page=N&w=1024`)을 넘겨 본다.
//   원본 PDF 는 이 화면으로 오지 않는다 — 받기는 따로(L4 공유 파일만, 아니면 로그인 시트).
// ★ 앱의 AttachmentPreviewDrawer 를 쓰지 않는 이유: 그것은 apiFetch + blob 으로 **인증 헤더**를 실어
//   원본을 받아 그린다. 무인증 게스트는 그 길을 못 쓰고, 써서도 안 된다(원본 반출).
// 껍데기는 공용 StandardModal(포털·Esc 스택·배경 잠금·aria-modal) 그대로.
import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import styled from 'styled-components';
import StandardModal from '../../components/Common/StandardModal';
import ActionButton from '../../components/Common/ActionButton';

type Props = {
  open: boolean;
  onClose: () => void;
  /** `/api/guest/:token/files/:id/preview` — 쿼리 없이 */
  baseUrl: string;
  title: string;
  /** 하단 [받기] — 받을 수 있으면 받고, 아니면 로그인 시트(부르는 쪽이 정한다). */
  onDownload: () => void;
};

export default function GuestPdfViewer({ open, onClose, baseUrl, title, onDownload }: Props) {
  const { t } = useTranslation('guest');
  const [page, setPage] = useState(1);
  const [pages, setPages] = useState<number | null>(null);
  const [failed, setFailed] = useState(false);
  // 다른 파일을 열면 처음부터.
  useEffect(() => { setPage(1); setPages(null); setFailed(false); }, [baseUrl, open]);

  // 쪽수는 서버 헤더(X-Pq-Pages, 상한 적용값)에서 읽는다 — 그림은 <img> 가 받으므로 HEAD 대신 같은 주소를 한 번 묻는다.
  //   같은 주소라 서버 캐시가 맞아 두 번 그리지 않는다.
  useEffect(() => {
    if (!open || !baseUrl) return;
    let dead = false;
    (async () => {
      try {
        const r = await fetch(`${baseUrl}?page=1&w=1024`);
        if (!r.ok) { if (!dead) setFailed(true); return; }
        const n = Number(r.headers.get('X-Pq-Pages')) || 1;
        if (!dead) setPages(n);
      } catch { if (!dead) setFailed(true); }
    })();
    return () => { dead = true; };
  }, [open, baseUrl]);

  const total = pages || 1;
  return (
    <StandardModal open={open} onClose={onClose} title={title} size="xl"
      footer={(
        <>
          <PageNav>
            <ActionButton tone="secondary" size="sm" type="button" data-testid="guest-pdf-prev"
              disabled={page <= 1} onClick={() => setPage((p) => Math.max(1, p - 1))}>
              {t('pdf.prev', { defaultValue: '이전' })}
            </ActionButton>
            <PageNo data-testid="guest-pdf-pageno">{page} / {total}</PageNo>
            <ActionButton tone="secondary" size="sm" type="button" data-testid="guest-pdf-next"
              disabled={page >= total} onClick={() => setPage((p) => Math.min(total, p + 1))}>
              {t('pdf.next', { defaultValue: '다음' })}
            </ActionButton>
          </PageNav>
          <ActionButton tone="primary" size="sm" type="button" data-testid="guest-pdf-download" onClick={onDownload}>
            {t('files.download', { defaultValue: '받기' })}
          </ActionButton>
        </>
      )}>
      <Stage data-testid="guest-pdf-stage">
        {failed ? (
          <Fail>{t('pdf.failed', { defaultValue: '이 파일은 미리 볼 수 없어요.' })}</Fail>
        ) : (
          <PageImg key={page} src={`${baseUrl}?page=${page}&w=1024`} alt={`${title} — ${page}`}
            data-testid="guest-pdf-page" onError={() => setFailed(true)} />
        )}
        {pages !== null && pages >= 20 && page === total && (
          <Note>{t('pdf.capped', { defaultValue: '미리보기는 앞 20쪽까지예요.' })}</Note>
        )}
      </Stage>
    </StandardModal>
  );
}

const PageNav = styled.div`display:flex;align-items:center;gap:8px;margin-right:auto;`;
const PageNo = styled.span`font-size:0.8125rem;color:#475569;font-variant-numeric:tabular-nums;min-width:48px;text-align:center;`;
const Stage = styled.div`display:flex;flex-direction:column;align-items:center;gap:8px;background:#F1F5F9;border-radius:10px;padding:12px;`;
const PageImg = styled.img`max-width:100%;height:auto;background:#fff;box-shadow:0 1px 3px rgba(15,23,42,0.12);`;
const Fail = styled.div`padding:40px 16px;font-size:0.8125rem;color:#64748B;`;
const Note = styled.div`font-size:0.75rem;color:#94A3B8;`;
