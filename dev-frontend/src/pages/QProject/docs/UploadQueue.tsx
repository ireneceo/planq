// 업로드 큐 — 파일별 진행률·속도·남은 시간·취소.
// 옛 화면은 "1개 업로드 중…" 만 보여 얼마나 남았는지 알 수 없었다. 원인은 업로드에 fetch 를 쓴 것 —
// fetch 에는 업로드 진행 이벤트가 없다. 진행률은 XMLHttpRequest(contexts/AuthContext.apiUpload) 만이 준다.
import React, { useCallback, useRef, useState } from 'react';
import styled from 'styled-components';
import { useTranslation } from 'react-i18next';
import { formatBytes, type ProjectFile, type UploadHooks } from '../../../services/files';

interface UploadJob {
  key: string;
  name: string;
  size: number;
  loaded: number;
  /** 0~100. 서버가 길이를 모르면 -1 */
  pct: number;
  status: 'queued' | 'uploading' | 'error';
  error?: string;
  /** bytes per second — 남은 시간 추정용 */
  bps?: number;
}

export interface UploadSendResult { success: boolean; file?: ProjectFile; message?: string }

/** 업로드 큐 상태 + 실행기. 한 번에 하나씩 보낸다(모바일 회선에서 병렬은 전체를 더 느리게 만든다). */
export function useUploadQueue() {
  const [uploads, setUploads] = useState<UploadJob[]>([]);
  const ctrls = useRef<Map<string, AbortController>>(new Map());

  const runUploads = useCallback(async (
    arr: File[],
    send: (f: File, hooks: UploadHooks) => Promise<UploadSendResult>,
    onDone: (f: ProjectFile) => void,
  ) => {
    const stamp = Date.now();
    const jobs: UploadJob[] = arr.map((f, i) => ({
      key: `${stamp}-${i}-${f.name}`, name: f.name, size: f.size,
      loaded: 0, pct: 0, status: 'queued',
    }));
    setUploads(prev => [...prev, ...jobs]);

    for (let i = 0; i < arr.length; i++) {
      const job = jobs[i];
      const ctrl = new AbortController();
      ctrls.current.set(job.key, ctrl);
      const startedAt = Date.now();
      setUploads(prev => prev.map(u => (u.key === job.key ? { ...u, status: 'uploading' } : u)));
      try {
        const r = await send(arr[i], {
          signal: ctrl.signal,
          onProgress: (pr) => setUploads(prev => prev.map(u => {
            if (u.key !== job.key) return u;
            const el = (Date.now() - startedAt) / 1000;
            return { ...u, loaded: pr.loaded, pct: pr.pct, bps: el > 0.4 ? pr.loaded / el : u.bps };
          })),
        });
        if (r.success && r.file) {
          onDone(r.file);
          setUploads(prev => prev.filter(u => u.key !== job.key));
        } else {
          setUploads(prev => prev.map(u => (u.key === job.key
            ? { ...u, status: 'error', error: r.message || 'upload_failed' } : u)));
        }
      } catch (e) {
        // 사용자가 취소한 것은 오류가 아니다 — 조용히 목록에서 뺀다.
        const aborted = (e as { name?: string } | null)?.name === 'AbortError';
        setUploads(prev => (aborted
          ? prev.filter(u => u.key !== job.key)
          : prev.map(u => (u.key === job.key ? { ...u, status: 'error', error: 'network_failed' } : u))));
      } finally {
        ctrls.current.delete(job.key);
      }
    }
  }, []);

  const cancelUpload = useCallback((key: string) => {
    const c = ctrls.current.get(key);
    if (c) c.abort();
    else setUploads(prev => prev.filter(u => u.key !== key));   // 대기 중이거나 실패한 행
  }, []);

  return { uploads, runUploads, cancelUpload };
}

export const UploadQueuePanel: React.FC<{
  uploads: UploadJob[];
  onCancel: (key: string) => void;
}> = ({ uploads, onCancel }) => {
  const { t } = useTranslation('qproject');
  if (uploads.length === 0) return null;
  return (
    <UpPanel role="status" aria-live="polite" aria-label={t('docs.up.aria', '업로드 진행 상황')}>
      {uploads.map(u => {
        const remain = u.bps && u.bps > 0 && u.size > u.loaded
          ? Math.ceil((u.size - u.loaded) / u.bps) : null;
        return (
          <UpRow key={u.key}>
            <UpMain>
              <UpTop>
                <UpName title={u.name}>{u.name}</UpName>
                <UpPct $err={u.status === 'error'}>
                  {u.status === 'error'
                    ? t('docs.up.failed', '실패')
                    : u.status === 'queued'
                      ? t('docs.up.queued', '대기 중')
                      : u.pct >= 0 ? `${u.pct}%` : t('docs.up.working', '전송 중')}
                </UpPct>
              </UpTop>
              <UpBar>
                <UpFill $pct={u.status === 'error' ? 100 : Math.max(u.pct, 0)} $err={u.status === 'error'} />
              </UpBar>
              <UpMeta>
                {u.status === 'error'
                  ? t('docs.up.errGeneric', '업로드하지 못했습니다')
                  : (
                    <>
                      {formatBytes(u.loaded)} / {formatBytes(u.size)}
                      {u.bps ? ` · ${formatBytes(u.bps)}/s` : ''}
                      {remain !== null ? ` · ${t('docs.up.remain', '{{s}}초 남음', { s: remain })}` : ''}
                    </>
                  )}
              </UpMeta>
            </UpMain>
            <UpCancel type="button" onClick={() => onCancel(u.key)}
              aria-label={u.status === 'error'
                ? t('docs.up.dismiss', '지우기')
                : t('docs.up.cancel', '업로드 취소')}>
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
                <line x1="18" y1="6" x2="6" y2="18" /><line x1="6" y1="6" x2="18" y2="18" />
              </svg>
            </UpCancel>
          </UpRow>
        );
      })}
    </UpPanel>
  );
};

const UpPanel = styled.div`
  display:flex;flex-direction:column;gap:8px;margin-top:10px;
  padding:10px 12px;background:#fff;border:1px solid #E2E8F0;border-radius:10px;
`;
const UpRow = styled.div`display:flex;align-items:center;gap:10px;`;
const UpMain = styled.div`flex:1;min-width:0;display:flex;flex-direction:column;gap:4px;`;
const UpTop = styled.div`display:flex;align-items:baseline;gap:8px;`;
const UpName = styled.div`
  flex:1;min-width:0;font-size:13px;font-weight:600;color:#0F172A;
  overflow:hidden;text-overflow:ellipsis;white-space:nowrap;
`;
const UpPct = styled.div<{ $err: boolean }>`
  font-size:12.5px;font-weight:700;flex-shrink:0;
  color:${p => (p.$err ? '#DC2626' : '#0F766E')};
`;
const UpBar = styled.div`height:6px;background:#F1F5F9;border-radius:999px;overflow:hidden;`;
const UpFill = styled.div<{ $pct: number; $err: boolean }>`
  height:100%;width:${p => p.$pct}%;border-radius:999px;transition:width .2s ease;
  background:${p => (p.$err ? '#FCA5A5' : 'linear-gradient(90deg,#14B8A6,#0D9488)')};
`;
const UpMeta = styled.div`font-size:12px;color:#64748B;`;
const UpCancel = styled.button`
  flex-shrink:0;display:inline-flex;align-items:center;justify-content:center;
  width:36px;height:36px;background:transparent;border:none;border-radius:8px;
  color:#94A3B8;cursor:pointer;
  &:hover{background:#F1F5F9;color:#DC2626;}
  &:focus-visible{outline:2px solid #0D9488;outline-offset:2px;}
  @media (max-width:1024px){width:2.5rem;height:2.5rem;}
`;
