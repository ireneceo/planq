// Blob 다운로드 — 웹/네이티브 분기 (MOBILE_APP_DESIGN §6.3).
//   웹: 기존 a[download] 클릭 (동작 무변경).
//   네이티브(WebView): a[download] 미동작 → Filesystem(Cache) 저장 후 Share(iOS 공유시트/Android 공유).
//   @capacitor/filesystem·share 는 dynamic import — 웹 번들 eager 로드 X.
//
// async 이지만 웹 경로는 await 이 없어 동기 실행 → 동기 호출부(예: csvUtils.downloadCsv)는 await 없이 호출 가능.
import { isNativeApp } from '../services/native';

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

async function nativeSaveShare(blob: Blob, filename: string): Promise<void> {
  try {
    const [{ Filesystem, Directory }, { Share }] = await Promise.all([
      import('@capacitor/filesystem'),
      import('@capacitor/share'),
    ]);
    const base64 = await blobToBase64(blob);
    const res = await Filesystem.writeFile({ path: filename, data: base64, directory: Directory.Cache });
    await Share.share({ title: filename, url: res.uri }).catch(() => { /* 사용자 취소 등 무시 */ });
  } catch (e) {
    console.error('[download] native save/share failed', e);
  }
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
