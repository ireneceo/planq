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
