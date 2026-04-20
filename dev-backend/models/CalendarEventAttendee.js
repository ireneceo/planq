const { DataTypes, Model } = require('sequelize');
const { sequelize } = require('../config/database');

class CalendarEventAttendee extends Model {}

CalendarEventAttendee.init({
  id: { type: DataTypes.BIGINT, primaryKey: true, autoIncrement: true },
  event_id: { type: DataTypes.BIGINT, allowNull: false },
  user_id: { type: DataTypes.INTEGER, allowNull: true },
  client_id: { type: DataTypes.INTEGER, allowNull: true },
  response: {
    type: DataTypes.ENUM('pending', 'accepted', 'declined', 'tentative'),
    allowNull: false,
    defaultValue: 'pending',
  },
  responded_at: { type: DataTypes.DATE, allowNull: true },
}, {
  sequelize,
  tableName: 'calendar_event_attendees',
  timestamps: true,
  underscored: true,
  indexes: [
    { fields: ['event_id'] },
    { fields: ['user_id'] },
    { fields: ['client_id'] },
  ],
});

module.exports = CalendarEventAttendee;
