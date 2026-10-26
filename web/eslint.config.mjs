// For more info, see https://github.com/storybookjs/eslint-plugin-storybook#configuration-flat-config-format
import storybook from "eslint-plugin-storybook";

import nx from '@nx/eslint-plugin';
import baseConfig from '../eslint.config.mjs';

export default [...nx.configs['flat/react'], ...baseConfig, {
  files: ['**/*.ts', '**/*.tsx', '**/*.js', '**/*.jsx'],
  // Override or add rules here
  rules: {},
}, ...storybook.configs["flat/recommended"]];
