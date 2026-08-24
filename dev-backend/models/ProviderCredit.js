const { DataTypes, Model } = require('sequelize');
const { sequelize } = require('../config/database');

// 외부 API 선불 크레딧 잔액 추적 (Deepgram STT · OpenAI LLM).
//
// 왜 필요한가 (Irene 2026-08-24): "0이 되기 전에 결제하게 해줘야지."
//   크레딧이 마르면 Q Note 녹음은 그냥 못 쓴다 — 우아한 degradation 같은 건 없다.
//   그래서 이 표의 목적은 차단이 아니라 **충전 시점을 놓치지 않는 것**이다.
//
// 잔액을 API 로 못 읽어오는 이유:
//   Deepgram/OpenAI 모두 잔액 조회가 공개 API 로 안정적이지 않다(권한·엔드포인트 변동).
//   그래서 "콘솔에서 본 잔액 + 그 시점" 을 기준선으로 박고, 우리 원장(qnote_usage_events /
//   cue_usage)의 그 시점 이후 소비를 빼서 **예상 잔액**을 만든다. 기준선을 다시 넣으면 오차가 리셋된다.
class ProviderCredit extends Model {}

ProviderCredit.init({
  id: { type: DataTypes.INTEGER, primaryKey: true, autoIncrement: true },
  provider: {
    type: DataTypes.ENUM('deepgram', 'openai'),
    allowNull: false,
    unique: true,
  },
  // 관리자가 제공사 콘솔에서 보고 입력한 잔액과 그 시각. 이후 소비는 우리 원장에서 뺀다.
  balance_start_usd: { type: DataTypes.DECIMAL(10, 4), allowNull: false, defaultValue: 0 },
  balance_start_at: { type: DataTypes.DATE, allowNull: false },
  // ★ 기준선을 넣은 **그 순간의 원장 누적 소비액**. 이후 소비 = (현재 누적) − (이 값).
  //   시간으로 자르지 않는 이유: cue_usage 는 월 rollup 이라 일 단위가 없다. 기준선을 월 중간에
  //   넣으면 "그 달 전체"가 통째로 차감돼 이미 지불한 돈을 또 빼고 즉시 소진 오보가 난다
  //   (자체 반증에서 20일치 잔액이 즉시 0 으로 나왔다). 누적 차감은 두 제공사 모두에 정확하다.
  baseline_spent_usd: { type: DataTypes.DECIMAL(12, 6), allowNull: false, defaultValue: 0 },
  // 단가 (없으면 env 기본값). Deepgram = USD/분, OpenAI = 호출 시점에 이미 원장에 기록되므로 미사용.
  unit_price_usd: { type: DataTypes.DECIMAL(10, 6), allowNull: true },
  // 충전 페이지 — 경보 메일과 관리자 화면에서 바로 누를 수 있게.
  topup_url: { type: DataTypes.STRING(300), allowNull: true },
  // 마지막으로 보낸 경보 단계(남은 일수 임계값). 같은 단계를 반복 발송하지 않기 위한 상태.
  //   잔액이 회복(충전)되면 null 로 되돌려 다음 하강에 다시 울리게 한다.
  last_alert_days: { type: DataTypes.INTEGER, allowNull: true },
  last_alert_at: { type: DataTypes.DATE, allowNull: true },
  // 마지막 안전망 — 예상 잔액이 0 이하일 때 신규 사용을 막을지. 기본 ON.
  //   끄면 크레딧이 마른 뒤 제공사가 직접 실패를 던지고 사용자는 원인 모를 오류를 본다.
  block_on_empty: { type: DataTypes.BOOLEAN, allowNull: false, defaultValue: true },
  updated_by_user_id: { type: DataTypes.INTEGER, allowNull: true },
}, {
  sequelize,
  tableName: 'provider_credits',
  timestamps: true,
  underscored: true,
});

module.exports = ProviderCredit;
