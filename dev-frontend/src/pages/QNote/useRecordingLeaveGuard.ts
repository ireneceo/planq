// pages/QNote/useRecordingLeaveGuard.ts — 녹음하는 화면이 «지금 녹음 중» 을 앱 전체에 알린다 (2026-11-19 · Fable 설계)
//
//   녹음이 실제로 도는 동안(phase==='recording')만 services/recordingGuard 에 등록한다 — 메뉴 이동·탭 닫기·탭 정지·
//   새로고침·로그아웃·워크스페이스 전환이 그 등록을 보고 묻거나(확인창) 녹음 탭을 살린다(이동을 새 탭으로).
//   - 탭 모드면 그 탭에 빨간 점(tabStore.setTabIndicator).
//   - 프로젝트 탭에 얹혀 있을 때 부모에게도 알린다(onRecordingChange — 부모가 다른 탭으로 옮겨도 트리를 살린다).
//   QNotePage(god-file)에서 옮겨 왔다 — 그 파일의 줄 수를 늘리지 않으려고 훅으로 뺐다.
import { useEffect, useRef } from 'react';
import { useTabId } from '../../contexts/TabActiveContext';
import { tabStore } from '../../stores/tabStore';
import { registerRecording, unregisterRecording } from '../../services/recordingGuard';

let seq = 0;

export function useRecordingLeaveGuard(recording: boolean, stop: () => void, onRecordingChange?: (recording: boolean) => void) {
  const tabId = useTabId();
  const keyRef = useRef<string>('');
  if (!keyRef.current) keyRef.current = `qnote-${++seq}`;
  const stopRef = useRef(stop);
  stopRef.current = stop;

  useEffect(() => {
    const key = keyRef.current;
    if (recording) registerRecording(key, { tabId, stop: () => stopRef.current() });
    else unregisterRecording(key);
    if (tabId) tabStore.setTabIndicator(tabId, recording ? 'recording' : null);
    onRecordingChange?.(recording);
  }, [recording, tabId, onRecordingChange]);

  // 언마운트 — 등록만 걷는다(녹음 자체는 화면 cleanup 의 liveRef.stop() 이 최후 안전망으로 멈춘다)
  useEffect(() => () => {
    unregisterRecording(keyRef.current);
    if (tabId) tabStore.setTabIndicator(tabId, null);
  }, [tabId]);
}
