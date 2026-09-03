// 계정 삭제 안내 — **공개 페이지**(로그인 불필요).
//
// ★ 구글플레이 요구사항이다: 계정을 만들 수 있는 앱은 **앱을 설치하지 않고도** 계정 삭제를
//   요청할 수 있는 웹 주소를 스토어 등록정보에 제공해야 한다. 앱 안(내 프로필)에만 있으면
//   요건을 못 채운다. 애플도 같은 취지(5.1.1(v))라 양쪽에 같이 쓴다.
// ★ 내용 요건 셋: ①앱/개발자 이름이 드러날 것 ②요청 절차가 눈에 띄게 있을 것
//   ③무엇이 지워지고 무엇이 남는지와 보관기간을 적을 것. 문구는 legal.json 의 `deletion`.
import React from 'react';
import LegalPage from './LegalPage';

const AccountDeletion: React.FC = () => <LegalPage doc="deletion" effectiveDate="2026-09-03" />;

export default AccountDeletion;
