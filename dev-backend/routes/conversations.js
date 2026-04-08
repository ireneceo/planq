const express = require('express');
const router = express.Router();
const { Conversation, ConversationParticipant, Message, User, Client } = require('../models');
const { authenticateToken, checkBusinessAccess } = require('../middleware/auth');
const { successResponse, errorResponse } = require('../middleware/errorHandler');

// List conversations
router.get('/:businessId', authenticateToken, checkBusinessAccess, async (req, res, next) => {
  try {
    const conversations = await Conversation.findAll({
      where: { business_id: req.params.businessId },
      include: [
        { model: Client },
        { model: ConversationParticipant, as: 'participants', include: [{ model: User, attributes: ['id', 'name', 'email'] }] }
      ],
      order: [['last_message_at', 'DESC']]
    });
    successResponse(res, conversations);
  } catch (error) {
    next(error);
  }
});

// Create conversation
router.post('/:businessId', authenticateToken, checkBusinessAccess, async (req, res, next) => {
  try {
    const { title, client_id, participant_ids } = req.body;

    const conversation = await Conversation.create({
      business_id: req.params.businessId,
      title,
      client_id: client_id || null
    });

    // Add creator as participant
    await ConversationParticipant.create({
      conversation_id: conversation.id,
      user_id: req.user.id,
      role: 'owner'
    });

    // Add other participants
    if (participant_ids && participant_ids.length > 0) {
      for (const pid of participant_ids) {
        if (pid !== req.user.id) {
          await ConversationParticipant.create({
            conversation_id: conversation.id,
            user_id: pid,
            role: 'member'
          });
        }
      }
    }

    successResponse(res, conversation, 'Conversation created', 201);
  } catch (error) {
    next(error);
  }
});

// Get conversation with messages
router.get('/:businessId/:id', authenticateToken, checkBusinessAccess, async (req, res, next) => {
  try {
    const conversation = await Conversation.findOne({
      where: { id: req.params.id, business_id: req.params.businessId },
      include: [
        { model: Client },
        { model: ConversationParticipant, as: 'participants', include: [{ model: User, attributes: ['id', 'name', 'email', 'avatar_url'] }] },
        { model: Message, as: 'messages', include: [{ model: User, as: 'sender', attributes: ['id', 'name', 'avatar_url'] }], order: [['created_at', 'ASC']], limit: 100 }
      ]
    });
    if (!conversation) return errorResponse(res, 'Conversation not found', 404);
    successResponse(res, conversation);
  } catch (error) {
    next(error);
  }
});

// Archive conversation
router.patch('/:businessId/:id/archive', authenticateToken, checkBusinessAccess, async (req, res, next) => {
  try {
    const conversation = await Conversation.findOne({
      where: { id: req.params.id, business_id: req.params.businessId }
    });
    if (!conversation) return errorResponse(res, 'Conversation not found', 404);

    await conversation.update({ status: 'archived' });
    successResponse(res, conversation);
  } catch (error) {
    next(error);
  }
});

module.exports = router;
