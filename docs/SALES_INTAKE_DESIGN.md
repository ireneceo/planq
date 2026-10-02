# Q sales 상담 유입 — 자동·수동 모드 · 메일 판정과의 정합 설계 (운영 #449 · #450)

> 작성: Fable 설계 게이트, 2026-10-02. 상태: **설계 — Irene 결정 §7 대기. 코드 변경 0.**
> 선행 정본: CLAUDE.md «상담에 무엇이 들어오는가는 «관계» 로 가른다» · «Q mail 폴더·배지 계약» · «상담은 «고객에 달리는 기록»» ·
> `docs/Q_SALE_DESIGN.md` §5.2-A · `services/saleMailCriteria.js` 머리말(2026-09-16·17 결정).
> 신고 원문(owner Irene, 운영 `/sale`, 2026-10-02):
> - **#449** *"Q sales 에 상담 메일이 아닌데 많이 들어오는데 검증을 어떻게 했어? 이럴거면 자동이랑 수동 설정하게 하고 채팅이나 메일에서
>   상담으로 보내기 버튼을 제대로 작동하게 해서 수동관리를 수월하게 하는데 낫지 않아? … 메뉴들 제대로 안돌아가고 있는 건 고객이 이해하게
>   아이콘 테스팅 표시라도 할까?"*
> - **#450** *"Q sales 에 들어오는 건 보통 이메일에서 답변필요가 와야 하는 거 아니야? 왜 서로 판단이 달라? 달라야 하는 이유가 있어?
>   그리고 sales에 우리 채용 관련 문의메일은 리스트업되는데 이메일에서 답변필요. 확인권장에도 안나와. 이거 메일 미싱했어"*

---

## 0. 결론 (10줄)

1. **운영 실측(biz 1): 상담 18건 중 영업 문의는 5건 안팎(≈30%).** 나머지는 애플 지원 티켓·학교 통지·수도요금·헬스장 결제 문의·채용 구직 메일 — 전부 verdict `replied`(우리가 답했다)다. «우리가 답했다» 는 관계의 증거지만 **누가 누구의 고객인지**(우리가 묻는 쪽인지, 상대가 사려는 쪽인지)를 가르지 못한다. 그 판단은 기계가 못 한다 — 그래서 #449 의 제안이 맞다.
2. **#450 의 «메일 미싱» 은 미싱이 아니다.** 채용 메일(스레드 3675)은 **Irene 본인이 10-02 12:34(KST) PlanQ 에서 답장을 보냈고**(`email_messages.sent_by_user_id=1`), #402 규칙(«답장하면 공은 상대에게») 으로 답변필요·확인권장에서 빠졌다. 상담엔 «답장함» 으로 남았다. **두 화면은 다른 질문에 답한다** — 메일 폴더 = «지금 내 차례인가», 상담 = «영업 관계인가». 어긋남의 이유는 있는데 **화면이 그 이유를 한 글자도 말하지 않는다**(상담 행에 verdict 가 `meta` 로만 실리고 그리는 곳 0).
3. 반대 방향 어긋남도 있다 — **메일 답변필요(미연결) 7건 중 6건이 노이즈**(G마켓 약관·아시아나 안내·도메인 확인·채무 명세·배송 제안)인데 상담엔 안 들어온다. 상담 기준에는 **역할 주소 배제**(`isPersonalSender`)가 있고 메일 ④ 규칙(모르는 상대 + 우리 주소 + 질문/요청)에는 없기 때문이다. 같은 축(«보낸 사람이 사람인가»)의 공식이 두 벌이다.
4. 설계 축: **관계 술어를 한 벌로**(`services/contactRelation.js` — 메일 `isKnownContact` 와 상담 `mailThreadVerdict` 가 같은 함수를 읽는다) + **«내 차례» 축과 «관계» 축은 분리된 채로 둔다**(합치면 #402 가 되돌아온다) + **차이를 화면이 말한다**(상담 행 이유 칩 · Q mail 태그).
5. **워크스페이스 설정 `permissions.sales_intake.mail = 'manual' | 'auto'`** (새 컬럼 0, `customer_entry` 와 같은 JSON 자리). `auto` = 지금 기준(답했다·개인 주소·올렸다). `manual` = **사람이 [상담으로 보내기] 한 것만**. 채팅·게스트 링크는 우리 창구로 들어온 것이라 모드와 무관(§3.2). **권고 기본값 manual**(§7 Q1).
6. [상담으로 보내기] 는 dev 실HTTP 로 **메일·채팅 모두 끝까지 작동한다**(§1.5 A·F ✅). 다만 막다른 길 5개가 있다 — 실패를 삼키는 `catch`(400 이 «아무 일 없음»), 재판정이 `triage` 를 되돌리면 올린 것이 사라지는 의존, 「문의」 태그 30초 캐시, 채팅 되돌리기 문 없음(`sale_inbox_demote` 를 읽는 코드만 있고 쓰는 라우트 0), 웹폼 릴레이를 올리면 **행과 등록이 릴레이 주소**를 쓴다(§1.6).
7. 전환 시 데이터: 상담 목록은 **원본에서 파생**된다(표 없음). manual 로 바꾸면 자동 유입 18건은 목록에서 빠지되 **Q mail 에 「문의 후보」 태그 + «문의 후보만» 필터**로 남고, 올린 기록·휴지통 기록(감사 원장)은 모드와 무관하게 유지된다. 되돌리면 그대로 돌아온다. 214 후보는 지금도 어디에도 안 보이며 변화 없다(§6.1).
8. 운영 스키마 변경 0 · 외부 발송 0. 유일한 R 요소는 **Q2(메일 ④ 규칙에 개인 주소 조건)를 운영 `reply_needed` 에 재적용하는 백필**뿐 — 그 단계만 Fable 게이트 1회, 나머지는 자체 검증(F=1)(§6.3).
9. 판정: R=0(Q2 백필 제외) · S=1 · F=1 → 단계별 기계 검증은 **불변식 I1~I6 를 실HTTP 로**(§6.4). 기존 결과 불변 조건: auto 모드 + Q2 미적용 상태에서 **상담 18 · 후보 214 · 메일 폴더 건수 전부 diff 0**.
10. Irene 결정 3건(§7): ①기본값 manual + 운영 biz 1 도 manual 로 ②메일 답변필요 ④ 에 «개인 주소 모양» 조건(오탐 6→0, 오강등 0 운영 시뮬 조건부) ③미성숙 메뉴 「베타」 표시 — 아이콘이 아니라 **글자 칩 + 페이지 머리 한 줄**, `navMenus.ts` 한 곳.

---

## 1. 현 상태 전수 (2026-10-02 실측 — 운영 biz 1 읽기전용 · dev biz 5 실HTTP)

### 1.1 같은 메일을 두 술어가 각자 가른다

| 축 | 질문 | 정본 | 입력 | 바뀌는 때 |
|---|---|---|---|---|
| **Q mail 폴더** | 지금 내가 할 일인가 | `services/mailFolders.js` `folderWhere`:13-132 · `folderOf`:168-181 | `status`·`reply_needed`·`triage`·`last_message_direction` | 답장(→ 전체, #402 :50-56) · 확인완료(→ archived) · 답변필요 표시 |
| **Q sales 상담(메일)** | 영업 관계인가 | `services/saleMailCriteria.js` `mailThreadVerdict`:101-118 ← `services/saleInbox.js` `classifyMailThreads`:64-151 | 올렸나(`promoted`) · 우리 발신 수 · archived · `isPersonalSender`:61-90 | 올리기/휴지통(감사 원장 `mail.triage_correct` origin, :24-37) · 고객 등록(`client_id` 채워져 자연 이탈) |

- `reply_needed` 를 만드는 쪽: `services/emailTriage.js` `needsReply`:404-441 (①회신 ②성격 ③아는 상대 ④모르는 상대+우리 주소+강한 요청/질문) · `triageInbound`:503-562 · `retriageStored`:582-617.
- ③ «아는 상대» = `services/emailImapCron.js` `isKnownContact`:137-171 — 고객·멤버·**우리가 이 주소로 보낸 적 있음**(`JSON_SEARCH(to_emails)`, 주소 단위).
- 상담 `replied` = **스레드 단위** 발신 수(`saleInbox.js`:101-110). 같은 «우리가 답했다» 가 **두 공식**(주소 단위 vs 스레드 단위)이다 — memory `feedback_same_value_multiple_formulas`.
- 상담엔 `isPersonalSender`(역할 주소 배제)가 있고, 메일 ④ 에는 **없다**(`emailTriage.js`:438-440 은 `isAddressedToUs` + `hasStrongRequest|hasQuestion` 뿐).
- Q mail 「문의」 태그는 상담 술어를 **그대로** 읽는다(`services/mailInquiryTag.js` — 30초 캐시 :12 · `routes/email_threads.js`:412-415 · `MailPage.tsx`:2479-2483). 여기까지는 한 벌이다.

### 1.2 운영 실측 — 상담 18건의 정체 (biz 1 · user 1 · `classifyMailThreads` + `folderOf`)

| id | 상대 | 제목 | verdict | 메일 폴더 | 영업 문의인가 |
|---|---|---|---|---|---|
| 3675 | usmausmakhan96@gmail.com | Hi sir do you need kitchen staff | replied | all | ✗ 구직 |
| 3703 | zanliancung@gmail.com | (no subject) | replied | all | ✗ 구직("no open positions" 로 답함) |
| 3704 | zanliancung@gmail.com | (no subject) | personal | uncertain | ✗ 〃 |
| 3760 | nu.shaharu@ikano.asia | Tenant Circular - IPC e-Voucher | personal | uncertain | ✗ 임차인 회람 |
| 3554 | anson.kok@nttdata.com | NDA - Git Consulting Sdn Bhd | replied | reply_needed | △ 거래 서류 |
| 3591 | discipline@aspirationis.edu.my | Second warning - Disrespectful Conduct | replied | all | ✗ 학교 통지 |
| 2713 | tropicanaavenue21@gmail.com | Outstanding Water Meter Bills | replied | all | ✗ 수도요금(우리가 요청하는 쪽) |
| 3004 | joannelow98@gmail.com | Draft Tenancy Agreement | replied | all | ✗ 임대차(개인) |
| 2841 | tracy@hit-pay.com | HITPAY - One payment platform | replied | all | ✗ 벤더 콜드메일("우리는 자체 POS" 로 답함) |
| 2515 · 2644 | koreadev@apple.com | Apple Developer Support - 멤버십 | replied | all · archived | ✗ **우리가 고객**인 지원 티켓 |
| 1273 | bandarutama@anytimefitness.my | August Membership Payment | replied | archived | ✗ 우리가 회원 |
| 2426 | 5149cap@naver.com | [문의] 사유 멤버십 | replied | archived | ✗ 우리가 문의한 쪽 |
| 1267 | kh.teng@thefoodpurveyor.com | GFM New Vendor Registration | replied | archived | ✗ 우리가 등록하는 쪽 |
| 2562 | youngjun.jeong@kinemaster.com | 사이트 백업 및 복원 안내 | replied | archived | ○ 고객(사후) |
| 2409 · 2411 | woohyun.kim@industryarc.kr | 계약갱신 · 전환 비용 문의 | replied | archived | ○ 고객 |
| 83 | dcsioimallsupport2@synthesis.bz | IOI Mall - Change of POS system | replied | archived | ○ 거래 |

분포: `inquiry|replied` 16(all 7 · archived 8 · reply_needed 1) · `inquiry|personal` 2(uncertain) · `candidate` 214(archived 205 · reply_needed 5 · uncertain 4).
**발신 50통(29 스레드)은 전부 PlanQ 반송 경로**(`from_email` = help@irenewp.com 23 · irene@irenewp.com 15 · help@wor-pro.com 7 …, IMAP 보낸편지함 동기화 없음 — `emailImapCron.js`:402·927 은 수신함만 연다). 즉 `replied` 는 예외 없이 **사람이 PlanQ 에서 누른 답장**이다. 자동응답·Cue 자동발송 경로는 없다(`routes/email_threads.js`:1754 는 **초안 생성**뿐).

★ 결론: `replied` 는 «관계» 는 맞히지만 **«우리가 파는 쪽인가»** 를 못 가른다. 애플·헬스장·수도요금·학교·구직은 전부 우리가 **답한** 스레드다. 이 구분은 본문의 뜻(누가 무엇을 원하는가)이라 주소·헤더·방향으로는 안 나온다 — 키워드로 가르지 않는다는 09-16 결정과 같은 이유로, **기계 자동 유입은 정확해질 수 없다.** 그래서 사람이 올리는 모드가 필요하다.

### 1.3 #450 — 스레드 3675 추적 («메일 미싱» 인가)

| 시각(UTC) | 사건 | 근거 |
|---|---|---|
| 09-28 14:50 | inbound `usmausmakhan96@gmail.com` → help@gitconsulting.group, 본문 "Sent from my iPhone" 뿐 | `email_messages` 4546 |
| 수집 시 | triage human · `needsReply` ④: 우리 주소 ✓ · 강한 요청 ✗ · 물음표 ✗ → `reply_needed=0`, `uncertain_reason=unclear_intent` → **확인 권장**(코드 경로로 추정 — 지금 행은 `status='open'` 이라 답장 전 어느 시점에 open 으로 바뀌었다. 어느 동작이 바꿨는지는 미확인) | `emailTriage.js`:539-553 · 현재 행 `status=open·ur=unclear_intent` |
| 10-02 03:34 | **outbound** from irene@irenewp.com, `sent_by_user_id=1`, In-Reply-To 4546, 본문 "Thank you for reaching out. We appreciate your inquiry about kitchen staff. Could you please provide more details…" | `email_messages` 4743 |
| 답장 후 | `last_message_direction=outbound` → `folderOf` = **all**(#402: 내가 마지막이면 답변필요도 확인권장도 아니다) · 상담 verdict **replied** | `mailFolders.js`:175-180 · `saleMailCriteria.js`:106 |

→ 메일은 놓치지 않았다. **답장한 순간** 메일 폴더에서는 공이 넘어갔고 상담에는 «답장했다 = 관계» 로 남았다. 신고의 «왜 서로 판단이 달라?» 의 답은 §1.1 두 축이고, 그 답이 **화면 어디에도 없다** 는 것이 결함이다(`saleInbox.js`:316 `meta.verdict` → FE `grep verdict components/QSale` 0건).
(※ 답장 본문은 Cue 초안 어투다 — 보낸 주체는 사람(user 1)이다. 자동발송 경로는 없다.)

### 1.4 반대 방향 — 메일 답변필요(미연결) 7건

| id | 상대 | 제목 | reason | 상담 |
|---|---|---|---|---|
| 3554 | anson.kok@nttdata.com | NDA | holding | inquiry |
| 3737 | hosting@cafe24corp.com | 도메인 등록정보 확인 | inbound | candidate |
| 3739 | mailmaster@corp.gmarket.co.kr | G마켓 이용약관 개정 | inbound | none(발송전용 주소 skip) |
| 3750 · 3753 | iclub@flyasiana.com | 마일리지 안내(ko·en) | inbound | candidate |
| 3839 | account@lowseathoong.com | Debtor Statement | inbound | candidate |
| 3843 | puppy1505@iecoz.com | [에코트랜스] 해외배송 제안 | inbound | candidate |

6건 모두 `triage=human`(헤더에 List-* 없음) → ④ 통과(우리 주소 + 상투적 물음표/요청). `isPersonalSender` 를 통과하는 것은 **0건**(hosting·mailmaster·iclub·account 는 단일 토막 역할어, puppy1505 는 숫자 섞인 단일 토막). 상담 기준이 이미 가진 조건을 메일 ④ 가 안 쓴다 — **Q2**.

### 1.5 [상담으로 보내기] 경로 전수 + dev 실HTTP (biz 5 · 끝나면 기록 원복 · counts 기준선 일치 확인)

진입점 4곳 → 한 함수 `services/sale.ts promoteInboxItem`:375-381 → `POST /api/sale/:biz/inbox/promote`(`routes/sale_save.js`:173-235).

| 진입점 | 파일:줄 | 표시 조건 | 비고 |
|---|---|---|---|
| 메일 목록 **우클릭** | `MailPage.tsx`:2383-2390(`data-pq-context`) · 핸들러 :739-760 | `!mt.client` | `AppContextMenu.tsx`:208 은 `contextmenu` 이벤트만 — **iOS 는 long-press 로 이 이벤트가 안 온다**(Android 는 온다) |
| 메일 상세 ⋯ | `MailPage.tsx`:1311-1321 | `!detail.client` | |
| 메일 상세 **툴바 버튼** | `MailPage.tsx`:2982-2995 (`mail-detail-promote-sale-inline`) | 항상 | 폰에서도 보임(DetailMetaRight 감김) — 폰의 유일한 문 |
| 채팅 메시지 툴바 | `ChatPanel.tsx`:700-711 · :2097-2110 | 고객 대화방 ∧ 미등록 ∧ 멤버 | 서버 :222-223 과 같은 술어 |

| 검사 | 결과 | 상세 |
|---|---|---|
| A 관계 없는 사람 메일 올리기 → 상담에 나타남 | ✅ | #7625 · 200 · email 41→42 |
| B 웹폼 릴레이(`noreply@shiftee.io`, triage marketing) 올리기 → 나타남 | ✅ | 200 · verdict `promoted` (`saleInbox.js`:129-132 가 발송전용 skip 을 우회) |
| B′ 그 행의 who/email | ❌ | `who=시프티 · email=noreply@shiftee.io` — **릴레이가 상대로 보인다** |
| B″ 올린 뒤 `triage` | human 으로 바뀜 | 상담 where 가 `triage='human'`(`saleInbox.js`:78)이라 **이 값에 의존** |
| C 확인완료 메일 올리기 | ⬜ dev 픽스처 없음 | 코드상 `promoted` 가 먼저라 들어온다(`saleMailCriteria.js`:103) · status 는 안 건드린다(`sale_save.js`:201-206) |
| D 스팸 → 400 | ⬜ dev 픽스처 없음 | 코드 :196 |
| E 고객 연결 스레드 → 400 `already_client` | ✅ | |
| F 발화 없는 고객 대화방 올리기 → 나타남 | ✅ | conv#434 · chat 0→1 |
| G 보관된 대화방 올리기 | ⬜ dev 픽스처 없음 | 코드상 200 인데 목록 where 가 `archived_at: null`(`saleInbox.js`:385) → **안 보인다** |
| H 올린 직후 Q mail 「문의」 태그 | ❌ | `is_inquiry=false` — 30초 캐시(`mailInquiryTag.js`:12) |
| I `X-Workspace-Id` 불일치 | 200 | 엔티티 id 라우트 — 설계대로 헤더를 안 본다 |
| 원복 후 counts | ✅ | email 41/41 · chat 0/0 |

운영 사용 이력(biz 1 감사 원장): `sale_inbox_promote` **2회**(09-24, 같은 초) · `sale_inbox_dismiss` 9 · `sale_inbox_restore` 1. 문은 작동하지만 거의 안 눌렸다 — 자동이 채워 주니 누를 이유가 없었고, 자동이 채운 것이 틀렸다.

### 1.6 막다른 길 (수정 대상)

| # | 증상 | 원인 |
|---|---|---|
| D1 | 400(`already_client`·`thread_is_spam`·`not_customer_chat`)·네트워크 실패가 **아무 표시 없이** 끝난다 | `MailPage.tsx`:747 · `ChatPanel.tsx`:710 `catch { /* 조용히 */ }` — `j()` 는 throw 하므로 catch 로 온다(`sale.ts`:129-136) |
| D2 | 올린 메일이 **재판정 뒤 사라질 수 있다** | 상담 where `triage='human'`(`saleInbox.js`:78) ← 올리기가 triage 를 human 으로 바꿔 맞춘다(`sale_save.js`:199-200). `scripts/retriage-mail.js`:113 은 marketing 단방향 복귀를 쓴다 → 릴레이(B)처럼 원래 marketing 이던 것은 **되돌아가 목록에서 빠진다**. 사람 판단이 기계 판정 아래에 있다 |
| D3 | 올린 직후 Q mail 행 태그가 30초 안 바뀐다 | `mailInquiryTag` 캐시, 무효화 호출 0 |
| D4 | 채팅을 올리면 **되돌릴 수 없다** | `promotedConversationIds` 가 `sale_inbox_demote` 를 읽지만(`saleInbox.js`:52) 쓰는 라우트 0 · `inbox/dismiss` 는 `email_thread` 만(`sale_save.js`:79) |
| D5 | 웹폼 릴레이를 올리면 **상대 = 릴레이 주소**, [고객으로 등록] 하면 `invite_email = noreply@…` 고객이 생긴다 | `saleInbox.js`:115-116 (participants 첫 외부) · `sale_save.js`:276-289 (첫 inbound `from_email`) |
| D6 | 보관된 고객 대화방을 올리면 200 인데 안 보인다 | `saleInbox.js`:385 `archived_at: null` — 올린 것(판단)보다 보관(기계 상태)이 위 |
| D7 | iPhone 메일 목록에서 우클릭 문이 없다 | D7 은 결함이 아니라 플랫폼 — 상세 툴바 버튼이 폰의 문이다. 검사 범위에만 넣는다 |

### 1.7 설정이 살 자리

- `businesses.permissions` JSON — 이미 `customer_entry`(창구·예약)가 산다(`routes/customer_entry.js`:47-80 `normalizeIntro` 화이트리스트, PUT 은 owner/platform_admin :43·:127). 운영 biz 1 의 키는 `schedule`·`financial`·`client_info`(+ `customer_entry` 는 아직 없음).
- 화면: 설정 › 권한 `PermissionsSettings.tsx`:271 `CustomerEntrySection` 옆. `AutoSaveField` 규약(`CustomerEntrySection.tsx`:8·212).

---

## 2. 데이터 모델 — 새 컬럼 0 · 새 표 0

### 2.1 `businesses.permissions.sales_intake` (JSON 키 추가)

```json
{ "sales_intake": { "mail": "manual" } }
```

- 값: `'manual' | 'auto'`. **없으면 기본값**(§7 Q1 — 권고 `manual`). 모양은 `services/salesIntake.js normalizeIntake(raw)` **한 함수**가 정하고, 읽기(`intakeOf(biz)`)·쓰기(PUT)가 같이 지난다(`customer_entry` 규약). 모르는 키·값은 버린다(fail-closed → 기본값).
- 왜 `mail` 키인가: 지금 모드가 뜻을 갖는 채널은 메일뿐이다(§3.2). 채팅까지 넓히게 되면 `chat` 키를 더한다 — 불리언 하나로 두면 그때 뜻이 바뀐다.
- 왜 컬럼이 아닌가: 워크스페이스 단위 스위치 하나이고 조인·인덱스가 필요 없다. 창구 설정과 같은 자리에 두면 «고객이 들어오는 문» 설정이 한 곳에 모인다.

### 2.2 원장은 그대로 — 감사 로그가 상태다

올림·되돌림·휴지통·영구삭제 = `audit_logs(action='mail.triage_correct' | 'sale.inbox_promote', new_value.origin)` 스레드/대화방별 **최신 1건**(`saleInbox.js`:24-55). 모드를 바꿔도 이 기록은 그대로다. 채팅 되돌리기(D4)는 **같은 원장에 `origin:'sale_inbox_demote'`** 를 쓰는 라우트를 더한다 — 읽는 쪽은 이미 있다.

### 2.3 관계 술어 모듈 `services/contactRelation.js` (신규, 코드 이동)

| 함수 | 뜻 | 지금 사본 |
|---|---|---|
| `isPersonalSender(email)` | 보낸 주소가 **사람**인가 | `saleMailCriteria.js`:61-90 (이동) |
| `knownContact(bizId, email)` → `'client'|'member'|'replied'|null` | 고객·멤버·우리가 보낸 적 있는 주소 | `emailImapCron.js`:137-171 (이동, 반환값만 종류로) |
| `knownContactMap(bizId, emails[])` | 위의 묶음판(상담 목록은 수천 건을 한 번에 가른다) | 신규 — SQL 은 같은 문장(`JSON_SEARCH(to_emails)`, 바인딩) |
| `mailThreadVerdict({ relation, promoted, archived, personal })` | 상담 판정 | `saleMailCriteria.js`:101-118 (입력만 바뀐다 — `outboundCount>0` → `relation==='replied'`) |

★ **상담의 `replied` 를 주소 단위로 올린다.** 스레드 단위(`outByThread`)는 주소 단위의 부분집합이다(이 스레드에 우리 발신이 있으면 `to_emails` 에 그 주소가 있다). 반대 방향 — 다른 스레드에서 답한 적 있는 주소의 **새 스레드**는 지금 `personal` 이거나 후보였는데 `replied` 가 된다. 운영 실측으로 몇 건이 움직이는지 P1 기준선에서 센다(§6.4). 뜻은 메일 ③ 과 **같아진다**(«아는 상대»).

---

## 3. 공식 · 불변 조건

### 3.1 두 축은 합치지 않는다 — 대신 같은 부품을 쓴다

```
관계(relation)   = promoted ∨ knownContact∈{replied} ∨ (¬archived ∧ isPersonalSender)     ← contactRelation 한 벌
내 차례(folder)  = mailFolders.folderOf(status, reply_needed, triage, last_direction)       ← 종전 그대로(#402·#386 유지)
```

| 메일 폴더 ↔ 상담 | 지금 | 이유(화면이 말할 문장) |
|---|---|---|
| 답변필요인데 상담 아님 | 멤버 발신 · (Q2 전) 역할 주소 오탐 | «팀원 메일» / Q2 적용 후 소멸 |
| 상담인데 답변필요 아님 | 답장함(all) · 확인완료(archived) · 애매(uncertain) | «답장함 · 상대 차례» / «확인완료» / «확인 권장» |
| 등록된 고객의 메일 | 답변필요엔 있고 상담엔 없다 | «고객 이력» — 상담 목록은 미등록 접점 축(§Q_SALE 5.2-A) |

### 3.2 모드의 정의

```
mode = intakeOf(biz).mail
상담(메일) = { t : t.business_id=biz ∧ t.client_id IS NULL ∧ t.status≠'spam' ∧ ¬dismissed(t) ∧ ¬purged(t) ∧
              ( promoted(t)                                             -- 두 모드 공통 · triage·archived 무관 (D2·C 해소)
              ∨ (mode='auto' ∧ t.triage='human' ∧ ¬automatedSender(t) ∧ relation(t)∈{replied, personal}) ) }
후보(auto 가 들였을 것) = mode='manual' 일 때 위 두 번째 절을 만족하는 집합 — 목록엔 안 넣고 Q mail 태그 「문의 후보」·필터로만 보인다
채팅·게스트 = 종전 그대로(외부 발화 ∨ promoted), 모드 무관. 단 promoted 는 archived_at 을 무시한다(D6)
```

- `manual` 에서 사람이 올리지 않은 메일은 **어떤 모양이어도** 상담에 안 들어온다. 운영 biz 1 에서 18 → promoted 만.
- `auto` 는 **지금 기준 그대로**(관계가 증명된 것만). 더 좁히지 않는다 — §1.2 에서 보듯 좁혀도 «우리가 고객인 스레드» 는 못 거른다. 좁히는 시늉 대신 모드를 준다.
- 채팅·게스트 링크는 모드 밖이다: 우리 창구(고객 채팅 링크·게스트 링크)로 들어온 사람은 **구조상** 잠재 고객이고, 운영에서 노이즈 신고가 없다(dev chat 0 · guest 0). Irene 이 채팅도 수동으로 원하면 `sales_intake.chat` 한 줄이다.

### 3.3 메일 ④ 에 «개인 주소 모양» (Q2 — 결정 후)

`needsReply` ④(`emailTriage.js`:438-440): `isAddressedToUs ∧ (hasStrongRequest ∨ hasQuestion)` → **`∧ isPersonalSender(fromEmail)`**. 통과 못 하면 종전대로 **확인 권장**(사라지지 않는다).
- 운영 7건 재계산: 3554 holding(③ replied 로 유지) · 나머지 6건 → 확인 권장. 알려진 양성(joannelow98@gmail · tropicanaavenue21@gmail · ahmadaqmalbin.shaifulkharidan@concentrix) 은 personal ✓ · 회신 헤더 있는 정당 회신은 ① 에서 이미 참.
- ★ 적용 조건: **운영 전수 읽기전용 시뮬**(`reply_needed=1 ∧ reason='inbound'` 전부) 에서 뒤집히는 목록을 사람이 보고 **진짜 문의 0건**일 때만. 09-11 Joanne Low 계열(관용구 누락)과 같은 함정이 반대 방향으로도 가능하다 — 단일 토막 회사 주소(`peichin@aimcoffee.com`)가 진짜 문의면 확인 권장으로 내려간다. 그 사례가 운영에 있으면 Q2 는 **아니오**가 맞다.

### 3.4 불변식 (게이트 판정 기준 — 전부 실HTTP·DB 로 센다)

| # | 불변식 | 검사 |
|---|---|---|
| I1 | `promoted ⇒ 상담에 있다` — 모드·triage·status(spam 제외)·archived·archived_at 무관, 등록/휴지통 전까지 | 올린 뒤 `UPDATE triage='marketing'`(재판정 모사) → 여전히 있음 · manual 전환 → 여전히 있음 · 원복 |
| I2 | `dismissed ∨ purged ⇒ 상담에 없다` — 모드 무관 | 두 모드 모두 |
| I3 | `상담(메일) ⊆ Q mail all ∪ archived`, `∩ spam = ∅` | id 집합 포함 |
| I4 | auto: Q mail 「문의」 집합 = 상담 메일 집합 · manual: 「문의 후보」 집합 = auto-집합 − promoted, 상담 메일 집합 = promoted | 같은 요청 쌍에서 Set 등가 |
| I5 | (Q2 후) `답변필요 ∧ client_id NULL ∧ 발신자∉멤버 ⊆ auto-집합` | 운영 biz 1 재계산 0건 위반 |
| I6 | 모드 전환은 **원장을 바꾸지 않는다**: 전환 전후 `audit_logs` 행 수 동일 · `email_threads` UPDATE 0 | 전환 → DB diff 0 |
| I0 | **기존 결과 불변**: auto + Q2 미적용 = 지금과 동일 — 운영 biz 1 상담 18(id 동일)·후보 214·폴더 건수(답변필요 7·확인권장·전체) diff 0, dev biz 5 email 41 | P0 기준선 JSON ↔ P1 재실행 |

---

## 4. 화면 (ko / en)

### 4.1 설정 › 권한 — 「상담 유입」 카드 (owner/admin, `CustomerEntrySection` 바로 아래)

```
┌ 상담 유입 ─────────────────────────────────────────────┐
│ 메일에서 Q sales 상담으로                                 │
│ (●) 수동 — 메일·채팅에서 [상담으로 보내기] 한 것만 들어옵니다 │
│ ( ) 자동 — 답장한 상대·개인 주소에서 온 메일도 자동으로 들어옵니다 │
│ 자동 기준에 드는 메일은 Q mail 에 「문의 후보」로 표시됩니다.    │
└──────────────────────────────────────────────────────────┘
```
- `AutoSaveField type="toggle"` 아님 — 두 값 라디오(세그먼트) · 변경 즉시 PUT · ✓ 뱃지. 저장 응답으로 `inbox:refresh` 방송(§5).
- 전환 직후 Q sales 상담 탭 상단 **한 줄 안내**(닫기 가능, 로컬 보관): «자동 유입을 껐습니다. 자동 기준에 들던 메일 {{n}}건은 Q mail 에서 「문의 후보」로 볼 수 있습니다. [Q mail 에서 보기]» → `/mail?folder=all&inquiry=1`.

### 4.2 Q sales 상담 행 — **왜 여기 있는지** 를 칩 하나로

| verdict | 칩(ko) | 칩(en) | title(한 줄) |
|---|---|---|---|
| promoted | 직접 올림 | Sent manually | «{{name}} 이(가) 상담으로 보냈습니다» |
| replied | 답장함 · 상대 차례 / 답장함 · 답변 필요 | You replied · their turn / … · needs reply | «답장해서 메일함에서는 상대 차례입니다. 고객으로 등록하거나 휴지통에 넣기 전까지 상담에 남습니다» |
| personal | 개인 주소 | Personal address | «개인 주소에서 온 메일이라 자동으로 들어왔습니다» |
| (공통) 메일 폴더 | 확인완료(기존 `inbox.handled`) · 확인 권장 | Done · Review | 기존 칩 자리 |

- 자리: 기존 `ReplyTag`/`HandledTag` 줄(`SaleInboxList.tsx`:343-347) — 칩 **하나만** 더한다(밴드2 flex-wrap 금지 규칙은 상세 화면 것이고 여기는 목록 행 — 폰에서 두 줄 감김 허용은 현 행과 같다).
- 서버는 이미 `meta.verdict` 를 싣는다. `mail_folder`(folderOf) 한 키를 더한다 — 화면이 `status·direction` 으로 다시 계산하지 않는다(같은 값의 공식 두 벌 금지).

### 4.3 Q mail — 태그와 필터

- 태그 글자: auto → 「문의」(지금) · manual → **「문의 후보」** / "Lead?" → "Possible lead". 상태 명사이고 누르는 것이 아니다(«상태는 명사, 행위는 동사»). title: «자동 기준에는 들지만 수동 모드라 상담에 넣지 않았습니다. 우클릭·⋯·상세 툴바의 [상담으로 보내기]로 올립니다».
- 필터 「문의 후보만」(`?inquiry=1`, 폴더 전체 안에서) — `inquiryIdSet` 캐시 집합과 `id IN (…)` 교집합. 집합이 비면 빈 목록 + 안내.
- [상담으로 보내기] 누른 뒤 **같은 행**이 바뀐다: 성공 → 「상담으로 보냄」 2.5초(지금) + 태그 즉시 「문의」(캐시 무효화 D3) · 실패 → 버튼 옆 한 줄 사유(D1):

| code | ko | en |
|---|---|---|
| already_client | 이미 고객에 연결된 메일입니다 — 고객 이력에서 보세요 | Already linked to a client — see the client history |
| thread_is_spam | 스팸함의 메일은 상담으로 보낼 수 없습니다. 먼저 스팸 해제하세요 | Spam can't be sent to Sales. Unmark spam first |
| not_customer_chat | 팀 대화방은 상담으로 보낼 수 없습니다 | Team chats can't be sent to Sales |
| (네트워크·기타) | 상담으로 보내지 못했습니다. 다시 시도하세요 | Couldn't send to Sales. Try again |

### 4.4 릴레이 메일(D5) — 상대는 릴레이가 아니다

- 상담 행: 외부 주소가 `isAutomatedSenderAddress` 이면 `who` = «(웹폼) {{제목}}», `email` = null, 칩 「웹폼」 / "Web form".
- [고객으로 등록] → **문의 추가 폼**(기존 `components/QSale/SaleCueBar.tsx` 의 문의 추가 — `extractInquiry`(:81, `POST /inquiry/extract`) 로 마지막 inbound 본문에서 이름·메일·회사 추출 → 사람이 확인 → `saveAsClient from:'manual'`(:96-97)). 폼을 새로 그리지 않는다 — 본문 텍스트를 미리 채워 여는 진입점만 더한다. 서버 `save-as-client from='email_thread'` 는 첫 inbound 가 릴레이 주소면 **400 `relay_sender_use_manual`** — 릴레이 주소 고객이 생기는 길을 막는다. 등록 뒤 스레드 연결(`thread.client_id`)은 폼이 `email_thread_id` 를 같이 보내 서버가 붙인다(기존 부수효과 :347-361 재사용).

### 4.5 채팅 되돌리기(D4) · 보관 대화방(D6)

- 채팅 메시지 툴바 버튼: 올린 방이면 아이콘이 체크(지금 2.5초) → **상담 목록 행 ⋯ 「상담에서 빼기」** / "Remove from Sales" → `POST inbox/dismiss {kind:'conversation'}` → 원장 `sale.inbox_promote` origin `sale_inbox_demote`(읽는 코드 이미 있음).
- 보관된 방을 올리면 목록에 나오게 `promotedConvs` 는 `archived_at` 조건을 건너뛴다(I1).

### 4.6 i18n (ko/en 동시 · `qsale`·`qmail`·`settings` ns)

| 키 | ko | en |
|---|---|---|
| settings `salesIntake.title` | 상담 유입 | Sales intake |
| `salesIntake.mail.label` | 메일에서 Q sales 상담으로 | Email into Sales inquiries |
| `salesIntake.mail.manual` | 수동 — 메일·채팅에서 [상담으로 보내기] 한 것만 들어옵니다 | Manual — only what you send with [Send to Sales] |
| `salesIntake.mail.auto` | 자동 — 답장한 상대·개인 주소에서 온 메일도 자동으로 들어옵니다 | Auto — also emails from people you replied to or personal addresses |
| `salesIntake.mail.hint` | 자동 기준에 드는 메일은 Q mail 에 「문의 후보」로 표시됩니다. | Emails matching the auto rule are tagged "Possible lead" in Q mail. |
| qsale `inbox.switchedManual` | 자동 유입을 껐습니다. 자동 기준에 들던 메일 {{n}}건은 Q mail 에서 「문의 후보」로 볼 수 있습니다. | Auto intake is off. {{n}} emails that matched it are tagged "Possible lead" in Q mail. |
| `inbox.openInMail` | Q mail 에서 보기 | Open in Q mail |
| `inbox.why.promoted` / `.replied_theirs` / `.replied_needs` / `.personal` / `.webform` | 직접 올림 / 답장함 · 상대 차례 / 답장함 · 답변 필요 / 개인 주소 / 웹폼 | Sent manually / You replied · their turn / You replied · needs reply / Personal address / Web form |
| `inbox.whyHint.replied` | 답장해서 메일함에서는 상대 차례입니다. 고객으로 등록하거나 휴지통에 넣기 전까지 상담에 남습니다. | You replied, so it's their turn in mail. It stays here until registered or trashed. |
| `inbox.removeFromSales` | 상담에서 빼기 | Remove from Sales |
| `inbox.webformWho` | (웹폼) {{subject}} | (Web form) {{subject}} |
| qmail `inquiryBadgeCandidate` | 문의 후보 | Possible lead |
| `inquiryBadgeCandidateHint` | 자동 기준에는 들지만 수동 모드라 상담에 넣지 않았습니다. [상담으로 보내기]로 올립니다. | Matches the auto rule, but intake is manual. Use [Send to Sales]. |
| `filter.inquiryOnly` | 문의 후보만 | Possible leads only |
| `promoteError.already_client` 등 4종 | §4.3 표 | §4.3 표 |

가드: `node scripts/guard-invariants.js --category=i18n` · `--category=parity` · `--category=autosave`.

---

## 5. API · 권한 · 실시간

| 라우트 | 권한 | 비고 |
|---|---|---|
| GET `/api/businesses/:id/customer-entry` 응답에 **`sales_intake`** 추가 / PUT 같은 라우트 `{sales_intake:{mail}}` | 읽기 멤버 · 쓰기 owner/platform_admin(기존 :43) — admin 포함 여부는 §1.7 규약 그대로(owner) | `normalizeIntake` 화이트리스트 · AuditLog `customer_entry.update`(기존). 저장 후 `io.to('business:{id}').emit('inbox:refresh',{business_id})` + `mail:updated {bulk:true}`(태그 글자가 바뀐다) + `mailInquiryTag` 캐시 무효화 |
| GET `/api/sale/:biz/inbox` | 기존 readChain | `counts.auto_candidates`(manual 일 때만, 숫자) · 행 `meta.mail_folder` · 릴레이 `who/email` 규칙 |
| POST `/api/sale/:biz/inbox/promote` | 기존 writeChain | 성공 시 `mailInquiryTag.invalidate(biz)` + `mail:updated {thread_id, is_inquiry:true}` 방송. 응답 `data.auto_mode` |
| POST `/api/sale/:biz/inbox/dismiss` **`kind:'conversation'`** 추가 | writeChain | 원장 `sale.inbox_promote` origin `sale_inbox_demote` · `inbox:refresh` |
| POST `/api/sale/:biz/save-as-client from='email_thread'` | 기존 | 첫 inbound 가 `isAutomatedSenderAddress` → 400 `relay_sender_use_manual` |
| GET `/api/businesses/:biz/email-threads?inquiry=1` | 기존 | `id IN (inquiryIdSet)` 교집합 — 캐시 집합이 null(판정 실패)이면 400 이 아니라 **빈 목록 + `meta.inquiry_unavailable`** |

- 멀티테넌트: 모든 쿼리 `business_id` + `account_id IN (accessibleAccountIds)` 그대로. 설정은 그 워크스페이스 행에만.
- 실시간(CLAUDE.md §16): 상담 목록은 이미 `inbox:refresh`·`mail:new`·`message:new` 를 듣는다(`SaleInboxList.tsx`:168). Q mail 목록은 `mail:updated` 로 행 갱신 — `is_inquiry` 를 payload 로 받으면 재조회 없이 태그만 바꾼다.
- 가드: `--category=duproute`(customer-entry PUT 은 기존 라우트에 필드 추가 — 새 경로 0) · `wsscope`.

---

## 6. 전환 시 데이터 · 마이그레이션 · 롤백 · 판정 · 구현 순서

### 6.1 운영 18 + 214 는 어떻게 되나 (biz 1, 기본값 manual 채택 시)

| 집합 | 전환 전 | 전환 후(manual) | 되돌리면(auto) |
|---|---|---|---|
| 상담 메일 18 (replied 16 · personal 2) | 상담 목록 | **목록에서 빠짐** · Q mail 「문의 후보」 태그 + 필터 18건 · 전환 안내 줄 «18건» | 그대로 복귀(파생) |
| 후보 214 | 어디에도 안 보임 | 변화 없음 | 변화 없음 |
| 올린 것(promote 2) · 휴지통 9 · 되돌림 1 | 원장 | **그대로**(I6) | 그대로 |
| 등록된 상담(고객 행) | 고객 탭/상담 탭 | 변화 없음(모드는 미등록 메일 축만) | — |
| Q mail 폴더·배지 | — | **변화 없음**(«내 차례» 축은 안 건드린다) | — |

데이터 손실 0 — 바뀌는 것은 **파생 목록의 구성**뿐이고 원본(`email_threads`·감사 원장)은 UPDATE 0 이다(I6 로 잰다).

### 6.2 마이그레이션 · 롤백
- 스키마 변경 **없음**. JSON 키 하나. 배포 슬롯 스크립트 없음.
- 기본값을 manual 로 정하면 **모든 워크스페이스가 배포 순간 manual** 이 된다 — 그래서 §4.1 의 전환 안내 줄은 «설정을 바꿨을 때» 가 아니라 **«내 화면의 자동 유입 건수가 0 이 아닌데 모드가 manual» 일 때** 한 번 보인다(로컬 보관 키로 닫는다). 운영 다른 워크스페이스는 메일 계정이 적어 영향이 작지만 **배포 전 전 워크스페이스 auto-집합 건수를 표로 남긴다**(P0).
- 롤백 = 코드만. 키는 남아도 읽는 코드가 없으면 무해. Q2 백필을 적용했다면 그 전 `reply_needed` 스냅샷(P4 가 JSON 으로 남긴다)으로 되돌린다.

### 6.3 R/S/F
- **R=0** — 스키마 0 · 외부 발송 0 · 파생 목록만 · 올리기/빼기는 감사 원장 추가(되돌림 가능). **예외: Q2 운영 백필**(`reply_needed` 재계산) 은 운영 데이터 쓰기 → 그 단계만 **R=1 → Fable 1회**.
- S=1 — 두 축 분리·관계 술어 단일화·모드 정의는 이 문서가 정했다.
- F=1 — I0~I6 가 전부 Set 등가·DB diff 로 갈린다.
- → P1~P3 자체 검증(수치 보고 + «Fable 미검증(자체 검증)») · P4 만 게이트.

### 6.4 구현 순서와 단계 검증

**P0 기준선(코드 변경 전)** — 운영(읽기전용 SSH)·dev: 워크스페이스별 `classifyMailThreads` inquiry/candidate id 집합 · `folderOf` 분포 · 답변필요(미연결) id 집합 · 감사 원장 건수를 JSON 으로 저장(scratchpad). 운영 biz 1 = 상담 18·후보 214·답변필요 7.

**P1 관계 술어 한 벌 + 올리기 막다른 길(D1·D2·D3·D4·D6)** — `contactRelation.js` · `classifyMailThreads` where 를 `triage='human' ∨ id∈promoted` 로 · `promotedConvs` archived 무시 · dismiss(conversation) · 캐시 무효화 · FE 실패 사유 표시.
- P0 재실행 → **I0 diff 0**(auto 동작 그대로여야 한다 — `replied` 주소 단위 승격으로 움직인 건이 있으면 **id 목록으로 보고**하고 §2.3 결정 전까지 스레드 단위를 유지한다).
- I1: dev 에서 올린 뒤 `UPDATE email_threads SET triage='marketing'` → 여전히 상담 · 원복. 보관 대화방 픽스처를 **만들어서**(archived_at 세팅 → 올리기 → 보임 → 원복) G 를 잰다. C(archived 메일)도 픽스처를 만든다 — dev 에 없다고 ⬜ 로 두지 않는다.
- D1: `already_client` 스레드에 올리기 → 화면에 사유 문구가 **보인다**(좌표·가시성). D3: 올린 직후 `GET email-threads` 의 `is_inquiry=true`.
- `node scripts/e2e/run.js --suite salecriteria` 그대로 통과 + 위 검사를 그 카나리에 추가.

**P2 모드 설정 + 화면(§4.1~4.3·4.5)** — `salesIntake.js` · customer-entry GET/PUT 필드 · 상담 where 분기 · `counts.auto_candidates` · 행 `meta.mail_folder`·이유 칩 · Q mail 태그 글자/필터 · 전환 안내 줄.
- 실HTTP: owner PUT manual → GET 상담 메일 = promoted 집합(I4) · `auto_candidates` = P0 auto-집합 크기 · PUT auto → 복귀(I0) · member PUT 403 · 다른 워크스페이스 id 404 · 전환 전후 `audit_logs` COUNT·`email_threads` `updated_at` MAX 불변(I6).
- 소켓: 탭 A 전환 → 탭 B 상담 목록·Q mail 태그 ≤1초.
- 실브라우저 3폭(`--suite saleintake` 신설): 설정 카드 ✓ 뱃지 1회·PUT 1건 · 상담 행 칩 글자(replied/personal/promoted 각 1) · Q mail 「문의 후보」 + 필터 건수 = `auto_candidates` · 폰(390)에서 상세 툴바 [상담으로 보내기] 가 **보이고 눌린다**(D7). 양성 대조군: 칩 렌더를 끄면 FAIL.
- `npm run build` EXIT 0 · `error TS` 0 · 가드 전체.

**P3 릴레이(D5)** — 행 표기 · `save-as-client` 400 · 문의 추가 폼 연결.
- dev: `noreply@shiftee.io` 스레드 올리기 → `who=(웹폼) …`·`email=null` · `save-as-client from=email_thread` → 400 · 폼 경로로 등록 → `clients.invite_email ≠ noreply@` · 스레드 `client_id` 연결 · 생성 고객 원복(memory `feedback_test_data_restore`).

**P4 (결정 Q2 후) 메일 ④ 개인 주소 조건** — `needsReply` 한 줄 + 운영 재판정.
- 운영 읽기전용 시뮬: `reply_needed=1 ∧ reason='inbound' ∧ client_id NULL` 전수에 새 ④ 적용 → 뒤집히는 id·제목·발신자 표 → **사람 확인(진짜 문의 0건)** 이 선행 조건.
- 적용은 `scripts/retriage-mail.js --apply` 경로(이미 있는 문)로, 적용 전 `reply_needed` 스냅샷 JSON. I5 = 0건 위반. **Fable 게이트 1회**(백필이므로).

---

## 7. Irene 결정 필요 (최대 3)

1. **유입 기본값을 «수동» 으로, 운영 biz 1 도 수동으로?** 지금 자동 유입의 영업 적중률이 ≈30%(18건 중 5건)이고 나머지는 우리가 고객인 티켓·개인 메일이다. 자동 기준은 더 좁혀도 그것을 못 거른다(§1.2). 권고: **예**(기본 manual, 자동은 설정에서 켠다 · 채팅·게스트는 모드와 무관). 아니오면 auto 기본 + 이유 칩만으로 간다 — 그러면 #449 의 «상담 메일이 아닌데 들어온다» 는 그대로다.
2. **메일 답변필요 ④ 에 «개인 주소 모양» 조건을 더할까?** 운영 답변필요(미연결) 7건 중 6건(G마켓·아시아나·도메인·채무명세·배송제안)이 확인 권장으로 내려가고, 상담 기준과 같은 부품을 쓰게 된다. 대가: 단일 토막 회사 주소(`peichin@aimcoffee.com` 류)의 진짜 문의도 확인 권장으로 간다(사라지지는 않는다). 권고: **운영 전수 시뮬에서 뒤집히는 목록에 진짜 문의가 0건이면 예** — 그 표를 먼저 보여드린다. 0건이 아니면 아니오.
3. **미성숙 메뉴 「베타」 표시?** 권고: **예, 단 아이콘이 아니라 글자**. 아이콘만 두면 뜻을 안 알려주면서 자리를 먹는다(CLAUDE.md 상세 헤더 규칙과 같은 이유). 모양: `config/navMenus.ts` `NavMenuEntry.maturity?: 'beta'` **한 곳**에 적으면 사이드바 메뉴 이름 옆 작은 「베타」 칩 + 탭 이름 + 통합검색 결과에 같이 붙고, 그 페이지 머리줄 아래 한 줄 «베타 — 자동 분류가 틀릴 수 있어요. [피드백 보내기]»(기존 내 문의·피드백 창구로). 워크스페이스별이 아니라 **제품 단위**(코드)다. 대상 1차: Q sales(상담 자동 유입). 다른 메뉴를 더할지는 목록을 주시면 그대로 적는다. 구현은 이 설계 밖(별건 소).

---

## 8. 후속(이번 범위 밖, 기록)
- `replied` 주소 단위 승격(§2.3)으로 움직이는 운영 건이 있으면 그 목록을 보고 스레드 단위 유지 여부를 정한다(P1 에서 센다).
- `AppContextMenu` 가 `contextmenu` 만 듣는다(:208) — iOS long-press 대응은 목록 전반의 문제라 별건.
- 확인필요 `collectMails`(`routes/dashboard.js`:966-990) 는 `reply_needed` 축을 그대로 센다 — Q2 적용 시 숫자가 함께 줄어든다(같은 원천이라 따로 고칠 것 없음, 보고에 적는다).
- 상담 «답할 차례» 의 채팅 판정(마지막 발화자)과 메일 판정(`reply_needed`)은 여전히 두 축이다 — 이 문서는 메일만 다뤘다.
