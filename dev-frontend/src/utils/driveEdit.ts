// Drive 편집기 열기 — **단일 원천**.
//
// 왜 여기 있는가: 같은 절차(빈 탭 먼저 열기 → 인증 fetch → 받은 링크로 이동)를 Q File 이
//   자기 화면 안에 갖고 있었고, 채팅·업무 첨부 미리보기에서도 같은 것이 필요해졌다.
//   베끼면 반드시 갈라진다(팝업 차단 처리·실패 문구·중복 클릭) → 한 함수로 뺀다.
//
// ★ 빈 탭을 **먼저** 여는 이유: 사용자 클릭과 window.open 사이에 await 가 끼면
//   브라우저가 팝업으로 보고 막는다. 먼저 열어 두고 주소만 나중에 채운다.
import { apiFetch } from '../contexts/AuthContext';

export type DriveEditResult =
  | { ok: true; accessReason: string | null }
  | { ok: false; reason: 'failed' | 'not_a_drive_file' };

export async function openDriveEditor(businessId: number | string, fileId: number | string): Promise<DriveEditResult> {
  const w = window.open('', '_blank', 'noopener,noreferrer');
  try {
    const r = await apiFetch(`/api/files/${businessId}/${fileId}/drive-edit`, { method: 'POST' });
    const j = await r.json().catch(() => ({}));
    // apiFetch 는 throw 하지 않는다 — 상태를 직접 본다.
    if (!r.ok || !j?.data?.edit_url) {
      if (w) w.close();
      const msg = String(j?.message || '');
      return { ok: false, reason: msg.includes('not_a_drive_file') ? 'not_a_drive_file' : 'failed' };
    }
    if (w) w.location.href = j.data.edit_url;
    else window.open(j.data.edit_url, '_blank', 'noopener,noreferrer');
    return { ok: true, accessReason: j.data.access_reason || null };
  } catch {
    if (w) w.close();
    return { ok: false, reason: 'failed' };
  }
}
