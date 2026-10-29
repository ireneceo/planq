// 공유 폴더 — /public/folders/:token (#469 · 설계 docs/FOLDER_SHARE_DESIGN.md)
//
// 무엇이 보이는지는 서버(services/folderShare)가 정한다 — 화면은 받은 목록을 하위 폴더 경로로 묶어 그리기만 한다.
// 단건 공유 페이지(PublicFilePage)와 같은 계약: 비밀번호는 헤더로만 · 받기·썸네일 주소에는 서버가 준 서명(`download_qs`) ·
// 만료 410 · 링크를 열어 둔 채 폴더가 바뀌면 다시 읽는다(usePublicRevalidate, 비밀번호로 연 화면은 같은 자격으로).
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import styled from 'styled-components';
import { useParams } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { getAccessToken } from '../../contexts/AuthContext';
import SharePasswordPrompt from './SharePasswordPrompt';
import PublicPageShell, { PublicCenter, PublicWorkspaceLabel } from '../../components/Layout/PublicPageShell';
import ExpiredShareLink from '../../components/Common/ExpiredShareLink';
import { usePublicRevalidate } from '../../hooks/usePublicRevalidate';

interface FolderFile {
  id: number;
  file_name: string;
  mime_type: string | null;
  file_size: number;
  created_at: string | null;
  /** 공유 폴더 기준 하위 폴더 경로('' = 맨 위) */
  folder_path: string;
  /** 서버가 정한 미리보기 가능 여부 — 화면은 mime 로 다시 판단하지 않는다 */
  preview_kind: 'image' | 'pdf' | null;
  thumb: boolean;
  /** 비밀번호 공유면 받기·썸네일 주소에 붙일 서명(`?dl=…`). 비밀번호 없으면 '' */
  download_qs: string;
}
interface FolderShare {
  folder: { name: string };
  workspace: { name: string } | null;
  folders: string[];
  files: FolderFile[];
  total: number;
  truncated: boolean;
  total_bytes: number;
  zip_max_bytes: number;
  zip_qs: string;
}

const formatSize = (bytes: number): string => {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  if (bytes < 1024 * 1024 * 1024) return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
  return `${(bytes / 1024 / 1024 / 1024).toFixed(2)} GB`;
};
// 서명 꼬리(`?dl=…`)가 있으면 그 뒤에 `&`, 없으면 `?` 로 잇는다.
const withQuery = (base: string, qs: string, extra?: string) =>
  `${base}${qs || ''}${extra ? `${qs ? '&' : '?'}${extra}` : ''}`;

const PublicFolderPage = () => {
  const { t } = useTranslation('common');
  const { token } = useParams<{ token: string }>();
  const [data, setData] = useState<FolderShare | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [needPw, setNeedPw] = useState(false);
  const [pwError, setPwError] = useState<string | null>(null);
  const [pwBusy, setPwBusy] = useState(false);
  const [expired, setExpired] = useState<{ at: string | null } | null>(null);
  const [appUrl, setAppUrl] = useState<string | null>(null);
  const pwRef = useRef<string | undefined>(undefined);

  const load = useCallback(async (pw?: string, silent = false) => {
    if (!token) return;
    // silent = 다시 읽기. 보고 있는 화면을 스피너·비밀번호 창으로 되돌리지 않는다.
    if (!silent) { if (pw) setPwBusy(true); else setLoading(true); setPwError(null); }
    try {
      const r = await fetch(`/api/folders/public/${token}`, pw ? { headers: { 'X-Share-Password': pw } } : undefined);
      const j = await r.json();
      if (j.success) {
        pwRef.current = pw;
        setData(j.data);
        setNeedPw(false);
      } else if (r.status === 410 && j.code === 'share_expired') {
        setExpired({ at: j.expired_at || null });
      } else if (r.status === 401 && j.requires_password) {
        if (silent) return;
        setNeedPw(true);
        if (pw) setPwError(j.message === 'password_wrong' ? 'wrong' : null);
      } else if (!silent) {
        setError(j.message || 'not_found');
      }
    } catch { if (!silent) setError('network'); }
    finally { if (!silent) { setLoading(false); setPwBusy(false); } }
  }, [token]);

  useEffect(() => { void load(); }, [load]);
  usePublicRevalidate(() => load(pwRef.current, true), { enabled: !!data });

  // 로그인한 멤버면 «PlanQ 에서 보기» — 폴더 id 는 공개 응답에 없으므로 서버에 묻는다.
  useEffect(() => {
    const at = getAccessToken();
    if (!token || !at || !data) return;
    let alive = true;
    fetch(`/api/folders/public/${token}/auth-check`, { headers: { Authorization: `Bearer ${at}` } })
      .then((r) => r.json())
      .then((j) => { if (alive && j?.success && j.data?.canAccess) setAppUrl(j.data.appUrl); })
      .catch(() => { /* 비로그인과 같게 */ });
    return () => { alive = false; };
  }, [token, !!data]); // eslint-disable-line react-hooks/exhaustive-deps

  // 하위 폴더 경로로 묶는다 — 서버가 이미 경로·이름 순으로 준다. 빈 하위 폴더도 자리를 남긴다.
  const groups = useMemo(() => {
    if (!data) return [] as Array<{ path: string; files: FolderFile[] }>;
    const map = new Map<string, FolderFile[]>([['', []]]);
    for (const p of data.folders) if (!map.has(p)) map.set(p, []);
    for (const f of data.files) {
      if (!map.has(f.folder_path)) map.set(f.folder_path, []);
      map.get(f.folder_path)!.push(f);
    }
    return Array.from(map.entries())
      .sort(([a], [b]) => (a === '' ? -1 : b === '' ? 1 : a.localeCompare(b)))
      .map(([path, files]) => ({ path, files }))
      .filter((g) => g.path !== '' || g.files.length > 0);
  }, [data]);

  if (loading) return <PublicCenter>{t('public.loading', { defaultValue: '불러오는 중...' }) as string}</PublicCenter>;
  if (expired) return <ExpiredShareLink expiredAt={expired.at} />;
  if (needPw) return <SharePasswordPrompt onSubmit={load} busy={pwBusy} error={pwError} />;
  if (error || !data) return (
    <PublicPageShell layout="card" width="sm" brand={false}>
      <ErrorTitle>{t('public.notFound', { defaultValue: '링크가 만료되었거나 없는 항목입니다' }) as string}</ErrorTitle>
      <Hint>{t('public.notFoundHint', { defaultValue: '링크 작성자에게 다시 받으세요.' }) as string}</Hint>
      <CTA href="/" rel="noreferrer">{t('public.goHome', { defaultValue: 'PlanQ 홈으로' }) as string}</CTA>
    </PublicPageShell>
  );

  const fileBase = (id: number) => `/api/folders/public/${token}/files/${id}/download`;
  const zipTooBig = data.total_bytes > data.zip_max_bytes;

  return (
    <PublicPageShell layout="card" width="lg" brand={false}>
      <>
        {data.workspace && <PublicWorkspaceLabel>{data.workspace.name}</PublicWorkspaceLabel>}
        <Title data-testid="public-folder-title">
          <FolderIcon aria-hidden="true" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z" />
          </FolderIcon>
          {data.folder.name}
        </Title>
        <Meta>
          {t('public.folder.count', { count: data.total, size: formatSize(data.total_bytes), defaultValue: '파일 {{count}}개 · {{size}}' }) as string}
        </Meta>

        {data.files.length === 0 && (
          <Empty data-testid="public-folder-empty">{t('public.folder.empty', { defaultValue: '이 폴더에 보여 줄 파일이 없어요.' }) as string}</Empty>
        )}

        {groups.map((g) => (
          <Group key={g.path || '_root'}>
            {g.path && <GroupHead>{g.path}</GroupHead>}
            {g.files.length === 0 && <GroupEmpty>{t('public.folder.subEmpty', { defaultValue: '비어 있어요' }) as string}</GroupEmpty>}
            {g.files.map((f) => (
              <Row key={f.id} data-testid="public-folder-row">
                <Thumb>
                  {f.thumb
                    ? <img src={withQuery(`/api/folders/public-thumb/${token}/${f.id}`, f.download_qs, 'w=96')} alt="" loading="lazy" />
                    : <FileGlyph aria-hidden="true" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" /><polyline points="14 2 14 8 20 8" /></FileGlyph>}
                </Thumb>
                <NameCol>
                  {f.preview_kind ? (
                    <NameLink href={withQuery(fileBase(f.id), f.download_qs, 'inline=1')} target="_blank" rel="noopener noreferrer" title={f.file_name}>{f.file_name}</NameLink>
                  ) : (
                    <NameText title={f.file_name}>{f.file_name}</NameText>
                  )}
                  <Size>{formatSize(f.file_size)}</Size>
                </NameCol>
                <RowBtn href={withQuery(fileBase(f.id), f.download_qs)} aria-label={`${t('public.file.download', { defaultValue: '다운로드' }) as string} ${f.file_name}`}>
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" /><polyline points="7 10 12 15 17 10" /><line x1="12" y1="15" x2="12" y2="3" /></svg>
                </RowBtn>
              </Row>
            ))}
          </Group>
        ))}

        {data.truncated && (
          <Hint>{t('public.folder.truncated', { count: data.files.length, total: data.total, defaultValue: '{{total}}개 중 앞의 {{count}}개만 보여요.' }) as string}</Hint>
        )}

        <CTAArea>
          {data.files.length > 0 && (zipTooBig ? (
            <Hint data-testid="public-folder-zip-too-big">{t('public.folder.zipTooBig', { size: formatSize(data.zip_max_bytes), defaultValue: '전체 크기가 {{size}} 를 넘어 한 번에 받을 수 없어요. 파일을 하나씩 받아 주세요.' }) as string}</Hint>
          ) : (
            <CTA href={withQuery(`/api/folders/public/${token}/zip`, data.zip_qs)} data-testid="public-folder-zip">
              {t('public.folder.downloadAll', { defaultValue: '전체 받기 (zip)' }) as string}
            </CTA>
          ))}
          {appUrl ? (
            <CTASecondary href={appUrl}>{t('public.openInPlanQ', { defaultValue: 'PlanQ 에서 보기 →' }) as string}</CTASecondary>
          ) : !getAccessToken() && (
            <CTASecondary href={`/login?next=${encodeURIComponent(`/public/folders/${token}`)}`}>
              {t('public.login', { defaultValue: 'PlanQ 로그인' }) as string}
            </CTASecondary>
          )}
        </CTAArea>
        <Footer>{t('public.poweredBy', { defaultValue: 'PlanQ — 일이 일이 되지 않게' }) as string}</Footer>
      </>
    </PublicPageShell>
  );
};

export default PublicFolderPage;

const Title = styled.h1`
  display: flex; align-items: center; gap: 8px;
  font-size: 1.25rem; font-weight: 700; color: #0F172A; margin: 0 0 6px; line-height: 1.3; word-break: break-all;
`;
const FolderIcon = styled.svg`flex-shrink: 0; color: #0D9488;`;
const Meta = styled.div`font-size: 0.75rem; color: #64748B; margin-bottom: 16px;`;
const Empty = styled.div`
  padding: 24px 16px; border-radius: 8px; background: #F8FAFC; border: 1px solid #E2E8F0;
  color: #64748B; font-size: 0.8125rem; text-align: center;
`;
const Group = styled.section`margin-bottom: 12px;`;
const GroupHead = styled.div`
  font-size: 0.75rem; font-weight: 700; color: #475569; padding: 8px 2px 4px; border-bottom: 1px solid #F1F5F9;
  word-break: break-all;
`;
const GroupEmpty = styled.div`font-size: 0.75rem; color: #94A3B8; padding: 8px 2px;`;
const Row = styled.div`
  display: grid; grid-template-columns: 40px minmax(0, 1fr) auto; align-items: center; gap: 10px;
  padding: 8px 2px; border-bottom: 1px solid #F1F5F9;
`;
const Thumb = styled.div`
  width: 40px; height: 40px; border-radius: 6px; overflow: hidden; background: #F8FAFC; border: 1px solid #E2E8F0;
  display: flex; align-items: center; justify-content: center; color: #94A3B8;
  img { width: 100%; height: 100%; object-fit: cover; display: block; }
`;
const FileGlyph = styled.svg`flex-shrink: 0;`;
const NameCol = styled.div`min-width: 0; display: flex; flex-direction: column; gap: 2px;`;
const nameCss = `font-size: 0.8125rem; font-weight: 600; white-space: nowrap; overflow: hidden; text-overflow: ellipsis;`;
const NameLink = styled.a`${nameCss} color: #0F172A; text-decoration: none; &:hover { color: #0D9488; text-decoration: underline; }`;
const NameText = styled.span`${nameCss} color: #0F172A;`;
const Size = styled.span`font-size: 0.6875rem; color: #94A3B8;`;
const RowBtn = styled.a`
  display: inline-flex; align-items: center; justify-content: center; width: 40px; height: 40px;
  border-radius: 8px; color: #475569; border: 1px solid #E2E8F0; background: #fff;
  &:hover { border-color: #CBD5E1; background: #F8FAFC; color: #0F172A; }
`;
const CTAArea = styled.div`display: flex; gap: 8px; margin: 20px 0 12px; flex-wrap: wrap; align-items: center;`;
const CTA = styled.a`
  display: inline-flex; align-items: center; min-height: 44px; padding: 10px 20px;
  background: #14B8A6; color: #fff; font-size: 0.8125rem; font-weight: 700;
  border-radius: 8px; text-decoration: none; transition: background 0.15s;
  &:hover { background: #0D9488; }
`;
const CTASecondary = styled.a`
  display: inline-flex; align-items: center; min-height: 44px; padding: 10px 20px;
  background: #fff; color: #334155; font-size: 0.8125rem; font-weight: 600;
  border: 1px solid #E2E8F0; border-radius: 8px; text-decoration: none;
  &:hover { border-color: #CBD5E1; background: #F8FAFC; }
`;
const Hint = styled.div`font-size: 0.75rem; color: #94A3B8; padding: 8px 0;`;
const ErrorTitle = styled.div`font-size: 1.125rem; font-weight: 700; color: #0F172A; margin-bottom: 8px;`;
const Footer = styled.div`font-size: 0.6875rem; color: #94A3B8; text-align: center; margin-top: 12px;`;
