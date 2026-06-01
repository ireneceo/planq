// 내 파일 (개인 Google Drive) 탭 — 외부 연동 Phase 4
// GET /api/me/drive/files. 읽기 전용 — 클릭 시 Google Drive 원본을 새 탭에서 연다.
import React, { useCallback, useEffect, useState } from 'react';
import styled from 'styled-components';
import { useTranslation } from 'react-i18next';
import { apiFetch } from '../../contexts/AuthContext';
import { useTimeFormat } from '../../hooks/useTimeFormat';

interface DriveFile {
  id: string;
  name: string;
  mime_type: string;
  size: number | null;
  modified_at: string;
  icon_link: string | null;
  web_view_link: string | null;
}

const formatSize = (n: number | null): string => {
  if (!n || n <= 0) return '—';
  const units = ['B', 'KB', 'MB', 'GB'];
  let v = n, i = 0;
  while (v >= 1024 && i < units.length - 1) { v /= 1024; i++; }
  return `${v.toFixed(v < 10 && i > 0 ? 1 : 0)} ${units[i]}`;
};

const PersonalDriveTab: React.FC<{ businessId: number }> = ({ businessId }) => {
  const { t } = useTranslation('qfile');
  const { formatDate } = useTimeFormat();
  const [connected, setConnected] = useState<boolean | null>(null);
  const [files, setFiles] = useState<DriveFile[]>([]);
  const [accountEmail, setAccountEmail] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [q, setQ] = useState('');

  const load = useCallback(async (query?: string) => {
    setLoading(true); setError(null);
    try {
      const r = await apiFetch(`/api/me/drive/files?business_id=${businessId}${query ? `&q=${encodeURIComponent(query)}` : ''}`);
      const j = await r.json();
      if (!j.success) {
        setError(j.message || (t('drive.loadFailed', { defaultValue: '불러오기 실패' }) as string));
        return;
      }
      setConnected(!!j.data.connected);
      setAccountEmail(j.data.account_email || null);
      setFiles(j.data.files || []);
    } catch (e) {
      setError((e as Error).message);
    } finally { setLoading(false); }
  }, [businessId, t]);

  useEffect(() => { load(); }, [load]);

  if (connected === false) {
    return (
      <Notice>
        <NoticeText>{t('drive.notConnected', { defaultValue: 'Google Drive 를 연결하면 PlanQ 가 내 드라이브에 저장한 파일을 여기서 볼 수 있어요.' }) as string}</NoticeText>
        <NoticeBtn type="button" onClick={() => { window.location.href = '/profile/integrations'; }}>
          {t('drive.connectCta', { defaultValue: '내 외부 연동에서 연결하기' }) as string} →
        </NoticeBtn>
      </Notice>
    );
  }

  return (
    <Wrap>
      <Bar>
        <SearchInput
          value={q}
          onChange={(e) => setQ(e.target.value)}
          onKeyDown={(e) => { if (e.key === 'Enter') load(q); }}
          placeholder={t('drive.searchPlaceholder', { defaultValue: 'PlanQ 저장 파일 검색 (Enter)' }) as string}
        />
        {accountEmail && <AccountTag>{accountEmail}</AccountTag>}
      </Bar>
      {error && <ErrorBox>{error}</ErrorBox>}
      {loading ? (
        <Empty>{t('drive.loading', { defaultValue: '불러오는 중…' }) as string}</Empty>
      ) : files.length === 0 ? (
        <Empty>{t('drive.empty', { defaultValue: '아직 PlanQ 가 내 드라이브에 저장한 파일이 없어요' }) as string}</Empty>
      ) : (
        <List>
          {files.map((f) => (
            <Row key={f.id} href={f.web_view_link || undefined} target="_blank" rel="noopener noreferrer" $clickable={!!f.web_view_link}>
              {f.icon_link ? <Icon src={f.icon_link} alt="" /> : <IconFallback>📄</IconFallback>}
              <FileName>{f.name}</FileName>
              <FileMeta>{formatSize(f.size)} · {formatDate(f.modified_at)}</FileMeta>
            </Row>
          ))}
        </List>
      )}
    </Wrap>
  );
};

export default PersonalDriveTab;

// ─── styled ───────────────────────────────
const Wrap = styled.div``;
const Bar = styled.div`
  display: flex; align-items: center; gap: 10px; margin-bottom: 14px; flex-wrap: wrap;
`;
const SearchInput = styled.input`
  flex: 1; min-width: 200px; height: 36px;
  padding: 0 12px; border: 1px solid #E2E8F0; border-radius: 8px;
  font-size: 13px; color: #0F172A;
  &:focus { outline: none; border-color: #8B5CF6; box-shadow: 0 0 0 3px rgba(139,92,246,0.12); }
`;
const AccountTag = styled.span`
  font-size: 12px; color: #6D28D9; background: #F5F3FF;
  border: 1px solid #C4B5FD; border-radius: 999px; padding: 4px 10px; white-space: nowrap;
`;
const List = styled.div`display: flex; flex-direction: column; gap: 6px;`;
const Row = styled.a<{ $clickable: boolean }>`
  display: flex; align-items: center; gap: 12px;
  padding: 10px 14px; border: 1px solid #E2E8F0; border-radius: 10px;
  background: #fff; text-decoration: none; color: inherit;
  cursor: ${(p) => (p.$clickable ? 'pointer' : 'default')};
  &:hover { background: ${(p) => (p.$clickable ? '#F8FAFC' : '#fff')}; border-color: ${(p) => (p.$clickable ? '#CBD5E1' : '#E2E8F0')}; }
`;
const Icon = styled.img`width: 20px; height: 20px; flex-shrink: 0;`;
const IconFallback = styled.span`font-size: 18px; flex-shrink: 0;`;
const FileName = styled.div`flex: 1; font-size: 13px; font-weight: 500; color: #0F172A; overflow: hidden; text-overflow: ellipsis; white-space: nowrap;`;
const FileMeta = styled.div`font-size: 12px; color: #94A3B8; white-space: nowrap;`;
const Empty = styled.div`padding: 40px; text-align: center; color: #94A3B8; font-size: 13px;`;
const ErrorBox = styled.div`
  padding: 10px 14px; margin-bottom: 12px;
  background: #FEF2F2; border: 1px solid #FECACA; border-radius: 8px; color: #B91C1C; font-size: 13px;
`;
const Notice = styled.div`
  display: flex; flex-direction: column; align-items: center; gap: 12px;
  padding: 40px 20px; text-align: center;
  background: #F8FAFC; border: 1px dashed #CBD5E1; border-radius: 12px;
`;
const NoticeText = styled.div`font-size: 13px; color: #475569; line-height: 1.6;`;
const NoticeBtn = styled.button`
  height: 36px; padding: 0 16px;
  background: #8B5CF6; color: #fff; border: none; border-radius: 8px;
  font-size: 13px; font-weight: 600; cursor: pointer;
  &:hover { background: #7C3AED; }
  &:focus-visible { outline: 2px solid #C4B5FD; outline-offset: 2px; }
`;
