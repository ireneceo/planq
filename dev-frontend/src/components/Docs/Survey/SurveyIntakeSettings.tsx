// 설문 설정 «접수 처리» — 응답이 오면 [사건 만들기] 로 프로젝트·업무를 만들 준비 (2026-11-26 · docs/INTAKE_AUTO_CASE_DESIGN.md §6)
//   켜면 응답 탭 위에 «접수함» 이 생긴다(SurveyIntakeList). 응답만으로 저절로 만들지 않는다 — 누르는 사람이 만든다.
//   익명 설문은 켤 수 없다(서버도 409 intake_anonymous). 값 정리·검사는 서버 services/intakeCase 한 곳.
import { useEffect, useState } from 'react';
import styled from 'styled-components';
import { useTranslation } from 'react-i18next';
import AutoSaveField from '../../Common/AutoSaveField';
import PlanQSelect, { type PlanQSelectOption } from '../../Common/PlanQSelect';
import { Switch, SwitchKnob } from '../../Common/switchShell';
import type { QRecordColumn, SurveyIntake } from '../../../services/qtable';
import { fetchTemplateOptions, type TemplateOption } from '../../../services/intake';

const EMPTY: SurveyIntake = { mode: 'off', template_id: null, name_cols: [], map: { name: null, email: null, phone: null, company: null } };
type MapKey = keyof SurveyIntake['map'];
const MAP_KEYS: MapKey[] = ['name', 'email', 'phone', 'company'];

interface Props {
  businessId: number;
  columns: QRecordColumn[];
  value: SurveyIntake | undefined;
  anonymous: boolean;
  onStage: (next: SurveyIntake) => void;
  onPersist: () => Promise<void>;
}

const SurveyIntakeSettings: React.FC<Props> = ({ businessId, columns, value, anonymous, onStage, onPersist }) => {
  const { t } = useTranslation('qtable');
  const cur: SurveyIntake = { ...EMPTY, ...(value || {}), map: { ...EMPTY.map, ...((value && value.map) || {}) } };
  const on = cur.mode === 'review';
  const [templates, setTemplates] = useState<TemplateOption[] | null>(null);
  useEffect(() => {
    if (!on) return;
    let alive = true;
    fetchTemplateOptions(businessId).then((x) => { if (alive) setTemplates(x); }).catch(() => { if (alive) setTemplates([]); });
    return () => { alive = false; };
  }, [businessId, on]);

  const colOpts: PlanQSelectOption[] = [
    { value: '', label: t('intake.none', '선택 안 함') as string },
    ...columns.map((c) => ({ value: c.id, label: c.name || c.id })),
  ];
  const tplOpts: PlanQSelectOption[] = (templates || []).map((x) => ({ value: String(x.id), label: x.is_system ? `${x.name} · ${t('intake.systemTpl', '기본')}` : x.name }));
  const stage = (patch: Partial<SurveyIntake>) => onStage({ ...cur, ...patch });

  return (
    <Box data-testid="survey-intake">
      <SetTitle>{t('intake.title', '접수 처리')}</SetTitle>
      <Row>
        <Label>{t('intake.toggle', '응답으로 사건 만들기')}</Label>
        <AutoSaveField type="toggle" onSave={onPersist}>
          <Switch type="button" role="switch" aria-checked={on} $on={on} disabled={anonymous && !on}
            data-testid="survey-intake-toggle" aria-label={t('intake.toggle', '응답으로 사건 만들기') as string}
            onClick={() => stage({ mode: on ? 'off' : 'review' })}><SwitchKnob $on={on} /></Switch>
        </AutoSaveField>
      </Row>
      <Hint>
        {anonymous
          ? t('intake.anonymousBlocked', '익명 응답을 켠 설문은 사건을 만들 수 없어요(누가 보냈는지 모르는 응답을 고객과 잇지 않아요).')
          : t('intake.hint', '응답이 오면 «응답» 탭 위 접수함에서 [사건 만들기] 를 눌러 프로젝트와 템플릿 업무를 한 번에 만들어요. 응답만으로 저절로 만들지는 않아요.')}
      </Hint>
      {on && (
        <Grid>
          <Field>
            <Label>{t('intake.template', '업무 템플릿 (필수)')}</Label>
            <AutoSaveField type="select" onSave={onPersist}>
              <PlanQSelect size="sm" isSearchable options={tplOpts} isLoading={templates === null}
                placeholder={t('intake.templatePh', '템플릿 고르기') as string}
                value={tplOpts.find((o) => o.value === String(cur.template_id)) || null}
                onChange={(o) => stage({ template_id: o ? Number((o as PlanQSelectOption).value) : null })} />
            </AutoSaveField>
            {templates && templates.length === 0 && <Hint>{t('intake.noTemplates', '저장된 템플릿이 없어요. Q task 에서 템플릿을 먼저 만들어 주세요.')}</Hint>}
          </Field>
          <Field>
            <Label>{t('intake.nameCol', '사건 이름으로 쓸 칸')}</Label>
            <AutoSaveField type="select" onSave={onPersist}>
              <PlanQSelect size="sm" isSearchable={false} options={colOpts}
                value={colOpts.find((o) => o.value === (cur.name_cols[0] || '')) || colOpts[0]}
                onChange={(o) => { const v = (o as PlanQSelectOption | null)?.value; stage({ name_cols: v ? [String(v)] : [] }); }} />
            </AutoSaveField>
          </Field>
          {MAP_KEYS.map((k) => (
            <Field key={k}>
              <Label>{t(`intake.map.${k}`)}</Label>
              <AutoSaveField type="select" onSave={onPersist}>
                <PlanQSelect size="sm" isSearchable={false} options={colOpts}
                  value={colOpts.find((o) => o.value === (cur.map[k] || '')) || colOpts[0]}
                  onChange={(o) => { const v = (o as PlanQSelectOption | null)?.value; stage({ map: { ...cur.map, [k]: v ? String(v) : null } }); }} />
              </AutoSaveField>
            </Field>
          ))}
        </Grid>
      )}
      {on && <Hint>{t('intake.mapHint', '이메일이 기존 고객과 같아도 자동으로 잇지 않아요 — 만들 때 연결할지 고릅니다.')}</Hint>}
    </Box>
  );
};

export default SurveyIntakeSettings;

const Box = styled.div`display: flex; flex-direction: column; gap: 8px; border-top: 1px solid #F1F5F9; padding-top: 12px;`;
const SetTitle = styled.div`font-size: 0.875rem; font-weight: 700; color: #0F172A;`;
const Row = styled.div`display: flex; align-items: center; gap: 10px;`;
const Label = styled.div`font-size: 0.75rem; font-weight: 700; color: #475569;`;
const Grid = styled.div`display: grid; grid-template-columns: repeat(auto-fit, minmax(min(100%, 220px), 1fr)); gap: 12px;`;
const Field = styled.div`display: flex; flex-direction: column; gap: 4px; min-width: 0;`;
const Hint = styled.div`font-size: 0.75rem; color: #94A3B8; line-height: 1.5;`;
