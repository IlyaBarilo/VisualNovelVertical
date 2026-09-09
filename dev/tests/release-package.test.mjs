import assert from 'node:assert/strict';
import { access, readFile } from 'node:fs/promises';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

const repositoryRoot = path.dirname(fileURLToPath(new URL('../../index.html', import.meta.url)));

// Перечисляет пользовательские инструменты, которые должны быть доступны в полном и update-архивах.
const requiredAuthoringTools = [
  'tools/student-project-auditor.html',
  'tools/game-tester.html',
  'tools/media-focus-editor.html',
  'tools/convert-360-img-to-css.html',
  'tools/panorama-cleaner.html',
  'tools/scene360-editor.html'
];

// Перечисляет преподавательские документы, которые должны сохраняться в полном и update-архивах.
const requiredReviewDocuments = [
  'docs/student-project-review.md'
];

// Перечисляет руководства из README, которые должны оставаться доступными внутри полного и update-архивов.
const requiredReleaseGuides = [
  'docs/360-first-steps.md',
  'docs/user-script.md'
];

// Проверяет доставку примера и сохранение авторского расширения независимо от локальных исключений Git.
test('релиз включает пример user.js и не заменяет авторский файл', async function() {
  const candidateSource = await readRepositoryFile('.github/workflows/release-candidate.yml');
  await access(path.join(repositoryRoot, 'user-example.js'));
  assertRequiredReleaseCopy(candidateSource, 'user-example.js', '"build/$APP_NAME/"');
  assertRequiredReleaseCopy(candidateSource, 'user-example.js', '"build/$APP_NAME/docs/examples/"');
  assert.ok(candidateSource.includes('rm -f "${APP_NAME}-update/user.js"'));
  assert.ok(candidateSource.includes('rm -f "${APP_NAME}-update/user-example.js"'));
  assert.equal(candidateSource.includes('cp user.js '), false);
});

// Перечисляет документы безопасности, которые должны сопровождать runtime в обоих пользовательских архивах.
const requiredSecurityDocuments = [
  { path: 'SECURITY.md', destination: '"build/$APP_NAME/"' },
  { path: 'docs/security/threat-model.md', destination: '"build/$APP_NAME/docs/security/"' }
];

// Читает отслеживаемый файл относительно корня репозитория для проверки состава runtime и релиза.
function readRepositoryFile(relativePath) {
  return readFile(path.join(repositoryRoot, relativePath), 'utf8');
}

// Проверяет прямое копирование обязательного файла: условная команда не должна скрывать его отсутствие.
function assertRequiredReleaseCopy(candidateSource, relativePath, destination) {
  const command = 'cp ' + relativePath + (destination ? ' ' + destination : ' ');
  assert.ok(candidateSource.includes(command), 'В release-candidate.yml отсутствует копирование ' + relativePath);
  assert.equal(
    candidateSource.includes('[ -f ' + relativePath + ' ] && cp ' + relativePath),
    false,
    'release-candidate.yml молча пропускает обязательный файл ' + relativePath
  );
}

// Извлекает из массива ENGINE_SCRIPTS только обязательные записи, которые должны попасть в сборку.
function collectRequiredEngineScripts(indexSource) {
  const scriptsBlock = indexSource.match(/var\s+ENGINE_SCRIPTS\s*=\s*\[([\s\S]*?)\];/);
  assert.ok(scriptsBlock, 'В index.html не найден массив ENGINE_SCRIPTS.');

  const requiredScripts = [];
  const entryPattern = /\{\s*src:\s*"([^"]+)"([^}]*)\}/g;
  let match;

  while ((match = entryPattern.exec(scriptsBlock[1])) !== null) {
    if (!/optional\s*:\s*true/.test(match[2])) {
      requiredScripts.push(match[1]);
    }
  }

  return requiredScripts;
}

// Извлекает статические runtime-скрипты, которые index.html должен получить до запуска inline-bootstrap.
function collectRequiredStaticScripts(indexSource) {
  const requiredScripts = [];
  const scriptPattern = /<script\s+[^>]*src="([^"]+)"[^>]*><\/script>/g;
  let match;

  while ((match = scriptPattern.exec(indexSource)) !== null) {
    requiredScripts.push(match[1]);
  }

  return requiredScripts;
}

// Проверяет существование обязательных runtime-файлов без чтения story.js и каталогов с ассетами.
test('обязательные runtime-файлы из index.html существуют', async function() {
  const indexSource = await readRepositoryFile('index.html');
  const requiredPaths = [
    'index.html',
    'engine/engine.css',
    ...collectRequiredStaticScripts(indexSource),
    ...collectRequiredEngineScripts(indexSource)
  ];

  await Promise.all(requiredPaths.map(function(relativePath) {
    return access(path.join(repositoryRoot, relativePath));
  }));
});

// Проверяет, что workflow копирует каждый обязательный runtime-файл в релизный каталог.
test('релизная сборка включает обязательные runtime-файлы', async function() {
  const [indexSource, candidateSource] = await Promise.all([
    readRepositoryFile('index.html'),
    readRepositoryFile('.github/workflows/release-candidate.yml')
  ]);
  const requiredPaths = [
    'index.html',
    'engine/engine.css',
    ...collectRequiredStaticScripts(indexSource),
    ...collectRequiredEngineScripts(indexSource)
  ];

  requiredPaths.forEach(function(relativePath) {
    assertRequiredReleaseCopy(candidateSource, relativePath);
  });
});

// Проверяет, что релизный workflow не теряет локальные инструменты подготовки проекта.
test('релизная сборка включает пользовательские инструменты', async function() {
  const candidateSource = await readRepositoryFile('.github/workflows/release-candidate.yml');

  requiredAuthoringTools.forEach(function(relativePath) {
    assertRequiredReleaseCopy(candidateSource, relativePath);
  });
});

// Проверяет доставку инструкции преподавателя вместе с автономным аудитором.
test('релизная сборка включает документы проверки студенческих проектов', async function() {
  const candidateSource = await readRepositoryFile('.github/workflows/release-candidate.yml');

  requiredReviewDocuments.forEach(function(relativePath) {
    assertRequiredReleaseCopy(candidateSource, relativePath);
  });
});

// Проверяет, что ссылки README на подробные руководства не становятся битыми после распаковки релизного ZIP.
test('релизная сборка включает руководства, на которые ссылается README', async function() {
  const [candidateSource, readmeSource] = await Promise.all([
    readRepositoryFile('.github/workflows/release-candidate.yml'),
    readRepositoryFile('README.md')
  ]);

  for (const relativePath of requiredReleaseGuides) {
    await access(path.join(repositoryRoot, relativePath));
    assert.ok(readmeSource.includes('(' + relativePath + ')'), 'README.md не ссылается на ' + relativePath);
    assertRequiredReleaseCopy(candidateSource, relativePath, '"build/$APP_NAME/docs/"');
  }
});

// Не позволяет README ссылаться на политику или модель угроз, отсутствующую в автономном релизном ZIP.
test('релизная сборка включает документы безопасности', async function() {
  const [candidateSource, readmeSource, englishReadmeSource] = await Promise.all([
    readRepositoryFile('.github/workflows/release-candidate.yml'),
    readRepositoryFile('README.md'),
    readRepositoryFile('README-EN.md')
  ]);

  for (const document of requiredSecurityDocuments) {
    await access(path.join(repositoryRoot, document.path));
    assert.ok(readmeSource.includes('(' + document.path + ')'), 'README.md не ссылается на ' + document.path);
    assert.ok(englishReadmeSource.includes('(' + document.path + ')'), 'README-EN.md не ссылается на ' + document.path);
    assertRequiredReleaseCopy(candidateSource, document.path, document.destination);
  }
});

// Закрепляет полный кандидат в обычном CI и оставляет дорогой Windows smoke только релизуемым push в main.
test('обычный CI переиспользует релизную сборку для каждого изменения', async function() {
  const [testsSource, candidateSource] = await Promise.all([
    readRepositoryFile('.github/workflows/tests.yml'),
    readRepositoryFile('.github/workflows/release-candidate.yml')
  ]);

  assert.match(candidateSource, /  workflow_call:\r?\n    inputs:/);
  assert.match(candidateSource, /      run_node_tests:\r?\n[\s\S]*?type: boolean/);
  assert.match(candidateSource, /      run_windows_smoke:\r?\n[\s\S]*?type: boolean/);
  assert.match(candidateSource, /    outputs:\r?\n      version:/);
  assert.ok(testsSource.includes('uses: ./.github/workflows/release-candidate.yml'));
  assert.ok(testsSource.includes('tag: ci-${{ github.sha }}'));
  assert.ok(testsSource.includes('deploy_pages: false'));
  assert.ok(testsSource.includes('run_node_tests: false'));
  assert.ok(testsSource.includes("run_windows_smoke: ${{ github.event_name == 'push' && github.ref == 'refs/heads/main' }}"));
  assert.ok(testsSource.includes("github.ref == 'refs/heads/main' && github.sha || github.ref"));
  assert.ok(candidateSource.includes('if: inputs.run_node_tests == true'));
  assert.ok(candidateSource.includes('if: inputs.run_windows_smoke == true'));
});

// Проверяет границу reusable workflow: read-only кандидат не должен содержать job с правами публикации.
test('CI вызывает read-only кандидата, а write-права остаются в релизном workflow', async function() {
  const [testsSource, candidateSource, releaseSource] = await Promise.all([
    readRepositoryFile('.github/workflows/tests.yml'),
    readRepositoryFile('.github/workflows/release-candidate.yml'),
    readRepositoryFile('.github/workflows/release.yml')
  ]);
  const testsCandidateStart = testsSource.indexOf('  release-candidate:');
  const testsCandidateSection = testsSource.slice(testsCandidateStart);
  const releaseCandidateStart = releaseSource.indexOf('  candidate:');
  const publishStart = releaseSource.indexOf('  publish:');
  const releaseCandidateSection = releaseSource.slice(releaseCandidateStart, publishStart);
  const publishSection = releaseSource.slice(publishStart);

  assert.ok(candidateSource.includes('group: release-candidate-${{ inputs.tag }}'));
  assert.ok(candidateSource.includes('cancel-in-progress: false'));
  assert.match(candidateSource, /permissions:\r?\n  contents: read/);
  assert.equal(candidateSource.includes('contents: write'), false);
  assert.equal(candidateSource.includes('pages: write'), false);
  assert.equal(candidateSource.includes('id-token: write'), false);
  assert.equal(candidateSource.includes('  publish:'), false);
  assert.ok(testsCandidateStart >= 0);
  assert.ok(testsCandidateSection.includes('uses: ./.github/workflows/release-candidate.yml'));
  assert.match(testsCandidateSection, /permissions:\r?\n      contents: read/);
  assert.equal(testsCandidateSection.includes('contents: write'), false);
  assert.equal(testsSource.includes('uses: ./.github/workflows/release.yml'), false);
  assert.ok(releaseCandidateStart >= 0 && publishStart > releaseCandidateStart);
  assert.ok(releaseCandidateSection.includes('uses: ./.github/workflows/release-candidate.yml'));
  assert.ok(releaseCandidateSection.includes('contents: read'));
  assert.equal(releaseCandidateSection.includes('contents: write'), false);
  assert.ok(releaseSource.includes('group: release-${{ github.event.release.tag_name || inputs.tag || github.ref }}'));
  assert.ok(releaseSource.includes('cancel-in-progress: false'));
  assert.match(releaseSource, /permissions:\r?\n  contents: read/);
  assert.equal(releaseSource.includes('workflow_call:'), false);
  assert.ok(publishSection.includes('contents: write'));
  assert.ok(publishSection.includes('pages: write'));
  assert.ok(publishSection.includes('id-token: write'));
  assert.ok(publishSection.includes('group: release-publish'));
  assert.ok(publishSection.includes('needs: candidate'));
  assert.ok(publishSection.includes('VERSION: ${{ needs.candidate.outputs.version }}'));
});

// Закрепляет единый helper, который сохраняет вложенные пути вместо плоского копирования файлов через shell.
test('релизная сборка сохраняет структуру каталогов ассетов', async function() {
  const candidateSource = await readRepositoryFile('.github/workflows/release-candidate.yml');

  assert.ok(candidateSource.includes('node dev/scripts/copy-release-assets.mjs'));
  assert.ok(candidateSource.includes('--source assets'));
  assert.ok(candidateSource.includes('--destination "build/$APP_NAME/assets"'));
  [
    'find assets/backgrounds',
    'find assets/characters',
    'find assets/audio',
    'find assets/games',
    'find assets/video',
    'cp -a assets/360'
  ].forEach(function(flatCopyCommand) {
    assert.equal(
      candidateSource.includes(flatCopyCommand),
      false,
      `В release-candidate.yml осталось прямое копирование без helper: ${flatCopyCommand}`
    );
  });
});

// Защищает ручную проверку сборки от случайной публикации релиза или обновления GitHub Pages.
test('ручная релизная сборка безопасна по умолчанию', async function() {
  const releaseSource = await readRepositoryFile('.github/workflows/release.yml');

  assert.match(
    releaseSource,
    /      upload_to_release:\r?\n        description:[^\r\n]+\r?\n        required: true\r?\n        default: false\r?\n        type: boolean/
  );
  assert.match(
    releaseSource,
    /      deploy_pages:\r?\n        description:[^\r\n]+\r?\n        required: true\r?\n        default: false\r?\n        type: boolean/
  );
});

// Проверяет, что пользовательский artifact появляется только после Windows smoke, а внутренняя копия живёт один день.
test('релизная сборка выдаёт проверенный artifact с ZIP и SHA-256', async function() {
  const candidateSource = await readRepositoryFile('.github/workflows/release-candidate.yml');

  assert.ok(candidateSource.includes('uses: actions/upload-artifact@v7'));
  assert.ok(candidateSource.includes('name: release-candidate-${{ github.run_id }}'));
  assert.ok(candidateSource.includes('retention-days: 1'));
  assert.ok(candidateSource.includes('name: release-zips-${{ github.run_id }}'));
  assert.ok(candidateSource.includes('${{ github.event.repository.name }}-${{ steps.version.outputs.version }}.zip'));
  assert.ok(candidateSource.includes('${{ github.event.repository.name }}-${{ steps.version.outputs.version }}.zip.sha256'));
  assert.ok(candidateSource.includes('${{ github.event.repository.name }}-${{ steps.version.outputs.version }}-update.zip'));
  assert.ok(candidateSource.includes('${{ github.event.repository.name }}-${{ steps.version.outputs.version }}-update.zip.sha256'));
  assert.ok(candidateSource.includes('if-no-files-found: error'));
  assert.ok(candidateSource.includes('retention-days: 7'));
});

// Закрепляет создание, повторную проверку и публикацию SHA-256 для всех имён релизных архивов.
test('релизный workflow создаёт и проверяет SHA-256 архивов', async function() {
  const [candidateSource, packageSource] = await Promise.all([
    readRepositoryFile('.github/workflows/release-candidate.yml'),
    readRepositoryFile('dev/package.json')
  ]);
  const packageData = JSON.parse(packageSource);
  const createPosition = candidateSource.indexOf('node dev/scripts/release-checksums.mjs create');
  const verifyPosition = candidateSource.indexOf('node dev/scripts/release-checksums.mjs verify');
  const uploadPosition = candidateSource.indexOf('- name: Upload ZIP artifacts');

  assert.ok(packageData.scripts['test:release'].includes('tests/release-checksums.test.mjs'));
  await Promise.all([
    access(path.join(repositoryRoot, 'dev/scripts/release-checksums.mjs')),
    access(path.join(repositoryRoot, 'dev/tests/release-checksums.test.mjs'))
  ]);
  assert.ok(createPosition >= 0 && verifyPosition > createPosition);
  assert.ok(uploadPosition > verifyPosition);
  assert.ok(candidateSource.includes('${APP_NAME}-latest.zip.sha256'));
  assert.ok(candidateSource.includes('${APP_NAME}-latest-update.zip.sha256'));
  assert.ok(candidateSource.includes('${{ github.event.repository.name }}-latest.zip.sha256'));
  assert.ok(candidateSource.includes('${{ github.event.repository.name }}-latest-update.zip.sha256'));
});

// Закрепляет создание манифеста после подстановки версии и до упаковки одинакового runtime в ZIP и Pages.
test('релизная сборка создаёт и проверяет release-manifest', async function() {
  const [candidateSource, packageSource] = await Promise.all([
    readRepositoryFile('.github/workflows/release-candidate.yml'),
    readRepositoryFile('dev/package.json')
  ]);
  const packageData = JSON.parse(packageSource);
  const versionPosition = candidateSource.indexOf('- name: Inject version into engine/engine.js');
  const manifestPosition = candidateSource.indexOf('- name: Create and verify release manifest');
  const archivePosition = candidateSource.indexOf('- name: Create ZIP archives');

  assert.ok(packageData.scripts['test:release'].includes('tests/release-manifest.test.mjs'));
  await Promise.all([
    access(path.join(repositoryRoot, 'dev/scripts/release-manifest.mjs')),
    access(path.join(repositoryRoot, 'dev/tests/release-manifest.test.mjs'))
  ]);
  assert.ok(versionPosition >= 0 && manifestPosition > versionPosition);
  assert.ok(archivePosition > manifestPosition);
  assert.ok(candidateSource.includes('release-manifest.mjs create --root "build/$APP_NAME"'));
  assert.ok(candidateSource.includes('--commit "${{ github.sha }}"'));
  assert.ok(candidateSource.includes('--node-tests "${{ inputs.run_node_tests }}"'));
  assert.ok(candidateSource.includes('--windows-smoke "${{ inputs.run_windows_smoke }}"'));
  assert.ok(candidateSource.includes('cp "build/$APP_NAME/release-manifest.json" "build/site/release-manifest.json"'));
  assert.ok(candidateSource.includes('release-manifest.mjs verify --root "build/$APP_NAME"'));
  assert.ok(candidateSource.includes('release-manifest.mjs verify --root "build/site"'));
  assert.ok(candidateSource.includes('grep -Fxq "${APP_NAME}/release-manifest.json"'));
  assert.ok(candidateSource.includes('grep -Fxq "${APP_NAME}-update/release-manifest.json"'));
});

// Проверяет наличие проверки целостности и ключевых различий полного и update-архивов.
test('релизный workflow проверяет фактический состав ZIP', async function() {
  const candidateSource = await readRepositoryFile('.github/workflows/release-candidate.yml');

  assert.ok(candidateSource.includes('unzip -tq "${APP_NAME}-${VERSION}.zip"'));
  assert.ok(candidateSource.includes('unzip -tq "${APP_NAME}-${VERSION}-update.zip"'));
  assert.ok(candidateSource.includes('grep -Fxq "${APP_NAME}/engine/autosave-controller.js" build/full-zip-contents.txt'));
  assert.ok(candidateSource.includes('grep -Fxq "${APP_NAME}-update/engine/autosave-controller.js" build/update-zip-contents.txt'));
  assert.ok(candidateSource.includes('grep -Fxq "${APP_NAME}/engine/autosave-payload.js" build/full-zip-contents.txt'));
  assert.ok(candidateSource.includes('grep -Fxq "${APP_NAME}-update/engine/autosave-payload.js" build/update-zip-contents.txt'));
  assert.ok(candidateSource.includes('grep -Fxq "${APP_NAME}/engine/autosave-storage.js" build/full-zip-contents.txt'));
  assert.ok(candidateSource.includes('grep -Fxq "${APP_NAME}-update/engine/autosave-storage.js" build/update-zip-contents.txt'));
  assert.ok(candidateSource.includes('grep -Fxq "${APP_NAME}/engine/audio-controller.js" build/full-zip-contents.txt'));
  assert.ok(candidateSource.includes('grep -Fxq "${APP_NAME}-update/engine/audio-controller.js" build/update-zip-contents.txt'));
  assert.ok(candidateSource.includes('grep -Fxq "${APP_NAME}/engine/background-media-controller.js" build/full-zip-contents.txt'));
  assert.ok(candidateSource.includes('grep -Fxq "${APP_NAME}-update/engine/background-media-controller.js" build/update-zip-contents.txt'));
  assert.ok(candidateSource.includes('grep -Fxq "${APP_NAME}/engine/character-controller.js" build/full-zip-contents.txt'));
  assert.ok(candidateSource.includes('grep -Fxq "${APP_NAME}-update/engine/character-controller.js" build/update-zip-contents.txt'));
  assert.ok(candidateSource.includes('grep -Fxq "${APP_NAME}/engine/panorama-package-controller.js" build/full-zip-contents.txt'));
  assert.ok(candidateSource.includes('grep -Fxq "${APP_NAME}-update/engine/panorama-package-controller.js" build/update-zip-contents.txt'));
  assert.ok(candidateSource.includes('grep -Fxq "${APP_NAME}/engine/panorama-photo-viewer-controller.js" build/full-zip-contents.txt'));
  assert.ok(candidateSource.includes('grep -Fxq "${APP_NAME}-update/engine/panorama-photo-viewer-controller.js" build/update-zip-contents.txt'));
  assert.ok(candidateSource.includes('grep -Fxq "${APP_NAME}/engine/panorama-marks-controller.js" build/full-zip-contents.txt'));
  assert.ok(candidateSource.includes('grep -Fxq "${APP_NAME}-update/engine/panorama-marks-controller.js" build/update-zip-contents.txt'));
  assert.ok(candidateSource.includes('grep -Fxq "${APP_NAME}/engine/expression.js" build/full-zip-contents.txt'));
  assert.ok(candidateSource.includes('grep -Fxq "${APP_NAME}-update/engine/expression.js" build/update-zip-contents.txt'));
  assert.ok(candidateSource.includes('grep -Fxq "${APP_NAME}/engine/game-host.js" build/full-zip-contents.txt'));
  assert.ok(candidateSource.includes('grep -Fxq "${APP_NAME}-update/engine/game-host.js" build/update-zip-contents.txt'));
  assert.ok(candidateSource.includes('grep -Fxq "${APP_NAME}/engine/story-analysis.js" build/full-zip-contents.txt'));
  assert.ok(candidateSource.includes('grep -Fxq "${APP_NAME}-update/engine/story-analysis.js" build/update-zip-contents.txt'));
  assert.ok(candidateSource.includes('grep -Fxq "${APP_NAME}/engine/story-graph.js" build/full-zip-contents.txt'));
  assert.ok(candidateSource.includes('grep -Fxq "${APP_NAME}-update/engine/story-graph.js" build/update-zip-contents.txt'));
  assert.ok(candidateSource.includes('grep -Fxq "${APP_NAME}/engine/story-video-controller.js" build/full-zip-contents.txt'));
  assert.ok(candidateSource.includes('grep -Fxq "${APP_NAME}-update/engine/story-video-controller.js" build/update-zip-contents.txt'));
  assert.ok(candidateSource.includes('grep -Fxq "${APP_NAME}/engine/story-sandbox-loader.js" build/full-zip-contents.txt'));
  assert.ok(candidateSource.includes('grep -Fxq "${APP_NAME}-update/engine/story-sandbox-loader.js" build/update-zip-contents.txt'));
  assert.ok(candidateSource.includes('grep -Fxq "${APP_NAME}/engine/visual-transition-controller.js" build/full-zip-contents.txt'));
  assert.ok(candidateSource.includes('grep -Fxq "${APP_NAME}-update/engine/visual-transition-controller.js" build/update-zip-contents.txt'));
  assert.ok(candidateSource.includes('${APP_NAME}/SECURITY.md'));
  assert.ok(candidateSource.includes('${APP_NAME}-update/SECURITY.md'));
  assert.ok(candidateSource.includes('${APP_NAME}/docs/security/threat-model.md'));
  assert.ok(candidateSource.includes('${APP_NAME}-update/docs/security/threat-model.md'));
  assert.ok(candidateSource.includes('${APP_NAME}/tools/panorama-cleaner.html'));
  assert.ok(candidateSource.includes('${APP_NAME}-update/tools/panorama-cleaner.html'));
  assert.ok(candidateSource.includes('${APP_NAME}/tools/student-project-auditor.html'));
  assert.ok(candidateSource.includes('${APP_NAME}-update/tools/student-project-auditor.html'));
  assert.ok(candidateSource.includes('${APP_NAME}/docs/student-project-review.md'));
  assert.ok(candidateSource.includes('${APP_NAME}-update/docs/student-project-review.md'));
  assert.ok(candidateSource.includes('${APP_NAME}/docs/360-first-steps.md'));
  assert.ok(candidateSource.includes('${APP_NAME}-update/docs/360-first-steps.md'));
  assert.ok(candidateSource.includes('Полный архив содержит запрещённый панорамный JS-пакет.'));
  assert.ok(candidateSource.includes('${APP_NAME}/(dev/|tests/'));
  assert.ok(candidateSource.includes('${APP_NAME}-update/(assets/|story\\\\.js$|story-example\\\\.js$|dev/'));
  // Сохраняем прежние исключения и проверяем новые авторские файлы; список больше не заканчивается на TESTING.md.
  assert.ok(candidateSource.includes('node_modules/|playwright-report/|test-results/|package(-lock)?\\\\.json$|playwright\\\\.config\\\\.mjs$|docs/TESTING\\\\.md$|user\\\\.js$'));
  assert.ok(candidateSource.includes('user\\\\.js$|user-example\\\\.js$)'));
});

// Закрепляет Windows smoke настоящего Edge и Firefox после упаковки полного ZIP и до выдачи artifact пользователю.
test('релизный workflow запускает распакованный ZIP в Edge и Firefox через HTTP и file://', async function() {
  const [candidateSource, releaseSource, packageSource, smokeSource] = await Promise.all([
    readRepositoryFile('.github/workflows/release-candidate.yml'),
    readRepositoryFile('.github/workflows/release.yml'),
    readRepositoryFile('dev/package.json'),
    readRepositoryFile('dev/tests/release-smoke.mjs')
  ]);
  const packageData = JSON.parse(packageSource);
  const createArchivePosition = candidateSource.indexOf('- name: Create ZIP archives');
  const edgeSmokePosition = candidateSource.indexOf('- name: Run unpacked release smoke in Microsoft Edge');
  const firefoxSmokePosition = candidateSource.indexOf('- name: Run unpacked release smoke in Firefox');
  const uploadPosition = candidateSource.indexOf('- name: Upload ZIP artifacts');
  const publishPosition = releaseSource.indexOf('- name: Upload to release');

  assert.equal(packageData.scripts['test:release:smoke'], 'node tests/release-smoke.mjs');
  await access(path.join(repositoryRoot, 'dev/tests/release-smoke.mjs'));
  assert.ok(candidateSource.includes('run: npm ci'));
  assert.ok(candidateSource.includes('runs-on: windows-latest'));
  assert.ok(candidateSource.includes('run: npx playwright install firefox'));
  assert.ok(candidateSource.includes('--browser=msedge'));
  assert.ok(candidateSource.includes('--browser=firefox'));
  assert.ok(candidateSource.includes('needs: build'));
  assert.ok(candidateSource.includes('dev/.playwright/release-smoke/'));
  assert.ok(releaseSource.includes('needs: candidate'));
  assert.ok(smokeSource.includes('pathToFileURL'));
  assert.ok(smokeSource.includes("new Set(['chromium', 'firefox', 'msedge'])"));
  assert.ok(smokeSource.includes("channel: 'msedge'"));
  assert.ok(smokeSource.includes("'webgl.disabled': false"));
  assert.ok(smokeSource.includes("'webgl.force-enabled': true"));
  assert.ok(smokeSource.includes("'webgl.forbid-software': false"));
  assert.ok(smokeSource.includes('readWebGlDiagnostics'));
  assert.ok(smokeSource.includes('webGlDiagnostics.available'));
  assert.ok(smokeSource.includes('runFileBrowserSmoke'));
  assert.ok(smokeSource.includes('fileSmokePanoramaRelativePath'));
  assert.ok(smokeSource.includes("path.join(releaseRoot, 'tools', 'scene360-editor.html')"));
  assert.ok(smokeSource.includes("await page.reload({ waitUntil: 'domcontentloaded' })"));
  assert.ok(createArchivePosition >= 0 && edgeSmokePosition > createArchivePosition);
  assert.ok(firefoxSmokePosition > edgeSmokePosition);
  assert.ok(uploadPosition > firefoxSmokePosition);
  assert.ok(publishPosition >= 0);
});

// Защищает пользовательский ZIP от каталога разработки, браузеров, отчётов и конфигурации.
test('релизная сборка не копирует каталог dev', async function() {
  const candidateSource = await readRepositoryFile('.github/workflows/release-candidate.yml');

  assert.equal(candidateSource.includes('[ -d dev ]'), false);
  assert.equal(candidateSource.includes('cp -r dev'), false);
  assert.equal(candidateSource.includes('cp -a dev'), false);
  assert.equal(candidateSource.includes('[ -d tests ]'), false);
  assert.equal(candidateSource.includes('cp -r tests'), false);
  assert.equal(candidateSource.includes('cp -a tests'), false);
  assert.equal(candidateSource.includes('cp package.json'), false);
  assert.equal(candidateSource.includes('cp package-lock.json'), false);
  assert.equal(candidateSource.includes('cp playwright.config.mjs'), false);
  assert.equal(candidateSource.includes('cp -r node_modules'), false);
  assert.equal(candidateSource.includes('cp -r playwright-report'), false);
  assert.equal(candidateSource.includes('cp -r test-results'), false);
  assert.equal(candidateSource.includes('cp docs/TESTING.md'), false);
});
