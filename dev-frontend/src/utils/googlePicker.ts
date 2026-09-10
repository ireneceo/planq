// utils/googlePicker.ts — Google Picker 한 곳.
//
// 왜 Picker 인가
//   우리 Drive 권한은 `drive.file` 이다 — **PlanQ 가 만들었거나 사용자가 PlanQ 로 연 파일만**
//   보인다. 그래서 "내 드라이브에 있는데 목록에 없다" 가 정상이었고, 그게 이 기능의 한계였다.
//   Picker 에서 사용자가 고르는 행위 자체가 "이 앱으로 열었다" 가 되어 그 파일에 접근이 열린다.
//   Drive **전체 권한**(Restricted · 구글 심사)을 받지 않고 목적을 이루는 정식 경로다.
//
// ★ CSP — `https://apis.google.com`(스크립트)와 `https://docs.google.com`(Picker iframe)이
//   열려 있어야 한다. 닫혀 있으면 **에러 하나 없이 조용히 아무 일도 안 일어난다**
//   (2026-09-02 srcdoc 사고와 같은 모양). 두 벌(nginx snippet · middleware/security.js)이
//   같아야 하고, 가드 `--category=csp` 가 그것을 강제한다.
//
// ★ 스크립트는 **한 번만** 로드한다. 여러 첨부 자리에서 동시에 눌러도 로드는 하나다
//   (같은 src 를 두 번 넣으면 gapi 가 다시 초기화되며 앞의 Picker 가 죽는다).

const API_JS = 'https://apis.google.com/js/api.js';

export interface PickedFile {
  id: string;
  name: string;
  mimeType?: string;
  sizeBytes?: number | null;
}

/** 키가 없으면 Picker 를 띄울 수 없다 — 화면이 **이유를 말할 수 있게** 판정을 내보낸다. */
export function pickerConfigured(): boolean {
  return !!(import.meta.env.VITE_GOOGLE_PICKER_API_KEY && import.meta.env.VITE_GOOGLE_APP_ID);
}

let scriptPromise: Promise<void> | null = null;

function loadApiJs(): Promise<void> {
  if (scriptPromise) return scriptPromise;
  scriptPromise = new Promise<void>((resolve, reject) => {
    const existing = document.querySelector<HTMLScriptElement>(`script[src="${API_JS}"]`);
    if (existing) {
      if ((window as any).gapi) { resolve(); return; }
      existing.addEventListener('load', () => resolve());
      existing.addEventListener('error', () => reject(new Error('picker_script_blocked')));
      return;
    }
    const el = document.createElement('script');
    el.src = API_JS;
    el.async = true;
    el.onload = () => resolve();
    // CSP 로 막히면 여기로 온다 — 조용히 두지 않고 호출부가 문구를 띄우게 던진다.
    el.onerror = () => { scriptPromise = null; reject(new Error('picker_script_blocked')); };
    document.head.appendChild(el);
  });
  return scriptPromise;
}

let pickerModule: Promise<void> | null = null;

function loadPickerModule(): Promise<void> {
  if (pickerModule) return pickerModule;
  pickerModule = loadApiJs().then(() => new Promise<void>((resolve, reject) => {
    const gapi = (window as any).gapi;
    if (!gapi || !gapi.load) { pickerModule = null; reject(new Error('picker_script_blocked')); return; }
    gapi.load('picker', {
      callback: () => resolve(),
      onerror: () => { pickerModule = null; reject(new Error('picker_module_failed')); },
    });
  }));
  return pickerModule;
}

export interface OpenPickerOptions {
  accessToken: string;
  /** 화면 언어 — Picker UI 도 사용자의 언어로 뜬다. */
  locale?: string;
  /** 여러 개 고르기. 첨부는 여러 개가 자연스럽다. */
  multiple?: boolean;
}

/**
 * Picker 를 띄우고 사용자가 고른 파일들을 돌려준다. 취소하면 빈 배열.
 *
 * ★ 공유(팀) 드라이브를 **반드시** 켠다 — Irene 요구가 팀 드라이브 중심이고,
 *   끄면 팀 드라이브 파일이 아예 목록에 안 보인다(권한 문제로 오진하기 쉽다.
 *   memory `feedback_shared_drive_needs_supportsalldrives` 와 같은 축).
 */
export async function openGoogleDrivePicker(opts: OpenPickerOptions): Promise<PickedFile[]> {
  await loadPickerModule();
  const google = (window as any).google;
  if (!google || !google.picker) throw new Error('picker_module_failed');

  const P = google.picker;
  return new Promise<PickedFile[]>((resolve) => {
    const view = new P.DocsView(P.ViewId.DOCS)
      .setIncludeFolders(true)
      .setSelectFolderEnabled(false)
      .setEnableDrives(true);          // 공유(팀) 드라이브

    const builder = new P.PickerBuilder()
      .setAppId(import.meta.env.VITE_GOOGLE_APP_ID)
      .setOAuthToken(opts.accessToken)
      .setDeveloperKey(import.meta.env.VITE_GOOGLE_PICKER_API_KEY)
      .addView(view)
      .enableFeature(P.Feature.SUPPORT_DRIVES)
      .setCallback((data: any) => {
        if (data[P.Response.ACTION] === P.Action.PICKED) {
          const docs = data[P.Response.DOCUMENTS] || [];
          resolve(docs.map((d: any) => ({
            id: d[P.Document.ID],
            name: d[P.Document.NAME],
            mimeType: d[P.Document.MIME_TYPE],
            sizeBytes: d.sizeBytes != null ? Number(d.sizeBytes) : null,
          })));
        } else if (data[P.Response.ACTION] === P.Action.CANCEL) {
          resolve([]);
        }
      });

    if (opts.multiple) builder.enableFeature(P.Feature.MULTISELECT_ENABLED);
    if (opts.locale) builder.setLocale(opts.locale.slice(0, 2) === 'en' ? 'en' : 'ko');

    builder.build().setVisible(true);
  });
}
