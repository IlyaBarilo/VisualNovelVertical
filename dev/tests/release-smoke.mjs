import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { createServer } from 'node:http';
import { access, lstat, mkdir, mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath, pathToFileURL } from 'node:url';

const developerRoot = path.dirname(fileURLToPath(new URL('../package.json', import.meta.url)));
const fixtureStoryPath = fileURLToPath(new URL('./e2e/fixtures/story-fixture.js', import.meta.url));
const reportRoot = path.join(developerRoot, '.playwright', 'release-smoke');
const optionalScriptPaths = new Set(['/license-key.js', '/story360.js', '/user.js']);
const fileSmokePanoramaRelativePath = 'assets/360/__release-smoke__/file-smoke-360.css';
const fileSmokePanoramaDataUrl = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=';
const supportedSmokeBrowsers = new Set(['chromium', 'firefox', 'msedge']);

/**
 * Разбирает путь к ZIP и браузер, отклоняя неизвестные параметры до распаковки большого архива.
 */
function parseSmokeOptions(argumentsList) {
  var archiveArgument = '';
  var browserName = 'chromium';

  argumentsList.forEach(function(argument) {
    if (argument.startsWith('--browser=')) {
      browserName = argument.slice('--browser='.length).trim().toLowerCase();
      return;
    }
    if (argument.startsWith('-')) {
      throw new Error(`Неизвестный параметр release smoke: ${argument}`);
    }
    if (archiveArgument) {
      throw new Error('Release smoke принимает путь только к одному ZIP-архиву.');
    }
    archiveArgument = argument;
  });

  if (!supportedSmokeBrowsers.has(browserName)) {
    throw new Error(`Браузер ${browserName || '(не задан)'} не поддерживается release smoke.`);
  }
  return { archiveArgument, browserName };
}

/**
 * Запускает выбранный движок Playwright; Firefox принудительно разрешает программный WebGL на CI-runner без GPU.
 */
async function launchSmokeBrowser(browserName) {
  const playwright = await import('playwright');
  if (browserName === 'msedge') {
    return playwright.chromium.launch({ headless: true, channel: 'msedge' });
  }
  if (browserName === 'firefox') {
    return playwright.firefox.launch({
      headless: true,
      firefoxUserPrefs: {
        'webgl.disabled': false,
        'webgl.force-enabled': true,
        'webgl.forbid-software': false
      }
    });
  }
  return playwright[browserName].launch({ headless: true });
}

/**
 * Создаёт минимальный CSS-пакет с корректным PNG 1x1 для проверки реального локального канала CSS → Blob → WebGL.
 */
function createFileSmokePanoramaCssSource() {
  const payload = fileSmokePanoramaDataUrl.split(',')[1];
  const imageSize = Buffer.from(payload, 'base64').length;
  const chunks = [];
  for (let offset = 0; offset < fileSmokePanoramaDataUrl.length; offset += 32) {
    chunks.push(fileSmokePanoramaDataUrl.slice(offset, offset + 32));
  }

  return [
    '#vn360-pack {',
    '  --vn360-schema: "vn360-css-pack-v1";',
    '  --vn360-mode: "normal";',
    '  --vn360-mime: "image/png";',
    '  --vn360-width: "1";',
    '  --vn360-height: "1";',
    `  --vn360-size: "${imageSize}";`,
    '  --vn360-quality: "1";',
    `  --vn360-chunk-count: "${chunks.length}";`,
    ...chunks.map(function(chunk, index) {
      return `  --vn360-data-${index}: "${chunk}";`;
    }),
    '}',
    ''
  ].join('\n');
}

/**
 * Создаёт сценарий, который считается успешно запущенным только после загрузки CSS-панорамы из распакованного каталога.
 */
function createFileSmokeStorySource() {
  return [
    'window.STORY_TEXT = `',
    '',
    '[meta]',
    'title = "Release file smoke"',
    'projectId = release-file-smoke',
    'lang = ru',
    'startScene = intro',
    'mode = release',
    'autosave = false',
    'transition = none',
    'transitionMs = 0',
    'bg360Quality = normal',
    'engine.gameSandbox = strict',
    '',
    '[bg]',
    `fileSmoke file=${fileSmokePanoramaRelativePath} 360 quality=normal`,
    '',
    '[scene]',
    'scene intro',
    'bg fileSmoke scroll',
    '"Панорама file smoke загружена"',
    '`;',
    ''
  ].join('\n');
}

/**
 * Создаёт импортируемую карту редактора с тем же CSS-пакетом, чтобы после F5 проверить восстановление локального пути.
 */
function createFileSmokeStory360Source() {
  return `window.STORY360 = ${JSON.stringify({
    version: 1,
    spaces: {
      releaseSmoke: {
        panoramas: {
          start: {
            file: fileSmokePanoramaRelativePath,
            marks: []
          }
        }
      }
    }
  }, null, 2)};\n`;
}

/**
 * Запускает системную команду без shell и добавляет её вывод в ошибку при ненулевом коде.
 */
function runProcess(command, argumentsList, additionalEnvironment = {}) {
  return new Promise(function(resolve, reject) {
    const child = spawn(command, argumentsList, {
      env: { ...process.env, ...additionalEnvironment },
      shell: false,
      windowsHide: true,
      stdio: ['ignore', 'pipe', 'pipe']
    });
    let stdout = '';
    let stderr = '';
    child.stdout.setEncoding('utf8');
    child.stderr.setEncoding('utf8');
    child.stdout.on('data', function(chunk) {
      stdout += chunk;
    });
    child.stderr.on('data', function(chunk) {
      stderr += chunk;
    });
    child.once('error', reject);
    child.once('close', function(exitCode) {
      if (exitCode === 0) {
        resolve({ stdout, stderr });
        return;
      }
      reject(new Error(
        `Команда распаковки завершилась с кодом ${exitCode}: ${command}\n${stderr || stdout}`
      ));
    });
  });
}

/**
 * Распаковывает ZIP штатным средством ОС, не добавляя отдельную библиотеку архивации в проект.
 */
async function extractZipArchive(archivePath, destinationPath) {
  if (process.platform === 'win32') {
    const windowsRoot = process.env.SystemRoot || 'C:\\Windows';
    const powershellPath = path.join(
      windowsRoot,
      'System32',
      'WindowsPowerShell',
      'v1.0',
      'powershell.exe'
    );
    const commandSource = [
      "$ErrorActionPreference = 'Stop'",
      'Expand-Archive -LiteralPath $env:VN_RELEASE_SMOKE_ARCHIVE -DestinationPath $env:VN_RELEASE_SMOKE_DESTINATION -Force'
    ].join('; ');
    await runProcess(powershellPath, [
      '-NoProfile',
      '-NonInteractive',
      '-Command',
      commandSource
    ], {
      VN_RELEASE_SMOKE_ARCHIVE: archivePath,
      VN_RELEASE_SMOKE_DESTINATION: destinationPath
    });
    return;
  }

  await runProcess('unzip', ['-q', archivePath, '-d', destinationPath]);
}

/**
 * Находит единственный корневой каталог полного релиза и отклоняет посторонние элементы рядом с ним.
 */
async function findReleaseRoot(extractionRoot) {
  const entries = await readdir(extractionRoot, { withFileTypes: true });
  const releaseEntries = entries.filter(function(entry) {
    return entry.name !== '__MACOSX';
  });
  assert.equal(releaseEntries.length, 1, 'Полный ZIP должен содержать один корневой каталог приложения.');
  assert.equal(releaseEntries[0].isDirectory(), true, 'Корень полного ZIP должен быть каталогом.');
  return path.join(extractionRoot, releaseEntries[0].name);
}

/**
 * Добавляет пользовательские fixtures только во временную копию релиза и не изменяет проверяемый ZIP или рабочий проект.
 */
async function prepareFileSmokeFixtures(releaseRoot, temporaryRoot) {
  const storyPath = path.join(releaseRoot, 'story.js');
  const panoramaPath = path.join(releaseRoot, ...fileSmokePanoramaRelativePath.split('/'));
  const editorStoryPath = path.join(temporaryRoot, 'story360-file-smoke.js');

  await assert.rejects(
    access(storyPath),
    function isMissingStory(error) {
      return Boolean(error && error.code === 'ENOENT');
    },
    'Полный релиз не должен содержать пользовательский story.js до smoke-проверки.'
  );
  await mkdir(path.dirname(panoramaPath), { recursive: true });
  await Promise.all([
    writeFile(storyPath, createFileSmokeStorySource(), 'utf8'),
    writeFile(panoramaPath, createFileSmokePanoramaCssSource(), 'utf8'),
    writeFile(editorStoryPath, createFileSmokeStory360Source(), 'utf8')
  ]);

  return {
    editorStoryPath,
    indexUrl: pathToFileURL(path.join(releaseRoot, 'index.html')).href,
    editorUrl: pathToFileURL(path.join(releaseRoot, 'tools', 'scene360-editor.html')).href
  };
}

/**
 * Возвращает MIME-тип для runtime-файлов, которые браузер может запросить при первом запуске.
 */
function getContentType(filePath) {
  const extension = path.extname(filePath).toLowerCase();
  const contentTypes = {
    '.css': 'text/css; charset=utf-8',
    '.html': 'text/html; charset=utf-8',
    '.js': 'text/javascript; charset=utf-8',
    '.json': 'application/json; charset=utf-8',
    '.svg': 'image/svg+xml',
    '.png': 'image/png',
    '.jpg': 'image/jpeg',
    '.jpeg': 'image/jpeg',
    '.webp': 'image/webp'
  };
  return contentTypes[extension] || 'application/octet-stream';
}

/**
 * Проверяет, что URL не позволяет HTTP-серверу прочитать файл за пределами распакованного релиза.
 */
function resolveReleaseFile(releaseRoot, pathname) {
  const normalizedPath = pathname === '/' ? '/index.html' : pathname;
  const filePath = path.resolve(releaseRoot, `.${normalizedPath}`);
  const relativePath = path.relative(releaseRoot, filePath);
  if (
    !relativePath ||
    path.isAbsolute(relativePath) ||
    relativePath === '..' ||
    relativePath.startsWith(`..${path.sep}`)
  ) {
    throw new Error(`HTTP-путь выходит за распакованный релиз: ${pathname}`);
  }
  return filePath;
}

/**
 * Отправляет HTTP-ответ и не передаёт тело для HEAD-запроса.
 */
function sendResponse(request, response, statusCode, contentType, body) {
  response.writeHead(statusCode, {
    'Cache-Control': 'no-store',
    'Content-Type': contentType
  });
  response.end(request.method === 'HEAD' ? undefined : body);
}

/**
 * Обслуживает runtime из распакованного ZIP, подменяя только сценарий небольшим синтетическим fixture.
 */
async function handleReleaseRequest(releaseRoot, storySource, request, response) {
  if (request.method !== 'GET' && request.method !== 'HEAD') {
    sendResponse(request, response, 405, 'text/plain; charset=utf-8', 'Method Not Allowed');
    return;
  }

  let pathname;
  try {
    pathname = decodeURIComponent(new URL(request.url || '/', 'http://127.0.0.1').pathname);
  } catch (error) {
    sendResponse(request, response, 400, 'text/plain; charset=utf-8', 'Bad Request');
    return;
  }

  if (pathname === '/story.js') {
    sendResponse(request, response, 200, 'text/javascript; charset=utf-8', storySource);
    return;
  }
  if (optionalScriptPaths.has(pathname)) {
    sendResponse(request, response, 200, 'text/javascript; charset=utf-8', '// optional in release smoke\n');
    return;
  }
  if (pathname === '/favicon.ico') {
    sendResponse(request, response, 204, 'image/x-icon', '');
    return;
  }

  let filePath;
  try {
    filePath = resolveReleaseFile(releaseRoot, pathname);
    const body = await readFile(filePath);
    sendResponse(request, response, 200, getContentType(filePath), body);
  } catch (error) {
    const statusCode = error && error.code === 'ENOENT' ? 404 : 403;
    sendResponse(
      request,
      response,
      statusCode,
      'text/plain; charset=utf-8',
      statusCode === 404 ? 'Not Found' : 'Forbidden'
    );
  }
}

/**
 * Запускает временный HTTP-сервер на случайном локальном порту и возвращает функцию корректной остановки.
 */
async function startReleaseServer(releaseRoot, storySource) {
  const server = createServer(function(request, response) {
    handleReleaseRequest(releaseRoot, storySource, request, response).catch(function(error) {
      sendResponse(request, response, 500, 'text/plain; charset=utf-8', error.message || 'Server Error');
    });
  });

  await new Promise(function(resolve, reject) {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', resolve);
  });
  const address = server.address();
  assert.ok(address && typeof address === 'object', 'Не удалось определить порт smoke-сервера.');

  return {
    baseUrl: `http://127.0.0.1:${address.port}`,
    close: function() {
      return new Promise(function(resolve, reject) {
        server.close(function(error) {
          if (error) reject(error);
          else resolve();
        });
      });
    }
  };
}

/**
 * Сохраняет screenshot и текст диагностики только при сбое браузерной проверки.
 */
async function saveFailureReport(page, details) {
  await mkdir(reportRoot, { recursive: true });
  if (page) {
    await page.screenshot({
      path: path.join(reportRoot, 'failure.png'),
      fullPage: true
    }).catch(function() {});
  }
  await writeFile(
    path.join(reportRoot, 'diagnostics.json'),
    `${JSON.stringify(details, null, 2)}\n`,
    'utf8'
  );
}

/**
 * Собирает ошибки file://-страницы и блокирует любую попытку выйти во внешнюю HTTP(S)-сеть во время smoke-проверки.
 */
async function attachFileSmokeDiagnostics(page, diagnostics) {
  page.on('pageerror', function(error) {
    diagnostics.pageErrors.push(error && error.message ? error.message : String(error));
  });
  page.on('console', function(message) {
    if (message.type() === 'error') diagnostics.consoleErrors.push(message.text());
    if (message.type() === 'warning') diagnostics.consoleWarnings.push(message.text());
  });
  page.on('requestfailed', function(request) {
    var failure = request.failure();
    diagnostics.failedRequests.push({
      url: request.url(),
      error: failure && failure.errorText ? failure.errorText : 'unknown'
    });
  });
  await page.route(/^https?:\/\//i, async function blockFileSmokeNetwork(route) {
    diagnostics.externalRequests.push(route.request().url());
    await route.abort('blockedbyclient');
  });
}

/**
 * Открывает распакованный runtime в выбранном браузере и проверяет первую реплику синтетической истории.
 */
async function runBrowserSmoke(releaseRoot, baseUrl, archivePath, browserName) {
  const browser = await launchSmokeBrowser(browserName);
  const page = await browser.newPage({ viewport: { width: 412, height: 915 } });
  const pageErrors = [];
  const consoleErrors = [];
  const failedResponses = [];
  const externalRequests = [];

  page.on('pageerror', function(error) {
    pageErrors.push(error && error.message ? error.message : String(error));
  });
  page.on('console', function(message) {
    if (message.type() === 'error') consoleErrors.push(message.text());
  });
  page.on('response', function(response) {
    if (response.status() >= 400) failedResponses.push(`${response.status()} ${response.url()}`);
  });
  await page.route('**/*', async function(route) {
    const requestUrl = new URL(route.request().url());
    if (requestUrl.origin !== baseUrl) {
      externalRequests.push(requestUrl.href);
      await route.abort('blockedbyclient');
      return;
    }
    await route.continue();
  });

  try {
    await page.goto(`${baseUrl}/`, { waitUntil: 'domcontentloaded' });
    await page.waitForFunction(function hasFirstStoryLine() {
      const textBox = document.querySelector('#textBox');
      return Boolean(textBox && textBox.textContent.trim() === 'Первый экран E2E');
    }, undefined, { timeout: 10_000 });

    assert.equal(await page.title(), 'E2E-проверка движка');
    assert.equal(await page.locator('#dialog').isVisible(), true, 'Диалог движка не отображается.');
    assert.deepEqual(pageErrors, [], 'В распакованном runtime возникли необработанные ошибки страницы.');
    assert.deepEqual(consoleErrors, [], 'В распакованном runtime возникли ошибки console.error.');
    assert.deepEqual(failedResponses, [], 'Распакованный runtime запросил отсутствующие файлы.');
    assert.deepEqual(externalRequests, [], 'Распакованный runtime попытался обратиться к внешней сети.');
  } catch (error) {
    await saveFailureReport(page, {
      archivePath,
      browserName,
      releaseRoot,
      pageErrors,
      consoleErrors,
      failedResponses,
      externalRequests,
      error: error && error.stack ? error.stack : String(error)
    });
    throw error;
  } finally {
    await browser.close();
  }
}

/**
 * Читает доступность WebGL и сведения о выбранном рендерере, чтобы отличить сбой CI-окружения от ошибки CSS-панорамы.
 */
async function readWebGlDiagnostics(page) {
  return page.evaluate(function inspectWebGl() {
    var contextNames = ['webgl2', 'webgl', 'experimental-webgl'];
    var errors = [];

    for (var index = 0; index < contextNames.length; index++) {
      var contextName = contextNames[index];
      var canvas = document.createElement('canvas');
      var context = null;

      try {
        context = canvas.getContext(contextName);
      } catch (error) {
        errors.push(contextName + ': ' + (error && error.message ? error.message : String(error)));
      }
      if (!context) continue;

      var debugInfo = null;
      try {
        debugInfo = context.getExtension('WEBGL_debug_renderer_info');
      } catch (error) {
        errors.push('WEBGL_debug_renderer_info: ' + (error && error.message ? error.message : String(error)));
      }

      return {
        available: true,
        contextName: contextName,
        vendor: debugInfo ? String(context.getParameter(debugInfo.UNMASKED_VENDOR_WEBGL) || '') : '',
        renderer: debugInfo ? String(context.getParameter(debugInfo.UNMASKED_RENDERER_WEBGL) || '') : '',
        errors: errors
      };
    }

    return {
      available: false,
      contextName: '',
      vendor: '',
      renderer: '',
      errors: errors
    };
  });
}

/**
 * Открывает распакованный runtime и редактор напрямую через file://, проверяя CSS-панораму и её восстановление после F5.
 */
async function runFileBrowserSmoke(releaseRoot, fixtures, archivePath, browserName) {
  const browser = await launchSmokeBrowser(browserName);
  const context = await browser.newContext({ viewport: { width: 412, height: 915 } });
  const diagnostics = {
    pageErrors: [],
    consoleErrors: [],
    consoleWarnings: [],
    failedRequests: [],
    externalRequests: []
  };
  let page = null;
  let phase = 'runtime';
  let webGlDiagnostics = null;

  try {
    page = await context.newPage();
    await attachFileSmokeDiagnostics(page, diagnostics);
    await page.goto(fixtures.indexUrl, { waitUntil: 'domcontentloaded' });
    webGlDiagnostics = await readWebGlDiagnostics(page);
    assert.equal(
      webGlDiagnostics.available,
      true,
      `WebGL недоступен в ${browserName} при запуске release smoke через file://: ${JSON.stringify(webGlDiagnostics)}`
    );
    await page.waitForFunction(function hasFilePanorama() {
      var textBox = document.querySelector('#textBox');
      var layer = document.querySelector('#bg360Layer');
      return Boolean(
        textBox &&
        textBox.textContent.trim() === 'Панорама file smoke загружена' &&
        layer &&
        !layer.classList.contains('hidden') &&
        layer.tagName === 'CANVAS' &&
        !document.querySelector('iframe[data-bg360-css-pack-loader]')
      );
    }, undefined, { timeout: 15_000 });
    assert.equal(await page.title(), 'Release file smoke');
    assert.equal(await page.locator('#bg360Layer').isVisible(), true, 'CSS-панорама движка не отображается через file://.');

    phase = 'editor';
    await page.close();
    page = await context.newPage();
    await attachFileSmokeDiagnostics(page, diagnostics);
    await page.goto(fixtures.editorUrl, { waitUntil: 'domcontentloaded' });
    await page.locator('#story360Input').setInputFiles(fixtures.editorStoryPath);
    await page.waitForFunction(function hasEditorPanorama(expectedPath) {
      var input = document.querySelector('#assetPathInput');
      var status = document.querySelector('#statusBox');
      return Boolean(
        input &&
        input.value === expectedPath &&
        status &&
        status.textContent.includes('Панорама загружена: ' + expectedPath) &&
        window.sphereMesh &&
        window.sphereMesh.material &&
        window.sphereMesh.material.map &&
        !document.querySelector('iframe[data-scene360-css-pack-loader]')
      );
    }, fileSmokePanoramaRelativePath, { timeout: 15_000 });

    phase = 'editor-reload';
    await page.reload({ waitUntil: 'domcontentloaded' });
    await page.waitForFunction(function hasRestoredEditorPanorama(expectedPath) {
      var input = document.querySelector('#assetPathInput');
      var status = document.querySelector('#statusBox');
      return Boolean(
        input &&
        input.value === expectedPath &&
        status &&
        status.textContent.includes('Панорама загружена: ' + expectedPath) &&
        window.sphereMesh &&
        window.sphereMesh.material &&
        window.sphereMesh.material.map &&
        !document.querySelector('iframe[data-scene360-css-pack-loader]')
      );
    }, fileSmokePanoramaRelativePath, { timeout: 15_000 });

    // Отсутствующие story360.js, license-key.js и user.js штатны; остальные локальные ошибки скрывать нельзя.
    var optionalFailures = diagnostics.failedRequests.filter(function(request) {
      return /\/(?:story360|license-key|user)\.js$/i.test(new URL(request.url).pathname);
    });
    var unexpectedFailedRequests = diagnostics.failedRequests.filter(function(request) {
      return !/\/(?:story360|license-key|user)\.js$/i.test(new URL(request.url).pathname);
    });
    var unexpectedConsoleErrors = diagnostics.consoleErrors.filter(function(message) {
      return !(optionalFailures.length > 0 && message === 'Failed to load resource: net::ERR_FILE_NOT_FOUND');
    });
    assert.deepEqual(diagnostics.pageErrors, [], 'В file:// runtime или редакторе возникли необработанные ошибки.');
    assert.deepEqual(unexpectedConsoleErrors, [], 'В file:// runtime или редакторе возникли неожиданные ошибки console.error.');
    assert.deepEqual(unexpectedFailedRequests, [], 'File:// runtime или редактор не загрузил обязательный локальный файл.');
    assert.deepEqual(diagnostics.externalRequests, [], 'File:// smoke попытался обратиться к внешней сети.');
  } catch (error) {
    var pageState = page ? await page.evaluate(function readFileSmokePageState() {
      var layer = document.querySelector('#bg360Layer');
      var runtimeLoader = document.querySelector('iframe[data-bg360-css-pack-loader]');
      var editorLoader = document.querySelector('iframe[data-scene360-css-pack-loader]');
      var status = document.querySelector('#statusBox');
      return {
        url: window.location.href,
        text: document.querySelector('#textBox') ? document.querySelector('#textBox').textContent : '',
        layerClass: layer ? layer.className : '',
        canvasCount: layer ? (layer.tagName === 'CANVAS' ? 1 : layer.querySelectorAll('canvas').length) : 0,
        runtimeLoader: runtimeLoader ? runtimeLoader.getAttribute('data-bg360-css-pack-loader') : '',
        editorLoader: editorLoader ? editorLoader.getAttribute('data-scene360-css-pack-loader') : '',
        assetPath: document.querySelector('#assetPathInput') ? document.querySelector('#assetPathInput').value : '',
        status: status ? status.textContent : ''
      };
    }).catch(function() { return null; }) : null;
    await saveFailureReport(page, {
      archivePath,
      browserName,
      releaseRoot,
      mode: 'file',
      phase,
      webGlDiagnostics,
      pageState,
      ...diagnostics,
      error: error && error.stack ? error.stack : String(error)
    });
    throw error;
  } finally {
    await browser.close();
  }
}

const smokeOptions = parseSmokeOptions(process.argv.slice(2));
const archiveArgument = smokeOptions.archiveArgument;

// Проверяет полный ZIP после распаковки отдельно через диагностический HTTP-контур и настоящий автономный file://.
test(`распакованный полный ZIP запускает движок и CSS-панорамы через HTTP и file:// в ${smokeOptions.browserName}`, { timeout: 90_000 }, async function() {
  assert.ok(
    archiveArgument,
    'Укажите путь к полному ZIP: npm run test:release:smoke -- ../имя-архива.zip --browser=chromium'
  );
  const archivePath = path.resolve(process.cwd(), archiveArgument);
  const archiveInfo = await lstat(archivePath);
  assert.equal(archiveInfo.isFile(), true, 'Путь smoke-проверки должен указывать на ZIP-файл.');
  assert.equal(path.extname(archivePath).toLowerCase(), '.zip', 'Smoke-проверка принимает только ZIP-файл.');

  const temporaryRoot = await mkdtemp(path.join(tmpdir(), 'vn-release-smoke-'));
  const extractionRoot = path.join(temporaryRoot, 'unpacked');
  let releaseServer;
  try {
    await mkdir(extractionRoot, { recursive: true });
    await extractZipArchive(archivePath, extractionRoot);
    const releaseRoot = await findReleaseRoot(extractionRoot);
    await Promise.all([
      access(path.join(releaseRoot, 'index.html')),
      access(path.join(releaseRoot, 'engine', 'autosave-controller.js')),
      access(path.join(releaseRoot, 'engine', 'autosave-payload.js')),
      access(path.join(releaseRoot, 'engine', 'autosave-storage.js')),
      access(path.join(releaseRoot, 'engine', 'audio-controller.js')),
      access(path.join(releaseRoot, 'engine', 'background-media-controller.js')),
      access(path.join(releaseRoot, 'engine', 'character-controller.js')),
      access(path.join(releaseRoot, 'engine', 'panorama-package-controller.js')),
      access(path.join(releaseRoot, 'engine', 'panorama-photo-viewer-controller.js')),
      access(path.join(releaseRoot, 'engine', 'panorama-marks-controller.js')),
      access(path.join(releaseRoot, 'engine', 'engine.css')),
      access(path.join(releaseRoot, 'engine', 'engine.js')),
      access(path.join(releaseRoot, 'engine', 'expression.js')),
      access(path.join(releaseRoot, 'engine', 'game-host.js')),
      access(path.join(releaseRoot, 'engine', 'resource-path-policy.js')),
      access(path.join(releaseRoot, 'engine', 'story-analysis.js')),
      access(path.join(releaseRoot, 'engine', 'story-graph.js')),
      access(path.join(releaseRoot, 'engine', 'story-video-controller.js')),
      access(path.join(releaseRoot, 'engine', 'story-sandbox-loader.js')),
      access(path.join(releaseRoot, 'engine', 'story-loader.js')),
      access(path.join(releaseRoot, 'engine', 'visual-transition-controller.js'))
    ]);

    const storySource = await readFile(fixtureStoryPath, 'utf8');
    releaseServer = await startReleaseServer(releaseRoot, storySource);
    await runBrowserSmoke(releaseRoot, releaseServer.baseUrl, archivePath, smokeOptions.browserName);
    await releaseServer.close();
    releaseServer = null;

    const fileFixtures = await prepareFileSmokeFixtures(releaseRoot, temporaryRoot);
    await runFileBrowserSmoke(releaseRoot, fileFixtures, archivePath, smokeOptions.browserName);
  } finally {
    if (releaseServer) await releaseServer.close();
    await rm(temporaryRoot, { recursive: true, force: true });
  }
});
