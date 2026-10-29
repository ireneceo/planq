// Q file·프로젝트>파일 «Google Drive 에서 가져오기» (2026-10-29, Irene: *"업로드할 때도 구글문서에서 가져와서
//   넣기도 파일첨부처럼 넣을 수 없어?"*). DocsTab 은 god-file 래칫에 동결돼 있어 창은 여기 둔다(useFolderShare 와 같은 모양).
//
// ★ 가져오는 부품은 새로 그리지 않는다 — 첨부의 `DriveImportSection`(목록 + Google Picker · 구글 문서는 docx/xlsx/pptx)
//   그대로다. 서버도 같은 문(`POST /api/drive/import`)이다.
// ★ **업로드와 같은 자리·같은 공개 범위** — 목적지 판정은 DocsTab `handleFiles` 의 분기와 같다:
//   개인 보관함·«내 파일» = 나만 보기(L1) · 프로젝트 폴더 = 그 프로젝트(L2) · 프로젝트 없는 폴더 = 그 폴더·L1 ·
//   워크스페이스 전체 보기 = 업로드처럼 «어느 프로젝트에» 먼저 고른다. 업로드는 «내 파일» 이 나만 보기인데 가져오기만
//   워크스페이스 전체(L3)로 들어가면 같은 자리에 넣은 파일의 범위가 갈린다 — 서버는 `vlevel:'L1'` 로 좁히기만 받는다.
// ★ 같은 이름 덮어쓰기 묻기(resolveDuplicates)는 타지 않는다 — 그건 업로드 직전 로컬 파일 이름으로 묻는 것이고,
//   가져오기는 서버가 이름을 정한다(구글 문서는 확장자가 붙는다). 같은 Drive 파일을 같은 자리에 두 번 가져오면
//   서버가 기존 행을 돌려준다(matchPlacement) — 두 벌이 생기지 않는다.
import { useCallback, useRef, useState } from 'react';
import styled from 'styled-components';
import { useTranslation } from 'react-i18next';
import DriveImportSection from '../../../components/Common/DriveImportSection';
import { useEscapeStack } from '../../../hooks/useEscapeStack';
import { useFocusTrap } from '../../../hooks/useFocusTrap';
import { useBodyScrollLock } from '../../../hooks/useBodyScrollLock';
import type { FileFolder } from '../../../services/files';
import type { FolderSel } from './folderSel';
import { Modal, Dialog, DTitle, DBody, DFooter, SecondaryBtn } from './dialogStyles';

interface ProjectOpt { id: number; name: string; color?: string | null }

interface Args {
  enabled: boolean;
  businessId: number;
  mode: 'project' | 'workspace' | 'personal';
  projectId: number;          // 프로젝트 모드일 때만 의미
  projectName?: string;
  folderSel: FolderSel;
  folders: FileFolder[];
  projectGroups: ProjectOpt[];
  /** 한 건 들여올 때마다 — 목록을 다시 읽는다(DocsTab reload). */
  onImported: () => void;
}

/** 목적지 — 업로드(handleFiles)와 같은 분기. null = 아직 프로젝트를 안 골랐다. */
interface Dest { projectId: number | null; folderId: number | null; mine: boolean }

function destOf(a: Args): Dest | null {
  const sel = a.folderSel;
  if (a.mode === 'personal') return { projectId: null, folderId: null, mine: true };
  if (a.mode === 'project') return { projectId: a.projectId, folderId: typeof sel === 'number' ? sel : null, mine: false };
  if (sel === 'my') return { projectId: null, folderId: null, mine: true };
  if (typeof sel === 'number') {
    const fp = a.folders.find(f => f.id === sel)?.project_id ?? null;
    return fp ? { projectId: fp, folderId: sel, mine: false } : { projectId: null, folderId: sel, mine: true };
  }
  return null;
}

export function useDriveImport(a: Args) {
  const { t } = useTranslation('qproject');
  const [open, setOpen] = useState(false);
  const [picked, setPicked] = useState<number | null>(null);
  const ref = useRef<HTMLDivElement>(null);
  const close = useCallback(() => { setOpen(false); setPicked(null); }, []);
  useEscapeStack(open, close);
  useFocusTrap(ref, open);
  useBodyScrollLock(open);

  const fixed = destOf(a);
  // 프로젝트 줄(proj:N)을 보고 있었으면 그 프로젝트를 미리 골라 둔다 — 고르는 창은 업로드와 같다.
  const preset = typeof a.folderSel === 'string' && a.folderSel.startsWith('proj:') ? Number(a.folderSel.slice(5)) : null;
  const chosen = picked ?? preset;
  const dest: Dest | null = fixed ?? (chosen ? { projectId: chosen, folderId: null, mine: false } : null);

  const folderName = dest?.folderId ? a.folders.find(f => f.id === dest.folderId)?.name : null;
  const projName = dest?.projectId
    ? (a.mode === 'project' ? a.projectName : a.projectGroups.find(p => p.id === dest.projectId)?.name) ?? null
    : null;
  const where = dest
    ? (dest.mine
      ? (folderName ? t('docs.driveImport.destMineFolder', { folder: folderName }) : t('docs.driveImport.destMine'))
      : (folderName
        ? t('docs.driveImport.destProjectFolder', { project: projName || '', folder: folderName })
        : t('docs.driveImport.destProject', { project: projName || '' })))
    : '';

  const driveImportModal = open ? (
    <Modal onMouseDown={e => { if (e.target === e.currentTarget) close(); }}>
      <Dialog ref={ref} role="dialog" aria-modal="true" aria-label={t('docs.driveImport.title') as string}
        data-testid="docs-drive-import-dialog">
        <DTitle>{t('docs.driveImport.title')}</DTitle>
        <DBody>
          {!fixed && (
            <>
              <p>{t('docs.driveImport.pickProject')}</p>
              <List>
                {a.projectGroups.length === 0
                  ? <p>{t('docs.wsUpload.noProject', '프로젝트가 없습니다')}</p>
                  : a.projectGroups.map(p => (
                    <Row key={p.id} type="button" $on={chosen === p.id} onClick={() => setPicked(p.id)}
                      data-testid={`docs-drive-import-project-${p.id}`}>
                      <Dot $color={p.color || '#14B8A6'} /><span>{p.name}</span>
                    </Row>
                  ))}
              </List>
            </>
          )}
          {dest && (
            <>
              <Where data-testid="docs-drive-import-dest">{where}</Where>
              {/* key — 목적지가 바뀌면 «추가됨» 표시를 새로 시작한다(다른 자리에 넣은 것으로 읽히지 않게). */}
              <DriveImportSection key={`${dest.projectId}-${dest.folderId}-${dest.mine}`} businessId={a.businessId} defaultOpen
                projectId={dest.projectId} folderId={dest.folderId} vlevel={dest.mine ? 'L1' : undefined}
                onImported={a.onImported} />
            </>
          )}
        </DBody>
        <DFooter>
          <SecondaryBtn type="button" onClick={close}>{t('docs.driveImport.close')}</SecondaryBtn>
        </DFooter>
      </Dialog>
    </Modal>
  ) : null;

  return { openDriveImport: a.enabled ? () => setOpen(true) : undefined, driveImportModal };
}

const Where = styled.p`margin:2px 0 0 !important;font-size:0.75rem;color:#64748B;`;
const List = styled.div`display:flex;flex-direction:column;gap:2px;max-height:220px;overflow-y:auto;margin:6px 0 10px;`;
const Row = styled.button<{ $on: boolean }>`
  display:flex;align-items:center;gap:8px;padding:10px 12px;border-radius:8px;cursor:pointer;text-align:left;
  font-size:0.8125rem;color:#0F172A;
  background:${p => (p.$on ? '#F0FDFA' : 'transparent')};border:1px solid ${p => (p.$on ? '#14B8A6' : 'transparent')};
  &:hover{background:${p => (p.$on ? '#F0FDFA' : '#F8FAFC')};}
`;
const Dot = styled.span<{ $color: string }>`
  width:18px;flex-shrink:0;display:flex;align-items:center;justify-content:center;
  &::before{content:'';width:10px;height:10px;border-radius:50%;background:${p => p.$color};}
`;
