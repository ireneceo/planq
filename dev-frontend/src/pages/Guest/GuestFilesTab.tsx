// 무로그인 열람 — **파일 탭** (설계 docs/PROJECT_EXTERNAL_VIEW_DESIGN.md §8 2차)
//
// 문서와 비대칭인 것이 의도다: 문서는 **읽는 것**이고 파일은 **반출**이다.
//   그래서 내려받기는 이미 외부로 공개된 파일(L4 general)만 열린다 —
//   Irene 원안 "파일 다운로드만 로그인 유도"(GUEST_LINK §1).
//   나머지는 자리는 보이되 받을 수 없고, confidential 은 이름조차 안 나가고 건수만 알린다.
//
// ★ 토큰은 화면에 오지 않는다. "받기" 는 서버 라우트를 열고 서버가 302 로 보낸다 —
//   공유 토큰을 프론트에 실으면 그 자체가 유출 지점이 된다.
import { useCallback, useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import styled from 'styled-components';
import { useBodyScrollLock } from '../../hooks/useBodyScrollLock';
import { useEscapeStack } from '../../hooks/useEscapeStack';
import { useFocusTrap } from '../../hooks/useFocusTrap';

type FileRow = {
  id: number; file_name: string; file_size: number; mime_type: string | null;
  updated_at: string | null; locked: boolean; downloadable: boolean; uploader_name: string | null;
};

type Props = { token: string; onGone: () => void };

const formatSize = (n: number) => {
  if (!n || n < 0) return '';
  const u = ['B', 'KB', 'MB', 'GB'];
  let i = 0; let v = n;
  while (v >= 1024 && i < u.length - 1) { v /= 1024; i += 1; }
  return `${v >= 10 || i === 0 ? Math.round(v) : v.toFixed(1)}${u[i]}`;
};

export default function GuestFilesTab({ token, onGone }: Props) {
  const { t } = useTranslation('guest');
  const [rows, setRows] = useState<FileRow[] | null>(null);
  const [lockedCount, setLockedCount] = useState(0);
  const [err, setErr] = useState(false);
  const [notice, setNotice] = useState<'locked' | 'login' | null>(null);

  // 시트 = 모달. CLAUDE.md 드로어 접근성 3훅 (문서 탭과 같은 이유).
  const noticeRef = useRef<HTMLDivElement>(null);
  useBodyScrollLock(!!notice);
  useEscapeStack(!!notice, () => setNotice(null));
  useFocusTrap(noticeRef, !!notice);

  const load = useCallback(async () => {
    setErr(false);
    try {
      const r = await fetch(`/api/guest/${token}/files`);
      if (r.status === 404 || r.status === 410) { onGone(); return; }
      if (!r.ok) { setErr(true); return; }
      const j = await r.json();
      if (!j?.success) { setErr(true); return; }
      setRows(j.data?.items || []);
      setLockedCount(Number(j.data?.locked_count) || 0);
    } catch { setErr(true); }
  }, [token, onGone]);

  useEffect(() => { void load(); }, [load]);

  const openFile = (row: FileRow) => {
    if (row.locked) { setNotice('locked'); return; }
    if (!row.downloadable) { setNotice('login'); return; }
    // 서버가 302 로 공개 파일 주소로 보낸다. 새 탭으로 열어 이 화면(그리고 쓰던 글)을 지키지 않는다.
    //   ★ noopener 를 주면 반환값이 null 이다 — 반환값으로 성공을 판정하지 않는다
    //     (memory feedback_window_open_noopener_null).
    window.open(`/api/guest/${token}/files/${row.id}/open`, '_blank', 'noopener,noreferrer');
  };

  const fmt = (s: string | null) => {
    if (!s) return '';
    const d = new Date(s);
    return Number.isNaN(d.getTime()) ? '' : d.toLocaleDateString();
  };

  return (
    <Scroll data-testid="guest-files">
      {err ? (
        <Empty>
          {t('files.failed', { defaultValue: '파일을 불러오지 못했습니다.' })}{' '}
          <RetryInline type="button" onClick={() => void load()}>{t('retry', { defaultValue: '다시 시도' })}</RetryInline>
        </Empty>
      ) : rows === null ? (
        <Empty>{t('loading', { defaultValue: '불러오는 중…' })}</Empty>
      ) : rows.length === 0 && lockedCount === 0 ? (
        <Empty>{t('files.empty', { defaultValue: '아직 공유된 파일이 없어요.' })}</Empty>
      ) : (
        <>
          <List>
            {rows.map((f) => (
              <Row key={f.id} type="button" onClick={() => openFile(f)}
                $dim={f.locked || !f.downloadable} data-testid={`guest-file-${f.id}`}>
                <RowMain>
                  <RowTitle>
                    {f.locked && <Lock aria-hidden>🔒</Lock>}
                    {f.file_name}
                  </RowTitle>
                  <RowMeta>
                    {formatSize(f.file_size) && <span>{formatSize(f.file_size)}</span>}
                    {f.uploader_name && <span>{f.uploader_name}</span>}
                    {f.updated_at && <span>{fmt(f.updated_at)}</span>}
                  </RowMeta>
                </RowMain>
                {/* 받을 수 있는지 **줄에서** 말한다 — 눌러 봐야 아는 것은 안내가 아니다. */}
                <RowTag $on={f.downloadable}>
                  {f.downloadable
                    ? t('files.download', { defaultValue: '받기' })
                    : t('files.loginNeeded', { defaultValue: '로그인 필요' })}
                </RowTag>
              </Row>
            ))}
          </List>
          {lockedCount > 0 && (
            <HiddenNote data-testid="guest-files-hidden">
              {t('files.hiddenCount', {
                defaultValue: '공개할 수 없는 파일 {{count}}건은 표시하지 않았어요.',
                count: lockedCount,
              })}
            </HiddenNote>
          )}
        </>
      )}

      {notice && (
        <Sheet role="dialog" aria-modal="true"
          aria-label={t(notice === 'locked' ? 'files.lockedTitle' : 'files.loginTitle',
            { defaultValue: notice === 'locked' ? '열 수 없는 파일' : '로그인이 필요해요' }) as string}
          onClick={() => setNotice(null)}>
          <SheetBox ref={noticeRef} onClick={(e) => e.stopPropagation()}>
            <SheetTitle>
              {notice === 'locked'
                ? t('files.lockedTitle', { defaultValue: '열 수 없는 파일' })
                : t('files.loginTitle', { defaultValue: '로그인이 필요해요' })}
            </SheetTitle>
            <SheetBody>
              {notice === 'locked'
                ? t('files.lockedBody', { defaultValue: '이 파일은 담당자만 받을 수 있게 되어 있어요. 필요하시면 대화 탭에서 요청해 주세요.' })
                : t('files.loginBody', { defaultValue: '이 파일은 받으려면 로그인이 필요해요. 대화 탭에서 담당자에게 계정을 요청하실 수 있어요.' })}
            </SheetBody>
            <SheetBtn type="button" onClick={() => setNotice(null)}>{t('close', { defaultValue: '닫기' })}</SheetBtn>
          </SheetBox>
        </Sheet>
      )}
    </Scroll>
  );
}

const Scroll = styled.div`flex:1;min-height:0;overflow-y:auto;padding:16px 20px;`;
const Empty = styled.div`font-size:0.8125rem;color:#64748b;padding:12px 0;`;
const RetryInline = styled.button`
  border:none;background:none;padding:0;font-size:0.8125rem;font-weight:700;
  color:#0d9488;cursor:pointer;text-decoration:underline;
`;
const List = styled.div`display:flex;flex-direction:column;gap:8px;`;
const Row = styled.button<{ $dim: boolean }>`
  display:flex;align-items:center;gap:10px;width:100%;
  padding:12px 14px;background:#fff;border:1px solid #e2e8f0;border-radius:10px;
  text-align:left;cursor:pointer;
  opacity:${(p) => (p.$dim ? 0.7 : 1)};
  &:hover{border-color:#cbd5e1;}
  &:focus-visible{outline:2px solid #0d9488;outline-offset:2px;}
`;
const RowMain = styled.div`flex:1 1 0;min-width:0;`;
const RowTitle = styled.div`
  display:flex;align-items:center;gap:6px;
  font-size:0.875rem;font-weight:600;color:#0f172a;
  overflow:hidden;text-overflow:ellipsis;white-space:nowrap;
`;
const Lock = styled.span`font-size:0.75rem;`;
const RowMeta = styled.div`
  display:flex;flex-wrap:wrap;gap:8px;margin-top:3px;
  font-size:0.75rem;color:#64748b;
`;
const RowTag = styled.span<{ $on: boolean }>`
  flex-shrink:0;padding:2px 9px;border-radius:999px;
  font-size:0.6875rem;font-weight:700;
  background:${(p) => (p.$on ? '#ccfbf1' : '#f1f5f9')};
  color:${(p) => (p.$on ? '#0f766e' : '#94a3b8')};
`;
const HiddenNote = styled.div`
  margin-top:12px;padding:10px 12px;background:#f1f5f9;border-radius:8px;
  font-size:0.75rem;line-height:1.5;color:#64748b;
`;
const Sheet = styled.div`
  position:fixed;inset:0;z-index:60;display:flex;align-items:flex-end;justify-content:center;
  background:rgba(15,23,42,0.45);
  @media (min-width:641px){align-items:center;}
`;
const SheetBox = styled.div`
  width:100%;max-width:420px;padding:20px;background:#fff;border-radius:16px 16px 0 0;
  padding-bottom:calc(20px + env(safe-area-inset-bottom));
  @media (min-width:641px){border-radius:16px;margin:0 16px;padding-bottom:20px;}
`;
const SheetTitle = styled.div`font-size:1rem;font-weight:700;color:#0f172a;`;
const SheetBody = styled.div`margin-top:8px;font-size:0.8125rem;line-height:1.6;color:#475569;`;
const SheetBtn = styled.button`
  margin-top:16px;width:100%;height:2.75rem;
  background:#0f172a;color:#fff;border:none;border-radius:10px;
  font-size:0.875rem;font-weight:600;cursor:pointer;
`;
