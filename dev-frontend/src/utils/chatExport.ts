// 카카오톡·왓츠앱 «대화 내보내기» 파일 알아보기 — 공유로 받은 파일이 대화 기록인지, 누구와의 대화인지.
//
// 대화를 메시지로 풀어 넣지 않는다(2026-10-11 Irene: «그냥 내보내기 기능만»). 알아본 것은 두 가지에만 쓴다:
//   ① 파일 이름을 사람이 읽을 수 있게 바꾼다 — 카톡 안드로이드는 «KakaoTalkChats.txt» 처럼 누구와의 대화인지 이름에 없다
//   ② 공유 화면이 «대화 기록으로 보관» 을 먼저 권한다
// 판정은 내용 머리줄이 먼저, 파일 이름이 다음이다(이름은 앱·기기·언어마다 다르다).

export type ChatExportApp = 'kakao' | 'whatsapp';
export interface ChatExportInfo { app: ChatExportApp; room: string | null; index: number; }

const HEAD_BYTES = 4096;

const KAKAO_HEAD = /^﻿?\s*(.+?)\s*님과 카카오톡 대화/;
const KAKAO_HEAD_EN = /^﻿?\s*(?:Talk|Chat) with\s+(.+?)\s*$/m;
const KAKAO_SAVED = /(저장한 날짜|Date Saved)\s*:/;
const KAKAO_NAME = /^(KakaoTalk|Talk_|카카오톡)/i;
// 왓츠앱 한 줄: «11/10/26, 14:22 - 이름: 글» (안드로이드) · «[11/10/26, 14:22:10] 이름: 글» (아이폰)
const WA_LINE = /^‎?\[?\d{1,4}[./-]\d{1,2}[./-]\d{1,4},?\s+\d{1,2}:\d{2}(?::\d{2})?\s*(?:[AaPp]\.?\s?[Mm]\.?|오전|오후)?\]?\s*(?:-\s*)?[^:]{1,80}:\s/m;
const WA_NAME = /^WhatsApp\s+(?:Chat|채팅|대화)(?:\s+(?:with|내용))?\s*[-–:]?\s*(.*?)\s*\.(txt|zip)$/i;
const WA_INNER = /^_chat\.txt$/i;

function cleanRoom(s: string | null | undefined): string | null {
  const v = (s || '').replace(/[\\/:*?"<>|\u0000-\u001f]/g, ' ').replace(/\s+/g, ' ').trim();
  return v ? v.slice(0, 60) : null;
}

async function head(f: File): Promise<string> {
  if (!/\.txt$/i.test(f.name) && !/^text\//.test(f.type)) return '';
  try { return await f.slice(0, HEAD_BYTES).text(); } catch { return ''; }
}

/** 받은 파일 중 대화 내보내기 파일을 찾는다. 없으면 null. subject = 공유가 함께 보낸 제목(왓츠앱 «WhatsApp Chat with X»). */
export async function detectChatExport(files: File[], subject = ''): Promise<ChatExportInfo | null> {
  for (let i = 0; i < files.length; i++) {
    const f = files[i];
    const text = await head(f);
    const k = text.match(KAKAO_HEAD);
    if (k) return { app: 'kakao', room: cleanRoom(k[1]), index: i };
    if (text && KAKAO_SAVED.test(text.slice(0, 400))) {
      const ke = text.match(KAKAO_HEAD_EN);
      return { app: 'kakao', room: cleanRoom(ke?.[1]), index: i };
    }
    const wn = f.name.match(WA_NAME);
    if (wn) return { app: 'whatsapp', room: cleanRoom(wn[1]) || roomFromSubject(subject), index: i };
    if (text && WA_LINE.test(text)) return { app: 'whatsapp', room: roomFromSubject(subject), index: i };
    if (WA_INNER.test(f.name)) return { app: 'whatsapp', room: roomFromSubject(subject), index: i };
    if (KAKAO_NAME.test(f.name) && /\.(txt|zip|csv)$/i.test(f.name)) return { app: 'kakao', room: null, index: i };
  }
  return null;
}

function roomFromSubject(subject: string): string | null {
  const m = subject.match(/WhatsApp\s+(?:Chat|채팅|대화)(?:\s+(?:with|내용))?\s*[-–:]?\s*(.+)$/i);
  return cleanRoom(m?.[1]);
}

/** «카카오톡 대화 - 홍길동 - 2026-10-11.txt». label = 앱 이름이 들어간 화면 문구(i18n). */
export function chatExportFileName(original: string, label: string, room: string | null, now = new Date()): string {
  const ext = (original.match(/\.([A-Za-z0-9]{1,5})$/)?.[1] || 'txt').toLowerCase();
  const d = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;
  return [label, room, d].filter(Boolean).join(' - ') + `.${ext}`;
}
