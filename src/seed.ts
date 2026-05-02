'use strict';

function nowSeconds() {
  return Math.floor(Date.now() / 1000);
}

function buildSeedData(timestamp = nowSeconds()) {
  const category = {
    id: 'kpop',
    name: 'K-pop',
    description:
      'Albums, photocards, merch, artists, groups, members, eras, and subunits.',
    status: 'DRAFT',
    current_version_id: 'kpop-v1-draft',
    progress_mode: 'FULL',
    published_version: null,
    draft_version: 1,
    updated_at: timestamp,
    created_at: timestamp,
  };

  const entity = {
    id: 'group-bts',
    type: 'GROUP',
    name: 'BTS',
    status: 'ACTIVE',
    parents: [],
    tags: ['kpop', 'group:bts'],
    description: 'K-pop group.',
    updated_at: timestamp,
    created_at: timestamp,
  };

  const flow = {
    id: 'flow-kpop-draft',
    category_id: 'kpop',
    version: 1,
    status: 'DRAFT',
    root_question_ids: ['artist'],
    question_groups: {},
    conditions: [],
    questions: [
      {
        id: 'artist',
        type: 'SINGLE_SELECT',
        label: 'Which artist are you collecting?',
        helper_text: 'Pick the artist for this collection.',
        required: true,
        allow_all: true,
        options: [
          {
            id: 'bts',
            label: 'BTS',
            value: 'bts',
            entity_id: 'group-bts',
            tags: ['group:bts'],
          },
        ],
      },
    ],
    notes: 'Initial K-pop draft',
    updated_at: timestamp,
    created_at: timestamp,
  };

  return { category, entity, flow };
}

module.exports = { buildSeedData, nowSeconds };
