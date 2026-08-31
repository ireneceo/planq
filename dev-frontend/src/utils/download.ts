// Blob 다운로드 — 웹/네이티브 분기 (MOBILE_APP_DESIGN §6.3).
//   웹: 기존 a[download] 클릭 (동작 무변경).
//   네이티브(WebView): a[download] 미동작 → Filesystem(Cache) 저장 후 Share(iOS 공유시트/Android 공유).
//   @capacitor/filesystem·share 는 dynamic import — 웹 번들 eager 로드 X.
//
// async 이지만 웹 경로는 await 이 없어 동기 실행 → 동기 호출부(예: csvUtils.downloadCsv)는 await 없이 호출 가능.
import { isNativeApp } from '../services/native';
// 컴포넌트가 아니라 훅을 못 쓴다 — 기존 패턴대로 i18n 인스턴스를 직접 쓴다
// (contexts/AuthContext · pages/QTalk 등과 동일).
import i18n from '../i18n';

export async function downloadBlob(blob: Blob, filename: string): Promise<void> {
  if (isNativeApp()) { await nativeSaveShare(blob, filename); return; }
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

// ★ 운영 (Irene 2026-08-28): "문서 상단에 다운로드 워드다운로드 등등 아이콘들 작동 안하는데"
//   옛 구현은 여기서 모든 실패를 `console.error` 로 삼켰다. 그래서 플러그인 누락·권한 거부·용량 등
//   무엇이 잘못돼도 **화면에는 아무 일도 안 일어난다.** 사용자는 "버튼이 죽었다" 로만 읽고,
//   우리는 원인을 영영 못 듣는다. 실패는 던져서 호출부가 말하게 한다
//   (PostsPage 의 PDF·워드 핸들러는 이미 catch → setError 로 문구를 띄운다).
//   ★ 공유 시트 '취소' 만은 실패가 아니다 — 파일은 이미 저장됐고 사용자가 스스로 닫은 것이다.
async function nativeSaveShare(blob: Blob, filename: string): Promise<void> {
  let Filesystem, Directory, Share;
  try {
    const mods = await Promise.all([import('@capacitor/filesystem'), import('@capacitor/share')]);
    ({ Filesystem, Directory } = mods[0]);
    ({ Share } = mods[1]);
  } catch (e) {
    console.error('[download] capacitor 플러그인 로드 실패', e);
    throw new Error(i18n.t('common:download.pluginMissing', { defaultValue: '이 앱 버전에서는 파일 저장을 지원하지 않습니다. 앱을 업데이트해 주세요.' }) as string);
  }
  let uri: string;
  try {
    const base64 = await blobToBase64(blob);
    const res = await Filesystem.writeFile({ path: filename, data: base64, directory: Directory.Cache });
    uri = res.uri;
  } catch (e) {
    console.error('[download] 파일 저장 실패', e);
    throw new Error(i18n.t('common:download.saveFailed', { defaultValue: '파일을 저장하지 못했습니다. 기기 저장공간을 확인해 주세요.' }) as string);
  }
  // 공유 시트 취소는 정상 흐름 — 파일은 이미 저장돼 있다.
  await Share.share({ title: filename, url: uri }).catch((e: unknown) => {
    console.warn('[download] share 시트 종료(취소 포함)', e);
  });
}

function blobToBase64(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onerror = () => reject(r.error);
    r.onload = () => {
      const s = String(r.result || '');
      // data:<mime>;base64,<payload> → payload 만
      resolve(s.includes(',') ? s.slice(s.indexOf(',') + 1) : s);
    };
    r.readAsDataURL(blob);
  });
}

// ─────────────────────────────────────────────────────────────────────────────
// 인증이 필요한 API 에서 파일 받기 (운영 신고 2026-08-31, Irene)
//
// 왜 이게 필요한가 — `<a href="/api/files/.../download" download>` 는 **항상 실패한다.**
//   그 라우트는 `authenticateToken` 이라 Authorization 헤더를 요구하는데, 브라우저가 링크를
//   따라갈 때는 쿠키만 보내고 헤더는 못 붙인다. 실측: 헤더 없이 401 / Bearer 붙이면 200.
//   즉 "가끔 안 되는" 게 아니라 **링크로 만든 다운로드는 100% 죽어 있었다.**
//   (공개 공유 페이지는 이미 공개 라우트로 우회해 두었는데, 로그인한 화면들만 그대로였다.)
//
// 그리고 큰 파일은 시간이 걸린다. 아무 표시가 없으면 사용자는 기능이 고장 난 것으로 읽는다
//   (Irene: "기다려야 하는 거 알게 해줘야돼. 기능이 안되는 줄 알아").
//   그래서 진행 상황을 호출부로 흘려보낸다 — 총 크기를 모르면(streaming/gzip) 받은 바이트만 준다.
export interface DownloadProgress {
  /** 지금까지 받은 바이트 */
  received: number;
  /** 전체 바이트 — Content-Length 가 없으면 null (진행률 대신 받은 양만 보여줄 것) */
  total: number | null;
}

export async function downloadFromApi(
  url: string,
  filename: string,
  opts?: { onProgress?: (p: DownloadProgress) => void; signal?: AbortSignal },
): Promise<void> {
  const { apiFetch } = await import('../contexts/AuthContext');
  const res = await apiFetch(url, opts?.signal ? { signal: opts.signal } : {});
  // apiFetch 는 throw 하지 않는다 — res.ok 를 반드시 본다 (memory: apifetch_no_throw)
  if (!res.ok) {
    let msg = '';
    try { msg = (await res.clone().json())?.message || ''; } catch { /* 본문이 파일이거나 비어있음 */ }
    throw new Error(msg || `HTTP ${res.status}`);
  }

  const lenHeader = res.headers.get('content-length');
  const total = lenHeader ? Number(lenHeader) : null;
  let blob: Blob;
  // 진행 표시를 원하고 스트림을 읽을 수 있을 때만 조각내어 읽는다.
  //   못 읽는 환경(구형 브라우저·프록시)에서는 통째로 받는다 — 기능이 먼저다.
  if (opts?.onProgress && res.body && typeof res.body.getReader === 'function') {
    const reader = res.body.getReader();
    const chunks: BlobPart[] = [];
    let received = 0;
    opts.onProgress({ received: 0, total: Number.isFinite(total as number) ? total : null });
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      if (value) {
        chunks.push(value as unknown as BlobPart);
        received += value.byteLength;
        opts.onProgress({ received, total: Number.isFinite(total as number) ? total : null });
      }
    }
    blob = new Blob(chunks, { type: res.headers.get('content-type') || 'application/octet-stream' });
  } else {
    blob = await res.blob();
  }
  await downloadBlob(blob, filename);
}

/** 인증이 필요한 URL → 화면에 바로 쓸 수 있는 blob URL (PDF·이미지 미리보기용).
 *  ★ 다 쓰면 반드시 revoke 해야 한다 — 호출부의 cleanup 에서 URL.revokeObjectURL 을 부를 것. */
export async function objectUrlFromApi(url: string, signal?: AbortSignal): Promise<string> {
  const { apiFetch } = await import('../contexts/AuthContext');
  const res = await apiFetch(url, signal ? { signal } : {});
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return URL.createObjectURL(await res.blob());
}
