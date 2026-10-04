// 다운로드 매니저 — 첨부 내려받기는 **한 문**으로 들어오고, 진행은 **한 곳(DownloadTray)** 에서 보인다 (2026-10-04).
//
// Irene: *"파일 첨부된 거 다운로드들이 너무 느려. 속도 좀 빠르게 하고 다운로드 중인 거 %나 어느 정도
//   되었는지 다 보이게 해줘. 다 제대로."*
//
// 여태 진행률은 useFileDownload 를 쓰는 3곳(파일·문서·Q info)뿐이었고, 업무 첨부·채팅·메일·이미지 보기·
// 전체 다운로드(zip)는 fetch → blob 으로 **다 받을 때까지 아무 표시가 없었다.** 사용자는 «눌러도 안 된다»
// 로 읽는다. 화면마다 진행 표시를 붙이면 자리마다 숫자·모양이 갈라지므로, 받는 일 자체를 여기 하나로 모으고
// 우측 하단 트레이가 그 상태를 그린다. 버튼 옆 % 를 그리는 화면(useFileDownload)도 **같은 이벤트**를 받으므로
// 두 숫자가 달라질 수 없다(`progressPercent` 한 공식).
//
// 계약:
//   · 같은 요청이 이미 받는 중이면 새로 받지 않고 그 약속을 돌려준다(중복 클릭).
//   · 취소는 실패가 아니다 — 조용히 끝난다(호출부에 throw 하지 않는다).
//   · 실패는 트레이가 문구 + [다시 시도] 로 말한다. 호출부의 await 는 throw 로 실패를 받는다(기존 계약).
//   · 끝나면 트레이에서 몇 초 뒤 **조용히** 사라진다 — 성공 토스트가 아니다(진행 중 표시가 끝난 것뿐).
//   · 네이티브 앱은 받은 뒤 기기에 저장하는 단계가 따로 있다 — 그 동안은 «저장 중» 으로 보인다.
import { downloadBlob } from '../utils/download';

export type DownloadPhase = 'running' | 'saving' | 'done' | 'error';

export interface DownloadItem {
  id: string;
  name: string;
  received: number;
  /** 전체 바이트 — 모르면 null(받은 양만 보인다) */
  total: number | null;
  phase: DownloadPhase;
  error?: string;
  startedAt: number;
}

export interface DownloadRequest {
  url: string;
  filename: string;
  /** fetch 옵션(POST 묶음 다운로드 등) */
  init?: RequestInit;
  /** 인증 헤더를 붙일지 — 기본 true(apiFetch). 공개 이미지 주소는 false */
  auth?: boolean;
  /** 화면이 자기 버튼 옆에 같은 숫자를 그리고 싶을 때 */
  onProgress?: (p: { received: number; total: number | null }) => void;
  /** 화면이 따로 끊고 싶을 때(언마운트 등) */
  signal?: AbortSignal;
  /** 실패를 트레이에 남기지 않는다 — 호출부가 대체 경로로 스스로 처리할 때만(이미지 보기의 새 탭 폴백) */
  quietError?: boolean;
}

type Listener = (items: DownloadItem[]) => void;

const DONE_LINGER_MS = 2500;
let seq = 0;
let items: DownloadItem[] = [];
const listeners = new Set<Listener>();
const controllers = new Map<string, AbortController>();
const requests = new Map<string, DownloadRequest>();
const inflight = new Map<string, Promise<void>>();   // 요청 키 → 진행 중 약속
const keyOfId = new Map<string, string>();

function emit() {
  const snap = items.slice();
  listeners.forEach((l) => { try { l(snap); } catch { /* 구독자 오류가 다운로드를 막지 않게 */ } });
}

function patch(id: string, p: Partial<DownloadItem>) {
  items = items.map((it) => (it.id === id ? { ...it, ...p } : it));
  emit();
}

function remove(id: string) {
  items = items.filter((it) => it.id !== id);
  controllers.delete(id);
  requests.delete(id);
  // inflight 은 건드리지 않는다 — 같은 요청이 새로 시작됐을 수 있다(약속은 run 의 finally 가 푼다).
  keyOfId.delete(id);
  emit();
}

export function subscribeDownloads(l: Listener): () => void {
  listeners.add(l);
  l(items.slice());
  return () => { listeners.delete(l); };
}

export function getDownloads(): DownloadItem[] { return items.slice(); }

/** 퍼센트 — 전체를 알 때만. 끝나기 전엔 99 를 넘지 않는다(저장이 남았을 수 있다). 트레이·버튼이 같은 공식. */
export function progressPercent(received: number, total: number | null): number | null {
  if (!total || total <= 0) return null;
  return Math.min(99, Math.floor((received / total) * 100));
}

export function humanBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes}B`;
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)}KB`;
  if (bytes < 1024 * 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)}MB`;
  return `${(bytes / (1024 * 1024 * 1024)).toFixed(2)}GB`;
}

function requestKey(r: DownloadRequest): string {
  const body = r.init && typeof r.init.body === 'string' ? r.init.body : '';
  return `${String(r.init?.method || 'GET').toUpperCase()} ${r.url} ${body}`;
}

function isAbort(e: unknown): boolean {
  return !!e && typeof e === 'object' && (e as { name?: string }).name === 'AbortError';
}

async function errorMessageOf(res: Response): Promise<string> {
  try {
    const j = await res.clone().json();
    if (j && typeof j.message === 'string' && j.message) return j.message;
  } catch { /* 본문이 파일이거나 비어 있음 */ }
  return `HTTP ${res.status}`;
}

async function run(id: string, req: DownloadRequest): Promise<void> {
  const ac = new AbortController();
  controllers.set(id, ac);
  const onOuterAbort = () => ac.abort();
  if (req.signal) {
    if (req.signal.aborted) ac.abort();
    else req.signal.addEventListener('abort', onOuterAbort, { once: true });
  }
  try {
    let res: Response;
    const init: RequestInit = { ...(req.init || {}), signal: ac.signal };
    if (req.auth === false) {
      res = await fetch(req.url, { ...init, credentials: 'include' });
    } else {
      const { apiFetch } = await import('../contexts/AuthContext');
      res = await apiFetch(req.url, init);
    }
    // apiFetch 는 throw 하지 않는다 — res.ok 를 반드시 본다
    if (!res.ok) throw new Error(await errorMessageOf(res));

    const lenHeader = res.headers.get('content-length');
    const lenNum = lenHeader ? Number(lenHeader) : NaN;
    // gzip 등으로 압축돼 온 응답은 Content-Length 가 압축 크기다 — 그때는 %를 내지 않는다(틀린 % 금지).
    const encoded = !!res.headers.get('content-encoding');
    const total = Number.isFinite(lenNum) && lenNum > 0 && !encoded ? lenNum : null;
    patch(id, { total, received: 0 });
    req.onProgress?.({ received: 0, total });

    let blob: Blob;
    if (res.body && typeof res.body.getReader === 'function') {
      const reader = res.body.getReader();
      const chunks: BlobPart[] = [];
      let received = 0;
      let lastEmit = 0;
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        if (value) {
          chunks.push(value as unknown as BlobPart);
          received += value.byteLength;
          // 조각마다 다시 그리면 큰 파일에서 화면이 문다 — 100ms 에 한 번(끝은 아래에서 따로).
          const now = Date.now();
          if (now - lastEmit > 100) {
            lastEmit = now;
            patch(id, { received });
            req.onProgress?.({ received, total });
          }
        }
      }
      patch(id, { received });
      req.onProgress?.({ received, total });
      blob = new Blob(chunks, { type: res.headers.get('content-type') || 'application/octet-stream' });
    } else {
      blob = await res.blob();
      patch(id, { received: blob.size });
    }
    if (ac.signal.aborted) throw Object.assign(new Error('aborted'), { name: 'AbortError' });
    patch(id, { phase: 'saving' });
    await downloadBlob(blob, req.filename);
    patch(id, { phase: 'done' });
    setTimeout(() => remove(id), DONE_LINGER_MS);
  } catch (e) {
    if (isAbort(e) || ac.signal.aborted) { remove(id); return; }
    if (req.quietError) { remove(id); throw e; }
    const msg = e instanceof Error ? e.message : String(e);
    patch(id, { phase: 'error', error: msg });
    throw e;
  } finally {
    controllers.delete(id);
    if (req.signal) req.signal.removeEventListener('abort', onOuterAbort);
  }
}

/**
 * 내려받기 시작 — 트레이에 나타나고, 받은 뒤 저장(웹: a[download] / 앱: 공유 시트)까지 한다.
 * 실패하면 throw(호출부 기존 계약), 사용자 취소면 조용히 resolve.
 */
export function startDownload(req: DownloadRequest): Promise<void> {
  const key = requestKey(req);
  const running = inflight.get(key);
  if (running) return running;
  // 같은 요청이 실패한 채 트레이에 남아 있으면 그 줄을 다시 쓴다(줄이 쌓이지 않게).
  const stale = items.find((it) => keyOfId.get(it.id) === key && it.phase === 'error');
  if (stale) remove(stale.id);
  seq += 1;
  const id = `dl-${Date.now()}-${seq}`;
  items = [...items, { id, name: req.filename, received: 0, total: null, phase: 'running', startedAt: Date.now() }];
  requests.set(id, req);
  keyOfId.set(id, key);
  emit();
  const p = run(id, req).finally(() => {
    // 실패한 줄은 트레이에 남는다(다시 시도). 약속만 풀어 같은 요청을 새로 받을 수 있게 한다.
    if (inflight.get(key) === p) inflight.delete(key);
  });
  inflight.set(key, p);
  return p;
}

export function cancelDownload(id: string) {
  const ac = controllers.get(id);
  if (ac) ac.abort();
  else remove(id);
}

/** 트레이의 [다시 시도] — 같은 요청을 처음부터. 화면 쪽 onProgress 는 이미 끝났으므로 싣지 않는다. */
export function retryDownload(id: string) {
  const req = requests.get(id);
  remove(id);
  if (!req) return;
  startDownload({ url: req.url, filename: req.filename, init: req.init, auth: req.auth }).catch(() => { /* 트레이가 말한다 */ });
}

export function dismissDownload(id: string) { remove(id); }
