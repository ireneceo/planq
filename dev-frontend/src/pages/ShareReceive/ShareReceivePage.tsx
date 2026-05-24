// 사이클 Q-D Phase 3 — PWA Share Target 수신 페이지 (파일 + 텍스트 + URL).
//
// manifest.json 의 share_target.action='/share-receive' (POST + multipart/form-data, files 포함)
// 외부 앱(카톡·갤러리·브라우저·파일앱) "공유" → PlanQ 선택 시 이 페이지 진입.
//
// 흐름:
//   1) ?shared=1 이면 SW 의 Cache 에서 share payload 읽기 (파일 포함)
//   2) URL 쿼리만 있는 경우 그대로 (legacy GET fallback)
//   3) 사용자에게 "어디로 보낼까요?" 선택 (채팅·업무·메모·문서·파일)
//   4) 선택 → 해당 영역에 파일 업로드 + 텍스트 prefill
//
// 사이클 N+53 — 새로고침 안전망: cache.delete 를 destination 선택 완료 후로 미룸.
// 사용자가 destination 선택 전 새로고침해도 cache 가 살아있어 데이터 복원됨.
// stale 차단: payload.ts 가 10분 이상 지났으면 자동 정리.

import { useEffect, useMemo, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import styled from 'styled-components';
import { useTranslation } from 'react-i18next';
import PageShell from '../../components/Layout/PageShell';
import { ChatIcon, CheckIcon, EditIcon, FileIcon } from '../../components/Common/Icons';
import { useAuth, apiFetch } from '../../contexts/AuthContext';

interface SharePayload {
  title: string;
  text: string;
  url: string;
  fileCount: number;
  ts: number;
}

const SHARE_CACHE = 'planq-share-v1';
const SHARE_TTL_MS = 10 * 60 * 1000; // 10분 — share 받고 10분 안에 destination 선택해야

async function loadSharePayload(): Promise<{ payload: SharePayload | null; files: File[]; stale: boolean }> {
  if (typeof caches === 'undefined') return { payload: null, files: [], stale: false };
  try {
    const cache = await caches.open(SHARE_CACHE);
    const meta = await cache.match('/_share_payload');
    if (!meta) return { payload: null, files: [], stale: false };
    const payload = await meta.json() as SharePayload;
    // stale 검사 — 10분 이상 지났으면 자동 정리 (다른 사용자 share 였을 수도 있고)
    if (payload.ts && Date.now() - payload.ts > SHARE_TTL_MS) {
      await cleanupShareCache(payload.fileCount || 0);
      return { payload: null, files: [], stale: true };
    }
    const files: File[] = [];
    for (let i = 0; i < (payload.fileCount || 0); i++) {
      const r = await cache.match(`/_share_file_${i}`);
      if (!r) continue;
      const blob = await r.blob();
      const filename = decodeURIComponent(r.headers.get('X-Filename') || `share-${i}`);
      files.push(new File([blob], filename, { type: blob.type }));
    }
    // 사이클 N+53 — cache.delete 는 destination 선택 완료 후 (cleanupShareCache) 로 미룸.
    // 사용자 새로고침 시 데이터 잃지 않게.
    return { payload, files, stale: false };
  } catch { return { payload: null, files: [], stale: false }; }
}

async function cleanupShareCache(fileCount: number): Promise<void> {
  if (typeof caches === 'undefined') return;
  try {
    const cache = await caches.open(SHARE_CACHE);
    await cache.delete('/_share_payload');
    for (let i = 0; i < fileCount; i++) await cache.delete(`/_share_file_${i}`);
  } catch { /* best-effort */ }
}

const ShareReceivePage: React.FC = () => {
  const { t } = useTranslation('common');
  const [params] = useSearchParams();
  const navigate = useNavigate();
  const { user } = useAuth();
  const businessId = user?.business_id ? Number(user.business_id) : null;

  const [title, setTitle] = useState(params.get('title') || '');
  const [text, setText] = useState(params.get('text') || '');
  const [url, setUrl] = useState(params.get('url') || '');
  const [files, setFiles] = useState<File[]>([]);
  const [fileCount, setFileCount] = useState(0); // cleanup 시 사용 — file 인덱스 개수
  const [loading, setLoading] = useState(params.get('shared') === '1');
  const [busy, setBusy] = useState<string | null>(null);
  const [stale, setStale] = useState(false);

  // POST 공유 — SW 가 파일 + 텍스트 Cache 에 저장 후 ?shared=1 로 redirect.
  // 사이클 N+53: cache.delete 는 sendTo 완료 후 (새로고침 안전망).
  useEffect(() => {
    if (params.get('shared') !== '1') return;
    let cancelled = false;
    loadSharePayload().then(({ payload, files: f, stale: s }) => {
      if (cancelled) return;
      if (s) setStale(true);
      if (!payload) { setLoading(false); return; }
      setTitle(payload.title || '');
      setText(payload.text || '');
      setUrl(payload.url || '');
      setFiles(f);
      setFileCount(payload.fileCount || 0);
      setLoading(false);
    }).catch(() => setLoading(false));
    return () => { cancelled = true; };
  }, [params]);

  const content = useMemo(() => {
    const parts: string[] = [];
    if (title) parts.push(title);
    if (text) parts.push(text);
    if (url) parts.push(url);
    return parts.filter(Boolean).join('\n');
  }, [title, text, url]);

  const fmtSize = (n: number) => n < 1024 ? `${n} B` : n < 1024*1024 ? `${(n/1024).toFixed(1)} KB` : `${(n/1024/1024).toFixed(1)} MB`;

  // 파일 업로드 (배열) — 워크스페이스 파일로
  const uploadFilesToWorkspace = async (): Promise<number[]> => {
    if (!businessId || files.length === 0) return [];
    const ids: number[] = [];
    for (const f of files) {
      const fd = new FormData();
      fd.append('file', f);
      const r = await apiFetch(`/api/files/${businessId}`, { method: 'POST', body: fd });
      const j = await r.json();
      if (j.success && j.data?.id) ids.push(Number(j.data.id));
    }
    return ids;
  };

  const sendTo = async (target: 'chat' | 'task' | 'note' | 'doc' | 'file') => {
    if (busy) return;
    setBusy(target);
    try {
      const encoded = encodeURIComponent(content);
      // Q File 로 — 파일 그대로 워크스페이스에 업로드 + /files 이동
      if (target === 'file') {
        if (files.length === 0) { setBusy(null); return; }
        await uploadFilesToWorkspace();
        await cleanupShareCache(fileCount);
        navigate('/files');
        return;
      }
      // 다른 destination — 텍스트 prefill 로 이동.
      // 파일이 있으면 일단 워크스페이스 업로드 → 그 후 ?attachFileIds=1,2,3 로 prefill 가능 (다음 사이클 통합)
      switch (target) {
        case 'chat':  navigate(`/talk?prefill=${encoded}`); break;
        case 'task':  navigate(`/tasks?prefill=${encoded}`); break;
        case 'note':  navigate(`/qnote?prefill=${encoded}`); break;
        case 'doc':   navigate(`/docs?prefill=${encoded}`); break;
      }
      // 사이클 N+53 — destination 선택 완료 시 cache 정리 (새로고침 안전망 해제)
      await cleanupShareCache(fileCount);
    } finally {
      setBusy(null);
    }
  };

  if (loading) {
    return (
      <PageShell title={t('shareReceive.title', 'PlanQ 로 공유') as string}>
        <Wrap><PreviewBox>{t('common.loading', '불러오는 중...')}</PreviewBox></Wrap>
      </PageShell>
    );
  }

  return (
    <PageShell title={t('shareReceive.title', 'PlanQ 로 공유') as string}>
      <Wrap>
        {stale && (
          <StaleNote>
            {t('shareReceive.staleNote', '공유 받은 데이터가 오래되어 자동 정리되었습니다. 다시 공유해주세요.')}
          </StaleNote>
        )}
        {(content || files.length > 0) && (
          <PreviewBox>
            <PreviewLabel>{t('shareReceive.received', '받은 내용')}</PreviewLabel>
            {content && <PreviewContent>{content}</PreviewContent>}
            {files.length > 0 && (
              <FilesList>
                {files.map((f, i) => (
                  <FileChip key={i} title={f.name}>
                    <FileChipName>{f.name}</FileChipName>
                    <FileChipSize>{fmtSize(f.size)}</FileChipSize>
                  </FileChip>
                ))}
              </FilesList>
            )}
          </PreviewBox>
        )}
        {!stale && !content && files.length === 0 && (
          <PreviewBox>{t('shareReceive.empty', '(빈 내용)')}</PreviewBox>
        )}

        <ChooseLabel>{t('shareReceive.chooseDest', '어디로 보낼까요?')}</ChooseLabel>
        <DestGrid>
          <DestBtn type="button" onClick={() => sendTo('chat')} disabled={busy !== null}>
            <DestIcon><ChatIcon size={22} /></DestIcon>
            <DestTitle>{t('shareReceive.dest.chat', '채팅')}</DestTitle>
            <DestDesc>{t('shareReceive.dest.chatDesc', '대화방에 메시지로')}</DestDesc>
          </DestBtn>
          <DestBtn type="button" onClick={() => sendTo('task')} disabled={busy !== null}>
            <DestIcon><CheckIcon size={22} /></DestIcon>
            <DestTitle>{t('shareReceive.dest.task', '업무')}</DestTitle>
            <DestDesc>{t('shareReceive.dest.taskDesc', '새 업무로 등록')}</DestDesc>
          </DestBtn>
          <DestBtn type="button" onClick={() => sendTo('note')} disabled={busy !== null}>
            <DestIcon><EditIcon size={22} /></DestIcon>
            <DestTitle>{t('shareReceive.dest.note', '메모')}</DestTitle>
            <DestDesc>{t('shareReceive.dest.noteDesc', 'Q Note 에 저장')}</DestDesc>
          </DestBtn>
          <DestBtn type="button" onClick={() => sendTo('doc')} disabled={busy !== null}>
            <DestIcon><EditIcon size={22} /></DestIcon>
            <DestTitle>{t('shareReceive.dest.doc', '문서')}</DestTitle>
            <DestDesc>{t('shareReceive.dest.docDesc', '새 문서 본문에')}</DestDesc>
          </DestBtn>
          {files.length > 0 && (
            <DestBtn type="button" onClick={() => sendTo('file')} disabled={busy !== null} $highlight>
              <DestIcon><FileIcon size={22} /></DestIcon>
              <DestTitle>{t('shareReceive.dest.file', 'Q File')}</DestTitle>
              <DestDesc>{t('shareReceive.dest.fileDesc', '워크스페이스 파일로 저장')}</DestDesc>
            </DestBtn>
          )}
        </DestGrid>

        {busy && <Hint>{t('shareReceive.uploading', '업로드 중...')}</Hint>}
        {!busy && files.length > 0 && (
          <Hint>{t('shareReceive.fileNote', '파일은 워크스페이스에 자동 저장됩니다. 채팅·업무 destination 선택 시 텍스트만 prefill 되며, 파일 첨부는 다음 사이클에 통합됩니다.')}</Hint>
        )}
      </Wrap>
    </PageShell>
  );
};

export default ShareReceivePage;

const Wrap = styled.div`max-width: 560px; margin: 0 auto; display: flex; flex-direction: column; gap: 20px;`;
const PreviewBox = styled.div`background: #F8FAFC; border: 1px solid #E2E8F0; border-radius: 12px; padding: 14px 16px;`;
const PreviewLabel = styled.div`font-size: 11px; font-weight: 700; color: #64748B; text-transform: uppercase; letter-spacing: 0.4px; margin-bottom: 6px;`;
const PreviewContent = styled.div`font-size: 13px; color: #0F172A; white-space: pre-wrap; word-break: break-word; line-height: 1.5;`;
const ChooseLabel = styled.h3`font-size: 14px; font-weight: 700; color: #0F172A; margin: 0;`;
const DestGrid = styled.div`display: grid; grid-template-columns: repeat(2, 1fr); gap: 12px;`;
const DestBtn = styled.button<{ $highlight?: boolean }>`
  display: flex; flex-direction: column; align-items: flex-start; gap: 4px;
  padding: 16px; min-height: 100px;
  background: ${p => p.$highlight ? '#F0FDFA' : '#FFFFFF'};
  border: 1px solid ${p => p.$highlight ? '#14B8A6' : '#E2E8F0'};
  border-radius: 12px;
  text-align: left; cursor: pointer; transition: all 0.15s;
  &:hover:not(:disabled) { background: #F0FDFA; border-color: #14B8A6; }
  &:focus-visible { outline: none; box-shadow: 0 0 0 3px rgba(20,184,166,0.3); }
  &:disabled { opacity: 0.5; cursor: not-allowed; }
`;
const FilesList = styled.div`display: flex; flex-wrap: wrap; gap: 6px; margin-top: 10px;`;
const FileChip = styled.div`display: inline-flex; align-items: center; gap: 6px; padding: 4px 10px; background: #FFFFFF; border: 1px solid #CBD5E1; border-radius: 999px; font-size: 11px; color: #475569; max-width: 240px;`;
const FileChipName = styled.span`white-space: nowrap; overflow: hidden; text-overflow: ellipsis; max-width: 160px; font-weight: 600; color: #0F172A;`;
const FileChipSize = styled.span`color: #94A3B8;`;
const DestIcon = styled.span`
  display: inline-flex; align-items: center; justify-content: center;
  color: #0F766E; height: 22px;
`;
const DestTitle = styled.div`font-size: 14px; font-weight: 700; color: #0F172A;`;
const DestDesc = styled.div`font-size: 11px; color: #64748B;`;
const Hint = styled.div`font-size: 11px; color: #94A3B8; padding: 8px 0; line-height: 1.5;`;
const StaleNote = styled.div`
  background: #FEF3C7; border: 1px solid #F59E0B; border-radius: 10px;
  padding: 12px 14px; font-size: 13px; color: #92400E; line-height: 1.5;
`;
