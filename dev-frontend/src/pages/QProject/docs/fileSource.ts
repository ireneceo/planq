// 파일의 **출처** — 어디서 왔나(칩) vs 어디에 사나(칸).
//
// ★ 2026-09-20 에 DocsTab.tsx 에서 빼냈다(treeIcons·treeStyles·TreeRow·folderDrop·useFileOpen 과
//   같은 이유 — god-file 래칫). 세는 곳과 거르는 곳이 **같은 함수**를 쓰는 것이 핵심이라
//   한 파일에 모아 둔다.
import type { ProjectFile, FileSource } from '../../../services/files';

export function srcsOf(f: ProjectFile): FileSource[] {
  return (f.sources && f.sources.length) ? f.sources : [f.source];
}

/**
 * 이 파일이 **어느 칸에 사는가** — 칸은 서로 겹치지 않는다.
 *
 * ★ 2026-09-20 (Irene: *"전체가 26인데 직접 업로드 + 채팅, 업무, 회의, 문서 숫자가 왜 동일하지
 *   않지?"* → *"출처 숫자 제대로 너가 구성 못해? 겹침 원인 해결해."*) —
 *   채팅으로 파일을 올리면 `MessageAttachment` 와 `File` **양쪽에 행이 생긴다.** 목록은 한 줄로
 *   접으면서 출처를 둘 다 달았고, 세는 쪽도 둘 다 세서 **합이 전체보다 커졌다**
 *   (운영 K-DINE 실측: 126+9+6+1 = 142, 전체 133 — 차이 9).
 *
 *   「직접 업로드」는 Irene 의 정의대로 **«파일 메뉴에서 직접 올린 것»** 이다. 채팅에서 올라와
 *   File 행이 따라 생긴 것은 직접 올린 것이 아니다 → **다른 출처가 하나라도 있으면 그쪽이 집**이다.
 *   그래서 합이 전체와 정확히 같아진다.
 *
 *   ★ 출처 칩(행에 붙는 태그)은 **그대로 전부** 보여 준다 — 어디서 왔는지는 여러 개일 수 있다.
 *     칩은 «어디서 왔나», 칸은 «어디에 사나» 다. 세는 것과 거르는 것은 **이 함수 하나**를 쓴다.
 */
export const HOME_ORDER: FileSource[] = ['chat', 'task', 'meeting', 'post', 'mail'];
export function homeSrcOf(f: ProjectFile): FileSource {
  const all = srcsOf(f);
  for (const s of HOME_ORDER) if (all.includes(s)) return s;
  return 'direct';
}

export function sourceShortLabel(s: FileSource, t: (k: string, fb?: string) => string): string {
  if (s === 'chat') return t('docs.source.chat', '채팅');
  if (s === 'task') return t('docs.source.task', '업무');
  if (s === 'meeting') return t('docs.source.meeting', '회의');
  if (s === 'post') return t('docs.source.post', '문서');
  if (s === 'mail') return t('docs.source.mail', '메일');
  return t('docs.source.direct', '직접');
}


/** 출처 칩의 색 — 칩은 «어디서 왔나» 를 말한다(칸과 별개). */
export function srcStyle(s: FileSource): string {
  switch (s) {
    case 'chat':    return 'background:#E0F2FE;color:#075985;';
    case 'task':    return 'background:#FEF3C7;color:#92400E;';
    case 'meeting': return 'background:#F0FDFA;color:#6B21A8;';
    case 'mail':    return 'background:#EDE9FE;color:#5B21B6;';
    default:        return 'background:#F0FDFA;color:#0F766E;';
  }
}

