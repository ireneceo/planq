// services/mail.ts — Q Mail M1 frontend API 래퍼
import { apiFetch } from '../contexts/AuthContext';

export interface EmailAccountRow {
  id: number;
  business_id: number;
  email: string;
  display_name: string | null;
  imap_host: string;
  imap_port: number;
  imap_username: string;
  imap_tls: boolean;
  imap_folder: string;
  imap_last_uid: number;
  smtp_host: string | null;
  smtp_port: number | null;
  smtp_username: string | null;
  smtp_tls: boolean | null;
  is_active: boolean;
  is_default: boolean;
  owner_user_id: number | null;
  is_personal: boolean;
  scope: 'team' | 'personal';
  last_sync_at: string | null;
  last_sync_error: string | null;
  fail_count: number;
  has_imap_password: boolean;
  has_smtp_password: boolean;
  created_at: string;
  updated_at: string;
}

export interface EmailAccountInput {
  email: string;
  display_name?: string | null;
  imap_host: string;
  imap_port?: number;
  imap_username: string;
  imap_password?: string;       // 변경 시만 (PUT). POST 는 필수.
  imap_tls?: boolean;
  imap_folder?: string;
  smtp_host?: string | null;
  smtp_port?: number | null;
  smtp_username?: string | null;
  smtp_password?: string;
  smtp_tls?: boolean;
  is_active?: boolean;
  scope?: 'team' | 'personal';   // POST 시 계정 범위 (회사 공용/개인). 편집 시 무시.
}

async function handle<T>(r: Response): Promise<T> {
  const j = await r.json();
  if (!r.ok || !j.success) throw new Error(j.message || `HTTP ${r.status}`);
  return j.data as T;
}

export async function listEmailAccounts(businessId: number): Promise<EmailAccountRow[]> {
  const r = await apiFetch(`/api/businesses/${businessId}/email-accounts`);
  return handle<EmailAccountRow[]>(r);
}

export async function createEmailAccount(businessId: number, input: EmailAccountInput): Promise<EmailAccountRow> {
  const r = await apiFetch(`/api/businesses/${businessId}/email-accounts`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(input),
  });
  return handle<EmailAccountRow>(r);
}

export async function updateEmailAccount(
  businessId: number, id: number, patch: Partial<EmailAccountInput>
): Promise<EmailAccountRow> {
  const r = await apiFetch(`/api/businesses/${businessId}/email-accounts/${id}`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(patch),
  });
  return handle<EmailAccountRow>(r);
}

export async function deleteEmailAccount(businessId: number, id: number): Promise<void> {
  const r = await apiFetch(`/api/businesses/${businessId}/email-accounts/${id}`, { method: 'DELETE' });
  await handle(r);
}

export async function testEmailAccount(businessId: number, id: number): Promise<{ ok: boolean; error: string | null }> {
  const r = await apiFetch(`/api/businesses/${businessId}/email-accounts/${id}/test`, { method: 'POST' });
  return handle(r);
}

export async function setDefaultEmailAccount(businessId: number, id: number): Promise<EmailAccountRow> {
  const r = await apiFetch(`/api/businesses/${businessId}/email-accounts/${id}/set-default`, { method: 'POST' });
  return handle<EmailAccountRow>(r);
}

export async function syncNowEmailAccount(businessId: number, id: number): Promise<{ triggered: boolean; account_id: number }> {
  const r = await apiFetch(`/api/businesses/${businessId}/email-accounts/${id}/sync-now`, { method: 'POST' });
  return handle(r);
}

// ─── 서비스별 IMAP/SMTP preset (사용자 친화) ────
export interface MailPreset {
  key: string;
  label: string;
  imap_host: string;
  imap_port: number;
  smtp_host: string;
  smtp_port: number;
  hint?: string;  // "Gmail 2FA 사용 시 앱 비밀번호 필요"
}

export const MAIL_PRESETS: MailPreset[] = [
  { key: 'gmail', label: 'Gmail', imap_host: 'imap.gmail.com', imap_port: 993, smtp_host: 'smtp.gmail.com', smtp_port: 587, hint: 'gmailHint' },
  { key: 'outlook', label: 'Outlook 365', imap_host: 'outlook.office365.com', imap_port: 993, smtp_host: 'smtp.office365.com', smtp_port: 587 },
  { key: 'naver', label: 'Naver Mail', imap_host: 'imap.naver.com', imap_port: 993, smtp_host: 'smtp.naver.com', smtp_port: 465 },
  { key: 'daum', label: 'Daum Mail', imap_host: 'imap.daum.net', imap_port: 993, smtp_host: 'smtp.daum.net', smtp_port: 465 },
  { key: 'icloud', label: 'iCloud', imap_host: 'imap.mail.me.com', imap_port: 993, smtp_host: 'smtp.mail.me.com', smtp_port: 587, hint: 'icloudHint' },
  { key: 'custom', label: 'Custom (직접 입력)', imap_host: '', imap_port: 993, smtp_host: '', smtp_port: 587 },
];
