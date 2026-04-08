const express = require('express');
const router = express.Router();
const { Task, User, Client, Conversation } = require('../models');
const { authenticateToken, checkBusinessAccess } = require('../middleware/auth');
const { successResponse, errorResponse } = require('../middleware/errorHandler');

// List tasks
router.get('/:businessId', authenticateToken, checkBusinessAccess, async (req, res, next) => {
  try {
    const where = { business_id: req.params.businessId };
    if (req.query.status) where.status = req.query.status;
    if (req.query.assignee_id) where.assignee_id = req.query.assignee_id;

    const tasks = await Task.findAll({
      where,
      include: [
        { model: User, as: 'assignee', attributes: ['id', 'name', 'email'] },
        { model: User, as: 'creator', attributes: ['id', 'name'] },
        { model: Client, attributes: ['id', 'display_name', 'company_name'] }
      ],
      order: [['created_at', 'DESC']]
    });
    successResponse(res, tasks);
  } catch (error) {
    next(error);
  }
});

// Create task
router.post('/:businessId', authenticateToken, checkBusinessAccess, async (req, res, next) => {
  try {
    const { title, description, assignee_id, client_id, conversation_id, source_message_id, priority, due_date } = req.body;
    if (!title) return errorResponse(res, 'Title required', 400);

    const task = await Task.create({
      business_id: req.params.businessId,
      title, description,
      assignee_id, client_id,
      conversation_id, source_message_id,
      priority: priority || 'medium',
      due_date,
      created_by: req.user.id
    });
    successResponse(res, task, 'Task created', 201);
  } catch (error) {
    next(error);
  }
});

// Update task
router.put('/:businessId/:id', authenticateToken, checkBusinessAccess, async (req, res, next) => {
  try {
    const task = await Task.findOne({
      where: { id: req.params.id, business_id: req.params.businessId }
    });
    if (!task) return errorResponse(res, 'Task not found', 404);

    const { title, description, assignee_id, status, priority, due_date } = req.body;

    const updates = { title, description, assignee_id, status, priority, due_date };
    if (status === 'completed' && task.status !== 'completed') {
      updates.completed_at = new Date();
    }

    await task.update(updates);
    successResponse(res, task);
  } catch (error) {
    next(error);
  }
});

// Delete task
router.delete('/:businessId/:id', authenticateToken, checkBusinessAccess, async (req, res, next) => {
  try {
    const task = await Task.findOne({
      where: { id: req.params.id, business_id: req.params.businessId }
    });
    if (!task) return errorResponse(res, 'Task not found', 404);

    await task.destroy();
    successResponse(res, null, 'Task deleted');
  } catch (error) {
    next(error);
  }
});

module.exports = router;
