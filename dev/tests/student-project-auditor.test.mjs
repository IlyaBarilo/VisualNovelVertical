import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import { loadStudentAuditorCore } from './helpers/load-student-auditor-core.mjs';

const repositoryRoot = path.dirname(fileURLToPath(new URL('../../index.html', import.meta.url)));

// Читает файл репозитория в UTF-8 для проверки реального демонстрационного комплекта.
function readRepositoryFile(relativePath) {
  return readFile(path.join(repositoryRoot, relativePath), 'utf8');
}

// Подтверждает автономность инструмента и наличие обоих способов явного выбора каталога.
test('HTML-аудитор остаётся одним автономным файлом с выбором и переносом каталога', async function() {
  const { html } = await loadStudentAuditorCore();

  assert.match(html, /Content-Security-Policy/);
  assert.match(html, /connect-src 'none'/);
  assert.match(html, /type="file" webkitdirectory multiple/);
  assert.match(html, /addEventListener\('drop', handleDrop\)/);
  assert.match(html, /student-game-audit\.txt/);
  assert.doesNotMatch(html, /<script\s+[^>]*src=/i);
  assert.doesNotMatch(html, /<link\s+[^>]*rel=["']stylesheet/i);
});

// Закрепляет безусловный запрет старых JS-пакетов панорам при сохранении корневого story360.js.
test('аудитор отличает story360.js от запрещённых панорамных JS-пакетов', async function() {
  const { core } = await loadStudentAuditorCore();

  assert.equal(core.isPanoramaJavaScript('story360.js'), false);
  assert.equal(core.isPanoramaJavaScript('assets/360/hall-360.js'), true);
  assert.equal(core.isPanoramaJavaScript('assets/360/hall-360-mobile.js'), true);
  assert.equal(core.isPanoramaJavaScript('assets/360/hall-360-tablet.js'), true);
  assert.equal(core.isPanoramaJavaScript('assets/360/hall-360.css'), false);
});

// Требует литеральную версию корневого формата STORY360 и отклоняет неизвестную схему до публикации.
test('аудитор проверяет версию STORY360', async function() {
  const { core } = await loadStudentAuditorCore();
  const validIssues = Array.from(core.inspectStory360Source('window.STORY360 = { spaces: {}, version: 1 };'));
  const missingIssues = Array.from(core.inspectStory360Source('window.STORY360 = { spaces: {} };'));
  const futureIssues = Array.from(core.inspectStory360Source('window.STORY360 = { version: 2, spaces: {} };'));

  assert.equal(validIssues.some(function(issue) { return issue.code.startsWith('STORY360_VERSION_'); }), false);
  assert.ok(missingIssues.some(function(issue) { return issue.code === 'STORY360_VERSION_MISSING'; }));
  assert.ok(futureIssues.some(function(issue) { return issue.code === 'STORY360_VERSION_UNSUPPORTED'; }));
});

// Проверяет пассивное извлечение DSL и отказ от интерполяции или дополнительного JavaScript.
test('аудитор принимает только декларативную обёртку story.js', async function() {
  const { core } = await loadStudentAuditorCore();
  const safe = core.inspectStorySource('window.STORY_TEXT = `\n[scene]\nscene intro\n"Текст"\n`;');
  const interpolation = core.inspectStorySource('window.STORY_TEXT = `Значение: ${dangerous()}`;');
  const extraCode = core.inspectStorySource('window.STORY_TEXT = `Текст`;\nfetch("https://example.invalid");');

  assert.equal(Array.from(safe.issues).length, 0);
  assert.match(safe.storyText, /scene intro/);
  assert.ok(Array.from(interpolation.issues).some(function(issue) {
    return issue.code === 'STORY_INTERPOLATION';
  }));
  assert.ok(Array.from(extraCode.issues).some(function(issue) {
    return issue.code === 'STORY_EXTRA_CODE';
  }));
});

// Проверяет извлечение реестра игр и обязательный локальный HTML-путь.
test('аудитор извлекает только допустимые пути мини-игр из story.js', async function() {
  const { core } = await loadStudentAuditorCore();
  const result = core.collectRegisteredGames([
    '[game]',
    'first file=assets/games/first.html',
    'second file="assets/games/second.html"',
    'remote file=https://example.invalid/game.html',
    'script file=assets/games/game.js',
    '',
    '[scene]',
    'scene intro'
  ].join('\n'));
  const gamePaths = Array.from(result.games, function(game) { return game.path; });
  const issueCodes = Array.from(result.issues, function(issue) { return issue.code; });

  assert.deepEqual(gamePaths, ['assets/games/first.html', 'assets/games/second.html']);
  assert.ok(issueCodes.includes('GAME_PATH_UNSAFE'));
  assert.ok(issueCodes.includes('GAME_EXTENSION'));
});

// Проверяет единые ограничения assets для основных и резервных ресурсов сценария.
test('аудитор отклоняет неоднозначные и выходящие из assets пути сценария', async function() {
  const { core } = await loadStudentAuditorCore();
  const safeIssues = Array.from(core.inspectStoryResourcePaths([
    '[bg]',
    'hall file=assets/custom/hall.jpg fallbackimage=assets/preview/hall.svg'
  ].join('\n')));
  const unsafeIssues = Array.from(core.inspectStoryResourcePaths([
    '[bg]',
    'remote file=https://example.invalid/hall.jpg',
    'traversal file=assets/../hall.jpg',
    'slashes file=assets\\backgrounds\\hall.jpg',
    '[video]',
    'clip file=assets/video/clip.mp4 poster=../poster.jpg'
  ].join('\n')));

  assert.equal(safeIssues.length, 0);
  assert.equal(unsafeIssues.filter(function(issue) { return issue.code === 'RESOURCE_PATH_UNSAFE'; }).length, 4);
});

// Проверяет активное содержимое SVG и сохраняет поддержку безопасной векторной картинки.
test('аудитор разрешает пассивный SVG и блокирует активные конструкции', async function() {
  const { core } = await loadStudentAuditorCore();
  const safeSvg = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 10 10"><path id="p" d="M0 0L10 10"/><use href="#p"/></svg>';
  const unsafeSvg = '<svg xmlns="http://www.w3.org/2000/svg" onload="fetch(\'https://example.invalid\')"><script>alert(1)</script><image href="https://example.invalid/a.png"/></svg>';

  assert.deepEqual(Array.from(core.inspectSvgSource('assets/img/safe.svg', safeSvg)), []);
  const issueCodes = Array.from(core.inspectSvgSource('assets/img/unsafe.svg', unsafeSvg), function(issue) { return issue.code; });
  assert.ok(issueCodes.includes('SVG_ACTIVE_ELEMENT'));
  assert.ok(issueCodes.includes('SVG_EVENT_HANDLER'));
  assert.ok(issueCodes.includes('SVG_EXTERNAL_REFERENCE'));
});

// Проверяет обязательность и строгость CSP до первого исполняемого содержимого мини-игры.
test('аудитор требует строгий CSP внутри мини-игры', async function() {
  const { core } = await loadStudentAuditorCore();
  const strictCsp = "default-src 'none'; script-src 'unsafe-inline'; style-src 'unsafe-inline'; img-src data: blob:; media-src data: blob:; font-src data:; connect-src 'none'; frame-src 'none'; object-src 'none'; worker-src 'none'; manifest-src 'none'; base-uri 'none'; form-action 'none'";
  const safeGame = '<!doctype html><head><meta http-equiv="Content-Security-Policy" content="' + strictCsp + '"><meta name="vn-game-protocol" content="2"><style>body{margin:0}</style></head><script>const gameInit="gameInit", gameResult="gameResult", protocolVersion=2, gameId="gameId", sessionId="sessionId"; parent.postMessage({gameResult,protocolVersion,gameId,sessionId},"*");</script>';
  const missingGame = '<!doctype html><script>const gameInit="gameInit";</script>';
  const weakGame = '<!doctype html><head><meta http-equiv="Content-Security-Policy" content="default-src *"></head><script>const gameInit="gameInit";</script>';

  assert.equal(Array.from(core.inspectMiniGameSource('assets/games/safe.html', safeGame)).some(function(issue) { return issue.level === 'error'; }), false);
  assert.ok(Array.from(core.inspectMiniGameSource('assets/games/missing.html', missingGame)).some(function(issue) { return issue.code === 'GAME_CSP_MISSING'; }));
  assert.ok(Array.from(core.inspectMiniGameSource('assets/games/weak.html', weakGame)).some(function(issue) { return issue.code === 'GAME_CSP_WEAK'; }));
});

// Проверяет обязательный HTML-маркер: версия берётся из самой игры, а не из story.js.
test('аудитор проверяет версию протокола внутри мини-игры', async function() {
  const { core } = await loadStudentAuditorCore();
  const missing = Array.from(core.inspectMiniGameProtocolVersion('assets/games/missing.html', '<html><head></head></html>'));
  const supported = Array.from(core.inspectMiniGameProtocolVersion('assets/games/supported.html', '<html><head><meta name="vn-game-protocol" content="2"></head></html>'));
  const unsupported = Array.from(core.inspectMiniGameProtocolVersion('assets/games/future.html', '<html><head><meta name="vn-game-protocol" content="3"></head></html>'));

  assert.ok(missing.some(function(issue) { return issue.code === 'GAME_PROTOCOL_VERSION_MISSING'; }));
  assert.deepEqual(supported, []);
  assert.ok(unsupported.some(function(issue) { return issue.code === 'GAME_PROTOCOL_VERSION_UNSUPPORTED'; }));
});

// Фиксирует основные сетевые и исполняемые конструкции, запрещённые для HTML-мини-игры.
test('аудитор обнаруживает внешние зависимости и сетевые API мини-игры', async function() {
  const { core } = await loadStudentAuditorCore();
  const source = [
    '<!doctype html>',
    '<link rel="stylesheet" href="https://cdn.example.invalid/game.css">',
    '<script src="extra.js"></script>',
    '<script>',
    'fetch("https://api.example.invalid/result");',
    'window.open("https://example.invalid");',
    '</script>'
  ].join('\n');
  const issueCodes = Array.from(core.inspectMiniGameSource('assets/games/unsafe.html', source), function(issue) {
    return issue.code;
  });

  assert.ok(issueCodes.includes('GAME_SCRIPT_SRC'));
  assert.ok(issueCodes.includes('GAME_EXTERNAL_STYLE'));
  assert.ok(issueCodes.includes('GAME_NETWORK'));
  assert.ok(issueCodes.includes('GAME_OPEN'));
  assert.ok(issueCodes.includes('GAME_EXTERNAL_URL'));
  assert.ok(Array.from(core.inspectMiniGameSource('assets/games/empty.html', '')).some(function(issue) {
    return issue.code === 'GAME_EMPTY' && issue.level === 'incomplete';
  }));
});

// Проверяет, что серверно-опасные и неизвестные файлы блокируются единым allowlist независимо от denylist расширений.
test('аудитор разрешает только известный состав проекта и безопасные авторские ресурсы', async function() {
  const { core } = await loadStudentAuditorCore();
  const registeredGames = ['assets/games/registered.html'];
  const allowedPaths = [
    'index.html',
    'story.js',
    'story360.js',
    'engine/engine.js',
    'engine/engine.css',
    'engine/panorama-photo-viewer-controller.js',
    'engine/panorama-marks-controller.js',
    'tools/convert-360-img-to-js.html',
    'docs/examples/story-example.js',
    'user-example.js',
    'docs/examples/user-example.js',
    'docs/custom/teacher-guide.md',
    'docs/custom/preview.webp',
    'assets/custom/image.jpg',
    'assets/custom/vector.svg',
    'assets/custom/audio.ogg',
    'assets/custom/video.webm',
    'assets/custom/hall-360.css',
    'assets/games/registered.html'
  ];
  const blockedPaths = [
    '.htaccess',
    '.user.ini',
    '.env',
    'web.config',
    'package.json',
    'composer.json',
    'Dockerfile',
    'README.MD',
    'Engine/engine.js',
    'Tools/game-tester.html',
    'server.php',
    'handler.cgi',
    'script.pl',
    'assets/upload.php',
    'assets/images/shell.php.jpg',
    'assets/data/package.json',
    'assets/games/unregistered.html',
    'docs/server.php',
    'tools/student-helper.html'
  ];

  for (const filePath of allowedPaths) {
    assert.equal(core.getProjectFileAllowReason(filePath, registeredGames), '', filePath + ' должен входить в allowlist.');
  }
  for (const filePath of blockedPaths) {
    assert.notEqual(core.getProjectFileAllowReason(filePath, registeredGames), '', filePath + ' должен быть отклонён allowlist.');
  }

  const records = allowedPaths.concat(blockedPaths).map(function(filePath) {
    return { path: filePath, size: 1 };
  });
  const inventoryIssues = Array.from(core.inspectInventory(records, registeredGames));
  for (const filePath of allowedPaths) {
    assert.equal(inventoryIssues.some(function(issue) {
      return issue.code === 'FILE_NOT_ALLOWED' && issue.path === filePath;
    }), false, filePath + ' не должен получать ошибку allowlist.');
  }
  for (const filePath of blockedPaths) {
    assert.ok(inventoryIssues.some(function(issue) {
      return issue.code === 'FILE_NOT_ALLOWED' && issue.path === filePath;
    }), filePath + ' должен получать ошибку allowlist в полном аудите.');
  }
});

// Известный user.js не получает автоматический допуск: произвольное расширение проверяется вручную.
test('аудитор требует ручной проверки user.js, но принимает штатные примеры', async function() {
  const { core } = await loadStudentAuditorCore();
  const files = ['user.js', 'user-example.js', 'docs/examples/user-example.js'];
  const issues = Array.from(core.inspectInventory(files.map(function toRecord(filePath) {
    return { path: filePath, size: 1 };
  }), []));
  assert.equal(core.getProjectFileAllowReason('user.js', []), '');
  assert.notEqual(core.getProjectFileAllowReason('assets/user.js', []), '');
  const userIssues = issues.filter(function selectUserIssue(issue) { return files.includes(issue.path); });
  assert.equal(userIssues.length, 1);
  assert.equal(userIssues[0].path, 'user.js');
  assert.equal(userIssues[0].code, 'USER_EXTENSION_REVIEW');
  assert.equal(userIssues[0].level, 'incomplete');
});

// Проверяет дополнительные JS, старые панорамные пакеты и незарегистрированный HTML по дереву проекта.
test('аудитор обнаруживает опасные файлы в полном перечне проекта', async function() {
  const { core } = await loadStudentAuditorCore();
  const requiredPaths = [
    'index.html',
    'engine/engine.css',
    'engine/engine.js',
    'engine/expression.js',
    'engine/autosave-controller.js',
    'engine/autosave-payload.js',
    'engine/autosave-storage.js',
    'engine/audio-controller.js',
    'engine/background-media-controller.js',
    'engine/character-controller.js',
    'engine/panorama-package-controller.js',
    'engine/panorama-photo-viewer-controller.js',
    'engine/panorama-marks-controller.js',
    'engine/game-host.js',
    'engine/game-protocol.js',
    'engine/resource-path-policy.js',
    'engine/story-analysis.js',
    'engine/story-graph.js',
    'engine/story-video-controller.js',
    'engine/story-loader.js',
    'engine/story-sandbox-loader.js',
    'engine/visual-transition-controller.js',
    'lib/mermaid.min.js',
    'lib/jsrsasign-all-min.js',
    'lib/three.min.js',
    'story.js',
    'docs/examples/story-example.js',
    'tools/convert-360-img-to-css.html',
    'tools/convert-360-img-to-js.html',
    'assets/360/oversized-360.css',
    'assets/games/registered.html',
    'assets/games/hidden.html',
    'assets/360/hall-360-mobile.js',
    'assets/scripts/custom.js'
  ];
  const records = requiredPaths.map(function(filePath) {
    return { path: filePath, size: filePath === 'assets/360/oversized-360.css' ? 131 * 1024 * 1024 : 1 };
  });
  const issues = Array.from(core.inspectInventory(records, ['assets/games/registered.html']));
  const issueCodes = issues.map(function(issue) {
    return issue.code;
  });

  assert.ok(issueCodes.includes('PANORAMA_JS_FILE'));
  assert.ok(issueCodes.includes('UNEXPECTED_JAVASCRIPT'));
  assert.ok(issueCodes.includes('UNREGISTERED_HTML'));
  assert.ok(issueCodes.includes('FILE_NOT_ALLOWED'));
  assert.ok(issueCodes.includes('PANORAMA_CSS_TOO_LARGE'));
  assert.equal(issueCodes.includes('RUNTIME_MISSING'), false);
  assert.equal(issues.some(function(issue) {
    return issue.path === 'docs/examples/story-example.js' && issue.code === 'UNEXPECTED_JAVASCRIPT';
  }), false);
  assert.equal(issues.some(function(issue) {
    return issue.path === 'tools/convert-360-img-to-css.html' && issue.code === 'UNREGISTERED_HTML';
  }), false);
  assert.equal(issues.some(function(issue) {
    return issue.path === 'tools/convert-360-img-to-js.html' && issue.code === 'UNREGISTERED_HTML';
  }), false);
});

// Проверяет реальный пример, доступность всех зарегистрированных файлов и безопасную штатную игру.
test('аудитор читает демонстрационный story.js и все зарегистрированные мини-игры', async function() {
  const { core } = await loadStudentAuditorCore();
  const storySource = await readRepositoryFile('story-example.js');
  const storyInspection = core.inspectStorySource(storySource);
  const storyIssues = Array.from(storyInspection.issues);

  assert.equal(storyIssues.length, 0);
  const registration = core.collectRegisteredGames(storyInspection.storyText);
  assert.equal(Array.from(registration.issues).length, 0);
  assert.ok(Array.from(registration.games).length >= 1);

  let checkedGameCount = 0;
  for (const game of Array.from(registration.games)) {
    const source = await readRepositoryFile(game.path);
    const criticalIssues = Array.from(core.inspectMiniGameSource(game.path, source)).filter(function(issue) {
      return issue.level === 'error' || issue.level === 'incomplete';
    });
    assert.deepEqual(criticalIssues, [], game.path + ' не должен давать ложное критическое срабатывание.');
    checkedGameCount += 1;
  }
  assert.equal(checkedGameCount, Array.from(registration.games).length);
});
