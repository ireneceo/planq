import type { FileSource } from '../../../services/files';

// 폴더 선택 상태: 'all' = 전체 | 'direct' = 직접 업로드 루트 | `src:chat` etc | number = 사용자 폴더 id
// 워크스페이스 모드: 'all' | `proj:${projectId}` | `src:...`
export type FolderSel = 'all' | 'direct' | 'my' | `src:${FileSource}` | `proj:${number}` | number;
