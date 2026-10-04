// 인증이 필요한 파일 다운로드 — 상태·진행률·오류를 한 곳에서 (운영 신고 2026-08-31, Irene)
//
// 두 가지를 동시에 고친다:
//  ① `<a href download>` 로 만든 다운로드는 **항상 401** 이었다(라우트가 Bearer 헤더를 요구).
//     받는 일은 utils/download 의 downloadFromApi 가 한다 — 화면마다 다시 짜지 않는다.
//  ② 큰 파일은 오래 걸리는데 아무 표시가 없어 사용자가 고장으로 읽었다
//     (Irene: "기다려야 하는 거 알게 해줘야돼. 기능이 안되는 줄 알아").
//     그래서 진행 문구를 여기서 만들어 준다 — 문구 규칙이 화면마다 갈라지지 않게.
import { useCallback, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { downloadFromApi, type DownloadProgress } from '../utils/download';
import { progressPercent, humanBytes } from '../services/downloadManager';

export function useFileDownload() {
  const { t } = useTranslation('common');
  const [downloadingId, setDownloadingId] = useState<string | null>(null);
  const [progress, setProgress] = useState<DownloadProgress | null>(null);
  // ★ 2026-10-04 — 실패는 우측 하단 트레이가 문구 + [다시 시도] 로 말한다(services/downloadManager).
  //   여기서도 띄우면 같은 실패가 두 군데에 나온다. 필드는 호출부 호환을 위해 남긴다(언제나 null).
  const [error] = useState<string | null>(null);
  const busy = useRef(false);

  const start = useCallback(async (url: string, filename: string, id?: string) => {
    if (busy.current) return;              // 중복 제출 가드 (UI_DESIGN_GUIDE §1.8)
    busy.current = true;
    setDownloadingId(id ?? url);
    setProgress(null);
    try {
      await downloadFromApi(url, filename, { onProgress: setProgress });
    } catch {
      /* 트레이가 실패를 보여 준다 */
    } finally {
      busy.current = false;
      setDownloadingId(null);
      setProgress(null);
    }
  }, []);

  /** 진행 문구 — 전체 크기를 알면 퍼센트, 모르면 받은 양. 시작 직후엔 "받는 중…". */
  const progressText = !progress
    ? (downloadingId ? (t('download.preparing', { defaultValue: '받는 중…' }) as string) : null)
    : (progressPercent(progress.received, progress.total) !== null
      ? `${progressPercent(progress.received, progress.total)}%`   // 트레이와 같은 공식
      : humanBytes(progress.received));

  return {
    /** 다운로드 시작 */
    start,
    /** 지금 받고 있는 항목 id (없으면 null) */
    downloadingId,
    /** 받는 중인지 */
    downloading: downloadingId !== null,
    /** "받는 중…" / "43%" / "2.1MB" */
    progressText,
    /** 사용자 언어 오류 문구 — 조용히 실패하지 않게 화면이 반드시 보여줄 것 */
    error,
    clearError: () => { /* 실패는 트레이가 다룬다 */ },
  };
}
