// 업로드 큐 — 파일별 진행률·속도·남은 시간·취소 + **일괄 조치**.
// 옛 화면은 "1개 업로드 중…" 만 보여 얼마나 남았는지 알 수 없었다. 원인은 업로드에 fetch 를 쓴 것 —
// fetch 에는 업로드 진행 이벤트가 없다. 진행률은 XMLHttpRequest(contexts/AuthContext.apiUpload) 만이 준다.
//
// ★ 2026-09-24 — 두 가지를 더한다 (운영 신고, 메뉴 사진 48장 업로드).
//   ① **429 는 실패가 아니라 대기다.** 업로드는 `upload.single`(1파일=1요청)이고 여기서 순차로 보내므로
//      서버의 분당 상한이 곧 «한 번에 올릴 수 있는 파일 수» 가 된다. 실측 — 48장 중 30장이 올라간 뒤
//      나머지 18장이 전부 「요청이 너무 잦습니다」로 **영구 실패**로 그려졌다. 상한은 올렸지만(300/분)
//      상한은 상한이므로, 닿으면 **기다렸다가 자동으로 이어서** 보낸다. 안 그러면 큰 배치가 조용히 잘린다.
//      ★ 순차 전송이라 한 건이 429 면 그 순간 창(window)이 소진된 것이다 → **큐 전체가 함께 기다린다.**
//        한 건씩 따로 기다리면 매 파일이 429 를 한 번씩 더 받아 상한을 계속 두드린다.
//   ② **실패가 여러 건이면 하나씩 지우게 두지 않는다.** [전체 재시도]·[실패 목록 지우기]·[모두 중단].
//      Irene: *"실패리스트 이렇게 많이 뜨면 … 지금 하나씩 삭제하게 해. 아니면 그냥 나가야 해."*
//      재시도하려면 원본 `File` 을 들고 있어야 한다 — 안 들고 있으면 «파일을 다시 고르세요» 가 된다.
import React, { useCallback, useEffect, useRef, useState } from 'react';
import styled from 'styled-components';
import { useTranslation } from 'react-i18next';
import { formatBytes, type ProjectFile, type UploadHooks } from '../../../services/files';
import { uploadErrorText } from '../../../utils/uploadError';

/** 한 파일이 429 로 기다릴 수 있는 횟수. 상한(300/분)을 크게 넘는 배치도 통과하되, 무한 대기는 막는다. */
const MAX_WAITS = 12;

interface UploadJob {
  key: string;
  name: string;
  size: number;
  loaded: number;
  /** 0~100. 서버가 길이를 모르면 -1 */
  pct: number;
  status: 'queued' | 'uploading' | 'waiting' | 'error';
  /** 실패 사유 **코드**(또는 서버가 준 문장). 화면은 `uploadErrorText()` 로 문장을 만든다. */
  error?: string;
  /** 사유가 크기 한도일 때의 한도 — 문장에 숫자를 넣기 위한 것 */
  limitBytes?: number;
  /** bytes per second — 남은 시간 추정용 */
  bps?: number;
  /** 429 대기가 끝나는 시각(epoch ms). 화면이 남은 초를 말한다 — 말 없는 정지는 «멈춤» 으로 읽힌다. */
  retryAt?: number;
  /** 이 파일이 429 로 기다린 횟수 */
  waits: number;
}

export interface UploadSendResult {
  success: boolean;
  file?: ProjectFile;
  message?: string;
  limitBytes?: number;
  /** HTTP 상태 — 429 를 가리는 유일한 단서 */
  status?: number;
  retryAfterMs?: number;
}

type Sender = (f: File, hooks: UploadHooks) => Promise<UploadSendResult>;
type Done = (f: ProjectFile) => void;

/** 업로드 큐 상태 + 실행기. 한 번에 하나씩 보낸다(모바일 회선에서 병렬은 전체를 더 느리게 만든다). */
export function useUploadQueue() {
  const [uploads, setUploads] = useState<UploadJob[]>([]);
  const ctrls = useRef<Map<string, AbortController>>(new Map());
  /** 재시도를 위해 원본 File 과 보내는 법을 들고 있는다. 언마운트 전까지만 산다. */
  const store = useRef<Map<string, { file: File; send: Sender; onDone: Done }>>(new Map());
  /** 실행 중인 루프가 하나뿐이도록 — [전체 재시도] 를 연타해도 두 벌이 돌지 않게 */
  const running = useRef(false);
  /** 대기 중인 파일이 있을 때만 1초마다 다시 그린다(남은 초 표시) */
  const [, setTick] = useState(0);

  useEffect(() => {
    if (!uploads.some((u) => u.status === 'waiting')) return undefined;
    const id = setInterval(() => setTick((n) => n + 1), 1000);
    return () => clearInterval(id);
  }, [uploads]);

  const patch = useCallback((key: string, next: Partial<UploadJob>) => {
    setUploads((prev) => prev.map((u) => (u.key === key ? { ...u, ...next } : u)));
  }, []);

  /** 큐에 담긴 것 중 아직 안 끝난 것을 **순서대로** 보낸다. 이미 돌고 있으면 그 루프가 이어서 집는다. */
  const drain = useCallback(async () => {
    if (running.current) return;
    running.current = true;
    try {
      for (;;) {
        // 다음 대상 — 최신 상태에서 고른다(도중에 취소·추가될 수 있다).
        const next = await new Promise<UploadJob | null>((resolve) => {
          setUploads((prev) => {
            resolve(prev.find((u) => u.status === 'queued' || u.status === 'waiting') || null);
            return prev;
          });
        });
        if (!next) break;

        // 429 대기가 아직 안 끝났으면 그 시간만큼 쉰다 — 큐 전체가 함께 쉰다.
        if (next.status === 'waiting' && next.retryAt && next.retryAt > Date.now()) {
          await new Promise((r) => setTimeout(r, Math.min(next.retryAt! - Date.now(), 2000)));
          continue;
        }

        const held = store.current.get(next.key);
        if (!held) { patch(next.key, { status: 'error', error: 'upload_failed' }); continue; }

        const ctrl = new AbortController();
        ctrls.current.set(next.key, ctrl);
        const startedAt = Date.now();
        patch(next.key, { status: 'uploading', retryAt: undefined });
        try {
          const r = await held.send(held.file, {
            signal: ctrl.signal,
            onProgress: (pr) => setUploads((prev) => prev.map((u) => {
              if (u.key !== next.key) return u;
              const el = (Date.now() - startedAt) / 1000;
              return { ...u, loaded: pr.loaded, pct: pr.pct, bps: el > 0.4 ? pr.loaded / el : u.bps };
            })),
          });
          if (r.success && r.file) {
            held.onDone(r.file);
            store.current.delete(next.key);
            setUploads((prev) => prev.filter((u) => u.key !== next.key));
          } else if (r.status === 429 && next.waits < MAX_WAITS) {
            // ★ 실패가 아니다 — 창이 찼을 뿐이다. 기다렸다가 **같은 파일을 다시** 보낸다.
            patch(next.key, {
              status: 'waiting', waits: next.waits + 1, loaded: 0, pct: 0, bps: undefined,
              retryAt: Date.now() + (r.retryAfterMs || 15000), error: undefined,
            });
          } else {
            patch(next.key, {
              status: 'error', error: r.message || 'upload_failed', limitBytes: r.limitBytes,
            });
          }
        } catch (e) {
          // 사용자가 취소한 것은 오류가 아니다 — 조용히 목록에서 뺀다.
          const aborted = (e as { name?: string } | null)?.name === 'AbortError';
          if (aborted) {
            store.current.delete(next.key);
            setUploads((prev) => prev.filter((u) => u.key !== next.key));
          } else {
            patch(next.key, { status: 'error', error: 'network_failed' });
          }
        } finally {
          ctrls.current.delete(next.key);
        }
      }
    } finally {
      running.current = false;
    }
  }, [patch]);

  const runUploads = useCallback(async (arr: File[], send: Sender, onDone: Done) => {
    const stamp = Date.now();
    const jobs: UploadJob[] = arr.map((f, i) => {
      const key = `${stamp}-${i}-${f.name}`;
      store.current.set(key, { file: f, send, onDone });
      return { key, name: f.name, size: f.size, loaded: 0, pct: 0, status: 'queued' as const, waits: 0 };
    });
    setUploads((prev) => [...prev, ...jobs]);
    await drain();
  }, [drain]);

  const cancelUpload = useCallback((key: string) => {
    const c = ctrls.current.get(key);
    if (c) { c.abort(); return; }
    store.current.delete(key);
    setUploads((prev) => prev.filter((u) => u.key !== key));   // 대기 중이거나 실패한 행
  }, []);

  /** 실패한 것만 전부 큐로 되돌린다. 대기 횟수는 초기화 — 사람이 «다시» 라고 말한 것이다. */
  const retryFailed = useCallback(() => {
    setUploads((prev) => prev.map((u) => (u.status === 'error' && store.current.has(u.key)
      ? { ...u, status: 'queued' as const, error: undefined, loaded: 0, pct: 0, bps: undefined, waits: 0, retryAt: undefined }
      : u)));
    void drain();
  }, [drain]);

  /** 실패 목록만 치운다 — 진행 중인 것은 건드리지 않는다. */
  const clearFailed = useCallback(() => {
    setUploads((prev) => {
      prev.filter((u) => u.status === 'error').forEach((u) => store.current.delete(u.key));
      return prev.filter((u) => u.status !== 'error');
    });
  }, []);

  /** 모두 중단 — 전송 중인 것은 취소하고 나머지는 목록에서 뺀다. */
  const cancelAll = useCallback(() => {
    ctrls.current.forEach((c) => c.abort());
    setUploads((prev) => {
      prev.forEach((u) => { if (u.status !== 'uploading') store.current.delete(u.key); });
      return prev.filter((u) => u.status === 'uploading');
    });
  }, []);

  return { uploads, runUploads, cancelUpload, retryFailed, clearFailed, cancelAll };
}

export const UploadQueuePanel: React.FC<{
  uploads: UploadJob[];
  onCancel: (key: string) => void;
  onRetryFailed?: () => void;
  onClearFailed?: () => void;
  onCancelAll?: () => void;
  /** 한 번에 가져올 수 있는 상한에 닿아 **일부만** 들어왔을 때. 말없이 자르지 않는다. */
  truncatedAt?: number | null;
}> = ({ uploads, onCancel, onRetryFailed, onClearFailed, onCancelAll, truncatedAt }) => {
  const { t } = useTranslation('qproject');
  if (uploads.length === 0 && !truncatedAt) return null;
  const failed = uploads.filter((u) => u.status === 'error').length;
  const waiting = uploads.filter((u) => u.status === 'waiting').length;
  const active = uploads.length - failed;
  return (
    <UpPanel role="status" aria-live="polite" aria-label={t('docs.up.aria', '업로드 진행 상황')}>
      {truncatedAt ? (
        <UpTruncated>
          {t('docs.up.truncated', '한 번에 {{n}}개까지만 가져옵니다. 나머지는 다시 올려 주세요.', { n: truncatedAt })}
        </UpTruncated>
      ) : null}
      <UpHead>
        <UpHeadText>
          {active > 0 && <span>{t('docs.up.headRunning', '올리는 중 {{n}}개', { n: active })}</span>}
          {waiting > 0 && <UpHeadWait>{t('docs.up.headWaiting', '대기 {{n}}개', { n: waiting })}</UpHeadWait>}
          {failed > 0 && <UpHeadErr>{t('docs.up.headFailed', '실패 {{n}}개', { n: failed })}</UpHeadErr>}
        </UpHeadText>
        <UpHeadBtns>
          {failed > 0 && onRetryFailed && (
            <UpAct type="button" $primary onClick={onRetryFailed} data-testid="upload-retry-failed">
              {t('docs.up.retryAll', '전체 재시도')}
            </UpAct>
          )}
          {failed > 0 && onClearFailed && (
            <UpAct type="button" onClick={onClearFailed} data-testid="upload-clear-failed">
              {t('docs.up.clearFailed', '실패 목록 지우기')}
            </UpAct>
          )}
          {active > 0 && onCancelAll && (
            <UpAct type="button" onClick={onCancelAll} data-testid="upload-cancel-all">
              {t('docs.up.cancelAll', '모두 중단')}
            </UpAct>
          )}
        </UpHeadBtns>
      </UpHead>
      {uploads.map((u) => {
        const remain = u.bps && u.bps > 0 && u.size > u.loaded
          ? Math.ceil((u.size - u.loaded) / u.bps) : null;
        const waitSec = u.status === 'waiting' && u.retryAt
          ? Math.max(0, Math.ceil((u.retryAt - Date.now()) / 1000)) : null;
        return (
          <UpRow key={u.key}>
            <UpMain>
              <UpTop>
                <UpName title={u.name}>{u.name}</UpName>
                <UpPct $err={u.status === 'error'} $wait={u.status === 'waiting'}>
                  {/* ★ «순서를 기다림»(queued)과 «상한에 걸려 기다림»(waiting)은 **다른 글자**여야 한다.
                      둘 다 「대기 중」이면 사용자는 왜 멈춰 있는지 알 수 없고, 검사기도 둘을 못 가른다
                      (2026-09-24 실측: 판정이 queued 행을 집어 거짓 통과했다). */}
                  {u.status === 'error'
                    ? t('docs.up.failed', '실패')
                    : u.status === 'waiting'
                      ? t('docs.up.waiting', '재시도 대기')
                      : u.status === 'queued'
                        ? t('docs.up.queued', '대기 중')
                        : u.pct >= 0 ? `${u.pct}%` : t('docs.up.working', '전송 중')}
                </UpPct>
              </UpTop>
              <UpBar>
                <UpFill
                  $pct={u.status === 'error' ? 100 : Math.max(u.pct, 0)}
                  $err={u.status === 'error'}
                  $wait={u.status === 'waiting'}
                />
              </UpBar>
              <UpMeta>
                {u.status === 'error'
                  ? uploadErrorText(u.error, t, u.limitBytes)
                  : u.status === 'waiting'
                    ? t('docs.up.retryIn', '한 번에 올릴 수 있는 수를 넘었습니다 · {{s}}초 후 자동으로 이어서 올립니다', { s: waitSec ?? 0 })
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
const UpHead = styled.div`
  display:flex;align-items:center;gap:10px;flex-wrap:wrap;
  padding-bottom:8px;border-bottom:1px solid #F1F5F9;
`;
const UpHeadText = styled.div`
  flex:1;min-width:0;display:flex;align-items:center;gap:10px;flex-wrap:wrap;
  font-size:0.8125rem;font-weight:700;color:#0F172A;
`;
const UpHeadWait = styled.span`color:#B45309;`;
const UpTruncated = styled.div`
  font-size:0.78125rem;font-weight:700;color:#B45309;
  padding:6px 8px;background:#FFFBEB;border:1px solid #FDE68A;border-radius:8px;
`;
const UpHeadErr = styled.span`color:#DC2626;`;
const UpHeadBtns = styled.div`display:flex;align-items:center;gap:6px;flex-shrink:0;`;
const UpAct = styled.button<{ $primary?: boolean }>`
  height:32px;padding:0 12px;border-radius:8px;cursor:pointer;
  font-size:0.78125rem;font-weight:700;white-space:nowrap;
  border:1px solid ${(p) => (p.$primary ? 'transparent' : '#E2E8F0')};
  background:${(p) => (p.$primary ? '#0D9488' : '#fff')};
  color:${(p) => (p.$primary ? '#fff' : '#475569')};
  &:hover{background:${(p) => (p.$primary ? '#0F766E' : '#F8FAFC')};}
  &:focus-visible{outline:2px solid #0D9488;outline-offset:2px;}
  @media (max-width:640px){height:40px;}
`;
const UpRow = styled.div`display:flex;align-items:center;gap:10px;`;
const UpMain = styled.div`flex:1;min-width:0;display:flex;flex-direction:column;gap:4px;`;
const UpTop = styled.div`display:flex;align-items:baseline;gap:8px;`;
const UpName = styled.div`
  flex:1;min-width:0;font-size:0.8125rem;font-weight:600;color:#0F172A;
  overflow:hidden;text-overflow:ellipsis;white-space:nowrap;
`;
const UpPct = styled.div<{ $err: boolean; $wait?: boolean }>`
  font-size:0.78125rem;font-weight:700;flex-shrink:0;
  color:${(p) => (p.$err ? '#DC2626' : p.$wait ? '#B45309' : '#0F766E')};
`;
const UpBar = styled.div`height:6px;background:#F1F5F9;border-radius:999px;overflow:hidden;`;
const UpFill = styled.div<{ $pct: number; $err: boolean; $wait?: boolean }>`
  height:100%;width:${(p) => p.$pct}%;border-radius:999px;transition:width .2s ease;
  background:${(p) => (p.$err ? '#FCA5A5' : p.$wait ? '#FCD34D' : 'linear-gradient(90deg,#14B8A6,#0D9488)')};
`;
const UpMeta = styled.div`font-size:0.75rem;color:#64748B;`;
const UpCancel = styled.button`
  flex-shrink:0;display:inline-flex;align-items:center;justify-content:center;
  width:36px;height:36px;background:transparent;border:none;border-radius:8px;
  color:#94A3B8;cursor:pointer;
  &:hover{background:#F1F5F9;color:#DC2626;}
  &:focus-visible{outline:2px solid #0D9488;outline-offset:2px;}
  @media (max-width:1024px){width:2.5rem;height:2.5rem;}
`;
