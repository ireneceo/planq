import React, { useEffect, useRef, useState, useCallback } from 'react';
import styled from 'styled-components';
import { useTranslation, Trans } from 'react-i18next';
import FontScaleSection from '../../components/Common/FontScaleSection';
import { useAuth, apiFetch, apiUpload } from '../../contexts/AuthContext';
import type { LanguageLevels, LanguageSkillLevel, User } from '../../contexts/AuthContext';
import AccountDeletionSection from './AccountDeletionSection';
import VoiceProfileSection from '../../components/Profile/VoiceProfileSection';
import { LANGUAGES, type LanguageOption } from '../../constants/languages';
import PlanQSelect from '../../components/Common/PlanQSelect';
import AutoSaveField from '../../components/Common/AutoSaveField';
import LetterAvatar from '../../components/Common/LetterAvatar';
import { displayName } from '../../utils/displayName';
import ActionButton from '../../components/Common/ActionButton';
// N+32 — FocusSettingsCard / UserTimezoneSection 은 /me/work-settings 페이지로 이동.
// UserTimezoneSection 함수는 이 파일 내 정의 (export) — 새 페이지가 import.
import TimezoneSelector from '../../components/Common/TimezoneSelector';
import PageShell from '../../components/Layout/PageShell';
import { CheckIcon, XIcon } from '../../components/Common/Icons';
import { useTimezones } from '../../hooks/useTimezones';
import EmailChangeModal from './EmailChangeModal';
import { mapApiError } from '../../utils/apiError';
import {
  cityFromTz,
  offsetFromTz,
  formatTimeInTz,
  detectBrowserTz,
} from '../../utils/timezones';

export default function ProfilePage() {
  const { t, i18n } = useTranslation('profile');
  const { t: tErr } = useTranslation('errors');
  const { user, updateUser, refreshUser } = useAuth();
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);

  // 언어 선택 (기본 언어)
  const [language, setLanguage] = useState<string>(user?.language || 'ko');
  const [langSaving, setLangSaving] = useState(false);

  // 기본 정보 인라인 편집 (이름·아이디·다국어 이름)
  // 이름/영어이름은 워크스페이스별 (BusinessMember.name 또는 Client.display_name) 로 저장.
  // User.name 은 가입 시 default 로만 쓰이고 ProfilePage 에서 직접 변경하지 않음.
  const businessId = user?.business_id || 0;
  const [wsName, setWsName] = useState<string>('');
  const [wsNameEn, setWsNameEn] = useState<string>('');
  const [wsNameLoaded, setWsNameLoaded] = useState(false);
  const [usernameDraft, setUsernameDraft] = useState<string>((user as { username?: string } | null)?.username || '');
  // 계정 이름 (users.name) — 회원가입 시 받은 본 이름. 모든 워크스페이스 공통.
  // 프로필 사진 — 계정의 것이다(워크스페이스 스토리지에 넣지 않는다)
  const avatarInputRef = React.useRef<HTMLInputElement>(null);
  const [avatarUrl, setAvatarUrl] = useState<string | null>(
    ((user as { avatar_url?: string | null } | null)?.avatar_url) || null,
  );
  const [avatarBusy, setAvatarBusy] = useState(false);
  const [avatarMsg, setAvatarMsg] = useState<string | null>(null);
  const uploadAvatar = React.useCallback(async (file: File) => {
    if (!user) return;
    setAvatarBusy(true); setAvatarMsg(null);
    try {
      const fd = new FormData();
      fd.append('file', file);
      const r = await apiUpload(`/api/users/${user.id}/avatar`, fd);
      const j = await r.json().catch(() => null);
      if (!r.ok || !j?.success) {
        // 코드가 아니라 문장으로 — 왜 안 됐는지 모르면 고칠 수가 없다
        setAvatarMsg(j?.message === 'avatar_too_large'
          ? (t('basic.photoTooLarge', '2MB 이하 이미지만 올릴 수 있어요.') as string)
          : j?.message === 'image_only'
            ? (t('basic.photoImageOnly', 'JPG·PNG·WebP 이미지만 올릴 수 있어요.') as string)
            : (t('basic.photoFailed', '사진을 올리지 못했어요.') as string));
        return;
      }
      setAvatarUrl(j.data.avatar_url);
      // 좌측 메뉴·다른 화면도 같은 사진을 쓰게 사용자 정보에도 싣는다
      updateUser?.({ avatar_url: j.data.avatar_url });
    } catch {
      setAvatarMsg(t('basic.photoFailed', '사진을 올리지 못했어요.') as string);
    } finally { setAvatarBusy(false); }
  }, [user, t, updateUser]);
  const removeAvatar = React.useCallback(async () => {
    if (!user || avatarBusy) return;
    setAvatarBusy(true); setAvatarMsg(null);
    try {
      await apiFetch(`/api/users/${user.id}/avatar`, { method: 'DELETE' });
      setAvatarUrl(null);
      updateUser?.({ avatar_url: null });
    } catch {
      setAvatarMsg(t('basic.photoFailed', '사진을 올리지 못했어요.') as string);
    } finally { setAvatarBusy(false); }
  }, [user, avatarBusy, t, updateUser]);

  const [accountName, setAccountName] = useState<string>(user?.name || '');
  useEffect(() => { setAccountName(user?.name || ''); }, [user?.name]);
  // `#timezone` 해시로 들어오면 그 카드까지 스크롤 — 사이드바 시계 클릭의 착지점.
  //   렌더 직후엔 아직 카드가 없을 수 있어 한 틱 뒤에 찾는다.
  useEffect(() => {
    if (window.location.hash !== '#timezone') return;
    const id = window.setTimeout(() => {
      document.getElementById('section-timezone')?.scrollIntoView({ behavior: 'smooth', block: 'start' });
    }, 120);
    return () => window.clearTimeout(id);
  }, []);
  const [usernameStatus, setUsernameStatus] = useState<{ available: boolean | null; reason?: string }>({ available: null });
  const usernameCheckTimer = useRef<number | null>(null);
  const [emailModalOpen, setEmailModalOpen] = useState(false);
  const [emailVerifyOpen, setEmailVerifyOpen] = useState(false);

  useEffect(() => {
    const uname = (user as { username?: string } | null)?.username;
    if (uname !== undefined) setUsernameDraft(uname || '');
  }, [(user as { username?: string } | null)?.username]);

  // 워크스페이스 프로필 조회 — 표시명 + Q Note 답변 생성 필드 (BusinessMember 단위)
  useEffect(() => {
    if (!businessId) return;
    let cancelled = false;
    apiFetch(`/api/businesses/${businessId}/me/profile`)
      .then(r => r.json())
      .then(j => {
        if (cancelled) return;
        const d = j?.data;
        const fallbackName = user?.name || '';
        const fallbackEn = ((user as { name_localized?: Record<string, string> } | null)?.name_localized || {}).en || '';
        setWsName((d?.name) || fallbackName);
        setWsNameEn(((d?.name_localized) || {}).en || fallbackEn);
        // Q Note 답변 생성 프로필 — 워크스페이스값 우선, 없으면 User fallback
        if (d?.bio !== undefined) setBio(d.bio || user?.bio || '');
        if (d?.expertise !== undefined) setExpertise(d.expertise || user?.expertise || '');
        if (d?.organization !== undefined) setOrganization(d.organization || user?.organization || '');
        if (d?.job_title !== undefined) setJobTitle(d.job_title || user?.job_title || '');
        if (d?.expertise_level !== undefined) {
          setExpertiseLevel((d.expertise_level || user?.expertise_level || '') as 'layman' | 'practitioner' | 'expert' | '');
        }
        if (d?.language_levels !== undefined) {
          setLanguageLevels(d.language_levels || user?.language_levels || {});
        }
        setWsNameLoaded(true);
      })
      .catch(() => {
        setWsName(user?.name || '');
        setWsNameEn(((user as { name_localized?: Record<string, string> } | null)?.name_localized || {}).en || '');
        setWsNameLoaded(true);
      });
    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [businessId]);

  const saveAccountName = useCallback(async () => {
    if (!user?.id) throw new Error('Not logged in');
    const next = accountName.trim();
    if (!next) throw new Error(t('basic.namePlaceholder'));
    const res = await apiFetch(`/api/users/${user.id}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: next }),
    });
    const data = await res.json();
    if (!res.ok || !data.success) throw new Error(data.message || t('messages.errorSave'));
    updateUser({ name: next });
  }, [user?.id, accountName, t, updateUser]);

  // 사이클 N+22: 워크스페이스 표시명 PUT 후 AuthContext 즉시 refresh — 채팅·사이드바·멘션 모두 새 이름 반영.
  // BusinessMember.name 이 채팅 sender 표시의 source 이고 (services/displayName.js), 좌측 메뉴 WorkspaceSwitcher 도
  // user.workspaces[active] 의 brand_name 을 보므로 refresh 없이는 stale.
  const saveWsName = useCallback(async () => {
    if (!businessId) throw new Error('No workspace');
    const next = wsName.trim();
    if (!next) throw new Error(t('basic.namePlaceholder'));
    const res = await apiFetch(`/api/businesses/${businessId}/me/profile`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: next }),
    });
    const data = await res.json();
    if (!res.ok || !data.success) throw new Error(data.message || t('messages.errorSave'));
    await refreshUser();
  }, [businessId, wsName, t, refreshUser]);

  const saveWsNameEn = useCallback(async () => {
    if (!businessId) throw new Error('No workspace');
    const next = wsNameEn.trim();
    const merged: Record<string, string> = {};
    if (next) merged.en = next;
    const res = await apiFetch(`/api/businesses/${businessId}/me/profile`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name_localized: Object.keys(merged).length ? merged : null }),
    });
    const data = await res.json();
    if (!res.ok || !data.success) throw new Error(data.message || t('messages.errorSave'));
    await refreshUser();
  }, [businessId, wsNameEn, t, refreshUser]);

  const saveUsername = useCallback(async () => {
    if (!user?.id) throw new Error('Not logged in');
    const next = usernameDraft.trim().toLowerCase();
    if (!next) throw new Error('username_required');
    const cur = (user as { username?: string } | null)?.username;
    if (next === cur) return;
    if (!/^[a-z0-9_-]{3,30}$/.test(next)) throw new Error(t('basic.usernameInvalid'));
    const res = await apiFetch(`/api/users/${user.id}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username: next }),
    });
    const data = await res.json();
    if (!res.ok || !data.success) {
      if (data.message === 'username_taken') throw new Error(t('basic.usernameTaken'));
      if (data.message === 'username_reserved') throw new Error(t('basic.usernameReserved'));
      if (data.message === 'invalid_username_format') throw new Error(t('basic.usernameInvalid'));
      throw new Error(data.message || t('messages.errorSave'));
    }
    if (updateUser) updateUser({ ...(user as object), username: next } as Partial<User>);
  }, [user, usernameDraft, updateUser, t]);

  // username 가용성 debounce 체크
  useEffect(() => {
    if (usernameCheckTimer.current) window.clearTimeout(usernameCheckTimer.current);
    const cur = (user as { username?: string } | null)?.username || '';
    const v = usernameDraft.trim().toLowerCase();
    if (!v || v === cur) { setUsernameStatus({ available: null }); return; }
    if (!/^[a-z0-9_-]{3,30}$/.test(v)) {
      setUsernameStatus({ available: false, reason: 'invalid_format' });
      return;
    }
    usernameCheckTimer.current = window.setTimeout(async () => {
      try {
        const res = await apiFetch(`/api/users/username-available?value=${encodeURIComponent(v)}`);
        const data = await res.json();
        setUsernameStatus({ available: !!data.data?.available, reason: data.data?.reason });
      } catch { setUsernameStatus({ available: null }); }
    }, 400);
    return () => { if (usernameCheckTimer.current) window.clearTimeout(usernameCheckTimer.current); };
  }, [usernameDraft, user]);

  const onEmailChanged = (newEmail: string) => {
    if (updateUser) updateUser({ email: newEmail });
  };

  // Q Note 답변 생성용 프로필
  const [bio, setBio] = useState<string>(user?.bio || '');
  const [expertise, setExpertise] = useState<string>(user?.expertise || '');
  const [organization, setOrganization] = useState<string>(user?.organization || '');
  const [jobTitle, setJobTitle] = useState<string>(user?.job_title || '');

  // 언어 레벨 (언어별 4-skill 1-6)
  type Skill = 'reading' | 'speaking' | 'listening' | 'writing';
  const [languageLevels, setLanguageLevels] = useState<LanguageLevels>(user?.language_levels || {});
  const [expertiseLevel, setExpertiseLevel] = useState<'layman' | 'practitioner' | 'expert' | ''>(user?.expertise_level || '');

  useEffect(() => {
    if (user?.bio !== undefined) setBio(user.bio || '');
    if (user?.expertise !== undefined) setExpertise(user.expertise || '');
    if (user?.organization !== undefined) setOrganization(user.organization || '');
    if (user?.job_title !== undefined) setJobTitle(user.job_title || '');
    if (user?.language_levels !== undefined) setLanguageLevels(user.language_levels || {});
    if (user?.expertise_level !== undefined) setExpertiseLevel(user.expertise_level || '');
  }, [user?.bio, user?.expertise, user?.organization, user?.job_title, user?.language_levels, user?.expertise_level]);

  const LEVEL_OPTIONS = [
    { value: 0, label: t('languageLevel.scale.unset', '—') },
    { value: 1, label: t('languageLevel.scale.1', '1 초급') },
    { value: 2, label: t('languageLevel.scale.2', '2 기초') },
    { value: 3, label: t('languageLevel.scale.3', '3 중급') },
    { value: 4, label: t('languageLevel.scale.4', '4 중상급') },
    { value: 5, label: t('languageLevel.scale.5', '5 고급') },
    { value: 6, label: t('languageLevel.scale.6', '6 원어민') },
  ];

  // Q Note 답변 생성 프로필 — 워크스페이스 단위로 저장 (BusinessMember/Client)
  const saveProfileField = useCallback(async (field: 'bio' | 'expertise' | 'organization' | 'job_title', value: string) => {
    if (!businessId) throw new Error('No workspace');
    const res = await apiFetch(`/api/businesses/${businessId}/me/profile`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ [field]: value || null }),
    });
    const data = await res.json();
    if (!res.ok || !data.success) throw new Error(data.message || t('messages.errorSave'));
  }, [businessId, t]);

  const saveLanguageLevel = useCallback(async (lang: string, skill: Skill, level: number) => {
    if (!businessId) throw new Error('No workspace');
    const next: LanguageLevels = { ...languageLevels };
    if (level === 0) {
      if (next[lang]) {
        const block = { ...next[lang] };
        delete block[skill];
        if (Object.keys(block).length) next[lang] = block;
        else delete next[lang];
      }
    } else {
      next[lang] = { ...(next[lang] || {}), [skill]: level as LanguageSkillLevel };
    }
    const payload = Object.keys(next).length ? next : null;
    const res = await apiFetch(`/api/businesses/${businessId}/me/profile`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ language_levels: payload }),
    });
    const data = await res.json();
    if (!res.ok || !data.success) throw new Error(data.message || t('messages.errorSave'));
    setLanguageLevels(next);
  }, [businessId, languageLevels, t]);

  const saveExpertiseLevel = useCallback(async (level: string) => {
    if (!businessId) throw new Error('No workspace');
    const val = level || null;
    const res = await apiFetch(`/api/businesses/${businessId}/me/profile`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ expertise_level: val }),
    });
    const data = await res.json();
    if (!res.ok || !data.success) throw new Error(data.message || t('messages.errorSave'));
    setExpertiseLevel((val as 'layman' | 'practitioner' | 'expert' | null) || '');
  }, [businessId, t]);

  // ★ 2026-10-05 순찰(버튼 눌러보기)이 잡았다 — 카드·셀렉트가 저장 함수를 **직접** 불러 실패가 아무 데도 안 떴다
  //   (잡히지 않은 예외만 남고 화면은 바뀐 것처럼 보였다). 클릭은 화면만 바꾸고(stage) 저장은 AutoSaveField 가 한다(persist).
  //   최신값은 ref 로 읽는다. 실패하면 되돌리고 던진다 → ! 뱃지.
  const expertisePendingRef = useRef<string>('');
  const expertisePrevRef = useRef<string>('');   // 누르기 직전 값 — 실패하면 여기로 되돌린다
  const persistExpertise = useCallback(async () => {
    const next = expertisePendingRef.current;
    const prev = expertisePrevRef.current;
    if (!next || next === prev) return;   // 같은 카드·카드 사이 빈칸을 눌러도 저장이 나가지 않게
    try {
      await saveExpertiseLevel(next);
      expertisePrevRef.current = next;
    } catch (e) {
      setExpertiseLevel(prev as 'layman' | 'practitioner' | 'expert' | '');
      expertisePendingRef.current = prev;
      throw e;
    }
  }, [saveExpertiseLevel]);
  const levelPendingRef = useRef<{ lang: string; skill: Skill; level: number } | null>(null);
  const persistLanguageLevel = useCallback(async () => {
    const p = levelPendingRef.current;
    if (!p) return;
    await saveLanguageLevel(p.lang, p.skill, p.level);
  }, [saveLanguageLevel]);

  const errorBannerRef = useRef<HTMLDivElement>(null);

  // 확인 다이얼로그 상태

  // 에러 발생 시 상단 배너로 스크롤 (녹음 섹션에서 내려간 상태여도 확인 가능)
  useEffect(() => {
    if (error && errorBannerRef.current) {
      errorBannerRef.current.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
    }
  }, [error]);

  useEffect(() => {
    if (user?.language) setLanguage(user.language);
  }, [user?.language]);

  // ─────────── 기본 언어 변경 ───────────
  const handleLanguageChange = async (code: string) => {
    if (code === user?.language) return;
    setLangSaving(true);
    setError(null);
    try {
      const res = await apiFetch(`/api/users/${user?.id}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ language: code }),
      });
      const data = await res.json();
      if (!res.ok || !data.success) throw new Error(data.message || t('messages.errorLanguageSave'));
      setLanguage(code);
      if (updateUser) updateUser({ language: code });
      setSuccess(t('messages.successLanguageChanged'));
    } catch (e) {
      setError(mapApiError(e, tErr));
    } finally {
      setLangSaving(false);
    }
  };

  const langOptions = LANGUAGES.map((l: LanguageOption) => ({
    value: l.code,
    label: `${l.label} · ${l.native}`,
  }));

  return (
    <PageShell title={t('header.title')}>
      {/* N+49 hotfix-2 — ref div + banner 를 Container 밖으로 이동.
          이전: grid Container 안에 빈 div 가 첫 grid cell 차지 → 계정 정보가 두번째 cell 로 밀림 →
          첫 행 첫 열 빈 공간 회귀 (사용자 호소). banner 도 grid item 으로 잡혀 정렬 깨짐. */}
      <div ref={errorBannerRef} />
      {error && <Banner $kind="error"><XIcon size={14} />{error}</Banner>}
      {success && <Banner $kind="success"><CheckIcon size={14} />{success}</Banner>}

      <Container>
        {/* 계정 정보 — 모든 워크스페이스 공유 (이름·아이디·이메일·기본 언어) */}
        <Card>
          <SectionTitle>{t('basic.accountSection', '계정 정보')}</SectionTitle>
          <Description>{t('basic.accountDesc', '이름·아이디·이메일·기본 언어는 모든 워크스페이스에 공통으로 적용됩니다.')}</Description>

          {/* ★ 2026-09-14 (Irene: *"사진 넣는 기능도 만들고."*)
              `users.avatar_url` 컬럼은 **이미 있었다** — 없던 것은 올리는 길뿐이었다.
              모양은 이름 앞 아이콘과 같은 라운드 박스다(공용 `LetterAvatar`). */}
          <FieldRow>
            <Label>{t('basic.photo', '사진')}</Label>
            <FieldBody>
              <PhotoRow>
                {/* 첫 글자는 **닉네임**에서 — 좌측 메뉴·채팅과 같은 이름(displayName). 실명은 닉네임이 없을 때만(#455) */}
                <LetterAvatar name={displayName(user, i18n.language) || accountName || '—'} size={64} src={avatarUrl || undefined} />
                <PhotoBtns>
                  <ActionButton tone="secondary" size="sm" data-testid="profile-avatar-pick"
                    onClick={() => avatarInputRef.current?.click()} disabled={avatarBusy}>
                    {avatarUrl ? t('basic.photoChange', '사진 바꾸기') : t('basic.photoAdd', '사진 올리기')}
                  </ActionButton>
                  {avatarUrl && (
                    <ActionButton tone="secondary" size="sm" data-testid="profile-avatar-remove"
                      onClick={removeAvatar} disabled={avatarBusy}>
                      {t('basic.photoRemove', '사진 지우기')}
                    </ActionButton>
                  )}
                </PhotoBtns>
                <input ref={avatarInputRef} type="file" accept="image/png,image/jpeg,image/webp"
                  style={{ display: 'none' }}
                  onChange={(e) => { const f = e.target.files?.[0]; e.target.value = ''; if (f) void uploadAvatar(f); }} />
              </PhotoRow>
              <Hint>{avatarMsg || t('basic.photoHint', 'JPG·PNG·WebP · 2MB 이하. 같은 워크스페이스 멤버에게 보입니다.')}</Hint>
            </FieldBody>
          </FieldRow>

          {/* 계정 이름 — users.name. 회원가입 때 받은 본 이름. 워크스페이스마다 별도 닉네임은 워크스페이스 프로필 섹션에서. */}
          <FieldRow>
            <Label>{t('basic.accountName', '이름')}</Label>
            <FieldBody>
              <AutoSaveField onSave={saveAccountName}>
                <TextInput
                  data-testid="profile-account-name"
                  value={accountName}
                  onChange={(e: React.ChangeEvent<HTMLInputElement>) => setAccountName(e.target.value)}
                  placeholder={t('basic.namePlaceholder')}
                  maxLength={100}
                />
              </AutoSaveField>
              <Hint>{t('basic.accountNameHint', '회원가입 시 입력한 이름입니다. 영수증·세금계산서 등 공식 발급에 사용됩니다.')}</Hint>
            </FieldBody>
          </FieldRow>

          <FieldRow>
            <Label>{t('basic.username')}</Label>
            <FieldBody>
              {((user as { username?: string } | null)?.username) ? (
                <>
                  <ReadOnly>{(user as { username?: string }).username}</ReadOnly>
                  <Hint>{t('basic.usernameLocked', '아이디는 한 번 정해지면 변경할 수 없는 안전핀 식별자입니다.')}</Hint>
                </>
              ) : (
                <>
                  <AutoSaveField onSave={saveUsername}>
                    <TextInput
                      value={usernameDraft}
                      onChange={(e: React.ChangeEvent<HTMLInputElement>) => {
                        const v = e.target.value.toLowerCase().replace(/[^a-z0-9_-]/g, '');
                        setUsernameDraft(v);
                      }}
                      placeholder={t('basic.usernamePlaceholder')}
                      maxLength={30}
                    />
                  </AutoSaveField>
                  {usernameStatus.available === true && (
                    <UsernameOk><CheckIcon size={12} /> {t('basic.usernameAvailable')}</UsernameOk>
                  )}
                  {usernameStatus.available === false && (
                    <UsernameNg>
                      {usernameStatus.reason === 'taken' && t('basic.usernameTaken')}
                      {usernameStatus.reason === 'reserved' && t('basic.usernameReserved')}
                      {usernameStatus.reason === 'invalid_format' && t('basic.usernameInvalid')}
                    </UsernameNg>
                  )}
                  <Hint>{t('basic.usernameSetHelp', '한 번 정하면 변경할 수 없습니다. 신중히 입력하세요.')}</Hint>
                </>
              )}
            </FieldBody>
          </FieldRow>

          <FieldRow>
            <Label>{t('basic.email')}</Label>
            <FieldBody>
              <EmailRow>
                <ReadOnly style={{ flex: 1 }}>{user?.email || '-'}</ReadOnly>
                {(user as { email_verified_at?: string | null } | null)?.email_verified_at
                  ? <VerifyBadge $ok>{t('basic.verified', '인증됨')}</VerifyBadge>
                  : <VerifyBadge>{t('basic.notVerified', '미인증')}</VerifyBadge>}
                {!(user as { email_verified_at?: string | null } | null)?.email_verified_at && (
                  <SecondaryBtn type="button" onClick={() => setEmailVerifyOpen(true)}>
                    {t('basic.emailVerify', '인증')}
                  </SecondaryBtn>
                )}
                <SecondaryBtn type="button" onClick={() => setEmailModalOpen(true)}>
                  {t('basic.emailChange')}
                </SecondaryBtn>
              </EmailRow>
            </FieldBody>
          </FieldRow>

          <FieldRow>
            <Label>{t('basic.secondaryEmail', '보조 이메일')}</Label>
            <FieldBody>
              <SecondaryEmailManager
                user={user as { id?: number; secondary_email?: string | null; secondary_email_verified_at?: string | null } | null}
                updateUser={updateUser}
              />
              <Hint>{t('basic.secondaryEmailHint', '아이디·이메일을 잊었을 때 복구용. 인증된 이메일만 활성됩니다.')}</Hint>
            </FieldBody>
          </FieldRow>

          <FieldRow>
            <Label>{t('basic.defaultLanguage')}</Label>
            <FieldBody>
              <PlanQSelect
                value={langOptions.find((o) => o.value === language) || null}
                onChange={(opt) => {
                  const v = (opt as { value: string } | null)?.value;
                  if (v) handleLanguageChange(v);
                }}
                options={langOptions}
                placeholder={t('basic.languagePlaceholder')}
                isDisabled={langSaving}
                size="sm"
              />
              <Hint>{t('basic.languageHint')}</Hint>
            </FieldBody>
          </FieldRow>
        </Card>

        {/* 개인정보 처리 — 첫 행 2번째 열 (사용자 호소: 계정정보 옆 빈 공간 차단) */}
        <Card>
          <SectionTitle>{t('privacy.sectionTitle')}</SectionTitle>
          <PrivacyList>
            <PrivacyItem>
              <Trans i18nKey="privacy.item1" ns="profile" components={{ 1: <strong />, 2: <strong /> }} />
            </PrivacyItem>
            <PrivacyItem>
              <Trans i18nKey="privacy.item2" ns="profile" components={{ 1: <strong /> }} />
            </PrivacyItem>
            <PrivacyItem>
              <Trans i18nKey="privacy.item3" ns="profile" components={{ 1: <strong /> }} />
            </PrivacyItem>
            <PrivacyItem>
              <Trans i18nKey="privacy.item4" ns="profile" components={{ 1: <strong /> }} />
            </PrivacyItem>
          </PrivacyList>
        </Card>

        {/* 워크스페이스 프로필 — 현재 워크스페이스에서만 적용 (제목에 실제 워크스페이스 이름) */}
        {businessId > 0 && wsNameLoaded && (
          <Card>
            <SectionTitle>
              {user?.business_name
                ? t('workspaceProfile.sectionTitleNamed', { workspace: user.business_name, defaultValue: '{{workspace}} 프로필' })
                : t('workspaceProfile.sectionTitle', '이 워크스페이스 프로필')}
            </SectionTitle>
            <Description>
              {t('workspaceProfile.desc', '이 워크스페이스에서만 사용되는 닉네임입니다. 다른 워크스페이스에 가입되어 있다면 거기서는 따로 설정할 수 있어요.')}
            </Description>

            <FieldRow>
              <Label>{t('workspaceProfile.nickname', '닉네임')}</Label>
              <FieldBody>
                <AutoSaveField onSave={saveWsName}>
                  <TextInput
                    value={wsName}
                    onChange={(e: React.ChangeEvent<HTMLInputElement>) => setWsName(e.target.value)}
                    placeholder={t('workspaceProfile.nicknamePlaceholder', '이 워크스페이스 멤버에게 보이는 이름') as string}
                    maxLength={100}
                  />
                </AutoSaveField>
                <Hint>{t('workspaceProfile.nicknameUsage', '사용처: Q Talk 채팅 발신자 · Q Task 담당자 · 댓글/멘션 · 멤버 목록 · 워크스페이스 안 모든 표시')}</Hint>
              </FieldBody>
            </FieldRow>

            <FieldRow>
              <Label>{t('workspaceProfile.nicknameEn', '영문 닉네임')}</Label>
              <FieldBody>
                <AutoSaveField onSave={saveWsNameEn}>
                  <TextInput
                    value={wsNameEn}
                    onChange={(e: React.ChangeEvent<HTMLInputElement>) => setWsNameEn(e.target.value)}
                    placeholder={t('workspaceProfile.nicknameEnPlaceholder', '예: Owen Kim') as string}
                    maxLength={100}
                  />
                </AutoSaveField>
                <Hint>{t('workspaceProfile.nicknameEnUsage', '사용처: 영어 UI 로 보는 멤버·고객에게 위의 한글 닉네임 대신 이 이름이 표시됩니다 (선택)')}</Hint>
              </FieldBody>
            </FieldRow>
          </Card>
        )}

        <EmailChangeModal
          open={emailModalOpen}
          userId={user?.id || ''}
          currentEmail={user?.email || ''}
          onClose={() => setEmailModalOpen(false)}
          onChanged={onEmailChanged}
        />
        <EmailChangeModal
          open={emailVerifyOpen}
          userId={user?.id || ''}
          currentEmail={user?.email || ''}
          kind="verify-primary"
          onClose={() => setEmailVerifyOpen(false)}
          onChanged={() => {
            if (updateUser) updateUser({ email_verified_at: new Date().toISOString() } as Partial<User>);
          }}
        />

        {/* Q note 답변 생성 프로필 — 워크스페이스 단위 (BusinessMember.bio 등) */}
        <Card>
          <SectionTitle>
            {user?.business_name
              ? t('qnoteProfile.sectionTitleNamed', { workspace: user.business_name, defaultValue: '{{workspace}} — Q note 답변 생성용' })
              : t('qnoteProfile.sectionTitle')}
          </SectionTitle>
          <Description>
            {t('qnoteProfile.workspaceScopeNote', '이 정보는 현재 워크스페이스에서만 적용됩니다. Q Note 가 답변을 생성할 때 본인 컨텍스트로 활용합니다.')}
            <br />
            <Trans i18nKey="qnoteProfile.description" ns="profile" components={{ 1: <strong />, 2: <br /> }} />
          </Description>

          <FieldRow>
            <Label>{t('qnoteProfile.organization')}</Label>
            <FieldBody>
              <AutoSaveField onSave={() => saveProfileField('organization', organization)}>
                <TextInput
                  value={organization}
                  onChange={(e: React.ChangeEvent<HTMLInputElement>) => setOrganization(e.target.value)}
                  placeholder={t('qnoteProfile.organizationPlaceholder')}
                  maxLength={200}
                />
              </AutoSaveField>
            </FieldBody>
          </FieldRow>

          <FieldRow>
            <Label>{t('qnoteProfile.jobTitle')}</Label>
            <FieldBody>
              <AutoSaveField onSave={() => saveProfileField('job_title', jobTitle)}>
                <TextInput
                  value={jobTitle}
                  onChange={(e: React.ChangeEvent<HTMLInputElement>) => setJobTitle(e.target.value)}
                  placeholder={t('qnoteProfile.jobTitlePlaceholder')}
                  maxLength={100}
                />
              </AutoSaveField>
            </FieldBody>
          </FieldRow>

          <FieldRow>
            <Label>{t('qnoteProfile.expertise')}</Label>
            <FieldBody>
              <AutoSaveField onSave={() => saveProfileField('expertise', expertise)}>
                <TextInput
                  value={expertise}
                  onChange={(e: React.ChangeEvent<HTMLInputElement>) => setExpertise(e.target.value)}
                  placeholder={t('qnoteProfile.expertisePlaceholder')}
                  maxLength={500}
                />
              </AutoSaveField>
              <Hint>{t('qnoteProfile.expertiseHint')}</Hint>
            </FieldBody>
          </FieldRow>

          <FieldRow>
            <Label>{t('qnoteProfile.bio')}</Label>
            <FieldBody>
              <AutoSaveField onSave={() => saveProfileField('bio', bio)}>
                <TextArea
                  value={bio}
                  onChange={(e: React.ChangeEvent<HTMLTextAreaElement>) => setBio(e.target.value)}
                  placeholder={t('qnoteProfile.bioPlaceholder')}
                  maxLength={2000}
                  rows={4}
                />
              </AutoSaveField>
              <Hint>{t('qnoteProfile.bioHint', { length: bio.length, max: 2000 })}</Hint>
            </FieldBody>
          </FieldRow>
        </Card>

        {/* 언어 레벨 — 답변 난이도 조절 */}
        <Card $wide>
          <SectionTitle>{t('languageLevel.sectionTitle')}</SectionTitle>
          <Description>
            <Trans i18nKey="languageLevel.description" ns="profile" components={{ 1: <strong />, 2: <strong />, 3: <br />, 4: <strong /> }} />
          </Description>

          <LevelTableWrap>
            <LevelTableHead>
              <LevelTableCell $head>{t('languageLevel.col.lang')}</LevelTableCell>
              <LevelTableCell $head>{t('languageLevel.col.reading')}</LevelTableCell>
              <LevelTableCell $head>{t('languageLevel.col.speaking')}</LevelTableCell>
              <LevelTableCell $head>{t('languageLevel.col.listening')}</LevelTableCell>
              <LevelTableCell $head>{t('languageLevel.col.writing')}</LevelTableCell>
            </LevelTableHead>
            {['ko', 'en', 'ja', 'zh', 'es', 'fr', 'de'].map((code) => {
              const meta = LANGUAGES.find((l) => l.code === code);
              const label = meta?.label || code.toUpperCase();
              const block = languageLevels[code] || {};
              return (
                <LevelRow key={code}>
                  <LevelLangCell>{label}</LevelLangCell>
                  {(['reading', 'speaking', 'listening', 'writing'] as const).map((skill) => {
                    const current = block[skill] ?? 0;
                    return (
                      <LevelCell key={skill}>
                        <AutoSaveField key={`ll-${businessId}-${code}-${skill}`} type="select" onSave={persistLanguageLevel}>
                          <PlanQSelect
                            size="sm"
                            isClearable={false}
                            isSearchable={false}
                            value={LEVEL_OPTIONS.find((o) => o.value === current) || LEVEL_OPTIONS[0]}
                            onChange={(opt) => {
                              const v = (opt as { value: number } | null)?.value ?? 0;
                              levelPendingRef.current = { lang: code, skill, level: v };
                            }}
                            options={LEVEL_OPTIONS}
                          />
                        </AutoSaveField>
                      </LevelCell>
                    );
                  })}
                </LevelRow>
              );
            })}
          </LevelTableWrap>
          <Hint style={{ marginTop: 10 }}>
            {t('languageLevel.unsetHint')}
          </Hint>

          <FieldRow style={{ marginTop: 16, borderTop: '1px solid #e2e8f0', paddingTop: 16 }}>
            <Label>{t('languageLevel.expertise.label')}</Label>
            <FieldBody>
              <AutoSaveField key={`expertise-${businessId}`} type="toggle" onSave={persistExpertise}>
              <ExpertiseGrid>
                {([
                  { val: 'novice',       labelKey: 'languageLevel.expertise.novice',       sampleKey: 'languageLevel.expertise.novice_sample' },
                  { val: 'beginner',     labelKey: 'languageLevel.expertise.beginner',     sampleKey: 'languageLevel.expertise.beginner_sample' },
                  { val: 'intermediate', labelKey: 'languageLevel.expertise.intermediate', sampleKey: 'languageLevel.expertise.intermediate_sample' },
                  { val: 'advanced',     labelKey: 'languageLevel.expertise.advanced',     sampleKey: 'languageLevel.expertise.advanced_sample' },
                  { val: 'expert',       labelKey: 'languageLevel.expertise.expert5',      sampleKey: 'languageLevel.expertise.expert5_sample' },
                ] as const).map((opt) => {
                  // 호환: 기존 layman → novice, practitioner → intermediate 자동 매핑
                  const isActive = expertiseLevel === opt.val
                    || (opt.val === 'novice' && expertiseLevel === 'layman')
                    || (opt.val === 'intermediate' && expertiseLevel === 'practitioner');
                  return (
                    <ExpertiseCard
                      key={opt.val}
                      type="button"
                      $active={isActive}
                      onClick={() => {
                        expertisePrevRef.current = expertiseLevel;
                        expertisePendingRef.current = opt.val;
                        setExpertiseLevel(opt.val as 'layman' | 'practitioner' | 'expert' | '');
                      }}
                    >
                      <ExpertiseTitle>{t(opt.labelKey)}</ExpertiseTitle>
                      <ExpertiseSample>{t(opt.sampleKey)}</ExpertiseSample>
                    </ExpertiseCard>
                  );
                })}
              </ExpertiseGrid>
              </AutoSaveField>
              <Hint>
                <Trans i18nKey="languageLevel.expertise.hint" ns="profile" components={{ 1: <strong /> }} />
              </Hint>
            </FieldBody>
          </FieldRow>
        </Card>

        {/* ★ 2026-09-14 (Irene: *"내 프로필 가면 글씨크기가 2번째로 나오는데 가장 마지막에 1열로 나오게 해.
            내 목소리등록 위에 나오게 해."*) — 계정·프로필 항목들을 먼저 보고, 표시 설정은 맨 아래에 둔다.
            기기별 설정(localStorage)이라 계정 항목들과 성격도 다르다. `$wide` 로 **한 열 전체**를 쓴다. */}
        <Card $wide>
          <SectionTitle>{t('fontScale.sectionTitle') as string}</SectionTitle>
          <FontScaleSection />
        </Card>

        {/* 음성 핑거프린트 (다국어) */}
        <Card $wide>
          {/* 2026-10-05 — 고객 홈과 같이 쓰는 컴포넌트로 뺐다 (components/Profile/VoiceProfileSection) */}
          <VoiceProfileSection variant="member" />
        </Card>

        {/* N+32 — UserTimezoneSection + FocusSettingsCard 는 /me/work-settings 페이지로 이동.
            ProfilePage 는 개인 정보 (이름/언어/약력 등) 중심. 업무 도구 설정은 별도 메뉴. */}

        {/* 계정 삭제(회원 탈퇴) — 개인 설정 최하단 Danger Zone */}
        <AccountDeletionSection />

      </Container>

    </PageShell>
  );
}

// ─── Styled ───────────────────────────────────

// 사이클 N+22: 2열 grid — 입력란이 좁아져 AutoSave 표시 잘 보이게.
// 카드 폭이 480px 이하로 좁아지지 않게 minmax, 모바일·태블릿(≤1024) 은 1열.
// 사이클 N+49: 개인정보 처리 카드를 계정정보 옆 (첫 행 2열) 로 이동 + align-items 제거.
// dense 유지 — 조건부 카드 ($wide 등) 로 빈 자리 생기면 다음 element 자동 배치.
// align-items 명시 제거 → grid default stretch → 같은 행 카드 높이 자동 동일 (사용자 호소 정돈).
const Container = styled.div`
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  grid-auto-flow: dense;
  gap: 16px;
  @media (max-width: 1024px) {
    grid-template-columns: 1fr;
  }
`;

const PhotoRow = styled.div`display: flex; align-items: center; gap: 14px; flex-wrap: wrap;`;
const PhotoBtns = styled.div`display: flex; align-items: center; gap: 8px; flex-wrap: wrap;`;

const Card = styled.section<{ $wide?: boolean }>`
  background: #fff;
  border: 1px solid #e2e8f0;
  border-radius: 12px;
  padding: 24px;
  min-width: 0;
  /* N+49 — grid item stretch 명시. 같은 행 카드 높이 동일 보장 (Container align-items default stretch 와 함께) */
  height: 100%;
  display: flex;
  flex-direction: column;
  ${(p) => p.$wide && `
    grid-column: 1 / -1;
  `}
`;

const SectionTitle = styled.h2`
  margin: 0 0 16px;
  font-size: 1rem;
  font-weight: 700;
  color: #0f172a;
`;

const Description = styled.p`
  margin: 0 0 16px;
  color: #475569;
  font-size: 0.8125rem;
  line-height: 1.6;
  strong { color: #0f172a; font-weight: 600; }
`;

const FieldRow = styled.div`
  display: flex;
  gap: 16px;
  margin-bottom: 14px;
  align-items: flex-start;
  &:last-child { margin-bottom: 0; }
`;

const Label = styled.div`
  width: 100px;
  flex-shrink: 0;
  font-size: 0.8125rem;
  font-weight: 600;
  color: #475569;
  padding-top: 8px;
`;

const FieldBody = styled.div`
  flex: 1;
  display: flex;
  flex-direction: column;
  gap: 4px;
`;

const ReadOnly = styled.div`
  flex: 1;
  padding: 8px 12px;
  font-size: 0.875rem;
  color: #0f172a;
  background: #f8fafc;
  border: 1px solid #e2e8f0;
  border-radius: 8px;
`;

const UsernameOk = styled.div`
  font-size: 0.6875rem;
  color: #15803d;
  font-weight: 600;
  margin-top: 2px;
`;

const UsernameNg = styled.div`
  font-size: 0.6875rem;
  color: #b91c1c;
  font-weight: 600;
  margin-top: 2px;
`;

const EmailRow = styled.div`
  display: flex;
  gap: 8px;
  align-items: center;
  flex-wrap: wrap;
`;

const Hint = styled.div`
  font-size: 0.6875rem;
  color: #94a3b8;
`;

const VerifyBadge = styled.span<{ $ok?: boolean }>`
  flex-shrink: 0;
  padding: 3px 10px;
  border-radius: 999px;
  font-size: 0.6875rem;
  font-weight: 600;
  ${p => p.$ok
    ? 'background: #F0FDFA; color: #0F766E; border: 1px solid #99F6E4;'
    : 'background: #FFFBEB; color: #B45309; border: 1px solid #FDE68A;'}
`;

// 언어 레벨 테이블 — 5 column 균등 (lang + 4 skills). 셀 폭 충분하게 minmax 사용 (라벨 wrap 방지).
// 모바일에서 가로 스크롤 허용
const LevelTableWrap = styled.div`
  overflow-x: auto;
  margin: 0 -4px;
  padding: 0 4px;
`;
const LevelTableHead = styled.div`
  display: grid;
  grid-template-columns: minmax(96px, 0.9fr) repeat(4, minmax(130px, 1fr));
  gap: 8px;
  padding: 6px 0;
  border-bottom: 1px solid #e2e8f0;
`;

const LevelTableCell = styled.div<{ $head?: boolean }>`
  font-size: ${(p) => (p.$head ? '0.6875rem' : '0.8125rem')};
  font-weight: ${(p) => (p.$head ? 700 : 500)};
  color: ${(p) => (p.$head ? '#64748b' : '#0f172a')};
  letter-spacing: 0.03em;
  text-transform: ${(p) => (p.$head ? 'uppercase' : 'none')};
`;

const LevelRow = styled.div`
  display: grid;
  grid-template-columns: minmax(96px, 0.9fr) repeat(4, minmax(130px, 1fr));
  gap: 8px;
  padding: 8px 0;
  align-items: center;
  border-bottom: 1px solid #f1f5f9;
`;

const LevelLangCell = styled.div`
  font-size: 0.8125rem;
  font-weight: 600;
  color: #0f172a;
`;

// PlanQSelect 가 들어가는 cell — 셀렉트 선택값이 한 줄로 표시되도록 강제 (wrap 방지)
const LevelCell = styled.div`
  display: flex;
  align-items: center;
  min-width: 0;
  & > div { width: 100%; }
  /* react-select 의 single value / placeholder — 한 줄 nowrap + ellipsis */
  [class$="-singleValue"], [class*="-singleValue"],
  [class$="-placeholder"], [class*="-placeholder"] {
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }
`;


const ExpertiseGrid = styled.div`
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(170px, 1fr));
  gap: 8px;
  @media (max-width: 640px) {
    grid-template-columns: 1fr;
  }
`;

const ExpertiseCard = styled.button<{ $active?: boolean }>`
  display: flex;
  flex-direction: column;
  align-items: flex-start;
  text-align: left;
  gap: 4px;
  padding: 10px 12px;
  background: ${(p) => (p.$active ? '#F0FDFA' : '#FFFFFF')};
  border: 1px solid ${(p) => (p.$active ? '#14B8A6' : '#E2E8F0')};
  border-radius: 10px;
  cursor: pointer;
  transition: all 0.15s;
  &:hover {
    border-color: ${(p) => (p.$active ? '#0D9488' : '#94A3B8')};
    background: ${(p) => (p.$active ? '#F0FDFA' : '#F8FAFC')};
  }
  &:focus-visible { outline: none; box-shadow: 0 0 0 3px rgba(20,184,166,0.3); }
`;
const ExpertiseTitle = styled.span`
  font-size: 0.8125rem;
  font-weight: 700;
  color: #0F172A;
`;
const ExpertiseSample = styled.span`
  font-size: 0.6875rem;
  font-weight: 500;
  color: #64748B;
  line-height: 1.45;
`;


const TextInput = styled.input`
  width: 100%;
  padding: 10px 12px;
  border: 1px solid #e2e8f0;
  border-radius: 8px;
  font-size: 0.875rem;
  color: #0f172a;
  background: #ffffff;
  outline: none;
  transition: border-color 120ms;
  &:focus { border-color: #14b8a6; }
  &::placeholder { color: #cbd5e1; }
`;

const TextArea = styled.textarea`
  width: 100%;
  padding: 10px 12px;
  border: 1px solid #e2e8f0;
  border-radius: 8px;
  font-size: 0.875rem;
  color: #0f172a;
  background: #ffffff;
  outline: none;
  resize: vertical;
  min-height: 100px;
  font-family: inherit;
  line-height: 1.5;
  transition: border-color 120ms;
  &:focus { border-color: #14b8a6; }
  &::placeholder { color: #cbd5e1; }
`;

const Banner = styled.div<{ $kind: 'error' | 'success' }>`
  padding: 12px 16px;
  border-radius: 8px;
  display: flex;
  align-items: center;
  gap: 8px;
  font-size: 0.8125rem;
  background: ${(p) => (p.$kind === 'error' ? '#fef2f2' : '#f0fdf4')};
  color: ${(p) => (p.$kind === 'error' ? '#b91c1c' : '#15803d')};
  border: 1px solid ${(p) => (p.$kind === 'error' ? '#fecaca' : '#bbf7d0')};
`;

const SecondaryBtn = styled.button`
  display: inline-flex;
  align-items: center;
  gap: 6px;
  padding: 8px 12px;
  font-size: 0.75rem;
  font-weight: 600;
  background: #fff;
  color: #475569;
  border: 1px solid #cbd5e1;
  border-radius: 8px;
  cursor: pointer;
  &:hover:not(:disabled) { background: #f8fafc; border-color: #94a3b8; }
  &:disabled { opacity: 0.5; cursor: not-allowed; }
`;

const PrivacyList = styled.ul`
  margin: 0;
  padding: 0 0 0 18px;
  display: flex;
  flex-direction: column;
  gap: 10px;
`;

const PrivacyItem = styled.li`
  font-size: 0.75rem;
  color: #475569;
  line-height: 1.7;
  strong { color: #0f172a; font-weight: 600; }
`;

// ─────────────────────────────────────────────
// User Timezone Section
// ─────────────────────────────────────────────
const TzUserCard = styled.div`
  background: linear-gradient(135deg, #f43f5e 0%, #be123c 100%);
  color: #fff;
  border-radius: 14px;
  padding: 22px 24px;
  margin-bottom: 16px;
  display: flex;
  align-items: flex-end;
  justify-content: space-between;
  gap: 20px;
  box-shadow: 0 10px 30px -12px rgba(244, 63, 94, 0.4);
`;

const TzUserLeft = styled.div`
  display: flex;
  flex-direction: column;
  gap: 4px;
  min-width: 0;
`;

const TzUserLabel = styled.div`
  font-size: 0.625rem;
  font-weight: 700;
  letter-spacing: 1px;
  text-transform: uppercase;
  color: rgba(255, 228, 230, 0.9);
`;

const TzUserCity = styled.div`
  font-size: 1.375rem;
  font-weight: 700;
  color: #ffffff;
  letter-spacing: -0.5px;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
`;

const TzUserSub = styled.div`
  font-size: 0.75rem;
  color: rgba(255, 228, 230, 0.8);
`;

const TzUserTime = styled.div`
  font-size: 2.5rem;
  font-weight: 700;
  color: #ffffff;
  font-variant-numeric: tabular-nums;
  letter-spacing: -1.5px;
  line-height: 1;
`;

const UChipRow = styled.div`
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
  margin-top: 12px;
`;

const UChip = styled.div`
  display: inline-flex;
  align-items: center;
  gap: 8px;
  padding: 6px 10px 6px 12px;
  background: #f1f5f9;
  border: 1px solid #e2e8f0;
  border-radius: 999px;
  font-size: 0.75rem;
  color: #0f172a;
`;

const UChipCity = styled.span`font-weight: 600;`;
const UChipMeta = styled.span`color: #64748b; font-size: 0.6875rem;`;

const UChipRemove = styled.button`
  width: 20px; height: 20px;
  border-radius: 50%;
  border: none;
  background: rgba(15, 23, 42, 0.06);
  color: #475569;
  cursor: pointer;
  display: inline-flex; align-items: center; justify-content: center;
  font-size: 0.875rem; line-height: 1; padding: 0;
  transition: all 120ms;
  &:hover { background: #fee2e2; color: #b91c1c; }
`;

const UAddRow = styled.div`
  display: flex; gap: 8px; align-items: center; margin-top: 12px;
`;

const UAddButton = styled.button`
  height: 36px;
  padding: 0 14px;
  border-radius: 8px;
  border: 1px solid #f43f5e;
  background: #fff1f2;
  color: #be123c;
  font-size: 0.8125rem; font-weight: 600;
  cursor: pointer;
  transition: all 120ms;
  &:hover { background: #f43f5e; color: #fff; }
  &:disabled { opacity: 0.5; cursor: not-allowed; }
`;

const BrowserHint = styled.button`
  background: none;
  border: none;
  color: #0f766e;
  font-size: 0.75rem;
  font-weight: 600;
  cursor: pointer;
  padding: 0;
  margin-top: 6px;
  text-decoration: underline;
  &:hover { color: #134e4a; }
`;

// 날짜·시간 표시 형식 (2026-09-28, Irene 승인 09-27) — users.date_format / time_format / week_start.
//   «자동» = null = 화면 언어를 따른다. 값의 뜻·표시는 utils/dateFormat.ts 가 정본이다.
//   저장 후 updateUser 가 AuthContext.setUser → setDatePrefs 를 지나므로 앱 전체 표시가 곧바로 바뀐다.
export function DateFormatSection() {
  const { t, i18n } = useTranslation('profile');
  const { user, updateUser } = useAuth();
  const locale = i18n.language?.startsWith('en') ? 'en-US' : 'ko-KR';
  const [dateFmt, setDateFmt] = useState<string>(user?.date_format || '');
  const [timeFmt, setTimeFmt] = useState<string>(user?.time_format || '');
  const [weekStart, setWeekStart] = useState<string>(user?.week_start || '');
  // 래퍼가 onSave 를 부를 때 **클로저가 아니라 ref** 로 최신값을 읽는다(자동저장 절 — 뒤집기 전 값을 저장하는 사고)
  const latest = useRef({ date_format: dateFmt, time_format: timeFmt, week_start: weekStart });
  latest.current = { date_format: dateFmt, time_format: timeFmt, week_start: weekStart };

  const persist = useCallback(async (key: 'date_format' | 'time_format' | 'week_start') => {
    if (!user) throw new Error('no user');
    const val = latest.current[key] || null;
    const res = await apiFetch(`/api/users/${user.id}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ [key]: val }),
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok || !data.success) throw new Error(data.message || t('messages.errorSave'));
    updateUser({ [key]: val } as Partial<User>);
  }, [user, updateUser, t]);

  // 보기 예시는 오늘 날짜로 — 고르기 전에 결과를 보여준다
  const now = new Date();
  const p2 = (n: number) => String(n).padStart(2, '0');
  const y = now.getFullYear(); const m = p2(now.getMonth() + 1); const d = p2(now.getDate());
  const autoDate = new Intl.DateTimeFormat(locale, { month: 'short', day: 'numeric' }).format(now);
  const sample = new Date(y, now.getMonth(), now.getDate(), 14, 30);
  const time24 = new Intl.DateTimeFormat(locale, { hour: '2-digit', minute: '2-digit', hour12: false }).format(sample);
  const time12 = new Intl.DateTimeFormat(locale, { hour: 'numeric', minute: '2-digit', hour12: true }).format(sample);
  const autoTime = locale.startsWith('en') ? time12 : time24;

  const dateOpts = [
    { value: '', label: t('dateFormat.auto', { example: autoDate }) as string },
    { value: 'ymd', label: `${y}-${m}-${d}` },
    { value: 'mdy', label: `${m}/${d}/${y}` },
    { value: 'dmy', label: `${d}/${m}/${y}` },
  ];
  const timeOpts = [
    { value: '', label: t('dateFormat.auto', { example: autoTime }) as string },
    { value: '24h', label: t('dateFormat.time24', { example: time24 }) as string },
    { value: '12h', label: t('dateFormat.time12', { example: time12 }) as string },
  ];
  const weekOpts = [
    { value: '', label: t('dateFormat.auto', { example: t('dateFormat.sun') }) as string },
    { value: 'sun', label: t('dateFormat.sun') as string },
    { value: 'mon', label: t('dateFormat.mon') as string },
  ];
  const pick = <O extends { value: string; label: string }>(opts: O[], v: string): O => opts.find((o) => o.value === v) || opts[0];

  return (
    <Card id="section-date-format" data-testid="settings-date-format">
      <SectionTitle>{t('dateFormat.title')}</SectionTitle>
      <Description>{t('dateFormat.desc')}</Description>
      <FieldRow>
        <Label>{t('dateFormat.dateLabel')}</Label>
        <FieldBody>
          <AutoSaveField key={`date_format-${user?.id}`} type="select" onSave={() => persist('date_format')}>
            <PlanQSelect size="sm" value={pick(dateOpts, dateFmt)} options={dateOpts}
              onChange={(o) => setDateFmt(String((o as { value: string } | null)?.value ?? ''))} />
          </AutoSaveField>
        </FieldBody>
      </FieldRow>
      <FieldRow>
        <Label>{t('dateFormat.timeLabel')}</Label>
        <FieldBody>
          <AutoSaveField key={`time_format-${user?.id}`} type="select" onSave={() => persist('time_format')}>
            <PlanQSelect size="sm" value={pick(timeOpts, timeFmt)} options={timeOpts}
              onChange={(o) => setTimeFmt(String((o as { value: string } | null)?.value ?? ''))} />
          </AutoSaveField>
        </FieldBody>
      </FieldRow>
      <FieldRow>
        <Label>{t('dateFormat.weekLabel')}</Label>
        <FieldBody>
          <AutoSaveField key={`week_start-${user?.id}`} type="select" onSave={() => persist('week_start')}>
            <PlanQSelect size="sm" value={pick(weekOpts, weekStart)} options={weekOpts}
              onChange={(o) => setWeekStart(String((o as { value: string } | null)?.value ?? ''))} />
          </AutoSaveField>
          <Hint>{t('dateFormat.weekHint')}</Hint>
        </FieldBody>
      </FieldRow>
    </Card>
  );
}

export function UserTimezoneSection() {
  const { t } = useTranslation('profile');
  const { userTz, userRefs, update } = useTimezones();
  const [now, setNow] = useState<Date>(new Date());
  const [pickerTz, setPickerTz] = useState<string>('');
  const browserTz = detectBrowserTz();

  useEffect(() => {
    const id = window.setInterval(() => setNow(new Date()), 10_000);
    return () => window.clearInterval(id);
  }, []);

  const addRef = () => {
    if (!pickerTz) return;
    update({ userRefs: Array.from(new Set([...userRefs, pickerTz])) });
    setPickerTz('');
  };
  const removeRef = (tz: string) => {
    update({ userRefs: userRefs.filter((r) => r !== tz) });
  };

  return (
    <>
      <TzUserCard>
        <TzUserLeft>
          <TzUserLabel>{t('timezone.previewLabel')}</TzUserLabel>
          <TzUserCity title={userTz}>{cityFromTz(userTz)}</TzUserCity>
          <TzUserSub>
            {userTz}{offsetFromTz(now, userTz) ? ` · UTC${offsetFromTz(now, userTz)}` : ''}
          </TzUserSub>
        </TzUserLeft>
        <TzUserTime>{formatTimeInTz(now, userTz)}</TzUserTime>
      </TzUserCard>

      {/* 사이드바 시계에서 `/profile#timezone` 으로 들어온다 — 그 항목까지 데려다 놓는다
          (페이지 최상단에 떨구면 "이상한 곳으로 갔다" 가 된다, Irene 2026-08-24). */}
      <Card id="section-timezone">
        <SectionTitle>{t('timezone.primaryTitle')}</SectionTitle>
        <Description>{t('timezone.primaryDesc')}</Description>
        <FieldRow>
          <Label>{t('timezone.primaryLabel')}</Label>
          <FieldBody>
            <AutoSaveField
              type="select"
              onSave={async () => { update({ userTz }); }}
            >
              <TimezoneSelector
                value={userTz}
                onChange={(tz) => update({ userTz: tz })}
              />
            </AutoSaveField>
            {userTz !== browserTz && (
              <BrowserHint
                type="button"
                onClick={() => update({ userTz: browserTz })}
              >
                {t('timezone.useBrowser', { tz: browserTz })}
              </BrowserHint>
            )}
          </FieldBody>
        </FieldRow>
      </Card>

      <Card>
        <SectionTitle>{t('timezone.referenceTitle')}</SectionTitle>
        <Description>{t('timezone.referenceDesc')}</Description>

        {userRefs.length === 0 ? (
          <div style={{ color: '#94a3b8', fontSize: '0.8125rem', padding: '8px 0' }}>
            {t('timezone.referenceEmpty')}
          </div>
        ) : (
          <UChipRow>
            {userRefs.map((tz) => (
              <UChip key={tz}>
                <UChipCity>{cityFromTz(tz)}</UChipCity>
                <UChipMeta>
                  {formatTimeInTz(now, tz)}
                  {offsetFromTz(now, tz) ? ` · UTC${offsetFromTz(now, tz)}` : ''}
                </UChipMeta>
                <UChipRemove type="button" aria-label="remove" onClick={() => removeRef(tz)}>×</UChipRemove>
              </UChip>
            ))}
          </UChipRow>
        )}

        <UAddRow>
          <div style={{ flex: 1 }}>
            <TimezoneSelector
              value={pickerTz}
              onChange={setPickerTz}
              exclude={[userTz, ...userRefs]}
              placeholder={t('timezone.addPlaceholder') || ''}
            />
          </div>
          <UAddButton type="button" disabled={!pickerTz} onClick={addRef}>
            {t('timezone.addButton')}
          </UAddButton>
        </UAddRow>
      </Card>

    </>
  );
}

// 보조 이메일 관리자 — 추가/변경/제거 + 인증 상태
function SecondaryEmailManager({
  user,
  updateUser,
}: {
  user: { id?: number; secondary_email?: string | null; secondary_email_verified_at?: string | null } | null;
  updateUser?: (patch: Partial<User>) => void;
}) {
  const { t } = useTranslation('profile');
  const [modalOpen, setModalOpen] = useState(false);
  const [verifyOpen, setVerifyOpen] = useState(false);
  const [removing, setRemoving] = useState(false);

  const has = !!user?.secondary_email;
  const verified = !!user?.secondary_email_verified_at;

  const handleRemove = async () => {
    if (!user?.id || removing) return;
    setRemoving(true);
    try {
      const res = await apiFetch(`/api/users/${user.id}/secondary-email`, { method: 'DELETE' });
      const data = await res.json();
      if (res.ok && data.success && updateUser) {
        updateUser({ secondary_email: null, secondary_email_verified_at: null } as Partial<User>);
      }
    } finally {
      setRemoving(false);
    }
  };

  const handleChanged = (newEmail: string) => {
    if (updateUser) {
      updateUser({ secondary_email: newEmail, secondary_email_verified_at: new Date().toISOString() } as Partial<User>);
    }
  };

  return (
    <>
      <EmailRow>
        <ReadOnly style={{ flex: 1 }}>{has ? user.secondary_email : t('basic.secondaryEmailEmpty', '등록되지 않음')}</ReadOnly>
        {has && (verified
          ? <VerifyBadge $ok>{t('basic.verified', '인증됨')}</VerifyBadge>
          : <VerifyBadge>{t('basic.notVerified', '미인증')}</VerifyBadge>)}
        {has && !verified && (
          <SecondaryBtn type="button" onClick={() => setVerifyOpen(true)}>
            {t('basic.emailVerify', '인증')}
          </SecondaryBtn>
        )}
        <SecondaryBtn type="button" onClick={() => setModalOpen(true)}>
          {has ? t('basic.emailChange', '변경') : t('basic.secondaryEmailAdd', '추가')}
        </SecondaryBtn>
        {has && (
          <SecondaryBtn type="button" onClick={handleRemove} disabled={removing}>
            {t('basic.secondaryEmailRemove', '제거')}
          </SecondaryBtn>
        )}
      </EmailRow>
      <EmailChangeModal
        open={modalOpen}
        userId={user?.id || ''}
        currentEmail={user?.secondary_email || ''}
        kind="secondary"
        onClose={() => setModalOpen(false)}
        onChanged={handleChanged}
      />
      <EmailChangeModal
        open={verifyOpen}
        userId={user?.id || ''}
        currentEmail={user?.secondary_email || ''}
        kind="verify-secondary"
        onClose={() => setVerifyOpen(false)}
        onChanged={() => {
          if (updateUser) updateUser({ secondary_email_verified_at: new Date().toISOString() } as Partial<User>);
        }}
      />
    </>
  );
}
