import { useEffect, useState, useCallback, useMemo } from 'react';
import styled from 'styled-components';
import { useTranslation } from 'react-i18next';
import { useLocation, useParams, useNavigate } from 'react-router-dom';
import { useAuth, apiFetch } from '../../contexts/AuthContext';
import AutoSaveField from '../../components/Common/AutoSaveField';
import PlanQSelect from '../../components/Common/PlanQSelect';
import { Tabs, Tab } from '../../components/Common/TabComponents';
import StorageSettings from './StorageSettings';
import PlanSettings from './PlanSettings';
import TimezoneSelector from '../../components/Common/TimezoneSelector';
import PageShell from '../../components/Layout/PageShell';
import { useTimezones } from '../../hooks/useTimezones';
import { cityFromTz, offsetFromTz, formatTimeInTz } from '../../utils/timezones';
import {
  getWorkspace,
  updateBrand,
  updateLegal,
  updateSettings,
  listMembers,
  inviteMember,
  updateMemberRole,
  removeMember,
  getCueInfo,
  updateCue,
  type Workspace,
  type WorkspaceMember,
  type CueInfo,
} from '../../services/workspace';

type TabKey = 'brand' | 'legal' | 'language' | 'timezone' | 'storage' | 'plan' | 'members' | 'cue';

// ─────────────────────────────────────────────
// Styled
// ─────────────────────────────────────────────

const Card = styled.section`
  background: #ffffff;
  border: 1px solid #e2e8f0;
  border-radius: 12px;
  padding: 24px;
  margin-bottom: 16px;
`;

const SectionTitle = styled.h2`
  font-size: 16px;
  font-weight: 700;
  color: #0f172a;
  margin: 0 0 4px;
`;
const SectionHeaderRow = styled.div`
  display: flex; justify-content: space-between; align-items: flex-start; gap: 16px; margin-bottom: 12px;
`;
const InvitePrimaryBtn = styled.button`
  display: inline-flex; align-items: center; gap: 6px; height: 32px; padding: 0 14px;
  background: #14B8A6; color: #FFFFFF; border: none; border-radius: 8px;
  font-size: 13px; font-weight: 700; cursor: pointer; flex-shrink: 0;
  &:hover { background: #0D9488; }
`;
const InviteBox = styled.div`
  margin: 12px 0 16px; padding: 14px; background: #F8FAFC; border: 1px solid #E2E8F0;
  border-radius: 10px; display: flex; flex-direction: column; gap: 10px;
`;
const InviteInputRow = styled.div`display: flex; gap: 8px;`;
const InviteInput = styled.input`
  flex: 2; padding: 8px 12px; border: 1px solid #CBD5E1; border-radius: 8px;
  font-size: 13px; background: #FFFFFF; &:focus { outline: none; border-color: #14B8A6; box-shadow: 0 0 0 2px rgba(20,184,166,0.15); }
`;
const InviteRoleInput = styled.input`
  flex: 1; padding: 8px 12px; border: 1px solid #CBD5E1; border-radius: 8px;
  font-size: 13px; background: #FFFFFF; min-width: 120px;
  &:focus { outline: none; border-color: #14B8A6; box-shadow: 0 0 0 2px rgba(20,184,166,0.15); }
`;
const InviteError = styled.div`font-size: 12px; color: #DC2626;`;
const InviteActionRow = styled.div`display: flex; gap: 8px; justify-content: flex-end;`;
const InviteCancel = styled.button`
  padding: 7px 12px; background: #FFFFFF; color: #334155; border: 1px solid #CBD5E1;
  border-radius: 8px; font-size: 12px; font-weight: 600; cursor: pointer;
  &:hover { background: #F8FAFC; border-color: #94A3B8; }
`;
const InviteSubmit = styled.button`
  padding: 7px 14px; background: #0D9488; color: #FFFFFF; border: none;
  border-radius: 8px; font-size: 12px; font-weight: 700; cursor: pointer;
  &:hover:not(:disabled) { background: #0F766E; }
  &:disabled { background: #CBD5E1; cursor: not-allowed; }
`;

const SectionDesc = styled.p`
  font-size: 13px;
  color: #64748b;
  margin: 0 0 20px;
`;

const FieldGrid = styled.div`
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 14px 18px;
  @media (max-width: 768px) { grid-template-columns: 1fr; }
`;

const Field = styled.div<{ $full?: boolean }>`
  display: flex;
  flex-direction: column;
  gap: 6px;
  ${(p) => p.$full && 'grid-column: 1 / -1;'}
`;

const Label = styled.label`
  font-size: 12px;
  font-weight: 600;
  color: #475569;
`;

const LabelHint = styled.span`
  font-size: 11px;
  font-weight: 400;
  color: #94a3b8;
  margin-left: 6px;
`;

const TextInput = styled.input`
  width: 100%;
  height: 40px;
  padding: 0 12px;
  border: 1px solid #e2e8f0;
  border-radius: 8px;
  font-size: 14px;
  color: #0f172a;
  background: #ffffff;
  outline: none;
  transition: border-color 120ms;
  &:focus { border-color: #14b8a6; box-shadow: 0 0 0 3px rgba(20, 184, 166, 0.15); }
  &::placeholder { color: #cbd5e1; }
`;

const ColorRow = styled.div`
  display: flex;
  align-items: center;
  gap: 10px;
`;

const ColorSwatch = styled.input.attrs({ type: 'color' })`
  width: 40px;
  height: 40px;
  padding: 0;
  border: 1px solid #e2e8f0;
  border-radius: 8px;
  background: transparent;
  cursor: pointer;
`;

const ModeCard = styled.label<{ $active?: boolean; $disabled?: boolean }>`
  display: flex;
  align-items: flex-start;
  gap: 12px;
  padding: 14px 16px;
  border: 2px solid ${(p) => (p.$active ? '#14b8a6' : '#e2e8f0')};
  background: ${(p) => (p.$active ? '#f0fdfa' : '#ffffff')};
  border-radius: 10px;
  cursor: ${(p) => (p.$disabled ? 'not-allowed' : 'pointer')};
  margin-bottom: 10px;
  transition: all 120ms;
  opacity: ${(p) => (p.$disabled ? 0.5 : 1)};
  &:hover { border-color: ${(p) => (p.$disabled ? '#e2e8f0' : '#14b8a6')}; }
`;

const ModeRadio = styled.input.attrs({ type: 'radio' })`
  margin-top: 3px;
  accent-color: #14b8a6;
`;

const ModeBody = styled.div`
  flex: 1;
`;

const ModeTitle = styled.div`
  font-size: 14px;
  font-weight: 600;
  color: #0f172a;
`;

const ModeHint = styled.div`
  font-size: 12px;
  color: #64748b;
  margin-top: 2px;
`;

const UsageBar = styled.div`
  position: relative;
  height: 14px;
  background: #f1f5f9;
  border-radius: 8px;
  overflow: hidden;
  margin: 12px 0 8px;
`;

const UsageFill = styled.div<{ $ratio: number; $over?: boolean }>`
  height: 100%;
  width: ${(p) => Math.min(100, p.$ratio * 100)}%;
  background: ${(p) => (p.$over ? '#f43f5e' : 'linear-gradient(90deg, #14b8a6, #0d9488)')};
  transition: width 240ms ease;
`;

const UsageStats = styled.div`
  display: flex;
  flex-wrap: wrap;
  gap: 18px;
  font-size: 12px;
  color: #475569;
  margin-top: 8px;
`;

const UsageStat = styled.div`
  display: flex;
  flex-direction: column;
  gap: 2px;
`;

const UsageStatLabel = styled.span`
  color: #94a3b8;
  font-size: 11px;
`;

const UsageStatValue = styled.span`
  color: #0f172a;
  font-weight: 700;
  font-size: 14px;
`;

const ByTypeList = styled.div`
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 8px 18px;
  margin-top: 14px;
  font-size: 12px;
  color: #475569;
  @media (max-width: 768px) { grid-template-columns: 1fr; }
`;

const ByTypeRow = styled.div`
  display: flex;
  justify-content: space-between;
  padding: 6px 0;
  border-bottom: 1px dashed #e2e8f0;
`;

const PauseToggleRow = styled.div`
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  padding: 14px 16px;
  background: #f8fafc;
  border: 1px solid #e2e8f0;
  border-radius: 10px;
  margin-top: 16px;
`;

const Switch = styled.button<{ $on?: boolean }>`
  position: relative;
  width: 44px;
  height: 24px;
  border: none;
  border-radius: 999px;
  background: ${(p) => (p.$on ? '#f43f5e' : '#cbd5e1')};
  cursor: pointer;
  padding: 0;
  transition: background 160ms;
  flex-shrink: 0;
  &::after {
    content: '';
    position: absolute;
    top: 2px;
    left: ${(p) => (p.$on ? '22px' : '2px')};
    width: 20px;
    height: 20px;
    background: #ffffff;
    border-radius: 50%;
    transition: left 160ms;
    box-shadow: 0 1px 3px rgba(15, 23, 42, 0.2);
  }
`;

const MemberRow = styled.div<{ $ai?: boolean; $clickable?: boolean }>`
  display: flex;
  align-items: center;
  gap: 12px;
  padding: 12px 14px;
  border: 1px solid ${(p) => (p.$ai ? '#fecdd3' : '#e2e8f0')};
  background: ${(p) => (p.$ai ? '#fff1f2' : '#ffffff')};
  border-radius: 10px;
  margin-bottom: 8px;
  cursor: ${(p) => (p.$clickable ? 'pointer' : 'default')};
  transition: background 0.12s, border-color 0.12s;
  &:hover {
    ${(p) => (p.$clickable ? 'background:#F8FAFC; border-color:#CBD5E1;' : '')}
  }
`;
const MemberNameRow = styled.div`display:flex; align-items:center; gap:6px; flex-wrap:wrap;`;
const MemberOrg = styled.span`font-size:12px; color:#94A3B8; font-weight:500;`;
const DefaultRoleBadge = styled.span`
  display:inline-flex; align-items:center; height:22px; padding:0 10px;
  font-size:11px; font-weight:600; color:#0F766E; background:#F0FDFA; border:1px solid #99F6E4;
  border-radius:10px; flex-shrink:0;
`;

const Avatar = styled.div<{ $ai?: boolean }>`
  width: 40px;
  height: 40px;
  border-radius: 50%;
  background: ${(p) => (p.$ai ? '#f43f5e' : '#14b8a6')};
  color: #ffffff;
  display: flex;
  align-items: center;
  justify-content: center;
  font-weight: 700;
  font-size: 14px;
  flex-shrink: 0;
`;

const MemberInfo = styled.div`
  flex: 1;
  min-width: 0;
`;

const MemberName = styled.div`
  font-size: 14px;
  font-weight: 700;
  color: #0f172a;
`;

const MemberEmail = styled.div`
  font-size: 12px;
  color: #64748b;
  margin-top: 2px;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
`;

const RoleBadge = styled.span<{ $role?: string }>`
  display: inline-flex;
  align-items: center;
  height: 22px;
  padding: 0 10px;
  font-size: 11px;
  font-weight: 700;
  color: ${(p) => (p.$role === 'owner' ? '#0f766e' : p.$role === 'ai' ? '#9f1239' : '#475569')};
  background: ${(p) => (p.$role === 'owner' ? '#ccfbf1' : p.$role === 'ai' ? '#ffe4e6' : '#f1f5f9')};
  border-radius: 10px;
  flex-shrink: 0;
`;


// ─── 멤버 상세 드로어 ───
const MemberDrawerBackdrop = styled.div`
  position: fixed; inset: 0; background: rgba(15,23,42,0.2); z-index: 90;
`;
const MemberDrawer = styled.aside`
  position: fixed; top: 0; right: 0; bottom: 0; width: 440px; max-width: 100vw;
  background: #FFFFFF; border-left: 1px solid #E2E8F0; box-shadow: -4px 0 16px rgba(0,0,0,0.06);
  z-index: 100; display: flex; flex-direction: column;
  @media (max-width: 1024px) { width: min(560px, 90vw); }
  @media (max-width: 640px) { width: 100vw; border-left: none; box-shadow: none; }
`;
const MemberDrawerHeader = styled.div`
  display: flex; align-items: center; justify-content: space-between;
  min-height: 60px; padding: 14px 20px; border-bottom: 1px solid #E2E8F0;
`;
const MemberDrawerBack = styled.button`
  display: flex; align-items: center; gap: 4px; background: transparent; border: none;
  color: #0F766E; font-size: 12px; font-weight: 600; cursor: pointer; padding: 0;
  &:hover { color: #134E4A; }
`;
const MemberDrawerClose = styled.button`
  width: 28px; height: 28px; display: flex; align-items: center; justify-content: center;
  background: transparent; border: none; border-radius: 6px; color: #64748B; cursor: pointer;
  &:hover { background: #F1F5F9; color: #0F172A; }
`;
const MemberDrawerScroll = styled.div`flex: 1; overflow: auto; padding: 20px;`;
const DrawerHeadRow = styled.div`display: flex; align-items: center; gap: 14px; padding-bottom: 20px; border-bottom: 1px solid #F1F5F9;`;
const DrawerHeadText = styled.div`flex: 1; min-width: 0;`;
const DrawerName = styled.div`font-size: 18px; font-weight: 700; color: #0F172A;`;
const DrawerSub = styled.div`font-size: 13px; color: #64748B; margin-top: 4px;`;
const DrawerPendingNote = styled.div`font-size: 12px; color: #92400E; background: #FEF3C7; padding: 6px 10px; border-radius: 6px; margin-top: 6px; display: inline-block;`;
const DrawerSection = styled.section`padding: 20px 0; border-bottom: 1px solid #F1F5F9;`;
const DrawerSectionTitle = styled.h3`font-size: 13px; font-weight: 700; color: #0F172A; margin: 0 0 4px; text-transform: uppercase; letter-spacing: 0.3px;`;
const DrawerSectionHint = styled.p`font-size: 11px; color: #94A3B8; margin: 0 0 12px;`;
const DrawerInfoGrid = styled.div`
  display: grid; grid-template-columns: 90px 1fr; gap: 8px 14px; align-items: center;
`;
const DrawerInfoLabel = styled.div`font-size: 12px; color: #64748B; font-weight: 600;`;
const DrawerInfoValue = styled.div`font-size: 13px; color: #0F172A;`;
const DrawerBioBox = styled.div`
  margin-top: 12px; padding: 10px 12px; background: #F8FAFC;
  border-radius: 8px; font-size: 13px; color: #334155; line-height: 1.55; white-space: pre-wrap;
`;
const DrawerInlineInput = styled.input`
  width: 100%; max-width: 200px; height: 28px; padding: 0 8px; border: 1px solid #CBD5E1;
  border-radius: 6px; font-size: 13px; background: #FFFFFF;
  &:focus { outline: none; border-color: #14B8A6; box-shadow: 0 0 0 2px rgba(20,184,166,0.15); }
`;
const WorkHoursForm = styled.div`display: flex; gap: 16px; flex-wrap: wrap;`;
const WorkHoursField = styled.label`display: flex; flex-direction: column; gap: 4px; min-width: 90px;`;
const WorkHoursLabel = styled.span`font-size: 11px; color: #64748B; font-weight: 600;`;
const WorkHoursNumber = styled.input`
  width: 80px; height: 32px; padding: 0 8px; border: 1px solid #CBD5E1; border-radius: 6px;
  font-size: 13px; background: #FFFFFF;
  &:focus { outline: none; border-color: #14B8A6; box-shadow: 0 0 0 2px rgba(20,184,166,0.15); }
  &:disabled { background: #F8FAFC; color: #94A3B8; cursor: not-allowed; }
`;
const WorkHoursUnit = styled.span`font-size: 11px; color: #94A3B8; font-weight: 500; margin-top: -2px;`;

const DangerRow = styled.div`
  display: flex; align-items: center; justify-content: space-between; gap: 14px;
  padding: 10px 0;
`;
const DangerRowLabel = styled.span`font-size: 13px; color: #334155; font-weight: 600;`;
const RoleSelectWrap = styled.div`min-width: 140px;`;
const DangerBtn = styled.button`
  padding: 7px 14px; background: #FFFFFF; color: #DC2626;
  border: 1px solid #FECACA; border-radius: 8px; font-size: 12px; font-weight: 600; cursor: pointer;
  &:hover:not(:disabled) { background: #FEF2F2; border-color: #DC2626; }
  &:disabled { color: #CBD5E1; border-color: #E2E8F0; cursor: not-allowed; }
`;
const DangerError = styled.div`font-size: 12px; color: #DC2626; margin: 4px 0;`;
const ConfirmBox = styled.div`
  margin-top: 8px; padding: 12px; background: #FEF2F2; border: 1px solid #FECACA;
  border-radius: 8px; display: flex; flex-direction: column; gap: 10px;
`;
const ConfirmText = styled.div`font-size: 12px; color: #7F1D1D; line-height: 1.5;`;
const ConfirmRow = styled.div`display: flex; gap: 6px; justify-content: flex-end;`;

const ErrorBanner = styled.div`
  background: #fff1f2;
  border: 1px solid #fecdd3;
  color: #9f1239;
  padding: 10px 14px;
  border-radius: 8px;
  font-size: 13px;
  margin-bottom: 16px;
`;

const InfoBanner = styled.div`
  background: #f0fdfa;
  border: 1px solid #99f6e4;
  color: #0f766e;
  padding: 10px 14px;
  border-radius: 8px;
  font-size: 13px;
  margin-bottom: 16px;
`;

// ─────────────────────────────────────────────
// Page
// ─────────────────────────────────────────────
export default function WorkspaceSettingsPage() {
  const { t } = useTranslation('settings');
  const { user } = useAuth();
  const businessId = user?.business_id || 0;
  const isAdmin = user?.business_role === 'owner' || user?.platform_role === 'platform_admin';

  const location = useLocation();
  const params = useParams<{ tab?: string }>();
  const navigate = useNavigate();

  // /business/members 모드: 멤버/Cue 탭만 노출. 그 외: 설정 탭 4개만 노출.
  const isMembersMode = location.pathname.includes('/business/members');
  const visibleTabs = useMemo<TabKey[]>(() => (
    isMembersMode ? ['members', 'cue'] : ['brand', 'legal', 'language', 'timezone', 'storage', 'plan']
  ), [isMembersMode]);

  const tabFromUrl = useMemo<TabKey>(() => {
    const fromParam = (params.tab || '').toLowerCase();
    if (visibleTabs.includes(fromParam as TabKey)) return fromParam as TabKey;
    return visibleTabs[0];
  }, [params.tab, visibleTabs]);

  const [tab, setTab] = useState<TabKey>(tabFromUrl);
  useEffect(() => { setTab(tabFromUrl); }, [tabFromUrl]);

  const changeTab = useCallback((next: TabKey) => {
    setTab(next);
    if (isMembersMode) {
      navigate(next === 'members' ? '/business/members' : `/business/members/${next}`, { replace: true });
    } else if (location.pathname.startsWith('/business/')) {
      navigate(`/business/settings/${next}`, { replace: true });
    } else {
      navigate(`/settings/${next}`, { replace: true });
    }
  }, [isMembersMode, location.pathname, navigate]);
  const [ws, setWs] = useState<Workspace | null>(null);
  const [members, setMembers] = useState<WorkspaceMember[]>([]);
  const [inviteOpen, setInviteOpen] = useState(false);
  const [inviteEmail, setInviteEmail] = useState('');
  const [inviteRole, setInviteRole] = useState('');
  const [inviteBusy, setInviteBusy] = useState(false);
  const [inviteError, setInviteError] = useState<string | null>(null);
  const [selectedMemberId, setSelectedMemberId] = useState<number | null>(null);

  const [memberBusy, setMemberBusy] = useState(false);
  const [memberError, setMemberError] = useState<string | null>(null);
  const [confirmRemoveId, setConfirmRemoveId] = useState<number | null>(null);

  const handleRoleChange = async (memberId: number, nextRole: 'owner' | 'member') => {
    if (!businessId) return;
    setMemberBusy(true); setMemberError(null);
    try {
      await updateMemberRole(businessId, memberId, nextRole);
      const fresh = await listMembers(businessId);
      setMembers(fresh);
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      if (msg.includes('last_owner_protection')) setMemberError(t('members.drawer.errLastOwner', '마지막 관리자는 강등할 수 없습니다.') as string);
      else setMemberError(msg);
    } finally { setMemberBusy(false); }
  };

  const handleRemoveMember = async (memberId: number) => {
    if (!businessId) return;
    setMemberBusy(true); setMemberError(null);
    try {
      await removeMember(businessId, memberId);
      const fresh = await listMembers(businessId);
      setMembers(fresh);
      setSelectedMemberId(null);
      setConfirmRemoveId(null);
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      if (msg.includes('last_owner_protection')) setMemberError(t('members.drawer.errLastOwner', '마지막 관리자는 제거할 수 없습니다.') as string);
      else if (msg.includes('forbidden')) setMemberError(t('members.drawer.errForbidden', '제거 권한이 없습니다.') as string);
      else setMemberError(msg);
    } finally { setMemberBusy(false); }
  };

  const saveWorkHours = async (memberId: number, payload: { daily_work_hours?: number; weekly_work_days?: number; participation_rate?: number }) => {
    if (!businessId) return;
    try {
      const res = await apiFetch(`/api/businesses/${businessId}/members/${memberId}/work-hours`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });
      if (!res.ok) return;
      const fresh = await listMembers(businessId);
      setMembers(fresh);
    } catch { /* silent */ }
  };

  const sendMemberInvite = async () => {
    if (!businessId || !inviteEmail.trim()) return;
    setInviteBusy(true);
    setInviteError(null);
    try {
      await inviteMember(businessId, { email: inviteEmail.trim(), default_role: inviteRole.trim() || undefined });
      const fresh = await listMembers(businessId);
      setMembers(fresh);
      setInviteOpen(false);
      setInviteEmail('');
      setInviteRole('');
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      if (msg.includes('already_member')) setInviteError(t('members.inviteErrAlreadyMember', '이미 멤버로 등록되어 있습니다.') as string);
      else if (msg.includes('already_invited')) setInviteError(t('members.inviteErrAlreadyInvited', '이미 초대된 이메일입니다.') as string);
      else if (msg.includes('forbidden')) setInviteError(t('members.inviteErrForbidden', '초대 권한이 없습니다.') as string);
      else setInviteError(msg);
    } finally {
      setInviteBusy(false);
    }
  };
  const [cue, setCue] = useState<CueInfo | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // 로컬 편집 상태
  const [brandName, setBrandName] = useState('');
  const [brandNameEn, setBrandNameEn] = useState('');
  const [brandTagline, setBrandTagline] = useState('');
  const [brandTaglineEn, setBrandTaglineEn] = useState('');
  const [brandLogoUrl, setBrandLogoUrl] = useState('');
  const [brandColor, setBrandColor] = useState('#F43F5E');

  const [legalName, setLegalName] = useState('');
  const [legalNameEn, setLegalNameEn] = useState('');
  const [legalEntityType, setLegalEntityType] = useState<string>('');
  const [taxId, setTaxId] = useState('');
  const [representative, setRepresentative] = useState('');
  const [representativeEn, setRepresentativeEn] = useState('');
  const [address, setAddress] = useState('');
  const [addressEn, setAddressEn] = useState('');
  const [phone, setPhone] = useState('');
  const [email, setEmail] = useState('');
  const [website, setWebsite] = useState('');

  const [defaultLanguage, setDefaultLanguage] = useState<'ko' | 'en'>('ko');
  const [timezone, setTimezone] = useState('Asia/Seoul');

  // 초기 로드
  useEffect(() => {
    if (!businessId) return;
    let cancelled = false;
    (async () => {
      setLoading(true);
      setError(null);
      try {
        const [w, m, c] = await Promise.all([
          getWorkspace(businessId),
          listMembers(businessId).catch(() => []),
          getCueInfo(businessId).catch(() => null),
        ]);
        if (cancelled) return;
        setWs(w);
        setMembers(m);
        setCue(c);
        setBrandName(w.brand_name || w.name || '');
        setBrandNameEn(w.brand_name_en || '');
        setBrandTagline(w.brand_tagline || '');
        setBrandTaglineEn(w.brand_tagline_en || '');
        setBrandLogoUrl(w.brand_logo_url || '');
        setBrandColor(w.brand_color || '#F43F5E');
        setLegalName(w.legal_name || '');
        setLegalNameEn(w.legal_name_en || '');
        setLegalEntityType(w.legal_entity_type || '');
        setTaxId(w.tax_id || '');
        setRepresentative(w.representative || '');
        setRepresentativeEn(w.representative_en || '');
        setAddress(w.address || '');
        setAddressEn(w.address_en || '');
        setPhone(w.phone || '');
        setEmail(w.email || '');
        setWebsite(w.website || '');
        setDefaultLanguage((w.default_language as 'ko' | 'en') || 'ko');
        setTimezone(w.timezone || 'Asia/Seoul');
      } catch (e) {
        if (!cancelled) setError((e as Error).message);
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, [businessId]);

  const showEn = defaultLanguage === 'ko';

  // Save handlers
  const saveBrand = useCallback(async (payload: Partial<Workspace>) => {
    if (!businessId) return;
    const updated = await updateBrand(businessId, payload);
    setWs(updated);
  }, [businessId]);

  const saveLegal = useCallback(async (payload: Partial<Workspace>) => {
    if (!businessId) return;
    const updated = await updateLegal(businessId, payload);
    setWs(updated);
  }, [businessId]);

  const saveSettings = useCallback(async (payload: Partial<Workspace>) => {
    if (!businessId) return;
    const updated = await updateSettings(businessId, payload);
    setWs(updated);
  }, [businessId]);

  const changeCueMode = useCallback(async (mode: 'smart' | 'auto' | 'draft') => {
    if (!businessId) return;
    await updateCue(businessId, { mode });
    const c = await getCueInfo(businessId);
    setCue(c);
  }, [businessId]);

  const togglePause = useCallback(async () => {
    if (!businessId || !cue) return;
    const nextPaused = !cue.paused;
    await updateCue(businessId, { paused: nextPaused });
    const c = await getCueInfo(businessId);
    setCue(c);
  }, [businessId, cue]);

  const usageRatio = useMemo(() => {
    if (!cue) return 0;
    return cue.usage.limit > 0 ? cue.usage.action_count / cue.usage.limit : 0;
  }, [cue]);

  if (loading) {
    return (
      <PageShell title={t(isMembersMode ? 'membersPage.title' : 'page.title')}>
        <Card>Loading...</Card>
      </PageShell>
    );
  }

  if (!businessId || !ws) {
    return (
      <PageShell title={t(isMembersMode ? 'membersPage.title' : 'page.title')}>
        <Card>{error || 'No workspace'}</Card>
      </PageShell>
    );
  }

  return (
    <PageShell title={t(isMembersMode ? 'membersPage.title' : 'page.title')}>
      {error && <ErrorBanner>{error}</ErrorBanner>}
      {!isAdmin && <InfoBanner>{t('messages.adminRequired')}</InfoBanner>}

      <Tabs>
        {visibleTabs.includes('brand') && <Tab active={tab === 'brand'} onClick={() => changeTab('brand')}>{t('tabs.brand')}</Tab>}
        {visibleTabs.includes('legal') && <Tab active={tab === 'legal'} onClick={() => changeTab('legal')}>{t('tabs.legal')}</Tab>}
        {visibleTabs.includes('language') && <Tab active={tab === 'language'} onClick={() => changeTab('language')}>{t('tabs.language')}</Tab>}
        {visibleTabs.includes('timezone') && <Tab active={tab === 'timezone'} onClick={() => changeTab('timezone')}>{t('tabs.timezone')}</Tab>}
        {visibleTabs.includes('storage') && <Tab active={tab === 'storage'} onClick={() => changeTab('storage')}>{t('tabs.storage', '파일 저장소')}</Tab>}
        {visibleTabs.includes('plan') && <Tab active={tab === 'plan'} onClick={() => changeTab('plan')}>{t('tabs.plan', '구독 플랜')}</Tab>}
        {visibleTabs.includes('members') && <Tab active={tab === 'members'} onClick={() => changeTab('members')}>{t('tabs.members')}</Tab>}
        {visibleTabs.includes('cue') && <Tab active={tab === 'cue'} onClick={() => changeTab('cue')}>{t('tabs.cue')}</Tab>}
      </Tabs>

      {/* ─── BRAND ─── */}
      {tab === 'brand' && (
        <Card>
          <SectionTitle>{t('brand.sectionTitle')}</SectionTitle>
          <SectionDesc>{t('brand.sectionDesc')}</SectionDesc>

          <FieldGrid>
            <Field>
              <Label>{t('brand.name')}</Label>
              <AutoSaveField
                type="input"
                onSave={async () => { await saveBrand({ brand_name: brandName }); }}
              >
                <TextInput
                  value={brandName}
                  onChange={(e) => setBrandName(e.target.value)}
                  placeholder={t('brand.namePlaceholder') || ''}
                  disabled={!isAdmin}
                />
              </AutoSaveField>
            </Field>

            {showEn && (
              <Field>
                <Label>
                  {t('brand.nameEn')}
                  <LabelHint>{t('brand.nameEnHint')}</LabelHint>
                </Label>
                <AutoSaveField
                  type="input"
                  onSave={async () => { await saveBrand({ brand_name_en: brandNameEn || null }); }}
                >
                  <TextInput
                    value={brandNameEn}
                    onChange={(e) => setBrandNameEn(e.target.value)}
                    placeholder={t('brand.nameEnPlaceholder') || ''}
                    disabled={!isAdmin}
                  />
                </AutoSaveField>
              </Field>
            )}

            <Field $full>
              <Label>{t('brand.tagline')}</Label>
              <AutoSaveField
                type="input"
                onSave={async () => { await saveBrand({ brand_tagline: brandTagline || null }); }}
              >
                <TextInput
                  value={brandTagline}
                  onChange={(e) => setBrandTagline(e.target.value)}
                  placeholder={t('brand.taglinePlaceholder') || ''}
                  disabled={!isAdmin}
                />
              </AutoSaveField>
            </Field>

            {showEn && (
              <Field $full>
                <Label>{t('brand.taglineEn')}</Label>
                <AutoSaveField
                  type="input"
                  onSave={async () => { await saveBrand({ brand_tagline_en: brandTaglineEn || null }); }}
                >
                  <TextInput
                    value={brandTaglineEn}
                    onChange={(e) => setBrandTaglineEn(e.target.value)}
                    disabled={!isAdmin}
                  />
                </AutoSaveField>
              </Field>
            )}

            <Field $full>
              <Label>{t('brand.logoUrl')}</Label>
              <AutoSaveField
                type="input"
                onSave={async () => { await saveBrand({ brand_logo_url: brandLogoUrl || null }); }}
              >
                <TextInput
                  value={brandLogoUrl}
                  onChange={(e) => setBrandLogoUrl(e.target.value)}
                  placeholder={t('brand.logoUrlPlaceholder') || ''}
                  disabled={!isAdmin}
                />
              </AutoSaveField>
            </Field>

            <Field>
              <Label>
                {t('brand.color')}
                <LabelHint>{t('brand.colorHint')}</LabelHint>
              </Label>
              <AutoSaveField
                type="input"
                debounceMs={500}
                onSave={async () => { await saveBrand({ brand_color: brandColor }); }}
              >
                <ColorRow>
                  <ColorSwatch
                    value={brandColor}
                    onChange={(e) => setBrandColor(e.target.value)}
                    disabled={!isAdmin}
                  />
                  <TextInput
                    style={{ flex: 1 }}
                    value={brandColor}
                    onChange={(e) => setBrandColor(e.target.value)}
                    placeholder="#F43F5E"
                    disabled={!isAdmin}
                  />
                </ColorRow>
              </AutoSaveField>
            </Field>
          </FieldGrid>
        </Card>
      )}

      {/* ─── LEGAL ─── */}
      {tab === 'legal' && (
        <Card>
          <SectionTitle>{t('legal.sectionTitle')}</SectionTitle>
          <SectionDesc>{t('legal.sectionDesc')}</SectionDesc>

          <FieldGrid>
            <Field>
              <Label>{t('legal.legalName')}</Label>
              <AutoSaveField type="input" onSave={async () => { await saveLegal({ legal_name: legalName || null }); }}>
                <TextInput
                  value={legalName}
                  onChange={(e) => setLegalName(e.target.value)}
                  placeholder={t('legal.legalNamePlaceholder') || ''}
                  disabled={!isAdmin}
                />
              </AutoSaveField>
            </Field>

            {showEn && (
              <Field>
                <Label>{t('legal.legalNameEn')}</Label>
                <AutoSaveField type="input" onSave={async () => { await saveLegal({ legal_name_en: legalNameEn || null }); }}>
                  <TextInput
                    value={legalNameEn}
                    onChange={(e) => setLegalNameEn(e.target.value)}
                    placeholder={t('legal.legalNameEnPlaceholder') || ''}
                    disabled={!isAdmin}
                  />
                </AutoSaveField>
              </Field>
            )}

            <Field>
              <Label>{t('legal.entityType')}</Label>
              <AutoSaveField
                type="select"
                onSave={async () => { await saveLegal({ legal_entity_type: (legalEntityType as 'corporation' | 'individual' | 'llc' | 'other') || null }); }}
              >
                {(() => {
                  const entityOpts = [
                    { value: '', label: '—' },
                    { value: 'corporation', label: t('legal.entityTypeCorporation') },
                    { value: 'individual', label: t('legal.entityTypeIndividual') },
                    { value: 'llc', label: t('legal.entityTypeLlc') },
                    { value: 'other', label: t('legal.entityTypeOther') },
                  ];
                  return (
                    <PlanQSelect
                      value={entityOpts.find((o) => o.value === legalEntityType) || null}
                      onChange={(opt) => {
                        const v = (opt as { value: string } | null)?.value ?? '';
                        setLegalEntityType(v);
                      }}
                      options={entityOpts}
                      isDisabled={!isAdmin}
                      size="sm"
                    />
                  );
                })()}
              </AutoSaveField>
            </Field>

            <Field>
              <Label>{t('legal.taxId')}</Label>
              <AutoSaveField type="input" onSave={async () => { await saveLegal({ tax_id: taxId || null }); }}>
                <TextInput
                  value={taxId}
                  onChange={(e) => setTaxId(e.target.value)}
                  placeholder={t('legal.taxIdPlaceholder') || ''}
                  disabled={!isAdmin}
                />
              </AutoSaveField>
            </Field>

            <Field>
              <Label>{t('legal.representative')}</Label>
              <AutoSaveField type="input" onSave={async () => { await saveLegal({ representative: representative || null }); }}>
                <TextInput value={representative} onChange={(e) => setRepresentative(e.target.value)} disabled={!isAdmin} />
              </AutoSaveField>
            </Field>

            {showEn && (
              <Field>
                <Label>{t('legal.representativeEn')}</Label>
                <AutoSaveField type="input" onSave={async () => { await saveLegal({ representative_en: representativeEn || null }); }}>
                  <TextInput value={representativeEn} onChange={(e) => setRepresentativeEn(e.target.value)} disabled={!isAdmin} />
                </AutoSaveField>
              </Field>
            )}

            <Field $full>
              <Label>{t('legal.address')}</Label>
              <AutoSaveField type="input" onSave={async () => { await saveLegal({ address: address || null }); }}>
                <TextInput value={address} onChange={(e) => setAddress(e.target.value)} disabled={!isAdmin} />
              </AutoSaveField>
            </Field>

            {showEn && (
              <Field $full>
                <Label>{t('legal.addressEn')}</Label>
                <AutoSaveField type="input" onSave={async () => { await saveLegal({ address_en: addressEn || null }); }}>
                  <TextInput value={addressEn} onChange={(e) => setAddressEn(e.target.value)} disabled={!isAdmin} />
                </AutoSaveField>
              </Field>
            )}

            <Field>
              <Label>{t('legal.phone')}</Label>
              <AutoSaveField type="input" onSave={async () => { await saveLegal({ phone: phone || null }); }}>
                <TextInput value={phone} onChange={(e) => setPhone(e.target.value)} disabled={!isAdmin} />
              </AutoSaveField>
            </Field>

            <Field>
              <Label>{t('legal.email')}</Label>
              <AutoSaveField type="input" onSave={async () => { await saveLegal({ email: email || null }); }}>
                <TextInput value={email} onChange={(e) => setEmail(e.target.value)} disabled={!isAdmin} />
              </AutoSaveField>
            </Field>

            <Field $full>
              <Label>{t('legal.website')}</Label>
              <AutoSaveField type="input" onSave={async () => { await saveLegal({ website: website || null }); }}>
                <TextInput value={website} onChange={(e) => setWebsite(e.target.value)} disabled={!isAdmin} />
              </AutoSaveField>
            </Field>
          </FieldGrid>
        </Card>
      )}

      {/* ─── LANGUAGE ─── */}
      {tab === 'language' && (
        <Card>
          <SectionTitle>{t('language.sectionTitle')}</SectionTitle>
          <SectionDesc>{t('language.sectionDesc')}</SectionDesc>

          <FieldGrid>
            <Field>
              <Label>
                {t('language.defaultLanguage')}
                <LabelHint>{t('language.defaultLanguageHint')}</LabelHint>
              </Label>
              <AutoSaveField
                type="select"
                onSave={async () => { await saveSettings({ default_language: defaultLanguage }); }}
              >
                {(() => {
                  const langOpts = [
                    { value: 'ko', label: t('language.languageKo') },
                    { value: 'en', label: t('language.languageEn') },
                  ];
                  return (
                    <PlanQSelect
                      value={langOpts.find((o) => o.value === defaultLanguage) || null}
                      onChange={(opt) => {
                        const v = (opt as { value: string } | null)?.value as 'ko' | 'en' | undefined;
                        if (v) setDefaultLanguage(v);
                      }}
                      options={langOpts}
                      isDisabled={!isAdmin}
                      size="sm"
                    />
                  );
                })()}
              </AutoSaveField>
            </Field>

          </FieldGrid>
        </Card>
      )}

      {/* ─── TIMEZONE ─── */}
      {tab === 'timezone' && (
        <WorkspaceTimezoneSection
          businessId={businessId}
          isAdmin={isAdmin}
          timezone={timezone}
          setTimezone={setTimezone}
          saveSettings={saveSettings}
        />
      )}

      {/* ─── STORAGE (외부 클라우드 연동) ─── */}
      {tab === 'storage' && businessId && (
        <StorageSettings businessId={businessId} />
      )}

      {/* ─── PLAN (구독 플랜) ─── */}
      {tab === 'plan' && businessId && (
        <PlanSettings businessId={businessId} />
      )}

      {/* ─── MEMBERS ─── */}
      {tab === 'members' && (
        <>
          <Card>
            <SectionHeaderRow>
              <div>
                <SectionTitle>{t('members.sectionTitle')}</SectionTitle>
                <SectionDesc>{t('members.sectionDesc')}</SectionDesc>
              </div>
              {isAdmin && !inviteOpen && (
                <InvitePrimaryBtn type="button" onClick={() => { setInviteOpen(true); setInviteError(null); }}>
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round">
                    <line x1="12" y1="5" x2="12" y2="19" /><line x1="5" y1="12" x2="19" y2="12" />
                  </svg>
                  {t('members.inviteBtn', '멤버 초대')}
                </InvitePrimaryBtn>
              )}
            </SectionHeaderRow>

            {isAdmin && inviteOpen && (
              <InviteBox>
                <InviteInputRow>
                  <InviteInput
                    type="email"
                    autoFocus
                    placeholder={t('members.invitePlaceholder', '초대할 이메일') as string}
                    value={inviteEmail}
                    onChange={(e) => setInviteEmail(e.target.value)}
                    onKeyDown={(e) => { if (e.key === 'Enter' && inviteEmail.trim()) sendMemberInvite(); }}
                  />
                  <InviteRoleInput
                    type="text"
                    placeholder={t('members.defaultRolePlaceholder', 'e.g. Design') as string}
                    value={inviteRole}
                    onChange={(e) => setInviteRole(e.target.value)}
                  />
                </InviteInputRow>
                {inviteError && <InviteError>{inviteError}</InviteError>}
                <InviteActionRow>
                  <InviteCancel type="button" onClick={() => { setInviteOpen(false); setInviteEmail(''); setInviteRole(''); setInviteError(null); }}>
                    {t('members.inviteCancel', '취소')}
                  </InviteCancel>
                  <InviteSubmit type="button" disabled={inviteBusy || !inviteEmail.trim()} onClick={sendMemberInvite}>
                    {inviteBusy ? t('members.inviteSending', '전송 중...') : t('members.inviteSend', '초대 보내기')}
                  </InviteSubmit>
                </InviteActionRow>
              </InviteBox>
            )}

            {members.length === 0 && <div style={{ color: '#94a3b8', fontSize: 13 }}>{t('members.emptyMembers')}</div>}
            {members.map((m) => {
              const isAi = m.role === 'ai' || !!m.user?.is_ai;
              const isPending = !m.user_id && !!m.invite_email;
              const displayName = isPending ? (m.invite_email || '') : (m.user?.name || '');
              const firstLetter = (displayName || '?').charAt(0).toUpperCase();
              const roleLabel = m.role === 'owner'
                ? t('members.roleAdmin')
                : m.role === 'ai'
                  ? t('members.roleAi')
                  : t('members.roleMember');
              const subLine = isAi
                ? t('members.cueCardDesc')
                : isPending
                  ? t('members.pendingInvite', '초대 대기 중')
                  : m.user?.job_title || m.user?.email || '';
              return (
                <MemberRow key={m.id} $ai={isAi} $clickable={!isAi}
                  onClick={() => { if (!isAi) setSelectedMemberId((cur) => cur === m.id ? null : m.id); }}>
                  <Avatar $ai={isAi}>{isAi ? 'C' : firstLetter}</Avatar>
                  <MemberInfo>
                    <MemberNameRow>
                      <MemberName>{displayName || t('members.pendingInvite', '초대 대기 중')}</MemberName>
                      {!isAi && !isPending && m.user?.organization && <MemberOrg>· {m.user.organization}</MemberOrg>}
                    </MemberNameRow>
                    <MemberEmail>{subLine}</MemberEmail>
                  </MemberInfo>
                  {!isAi && m.default_role && <DefaultRoleBadge>{m.default_role}</DefaultRoleBadge>}
                  <RoleBadge $role={m.role}>{roleLabel}</RoleBadge>
                </MemberRow>
              );
            })}
          </Card>

          {/* 멤버 상세 드로어 */}
          {selectedMemberId != null && (() => {
            const target = members.find((m) => m.id === selectedMemberId);
            if (!target) return null;
            const isSelf = target.user_id != null && String(target.user_id) === String(user?.id);
            const canEditHours = isSelf || isAdmin;
            const isPending = !target.user_id && !!target.invite_email;
            const u = target.user;
            const fmtLastLogin = u?.last_login_at ? new Date(u.last_login_at).toLocaleString() : '—';
            return (
              <>
                <MemberDrawerBackdrop onClick={() => setSelectedMemberId(null)} />
                <MemberDrawer role="dialog" aria-modal="true" aria-label={u?.name || 'member'}>
                  <MemberDrawerHeader>
                    <MemberDrawerBack type="button" onClick={() => setSelectedMemberId(null)}>
                      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><polyline points="15 18 9 12 15 6"/></svg>
                      {t('members.drawer.back', '목록')}
                    </MemberDrawerBack>
                    <MemberDrawerClose type="button" onClick={() => setSelectedMemberId(null)} aria-label={t('members.drawer.close', '닫기') as string}>
                      <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
                    </MemberDrawerClose>
                  </MemberDrawerHeader>

                  <MemberDrawerScroll>
                    <DrawerHeadRow>
                      <Avatar $ai={false} style={{ width: 56, height: 56, fontSize: 22 }}>
                        {(isPending ? (target.invite_email || '?') : (u?.name || '?')).charAt(0).toUpperCase()}
                      </Avatar>
                      <DrawerHeadText>
                        <DrawerName>{isPending ? (target.invite_email || '') : (u?.name || '')}</DrawerName>
                        {!isPending && u?.job_title && <DrawerSub>{u.job_title}{u.organization ? ` · ${u.organization}` : ''}</DrawerSub>}
                        {isPending && <DrawerPendingNote>{t('members.pendingNote', '초대 수락 후 프로필이 표시됩니다.')}</DrawerPendingNote>}
                      </DrawerHeadText>
                      <RoleBadge $role={target.role}>
                        {target.role === 'owner' ? t('members.roleAdmin') : target.role === 'ai' ? t('members.roleAi') : t('members.roleMember')}
                      </RoleBadge>
                    </DrawerHeadRow>

                    {!isPending && (
                      <>
                        <DrawerSection>
                          <DrawerSectionTitle>{t('members.drawer.profile', '프로필')}</DrawerSectionTitle>
                          <DrawerSectionHint>{t('members.drawer.profileHint', '본인만 수정 가능합니다.')}</DrawerSectionHint>
                          <DrawerInfoGrid>
                            <DrawerInfoLabel>{t('members.drawer.email', '이메일')}</DrawerInfoLabel>
                            <DrawerInfoValue>{u?.email || '—'}</DrawerInfoValue>
                            <DrawerInfoLabel>{t('members.drawer.phone', '전화')}</DrawerInfoLabel>
                            <DrawerInfoValue>{u?.phone || '—'}</DrawerInfoValue>
                            <DrawerInfoLabel>{t('members.drawer.jobTitle', '직책')}</DrawerInfoLabel>
                            <DrawerInfoValue>{u?.job_title || '—'}</DrawerInfoValue>
                            <DrawerInfoLabel>{t('members.drawer.organization', '소속')}</DrawerInfoLabel>
                            <DrawerInfoValue>{u?.organization || '—'}</DrawerInfoValue>
                            {u?.expertise && <>
                              <DrawerInfoLabel>{t('members.drawer.expertise', '전문분야')}</DrawerInfoLabel>
                              <DrawerInfoValue>{u.expertise}</DrawerInfoValue>
                            </>}
                            {u?.timezone && <>
                              <DrawerInfoLabel>{t('members.drawer.timezone', '타임존')}</DrawerInfoLabel>
                              <DrawerInfoValue>{u.timezone}</DrawerInfoValue>
                            </>}
                          </DrawerInfoGrid>
                          {u?.bio && <DrawerBioBox>{u.bio}</DrawerBioBox>}
                        </DrawerSection>

                        <DrawerSection>
                          <DrawerSectionTitle>{t('members.drawer.workspace', '워크스페이스 정보')}</DrawerSectionTitle>
                          <DrawerInfoGrid>
                            <DrawerInfoLabel>{t('members.drawer.defaultRole', '기본 역할')}</DrawerInfoLabel>
                            <DrawerInfoValue>
                              {isAdmin ? (
                                <DrawerInlineInput
                                  type="text"
                                  placeholder={t('members.defaultRolePlaceholder', 'e.g. Design') as string}
                                  defaultValue={target.default_role || ''}
                                  onBlur={async (e) => {
                                    const val = e.target.value.trim();
                                    try {
                                      await apiFetch(`/api/businesses/${businessId}/members/${target.id}/default-role`, {
                                        method: 'PATCH',
                                        headers: { 'Content-Type': 'application/json' },
                                        body: JSON.stringify({ default_role: val || null }),
                                      });
                                      const fresh = await listMembers(businessId);
                                      setMembers(fresh);
                                    } catch { /* silent */ }
                                  }}
                                />
                              ) : (
                                <span>{target.default_role || '—'}</span>
                              )}
                            </DrawerInfoValue>
                            <DrawerInfoLabel>{t('members.drawer.joinedAt', '참여일')}</DrawerInfoLabel>
                            <DrawerInfoValue>{target.joined_at ? new Date(target.joined_at).toLocaleDateString() : '—'}</DrawerInfoValue>
                            <DrawerInfoLabel>{t('members.drawer.lastLogin', '마지막 활동')}</DrawerInfoLabel>
                            <DrawerInfoValue>{fmtLastLogin}</DrawerInfoValue>
                          </DrawerInfoGrid>
                        </DrawerSection>

                        <DrawerSection>
                          <DrawerSectionTitle>{t('members.drawer.workHours', '가용시간')}</DrawerSectionTitle>
                          <DrawerSectionHint>
                            {canEditHours
                              ? t('members.drawer.workHoursHint', '본인 또는 관리자가 조정할 수 있습니다. 업무 배정/예측 계산에 사용됩니다.')
                              : t('members.drawer.workHoursReadOnly', '본인 또는 관리자만 수정할 수 있습니다.')}
                          </DrawerSectionHint>
                          <WorkHoursForm>
                            <WorkHoursField>
                              <WorkHoursLabel>{t('members.drawer.dailyHours', '하루 업무 시간')}</WorkHoursLabel>
                              <WorkHoursNumber
                                type="number" min="0" max="24" step="0.5"
                                disabled={!canEditHours}
                                defaultValue={Number(target.daily_work_hours ?? 8)}
                                onBlur={(e) => saveWorkHours(target.id, { daily_work_hours: Number(e.target.value) })}
                              />
                              <WorkHoursUnit>h</WorkHoursUnit>
                            </WorkHoursField>
                            <WorkHoursField>
                              <WorkHoursLabel>{t('members.drawer.weeklyDays', '주간 근무일')}</WorkHoursLabel>
                              <WorkHoursNumber
                                type="number" min="1" max="7" step="1"
                                disabled={!canEditHours}
                                defaultValue={Number(target.weekly_work_days ?? 5)}
                                onBlur={(e) => saveWorkHours(target.id, { weekly_work_days: Number(e.target.value) })}
                              />
                              <WorkHoursUnit>{t('members.drawer.daysSuffix', '일')}</WorkHoursUnit>
                            </WorkHoursField>
                            <WorkHoursField>
                              <WorkHoursLabel>{t('members.drawer.participation', '참여율')}</WorkHoursLabel>
                              <WorkHoursNumber
                                type="number" min="0" max="100" step="5"
                                disabled={!canEditHours}
                                defaultValue={Math.round(Number(target.participation_rate ?? 1) * 100)}
                                onBlur={(e) => saveWorkHours(target.id, { participation_rate: Math.max(0, Math.min(1, Number(e.target.value) / 100)) })}
                              />
                              <WorkHoursUnit>%</WorkHoursUnit>
                            </WorkHoursField>
                          </WorkHoursForm>
                        </DrawerSection>
                      </>
                    )}

                    {/* Danger Zone */}
                    {(isAdmin || isSelf) && target.role !== 'ai' && (
                      <DrawerSection>
                        <DrawerSectionTitle>{t('members.drawer.danger', 'Danger Zone')}</DrawerSectionTitle>

                        {/* 역할 변경 — 오너만, 본인은 강등 시 경고 */}
                        {isAdmin && !isPending && (() => {
                          const roleOpts = [
                            { value: 'member', label: t('members.roleMember') as string },
                            { value: 'owner', label: t('members.roleAdmin') as string },
                          ];
                          return (
                            <DangerRow>
                              <DangerRowLabel>{t('members.drawer.role', '역할')}</DangerRowLabel>
                              <RoleSelectWrap>
                                <PlanQSelect
                                  value={roleOpts.find((o) => o.value === target.role) || null}
                                  onChange={(opt) => {
                                    const v = (opt as { value: string } | null)?.value;
                                    if (v === 'owner' || v === 'member') handleRoleChange(target.id, v);
                                  }}
                                  options={roleOpts}
                                  isDisabled={memberBusy}
                                  size="sm"
                                />
                              </RoleSelectWrap>
                            </DangerRow>
                          );
                        })()}

                        {memberError && <DangerError>{memberError}</DangerError>}

                        {/* 제거 / 나가기 / 초대 취소 */}
                        <DangerRow>
                          <DangerRowLabel>
                            {isPending
                              ? t('members.drawer.cancelInviteLabel', '초대')
                              : isSelf
                                ? t('members.drawer.leaveLabel', '워크스페이스')
                                : t('members.drawer.removeLabel', '멤버')}
                          </DangerRowLabel>
                          <DangerBtn type="button" disabled={memberBusy} onClick={() => setConfirmRemoveId(target.id)}>
                            {isPending
                              ? t('members.drawer.cancelInvite', '초대 취소')
                              : isSelf
                                ? t('members.drawer.leave', '워크스페이스 나가기')
                                : t('members.drawer.remove', '멤버 제거')}
                          </DangerBtn>
                        </DangerRow>

                        {confirmRemoveId === target.id && (
                          <ConfirmBox>
                            <ConfirmText>
                              {isPending
                                ? t('members.drawer.cancelInviteConfirm', '이 초대를 취소할까요? 초대 링크가 무효화됩니다.')
                                : isSelf
                                  ? t('members.drawer.leaveConfirm', '이 워크스페이스에서 나가시겠습니까? 과거 업무 이력은 보존됩니다.')
                                  : t('members.drawer.removeConfirm', '이 멤버를 워크스페이스에서 제거합니다. 과거 업무 이력은 보존됩니다.')}
                            </ConfirmText>
                            <ConfirmRow>
                              <InviteCancel type="button" onClick={() => setConfirmRemoveId(null)}>
                                {t('members.inviteCancel', '취소')}
                              </InviteCancel>
                              <DangerBtn type="button" disabled={memberBusy} onClick={() => handleRemoveMember(target.id)}>
                                {memberBusy ? t('members.drawer.removing', '처리 중...') : (
                                  isPending ? t('members.drawer.cancelInvite', '초대 취소')
                                    : isSelf ? t('members.drawer.leave', '나가기')
                                      : t('members.drawer.remove', '제거')
                                )}
                              </DangerBtn>
                            </ConfirmRow>
                          </ConfirmBox>
                        )}
                      </DrawerSection>
                    )}
                  </MemberDrawerScroll>
                </MemberDrawer>
              </>
            );
          })()}
        </>
      )}

      {/* ─── CUE ─── */}
      {tab === 'cue' && cue && (
        <>
          <Card>
            <SectionTitle>{t('cue.sectionTitle')}</SectionTitle>
            <SectionDesc>{t('cue.sectionDesc')}</SectionDesc>

            <div style={{ marginTop: 8 }}>
              <Label>{t('cue.modeTitle')}</Label>
              <div style={{ marginTop: 10 }}>
                {(['smart', 'auto', 'draft'] as const).map((m) => (
                  <ModeCard
                    key={m}
                    $active={cue.mode === m}
                    $disabled={!isAdmin}
                    onClick={() => { if (isAdmin && cue.mode !== m) changeCueMode(m); }}
                  >
                    <ModeRadio
                      checked={cue.mode === m}
                      readOnly
                      disabled={!isAdmin}
                      onChange={() => {}}
                    />
                    <ModeBody>
                      <ModeTitle>{t(`cue.mode${m.charAt(0).toUpperCase() + m.slice(1)}`)}</ModeTitle>
                      <ModeHint>{t(`cue.mode${m.charAt(0).toUpperCase() + m.slice(1)}Hint`)}</ModeHint>
                    </ModeBody>
                  </ModeCard>
                ))}
              </div>
            </div>

            <PauseToggleRow>
              <div>
                <div style={{ fontSize: 14, fontWeight: 600, color: '#0f172a' }}>{t('cue.pauseTitle')}</div>
                <div style={{ fontSize: 12, color: '#64748b', marginTop: 2 }}>{t('cue.pauseHint')}</div>
                <div style={{ fontSize: 11, color: cue.paused ? '#f43f5e' : '#14b8a6', marginTop: 4, fontWeight: 700 }}>
                  {cue.paused ? t('cue.paused') : t('cue.active')}
                </div>
              </div>
              <Switch $on={cue.paused} onClick={() => { if (isAdmin) togglePause(); }} disabled={!isAdmin} />
            </PauseToggleRow>
          </Card>

          <Card>
            <SectionTitle>{t('cue.usageTitle')}</SectionTitle>
            <UsageBar>
              <UsageFill $ratio={usageRatio} $over={cue.usage.action_count >= cue.usage.limit} />
            </UsageBar>
            <UsageStats>
              <UsageStat>
                <UsageStatLabel>{t('cue.usageLimit')}</UsageStatLabel>
                <UsageStatValue>{cue.usage.limit.toLocaleString()}</UsageStatValue>
              </UsageStat>
              <UsageStat>
                <UsageStatLabel>{t('cue.usageRemaining')}</UsageStatLabel>
                <UsageStatValue>{cue.usage.remaining.toLocaleString()}</UsageStatValue>
              </UsageStat>
              <UsageStat>
                <UsageStatLabel>{t('cue.usageCost')}</UsageStatLabel>
                <UsageStatValue>${cue.usage.cost_usd.toFixed(4)}</UsageStatValue>
              </UsageStat>
            </UsageStats>

            {cue.usage.action_count >= cue.usage.limit && (
              <div style={{ background: '#fff1f2', border: '1px solid #fecdd3', color: '#9f1239', padding: '10px 14px', borderRadius: 8, fontSize: 13, marginTop: 14 }}>
                {t('cue.usageExceeded')}
              </div>
            )}

            <div style={{ marginTop: 18 }}>
              <Label>{t('cue.usageByType')}</Label>
              <ByTypeList>
                {Object.entries(cue.usage.by_type).length === 0 && (
                  <div style={{ color: '#94a3b8' }}>—</div>
                )}
                {Object.entries(cue.usage.by_type).map(([type, count]) => {
                  const labelKey = ({
                    answer: 'cue.usageAnswer',
                    task_execute: 'cue.usageTaskExecute',
                    summary: 'cue.usageSummary',
                    kb_embed: 'cue.usageKbEmbed',
                  } as Record<string, string>)[type] || type;
                  return (
                    <ByTypeRow key={type}>
                      <span>{t(labelKey, { defaultValue: type })}</span>
                      <span style={{ fontWeight: 700 }}>{count.toLocaleString()}</span>
                    </ByTypeRow>
                  );
                })}
              </ByTypeList>
            </div>
          </Card>
        </>
      )}
    </PageShell>
  );
}

// ─────────────────────────────────────────────
// Timezone 섹션 (서브 컴포넌트)
// ─────────────────────────────────────────────
const TzCallout = styled.div`
  display: flex;
  align-items: flex-start;
  gap: 10px;
  padding: 12px 14px;
  margin-bottom: 16px;
  background: #F0FDFA;
  border: 1px solid #CCFBF1;
  border-radius: 10px;
  color: #0F766E;
  font-size: 13px;
  line-height: 1.55;
`;
const TzCalloutIcon = styled.span`
  flex: 0 0 18px;
  width: 18px; height: 18px;
  border-radius: 50%;
  background: #0F766E;
  color: #F0FDFA;
  font-size: 11px;
  font-weight: 700;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  margin-top: 1px;
`;
const TzCalloutBody = styled.div`
  flex: 1 1 auto;
`;

const TzPreviewCard = styled.div`
  background: linear-gradient(135deg, #0f766e 0%, #115E59 100%);
  color: #F0FDFA;
  border-radius: 14px;
  padding: 22px 24px;
  margin-bottom: 20px;
  display: flex;
  align-items: flex-end;
  justify-content: space-between;
  gap: 20px;
  box-shadow: 0 10px 30px -10px rgba(15, 118, 110, 0.35);
`;

const TzPreviewLeft = styled.div`
  display: flex;
  flex-direction: column;
  gap: 4px;
  min-width: 0;
`;

const TzPreviewLabel = styled.div`
  font-size: 10px;
  font-weight: 700;
  letter-spacing: 1px;
  text-transform: uppercase;
  color: #5EEAD4;
`;

const TzPreviewCity = styled.div`
  font-size: 22px;
  font-weight: 700;
  color: #FFFFFF;
  letter-spacing: -0.5px;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
`;

const TzPreviewSub = styled.div`
  font-size: 12px;
  color: rgba(204, 251, 241, 0.7);
`;

const TzPreviewTime = styled.div`
  font-size: 40px;
  font-weight: 700;
  color: #FFFFFF;
  font-variant-numeric: tabular-nums;
  letter-spacing: -1.5px;
  line-height: 1;
`;

const ChipRow = styled.div`
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
  margin-top: 12px;
`;

const Chip = styled.div`
  display: inline-flex;
  align-items: center;
  gap: 8px;
  padding: 6px 10px 6px 12px;
  background: #f1f5f9;
  border: 1px solid #e2e8f0;
  border-radius: 999px;
  font-size: 12px;
  color: #0f172a;
`;

const ChipCity = styled.span`
  font-weight: 600;
`;

const ChipMeta = styled.span`
  color: #64748b;
  font-size: 11px;
`;

const ChipRemove = styled.button`
  width: 20px;
  height: 20px;
  border-radius: 50%;
  border: none;
  background: rgba(15, 23, 42, 0.06);
  color: #475569;
  cursor: pointer;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  font-size: 14px;
  line-height: 1;
  padding: 0;
  transition: all 120ms;
  &:hover { background: #fee2e2; color: #b91c1c; }
  &:disabled { opacity: 0.4; cursor: not-allowed; }
`;

const AddRow = styled.div`
  display: flex;
  gap: 8px;
  align-items: center;
  margin-top: 12px;
`;

const AddButton = styled.button`
  height: 36px;
  padding: 0 14px;
  border-radius: 8px;
  border: 1px solid #14b8a6;
  background: #f0fdfa;
  color: #0f766e;
  font-size: 13px;
  font-weight: 600;
  cursor: pointer;
  transition: all 120ms;
  &:hover { background: #14b8a6; color: #ffffff; }
  &:disabled { opacity: 0.5; cursor: not-allowed; }
`;

function WorkspaceTimezoneSection({
  businessId,
  isAdmin,
  timezone,
  setTimezone,
  saveSettings,
}: {
  businessId: number;
  isAdmin: boolean;
  timezone: string;
  setTimezone: (v: string) => void;
  saveSettings: (payload: Partial<Workspace>) => Promise<void>;
}) {
  const { t } = useTranslation('settings');
  const { workspaceRefs, update } = useTimezones();
  const [now, setNow] = useState<Date>(new Date());
  const [pickerTz, setPickerTz] = useState<string>('');

  useEffect(() => {
    const id = window.setInterval(() => setNow(new Date()), 10_000);
    return () => window.clearInterval(id);
  }, []);

  const addReference = () => {
    if (!pickerTz) return;
    const next = Array.from(new Set([...workspaceRefs, pickerTz]));
    update({ workspaceRefs: next });
    setPickerTz('');
  };

  const removeReference = (tz: string) => {
    update({ workspaceRefs: workspaceRefs.filter((r) => r !== tz) });
  };

  return (
    <>
      <TzCallout>
        <TzCalloutIcon aria-hidden>i</TzCalloutIcon>
        <TzCalloutBody>{t('timezone.calloutBody')}</TzCalloutBody>
      </TzCallout>

      <TzPreviewCard>
        <TzPreviewLeft>
          <TzPreviewLabel>{t('timezone.previewLabel')}</TzPreviewLabel>
          <TzPreviewCity title={timezone}>{cityFromTz(timezone)}</TzPreviewCity>
          <TzPreviewSub>
            {timezone}{offsetFromTz(now, timezone) ? ` · UTC${offsetFromTz(now, timezone)}` : ''}
          </TzPreviewSub>
        </TzPreviewLeft>
        <TzPreviewTime>{formatTimeInTz(now, timezone)}</TzPreviewTime>
      </TzPreviewCard>

      <Card>
        <SectionTitle>{t('timezone.primaryTitle')}</SectionTitle>
        <SectionDesc>{t('timezone.primaryDesc')}</SectionDesc>
        <FieldGrid>
          <Field $full>
            <Label>{t('timezone.primaryLabel')}</Label>
            <AutoSaveField
              type="select"
              onSave={async () => { if (businessId) await saveSettings({ timezone }); }}
            >
              <TimezoneSelector
                value={timezone}
                onChange={setTimezone}
                disabled={!isAdmin}
              />
            </AutoSaveField>
          </Field>
        </FieldGrid>
      </Card>

      <Card>
        <SectionTitle>{t('timezone.referenceTitle')}</SectionTitle>
        <SectionDesc>{t('timezone.referenceDesc')}</SectionDesc>

        {workspaceRefs.length === 0 ? (
          <div style={{ color: '#94a3b8', fontSize: 13, padding: '8px 0' }}>
            {t('timezone.referenceEmpty')}
          </div>
        ) : (
          <ChipRow>
            {workspaceRefs.map((tz) => (
              <Chip key={tz}>
                <ChipCity>{cityFromTz(tz)}</ChipCity>
                <ChipMeta>
                  {formatTimeInTz(now, tz)}
                  {offsetFromTz(now, tz) ? ` · UTC${offsetFromTz(now, tz)}` : ''}
                </ChipMeta>
                <ChipRemove
                  type="button"
                  aria-label="remove"
                  disabled={!isAdmin}
                  onClick={() => removeReference(tz)}
                >
                  ×
                </ChipRemove>
              </Chip>
            ))}
          </ChipRow>
        )}

        {isAdmin && (
          <AddRow>
            <div style={{ flex: 1 }}>
              <TimezoneSelector
                value={pickerTz}
                onChange={setPickerTz}
                exclude={[timezone, ...workspaceRefs]}
                placeholder={t('timezone.addPlaceholder') || ''}
              />
            </div>
            <AddButton type="button" disabled={!pickerTz} onClick={addReference}>
              {t('timezone.addButton')}
            </AddButton>
          </AddRow>
        )}
      </Card>
    </>
  );
}
