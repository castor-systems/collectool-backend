'use strict';

const VALID_QUESTION_TYPES = new Set([
  'SINGLE_SELECT',
  'MULTI_SELECT',
  'TOGGLE',
]);
const VALID_OPERATORS = new Set([
  'INCLUDES',
  'EQUALS',
  'NOT_INCLUDES',
  'IS_SET',
]);

function unique(values) {
  const seen = new Set();
  const result = [];

  for (const value of values) {
    if (!seen.has(value)) {
      seen.add(value);
      result.push(value);
    }
  }

  return result;
}

function questionMap(flow) {
  return new Map(
    (flow.questions || []).map((question) => [question.id, question])
  );
}

function getAnswerValues(answer) {
  if (answer === undefined || answer === null || answer === '') {
    return [];
  }

  return Array.isArray(answer)
    ? answer.filter((value) => value !== '')
    : [answer];
}

function isConditionMet(rule, answers) {
  const condition = rule.condition || {};
  const answer = answers[condition.question_id];
  const expectedValues = Array.isArray(condition.value) ? condition.value : [];

  if (condition.operator === 'IS_SET') {
    return getAnswerValues(answer).length > 0;
  }

  const answerValues = getAnswerValues(answer);

  if (condition.operator === 'EQUALS' || condition.operator === 'INCLUDES') {
    return answerValues.some((value) => expectedValues.includes(value));
  }

  if (condition.operator === 'NOT_INCLUDES') {
    return !answerValues.some((value) => expectedValues.includes(value));
  }

  return false;
}

function computeVisibleQuestionIds(flow, answers) {
  const questionsById = questionMap(flow);
  const visible = [];
  const visibleSet = new Set();
  const shownGroups = new Set();

  function addQuestion(id) {
    if (questionsById.has(id) && !visibleSet.has(id)) {
      visibleSet.add(id);
      visible.push(id);
    }
  }

  for (const questionId of flow.root_question_ids || []) {
    addQuestion(questionId);
  }

  let changed = true;
  while (changed) {
    changed = false;

    for (const rule of flow.conditions || []) {
      if (!isConditionMet(rule, answers || {})) {
        continue;
      }

      for (const action of rule.actions || []) {
        if (
          action.type !== 'SHOW_QUESTION_GROUP' ||
          shownGroups.has(action.target)
        ) {
          continue;
        }

        const group = (flow.question_groups || {})[action.target];
        if (!group) {
          continue;
        }

        shownGroups.add(action.target);
        for (const questionId of group.questions || []) {
          addQuestion(questionId);
        }
        changed = true;
      }
    }
  }

  return visible;
}

function normalizeAnswers(flow, visibleQuestionIds, answers) {
  const questionsById = questionMap(flow);
  const visibleSet = new Set(visibleQuestionIds);
  const normalized = {};

  for (const [questionId, answer] of Object.entries(answers || {})) {
    if (!visibleSet.has(questionId)) {
      continue;
    }

    const question = questionsById.get(questionId);
    if (!question) {
      continue;
    }

    const validValues = new Set(
      (question.options || []).map((option) => option.value)
    );
    const values = getAnswerValues(answer).filter((value) =>
      validValues.has(value)
    );

    if (values.length === 0) {
      continue;
    }

    normalized[questionId] =
      question.type === 'MULTI_SELECT' ? unique(values) : values[0];
  }

  return normalized;
}

function collectTags(flow, visibleQuestionIds, answers) {
  const questionsById = questionMap(flow);
  const tags = [];

  for (const questionId of visibleQuestionIds) {
    const question = questionsById.get(questionId);
    if (!question) {
      continue;
    }

    const selectedValues = new Set(getAnswerValues(answers[questionId]));
    for (const option of question.options || []) {
      if (selectedValues.has(option.value)) {
        tags.push(...(option.tags || []));
      }
    }
  }

  return unique(tags);
}

function answerSatisfiesQuestion(question, answer) {
  const values = getAnswerValues(answer);
  if (!question.required) {
    return true;
  }

  return values.length > 0;
}

function buildRuntimeResponse(flow, answers) {
  const firstVisibleIds = computeVisibleQuestionIds(flow, answers || {});
  const normalizedAnswers = normalizeAnswers(
    flow,
    firstVisibleIds,
    answers || {}
  );
  const visibleQuestionIds = computeVisibleQuestionIds(flow, normalizedAnswers);
  const finalAnswers = normalizeAnswers(
    flow,
    visibleQuestionIds,
    normalizedAnswers
  );
  const questionsById = questionMap(flow);
  const visibleQuestions = visibleQuestionIds
    .map((questionId) => questionsById.get(questionId))
    .filter(Boolean);
  const nextQuestion =
    visibleQuestions.find(
      (question) =>
        !answerSatisfiesQuestion(question, finalAnswers[question.id])
    ) || null;

  return {
    flow,
    visible_questions: visibleQuestions,
    next_question: nextQuestion,
    answers: finalAnswers,
    tags: collectTags(flow, visibleQuestionIds, finalAnswers),
    is_complete: nextQuestion === null,
  };
}

function validateFlow(flow, entities) {
  const errors = [];
  const ids = new Set();
  const entityIds = new Set((entities || []).map((entity) => entity.id));

  for (const question of flow.questions || []) {
    if (!question.id) {
      errors.push('Question id is required');
      continue;
    }

    if (ids.has(question.id)) {
      errors.push(`Duplicate question id: ${question.id}`);
    }
    ids.add(question.id);

    if (!VALID_QUESTION_TYPES.has(question.type)) {
      errors.push(`Invalid question type for ${question.id}`);
    }

    const optionValues = new Set();
    for (const option of question.options || []) {
      if (optionValues.has(option.value)) {
        errors.push(
          `Duplicate option value ${option.value} in question ${question.id}`
        );
      }
      optionValues.add(option.value);

      if (option.entity_id && !entityIds.has(option.entity_id)) {
        errors.push(
          `Option ${option.id} references missing entity ${option.entity_id}`
        );
      }
    }
  }

  for (const questionId of flow.root_question_ids || []) {
    if (!ids.has(questionId)) {
      errors.push(`Root question references missing question ${questionId}`);
    }
  }

  for (const [groupId, group] of Object.entries(flow.question_groups || {})) {
    for (const questionId of group.questions || []) {
      if (!ids.has(questionId)) {
        errors.push(
          `Question group ${groupId} references missing question ${questionId}`
        );
      }
    }
  }

  for (const rule of flow.conditions || []) {
    const condition = rule.condition || {};
    if (!ids.has(condition.question_id)) {
      errors.push(
        `Condition ${rule.id} references missing question ${condition.question_id}`
      );
    }

    if (!VALID_OPERATORS.has(condition.operator)) {
      errors.push(
        `Condition ${rule.id} uses invalid operator ${condition.operator}`
      );
    }

    for (const action of rule.actions || []) {
      if (action.type !== 'SHOW_QUESTION_GROUP') {
        errors.push(`Condition ${rule.id} uses invalid action ${action.type}`);
      }

      if (!(flow.question_groups || {})[action.target]) {
        errors.push(
          `Condition ${rule.id} references missing question group ${action.target}`
        );
      }
    }
  }

  return errors;
}

module.exports = {
  buildRuntimeResponse,
  computeVisibleQuestionIds,
  isConditionMet,
  normalizeAnswers,
  validateFlow,
};
