// MemberRole — 워크스페이스 «역할» 사전 (2026-10-15, Fable 설계 · docs/MEMBER_ROLES_DESIGN.md)
//
// 프로젝트 멤버 역할(project_members.role)과 멤버 기본 역할(business_members.default_role)의 정본 목록.
// 두 칸은 **글자 그대로** 저장한다(FK 없음) — 읽는 쪽(task_extractor·templateApply·LLM 프롬프트)이 글자로 매칭한다.
// 대신 쓰는 문은 모두 services/memberRoles.js 를 거친다(ensureRole · renameRole · deleteRole).
// TaskTag 와 같은 모양에서 color 만 뺐다 — 역할은 글자 칩이지 색 분류가 아니다.
const { DataTypes, Model } = require('sequelize');
const { sequelize } = require('../config/database');

class MemberRole extends Model {}

MemberRole.init({
  id: { type: DataTypes.INTEGER, primaryKey: true, autoIncrement: true },
  business_id: { type: DataTypes.INTEGER, allowNull: false, references: { model: 'businesses', key: 'id' }, onDelete: 'CASCADE', onUpdate: 'CASCADE' },
  name: { type: DataTypes.STRING(30), allowNull: false },
  sort_order: { type: DataTypes.INTEGER, allowNull: false, defaultValue: 0 },
  // 만든 사람이 지워져도 역할은 남는다 — 마이그레이션 DDL(ON DELETE SET NULL)과 같게(sync alter 가 FK 를 다르게 만들지 않게)
  created_by: { type: DataTypes.INTEGER, allowNull: true, references: { model: 'users', key: 'id' }, onDelete: 'SET NULL', onUpdate: 'CASCADE' },
}, {
  sequelize, tableName: 'member_roles', timestamps: true, underscored: true,
  indexes: [
    // ai_ci collation — 대소문자만 다른 중복도 막힌다.
    { unique: true, fields: ['business_id', 'name'], name: 'member_roles_biz_name_unique' },
    // ★ 이름 명시 — 무명이면 sync alter 가 마이그레이션 인덱스와 중복을 만든다(TaskTag F3).
    { fields: ['business_id', 'sort_order'], name: 'member_roles_biz_sort' },
  ],
});

module.exports = MemberRole;
