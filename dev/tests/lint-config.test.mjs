import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

const repositoryRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');

// Возвращает пути, которые попадут в чистый checkout CI, чтобы локальные игнорируемые файлы не скрывали ошибку ESLint.
function listTrackedFiles() {
  return new Set(execFileSync('git', ['ls-files'], {
    cwd: repositoryRoot,
    encoding: 'utf8'
  }).split(/\r?\n/).filter(Boolean));
}

// Закрепляет обязательный контур статической проверки, его область исходников и запуск для каждого обычного CI.
test('ESLint проверяет runtime и тестовый код в отдельной CI-задаче', async function() {
  const [packageSource, configSource, workflowSource] = await Promise.all([
    readFile(path.join(repositoryRoot, 'dev', 'package.json'), 'utf8'),
    readFile(path.join(repositoryRoot, 'dev', 'eslint.config.mjs'), 'utf8'),
    readFile(path.join(repositoryRoot, '.github', 'workflows', 'tests.yml'), 'utf8')
  ]);
  const packageData = JSON.parse(packageSource);
  const lintCommand = packageData.scripts && packageData.scripts.lint;
  const qualityStart = workflowSource.indexOf('  quality:');
  const testStart = workflowSource.indexOf('  test:', qualityStart);
  const qualityJob = workflowSource.slice(qualityStart, testStart);

  assert.equal(packageData.devDependencies.eslint, '10.8.1');
  assert.equal(packageData.devDependencies.globals, '17.11.0');
  assert.match(lintCommand, /eslint/);
  assert.ok(lintCommand.includes('engine/*.js'));
  assert.ok(lintCommand.includes('dev/tests/**/*.mjs'));
  const explicitLintTargets = Array.from(lintCommand.matchAll(/"([^"]+)"/g), function(match) {
    return match[1];
  }).filter(function(target) {
    return !/[?*[\]]/.test(target);
  });
  const trackedFiles = listTrackedFiles();
  const untrackedExplicitTargets = explicitLintTargets.filter(function(target) {
    return !trackedFiles.has(target);
  });
  assert.deepEqual(untrackedExplicitTargets, [],
    'ESLint явно ссылается на отсутствующие в чистом checkout файлы');
  assert.ok(configSource.includes("'no-dupe-keys': 'error'"));
  assert.ok(configSource.includes("'no-undef': 'error'"));
  assert.ok(configSource.includes("'no-unused-vars': ['error'"));
  assert.ok(configSource.includes("'no-unreachable': 'error'"));
  assert.ok(configSource.includes("'no-implicit-globals': 'error'"));
  assert.ok(qualityStart >= 0, 'В tests.yml отсутствует quality job');
  assert.ok(testStart > qualityStart, 'Не удалось выделить quality job');
  assert.ok(qualityJob.includes('run: npm ci'));
  assert.ok(qualityJob.includes('run: npm run lint'));
  assert.ok(qualityJob.includes('working-directory: dev'));
});

// Закрепляет noEmit-проверку выбранных JS-модулей и её обязательный запуск в той же CI-задаче.
test('TypeScript проверяет JSDoc-контракты без замены JavaScript', async function() {
  const [packageSource, typeConfigSource, workflowSource] = await Promise.all([
    readFile(path.join(repositoryRoot, 'dev', 'package.json'), 'utf8'),
    readFile(path.join(repositoryRoot, 'dev', 'tsconfig.checkjs.json'), 'utf8'),
    readFile(path.join(repositoryRoot, '.github', 'workflows', 'tests.yml'), 'utf8')
  ]);
  const packageData = JSON.parse(packageSource);
  const typeConfig = JSON.parse(typeConfigSource);
  const qualityStart = workflowSource.indexOf('  quality:');
  const testStart = workflowSource.indexOf('  test:', qualityStart);
  const qualityJob = workflowSource.slice(qualityStart, testStart);
  const checkedModules = [
    '../engine/autosave-payload.js',
    '../engine/game-protocol.js',
    '../engine/resource-path-policy.js'
  ];

  assert.equal(packageData.devDependencies.typescript, '7.0.2');
  assert.equal(packageData.scripts['test:typecheck'], 'tsc -p tsconfig.checkjs.json');
  assert.equal(typeConfig.compilerOptions.allowJs, true);
  assert.equal(typeConfig.compilerOptions.checkJs, true);
  assert.equal(typeConfig.compilerOptions.noEmit, true);
  assert.equal(typeConfig.compilerOptions.strict, true);
  assert.deepEqual(typeConfig.include, checkedModules);
  assert.ok(typeConfig.include.every(function(modulePath) {
    return modulePath.endsWith('.js');
  }), 'Проверка типов должна читать существующие JS-модули, а не собранные копии');
  assert.ok(qualityJob.includes('run: npm run test:typecheck'));
});
