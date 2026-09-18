// 서명 언어 탭 — [한국어 | English]. 세 화면(워크스페이스 공통·계정·별칭)이 **같은 것**을 쓴다.
//
// ★ 2026-09-18 (Irene: *"이메일이 영어일 때랑 한글내용일 때 서명이 따로 붙어야 하는데
//   다 한글 기본서명이 가네. 언어별로 서명 만들게 해줘."*)
//
// ★ 베끼지 않고 **빼서 같이 쓴다.** 편집 화면이 셋이라 각자 그리면 반드시 갈라진다
//   (memory `feedback_copied_component_drifts_extract_shell`). 알약 자체도 새로 만들지 않고
//   `components/Common/segmentedToggle` 를 그대로 쓴다 — Q task·Q sale 과 같은 모양.
//
// ★ **영문 칸을 비우면 기본(한국어) 서명이 붙는다.** 그래서 «언어별 사용» 스위치를 따로 두지 않는다 —
//   비우는 것이 곧 «안 쓴다» 다. 한국어 서명이 «비우면 윗층» 인 것과 같은 규칙이고,
//   스위치를 더하면 규칙이 두 벌이 된다. 그 사실을 화면이 **짧게 말해 준다**
//   (memory `feedback_rules_must_be_explained_briefly`).
import styled from 'styled-components';
import { useTranslation } from 'react-i18next';
import { SegmentedToggle, SegmentedBtn } from './segmentedToggle';

export type SigLang = 'ko' | 'en';

interface Props {
  value: SigLang;
  onChange: (l: SigLang) => void;
  /** 영문 칸이 비어 있는가 — 비었으면 "기본 서명이 붙어요" 를 알려준다 */
  enEmpty: boolean;
}

export default function SignatureLangTabs({ value, onChange, enEmpty }: Props) {
  const { t } = useTranslation('qmail');
  return (
    <Wrap>
      <SegmentedToggle role="tablist">
        <SegmentedBtn type="button" role="tab" aria-selected={value === 'ko'} $active={value === 'ko'}
          onClick={() => onChange('ko')}>
          {t('signature.langKo', { defaultValue: '한국어' }) as string}
        </SegmentedBtn>
        <SegmentedBtn type="button" role="tab" aria-selected={value === 'en'} $active={value === 'en'}
          onClick={() => onChange('en')}>
          {t('signature.langEn', { defaultValue: 'English' }) as string}
        </SegmentedBtn>
      </SegmentedToggle>
      <Note>
        {value === 'en' && enEmpty
          ? t('signature.enEmptyNote', { defaultValue: '비워두면 영문 메일에도 한국어 서명이 붙습니다.' }) as string
          : t('signature.langNote', { defaultValue: '메일 본문 언어에 맞춰 자동으로 골라 붙습니다.' }) as string}
      </Note>
    </Wrap>
  );
}

const Wrap = styled.div`display: flex; align-items: center; gap: 10px; flex-wrap: wrap;`;
const Note = styled.span`font-size: 0.6875rem; color: #64748B;`;
