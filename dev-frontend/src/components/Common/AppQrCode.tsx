// 앱 다운로드 QR — 데스크탑에서 보던 사람이 폰 카메라로 찍어 바로 /app 으로 가게 한다
//   (2026-10-12 Irene: "웹에서 쓰다가 앱 사용하고 싶을 때 주소 치고 안들어가고 바로 접속하게").
//   ★ 스토어 주소를 직접 담지 않는다 — /app 이 폰 종류를 가려 iOS·Android 로 알맞게 보낸다.
//     관리자가 스토어 주소를 바꿔도 이미 찍어 둔 QR 이 죽지 않는다.
//   주소는 지금 서버(origin) 기준 — dev 에서는 dev 주소가 담겨 그대로 시험할 수 있다.
//   쓰는 곳: 랜딩 /app(데스크탑) · 설정 > 알림 > 앱 설치(데스크탑). 라이브러리는 동적 import(CustomerEntrySection 과 같은 방식).
import { useEffect, useState } from 'react';
import styled from 'styled-components';

/** QR 이 담을 주소 — 영어 화면이면 /en/app. 랜딩·설정이 같은 함수를 쓴다. */
export function appDownloadUrl(en: boolean): string {
  const origin = typeof window !== 'undefined' ? window.location.origin : 'https://planq.kr';
  return `${origin}${en ? '/en/app' : '/app'}`;
}

interface Props { url: string; alt: string; size?: number; testId?: string; }

/** 만들지 못하면 아무것도 그리지 않는다 — 옆의 글자 주소만으로도 화면은 성립한다. */
export default function AppQrCode({ url, alt, size = 160, testId = 'app-qr' }: Props) {
  const [src, setSrc] = useState<string | null>(null);
  useEffect(() => {
    let alive = true;
    import('qrcode')
      .then(m => m.toDataURL(url, { margin: 1, width: size }))
      .then(d => { if (alive) setSrc(d); })
      .catch(() => { if (alive) setSrc(null); });
    return () => { alive = false; };
  }, [url, size]);
  if (!src) return null;
  return <Img src={src} alt={alt} width={size} height={size} data-testid={testId} data-qr-url={url} />;
}

const Img = styled.img`
  display: block; border-radius: 8px; border: 1px solid #E2E8F0; background: #FFFFFF;
`;
