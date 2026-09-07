// Drive 저장 위치 패널 — 지금 어디에 저장되는지 + 팀(공유) 드라이브로 옮기기.
//
// StorageSettings.tsx 에서 떼어냈다(2026-09-07, 842줄 → 컴포넌트 800줄 기준 초과).
// 주제가 하나(저장 위치)라 통째로 옮기기 좋고, 화면 위치·동작은 그대로다.
//
// 이 패널이 존재하는 이유 (Irene 2026-09-07):
//   "공유폴더로 플랜큐로 구글드라이브에서 옮겨봤는데 자꾸 되돌라가"
//   → Finder(드라이브 데스크톱)에서는 내 드라이브 → 공유 드라이브 이동이 **소유권 이전**이라
//     처리되지 않고 되돌아간다. 관리 정책이 막고 있을 수도 있다. 어느 쪽이든 사용자에겐
//     **이유 없이** 되돌아간다. 그래서 앱이 대신 하고, 안 되면 **이유를 말한다.**
//   "위치 다시 확인은 아무 작동도 안하고"
//   → 눌렀는데 화면이 그대로면 고장으로 읽힌다. 바뀐 게 없어도 **확인했다고 말한다.**
//   "내가 PlanQ 폴더 만들면 그 안에 PlanQ 폴더를 너가 또 만들어 넣을까봐 걱정인건데."
//   → 맞는 걱정이다. ①무엇이 생기는지 누르기 전에 보여주고 ②이미 우리가 만든 폴더가 있으면
//     재사용하며(서버가 appProperties 표식으로 찾는다) ③두 겹이 되는 경우를 미리 경고한다.
import React, { useState } from 'react';
import styled from 'styled-components';
import { useTranslation } from 'react-i18next';
import { apiFetch } from '../../contexts/AuthContext';

export interface DriveFolderInfo {
  name?: string;
  web_view_link?: string | null;
  /** true = 공유(팀) 드라이브 안 · false = 연결한 계정의 내 드라이브 */
  in_shared_drive?: boolean;
  reachable?: boolean;
}

interface Props {
  businessId: number;
  folder: DriveFolderInfo;
  /** 위치가 바뀌었을 때 부모가 상태를 다시 읽도록 */
  onChanged: () => void | Promise<void>;
}

const DriveLocationPanel: React.FC<Props> = ({ businessId, folder, onChanged }) => {
  const { t } = useTranslation('settings');
  const tr = (k: string, fb?: string) => t(k, (fb ?? '') as string) as unknown as string;

  const [open, setOpen] = useState(false);
  const [value, setValue] = useState('');
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ text: string; err: boolean } | null>(null);
  const [link, setLink] = useState<string | null>(null);
  /** 옮기기가 막혔을 때만 뜬다 — "그 위치에 새로 만들기" 는 사용자가 한 번 더 눌러야 한다. */
  const [needCreate, setNeedCreate] = useState(false);
  const [recheckBusy, setRecheckBusy] = useState(false);
  const [recheckMsg, setRecheckMsg] = useState<string | null>(null);

  const doRecheck = async () => {
    if (recheckBusy) return;
    setRecheckBusy(true);
    setRecheckMsg(null);
    try {
      const r = await apiFetch(`/api/cloud/status/${businessId}`);
      const j = await r.json().catch(() => ({}));
      const f = j?.data?.gdrive?.folder;
      if (!r.ok || !f) { setRecheckMsg(tr('storage.gdriveFolder.recheckFailed')); return; }
      setRecheckMsg(
        f.reachable === false
          ? tr('storage.gdriveFolder.recheckUnreachable')
          : f.in_shared_drive
            ? (t('storage.gdriveFolder.recheckShared', { name: f.name || '' }) as string)
            : (t('storage.gdriveFolder.recheckMyDrive', { name: f.name || '' }) as string),
      );
      await onChanged();
    } catch {
      setRecheckMsg(tr('storage.gdriveFolder.recheckFailed'));
    } finally { setRecheckBusy(false); }
  };

  //   ★ allowCreate 는 **사용자가 다시 눌렀을 때만** true 다. 옮기기 실패에 자동으로 새로 만들면
  //     전이 오류 한 번에 폴더가 둘로 갈라지고 옛 파일이 남겨진다(2026-09-07 Fable 지적과 같은 함정).
  const apply = async (allowCreate = false) => {
    if (busy) return;                              // 중복 제출 가드
    setBusy(true);
    setMsg(null);
    if (!allowCreate) setNeedCreate(false);
    try {
      const r = await apiFetch(`/api/cloud/gdrive/${businessId}/root-folder`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ location: value.trim(), ...(allowCreate ? { allow_create: true } : {}) }),
      });
      const j = await r.json().catch(() => ({}));
      if (!r.ok || !j?.data) {
        const code = String(j?.message || '');
        if (code.startsWith('move_failed_confirm_create')) {
          // 옮기기가 막혔다 — 무엇을 대신 할 수 있는지 말하고 **한 번 더 묻는다.**
          setNeedCreate(true);
          setMsg({ err: true, text: tr('storage.gdriveFolder.moveBlocked') });
          return;
        }
        setMsg({
          err: true,
          text: code.startsWith('invalid_folder_location')
            ? tr('storage.gdriveFolder.errBadLink')
            : code.startsWith('folder_unusable')
              ? tr('storage.gdriveFolder.errUnusable')
              : code.startsWith('workspace_drive_not_connected')
                ? tr('storage.gdriveFolder.errNotConnected')
                : tr('storage.gdriveFolder.errGeneric'),
        });
        return;
      }
      setNeedCreate(false);
      // 'moved' 기존 파일이 따라감 · 'reused' 이미 있던 우리 폴더 · 'created' 새로 만듦
      const key = j.data.how === 'moved' ? 'okMoved' : j.data.how === 'reused' ? 'okReused' : 'okCreated';
      setMsg({ err: false, text: t(`storage.gdriveFolder.${key}`, { name: j.data.folder?.name || '' }) as string });
      setLink(j.data.folder?.web_view_link || null);
      setValue('');
      await onChanged();
    } catch {
      setMsg({ err: true, text: tr('storage.gdriveFolder.errGeneric') });
    } finally { setBusy(false); }
  };

  return (
    <Wrap data-testid="gdrive-folder-location">
      <Text>
        {folder.reachable === false
          ? tr('storage.gdriveFolder.unreachable')
          : folder.in_shared_drive
            ? (t('storage.gdriveFolder.shared', { name: folder.name || '' }) as string)
            : (t('storage.gdriveFolder.myDrive', { name: folder.name || '' }) as string)}
      </Text>
      <Btns>
        {folder.web_view_link && (
          <SmallBtn as="a" href={folder.web_view_link} target="_blank" rel="noreferrer">
            {tr('storage.gdriveFolder.open')} ↗
          </SmallBtn>
        )}
        <SmallBtn type="button" data-testid="gdrive-folder-recheck"
          disabled={recheckBusy} onClick={() => { void doRecheck(); }}>
          {recheckBusy ? tr('storage.gdriveFolder.rechecking') : tr('storage.gdriveFolder.recheck')}
        </SmallBtn>
        <SmallBtn type="button" data-testid="gdrive-folder-relocate-open"
          onClick={() => { setOpen((v) => !v); setMsg(null); }}>
          {tr('storage.gdriveFolder.relocate')}
        </SmallBtn>
      </Btns>

      {recheckMsg && <Msg data-testid="gdrive-folder-recheck-msg" role="status">{recheckMsg}</Msg>}

      {open && (
        <Box>
          <Help>{tr('storage.gdriveFolder.relocateHelp')}</Help>
          {/* 무엇이 생기는지 **누르기 전에** 보여준다 */}
          <Preview data-testid="gdrive-relocate-preview">
            {t('storage.gdriveFolder.preview', { name: folder.name || 'PlanQ' }) as string}
          </Preview>
          <Warn>{tr('storage.gdriveFolder.nestWarn')}</Warn>
          <Row>
            <Input
              data-testid="gdrive-folder-relocate-input"
              value={value}
              onChange={(e) => setValue(e.target.value)}
              placeholder={tr('storage.gdriveFolder.relocatePlaceholder')}
              disabled={busy}
            />
            <SmallBtn type="button" data-testid="gdrive-folder-relocate-submit"
              disabled={busy || !value.trim()} onClick={() => { void apply(false); }}>
              {busy ? tr('storage.gdriveFolder.relocating') : tr('storage.gdriveFolder.relocateApply')}
            </SmallBtn>
          </Row>
          {msg && <Msg $err={msg.err} role="status">{msg.text}</Msg>}
          {link && !msg?.err && (
            <Row>
              <SmallBtn as="a" href={link} target="_blank" rel="noreferrer" data-testid="gdrive-relocate-open">
                {tr('storage.gdriveFolder.openToVerify')} ↗
              </SmallBtn>
            </Row>
          )}
          {needCreate && (
            <Row>
              <SmallBtn type="button" data-testid="gdrive-folder-relocate-create"
                disabled={busy} onClick={() => { void apply(true); }}>
                {tr('storage.gdriveFolder.createThere')}
              </SmallBtn>
            </Row>
          )}
        </Box>
      )}
    </Wrap>
  );
};

const Wrap = styled.div`
  display:flex; flex-wrap:wrap; align-items:center; gap:8px;
  margin-top:10px; padding:10px 12px; border-radius:10px; background:#F8FAFC;
`;
const Text = styled.p`flex:1 1 240px; min-width:0; margin:0; font-size:0.75rem; line-height:1.55; color:#475569;`;
const Btns = styled.div`display:flex; gap:6px; flex-shrink:0;`;
const Box = styled.div`flex-basis:100%; margin-top:8px;`;
const Help = styled.p`margin:0 0 6px; font-size:0.75rem; line-height:1.55; color:#64748B;`;
const Preview = styled.p`
  margin:0 0 4px; padding:8px 10px; border-radius:8px;
  background:#F0FDFA; border:1px solid #CCFBF1;
  font-size:0.75rem; line-height:1.55; color:#0F766E;
`;
const Warn = styled.p`margin:0 0 8px; font-size:0.75rem; line-height:1.55; color:#92400E;`;
const Row = styled.div`display:flex; gap:6px; flex-wrap:wrap; margin-top:6px;`;
const Input = styled.input`
  flex:1 1 260px; min-width:0; padding:7px 10px;
  border:1px solid #E2E8F0; border-radius:8px; background:#fff; color:#0F172A; font-size:0.8125rem;
  /* 폰에서 16px 미만이면 iOS 가 화면을 확대한다 */
  @media (max-width: 640px){ font-size:1rem; }
  &:focus{ outline:none; border-color:#14B8A6; }
`;
const Msg = styled.p<{ $err?: boolean }>`
  flex-basis:100%; margin:6px 0 0; font-size:0.75rem; line-height:1.55;
  color:${p => (p.$err ? '#B91C1C' : '#0F766E')};
`;
const SmallBtn = styled.button`
  display:inline-flex; align-items:center; justify-content:center;
  padding:6px 10px; border:1px solid #E2E8F0; border-radius:8px; background:#fff;
  font-size:0.75rem; font-weight:600; color:#0F172A; cursor:pointer; text-decoration:none;
  &:hover:not(:disabled){ border-color:#CBD5E1; background:#F1F5F9; }
  &:disabled{ opacity:0.6; cursor:default; }
  @media (hover: none), (max-width: 640px){ min-height:36px; }
`;

export default DriveLocationPanel;
