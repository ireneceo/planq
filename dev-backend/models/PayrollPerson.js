// PayrollPerson — 급여 대상자 (docs/PAYROLL_DESIGN.md §3.1). 멤버일 수도, 계정이 없는 프리랜서일 수도 있다.
//   ★ 주민번호 칸은 없다(세무사가 갖고 있다). 계좌는 bank_account_enc(전역 toJSON 이 지우고 bank_account_set 만 남긴다).
//   삭제 대신 status='left'. 계약이 하나도 없을 때만 지울 수 있다(routes/payroll.js).
const { DataTypes, Model } = require('sequelize');
const { sequelize } = require('../config/database');

class PayrollPerson extends Model {}

PayrollPerson.init({
  id: { type: DataTypes.INTEGER, primaryKey: true, autoIncrement: true },
  business_id: { type: DataTypes.INTEGER, allowNull: false },
  user_id: { type: DataTypes.INTEGER, allowNull: true },
  display_name: { type: DataTypes.STRING(100), allowNull: false },
  employee_no: { type: DataTypes.STRING(30), allowNull: true },
  email: { type: DataTypes.STRING(255), allowNull: true },
  income_kind: { type: DataTypes.ENUM('employment', 'business', 'other'), allowNull: false, defaultValue: 'employment' },
  hired_on: { type: DataTypes.DATEONLY, allowNull: true },
  left_on: { type: DataTypes.DATEONLY, allowNull: true },
  job_title: { type: DataTypes.STRING(100), allowNull: true },
  department_id: { type: DataTypes.INTEGER, allowNull: true },
  bank_name: { type: DataTypes.STRING(60), allowNull: true },
  bank_account_enc: { type: DataTypes.TEXT, allowNull: true },
  status: { type: DataTypes.ENUM('active', 'left'), allowNull: false, defaultValue: 'active' },
  note: { type: DataTypes.STRING(500), allowNull: true },
  created_by: { type: DataTypes.INTEGER, allowNull: true },
}, { sequelize, tableName: 'payroll_people', timestamps: true, underscored: true });

module.exports = PayrollPerson;
