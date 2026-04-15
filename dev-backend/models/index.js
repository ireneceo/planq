const User = require('./User');
const Business = require('./Business');
const BusinessMember = require('./BusinessMember');
const Client = require('./Client');
const Conversation = require('./Conversation');
const ConversationParticipant = require('./ConversationParticipant');
const Message = require('./Message');
const MessageAttachment = require('./MessageAttachment');
const Task = require('./Task');
const File = require('./File');
const Invoice = require('./Invoice');
const InvoiceItem = require('./InvoiceItem');
const AuditLog = require('./AuditLog');
const KbDocument = require('./KbDocument');
const KbChunk = require('./KbChunk');
const KbPinnedFaq = require('./KbPinnedFaq');
const CueUsage = require('./CueUsage');
const Project = require('./Project');
const ProjectMember = require('./ProjectMember');
const ProjectClient = require('./ProjectClient');
const ProjectNote = require('./ProjectNote');
const ProjectIssue = require('./ProjectIssue');
const TaskCandidate = require('./TaskCandidate');

// ============================================
// Associations
// ============================================

// Business
Business.belongsTo(User, { as: 'owner', foreignKey: 'owner_id' });
User.hasMany(Business, { as: 'ownedBusinesses', foreignKey: 'owner_id' });

// BusinessMember
BusinessMember.belongsTo(Business, { foreignKey: 'business_id' });
BusinessMember.belongsTo(User, { as: 'user', foreignKey: 'user_id' });
BusinessMember.belongsTo(User, { as: 'inviter', foreignKey: 'invited_by' });
Business.hasMany(BusinessMember, { as: 'members', foreignKey: 'business_id' });
User.hasMany(BusinessMember, { as: 'memberships', foreignKey: 'user_id' });

// Client
Client.belongsTo(Business, { foreignKey: 'business_id' });
Client.belongsTo(User, { as: 'user', foreignKey: 'user_id' });
Client.belongsTo(User, { as: 'inviter', foreignKey: 'invited_by' });
Business.hasMany(Client, { as: 'clients', foreignKey: 'business_id' });
User.hasMany(Client, { as: 'clientProfiles', foreignKey: 'user_id' });

// Conversation
Conversation.belongsTo(Business, { foreignKey: 'business_id' });
Conversation.belongsTo(Client, { foreignKey: 'client_id' });
Business.hasMany(Conversation, { as: 'conversations', foreignKey: 'business_id' });
Client.hasMany(Conversation, { as: 'conversations', foreignKey: 'client_id' });

// ConversationParticipant
ConversationParticipant.belongsTo(Conversation, { foreignKey: 'conversation_id' });
ConversationParticipant.belongsTo(User, { foreignKey: 'user_id' });
Conversation.hasMany(ConversationParticipant, { as: 'participants', foreignKey: 'conversation_id' });
User.hasMany(ConversationParticipant, { as: 'participations', foreignKey: 'user_id' });

// Message
Message.belongsTo(Conversation, { foreignKey: 'conversation_id' });
Message.belongsTo(User, { as: 'sender', foreignKey: 'sender_id' });
Message.belongsTo(Task, { foreignKey: 'task_id' });
Conversation.hasMany(Message, { as: 'messages', foreignKey: 'conversation_id' });
User.hasMany(Message, { as: 'messages', foreignKey: 'sender_id' });

// MessageAttachment
MessageAttachment.belongsTo(Message, { foreignKey: 'message_id' });
Message.hasMany(MessageAttachment, { as: 'attachments', foreignKey: 'message_id' });

// Task
Task.belongsTo(Business, { foreignKey: 'business_id' });
Task.belongsTo(Conversation, { foreignKey: 'conversation_id' });
Task.belongsTo(Message, { as: 'sourceMessage', foreignKey: 'source_message_id' });
Task.belongsTo(User, { as: 'assignee', foreignKey: 'assignee_id' });
Task.belongsTo(Client, { foreignKey: 'client_id' });
Task.belongsTo(User, { as: 'creator', foreignKey: 'created_by' });
Business.hasMany(Task, { as: 'tasks', foreignKey: 'business_id' });
Conversation.hasMany(Task, { as: 'tasks', foreignKey: 'conversation_id' });

// File
File.belongsTo(Business, { foreignKey: 'business_id' });
File.belongsTo(Client, { foreignKey: 'client_id' });
File.belongsTo(User, { as: 'uploader', foreignKey: 'uploader_id' });
Business.hasMany(File, { as: 'files', foreignKey: 'business_id' });
Client.hasMany(File, { as: 'files', foreignKey: 'client_id' });

// Invoice
Invoice.belongsTo(Business, { foreignKey: 'business_id' });
Invoice.belongsTo(Client, { foreignKey: 'client_id' });
Invoice.belongsTo(User, { as: 'creator', foreignKey: 'created_by' });
Business.hasMany(Invoice, { as: 'invoices', foreignKey: 'business_id' });
Client.hasMany(Invoice, { as: 'invoices', foreignKey: 'client_id' });

// InvoiceItem
InvoiceItem.belongsTo(Invoice, { foreignKey: 'invoice_id' });
Invoice.hasMany(InvoiceItem, { as: 'items', foreignKey: 'invoice_id' });

// AuditLog
AuditLog.belongsTo(User, { foreignKey: 'user_id' });
AuditLog.belongsTo(Business, { foreignKey: 'business_id' });

// ─── Cue 전용 관계 ───
Business.belongsTo(User, { as: 'cueUser', foreignKey: 'cue_user_id' });

// Message 확장 관계
Message.belongsTo(Invoice, { foreignKey: 'invoice_id' });

// Client 담당 멤버
Client.belongsTo(User, { as: 'assignedMember', foreignKey: 'assigned_member_id' });

// KbDocument
KbDocument.belongsTo(Business, { foreignKey: 'business_id' });
KbDocument.belongsTo(User, { as: 'uploader', foreignKey: 'uploaded_by' });
Business.hasMany(KbDocument, { as: 'kbDocuments', foreignKey: 'business_id' });

// KbChunk
KbChunk.belongsTo(KbDocument, { foreignKey: 'kb_document_id', onDelete: 'CASCADE' });
KbChunk.belongsTo(Business, { foreignKey: 'business_id' });
KbDocument.hasMany(KbChunk, { as: 'chunks', foreignKey: 'kb_document_id', onDelete: 'CASCADE' });
Business.hasMany(KbChunk, { as: 'kbChunks', foreignKey: 'business_id' });

// KbPinnedFaq
KbPinnedFaq.belongsTo(Business, { foreignKey: 'business_id' });
KbPinnedFaq.belongsTo(User, { as: 'creator', foreignKey: 'created_by' });
Business.hasMany(KbPinnedFaq, { as: 'kbPinnedFaqs', foreignKey: 'business_id' });

// CueUsage
CueUsage.belongsTo(Business, { foreignKey: 'business_id' });
Business.hasMany(CueUsage, { as: 'cueUsage', foreignKey: 'business_id' });

// Project
Project.belongsTo(Business, { foreignKey: 'business_id' });
Project.belongsTo(User, { as: 'owner', foreignKey: 'owner_user_id' });
Project.belongsTo(User, { as: 'defaultAssignee', foreignKey: 'default_assignee_user_id' });
Business.hasMany(Project, { as: 'projects', foreignKey: 'business_id' });

ProjectMember.belongsTo(Project, { foreignKey: 'project_id', onDelete: 'CASCADE' });
ProjectMember.belongsTo(User, { foreignKey: 'user_id' });
Project.hasMany(ProjectMember, { as: 'projectMembers', foreignKey: 'project_id' });

ProjectClient.belongsTo(Project, { foreignKey: 'project_id', onDelete: 'CASCADE' });
ProjectClient.belongsTo(Client, { foreignKey: 'client_id' });
ProjectClient.belongsTo(User, { as: 'contactUser', foreignKey: 'contact_user_id' });
Project.hasMany(ProjectClient, { as: 'projectClients', foreignKey: 'project_id' });

// ProjectNote / ProjectIssue / TaskCandidate
ProjectNote.belongsTo(Project, { foreignKey: 'project_id', onDelete: 'CASCADE' });
ProjectNote.belongsTo(User, { as: 'author', foreignKey: 'author_user_id' });
Project.hasMany(ProjectNote, { as: 'notes', foreignKey: 'project_id' });

ProjectIssue.belongsTo(Project, { foreignKey: 'project_id', onDelete: 'CASCADE' });
ProjectIssue.belongsTo(User, { as: 'author', foreignKey: 'author_user_id' });
Project.hasMany(ProjectIssue, { as: 'issues', foreignKey: 'project_id' });

TaskCandidate.belongsTo(Project, { foreignKey: 'project_id', onDelete: 'CASCADE' });
TaskCandidate.belongsTo(Conversation, { foreignKey: 'conversation_id' });
TaskCandidate.belongsTo(User, { as: 'guessedAssignee', foreignKey: 'guessed_assignee_user_id' });
Project.hasMany(TaskCandidate, { as: 'taskCandidates', foreignKey: 'project_id' });

// Project ↔ Conversation
Conversation.belongsTo(Project, { foreignKey: 'project_id' });
Project.hasMany(Conversation, { as: 'conversations', foreignKey: 'project_id' });

// Project ↔ Task
Task.belongsTo(Project, { foreignKey: 'project_id' });
Project.hasMany(Task, { as: 'tasks', foreignKey: 'project_id' });

module.exports = {
  User,
  Business,
  BusinessMember,
  Client,
  Conversation,
  ConversationParticipant,
  Message,
  MessageAttachment,
  Task,
  File,
  Invoice,
  InvoiceItem,
  AuditLog,
  KbDocument,
  KbChunk,
  KbPinnedFaq,
  CueUsage,
  Project,
  ProjectMember,
  ProjectClient,
  ProjectNote,
  ProjectIssue,
  TaskCandidate,
};
