import eslintPluginPrettierRecommended from 'eslint-plugin-prettier/recommended';
import tseslint from 'typescript-eslint';
import config from '@pixi/eslint-config';

export default tseslint.config(
    {
        ignores: ['**/dist/**', '**/.docusaurus/**', '**/build/**', '**/node_modules/**'],
    },
    config,
    eslintPluginPrettierRecommended,
    {
        files: ['**/*.ts', '**/*.tsx'],
        rules: {
            'prettier/prettier': ['error', {}, { usePrettierrc: true }],
            '@stylistic/indent': 'off',
            '@stylistic/brace-style': 'off',
            'dot-notation': 'off',
            '@typescript-eslint/dot-notation': ['error', { allowProtectedClassPropertyAccess: true }],
        },
    },
    {
        files: ['**/*.test.ts'],
        rules: {
            '@typescript-eslint/dot-notation': 'off',
        },
    },
);
