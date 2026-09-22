export default {
  extends: ['@commitlint/config-conventional'],
  defaultIgnores: false,
  // GitHub's "Update branch" button injects merge commits into PR ranges; exempt only those.
  // Squash-only merging keeps them off main.
  ignores: [(message) => /^Merge (branch|pull request|remote-tracking branch) /.test(message)],
  rules: {
    'header-max-length': [2, 'always', 100],
    'type-enum': [
      2,
      'always',
      [
        'build',
        'chore',
        'ci',
        'docs',
        'feat',
        'fix',
        'perf',
        'refactor',
        'revert',
        'style',
        'test',
      ],
    ],
    'subject-case': [0],
  },
};
