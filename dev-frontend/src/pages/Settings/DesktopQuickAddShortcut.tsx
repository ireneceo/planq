// 데스크탑 앱 «빠른 업무 추가» 전역 단축키 — 켜기/끄기 · 키 바꾸기 · 등록 실패 표시 (docs/DESKTOP_APP_PHASE2.md C · §4-3)
//   형식 검증은 main(desktop/src/shortcut.js)이 한다 — 여기서는 누른 키를 Electron 표기로 옮겨 보내고, 거절 이유를 문장으로 보인다.
//   옛 껍데기(1단계)에는 getShortcut 이 없다 → 이 칸을 그리지 않는다.
import React, { useEffect, useRef, useState } from 'react';
import styled from 'styled-components';
import { useTranslation } from 'react-i18next';
import ActionButton from '../../components/Common/ActionButton';
import AutoSaveField from '../../components/Common/AutoSaveField';
import { Switch, SwitchKnob } from '../../components/Common/switchShell';
import { desktopBridge, type DesktopShortcutError, type DesktopShortcutState } from '../../services/native';

const CODE_KEYS: Record<string, string> = {
  Space: 'Space', Enter: 'Enter', Backspace: 'Backspace', Delete: 'Delete', Insert: 'Insert', Home: 'Home', End: 'End',
  PageUp: 'PageUp', PageDown: 'PageDown', ArrowUp: 'Up', ArrowDown: 'Down', ArrowLeft: 'Left', ArrowRight: 'Right',
  Semicolon: ';', Equal: '=', Comma: ',', Minus: '-', Period: '.', Slash: '/', Backquote: '`',
  BracketLeft: '[', BracketRight: ']', Backslash: '\\', Quote: "'",
};
/** 누른 키 → Electron 표기. 수식키만 눌렀으면 null(진짜 키를 기다린다). 판정(허용·거절)은 main 몫 */
export function accelFromEvent(e: { code: string; ctrlKey: boolean; metaKey: boolean; altKey: boolean; shiftKey: boolean }, mac: boolean): string | null {
  let key: string | null = null;
  if (/^Key[A-Z]$/.test(e.code)) key = e.code.slice(3);
  else if (/^Digit[0-9]$/.test(e.code)) key = e.code.slice(5);
  else if (/^F([1-9]|1[0-9]|2[0-4])$/.test(e.code)) key = e.code;
  else key = CODE_KEYS[e.code] || null;
  if (!key) return null;
  const mods: string[] = [];
  if (mac ? e.metaKey : e.ctrlKey) mods.push('CommandOrControl');
  if (mac && e.ctrlKey) mods.push('Control');
  if (e.altKey) mods.push('Alt');
  if (e.shiftKey) mods.push('Shift');
  return [...mods, key].join('+');
}

const DesktopQuickAddShortcut: React.FC = () => {
  const { t } = useTranslation('settings');
  const bridge = desktopBridge();
  const [state, setState] = useState<DesktopShortcutState | null>(null);
  const [recording, setRecording] = useState(false);
  const [err, setErr] = useState<DesktopShortcutError | null>(null);
  const enabledRef = useRef(false);
  const boxRef = useRef<HTMLDivElement>(null);
  const mac = bridge?.platform === 'darwin';

  useEffect(() => {
    if (!bridge?.getShortcut) return;
    bridge.getShortcut().then((s) => { if (s) { setState(s); enabledRef.current = s.enabled; } }).catch(() => {});
  }, [bridge]);
  useEffect(() => { if (recording) boxRef.current?.focus(); }, [recording]);

  if (!bridge?.getShortcut || !bridge.setShortcut || !state) return null;
  const set = bridge.setShortcut;

  const errText = (code: DesktopShortcutError | null) => {
    switch (code) {
      case 'needs_modifier': return t('push.desktop.shortcut.errNeedsModifier', 'Ctrl·Cmd·Alt 중 하나를 같이 눌러야 해요 (다른 프로그램에서 그 글자를 못 치게 되지 않게).');
      case 'common_key': return t('push.desktop.shortcut.errCommon', '복사·붙여넣기처럼 자주 쓰는 키예요 — Shift 나 Alt 를 더해 주세요.');
      case 'in_use': return t('push.desktop.shortcut.errInUse', '다른 프로그램이 이미 이 키를 쓰고 있어 등록하지 못했어요 — 다른 키로 바꿔 주세요.');
      case 'invalid': return t('push.desktop.shortcut.errInvalid', '이 키 조합은 쓸 수 없어요 — 글자·숫자·F키·Space 중 하나에 Ctrl·Cmd·Alt 를 더해 주세요.');
      default: return '';
    }
  };

  const persistEnabled = async () => {
    const want = enabledRef.current;
    const r = await set({ enabled: want });
    if (!r) throw new Error('shortcut_failed');
    setState(r.state);
    enabledRef.current = r.state.enabled;
    setErr(r.ok ? null : (r.error || null));
    if (!r.ok) throw new Error(r.error || 'shortcut_failed');
  };

  const saveAccel = async (accel: string) => {
    const r = await set({ accel });
    if (!r) { setErr('invalid'); return; }
    setState(r.state);
    setErr(r.ok ? null : (r.error || null));
    if (r.ok) setRecording(false);
  };

  const onKeyDown = (e: React.KeyboardEvent<HTMLDivElement>) => {
    e.preventDefault();
    e.stopPropagation();
    if (e.key === 'Escape' && !e.ctrlKey && !e.metaKey && !e.altKey && !e.shiftKey) { setRecording(false); setErr(null); return; }
    const accel = accelFromEvent(e, mac);
    if (accel) void saveAccel(accel);
  };

  const failedNow = state.enabled && !state.registered;
  const shownErr = err || (failedNow ? state.error : null);

  return (
    <Wrap data-testid="desktop-shortcut">
      <Row>
        <AutoSaveField type="toggle" onSave={persistEnabled}>
          <Switch
            type="button"
            role="switch"
            data-testid="desktop-shortcut-enabled"
            aria-checked={state.enabled}
            aria-label={t('push.desktop.shortcut.label', '단축키로 빠른 업무 추가') as string}
            $on={state.enabled}
            onClick={() => { enabledRef.current = !state.enabled; setState({ ...state, enabled: !state.enabled }); }}
          >
            <SwitchKnob $on={state.enabled} />
          </Switch>
        </AutoSaveField>
        <Label>{t('push.desktop.shortcut.label', '단축키로 빠른 업무 추가')}</Label>
        <Keys data-testid="desktop-shortcut-keys">{state.display}</Keys>
      </Row>
      <Line>{t('push.desktop.shortcut.desc', '다른 프로그램을 쓰다가 이 키를 누르면 작은 창이 떠서 바로 업무를 적을 수 있어요. Esc 를 누르면 창이 숨습니다.')}</Line>
      {state.enabled && (
        <Row>
          {recording ? (
            <Recorder
              ref={boxRef}
              tabIndex={0}
              role="textbox"
              aria-label={t('push.desktop.shortcut.recordAria', '새 단축키 입력') as string}
              data-testid="desktop-shortcut-recorder"
              onKeyDown={onKeyDown}
              onBlur={() => setRecording(false)}
            >
              {t('push.desktop.shortcut.recording', '새 키 조합을 누르세요 (Esc 취소)')}
            </Recorder>
          ) : (
            <ActionButton tone="secondary" size="sm" data-testid="desktop-shortcut-change" onClick={() => { setErr(null); setRecording(true); }}>
              {t('push.desktop.shortcut.change', '키 바꾸기')}
            </ActionButton>
          )}
          {state.accel !== state.defaultAccel && !recording && (
            <ActionButton tone="secondary" size="sm" data-testid="desktop-shortcut-reset" onClick={() => { void saveAccel(state.defaultAccel); }}>
              {t('push.desktop.shortcut.reset', '기본값으로')}
            </ActionButton>
          )}
        </Row>
      )}
      {shownErr && <Warn role="alert" data-testid="desktop-shortcut-error">{errText(shownErr)}</Warn>}
    </Wrap>
  );
};

export default DesktopQuickAddShortcut;

const Wrap = styled.div`display: flex; flex-direction: column; gap: 8px; padding-top: 4px; border-top: 1px solid #F1F5F9; margin-top: 4px;`;
const Row = styled.div`display: flex; align-items: center; gap: 10px; flex-wrap: wrap;`;
const Label = styled.span`font-size: 0.8125rem; color: #0F172A;`;
const Line = styled.div`font-size: 0.75rem; color: #64748B; line-height: 1.5;`;
const Keys = styled.kbd`
  font-family: inherit; font-size: 0.75rem; font-weight: 600; color: #0F766E;
  background: #F0FDFA; border: 1px solid #99F6E4; border-radius: 6px; padding: 2px 8px;
`;
const Recorder = styled.div`
  min-width: 220px; height: 32px; display: inline-flex; align-items: center; padding: 0 10px;
  border: 1px dashed #14B8A6; border-radius: 8px; background: #F0FDFA;
  font-size: 0.75rem; color: #0F766E; cursor: text;
  &:focus { outline: none; box-shadow: 0 0 0 3px rgba(20,184,166,0.18); }
`;
const Warn = styled.div`font-size: 0.75rem; color: #B45309; line-height: 1.5;`;
