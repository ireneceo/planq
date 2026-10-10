// 무로그인 열람 — **파일 탭** (설계 docs/PROJECT_EXTERNAL_VIEW_DESIGN.md §8 2차)
//
// 문서와 비대칭인 것이 의도다: 문서는 **읽는 것**이고 파일은 **반출**이다.
//   그래서 내려받기는 이미 외부로 공개된 파일(L4 general)만 열린다 —
//   Irene 원안 "파일 다운로드만 로그인 유도"(GUEST_LINK §1).
//   나머지는 자리는 보이되 받을 수 없고, confidential 은 이름조차 안 나가고 건수만 알린다.
//
// ★ 토큰은 화면에 오지 않는다. "받기" 는 서버 라우트를 열고 서버가 302 로 보낸다 —
//   공유 토큰을 프론트에 실으면 그 자체가 유출 지점이 된다.
// ★ 2026-10-10 §I-3 — «보기» 와 «받기» 를 갈랐다(옛 §D «받을 수 있는 이미지에만 썸네일» 을 뒤집음).
//   general 이미지·PDF 는 서버가 줄여 그린 그림으로 **본다**(이미지 → ImageLightbox, PDF → GuestPdfViewer).
//   받기는 종전대로 L4 공유 파일만 — 아니면 로그인·계정 요청 시트(페이지 한 벌)가 뜬다.
import { useCallback, useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import PlanQSelect from '../../components/Common/PlanQSelect';
import SearchBox from '../../components/Common/SearchBox';
import { FilterBar, FilterSlot, FilterSearchSlot, axisOption } from '../../components/Common/filterBar';
import { GuestTabPane, Empty, RetryInline, HiddenNote, Lock } from './guestShell';
import { CardGrid, Card, Thumb, ThumbImg, CardName, CardMeta, CardTag, MetaFixed } from './guestCards';
import { formatPublicDate } from '../../utils/dateFormat';
import type { LoginSheetReason } from './LoginRequiredSheet';
import ImageLightbox from '../../components/Common/ImageLightbox';
import GuestPdfViewer from './GuestPdfViewer';

type FileRow = {
  id: number; file_name: string; file_size: number; mime_type: string | null;
  updated_at: string | null; locked: boolean; downloadable: boolean; uploader_name: string | null;
  /** 볼 수 있는가(§I-3) — general 이미지·PDF. 받기(downloadable)와 다른 술어다. */
  viewable?: boolean;
  preview_kind?: 'image' | 'pdf';
  /** 볼 수 있을 때만 서버가 싣는다 — 링크 토큰 아래 주소(`…/files/:id/preview?w=400`). 없으면 종류 글자로 그린다. */
  preview_url?: string;
};

type Props = { token: string; onGone: () => void; onNeedLogin: (reason: LoginSheetReason) => void };

const formatSize = (n: number) => {
  if (!n || n < 0) return '';
  const u = ['B', 'KB', 'MB', 'GB'];
  let i = 0; let v = n;
  while (v >= 1024 && i < u.length - 1) { v /= 1024; i += 1; }
  return `${v >= 10 || i === 0 ? Math.round(v) : v.toFixed(1)}${u[i]}`;
};
/** 종류 — mime 에서 파생한다(서버 인자를 늘리지 않는다, §F). */
type Kind = 'image' | 'doc' | 'other';
const kindOf = (f: FileRow): Kind => {
  const m = (f.mime_type || '').toLowerCase();
  if (m.startsWith('image/')) return 'image';
  if (/pdf|word|excel|sheet|presentation|powerpoint|msword|officedocument|text\//.test(m)) return 'doc';
  return 'other';
};
const extOf = (name: string) => {
  const i = name.lastIndexOf('.');
  return i > 0 ? name.slice(i + 1).toUpperCase().slice(0, 5) : '';
};

export default function GuestFilesTab({ token, onGone, onNeedLogin }: Props) {
  const { t } = useTranslation('guest');
  const [rows, setRows] = useState<FileRow[] | null>(null);
  const [lockedCount, setLockedCount] = useState(0);
  const [err, setErr] = useState(false);
  const [q, setQ] = useState('');
  const [kind, setKind] = useState('');

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

  // 보기 — 위에 뜬 창. 닫으면 보던 탭 그대로(Esc 는 창만 닫는다 — useEscapeStack).
  const [viewing, setViewing] = useState<FileRow | null>(null);
  const previewBase = (row: FileRow) => (row.preview_url || '').split('?')[0];

  const download = (row: FileRow) => {
    if (row.locked) { onNeedLogin('locked-file'); return; }
    if (!row.downloadable) { onNeedLogin('download'); return; }
    // 서버가 302 로 공개 파일 주소로 보낸다. 새 탭으로 열어 이 화면(그리고 쓰던 글)을 지킨다.
    //   ★ noopener 를 주면 반환값이 null 이다 — 반환값으로 성공을 판정하지 않는다
    //     (memory feedback_window_open_noopener_null).
    window.open(`/api/guest/${token}/files/${row.id}/open`, '_blank', 'noopener,noreferrer');
  };
  const openFile = (row: FileRow) => {
    if (row.viewable && row.preview_url) { setViewing(row); return; }
    download(row);
  };
  // 보기 창의 [받기] — 받을 수 없으면 창을 먼저 닫고 시트를 띄운다(팝업 위 팝업 금지).
  const downloadFromViewer = () => {
    const row = viewing;
    if (!row) return;
    if (!row.downloadable) setViewing(null);
    download(row);
  };

  const kindOptions = useMemo(() => [
    axisOption(t('filter.kind', { defaultValue: '종류' }) as string),
    { value: 'image', label: t('filter.kindImage', { defaultValue: '이미지' }) as string },
    { value: 'doc', label: t('filter.kindDoc', { defaultValue: '문서' }) as string },
    { value: 'other', label: t('filter.kindOther', { defaultValue: '기타' }) as string },
  ], [t]);
  const shown = useMemo(() => {
    const needle = q.trim().toLowerCase();
    return (rows || []).filter((f) => (!kind || kindOf(f) === kind) && (!needle || f.file_name.toLowerCase().includes(needle)));
  }, [rows, q, kind]);

  return (
    <GuestTabPane data-testid="guest-tab-body-files">
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
          {rows.length > 0 && (
            <FilterBar data-testid="guest-files-filter">
              <FilterSearchSlot>
                <SearchBox value={q} onChange={setQ} width="100%"
                  placeholder={t('filter.searchFile', { defaultValue: '파일 이름 검색' }) as string}
                  ariaLabel={t('filter.searchFile', { defaultValue: '파일 이름 검색' }) as string} />
              </FilterSearchSlot>
              <FilterSlot width={120} testId="guest-files-kind">
                <PlanQSelect size="sm" isSearchable={false} options={kindOptions}
                  aria-label={t('filter.kind', { defaultValue: '종류' }) as string}
                  value={kindOptions.find((o) => o.value === kind) || kindOptions[0]}
                  onChange={(opt: unknown) => setKind(String((opt as { value?: string } | null)?.value ?? ''))} />
              </FilterSlot>
            </FilterBar>
          )}
          {rows.length > 0 && shown.length === 0 ? (
            <Empty data-testid="guest-files-nomatch">{t('filter.noMatch', { defaultValue: '조건에 맞는 항목이 없어요.' })}</Empty>
          ) : (
            <CardGrid>
              {shown.map((f) => (
                <Card key={f.id} type="button" onClick={() => openFile(f)}
                  $dim={f.locked || (!f.downloadable && !f.viewable)} data-testid={`guest-file-${f.id}`}>
                  <Thumb>
                    {f.preview_url
                      ? <ThumbImg src={f.preview_url} alt="" loading="lazy" data-testid={`guest-file-thumb-${f.id}`} />
                      : <span aria-hidden>{f.locked ? <Lock size={20} /> : (extOf(f.file_name) || 'FILE')}</span>}
                    {/* 볼 수 있는지·받을 수 있는지 **카드에서** 말한다 — 눌러 봐야 아는 것은 안내가 아니다. */}
                    <CardTag $on={f.downloadable || !!f.viewable} data-testid={`guest-file-tag-${f.id}`}>
                      {f.downloadable
                        ? t('files.download', { defaultValue: '받기' })
                        : f.locked
                          ? t('files.lockedTag', { defaultValue: '잠김' })
                          : f.viewable
                            ? t('files.view', { defaultValue: '보기' })
                            : t('files.loginDownload', { defaultValue: '로그인 후 받기' })}
                    </CardTag>
                  </Thumb>
                  <CardName>
                    {f.locked && <Lock />}
                    <span>{f.file_name}</span>
                  </CardName>
                  <CardMeta data-card-meta="">
                    {formatSize(f.file_size) && <MetaFixed>{formatSize(f.file_size)}</MetaFixed>}
                    {f.updated_at && <MetaFixed>{formatPublicDate(f.updated_at)}</MetaFixed>}
                  </CardMeta>
                </Card>
              ))}
            </CardGrid>
          )}
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
      {viewing?.preview_kind === 'image' && (
        <ImageLightbox src={`${previewBase(viewing)}?w=1600`} alt={viewing.file_name}
          onClose={() => setViewing(null)} onDownload={downloadFromViewer} />
      )}
      <GuestPdfViewer open={viewing?.preview_kind === 'pdf'} onClose={() => setViewing(null)}
        baseUrl={viewing?.preview_kind === 'pdf' ? previewBase(viewing) : ''}
        title={viewing?.file_name || ''} onDownload={downloadFromViewer} />
    </GuestTabPane>
  );
}
