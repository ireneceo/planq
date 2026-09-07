// Google Drive 에서 골라 첨부 — 노션식 (Irene 2026-09-07)
//
//   "파일첨부할 때 구글드라이브에서 가져와서 첨부하게 노션처럼도 기능 추가해 달라고 했는데
//    이것도 파일첨부 통합 컨포넌트에 다 추가 못해?"
//
// ★ **기본은 팀(워크스페이스) 드라이브다.** Irene: *"나는 팀 드라이브 중심으로 계속 요구한거고 …
//   개인 구글드라이브는 개인 것만이니까 제대로 이해하고 해."*
//   공용 첨부에 개인 Drive 를 붙이면 멤버 사적 파일이 워크스페이스로 샌다 —
//   memory `project_gdrive_policy`(옵션 B)가 막으려던 바로 그 사고다.
//   개인 자리(개인 보관함)에서만 scope="personal" 로 넘긴다.
//
// 그래서 화면마다 붙이지 않고 **통합 컴포넌트(AttachmentField) 안에** 둔다 — 여기 한 번이면
// 업무·문서·메일·채팅 첨부가 전부 같이 얻는다.
//
// 동작: 목록(GET /api/me/drive/files) → 고르면 서버가 바이트를 들여 PlanQ File 을 만들고
//       (POST /api/me/drive/import) 그 id 를 기존-파일 선택에 더한다. 즉 결과물은
//       "이미 워크스페이스에 있는 파일" 과 완전히 같아진다 — 미리보기·공유·보존이 그대로 된다.
//
// ★ drive.file scope 라 **PlanQ 가 만들었거나 사용자가 PlanQ 에 열어 준 파일만** 보인다.
//   전체 열람(drive.readonly)은 제한 권한·유료 심사라 채택하지 않았다(Irene 결정 2026-06-01).
//   그래서 "내 드라이브에 있는데 여기 없다" 가 정상일 수 있고, 화면이 그 이유를 말해야 한다.
import React, { useCallback, useEffect, useRef, useState } from 'react';
import styled from 'styled-components';
import { useTranslation } from 'react-i18next';
import { apiFetch } from '../../contexts/AuthContext';

interface DriveFile {
  id: string;
  name: string;
  mime_type: string;
  size: number | null;
  web_view_link: string | null;
}

interface Props {
  businessId: number;
  /** 어느 Drive 에서 가져오는가. 기본은 워크스페이스가 연결한 **팀 드라이브**. */
  scope?: 'workspace' | 'personal';
  /** 프로젝트 첨부면 그 프로젝트로 들인다(노출 범위가 L2 가 된다). */
  projectId?: number | null;
  /** 들이기 성공 — 새로 만들어진 PlanQ File id */
  onImported: (fileId: number) => void;
  disabled?: boolean;
}

const DriveImportSection: React.FC<Props> = ({ businessId, scope = 'workspace', projectId, onImported, disabled }) => {
  const personal = scope === 'personal';
  const { t } = useTranslation('common');
  const [open, setOpen] = useState(false);
  const [connected, setConnected] = useState<boolean | null>(null);
  const [files, setFiles] = useState<DriveFile[]>([]);
  const [q, setQ] = useState('');
  const [loading, setLoading] = useState(false);
  const [importingId, setImportingId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [doneIds, setDoneIds] = useState<Set<string>>(new Set());
  const debounce = useRef<ReturnType<typeof setTimeout> | null>(null);

  const load = useCallback(async (keyword: string) => {
    if (!businessId) return;
    setLoading(true);
    setError(null);
    try {
      const url = `/api/drive/files?business_id=${businessId}&scope=${scope}${keyword ? `&q=${encodeURIComponent(keyword)}` : ''}`;
      const r = await apiFetch(url);
      // apiFetch 는 throw 하지 않는다 — ok 를 반드시 본다 (memory: apifetch_no_throw)
      if (!r.ok) { setError(t('attach.drive.loadFailed') as string); return; }
      const j = await r.json();
      setConnected(!!j?.data?.connected);
      setFiles(j?.data?.files || []);
    } catch {
      setError(t('attach.drive.loadFailed') as string);
    } finally { setLoading(false); }
  }, [businessId, scope, t]);

  useEffect(() => { if (open) void load(''); }, [open, load]);

  useEffect(() => {
    if (!open) return;
    if (debounce.current) clearTimeout(debounce.current);
    debounce.current = setTimeout(() => { void load(q); }, 350);
    return () => { if (debounce.current) clearTimeout(debounce.current); };
  }, [q, open, load]);

  const importOne = async (f: DriveFile) => {
    if (importingId || disabled) return;      // 중복 제출 가드 (UI_DESIGN_GUIDE §1.8)
    setImportingId(f.id);
    setError(null);
    try {
      const r = await apiFetch('/api/drive/import', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          business_id: businessId, file_id: f.id, scope,
          // 개인 Drive 에서 온 것은 프로젝트로 못 넣는다(서버도 같은 술어로 막는다).
          project_id: personal ? undefined : (projectId || undefined),
        }),
      });
      const j = await r.json().catch(() => ({}));
      if (!r.ok) {
        // 왜 안 되는지 화면이 말한다 — 조용히 아무 일도 안 일어나는 것이 가장 나쁘다.
        const reason = String(j?.message || '');
        setError(
          reason.startsWith('google_native')
            ? (t('attach.drive.nativeDoc') as string)
            : reason.startsWith('extension_not_allowed')
              ? (t('attach.drive.extNotAllowed') as string)
              : reason.startsWith('storage_quota_exceeded')
                ? (t('attach.drive.quota') as string)
                : (t('attach.drive.importFailed') as string),
        );
        return;
      }
      const fileId = Number(j?.data?.file_id);
      if (!fileId) { setError(t('attach.drive.importFailed') as string); return; }
      setDoneIds(prev => new Set(prev).add(f.id));
      onImported(fileId);
    } finally { setImportingId(null); }
  };

  return (
    <Wrap>
      <Toggle type="button" onClick={() => setOpen(v => !v)} aria-expanded={open}
        data-testid="attach-drive-toggle" disabled={disabled}>
        <GDriveIcon viewBox="0 0 24 24" aria-hidden="true">
          <path fill="#0F9D58" d="M7.7 3h8.6l4.3 7.5h-8.6z" />
          <path fill="#4285F4" d="M3.4 18.5 7.7 11h8.6l-4.3 7.5z" />
          <path fill="#FFCD40" d="M12 18.5h8.6l-4.3-7.5-4.3 7.5z" />
        </GDriveIcon>
        <span>{personal
          ? (t('attach.drive.titlePersonal') as string)
          : (t('attach.drive.title') as string)}</span>
        <Caret $open={open} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true">
          <polyline points="6 9 12 15 18 9" />
        </Caret>
      </Toggle>

      {open && (
        <Panel>
          {connected === false ? (
            <Hint>{personal
              ? (t('attach.drive.notConnectedPersonal') as string)
              : (t('attach.drive.notConnected') as string)}</Hint>
          ) : (
            <>
              <SearchInput
                value={q}
                onChange={e => setQ(e.target.value)}
                placeholder={t('attach.drive.search') as string}
                disabled={disabled}
              />
              {loading && <Hint>{t('attach.drive.loading') as string}</Hint>}
              {!loading && files.length === 0 && (
                <Hint>{t('attach.drive.empty') as string}</Hint>
              )}
              <List>
                {files.map(f => {
                  const done = doneIds.has(f.id);
                  return (
                    <Row key={f.id} type="button" onClick={() => !done && importOne(f)}
                      disabled={disabled || done || importingId !== null}>
                      <RowName title={f.name}>{f.name}</RowName>
                      <RowMeta>
                        {importingId === f.id
                          ? (t('attach.drive.importing') as string)
                          : done
                            ? (t('attach.drive.added') as string)
                            : f.size ? `${Math.round(f.size / 1024)}KB` : ''}
                      </RowMeta>
                    </Row>
                  );
                })}
              </List>
            </>
          )}
          {error && <ErrText role="status">{error}</ErrText>}
        </Panel>
      )}
    </Wrap>
  );
};

const Wrap = styled.div`margin-top:10px;`;
const Toggle = styled.button`
  display:flex;align-items:center;gap:8px;width:100%;
  padding:8px 10px;border:1px solid #E2E8F0;border-radius:8px;background:#fff;
  font-size:0.8125rem;font-weight:600;color:#0F172A;cursor:pointer;
  &:hover:not(:disabled){border-color:#CBD5E1;background:#F8FAFC;}
  &:disabled{opacity:0.6;cursor:default;}
  /* 터치 타겟 (반응형 원칙 2) */
  @media (hover: none), (max-width: 640px) { min-height: 40px; }
`;
const GDriveIcon = styled.svg`width:16px;height:16px;flex-shrink:0;`;
const Caret = styled.svg<{ $open: boolean }>`
  width:14px;height:14px;margin-left:auto;color:#94A3B8;
  transform:rotate(${p => p.$open ? 180 : 0}deg);transition:transform 0.15s;
`;
const Panel = styled.div`
  margin-top:8px;padding:10px;border:1px solid #E2E8F0;border-radius:8px;background:#F8FAFC;
`;
const SearchInput = styled.input`
  width:100%;padding:7px 10px;border:1px solid #E2E8F0;border-radius:6px;
  font-size:0.8125rem;background:#fff;color:#0F172A;
  /* 폰에서 16px 미만이면 iOS 가 화면을 확대한다 */
  @media (max-width: 640px) { font-size: 1rem; }
  &:focus{outline:none;border-color:#14B8A6;}
`;
const List = styled.div`margin-top:8px;max-height:220px;overflow-y:auto;display:flex;flex-direction:column;gap:2px;`;
const Row = styled.button`
  display:flex;align-items:center;gap:8px;width:100%;
  padding:7px 8px;border:0;border-radius:6px;background:transparent;cursor:pointer;text-align:left;
  &:hover:not(:disabled){background:#EEF2F6;}
  &:disabled{opacity:0.55;cursor:default;}
  @media (hover: none), (max-width: 640px) { min-height: 40px; }
`;
const RowName = styled.span`
  min-width:0;flex:1;font-size:0.8125rem;color:#0F172A;
  white-space:nowrap;overflow:hidden;text-overflow:ellipsis;
`;
const RowMeta = styled.span`font-size:0.6875rem;color:#64748B;flex-shrink:0;`;
const Hint = styled.p`margin:6px 2px;font-size:0.75rem;color:#64748B;line-height:1.5;`;
const ErrText = styled.p`margin:6px 2px 0;font-size:0.75rem;color:#B91C1C;line-height:1.5;`;

export default DriveImportSection;
