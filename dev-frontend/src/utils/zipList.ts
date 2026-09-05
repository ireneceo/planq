// zip 안에 무엇이 들었는지 **목록만** 읽는다 (압축 해제 없음, 의존성 없음).
//
//   Irene 2026-08-31: "미리보기 왠만한 파일 다 되게" — 운영 파일 중 zip 이 60건인데
//   여태 전부 "다운로드 후 확인" 으로 떨어졌다. 안에 뭐가 들었는지도 못 봤다.
//
//   중앙 디렉터리(Central Directory)만 파싱한다. 파일 내용은 건드리지 않으므로
//   압축 해제 라이브러리가 필요 없고, 안에 든 것이 무엇이든 실행되지 않는다.
//   구조: [파일 데이터…][중앙 디렉터리…][EOCD]  — 뒤에서부터 EOCD 를 찾아 들어간다.

export type ZipEntry = {
  name: string;
  dir: boolean;
  size: number;          // 원본 크기
  compressed: number;
};

export type ZipListResult =
  | { ok: true; entries: ZipEntry[]; truncated: boolean }
  | { ok: false; reason: 'not_zip' | 'zip64' | 'corrupt' };

const EOCD_SIG = 0x06054b50;
const CEN_SIG = 0x02014b50;
/** 목록에 실을 최대 항목 수 — 수만 개짜리 zip 이 화면을 잠그지 않게. */
const MAX_ENTRIES = 500;

/**
 * ★ 이름 인코딩: 플래그 11번 비트가 서면 UTF-8, 아니면 옛 윈도우 zip 이라 CP949 일 때가 많다.
 *   UTF-8 로 우겨 읽으면 한글 파일명이 전부 깨진다(사용자에겐 "안 되는 것" 과 같다).
 */
function decodeName(bytes: Uint8Array, utf8: boolean): string {
  if (utf8) return new TextDecoder('utf-8').decode(bytes);
  try {
    // euc-kr 은 CP949 를 포함한다. 브라우저 내장 디코더라 별도 의존성이 없다.
    const s = new TextDecoder('euc-kr', { fatal: false }).decode(bytes);
    if (s && !s.includes('�')) return s;
  } catch { /* 디코더가 없으면 아래로 */ }
  return new TextDecoder('utf-8', { fatal: false }).decode(bytes);
}

export function listZip(buf: ArrayBuffer): ZipListResult {
  const view = new DataView(buf);
  const bytes = new Uint8Array(buf);
  if (buf.byteLength < 22) return { ok: false, reason: 'not_zip' };

  // EOCD 를 뒤에서 찾는다 (zip 주석은 최대 65535 바이트).
  let eocd = -1;
  const from = Math.max(0, buf.byteLength - 22 - 65535);
  for (let i = buf.byteLength - 22; i >= from; i--) {
    if (view.getUint32(i, true) === EOCD_SIG) { eocd = i; break; }
  }
  if (eocd < 0) return { ok: false, reason: 'not_zip' };

  const total = view.getUint16(eocd + 10, true);
  const cdSize = view.getUint32(eocd + 12, true);
  const cdOffset = view.getUint32(eocd + 16, true);
  // zip64 는 이 자리에 0xFFFF/0xFFFFFFFF 를 넣는다 — 읽을 수 없다고 정직하게 말한다.
  if (total === 0xFFFF || cdSize === 0xFFFFFFFF || cdOffset === 0xFFFFFFFF) return { ok: false, reason: 'zip64' };
  if (cdOffset + cdSize > buf.byteLength) return { ok: false, reason: 'corrupt' };

  const entries: ZipEntry[] = [];
  let p = cdOffset;
  for (let i = 0; i < total; i++) {
    if (p + 46 > buf.byteLength) return { ok: false, reason: 'corrupt' };
    if (view.getUint32(p, true) !== CEN_SIG) return { ok: false, reason: 'corrupt' };
    const flag = view.getUint16(p + 8, true);
    const compressed = view.getUint32(p + 20, true);
    const size = view.getUint32(p + 24, true);
    const nameLen = view.getUint16(p + 28, true);
    const extraLen = view.getUint16(p + 30, true);
    const commentLen = view.getUint16(p + 32, true);
    const name = decodeName(bytes.subarray(p + 46, p + 46 + nameLen), (flag & 0x0800) !== 0);
    if (entries.length < MAX_ENTRIES) {
      entries.push({ name, dir: name.endsWith('/'), size, compressed });
    }
    p += 46 + nameLen + extraLen + commentLen;
  }
  return { ok: true, entries, truncated: total > entries.length };
}
