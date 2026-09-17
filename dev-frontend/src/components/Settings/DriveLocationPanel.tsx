// autosave-exempt: 자동저장이 아니다 — 폴더 이관은 되돌리기 어려워 "적용" 버튼을 눌러야 나간다.
//   결과는 role="status" 메시지로 말한다.
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
import React, { useCallback, useEffect, useState } from 'react';
import styled from 'styled-components';
import { useTranslation } from 'react-i18next';
import { apiFetch } from '../../contexts/AuthContext';
import { listBusinessMembers } from '../../services/qtalk';
import ConfirmDialog from '../Common/ConfirmDialog';

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


  //   ★ 지정한 폴더를 **그대로** 저장 폴더로 쓴다. 그 안에 PlanQ 폴더를 또 만들지 않는다
  //     (Irene: "지정한 폴더에 추가로 폴더를 만들면 안된다는 거잖아").
  //     기존 내용물은 새 자리로 옮기고, 몇 개를 옮겼는지 화면이 말한다.
  const apply = async () => {
    if (busy) return;                              // 중복 제출 가드
    setBusy(true);
    setMsg(null);
    try {
      const r = await apiFetch(`/api/cloud/gdrive/${businessId}/root-folder`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ location: value.trim() }),
      });
      const j = await r.json().catch(() => ({}));
      if (!r.ok || !j?.data) {
        const code = String(j?.message || '');
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
      // 'moved' 기존 파일이 따라감 · 'reused' 이미 있던 우리 폴더 · 'created' 새로 만듦
      // 몇 개를 옮겼는지 말한다 — "바꿨다" 만 하면 기존 파일이 어떻게 됐는지 알 수 없다.
      setMsg({
        err: false,
        text: j.data.moved_all === false
          ? (t('storage.gdriveFolder.okPartial', { n: j.data.moved || 0 }) as string)
          : (t('storage.gdriveFolder.okChanged', { n: j.data.moved || 0 }) as string),
      });
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
        <SmallBtn type="button" data-testid="gdrive-folder-relocate-open"
          onClick={() => { setOpen((v) => !v); setMsg(null); }}>
          {tr('storage.gdriveFolder.change')}
        </SmallBtn>
      </Btns>

      {open && (
        <Box>
          <Help>{tr('storage.gdriveFolder.relocateHelp')}</Help>
          {/* 무엇이 생기는지 **누르기 전에** 보여준다 */}
          <Preview data-testid="gdrive-relocate-preview">
            {t('storage.gdriveFolder.preview', { name: folder.name || 'PlanQ' }) as string}
          </Preview>
          <Row>
            <Input
              data-testid="gdrive-folder-relocate-input"
              value={value}
              onChange={(e) => setValue(e.target.value)}
              placeholder={tr('storage.gdriveFolder.relocatePlaceholder')}
              disabled={busy}
            />
            <SmallBtn type="button" data-testid="gdrive-folder-relocate-submit"
              disabled={busy || !value.trim()} onClick={() => { void apply(); }}>
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
        </Box>
      )}

      {/* 파인더 공유 — 위치 바꾸기와 다른 일이라 줄을 나눈다 */}
      <FinderShare businessId={businessId} />
    </Wrap>
  );
};


/**
 * 파인더 공유 — PlanQ 폴더를 팀원의 구글 계정에 열어 준다 (Irene #419, 2026-09-17).
 *
 * *"구글드라이브 연동된 거 실제 해당 구글드라이브로 로그인한 사람만 파인더에서 볼 수 있잖아.
 *   … 공유를 요청하고 해주고 하는게 플랜큐에서 가능할까?"* → 된다.
 *
 * ★ `drive.file` 권한으로도 **우리가 만든 폴더**의 권한은 줄 수 있다. 구글 심사가 필요한 것은
 *   반대 방향(드라이브에서 새로 만든 것을 들여오기)뿐이다.
 * ★★ 여는 것은 **루트가 아니라 `Workspace Files` 폴더 하나**다 (2026-09-17 Fable FAIL 수정).
 *   루트에는 Q Note(사적 공간)·고객 대화방 첨부·프로젝트 파일이 함께 있어, 루트를 열면
 *   PlanQ 안의 게이트 네 개를 Drive 로 우회한다. 서버가 대상 폴더를 정한다 — 화면은 못 고른다.
 * ★ 기본은 **보기(reader)**. 쓰기는 별개의 허락이라 체크로 명시할 때만.
 * ★ 고객은 대상이 아니다 — 폴더를 열면 그 **안의 모든 것**이 열려 범위를 고를 수 없다.
 *   고객에게는 파일 단위 공개 링크가 맞는 문이고, 그건 이미 있다.
 * ★ Cue(AI 멤버)는 구글 계정이 없다 — 목록에 두면 눌러도 `no_google_account` 만 뜬다.
 * ★ 구글 계정이 없는 주소에는 줄 수 없다. 그 사유를 **사람 말로** 적는다 —
 *   "안 됨" 으로만 보이면 무엇을 해야 할지 모른다.
 */
const FinderShare: React.FC<{ businessId: number }> = ({ businessId }) => {
  const { t } = useTranslation('settings');
  const tr = (k: string, fb?: string) => t(k, (fb ?? '') as string) as unknown as string;
  const [open, setOpen] = useState(false);
  const [rows, setRows] = useState<Array<{ user_id: number; name: string; email: string; shared: boolean }>>([]);
  const [busyId, setBusyId] = useState<number | null>(null);
  const [allowEdit, setAllowEdit] = useState(false);          // 기본 보기 · 쓰기는 명시할 때만
  const [confirmFor, setConfirmFor] = useState<{ user_id: number; name: string; email: string } | null>(null);
  const [note, setNote] = useState<{ text: string; err: boolean } | null>(null);
  const [loading, setLoading] = useState(false);
  const [folderLink, setFolderLink] = useState<string | null>(null);   // 되돌리는 문(아래)
  // 실제 Drive 경로 — 화면이 이름을 손으로 적으면 파인더에서 못 찾는다(루트는 `PlanQ - <워크스페이스>`).
  const [folderPath, setFolderPath] = useState<string>('PlanQ / Workspace Files');

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const [members, permRes] = await Promise.all([
        listBusinessMembers(businessId),
        apiFetch(`/api/cloud/gdrive/${businessId}/share-root`).then((r) => r.json()).catch(() => null),
      ]);
      if (permRes && permRes.success && permRes.data?.web_view_link) setFolderLink(permRes.data.web_view_link);
      const connectedBy = (permRes && permRes.success && permRes.data?.connected_by) || null;
      if (permRes && permRes.success && permRes.data?.folder_path) setFolderPath(permRes.data.folder_path);
      const granted = new Set<string>(
        ((permRes && permRes.success && permRes.data?.permissions) || [])
          .map((p: { email?: string | null }) => String(p.email || '').toLowerCase())
          .filter(Boolean),
      );
      setRows((members || [])
        // Cue(AI 멤버)는 구글 계정이 없다 — 목록에 두면 눌러도 실패만 한다
        // Cue(AI)는 구글 계정이 없다. 그리고 **Drive 를 연결한 본인**은 이미 그 폴더의 주인이라
        // 열어 줄 것이 없다 — 목록에 두면 눌러서 **다른 구글 계정에 권한이 부여된다**
        // (Drive owner 이메일 ≠ PlanQ 계정 이메일일 수 있어 권한 목록 대조로는 안 걸린다).
        // 부여는 되돌릴 수 없으므로 **이메일이 아니라 연결자 id** 로 가른다.
        .filter((m) => m.role !== 'ai' && !!m.user?.email
          && !(connectedBy != null && Number(m.user.id) === Number(connectedBy)))
        .map((m) => ({
          user_id: m.user.id, name: m.name || m.user.name, email: m.user.email,
          shared: granted.has(String(m.user.email || '').toLowerCase()),
        })));
    } catch { /* 목록이 없으면 빈 상태로 둔다 */ }
    finally { setLoading(false); }
  }, [businessId]);

  useEffect(() => { if (open) void load(); }, [open, load]);

  /** 준 권한을 거둔다 — 화면에 문이 없으면 «되돌릴 수 없다» 가 사실이 된다(2026-09-17). */
  const unshare = async (row: { user_id: number; email: string }) => {
    setBusyId(row.user_id); setNote(null);
    try {
      const r = await apiFetch(`/api/cloud/gdrive/${businessId}/share-root`, {
        method: 'DELETE', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: row.email }),
      });
      const j = await r.json();
      setNote(j.success
        ? { text: tr('storage.finderShare.unshared', '접근을 끊었습니다. 이미 자기 드라이브로 복사한 파일은 회수되지 않습니다.'), err: false }
        : { text: tr('storage.finderShare.failed', '공유하지 못했습니다.'), err: true });
      await load();
    } catch {
      setNote({ text: tr('storage.finderShare.failed', '공유하지 못했습니다.'), err: true });
    } finally { setBusyId(null); }
  };

  const share = async (userId: number) => {
    setBusyId(userId); setNote(null);
    try {
      const r = await apiFetch(`/api/cloud/gdrive/${businessId}/share-root`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ user_ids: [userId], role: allowEdit ? 'writer' : 'reader' }),
      });
      const j = await r.json();
      if (!j.success) { setNote({ text: tr('storage.finderShare.failed', '공유하지 못했습니다.'), err: true }); return; }
      const one = (j.data?.results || [])[0] || {};
      if (one.granted) setNote({ text: tr('storage.finderShare.done', '파인더에 폴더가 보이게 했습니다.'), err: false });
      else if (one.reason === 'already') setNote({ text: tr('storage.finderShare.already', '이미 볼 수 있습니다.'), err: false });
      else if (one.reason === 'no_google_account') setNote({ text: tr('storage.finderShare.noGoogle', '이 주소로는 구글 계정을 찾을 수 없습니다. 구글 계정으로 쓰는 주소여야 파인더에서 열립니다.'), err: true });
      else setNote({ text: tr('storage.finderShare.failed', '공유하지 못했습니다.'), err: true });
      await load();
    } catch {
      setNote({ text: tr('storage.finderShare.failed', '공유하지 못했습니다.'), err: true });
    } finally { setBusyId(null); }
  };

  return (
    <Box>
      <Btns>
        <SmallBtn type="button" data-testid="gdrive-finder-share-open" onClick={() => { setOpen((v) => !v); setNote(null); }}>
          {tr('storage.finderShare.open', '파인더 공유')}
        </SmallBtn>
      </Btns>
      {open && (
        <>
          <Help>{tr('storage.finderShare.help', '팀원의 구글 계정에 이 폴더를 열어 주면, 그 사람 파인더(구글 드라이브)에도 같은 폴더가 보입니다. 알림 메일은 보내지 않습니다.')}</Help>
          {loading && <Help>{tr('storage.finderShare.loading', '불러오는 중…')}</Help>}
          {!loading && rows.length === 0 && <Help>{tr('storage.finderShare.empty', '공유할 팀원이 없습니다.')}</Help>}
          {rows.map((r) => (
            <Row key={r.user_id}>
              <Text>{r.name} · {r.email}</Text>
              {r.shared
                ? (
                  <SmallBtn type="button" data-testid={`gdrive-finder-unshare-${r.user_id}`}
                    disabled={busyId === r.user_id} onClick={() => { void unshare(r); }}>
                    {busyId === r.user_id ? tr('storage.finderShare.unsharing', '해제 중…') : tr('storage.finderShare.unshare', '해제')}
                  </SmallBtn>
                )
                : (
                  <SmallBtn type="button" data-testid={`gdrive-finder-share-${r.user_id}`}
                    disabled={busyId === r.user_id} onClick={() => setConfirmFor(r)}>
                    {busyId === r.user_id ? tr('storage.finderShare.sharing', '여는 중…') : tr('storage.finderShare.share', '열어 주기')}
                  </SmallBtn>
                )}
            </Row>
          ))}
          <Row>
            <label style={{ display: 'inline-flex', alignItems: 'center', gap: 6, fontSize: '0.75rem', color: '#475569' }}>
              <input type="checkbox" checked={allowEdit} onChange={(e) => setAllowEdit(e.target.checked)}
                data-testid="gdrive-finder-share-allow-edit" />
              {tr('storage.finderShare.allowEdit', '고치는 것도 허용 (기본은 보기만)')}
            </label>
          </Row>
          {/* ★ 되돌리는 법을 **말로만** 하면 막다른 길이다 — "구글 드라이브에서 직접 해제하세요" 라고
              하면서 어디인지 안 알려줬다. 폴더 링크는 이미 손에 있으니 문을 만든다. */}
          {folderLink && (
            <Row>
              <SmallBtn as="a" href={folderLink} target="_blank" rel="noreferrer" data-testid="gdrive-finder-manage">
                {tr('storage.finderShare.manage', '드라이브에서 권한 관리 ↗')}
              </SmallBtn>
            </Row>
          )}
          {note && <Msg $err={note.err} role="status">{note.text}</Msg>}
        </>
      )}
      {/* 권한 부여는 **되돌릴 수 없다** — 누구에게 무엇을 여는지 적어서 묻는다(발송 확인과 같은 성격). */}
      <ConfirmDialog
        isOpen={!!confirmFor}
        onClose={() => setConfirmFor(null)}
        onConfirm={() => { const c = confirmFor; setConfirmFor(null); if (c) void share(c.user_id); }}
        title={tr('storage.finderShare.confirmTitle', '파인더에 폴더를 열까요?')}
        message={t('storage.finderShare.confirmBody', {
          folder: folderPath,
          defaultValue: '{{name}} ({{email}}) 의 구글 계정에 «PlanQ / Workspace Files» 폴더를 {{mode}} 권한으로 엽니다. 한 번 준 권한은 PlanQ 에서 되돌릴 수 없고, 구글 드라이브에서 직접 해제해야 합니다. Q note·고객 대화 첨부·프로젝트 파일은 포함되지 않습니다.',
          name: confirmFor?.name || '', email: confirmFor?.email || '',
          mode: allowEdit ? tr('storage.finderShare.modeEdit', '편집') : tr('storage.finderShare.modeView', '보기'),
        }) as string}
        confirmText={tr('storage.finderShare.confirmOk', '열기')}
        cancelText={tr('storage.finderShare.confirmCancel', '취소')}
        variant="warning"
      />
    </Box>
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
