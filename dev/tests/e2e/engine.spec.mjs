import { expect, test } from '@playwright/test';
import { existsSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import { createServer } from 'node:http';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { clickFrameButton } from './helpers/frame-input.mjs';

const repositoryRoot = path.dirname(fileURLToPath(new URL('../../../index.html', import.meta.url)));
const fixtureRoot = path.dirname(fileURLToPath(new URL('./fixtures/story-fixture.js', import.meta.url)));
const fixtureRoutes = new Map([
  ['/story.js', path.join(fixtureRoot, 'story-fixture.js')],
  ['/assets/__e2e__/game.html', path.join(fixtureRoot, 'game.html')],
  ['/assets/__e2e__/legacy-game.html', path.join(fixtureRoot, 'legacy-game.html')]
]);
const e2eServerPort = 41739;
const e2eServerOrigin = `http://127.0.0.1:${e2eServerPort}`;
const e2eLocalhostOrigin = `http://localhost:${e2eServerPort}`;
const allowedEngineOrigins = new Set([e2eServerOrigin, e2eLocalhostOrigin]);
const blockedLocalRoutes = new Set(['/story360.js', '/license-key.js', '/user.js']);
const tinyPanoramaDataUrl = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=';
let activeRouteOptions = {};
let e2eHttpServer = null;

// Создаёт сценарий для проверки очереди и лимита исполнения без загрузки медиа или пользовательских файлов.
function createControlFlowStory(actions, autosave = false) {
  return 'window.STORY_TEXT = ' + JSON.stringify([
    '[meta]',
    'title = Проверка исполнения',
    'projectId = control-flow-e2e',
    'lang = ru',
    'startScene = intro',
    'mode = release',
    'transition = none',
    'autosave = ' + autosave,
    '[var]',
    'leaked = 0',
    'visits = 0',
    'rounds = 0',
    '[scene]',
    'scene intro',
    ...actions
  ].join('\n')) + ';';
}

// Создаёт короткую историю для проверки projectId, миграции и независимости localStorage-слотов.
function createAutosaveProjectStorySource(projectId, label) {
  const lines = [
    'window.STORY_TEXT = `',
    '',
    '[meta]',
    `title = ${JSON.stringify(`Автосохранение ${label}`)}`,
    'lang = ru',
    'startScene = intro',
    'mode = release',
    'autosave = true',
    'transition = none',
    'transitionMs = 0',
    'engine.gameSandbox = strict',
    '',
    '[scene]',
    'scene intro',
    JSON.stringify(`Начало ${label}`),
    JSON.stringify(`Прогресс ${label}`),
    '`;',
    ''
  ];
  if (projectId) lines.splice(4, 0, `projectId = ${projectId}`);
  return lines.join('\n');
}

// Создаёт информационное окно с вымышленными реквизитами; вся настройка остаётся одной строкой meta.
function createAboutStorySource(metaLines = []) {
  const storyText = [
    '[meta]',
    'title = Тестовый проект',
    'lang = ru',
    'startScene = intro',
    'mode = release',
    'autosave = false',
    'transition = none',
    ...metaLines,
    '[scene]',
    'scene intro',
    '"Реплика[br]без переноса"',
    '"Продолжение"'
  ].join('\n');
  return 'window.STORY_TEXT = ' + JSON.stringify(storyText) + ';';
}

// Создаёт обычный видеофон и сюжетное видео с отсутствующими файлами, чтобы стабильно проверить оба image fallback в браузерах.
function createMediaControllerStorySource() {
  return [
    'window.STORY_TEXT = `',
    '',
    '[meta]',
    'title = Media controllers E2E',
    'lang = ru',
    'startScene = intro',
    'mode = release',
    'autosave = false',
    'transition = none',
    'transitionMs = 0',
    'blurBackground = true',
    'engine.gameSandbox = strict',
    '',
    '[bg]',
    'videoFallback file=assets/__e2e__/missing-bg.mp4 fallback=assets/backgrounds/bg-campus-hall.jpg volume=0.4',
    '',
    '[video]',
    'storyFallback file=assets/__e2e__/missing-story.mp4 poster=assets/backgrounds/bg-campus-cafe.jpg volume=0.5',
    '',
    '[scene]',
    'scene intro',
    'bg videoFallback',
    '"Фон после fallback"',
    'video storyFallback fallbackDuration=10 skip=true',
    '"После сюжетного видео"',
    '`;',
    ''
  ].join('\n');
}

// Создаёт два последовательных image-crossfade и длинный второй переход для проверки отмены через restart.
function createVisualTransitionStorySource() {
  return [
    'window.STORY_TEXT = `',
    '',
    '[meta]',
    'title = Visual transitions E2E',
    'lang = ru',
    'startScene = intro',
    'mode = release',
    'autosave = false',
    'transition = fade',
    'transitionMs = 700',
    'engine.gameSandbox = strict',
    '',
    '[bg]',
    'hall file=assets/backgrounds/bg-campus-hall.jpg',
    'cafe file=assets/backgrounds/bg-campus-cafe.jpg',
    '',
    '[scene]',
    'scene intro',
    'bg hall transition=none',
    '"Первый фон перехода"',
    'bg cafe transition=fade transitionMs=700',
    '"Второй фон перехода"',
    'bg hall transition=fade transitionMs=1400',
    '"Третий фон перехода"',
    '`;',
    ''
  ].join('\n');
}

// Создаёт историю для реальной проверки смены персонажа, focus/scale, resize, hide и restart.
function createCharacterControllerStorySource() {
  return [
    'window.STORY_TEXT = `',
    '',
    '[meta]',
    'title = Character controller E2E',
    'lang = ru',
    'startScene = intro',
    'mode = release',
    'autosave = false',
    'transition = none',
    'transitionMs = 0',
    'engine.gameSandbox = strict',
    '',
    '[char]',
    'anna emotion=neutral file=assets/characters/ch-anna-neutral-smallresolution.png name="Анна"',
    'igor emotion=smile file=assets/characters/ch-igor-smile-smallresolution.png name="Игорь"',
    '',
    '[scene]',
    'scene intro',
    'show anna neutral left focusx=25 focusy=top scale=1.2',
    'anna: "Первый персонаж"',
    'show igor smile right focusx=70 focusy=bottom scale=0.9',
    'igor: "Второй персонаж"',
    'hide all',
    '"Персонаж скрыт"',
    '`;',
    ''
  ].join('\n');
}

// Создаёт минимальную историю с 360-фоном, чтобы проверять CSS-only загрузку в настоящем runtime движка.
function createBg360RuntimeStorySource(assetPath, quality = 'normal') {
  return [
    'window.STORY_TEXT = `',
    '',
    '[meta]',
    'title = CSS 360 E2E',
    'lang = ru',
    'startScene = intro',
    'mode = release',
    'autosave = false',
    'transition = none',
    'transitionMs = 0',
    `bg360Quality = ${quality}`,
    'engine.gameSandbox = strict',
    '',
    '[bg]',
    `runtimePano file=${assetPath} 360 quality=${quality}`,
    '',
    '[scene]',
    'scene intro',
    'bg runtimePano scroll',
    '"Панорама CSS E2E"',
    '`;',
    ''
  ].join('\n');
}

// Создаёт настоящий walk360 с WebGL-направлением, scene- и photo-метками для общего публичного сценарного потока.
function createPhotoViewerStorySource(assetPath) {
  return [
    'window.STORY_TEXT = `',
    '',
    '[meta]',
    'title = Photo viewer E2E',
    'lang = ru',
    'startScene = intro',
    'mode = release',
    'autosave = false',
    'transition = none',
    'transitionMs = 0',
    'engine.gameSandbox = strict',
    '',
    '[bg]',
    `sphere file=${assetPath} 360`,
    '',
    '[scene]',
    'scene intro',
    'bg sphere',
    'bg360marks sphere (route, 0.56, 0.5, walk, ) (exit, 0.5, 0.5, walk, next) (gallery, 0.5, 0.45, photo, assets/backgrounds/bg-campus-hall.jpg|assets/backgrounds/bg-campus-cafe.jpg)',
    'walk360 sphere text="Откройте фото E2E" button="Закрыть обзор"',
    '',
    'scene next',
    '"После навигации E2E"',
    '`;',
    ''
  ].join('\n');
}

// Создаёт историю с неиспользуемой CSS-панорамой и отсутствующим обычным изображением для раздельной статистики ресурсов.
function createPanoramaStatisticsStorySource(panoramaPath, missingImagePath) {
  return [
    'window.STORY_TEXT = `',
    '',
    '[meta]',
    'title = Panorama statistics E2E',
    'lang = ru',
    'startScene = intro',
    'mode = debug',
    'autosave = false',
    'transition = none',
    'transitionMs = 0',
    'engine.gameSandbox = strict',
    '',
    '[bg]',
    `statsPano file=${panoramaPath} 360`,
    '',
    '[char]',
    `missing emotion=neutral file=${missingImagePath} name="Missing"`,
    '',
    '[scene]',
    'scene intro',
    '"Статистика панорам E2E"',
    '`;',
    ''
  ].join('\n');
}

// Создаёт историю с несколькими неиспользуемыми CSS-панорамами для проверки последовательной фоновой очереди.
function createPanoramaQueueStorySource(panoramaPaths) {
  const declarations = panoramaPaths.map(function(panoramaPath, index) {
    return `queuePano${index + 1} file=${panoramaPath} 360`;
  });
  return [
    'window.STORY_TEXT = `',
    '',
    '[meta]',
    'title = Panorama queue E2E',
    'lang = ru',
    'startScene = intro',
    'mode = debug',
    'autosave = false',
    'transition = none',
    'transitionMs = 0',
    'engine.gameSandbox = strict',
    '',
    '[bg]',
    ...declarations,
    '',
    '[scene]',
    'scene intro',
    '"Фоновая проверка панорам E2E"',
    '`;',
    ''
  ].join('\n');
}

// Создаёт историю с HTML-подобными подписями, которые не должны стать активным DOM при построении графа.
function createGraphSecurityStorySource() {
  return [
    'window.STORY_TEXT = `',
    '',
    '[meta]',
    'title = "Граф <img src=x onerror=\'document.body.dataset.graphTitleXss=1\'>"',
    'lang = ru',
    'startScene = intro',
    'mode = debug',
    'autosave = false',
    'transition = none',
    'transitionMs = 0',
    'engine.gameSandbox = strict',
    '',
    '[game]',
    'unsafeCard file=assets/__e2e__/game.html title="<img src=x onerror=\'document.body.dataset.graphCardXss=1\'>" description="<svg onload=\'document.body.dataset.graphDescriptionXss=1\'>"',
    '',
    '[scene]',
    'scene intro',
    '"Граф безопасности"',
    '`;',
    ''
  ].join('\n');
}

// Создаёт граф с обычным фоном, персонажем, обложкой игры и CSS-панорамой для проверки единого прогресса изображений.
function createGraphImageProgressStorySource(paths) {
  return [
    'window.STORY_TEXT = `',
    '',
    '[meta]',
    'title = Graph image progress E2E',
    'lang = ru',
    'startScene = intro',
    'mode = debug',
    'autosave = false',
    'transition = none',
    'transitionMs = 0',
    'bg360Quality = normal',
    'engine.gameSandbox = strict',
    '',
    '[bg]',
    `graphImage file=${paths.background}`,
    `graphPano file=${paths.panorama} 360 quality=normal`,
    '',
    '[char]',
    `graphCharacter emotion=neutral file=${paths.character} name="Graph character"`,
    '',
    '[game]',
    `graphGame file=assets/__e2e__/game.html cover=${paths.cover} title="Graph game"`,
    '',
    '[scene]',
    'scene intro',
    '"Прогресс изображений графа E2E"',
    '',
    'scene imageResource',
    'bg graphImage',
    '"Обычный фон для графа"',
    '',
    'scene panoramaResource',
    'bg graphPano',
    '"CSS-панорама для графа"',
    '`;',
    ''
  ].join('\n');
}

// Создаёт минимальный story360.js с одним путём, чтобы проверять загрузку редактора без пользовательских файлов.
function createScene360StorySource(assetPath) {
  return `window.STORY360 = ${JSON.stringify({
    version: 1,
    spaces: {
      testSpace: {
        panoramas: {
          start: {
            file: assetPath,
            marks: []
          }
        }
      }
    }
  }, null, 2)};\n`;
}

// Создаёт story360 с переходом между пространствами для проверки редактора и экспортируемой цели space/panorama.
function createScene360CrossSpaceStorySource() {
  return `window.STORY360 = ${JSON.stringify({
    version: 1,
    spaces: {
      A: {
        panoramas: {
          P1: {
            comment: 'Главный вход',
            marks: [
              {
                id: 'toB2',
                x: 0.5,
                y: 0.5,
                type: 'walk',
                text: '',
                target: { type: '360', space: 'B', panorama: 'P2' }
              }
            ]
          }
        }
      },
      B: {
        panoramas: {
          P2: { comment: 'Второй этаж', marks: [] }
        }
      }
    }
  }, null, 2)};\n`;
}

// Создаёт цепочку из трёх панорам, чтобы проверять многошаговую историю возврата редактора.
function createScene360HistoryStorySource() {
  function panoramaWithTarget(targetPanorama) {
    return {
      marks: [
        {
          id: `to${targetPanorama}`,
          x: 0.5,
          y: 0.5,
          type: 'walk',
          text: '',
          target: { type: '360', panorama: targetPanorama }
        }
      ]
    };
  }
  return `window.STORY360 = ${JSON.stringify({
    version: 1,
    spaces: {
      Route: {
        panoramas: {
          P1: panoramaWithTarget('P2'),
          P2: panoramaWithTarget('P3'),
          P3: { marks: [] }
        }
      }
    }
  }, null, 2)};\n`;
}

// Собирает синтетический пакет конвертера с заметным побочным эффектом для проверки отсутствия скрытого выполнения.
function createScene360PackSource(datasetKey) {
  return [
    '(function() {',
    "  'use strict';",
    `  document.body.dataset[${JSON.stringify(datasetKey)}] = '1';`,
    '  window.VN360_PACKS_VARIANTS = window.VN360_PACKS_VARIANTS || {};',
    '  window.VN360_PACKS_META_VARIANTS = window.VN360_PACKS_META_VARIANTS || {};',
    '  var dataUrl = [',
    `    '${tinyPanoramaDataUrl}'`,
    "  ].join('');",
    '  var packMeta = {"schema":"vn360-pack-meta-v1","mode":"normal","type":"image/png","width":1,"height":1};',
    '  var packKey = document.currentScript && document.currentScript.src ? document.currentScript.src : "";',
    '  window.VN360_PACKS_VARIANTS[packKey] = { normal: dataUrl };',
    '  window.VN360_PACKS_META_VARIANTS[packKey] = { normal: packMeta };',
    '})();',
    ''
  ].join('\n');
}

// Собирает корректный декларативный CSS-пакет, а для вредного сценария добавляет @import и постороннее правило.
function createScene360CssPackSource(mode = 'normal', importPath = '') {
  const payload = tinyPanoramaDataUrl.split(',')[1];
  const imageBytes = Buffer.from(payload, 'base64').length;
  const chunks = [];
  for (let offset = 0; offset < tinyPanoramaDataUrl.length; offset += 32) {
    chunks.push(tinyPanoramaDataUrl.slice(offset, offset + 32));
  }
  return [
    ...(importPath ? [`@import url(${JSON.stringify(importPath)});`] : []),
    ...(importPath ? ['html, body { display: none !important; --scene360-css-injection: "1"; }'] : []),
    '#vn360-pack {',
    '  --vn360-schema: "vn360-css-pack-v1";',
    `  --vn360-mode: "${mode}";`,
    '  --vn360-mime: "image/png";',
    '  --vn360-width: "1";',
    '  --vn360-height: "1";',
    `  --vn360-size: "${imageBytes}";`,
    '  --vn360-quality: "1";',
    `  --vn360-chunk-count: "${chunks.length}";`,
    ...chunks.map(function(chunk, index) {
      return `  --vn360-data-${index}: "${chunk}";`;
    }),
    '}',
    ''
  ].join('\n');
}

// Добавляет доступ к внутренней проверке лицензии только в E2E-копию engine.js, не меняя публичный runtime.
function exposeLicenseVerifierToE2e(engineSource) {
  const eol = engineSource.includes('\r\n') ? '\r\n' : '\n';
  const closingMarker = eol + '})();';
  const closingIndex = engineSource.lastIndexOf(closingMarker);
  if (closingIndex < 0) {
    throw new Error('Не найден конец IIFE в engine.js.');
  }

  const hookSource = [
    '// Открывает лицензионную функцию только в изменённой копии, которую получает E2E-браузер.',
    'window.__VN_E2E_VERIFY_LICENSE = function(dataToVerify, signatureBytes, publicKeyPem) {',
    '  VN_LICENSE_PUBLIC_KEY_PEM = publicKeyPem;',
    '  return verifyLicenseSignature(dataToVerify, signatureBytes);',
    '};'
  ].join(eol);

  return engineSource.slice(0, closingIndex) + eol + hookSource + engineSource.slice(closingIndex);
}

// Возвращает MIME-тип для настоящих файлов движка и синтетических fixtures.
function getContentType(filePath) {
  const extension = path.extname(filePath).toLowerCase();
  const types = {
    '.css': 'text/css; charset=utf-8',
    '.html': 'text/html; charset=utf-8',
    '.js': 'text/javascript; charset=utf-8',
    '.mjs': 'text/javascript; charset=utf-8',
    '.json': 'application/json; charset=utf-8',
    '.svg': 'image/svg+xml',
    '.png': 'image/png',
    '.jpg': 'image/jpeg',
    '.jpeg': 'image/jpeg',
    '.webp': 'image/webp'
  };
  return types[extension] || 'application/octet-stream';
}

// Проверяет, что запрошенный путь остаётся внутри репозитория и не читает соседние файлы.
function isInsideRepository(filePath) {
  const relativePath = path.relative(repositoryRoot, filePath);
  return relativePath !== '' && !relativePath.startsWith('..') && !path.isAbsolute(relativePath);
}

// Завершает HTTP-ответ с едиными заголовками, чтобы браузеры не использовали данные предыдущего E2E-сценария.
function sendEngineHttpResponse(response, status, contentType, body) {
  response.writeHead(status, {
    'Cache-Control': 'no-store',
    'Content-Type': contentType
  });
  response.end(body);
}

// Отдаёт браузерам runtime-файлы через настоящий HTTP, включая importScripts отдельного Worker в Firefox.
async function handleEngineHttpRequest(request, response) {
  const routeOptions = activeRouteOptions;
  let requestUrl;
  let pathname;
  try {
    requestUrl = new URL(request.url || '/', `http://${request.headers.host || `127.0.0.1:${e2eServerPort}`}`);
    pathname = decodeURIComponent(requestUrl.pathname);
  } catch (error) {
    sendEngineHttpResponse(response, 400, 'text/plain; charset=utf-8', 'Bad Request');
    return;
  }

  if (!allowedEngineOrigins.has(requestUrl.origin)) {
    sendEngineHttpResponse(response, 403, 'text/plain; charset=utf-8', 'Forbidden');
    return;
  }

  const virtualBasePath = String(routeOptions.virtualBasePath || '').replace(/\/$/, '');
  if (virtualBasePath && (pathname === virtualBasePath || pathname.startsWith(`${virtualBasePath}/`))) {
    pathname = pathname.slice(virtualBasePath.length) || '/';
  }

  if (pathname === '/story360.js' && typeof routeOptions.story360Source === 'string') {
    sendEngineHttpResponse(response, 200, 'text/javascript; charset=utf-8', routeOptions.story360Source);
    return;
  }

  // Имитирует потерю обязательного runtime-файла без удаления настоящего файла из рабочего дерева.
  if (pathname === routeOptions.missingRuntimePath) {
    sendEngineHttpResponse(response, 404, 'text/plain; charset=utf-8', 'Not Found');
    return;
  }

  // Подменяет отдельный runtime-файл безопасной fixture для проверки загруженного, но неполного API.
  if (
    routeOptions.runtimeSourceOverrides &&
    Object.prototype.hasOwnProperty.call(routeOptions.runtimeSourceOverrides, pathname)
  ) {
    sendEngineHttpResponse(
      response,
      200,
      'text/javascript; charset=utf-8',
      String(routeOptions.runtimeSourceOverrides[pathname])
    );
    return;
  }

  if (blockedLocalRoutes.has(pathname)) {
    sendEngineHttpResponse(response, 404, 'text/plain; charset=utf-8', 'Not Found');
    return;
  }

  if (pathname === '/story.js' && typeof routeOptions.storySource === 'string') {
    sendEngineHttpResponse(response, 200, 'text/javascript; charset=utf-8', routeOptions.storySource);
    return;
  }

  const fixturePath = fixtureRoutes.get(pathname);
  const normalizedPath = pathname === '/' ? '/index.html' : pathname;
  const repositoryPath = path.resolve(repositoryRoot, `.${normalizedPath}`);
  const filePath = fixturePath || repositoryPath;
  if (!fixturePath && !isInsideRepository(filePath)) {
    sendEngineHttpResponse(response, 403, 'text/plain; charset=utf-8', 'Forbidden');
    return;
  }

  try {
    let body = await readFile(filePath);
    // Сохранённая изоляция проверяется явным выбором режима в копии index, без ослабления direct-контракта по умолчанию.
    if (routeOptions.storyLoadMode === 'worker' && normalizedPath === '/index.html') {
      body = Buffer.from(body.toString('utf8').replace('var STORY_SCRIPT_LOAD_MODE = "direct";', 'var STORY_SCRIPT_LOAD_MODE = "worker";'), 'utf8');
    }
    if (routeOptions.exposeLicenseVerifier && normalizedPath === '/engine/engine.js') {
      body = Buffer.from(exposeLicenseVerifierToE2e(body.toString('utf8')), 'utf8');
    }
    sendEngineHttpResponse(response, 200, getContentType(filePath), body);
  } catch (error) {
    const status = error && error.code === 'ENOENT' ? 404 : 500;
    sendEngineHttpResponse(response, status, 'text/plain; charset=utf-8', status === 404 ? 'Not Found' : 'Route Error');
  }
}

// Переключает содержимое тестового проекта; сервер обрабатывает тесты последовательно в одном Playwright worker.
async function installRepositoryRoutes(page, routeOptions = {}) {
  activeRouteOptions = { ...routeOptions };
  await page.unroute('**/*');
}

// Поднимает реальный HTTP-сервер до создания страниц, чтобы Worker Firefox загружал сценарий обычным сетевым путём.
test.beforeAll(async function startE2eHttpServer() {
  e2eHttpServer = createServer(function serveE2eRequest(request, response) {
    handleEngineHttpRequest(request, response).catch(function handleE2eServerError() {
      if (!response.headersSent) sendEngineHttpResponse(response, 500, 'text/plain; charset=utf-8', 'Route Error');
      else response.destroy();
    });
  });
  await new Promise(function waitForE2eServer(resolve, reject) {
    e2eHttpServer.once('error', reject);
    e2eHttpServer.listen(e2eServerPort, '127.0.0.1', resolve);
  });
});

// Закрывает тестовый HTTP-сервер после завершения проекта, чтобы локальный порт не оставался занятым.
test.afterAll(async function stopE2eHttpServer() {
  if (!e2eHttpServer) return;
  await new Promise(function waitForE2eServerClose(resolve) {
    e2eHttpServer.close(resolve);
  });
  e2eHttpServer = null;
});

// Собирает необработанные ошибки страницы, не считая ожидаемые сообщения об отсутствующих optional-файлах.
function collectPageErrors(page) {
  const errors = [];
  // Сохраняет текст ошибки после события pageerror для итоговой проверки сценария.
  function handlePageError(error) {
    errors.push(error && error.message ? error.message : String(error));
  }
  page.on('pageerror', handlePageError);
  return errors;
}

// Устанавливает ранний перехват console до загрузки index.html и сохраняет сериализованные аргументы для проверки утечек.
async function installConsoleCapture(page) {
  await page.addInitScript(function captureConsoleMessages() {
    window.__vnE2eConsoleMessages = [];
    ['log', 'info', 'warn', 'error', 'debug', 'trace'].forEach(function(method) {
      const original = console[method];
      console[method] = function captureConsoleCall(...args) {
        const text = args.map(function(value) {
          if (value === null || value === undefined) return String(value);
          if (typeof value === 'string') return value;
          if (typeof value === 'number' || typeof value === 'boolean') return String(value);
          try {
            return JSON.stringify(value);
          } catch (error) {
            return Object.prototype.toString.call(value);
          }
        }).join(' ');
        window.__vnE2eConsoleMessages.push({ method, text });
        return original.apply(console, args);
      };
    });
  });
}

// Возвращает накопленные браузером сообщения после завершения проверяемых действий.
async function readConsoleMessages(page) {
  return page.evaluate(function readCapturedConsoleMessages() {
    return Array.isArray(window.__vnE2eConsoleMessages)
      ? window.__vnE2eConsoleMessages.slice()
      : [];
  });
}

// Открывает реальный index.html и ждёт заданную реплику стандартной либо подменённой синтетической истории.
async function openStory(page, storyUrl = '/', routeOptions = {}) {
  await installRepositoryRoutes(page, routeOptions);
  await page.goto(storyUrl);
  await expect(page.locator('#textBox')).toHaveText(routeOptions.expectedText || 'Первый экран E2E');
}

// Учитывает защиту движка от двойного клика и переводит историю к следующему действию.
async function advanceDialog(page) {
  await page.waitForTimeout(350);
  await page.locator('#dialog').click();
}

// Открывает меню из первой сцены и выбирает пункт по видимой подписи.
async function chooseRoute(page, routeLabel) {
  await advanceDialog(page);
  const choices = page.locator('#choices');
  await expect(choices).toBeVisible();
  await choices.getByRole('button', { name: routeLabel }).click();
}

const pendingTransitionCases = [
  { name: 'вложенный if', actions: ['if true', 'if true', 'goto destination', 'end', 'set leaked = 1', '"Старая ветка"', 'end'] },
  { name: 'короткий if внутри блока', actions: ['if true', 'if true -> destination', 'set leaked = 1', '"Старая ветка"', 'end'] },
  { name: 'if внутри choice', choice: true, actions: ['menu', 'choice "Перейти"', 'if true', 'goto destination', 'end', 'set leaked = 1', '"Старое меню"', 'end'] },
  { name: 'короткое меню внутри if', choice: true, actions: ['if true', 'menu', '"Перейти" -> destination', 'set leaked = 1', '"Старая ветка"', 'end'] },
  { name: 'переход на ту же сцену', visits: 2, actions: ['set visits = visits + 1', 'if visits < 2', 'goto intro', 'set leaked = 1', '"Старая итерация"', 'end', 'goto destination'] }
];

for (const scenario of pendingTransitionCases) {
  // Проверяет видимый результат и побочные эффекты после перехода, включая оставшееся внешнее продолжение.
  test('исполнитель: переход очищает очередь — ' + scenario.name, async function({ page }) {
    const pageErrors = collectPageErrors(page);
    await installRepositoryRoutes(page, { storySource: createControlFlowStory([
      ...scenario.actions,
      'scene destination',
      '"Цель: {leaked}, посещений: {visits}"',
      '"Продолжение целевой сцены"'
    ]) });
    await page.goto('/');
    if (scenario.choice) await page.locator('#choices').getByRole('button', { name: 'Перейти' }).click();
    await expect(page.locator('#textBox')).toHaveText('Цель: 0, посещений: ' + (scenario.visits || 0));
    await advanceDialog(page);
    await expect(page.locator('#textBox')).toHaveText('Продолжение целевой сцены');
    expect(pageErrors).toEqual([]);
  });
}

for (const cycle of [
  { name: 'самопереход', actions: ['goto loop'] },
  { name: 'взаимные переходы', actions: ['goto second', 'scene second', 'goto loop'] }
]) {
  // Зависание должно стать устойчивой ошибкой с рабочим UI, прежним сохранением и возможностью перезапуска.
  test('исполнитель: ограничивает автоматический цикл — ' + cycle.name, async function({ page }) {
    const pageErrors = collectPageErrors(page);
    const storageKey = 'vn_engine_autosave_v1:project:control-flow-e2e';
    await openStory(page, '/', {
      storySource: createControlFlowStory(['"До цикла"', 'goto loop', 'scene loop', ...cycle.actions], true),
      expectedText: 'До цикла'
    });
    // Синхронный lifecycle-checkpoint позволяет проверить сохранение без ожидания debounce.
    const checkpoint = await page.evaluate(function saveCheckpoint(key) {
      window.dispatchEvent(new Event('beforeunload'));
      return localStorage.getItem(key);
    }, storageKey);
    expect(checkpoint).not.toBeNull();

    await advanceDialog(page);
    const errorText = page.locator('#textBox');
    await expect(errorText).toContainText('Превышен лимит 10000 автоматических действий');
    await expect(errorText).toContainText('loop:1 goto');
    const haltedText = await errorText.textContent();
    await page.locator('#btnSettings').click();
    await expect(page.locator('#settingsPanel')).toBeVisible();
    await page.locator('#btnCloseSettings').click();
    await advanceDialog(page);
    await expect(errorText).toHaveText(haltedText);
    // Имитирует уход со страницы: lifecycle-запись также обязана сохранить прежний checkpoint.
    const savedAfterError = await page.evaluate(function flushAfterHalt(key) {
      window.dispatchEvent(new Event('beforeunload'));
      return localStorage.getItem(key);
    }, storageKey);
    expect(savedAfterError).toBe(checkpoint);

    await page.locator('#btnRestart').click();
    await expect(errorText).toHaveText('До цикла');
    await advanceDialog(page);
    await expect(errorText).toContainText('Превышен лимит 10000 автоматических действий');
    await page.reload();
    await expect(errorText).toHaveText('До цикла');
    expect(pageErrors).toEqual([]);
  });
}

// Допустимый цикл с переменной завершает длинный проход, а реплика обновляет бюджет следующего прохода.
test('исполнитель: конечная цепочка и ожидание реплики сохраняют обычные циклы', async function({ page }) {
  const pageErrors = collectPageErrors(page);
  await openStory(page, '/', {
    storySource: createControlFlowStory([
      'set visits = 0', 'set rounds = rounds + 1', 'goto count',
      'scene count', 'set visits = visits + 1', 'if visits < 3000 -> count',
      '"Раунд {rounds}: {visits}"', 'goto intro'
    ]),
    expectedText: 'Раунд 1: 3000'
  });
  await advanceDialog(page);
  await expect(page.locator('#textBox')).toHaveText('Раунд 2: 3000');
  expect(pageErrors).toEqual([]);
});

// Открывает настоящий тестер и загружает в него синтетическую игру в обязательном строгом sandbox.
async function openGameTester(page, gamePath) {
  await installRepositoryRoutes(page);
  await page.goto('/tools/game-tester.html');
  await page.locator('#gameUrl').fill(gamePath);
  await page.locator('#gameId').fill('testGame');
  await page.locator('#workspaceTabInput').click();
  await page.locator('#loadGameBtn').click();

  const game = page.frameLocator('#gameFrame');
  await expect(game.locator('#status')).toHaveText('gameInit получен');
  return game;
}

// Открывает настоящий Scene360 Editor с тем же сетевым перехватом, что и остальные браузерные проверки.
async function openScene360Editor(page) {
  await installRepositoryRoutes(page);
  await page.goto('/tools/scene360-editor.html');
  await expect(page.locator('#assetPathInput')).toBeVisible();
}

// Проверяет загрузку настоящего интерфейса и применение title из синтетического сценария.
test('движок запускает историю в браузере без демо-ассетов', async function({ page }) {
  const pageErrors = collectPageErrors(page);

  await openStory(page);
  await expect(page.locator('#unsupportedBrowser')).toBeHidden();

  await expect(page).toHaveTitle('E2E-проверка движка');
  await expect(page.locator('#dialog')).toBeVisible();
  await expect(page.locator('#gameModal')).toHaveClass(/hidden/);
  expect(pageErrors).toEqual([]);
});

// Проверяет основной клавиатурный маршрут, доступные имена и возврат фокуса из служебных модалок.
test('accessibility: диалог, выборы и служебные панели доступны с клавиатуры', async function({ page }) {
  const pageErrors = collectPageErrors(page);
  await openStory(page);

  await expect(page.locator('#btnMute')).toHaveAttribute('aria-label', 'Звук');
  await expect(page.locator('#volume')).toHaveAttribute('aria-label', 'Громкость');
  await expect(page.locator('#btnSettings')).toHaveAttribute('aria-label', 'Информация');
  await expect(page.locator('#btnStats')).toHaveAttribute('aria-label', 'Статистика');
  await expect(page.locator('#btnRestart')).toHaveAttribute('aria-label', 'Перезапустить историю');

  const settingsButton = page.locator('#btnSettings');
  await settingsButton.focus();
  await page.keyboard.press('Enter');
  await expect(page.getByRole('dialog', { name: 'Информация' })).toBeVisible();
  await expect(page.locator('#btnCloseSettings')).toBeFocused();
  await page.keyboard.press('Enter');
  await expect(page.locator('#settingsPanel')).toBeHidden();
  await expect(settingsButton).toBeFocused();

  const statsButton = page.locator('#btnStats');
  await statsButton.focus();
  await page.keyboard.press('Enter');
  await expect(page.getByRole('dialog', { name: 'Статистика сценария' })).toBeVisible();
  await expect(page.locator('#btnCloseStats')).toBeFocused();
  await page.keyboard.press('Enter');
  await expect(page.locator('#statsPanel')).toBeHidden();
  await expect(statsButton).toBeFocused();

  const dialog = page.locator('#dialog');
  await dialog.focus();
  await page.keyboard.press('Enter');
  const choiceButtons = page.locator('.choiceBtn');
  await expect(choiceButtons).toHaveCount(2);
  await expect(choiceButtons.nth(0)).toBeFocused();
  await page.keyboard.press('Tab');
  await expect(choiceButtons.nth(1)).toBeFocused();
  await page.keyboard.press('Enter');
  await expect(page.locator('#textBox')).toHaveText('Выбрана правая ветка');
  await expect(dialog).toBeFocused();

  await page.waitForTimeout(350);
  await page.keyboard.press('Space');
  await expect(page.locator('#textBox')).toHaveText('Финал: right, результат: 0');
  expect(pageErrors).toEqual([]);
});

for (const mode of ['debug', 'release']) {
  // Проверяет авторское окно, ссылки, клавиатуру и неизменность реплик в обоих режимах движка.
  test('О проекте: текст, вкладки и возврат к истории в ' + mode, async function({ page, context }, testInfo) {
    const pageErrors = collectPageErrors(page);
    const english = mode === 'release';
    const infoTitle = english ? 'Information' : 'Информация';
    const projectTabTitle = english ? 'About project' : 'О проекте';
    const engineTabTitle = english ? 'About engine' : 'О движке';
    let documentRequests = 0;
    // Внешний документ остаётся синтетическим: тест не обращается к внешнему сайту.
    await context.route('https://example.org/**', async function fulfillExampleDocument(route) {
      if (route.request().isNavigationRequest()) documentRequests++;
      await route.fulfill({ contentType: 'text/html; charset=utf-8', body: '<title>Тестовая документация</title><p>Тестовый документ</p>' });
    });
    // Окно и автосохранение при запрете автора не должны обращаться к браузерному хранилищу.
    await page.addInitScript(function prohibitAboutStorageAccess() {
      window.__aboutStorageTouches = 0;
      Object.defineProperty(window, 'localStorage', {
        // Счётчик выявляет даже обращение, исключение из которого движок перехватил.
        get: function failAboutStorageAccess() {
          window.__aboutStorageTouches++;
          throw new Error('Обращение к localStorage запрещено в этом тесте');
        }
      });
    });
    const content = 'Тестовая организация[br]Адрес: Тестовый город, ул. Примерная, д. 1[br][br][Почта](mailto:info@example.org)[br][Документация проекта](https://example.org/docs?lang=ru#visitors)';
    await openStory(page, '/?aboutEnabled=false', {
      storySource: createAboutStorySource([
        'mode = ' + mode,
        'lang = ' + (english ? 'en' : 'ru'),
        'aboutEnabled = true',
        'aboutTitle = "О проекте #1"',
        'aboutText = "' + content + '" # комментарий'
      ]),
      expectedText: 'Реплика[br]без переноса'
    });
    const button = page.locator('#btnSettings');
    const panel = page.getByRole('dialog', { name: infoTitle, exact: true });
    const projectTab = page.getByRole('tab', { name: projectTabTitle, exact: true });
    const engineTab = page.getByRole('tab', { name: engineTabTitle, exact: true });
    const body = page.locator('#aboutBody');
    // Два режима покрывают телефон и компьютер без отдельного набора тестов расположения.
    await page.setViewportSize(mode === 'debug' ? { width: 320, height: 568 } : { width: 1280, height: 800 });
    await expect(button).toHaveAttribute('aria-label', infoTitle);
    await expect(button).toHaveAttribute('title', infoTitle);
    await expect(page.locator('#btnAbout')).toHaveCount(0);
    await expect(button).toBeInViewport({ ratio: 1 });
    await expect(page.locator('.topbar a')).toHaveCount(0);
    // Измеряет правый край последней кнопки относительно внутреннего края панели.
    const alignment = await page.locator('.topbar').evaluate(function measureTopbarAlignment(element) {
      const bar = element.getBoundingClientRect();
      const lastButton = element.querySelector('#btnRestart').getBoundingClientRect();
      return Math.abs(bar.right - parseFloat(getComputedStyle(element).paddingRight) - lastButton.right);
    });
    expect(alignment).toBeLessThanOrEqual(1);
    await page.screenshot({ path: testInfo.outputPath('about-toolbar.png') });
    await button.focus();
    await page.keyboard.press('Enter');
    await expect(panel).toBeVisible();
    await expect(projectTab).toHaveAttribute('aria-selected', 'true');
    await expect(engineTab).toHaveAttribute('aria-selected', 'false');
    await expect(body.getByRole('heading', { name: 'О проекте #1', exact: true })).toBeVisible();
    await expect(page.locator('#btnCloseSettings')).toBeFocused();
    await expect(page.locator('#settingsBody')).toBeHidden();
    // В content четыре маркера: один после названия, два перед почтой и один перед документацией.
    await expect(body.locator('br')).toHaveCount(4);
    await expect(body.getByRole('link', { name: 'Почта' })).toHaveAttribute('href', 'mailto:info@example.org');
    const documentLink = body.getByRole('link', { name: 'Документация проекта', exact: true });
    await expect(documentLink).toHaveAttribute('href', 'https://example.org/docs?lang=ru#visitors');
    await expect(documentLink).toHaveAttribute('target', '_blank');
    await expect(documentLink).toHaveAttribute('rel', 'noopener noreferrer');
    await page.screenshot({ path: testInfo.outputPath('about-document.png') });
    expect(documentRequests).toBe(0);
    await page.keyboard.press('Shift+Tab');
    await expect(documentLink).toBeFocused();
    await page.keyboard.press('Tab');
    await expect(page.locator('#btnCloseSettings')).toBeFocused();

    const popupPromise = page.waitForEvent('popup');
    await documentLink.click();
    const popup = await popupPromise;
    await expect(popup).toHaveTitle('Тестовая документация');
    await popup.close();
    expect(documentRequests).toBe(1);
    await expect(page.locator('#textBox')).toHaveText('Реплика[br]без переноса');
    await expect(panel).toBeVisible();
    await page.keyboard.press('Escape');
    await expect(panel).toBeHidden();
    await expect(button).toBeFocused();

    await button.click();
    await expect(projectTab).toHaveAttribute('aria-selected', 'true');
    await page.keyboard.press('Tab');
    await expect(projectTab).toBeFocused();
    await page.keyboard.press('ArrowRight');
    await expect(engineTab).toBeFocused();
    await expect(engineTab).toHaveAttribute('aria-selected', 'true');
    await expect(projectTab).toHaveAttribute('tabindex', '-1');
    await expect(body).toBeHidden();
    await expect(page.locator('#engineInfoPanel')).toBeVisible();
    await expect(page.locator('#settingsBody')).toHaveValue(/Engine:/);
    await page.screenshot({ path: testInfo.outputPath('info-engine.png') });
    await page.keyboard.press('Tab');
    await expect(page.locator('#settingsBody')).toBeFocused();
    await page.keyboard.press('Tab');
    await expect(page.locator('#btnCloseSettings')).toBeFocused();
    await page.keyboard.press('Tab');
    await page.keyboard.press('Home');
    await expect(projectTab).toBeFocused();
    await expect(body).toBeVisible();
    await page.keyboard.press('End');
    await expect(engineTab).toBeFocused();
    await page.keyboard.press('ArrowLeft');
    await expect(projectTab).toBeFocused();
    await engineTab.click();
    await expect(body).toBeHidden();
    await expect(page.locator('#textBox')).toHaveText('Реплика[br]без переноса');
    await page.keyboard.press('Escape');
    await expect(button).toBeFocused();
    await button.click();
    await expect(projectTab).toHaveAttribute('aria-selected', 'true');
    await page.locator('#btnCloseSettings').click();
    await advanceDialog(page);
    await expect(page.locator('#textBox')).toHaveText('Продолжение');
    // Читает только счётчик перехвата, не обращаясь к самому хранилищу.
    expect(await page.evaluate(function readAboutStorageTouches() { return window.__aboutStorageTouches; })).toBe(0);
    expect(pageErrors).toEqual([]);
  });
}

// Доказывает, что произвольная разметка и опасные URL не превращаются в исполняемые элементы.
test('О проекте: безопасный текст и прокрутка длинного документа', async function({ page }) {
  const pageErrors = collectPageErrors(page);
  const unsafeText = '<img src=x onerror=alert(1)>[br][JS](javascript:alert%281%29)[br][Data](data:text/html,test)[br][File](file:///tmp/test)[br][Relative](docs.html)[br][Credentials](https://user:secret@example.org/)[br]';
  const longText = unsafeText + ('Тестовая строка ' + 'x'.repeat(140) + '[br]').repeat(50) + '[Конец](https://example.org/docs)';
  await openStory(page, '/', {
    storySource: createAboutStorySource(['aboutEnabled=true', 'aboutText="' + longText + '"']),
    expectedText: 'Реплика[br]без переноса'
  });
  await page.locator('#btnSettings').click();
  const body = page.locator('#aboutBody');
  await expect(page.getByRole('dialog', { name: 'Информация', exact: true })).toBeVisible();
  await expect(body.getByRole('heading', { name: 'О проекте', exact: true })).toBeVisible();
  await expect(body.locator('img,script,iframe')).toHaveCount(0);
  await expect(body.locator('a')).toHaveCount(1);
  await expect(body).toContainText('<img src=x onerror=alert(1)>');
  await expect(body).toContainText('[JS](javascript:alert%281%29)');
  // Содержимое должно прокручиваться по вертикали и помещаться в ширину мобильного окна.
  const layout = await body.evaluate(function measureAboutBody(element) {
    return { width: element.clientWidth, scrollWidth: element.scrollWidth, height: element.clientHeight, scrollHeight: element.scrollHeight };
  });
  expect(layout.scrollHeight).toBeGreaterThan(layout.height);
  expect(layout.scrollWidth).toBeLessThanOrEqual(layout.width + 1);
  await page.keyboard.press('Shift+Tab');
  await expect(body.getByRole('link', { name: 'Конец' })).toBeFocused();
  await expect(body.getByRole('link', { name: 'Конец' })).toBeInViewport();
  await page.locator('#btnCloseSettings').click();
  await expect(page.locator('#btnSettings')).toBeFocused();
  expect(pageErrors).toEqual([]);
});

// Без авторского текста единая кнопка открывает сведения о движке без вкладок; URL не включает раздел за автора.
test('О проекте: без описания показывается движок без вкладок', async function({ page }) {
  for (const metaLines of [[], ['aboutEnabled=false', 'aboutText="Тест"'], ['aboutEnabled=true'], ['aboutEnabled=true', 'aboutText="[br] [br]"']]) {
    await openStory(page, '/?aboutEnabled=true', {
      storySource: createAboutStorySource(metaLines),
      expectedText: 'Реплика[br]без переноса'
    });
    await expect(page.locator('#btnSettings')).toBeVisible();
    await expect(page.locator('#btnAbout')).toHaveCount(0);
    await page.locator('#btnSettings').click();
    await expect(page.locator('#settingsPanel')).toBeVisible();
    await expect(page.locator('#settingsTabs')).toBeHidden();
    await expect(page.locator('#aboutBody')).toBeHidden();
    await expect(page.locator('#settingsBody')).toHaveValue(/Engine:/);
    await page.keyboard.press('Escape');
    await expect(page.locator('#btnSettings')).toBeFocused();
    await advanceDialog(page);
    await expect(page.locator('#textBox')).toHaveText('Продолжение');
  }
});

// Проверяет клавиатурное закрытие сюжетной игры и возврат в диалог после очистки iframe.
test('accessibility: мини-игра возвращает фокус после закрытия клавишей', async function({ page }) {
  const pageErrors = collectPageErrors(page);
  await openStory(page);

  const dialog = page.locator('#dialog');
  await dialog.focus();
  await page.keyboard.press('Enter');
  await expect(page.locator('.choiceBtn').nth(0)).toBeFocused();
  await page.keyboard.press('Enter');
  await expect(page.locator('#textBox')).toHaveText('Выбрана левая ветка');
  await expect(dialog).toBeFocused();

  await page.waitForTimeout(350);
  await page.keyboard.press('Enter');
  await expect(page.frameLocator('#gameFrame').locator('#status')).toHaveText('gameInit получен');
  await expect.poll(async function readFocusedElementId() {
    return page.evaluate(function readActiveElementId() {
      return document.activeElement ? document.activeElement.id : '';
    });
  }).toBe('gameFrame');

  await page.locator('#btnCloseGame').focus();
  await page.keyboard.press('Enter');
  await expect(page.locator('#gameModal')).toBeHidden();
  await expect(page.locator('#textBox')).toHaveText('Игра завершена: 0');
  await expect(dialog).toBeFocused();
  expect(pageErrors).toEqual([]);
});

// Проверяет компактное окно информации и полный набор технических версий только в статистике.
test('информация и статистика разделяют пользовательские и технические сведения', async function({ page }) {
  const pageErrors = collectPageErrors(page);

  await openStory(page);
  await page.locator('#btnSettings').click();
  await expect(page.locator('#settingsPanel')).toBeVisible();

  const debugInfo = await page.locator('#settingsBody').inputValue();
  expect(debugInfo).toContain('Engine: 0.0.0.0dev');
  expect(debugInfo).not.toContain('Story DSL:');
  expect(debugInfo).not.toContain('STORY360:');
  expect(debugInfo).not.toContain('Panorama CSS:');
  expect(debugInfo).not.toContain('Game protocol:');
  expect(debugInfo).not.toContain('Project ID:');
  expect(debugInfo).not.toContain('Runtime mode:');

  await page.locator('#btnCloseSettings').click();
  await expect(page.locator('#settingsPanel')).toBeHidden();
  await page.locator('#btnStats').click();
  await expect(page.locator('#statsPanel')).toBeVisible();
  await expect(page.locator('#statsBody')).toHaveValue(/Engine: 0\.0\.0\.0dev[\s\S]*Runtime mode: debug/);
  const statsInfo = await page.locator('#statsBody').inputValue();
  expect(statsInfo).toContain('Story DSL: 1');
  expect(statsInfo).toContain('STORY360: 1');
  expect(statsInfo).toContain('Panorama CSS: 1');
  expect(statsInfo).toContain('Game protocol: 2');
  expect(statsInfo).toContain('Project ID: e2e-story');
  expect(statsInfo).toContain('Runtime mode: debug');
  expect(pageErrors).toEqual([]);
});

// Проверяет настоящий bootstrap трёх медиаконтроллеров, fallback видео и общий UI громкости в Chromium и Firefox.
test('медиаконтроллеры сохраняют fallback и пропуск сюжетного видео', async function({ page }) {
  const pageErrors = collectPageErrors(page);
  await openStory(page, '/', {
    storySource: createMediaControllerStorySource(),
    expectedText: 'Фон после fallback'
  });

  await expect(page.locator('#textBox')).toHaveText('Фон после fallback');
  await expect(page.locator('#bgLayer')).toBeVisible();
  await expect(page.locator('#bgLayer')).toHaveAttribute('src', /bg-campus-hall\.jpg$/);

  await page.locator('#btnMute').click();
  await expect(page.locator('#btnMute .btn-icon')).toHaveText('🔊');

  await page.locator('#dialog').click();
  await expect(page.locator('#storyVideoOverlay')).toBeVisible();
  await expect(page.locator('#storyVideoPoster')).toBeVisible();
  await expect(page.locator('#storyVideoPoster')).toHaveAttribute('src', /bg-campus-cafe\.jpg$/);
  await page.waitForTimeout(500);
  await page.locator('#storyVideoOverlay').click({ position: { x: 20, y: 20 } });
  await expect(page.locator('#textBox')).toHaveText('После сюжетного видео');
  await expect(page.locator('#storyVideoOverlay')).toBeHidden();

  const moduleTypes = await page.evaluate(function readMediaControllerTypes() {
    return [
      typeof window.VN_AUDIO_CONTROLLER?.createAudioController,
      typeof window.VN_BACKGROUND_MEDIA_CONTROLLER?.createBackgroundMediaController,
      typeof window.VN_STORY_VIDEO_CONTROLLER?.createStoryVideoController
    ];
  });
  expect(moduleTypes).toEqual(['function', 'function', 'function']);
  expect(pageErrors).toEqual([]);
});

// Проверяет настоящий image-crossfade и отмену незавершённого поколения перехода через restart в обоих браузерах.
test('visual transition controller завершает crossfade и очищает его при restart', async function({ page }) {
  const pageErrors = collectPageErrors(page);
  await openStory(page, '/', {
    storySource: createVisualTransitionStorySource(),
    expectedText: 'Первый фон перехода'
  });

  await advanceDialog(page);
  const crossfadeLayer = page.locator('#novelWindow > img.visual-bg-crossfade');
  await expect(crossfadeLayer).toHaveClass(/is-visible/);
  await expect(page.locator('#textBox')).toHaveText('Второй фон перехода');
  await expect(page.locator('#bgLayer')).toHaveAttribute('src', /bg-campus-cafe\.jpg$/);
  await expect(crossfadeLayer).toHaveClass(/hidden/);

  await advanceDialog(page);
  await expect(crossfadeLayer).toHaveClass(/is-visible/);
  await page.locator('#btnRestart').click({ force: true });
  await expect(page.locator('#textBox')).toHaveText('Первый фон перехода');
  await expect(page.locator('#bgLayer')).toHaveAttribute('src', /bg-campus-hall\.jpg$/);
  await expect(crossfadeLayer).toHaveClass(/hidden/);

  const runtimeState = await page.evaluate(function readVisualTransitionRuntimeState() {
    return {
      moduleType: typeof window.VN_VISUAL_TRANSITION_CONTROLLER?.createVisualTransitionController,
      transparentElements: document.querySelectorAll('.visual-transition-transparent').length,
      visibleCrossfades: document.querySelectorAll('.visual-bg-crossfade.is-visible, .blur-bg-crossfade.is-visible').length
    };
  });
  expect(runtimeState).toEqual({ moduleType: 'function', transparentElements: 0, visibleCrossfades: 0 });
  expect(pageErrors).toEqual([]);
});

// Проверяет новый character controller через настоящий parser/runtime сразу в Chromium и Firefox.
test('character controller сохраняет позицию при смене, resize, hide и restart', async function({ page }) {
  const pageErrors = collectPageErrors(page);
  await openStory(page, '/', {
    storySource: createCharacterControllerStorySource(),
    expectedText: 'Первый персонаж'
  });

  const character = page.locator('#charLayer');
  const frame = page.locator('#charFrame');
  await expect(character).toBeVisible();
  await expect(character).toHaveAttribute('data-char-id', 'anna');
  await expect(character).toHaveAttribute('src', /ch-anna-neutral-smallresolution\.png$/);

  const beforeResize = await frame.boundingBox();
  await page.setViewportSize({ width: 900, height: 900 });
  await expect.poll(async function readResizedCharacterFrame() {
    return frame.boundingBox();
  }).not.toEqual(beforeResize);
  const resizedFrame = await frame.boundingBox();
  const novelWindow = await page.locator('#novelWindow').boundingBox();
  expect(resizedFrame.x + resizedFrame.width / 2).toBeLessThan(novelWindow.x + novelWindow.width / 2);

  await advanceDialog(page);
  await expect(page.locator('#textBox')).toHaveText('Второй персонаж');
  await expect(character).toBeVisible();
  await expect(character).toHaveAttribute('data-char-id', 'igor');
  await expect(character).toHaveAttribute('src', /ch-igor-smile-smallresolution\.png$/);
  const rightFrame = await frame.boundingBox();
  expect(rightFrame.x + rightFrame.width / 2).toBeGreaterThan(novelWindow.x + novelWindow.width / 2);

  await advanceDialog(page);
  await expect(page.locator('#textBox')).toHaveText('Персонаж скрыт');
  await expect(character).toBeHidden();

  await page.locator('#btnRestart').click({ force: true });
  await expect(page.locator('#textBox')).toHaveText('Первый персонаж');
  await expect(character).toHaveAttribute('data-char-id', 'anna');
  await expect(character).toBeVisible();
  expect(await page.evaluate(function readCharacterControllerType() {
    return typeof window.VN_CHARACTER_CONTROLLER?.createCharacterController;
  })).toBe('function');
  expect(pageErrors).toEqual([]);
});

// Проверяет общий DOM-поток: photo-viewer и переход по scene-метке после восстановления управления.
test('контроллеры 360-меток открывают фото и выполняют переход в сцену', async function({ page }) {
  const pageErrors = collectPageErrors(page);
  const panoramaPath = 'assets/360/photo-viewer-test-360.css';
  await installRepositoryRoutes(page, {
    storySource: createPhotoViewerStorySource(panoramaPath)
  });
  await page.route(`${e2eServerOrigin}/${panoramaPath}`, async function servePhotoViewerPanorama(route) {
    await route.fulfill({
      status: 200,
      contentType: 'text/css; charset=utf-8',
      body: createScene360CssPackSource()
    });
  });
  await page.goto('/');
  await expect(page.locator('.walk360Title')).toHaveText('Откройте фото E2E');
  await expect(page.locator('#bg360Layer')).toBeVisible();

  const photoMark = page.locator('.bg360-mark.kind-photo');
  const sceneMark = page.locator('.bg360-mark.kind-scene-target');
  const compass = page.locator('.bg360-compass');
  await expect(photoMark).toBeVisible();
  await expect(sceneMark).toBeVisible();
  await expect(compass).toBeVisible();
  // Проверяет реальные CSS-параметры через публичный API контроллера без доступа к закрытому runtime engine.js.
  const navigationVisualState = await page.evaluate(function inspectPanoramaNavigationVisualState() {
    const marksLayer = document.createElement('div');
    marksLayer.style.cssText = 'position:fixed;left:-10000px;top:0;width:800px;height:600px;';
    document.body.appendChild(marksLayer);
    const runtime = {
      active: true,
      scene: new window.THREE.Scene(),
      camera: new window.THREE.PerspectiveCamera(70, 4 / 3, 1, 1100)
    };
    const controller = window.VN_PANORAMA_MARKS_CONTROLLER.createPanoramaMarksController({
      window,
      document,
      marksLayer,
      novelWindow: marksLayer,
      panoramaRuntime: runtime,
      getComputedStyle: window.getComputedStyle
    });
    controller.state.marks = [{ id: 'route', kind: 'walk', x: 0.56, y: 0.5 }];
    controller.syncOriginCover();
    controller.syncNavArrows();

    const children = runtime.navArrowsGroup?.children || [];
    const routeRibbon = children.find(function(child) {
      return child?.userData?.bg360Billboard?.kind === 'ribbon';
    });
    const nadirRibbon = children.find(function(child) {
      return child?.userData?.bg360Billboard?.kind === 'nadirViewRibbon';
    });
    const signatureParts = String(runtime.originCoverSignature || '').split('|');
    const state = {
      ribbonHalfWidth: routeRibbon?.userData?.bg360Billboard?.halfW ?? null,
      ribbonOpacity: routeRibbon?.material?.opacity ?? null,
      nadirTailLength: nadirRibbon?.userData?.bg360Billboard?.tailLen ?? null,
      originCoverIsLarge: Number(signatureParts[2]) > 0.2
    };
    controller.dispose();
    marksLayer.remove();
    return state;
  });
  expect(navigationVisualState).toEqual({
    ribbonHalfWidth: 24,
    ribbonOpacity: 0.25,
    nadirTailLength: 100,
    originCoverIsLarge: true
  });
  await photoMark.click();
  await expect(page.locator('#bg360PhotoViewer')).toBeVisible();
  await expect(page.locator('#bg360PhotoImg')).toHaveAttribute('src', /bg-campus-hall\.jpg$/);
  await expect(page.locator('[data-bg360-photo-close]')).toBeFocused();

  await page.locator('[data-bg360-photo-next]').click();
  await expect(page.locator('#bg360PhotoImg')).toHaveAttribute('src', /bg-campus-cafe\.jpg$/);
  await page.keyboard.press('Escape');
  await expect(page.locator('#bg360PhotoViewer')).toBeHidden();
  await expect(photoMark).toBeVisible();
  await expect(photoMark).toBeFocused();
  await photoMark.click();
  await expect(page.locator('#bg360PhotoViewer')).toBeVisible();
  await expect(page.locator('[data-bg360-photo-close]')).toBeFocused();
  expect(await page.evaluate(function readPhotoViewerModuleType() {
    return [
      typeof window.VN_PANORAMA_PHOTO_VIEWER_CONTROLLER?.createPanoramaPhotoViewerController,
      typeof window.VN_PANORAMA_MARKS_CONTROLLER?.createPanoramaMarksController
    ];
  })).toEqual(['function', 'function']);
  await page.keyboard.press('Escape');
  await expect(photoMark).toBeFocused();
  await sceneMark.click();
  await expect(page.locator('#textBox')).toHaveText('После навигации E2E');
  expect(pageErrors).toEqual([]);
});

// Пользовательский story.js сохраняет прежний формат, но не получает DOM и localStorage основной страницы.
test('story.js выполняется в sandbox и передаёт наружу только STORY_TEXT', async function({ page }) {
  const maliciousSource = [
    'try { window.parent.document.body.dataset.storySandboxEscaped = "1"; } catch (error) {}',
    'try { window.parent.localStorage.setItem("story-sandbox-escaped", "1"); } catch (error) {}',
    createAutosaveProjectStorySource('sandbox-story', 'sandbox')
  ].join('\n');

  await openStory(page, '/', {
    storyLoadMode: 'worker',
    storySource: maliciousSource,
    expectedText: 'Начало sandbox'
  });

  const securityState = await page.evaluate(function readStorySandboxSecurityState() {
    return {
      escapedDataset: document.body.dataset.storySandboxEscaped || '',
      escapedStorage: localStorage.getItem('story-sandbox-escaped'),
      source: window.STORY_SCRIPT_SOURCE
    };
  });

  expect(securityState).toEqual({
    escapedDataset: '',
    escapedStorage: null,
    source: 'story.js'
  });
});

// Существующий, но повреждённый story.js должен дать ошибку проекта вместо незаметного запуска демо.
test('повреждённый story.js не подменяется story-example.js', async function({ page }) {
  await installRepositoryRoutes(page, {
    storySource: 'window.NOT_STORY_TEXT = "broken";'
  });
  await page.goto('/');

  await expect(page.locator('#textBox')).toHaveText(
    'Не удалось загрузить сценарий: файл story.js отсутствует или содержит ошибку.'
  );
  expect(await page.evaluate(function readBrokenStorySource() {
    return window.STORY_SCRIPT_SOURCE || '';
  })).toBe('');
});

// Недоступный обязательный модуль останавливает цепочку до engine.js и показывает пользователю точный путь.
test('bootstrap сообщает имя отсутствующего runtime-файла', async function({ page }) {
  await installRepositoryRoutes(page, {
    missingRuntimePath: '/engine/story-analysis.js'
  });
  await page.goto('/');

  await expect(page.locator('#textBox')).toHaveText(
    'Не удалось запустить движок: обязательный файл engine/story-analysis.js отсутствует или повреждён.'
  );
  expect(await page.evaluate(function readMissingRuntimeState() {
    return {
      analysisLoaded: Boolean(window.VN_STORY_ANALYSIS),
      graphLoaded: Boolean(window.VN_STORY_GRAPH),
      engineReady: window.VN_ENGINE_READY === true
    };
  })).toEqual({ analysisLoaded: false, graphLoaded: false, engineReady: false });
});

// Полученный файл без ожидаемых функций считается повреждённым и также не допускает частичный запуск движка.
test('bootstrap отклоняет runtime-файл без ожидаемого API', async function({ page }) {
  await installRepositoryRoutes(page, {
    runtimeSourceOverrides: {
      '/engine/story-analysis.js': 'window.VN_STORY_ANALYSIS = {};'
    }
  });
  await page.goto('/');

  await expect(page.locator('#textBox')).toHaveText(
    'Не удалось запустить движок: обязательный файл engine/story-analysis.js отсутствует или повреждён.'
  );
  expect(await page.evaluate(function readInvalidRuntimeState() {
    return {
      analysisExported: Boolean(window.VN_STORY_ANALYSIS),
      graphLoaded: Boolean(window.VN_STORY_GRAPH),
      engineReady: window.VN_ENGINE_READY === true
    };
  })).toEqual({ analysisExported: true, graphLoaded: false, engineReady: false });
});

// Корневая карта 360 проходит отдельный sandbox и становится объектом без пользовательского прототипа.
test('story360.js выполняется отдельно и передаёт проверенную карту пространств', async function({ page }) {
  const story360Source = [
    'try { window.parent.document.body.dataset.story360SandboxEscaped = "1"; } catch (error) {}',
    'window.STORY360 = {',
    '  version: 1,',
    '  spaces: {',
    '    sandboxSpace: {',
    '      panoramas: { P1: { file: "assets/360/sandbox/P1-360.css", marks: [] } }',
    '    }',
    '  }',
    '};'
  ].join('\n');

  await openStory(page, '/', { storyLoadMode: 'worker', story360Source });

  const securityState = await page.evaluate(function readStory360SandboxSecurityState() {
    return {
      escapedDataset: document.body.dataset.story360SandboxEscaped || '',
      source: window.STORY360_SCRIPT_SOURCE,
      hasPanorama: Boolean(
        window.STORY360 &&
        window.STORY360.spaces &&
        window.STORY360.spaces.sandboxSpace &&
        window.STORY360.spaces.sandboxSpace.panoramas.P1
      ),
      spacesHaveNullPrototype: Object.getPrototypeOf(window.STORY360.spaces) === null
    };
  });

  expect(securityState).toEqual({
    escapedDataset: '',
    source: 'story360.js',
    hasPanorama: true,
    spacesHaveNullPrototype: true
  });
});

// Опасный ключ в optional-карте отклоняется, но обычная история продолжает запускаться.
test('небезопасный story360.js отключается без остановки обычных сцен', async function({ page }) {
  const unsafeStory360Source = [
    'window.STORY360 = JSON.parse(',
    '  \'{"version":1,"spaces":{"__proto__":{"panoramas":{}}}}\'',
    ');'
  ].join('\n');

  await openStory(page, '/', { story360Source: unsafeStory360Source });

  expect(await page.evaluate(function readRejectedStory360State() {
    return {
      hasStory360: Boolean(window.STORY360),
      source: window.STORY360_SCRIPT_SOURCE || ''
    };
  })).toEqual({ hasStory360: false, source: '' });
});

// Проверяет главный автономный контракт: без story.js и story360.js пример запускается напрямую через file://.
test('bootstrap сохраняет fallback на story-example.js через file://', async function({ page }) {
  // Рабочий авторский story.js является допустимым локальным файлом и делает сценарий «файл отсутствует» невоспроизводимым.
  test.skip(existsSync(path.join(repositoryRoot, 'story.js')), 'В рабочей копии присутствует пользовательский story.js.');
  const indexUrl = pathToFileURL(path.join(repositoryRoot, 'index.html')).href;
  await page.goto(indexUrl);

  await expect.poll(function readLoadedStorySource() {
    return page.evaluate(function readStorySourceInPage() {
      return window.STORY_SCRIPT_SOURCE || '';
    });
  }).toBe('story-example.js');
  await expect(page).toHaveTitle('Вуз: демо-новелла с выбором');
});

// HTML-подобные данные истории остаются текстом, а очищенный SVG не содержит активных узлов, событий и внешних URL.
test('Mermaid-граф очищает пользовательский HTML перед вставкой в DOM', async function({ page }) {
  const pageErrors = collectPageErrors(page);
  await openStory(page, '/', {
    storySource: createGraphSecurityStorySource(),
    expectedText: 'Граф безопасности'
  });

  await page.locator('#btnStats').click();
  await page.locator('#btnShowFullGraph').click();
  await expect(page.locator('#mermaidGraph svg')).toBeVisible();

  const securityState = await page.evaluate(function inspectSanitizedMermaidGraph() {
    var host = document.getElementById('mermaidGraph');
    return {
      titleXss: document.body.dataset.graphTitleXss || '',
      cardXss: document.body.dataset.graphCardXss || '',
      descriptionXss: document.body.dataset.graphDescriptionXss || '',
      activeGraphNodes: host.querySelectorAll('script,iframe,object,embed,a,[onload],[onerror],[srcdoc]').length,
      externalGraphUrls: Array.from(host.querySelectorAll('[href],[src],[srcset]')).filter(function(element) {
        return /^(?:javascript:|https?:)/i.test(element.getAttribute('href') || element.getAttribute('src') || element.getAttribute('srcset') || '');
      }).length
    };
  });

  expect(securityState).toEqual({
    titleXss: '',
    cardXss: '',
    descriptionXss: '',
    activeGraphNodes: 0,
    externalGraphUrls: 0
  });
  expect(pageErrors).toEqual([]);
});

// Итоговая полоса считает только штатно гидратируемые img и остаётся видимой после завершения всех загрузок.
test('граф показывает общий прогресс обычных изображений и CSS-панорам', async function({ page }) {
  const paths = {
    background: 'assets/__e2e__/graph-progress-bg.png',
    character: 'assets/__e2e__/graph-progress-char.png',
    cover: 'assets/__e2e__/graph-progress-cover.png',
    panorama: 'assets/360/graph-progress-360.css'
  };
  const rasterPaths = [paths.background, paths.character, paths.cover];

  await installRepositoryRoutes(page, {
    storySource: createGraphImageProgressStorySource(paths),
    expectedText: 'Прогресс изображений графа E2E'
  });
  for (const rasterPath of rasterPaths) {
    await page.route(`${e2eServerOrigin}/${rasterPath}`, async function serveGraphImage(route) {
      await new Promise(function(resolve) { setTimeout(resolve, 180); });
      await route.fulfill({
        status: 200,
        contentType: 'image/png',
        body: Buffer.from(tinyPanoramaDataUrl.split(',')[1], 'base64')
      });
    });
  }
  await page.route(`${e2eServerOrigin}/${paths.panorama}`, async function serveGraphPanorama(route) {
    if (route.request().method() === 'HEAD') {
      await route.fulfill({ status: 200, contentType: 'text/css; charset=utf-8', body: '' });
      return;
    }
    // Задержка CSS дольше Mermaid-render гарантирует наблюдаемую фазу загрузки после регистрации безопасного img.
    await new Promise(function(resolve) { setTimeout(resolve, 3000); });
    await route.fulfill({
      status: 200,
      contentType: 'text/css; charset=utf-8',
      body: createScene360CssPackSource('normal')
    });
  });

  await page.goto('/');
  await expect(page.locator('#textBox')).toHaveText('Прогресс изображений графа E2E');
  await page.locator('#btnStats').click();
  await page.locator('#btnShowResourcesGraph').click();

  await expect(page.locator('#graphLoadProgress')).toBeVisible();
  await expect(page.locator('#graphLoadProgressText')).toHaveText('Graph images loaded');

  const progressState = await page.evaluate(function readGraphImageProgress() {
    var host = document.getElementById('mermaidGraph');
    var bar = document.getElementById('graphLoadProgressBar');
    var progress = document.getElementById('graphLoadProgress');
    return {
      expectedImages: host.querySelectorAll('img[data-vnv-story-img], img.bg360-graph-thumbnail[data-bg360-src]').length,
      max: Number(bar.max),
      value: Number(bar.value),
      label: document.getElementById('graphLoadProgressLabel').textContent || '',
      text: document.getElementById('graphLoadProgressText').textContent || '',
      className: progress.className || ''
    };
  });

  expect(progressState.expectedImages).toBeGreaterThanOrEqual(4);
  expect(progressState.max).toBe(progressState.expectedImages);
  expect(progressState.value).toBe(progressState.expectedImages);
  expect(progressState.label).toContain(`${progressState.expectedImages} / ${progressState.expectedImages}`);
  expect(progressState.label).not.toContain('errors:');
  expect(progressState.text).toBe('Graph images loaded');
  expect(progressState.className).toContain('is-complete');
  expect(progressState.className).not.toContain('has-errors');

  await page.locator('#btnShowText').click();
  await expect(page.locator('#graphLoadProgress')).toBeHidden();
});

// CSS-панорамы полностью загружаются и декодируются отдельно от отсутствующих обычных файлов.
test('статистика отдельно проверяет обычные изображения и CSS-панорамы', async function({ page }) {
  const foundPanoramaPath = 'assets/360/stats-found-360.css';
  const missingPanoramaPath = 'assets/360/stats-missing-360.css';
  const missingImagePath = 'assets/characters/stats-missing.png';
  let foundHeadRequests = 0;
  let foundGetRequests = 0;
  let missingHeadRequests = 0;

  await installRepositoryRoutes(page, {
    storySource: createPanoramaStatisticsStorySource(foundPanoramaPath, missingImagePath),
    story360Source: createScene360StorySource(missingPanoramaPath),
    expectedText: 'Статистика панорам E2E'
  });
  await page.route(`${e2eServerOrigin}/${foundPanoramaPath}`, async function serveFoundPanoramaHead(route) {
    if (route.request().method() === 'HEAD') {
      foundHeadRequests++;
      await route.fulfill({ status: 200, contentType: 'text/css; charset=utf-8', body: '' });
      return;
    }
    foundGetRequests++;
    await new Promise(function(resolve) { setTimeout(resolve, 150); });
    await route.fulfill({
      status: 200,
      contentType: 'text/css; charset=utf-8',
      body: createScene360CssPackSource('normal')
    });
  });
  await page.route(`${e2eServerOrigin}/${missingPanoramaPath}`, async function rejectMissingPanoramaHead(route) {
    if (route.request().method() === 'HEAD') missingHeadRequests++;
    await route.fulfill({ status: 404, contentType: 'text/css; charset=utf-8', body: '' });
  });
  await page.goto('/');
  await expect(page.locator('#textBox')).toHaveText('Статистика панорам E2E');

  await page.locator('#btnStats').click();
  await expect(page.locator('#statsLoadProgress')).toBeVisible();
  await expect(page.locator('#statsBody')).toHaveValue(/=== 360° PANORAMA PACKAGES ===/);
  await expect(page.locator('#statsBody')).toHaveValue(/CSS package and image were fully validated and decoded/);
  await expect(page.locator('#statsLoadProgress')).toBeHidden();

  const statsText = await page.locator('#statsBody').inputValue();
  const fileCheckText = statsText.slice(
    statsText.indexOf('=== FILE CHECK ==='),
    statsText.indexOf('=== 360° PANORAMA PACKAGES ===')
  );
  const panoramaText = statsText.slice(
    statsText.indexOf('=== 360° PANORAMA PACKAGES ==='),
    statsText.indexOf('=== FILE STATISTICS ===')
  );

  expect(fileCheckText).toContain(missingImagePath);
  expect(fileCheckText).not.toContain(foundPanoramaPath);
  expect(fileCheckText).not.toContain(missingPanoramaPath);
  expect(panoramaText).toContain(`✅ ${foundPanoramaPath}`);
  expect(panoramaText).toContain('CSS package and image were fully validated and decoded.');
  expect(panoramaText).toContain('Image: 1x1; image/png;');
  expect(panoramaText).toContain('CSS data:');
  expect(panoramaText).toContain(`❌ ${missingPanoramaPath}`);
  expect(panoramaText).toContain('The server returned HTTP 404.');
  expect(panoramaText).toContain('background: statsPano');
  expect(panoramaText).toContain('story360: testSpace.start');
  expect(statsText).toMatch(/❌ FILES\s+✅ IMAGES\s+❌ PANORAMAS/);
  expect(foundHeadRequests).toBe(1);
  expect(foundGetRequests).toBe(1);
  expect(missingHeadRequests).toBe(1);
});

// Закрытие панели не отменяет ограниченный пул: desktop обрабатывает до четырёх пакетов, а повторное открытие читает кеш.
test('фоновая проверка CSS-панорам продолжается после закрытия статистики', async function({ page }) {
  const panoramaPaths = [
    'assets/360/stats-queue-a-360.css',
    'assets/360/stats-queue-b-360.css',
    'assets/360/stats-queue-c-360.css',
    'assets/360/stats-queue-d-360.css',
    'assets/360/stats-queue-e-360.css',
    'assets/360/stats-queue-f-360.css'
  ];
  let activeGetRequests = 0;
  let maxActiveGetRequests = 0;
  let completedGetRequests = 0;

  await installRepositoryRoutes(page, {
    storySource: createPanoramaQueueStorySource(panoramaPaths),
    expectedText: 'Фоновая проверка панорам E2E'
  });
  for (const panoramaPath of panoramaPaths) {
    await page.route(`${e2eServerOrigin}/${panoramaPath}`, async function serveQueuedPanorama(route) {
      if (route.request().method() === 'HEAD') {
        await route.fulfill({ status: 200, contentType: 'text/css; charset=utf-8', body: '' });
        return;
      }
      activeGetRequests++;
      maxActiveGetRequests = Math.max(maxActiveGetRequests, activeGetRequests);
      await new Promise(function(resolve) { setTimeout(resolve, 120); });
      await route.fulfill({
        status: 200,
        contentType: 'text/css; charset=utf-8',
        body: createScene360CssPackSource('normal')
      });
      activeGetRequests--;
      completedGetRequests++;
    });
  }

  await page.goto('/');
  await expect(page.locator('#textBox')).toHaveText('Фоновая проверка панорам E2E');
  await page.locator('#btnStats').click();
  await expect(page.locator('#statsLoadProgress')).toBeVisible();
  await page.locator('#btnCloseStats').click();
  await expect(page.locator('#statsPanel')).toBeHidden();
  await expect.poll(function readCompletedPanoramaRequests() {
    return completedGetRequests;
  }).toBe(panoramaPaths.length);

  expect(maxActiveGetRequests).toBe(4);
  await page.locator('#btnStats').click();
  await expect(page.locator('#statsLoadProgress')).toBeHidden();
  await expect(page.locator('#statsBody')).toHaveValue(/Packages: 6; loaded: 0; verified: 6; checking: 0; missing: 0; invalid: 0\./);
});

// Выбирает mobile CSS-вариант и никогда не запрашивает одноимённый исполняемый JS.
test('движок загружает только mobile CSS-пакет 360', async function({ page }) {
  const pageErrors = collectPageErrors(page);
  const sourcePath = 'assets/360/runtime-priority-360.css';
  const cssPath = 'assets/360/runtime-priority-360-mobile.css';
  const jsPath = 'assets/360/runtime-priority-360-mobile.js';
  let cssRequestCount = 0;
  let jsRequestCount = 0;
  await installRepositoryRoutes(page, {
    storySource: createBg360RuntimeStorySource(sourcePath, 'mobile')
  });
  await page.route(`${e2eServerOrigin}/${cssPath}`, async function serveRuntimeCssPanorama(route) {
    cssRequestCount++;
    await route.fulfill({
      status: 200,
      contentType: 'text/css; charset=utf-8',
      body: createScene360CssPackSource('mobile')
    });
  });
  await page.route(`${e2eServerOrigin}/${jsPath}`, async function rejectUnexpectedRuntimeJs(route) {
    jsRequestCount++;
    await route.fulfill({ status: 500, contentType: 'text/plain', body: 'JS must not be requested' });
  });
  await page.goto('/');

  await expect(page.locator('#textBox')).toHaveText('Панорама CSS E2E');
  await expect(page.locator('#bg360Layer')).not.toHaveClass(/hidden/);
  await expect(page.locator('iframe[data-bg360-css-pack-loader]')).toHaveCount(0);
  expect(cssRequestCount).toBeGreaterThanOrEqual(1);
  expect(jsRequestCount).toBe(0);
  expect(await page.locator('body').evaluate(function(body) {
    return {
      display: getComputedStyle(body).display,
      injectedValue: getComputedStyle(body).getPropertyValue('--scene360-css-injection').trim()
    };
  })).toEqual({ display: 'block', injectedValue: '' });
  expect(pageErrors).toEqual([]);
});

// Пакет с @import отклоняется без запроса импорта и без попытки исполнить одноимённый JS.
test('движок блокирует CSS @import панорамы без JS-фолбэка', async function({ page }) {
  const pageErrors = collectPageErrors(page);
  const sourcePath = 'assets/360/runtime-import-360.css';
  const cssPath = 'assets/360/runtime-import-360.css';
  const jsPath = 'assets/360/runtime-import-360.js';
  const blockedImportPath = '/__e2e__/runtime-imported-style.css';
  let cssRequestCount = 0;
  let jsRequestCount = 0;
  let importRequestCount = 0;
  await installRepositoryRoutes(page, {
    storySource: createBg360RuntimeStorySource(sourcePath, 'normal')
  });
  await page.route(`${e2eServerOrigin}/${cssPath}`, async function serveRuntimeCssWithImport(route) {
    cssRequestCount++;
    await route.fulfill({
      status: 200,
      contentType: 'text/css; charset=utf-8',
      body: createScene360CssPackSource('normal', blockedImportPath)
    });
  });
  await page.route(`${e2eServerOrigin}${blockedImportPath}`, async function rejectRuntimeCssImport(route) {
    importRequestCount++;
    await route.fulfill({ status: 200, contentType: 'text/css; charset=utf-8', body: '#vn360-pack { --vn360-import-ran: "1"; }' });
  });
  await page.route(`${e2eServerOrigin}/${jsPath}`, async function serveRuntimeImportFallback(route) {
    jsRequestCount++;
    await route.fulfill({
      status: 200,
      contentType: 'text/javascript; charset=utf-8',
      body: createScene360PackSource('runtimeImportFallbackExecuted')
    });
  });
  await page.goto('/');

  await expect(page.locator('#textBox')).toHaveText('Панорама CSS E2E');
  await expect(page.locator('#bg360Layer')).toHaveClass(/hidden/);
  await expect(page.locator('body')).not.toHaveAttribute('data-runtime-import-fallback-executed', '1');
  expect(cssRequestCount).toBeGreaterThanOrEqual(1);
  expect(jsRequestCount).toBe(0);
  expect(importRequestCount).toBe(0);
  expect(pageErrors).toEqual([]);
});

// Отсутствующий CSS не запускает одноимённый JS и оставляет 360-слой выключенным.
test('движок не использует JS-пакет 360 после ошибки CSS', async function({ page }) {
  const pageErrors = collectPageErrors(page);
  const sourcePath = 'assets/360/runtime-fallback-360.css';
  const cssPath = 'assets/360/runtime-fallback-360.css';
  const jsPath = 'assets/360/runtime-fallback-360.js';
  let cssRequestCount = 0;
  let jsRequestCount = 0;
  await installRepositoryRoutes(page, {
    storySource: createBg360RuntimeStorySource(sourcePath, 'normal')
  });
  await page.route(`${e2eServerOrigin}/${cssPath}`, async function rejectMissingRuntimeCss(route) {
    cssRequestCount++;
    await route.fulfill({ status: 404, contentType: 'text/css; charset=utf-8', body: '' });
  });
  await page.route(`${e2eServerOrigin}/${jsPath}`, async function serveRuntimeLegacyJs(route) {
    jsRequestCount++;
    await route.fulfill({
      status: 200,
      contentType: 'text/javascript; charset=utf-8',
      body: createScene360PackSource('runtimeLegacyFallbackExecuted')
    });
  });
  await page.goto('/');

  await expect(page.locator('#textBox')).toHaveText('Панорама CSS E2E');
  await expect(page.locator('body')).not.toHaveAttribute('data-runtime-legacy-fallback-executed', '1');
  await expect(page.locator('#bg360Layer')).toHaveClass(/hidden/);
  expect(cssRequestCount).toBeGreaterThanOrEqual(1);
  expect(jsRequestCount).toBe(0);
  expect(pageErrors).toEqual([]);
});

// Проверяет нативный RSA-PSS путь в настоящем браузере и запрещает незаметный переход на jsrsasign.
test('браузер проверяет подпись лицензии через WebCrypto', async function({ page }) {
  const pageErrors = collectPageErrors(page);
  await openStory(page, `${e2eLocalhostOrigin}/`, { exposeLicenseVerifier: true });

  // Генерирует только временную браузерную пару и вызывает настоящий проверяющий код движка.
  const isValid = await page.evaluate(async function verifyBrowserLicenseSignature() {
    const keyPair = await crypto.subtle.generateKey({
      name: 'RSA-PSS',
      modulusLength: 2048,
      publicExponent: new Uint8Array([1, 0, 1]),
      hash: 'SHA-256'
    }, true, ['sign', 'verify']);
    const publicKeyBytes = new Uint8Array(await crypto.subtle.exportKey('spki', keyPair.publicKey));
    let publicKeyBinary = '';
    for (let index = 0; index < publicKeyBytes.length; index++) {
      publicKeyBinary += String.fromCharCode(publicKeyBytes[index]);
    }
    const publicKeyBase64 = btoa(publicKeyBinary).match(/.{1,64}/g).join('\n');
    window.VN_LICENSE_PUBLIC_KEY_PEM = [
      '-----BEGIN PUBLIC KEY-----',
      publicKeyBase64,
      '-----END PUBLIC KEY-----'
    ].join('\n');

    const dataToVerify = 'VNV1.synthetic-browser-payload';
    const signedData = new TextEncoder().encode(dataToVerify);
    const signatureBytes = new Uint8Array(await crypto.subtle.sign(
      { name: 'RSA-PSS', saltLength: 32 },
      keyPair.privateKey,
      signedData
    ));

    // Делает резервный путь заведомо нерабочим: true возможен только после успешного WebCrypto.
    window.KJUR.crypto.Signature = function rejectUnexpectedFallback() {
      throw new Error('jsrsasign fallback must not run when browser WebCrypto succeeds.');
    };
    return window.__VN_E2E_VERIFY_LICENSE(dataToVerify, signatureBytes, window.VN_LICENSE_PUBLIC_KEY_PEM);
  });

  expect(isValid).toBe(true);
  expect(pageErrors).toEqual([]);
});

// Проверяет, что публичный режим не пишет информационные runtime-сообщения при загрузке и переходе Next.
test('release-режим оставляет консоль без обычной диагностики', async function({ page }) {
  const pageErrors = collectPageErrors(page);
  await installConsoleCapture(page);

  await openStory(page, '/?mode=release');
  await advanceDialog(page);
  await page.waitForTimeout(450);

  const messages = await readConsoleMessages(page);
  const informational = messages.filter(function(message) {
    return ['log', 'info', 'debug', 'trace'].includes(message.method);
  });
  expect(informational).toEqual([]);
  expect(pageErrors).toEqual([]);
});

// Подтверждает документированное имя Debug и независимое включение только выбранной категории.
test('параметр Debug включает выбранную категорию в release', async function({ page }) {
  const pageErrors = collectPageErrors(page);
  await installConsoleCapture(page);

  await openStory(page, '/?mode=release&Debug=autosave');
  await page.waitForTimeout(450);

  const messages = await readConsoleMessages(page);
  expect(messages.some(function(message) {
    return message.text.includes('[AUTOSAVE_DEBUG]');
  })).toBe(true);
  expect(messages.some(function(message) {
    return message.text.includes('[VN DEBUG]');
  })).toBe(false);
  expect(pageErrors).toEqual([]);
});

// Проверяет регистронезависимое чтение ключа Debug без изменения документированной записи с заглавной буквы.
test('ключ Debug читается без учёта регистра', async function({ page }) {
  const pageErrors = collectPageErrors(page);
  await installConsoleCapture(page);

  await openStory(page, '/?mode=release&dEbUg=runtime');

  const messages = await readConsoleMessages(page);
  expect(messages.some(function(message) {
    return message.text.includes('[VN DEBUG]');
  })).toBe(true);
  expect(pageErrors).toEqual([]);
});

// Подтверждает реальное подключение единственного URL-parser и отсутствие верхнего лимита отступов.
test('URL принимает большие отступы без учёта регистра', async function({ page }) {
  const pageErrors = collectPageErrors(page);

  await openStory(page, '/?TOPSPACING=5000&bottomSpacing=8000');

  const spacing = await page.evaluate(function readAppliedSpacing() {
    return {
      top: document.documentElement.style.getPropertyValue('--topSpacing'),
      bottom: document.documentElement.style.getPropertyValue('--bottomSpacing'),
      manualMode: document.getElementById('novelWindow').classList.contains('window-manual')
    };
  });
  expect(spacing).toEqual({ top: '5000px', bottom: '8000px', manualMode: true });
  expect(pageErrors).toEqual([]);
});

// Проверяет DOM-кнопки menu, изменение переменной и переход между сценами.
test('выбор в меню переводит историю в нужную ветку', async function({ page }) {
  const pageErrors = collectPageErrors(page);

  await openStory(page);
  await chooseRoute(page, 'Правая ветка');

  await expect(page.locator('#textBox')).toHaveText('Выбрана правая ветка');
  await advanceDialog(page);
  await expect(page.locator('#textBox')).toHaveText('Финал: right, результат: 0');
  expect(pageErrors).toEqual([]);
});

// Проверяет запись localStorage и восстановление текущей реплики после перезагрузки страницы.
test('автосохранение восстанавливает прогресс после reload', async function({ page }) {
  const pageErrors = collectPageErrors(page);

  await openStory(page);
  await chooseRoute(page, 'Правая ветка');
  await expect(page.locator('#textBox')).toHaveText('Выбрана правая ветка');

  // Ждёт отложенную запись изолированного autosave-слота синтетического проекта.
  await page.waitForFunction(function hasAutosave() {
    return window.localStorage.getItem('vn_engine_autosave_v1:project:e2e-story') !== null;
  });
  await page.reload();

  await expect(page.locator('#textBox')).toHaveText('Выбрана правая ветка');
  expect(pageErrors).toEqual([]);
});

for (const storageCase of [
  { name: 'autosave=false', enabled: false, url: '/' },
  { name: 'autosave=false и nosave=false', enabled: false, url: '/?nosave=false' },
  { name: 'autosave=false в novel', enabled: false, url: '/?novel=intro&nosave=false' },
  { name: 'nosave=true', enabled: true, url: '/?nosave=true' }
]) {
  // Проверяет отсутствие даже чтения свойства localStorage при старте, переходе, перезапуске и завершении страницы.
  test(`${storageCase.name} полностью отключает обращения к localStorage`, async function({ page }) {
    const pageErrors = collectPageErrors(page);
    const storedEntries = {
      vn_engine_autosave_v1: '{legacy:preserve}',
      'vn_engine_autosave_v1:project:storage-disabled': '{project:preserve}',
      'vn_engine_autosave_v1:project:storage-disabled:novel:intro': '{novel:preserve}',
      unrelated: 'preserve'
    };

    // Подготавливает старые слоты до запуска приложения и считает получение Storage, включая безрезультатное удаление.
    await page.addInitScript(function installStorageAccessCounter(entries) {
      if (window.top !== window) return;
      const storage = window.localStorage;
      for (const [key, value] of Object.entries(entries)) storage.setItem(key, value);
      let accessCount = 0;
      Object.defineProperty(window, 'localStorage', {
        configurable: true,
        // Возвращает настоящий Storage, чтобы ошибочный доступ был виден и не скрывался обработкой исключений.
        get() {
          accessCount += 1;
          return storage;
        }
      });
      // Читает состояние через исходную ссылку, не добавляя обращения самого теста в счётчик приложения.
      window.__vnE2eReadStorageAudit = function readStorageAudit() {
        const currentEntries = {};
        for (let index = 0; index < storage.length; index++) {
          const key = storage.key(index);
          currentEntries[key] = storage.getItem(key);
        }
        return { accessCount, entries: currentEntries };
      };
    }, storedEntries);

    const storySource = createAutosaveProjectStorySource('storage-disabled', 'без сохранения')
      .replace('autosave = true', `autosave = ${storageCase.enabled}`);
    await openStory(page, storageCase.url, { storySource, expectedText: 'Начало без сохранения' });
    await advanceDialog(page);
    await expect(page.locator('#textBox')).toHaveText('Прогресс без сохранения');
    // Перекрывает обычные две секунды debounce, чтобы ошибочно запланированная запись успела проявиться.
    await page.waitForTimeout(2200);
    await page.locator('#btnRestart').click();
    await expect(page.locator('#textBox')).toHaveText('Начало без сохранения');

    // Проверяет финальные flush-обработчики до выгрузки, пока счётчик и слоты ещё доступны для проверки.
    const afterRestart = await page.evaluate(function finishStorageDisabledPage() {
      document.dispatchEvent(new Event('visibilitychange'));
      window.dispatchEvent(new Event('beforeunload'));
      window.dispatchEvent(new PageTransitionEvent('pagehide', { persisted: false }));
      return window.__vnE2eReadStorageAudit();
    });
    expect(afterRestart).toEqual({ accessCount: 0, entries: storedEntries });

    await page.reload();
    await expect(page.locator('#textBox')).toHaveText('Начало без сохранения');
    // Повторный запуск также не читает прежние, намеренно повреждённые сохранения и не пытается их очистить.
    expect(await page.evaluate(function readReloadedStorageAudit() {
      return window.__vnE2eReadStorageAudit();
    })).toEqual({ accessCount: 0, entries: storedEntries });
    expect(pageErrors).toEqual([]);
  });
}

// Подтверждает, что две папки одного origin используют разные projectId-слоты и перезапуск не трогает соседний проект.
test('projectId разделяет автосохранения новелл одного домена', async function({ page }) {
  const pageErrors = collectPageErrors(page);
  const projectASource = createAutosaveProjectStorySource('project-a', 'проекта A');
  const projectBSource = createAutosaveProjectStorySource('project-b', 'проекта B');
  const projectAKey = 'vn_engine_autosave_v1:project:project-a';
  const projectBKey = 'vn_engine_autosave_v1:project:project-b';

  await openStory(page, '/project-a/', {
    virtualBasePath: '/project-a',
    storySource: projectASource,
    expectedText: 'Начало проекта A'
  });
  await advanceDialog(page);
  await expect(page.locator('#textBox')).toHaveText('Прогресс проекта A');
  await page.waitForFunction(function hasProjectASave(key) {
    return window.localStorage.getItem(key) !== null;
  }, projectAKey);
  const projectARaw = await page.evaluate(function readProjectASave(key) {
    return window.localStorage.getItem(key);
  }, projectAKey);

  await openStory(page, '/project-b/', {
    virtualBasePath: '/project-b',
    storySource: projectBSource,
    expectedText: 'Начало проекта B'
  });
  await advanceDialog(page);
  await expect(page.locator('#textBox')).toHaveText('Прогресс проекта B');
  await page.waitForFunction(function hasProjectBSave(key) {
    return window.localStorage.getItem(key) !== null;
  }, projectBKey);
  const projectBRaw = await page.evaluate(function readProjectBSave(key) {
    return window.localStorage.getItem(key);
  }, projectBKey);

  await openStory(page, '/project-a/', {
    virtualBasePath: '/project-a',
    storySource: projectASource,
    expectedText: 'Прогресс проекта A'
  });
  expect(await page.evaluate(function readOtherProjectSave(key) {
    return window.localStorage.getItem(key);
  }, projectBKey)).toBe(projectBRaw);

  await page.locator('#btnRestart').click();
  await expect(page.locator('#textBox')).toHaveText('Начало проекта A');
  const slotsAfterRestart = await page.evaluate(function readProjectSlots(keys) {
    return {
      projectA: window.localStorage.getItem(keys.projectA),
      projectB: window.localStorage.getItem(keys.projectB)
    };
  }, { projectA: projectAKey, projectB: projectBKey });
  expect(slotsAfterRestart.projectA).not.toBe(projectARaw);
  expect(slotsAfterRestart.projectB).toBe(projectBRaw);
  expect(pageErrors).toEqual([]);
});

// Проверяет, что URL-режим novel создаёт вложенный слот проекта и не заменяет его обычное прохождение.
test('projectId разделяет обычный и novel-слоты', async function({ page }) {
  const pageErrors = collectPageErrors(page);
  const storySource = createAutosaveProjectStorySource('project-slots', 'проекта со слотами');
  const standardKey = 'vn_engine_autosave_v1:project:project-slots';
  const novelKey = 'vn_engine_autosave_v1:project:project-slots:novel:intro';
  const routeOptions = {
    virtualBasePath: '/project-slots',
    storySource
  };

  await openStory(page, '/project-slots/', {
    ...routeOptions,
    expectedText: 'Начало проекта со слотами'
  });
  await advanceDialog(page);
  await page.waitForFunction(function hasStandardSave(key) {
    return window.localStorage.getItem(key) !== null;
  }, standardKey);
  const standardRaw = await page.evaluate(function readStandardSave(key) {
    return window.localStorage.getItem(key);
  }, standardKey);

  await openStory(page, '/project-slots/?novel=intro', {
    ...routeOptions,
    expectedText: 'Начало проекта со слотами'
  });
  await advanceDialog(page);
  await page.waitForFunction(function hasNovelSave(key) {
    return window.localStorage.getItem(key) !== null;
  }, novelKey);
  expect(await page.evaluate(function readStandardSaveAgain(key) {
    return window.localStorage.getItem(key);
  }, standardKey)).toBe(standardRaw);

  await page.locator('#btnRestart').click();
  await expect(page.locator('#textBox')).toHaveText('Начало проекта со слотами');
  expect(await page.evaluate(function readStandardAfterNovelRestart(key) {
    return window.localStorage.getItem(key);
  }, standardKey)).toBe(standardRaw);

  await openStory(page, '/project-slots/', {
    ...routeOptions,
    expectedText: 'Прогресс проекта со слотами'
  });
  expect(pageErrors).toEqual([]);
});

// Создаёт старое сохранение и проверяет его одноразовое копирование после добавления projectId без иных правок сценария.
test('projectId мигрирует подходящее legacy-сохранение', async function({ page }) {
  const pageErrors = collectPageErrors(page);
  const legacySource = createAutosaveProjectStorySource('', 'мигрируемого проекта');
  const projectSource = createAutosaveProjectStorySource('migrated-project', 'мигрируемого проекта');
  const legacyKey = 'vn_engine_autosave_v1';
  const projectKey = 'vn_engine_autosave_v1:project:migrated-project';

  await openStory(page, '/migration-legacy/', {
    virtualBasePath: '/migration-legacy',
    storySource: legacySource,
    expectedText: 'Начало мигрируемого проекта'
  });
  await advanceDialog(page);
  await page.waitForFunction(function hasLegacySave(key) {
    return window.localStorage.getItem(key) !== null;
  }, legacyKey);

  await openStory(page, '/migration-legacy/', {
    virtualBasePath: '/migration-legacy',
    storySource: legacySource,
    expectedText: 'Прогресс мигрируемого проекта'
  });
  const legacyRaw = await page.evaluate(function readLegacyBeforeMigration(key) {
    return window.localStorage.getItem(key);
  }, legacyKey);

  await openStory(page, '/migration-project/', {
    virtualBasePath: '/migration-project',
    storySource: projectSource,
    expectedText: 'Прогресс мигрируемого проекта'
  });
  const migratedSlots = await page.evaluate(function readMigratedSlots(keys) {
    return {
      legacy: window.localStorage.getItem(keys.legacy),
      project: window.localStorage.getItem(keys.project)
    };
  }, { legacy: legacyKey, project: projectKey });
  expect(migratedSlots.legacy).toBe(legacyRaw);
  expect(migratedSlots.project).not.toBeNull();
  expect(JSON.parse(migratedSlots.project).projectId).toBe('migrated-project');
  expect(pageErrors).toEqual([]);
});

// Чужой валидный legacy-слот должен пережить запуск нового projectId и не превращаться в его сохранение.
test('projectId не удаляет чужое legacy-сохранение', async function({ page }) {
  const pageErrors = collectPageErrors(page);
  const foreignSource = createAutosaveProjectStorySource('', 'чужого legacy-проекта');
  const currentSource = createAutosaveProjectStorySource('current-project', 'текущего проекта');
  const legacyKey = 'vn_engine_autosave_v1';
  const projectKey = 'vn_engine_autosave_v1:project:current-project';

  await openStory(page, '/foreign-legacy/', {
    virtualBasePath: '/foreign-legacy',
    storySource: foreignSource,
    expectedText: 'Начало чужого legacy-проекта'
  });
  await advanceDialog(page);
  await page.waitForFunction(function hasForeignLegacySave(key) {
    return window.localStorage.getItem(key) !== null;
  }, legacyKey);
  const foreignRaw = await page.evaluate(function readForeignLegacySave(key) {
    return window.localStorage.getItem(key);
  }, legacyKey);

  await openStory(page, '/current-project/', {
    virtualBasePath: '/current-project',
    storySource: currentSource,
    expectedText: 'Начало текущего проекта'
  });
  const storage = await page.evaluate(function readUnmigratedSlots(keys) {
    return {
      legacy: window.localStorage.getItem(keys.legacy),
      project: window.localStorage.getItem(keys.project)
    };
  }, { legacy: legacyKey, project: projectKey });
  expect(storage.legacy).toBe(foreignRaw);
  expect(storage.project).toBeNull();
  expect(pageErrors).toEqual([]);
});

// Повреждённый legacy JSON остаётся на месте: миграция не должна очищать данные, принадлежность которых не доказана.
test('projectId сохраняет повреждённый legacy-слот без миграции', async function({ page }) {
  const pageErrors = collectPageErrors(page);
  const storySource = createAutosaveProjectStorySource('corrupt-check', 'проверки повреждения');
  await page.addInitScript(function seedCorruptLegacyAutosave() {
    // Инициализация хранилища нужна только верхней странице: строгие игровые iframe намеренно не имеют localStorage.
    if (window.parent !== window) return;
    window.localStorage.setItem('vn_engine_autosave_v1', '{broken-json');
  });

  await openStory(page, '/corrupt-check/', {
    virtualBasePath: '/corrupt-check',
    storySource,
    expectedText: 'Начало проверки повреждения'
  });
  const storage = await page.evaluate(function readCorruptLegacyAutosave() {
    return {
      legacy: window.localStorage.getItem('vn_engine_autosave_v1'),
      project: window.localStorage.getItem('vn_engine_autosave_v1:project:corrupt-check')
    };
  });
  expect(storage.legacy).toBe('{broken-json');
  expect(storage.project).toBeNull();
  expect(pageErrors).toEqual([]);
});

// Проверяет gameInit v2, блокировку поддельных и повторных результатов и продолжение сценария после игры.
test('мини-игра обменивается сообщениями с движком', async function({ page }) {
  const pageErrors = collectPageErrors(page);
  await installConsoleCapture(page);

  await openStory(page);
  await chooseRoute(page, 'Левая ветка');
  await expect(page.locator('#textBox')).toHaveText('Выбрана левая ветка');
  await advanceDialog(page);

  await expect(page.locator('#gameModal')).toBeVisible();
  await expect(page.locator('#gameFrame')).toHaveAttribute('sandbox', 'allow-scripts');
  await expect(page.locator('#gameFrame')).toHaveAttribute(
    'allow',
    /autoplay;.*camera 'none';.*microphone 'none';.*usb 'none'/
  );
  await expect(page.locator('#gameFrame')).toHaveAttribute('referrerpolicy', 'no-referrer');
  const game = page.frameLocator('#gameFrame');
  await expect(game.locator('#status')).toHaveText('gameInit получен');
  await expect(game.locator('#gameId')).toHaveText('testGame');
  await expect(game.locator('#protocolVersion')).toHaveText('2');
  await expect(game.locator('#sessionId')).toHaveText(/^game-[a-z0-9]+/);
  await expect(game.locator('#difficulty')).toHaveText('2');
  await expect(game.locator('#token')).toHaveText('private-token-do-not-log');
  await expect(game.locator('#parentDom')).toHaveText('заблокирован');
  await expect(game.locator('#parentStorage')).toHaveText('заблокировано');
  await expect(game.locator('#topNavigation')).toHaveText('заблокирована');
  await expect(game.locator('#popup')).toHaveText('заблокирован');
  await expect(page).toHaveURL(`${e2eServerOrigin}/`);

  const sessionId = await game.locator('#sessionId').textContent();
  // Отправляет сообщение с правильными id из родительского окна: движок обязан проверить event.source.
  await page.evaluate(function sendForgedResult(activeSessionId) {
    window.postMessage({
      type: 'gameResult',
      gameId: 'testGame',
      sessionId: activeSessionId,
      result: 99
    }, '*');
  }, sessionId);
  await expect(page.locator('#gameModal')).toBeVisible();

  await game.getByRole('button', { name: 'Отправить результат без сессии' }).click();
  await expect(page.locator('#gameModal')).toBeVisible();
  await game.getByRole('button', { name: 'Отправить неверную сессию' }).click();
  await expect(page.locator('#gameModal')).toBeVisible();
  await game.getByRole('button', { name: 'Завершить игру' }).click();

  await expect(page.locator('#gameModal')).toHaveClass(/hidden/);
  await expect(page.locator('#textBox')).toHaveText('Игра завершена: 7');
  await advanceDialog(page);
  await expect(page.locator('#textBox')).toHaveText('Финал: left, результат: 7');
  const messages = await readConsoleMessages(page);
  expect(messages.some(function(message) {
    return message.text.includes('[GAME DEPRECATION]');
  })).toBe(false);
  expect(pageErrors).toEqual([]);
});

// URL-режим использует тот же host, удерживает завершённую игру и создаёт новую сессию по кнопке перезапуска.
test('URL-запуск мини-игры перезапускает iframe через game host', async function({ page }) {
  const pageErrors = collectPageErrors(page);
  await installRepositoryRoutes(page);
  await page.goto('/?game=testGame&diff=5&token=url-token');

  await expect(page.locator('#gameModal')).toBeVisible();
  await expect(page.locator('#stage')).toHaveClass(/url-game-mode/);
  await expect(page.locator('#btnCloseGame')).toHaveText('Перезапустить');

  const game = page.frameLocator('#gameFrame');
  await expect(game.locator('#status')).toHaveText('gameInit получен');
  await expect(game.locator('#difficulty')).toHaveText('5');
  await expect(game.locator('#token')).toHaveText('url-token');
  const firstSessionId = await game.locator('#sessionId').textContent();
  expect(firstSessionId).toBeTruthy();

  await game.getByRole('button', { name: 'Завершить игру' }).click();
  await expect(page.locator('#gameModal')).toBeVisible();
  await page.locator('#btnCloseGame').click();
  await expect(game.locator('#status')).toHaveText('gameInit получен');
  await expect(game.locator('#sessionId')).not.toHaveText(String(firstSessionId));

  const secondSessionId = await game.locator('#sessionId').textContent();
  expect(secondSessionId).toBeTruthy();
  expect(secondSessionId).not.toBe(firstSessionId);
  expect(pageErrors).toEqual([]);
});

// Разрешённый CSP адрес всё равно не получает старую сессию после самостоятельного перехода игры.
test('защита игры: навигация закрывает сюжетную игру и сохраняет следующий запуск', async function({ page }) {
  const errors = collectPageErrors(page);
  await openStory(page);
  await chooseRoute(page, 'Левая ветка');
  await advanceDialog(page);
  const game = page.frameLocator('#gameFrame');
  await expect(game.locator('#status')).toHaveText('gameInit получен');
  await game.locator('body').evaluate(function navigateGame() { location.href = 'game.html?next-document'; });
  await expect(page.locator('#gameModal')).toHaveClass(/hidden/);
  await expect(page.locator('#gameFrame')).toHaveAttribute('src', 'about:blank');
  await expect(page.locator('#textBox')).toHaveText('Игра завершена: 0');
  await page.locator('#btnRestart').click();
  await chooseRoute(page, 'Левая ветка');
  await advanceDialog(page);
  await expect(game.locator('#status')).toHaveText('gameInit получен');
  await clickFrameButton(page, '#gameFrame', '#finishGame');
  await expect(page.locator('#textBox')).toHaveText('Игра завершена: 7');
  expect(errors).toEqual([]);
});

// После завершения URL-игры её reload останавливается с понятным экраном и ручным повтором через движок.
test('защита игры: URL-режим останавливает reload после результата', async function({ page }) {
  const errors = collectPageErrors(page);
  await installRepositoryRoutes(page);
  await page.goto('/?game=testGame');
  const game = page.frameLocator('#gameFrame');
  await expect(game.locator('#status')).toHaveText('gameInit получен');
  const sessionId = await game.locator('#sessionId').textContent();
  await clickFrameButton(page, '#gameFrame', '#finishGame');
  await game.locator('body').evaluate(function reloadGame() { location.reload(); });
  await expect(page.locator('#gameModal')).toHaveClass(/hidden/);
  await expect(page.locator('#textBox')).toContainText('Игра остановлена после самостоятельного перехода');
  await expect(page.locator('#stage')).not.toHaveClass(/url-game-mode/);
  await page.locator('#btnRestart').click();
  await expect(game.locator('#status')).toHaveText('gameInit получен');
  await expect(game.locator('#sessionId')).not.toHaveText(sessionId);
  await expect(page.locator('#stage')).toHaveClass(/url-game-mode/);
  expect(errors).toEqual([]);
});

// Остановка игры каталога не продвигает сюжет и не мешает следующему запуску из статистики.
test('защита игры: статистика восстанавливается после навигации', async function({ page }) {
  const errors = collectPageErrors(page);
  await openStory(page);
  await page.locator('#btnStats').click();
  await page.locator('#btnShowGames').click();
  const card = page.locator('#gamesGrid .gameCatalogCard').filter({ hasText: 'Синтетическая мини-игра' });
  await card.getByRole('button', { name: '3', exact: true }).click();
  const game = page.frameLocator('#statsGameFrame');
  await expect(game.locator('#status')).toHaveText('gameInit получен');
  await game.locator('body').evaluate(function reloadGame() { location.reload(); });
  await expect(page.locator('#statsGameModal')).toHaveClass(/hidden/);
  await expect(page.locator('#textBox')).toHaveText('Первый экран E2E');
  await card.getByRole('button', { name: '1', exact: true }).click();
  await expect(game.locator('#status')).toHaveText('gameInit получен');
  await game.getByRole('button', { name: 'Завершить игру' }).click();
  await expect(page.locator('#gamesStatus')).toContainText('сложность 1, результат 7');
  expect(errors).toEqual([]);
});

// Тестер отзывает сессию URL и srcdoc, но оставляет явную повторную загрузку выбранного файла.
for (const localFile of [false, true]) {
  test(`защита игры: тестер блокирует навигацию ${localFile ? 'srcdoc' : 'URL'}`, async function({ page }) {
    const errors = collectPageErrors(page);
    await installRepositoryRoutes(page);
    await page.goto('/tools/game-tester.html');
    await page.locator('#gameId').fill('testGame');
    await page.locator('#gameUrl').fill('/assets/__e2e__/game.html');
    await page.locator('#workspaceTabInput').click();
    if (localFile) await page.locator('#gameFile').setInputFiles(path.join(fixtureRoot, 'game.html'));
    else await page.locator('#loadGameBtn').click();
    const game = page.frameLocator('#gameFrame');
    await expect(game.locator('#status')).toHaveText('gameInit получен');
    await game.locator('body').evaluate(function navigateGame(url) { location.href = url; }, `${e2eServerOrigin}/assets/__e2e__/game.html?next-document`);
    await expect(page.locator('#status')).toContainText('самостоятельная навигация или перезагрузка запрещены');
    await expect(page.locator('#gameFrame')).toHaveAttribute('src', 'about:blank');
    await expect(page.locator('#messageLog [data-message-type="gameInit"]')).toHaveCount(1);
    await page.locator('#sendInitBtn').click();
    await expect(page.locator('#status')).toContainText('после самостоятельной навигации gameInit запрещён');
    await expect(page.locator('#messageLog [data-message-type="gameInit"]')).toHaveCount(1);
    await page.locator('#loadGameBtn').click();
    await expect(game.locator('#status')).toHaveText('gameInit получен');
    await clickFrameButton(page, '#gameFrame', '#finishGame');
    await expect(page.locator('#messageLog')).toContainText('[принят]');
    expect(errors).toEqual([]);
  });
}

// Прежний результат v2 с правильной сессией продолжает игру, но предупреждает разработчика о миграции до версии 1.0.
test('результат мини-игры без protocolVersion принимается с предупреждением', async function({ page }) {
  const pageErrors = collectPageErrors(page);
  await installConsoleCapture(page);

  await openStory(page);
  await chooseRoute(page, 'Левая ветка');
  await advanceDialog(page);

  const game = page.frameLocator('#gameFrame');
  await expect(game.locator('#status')).toHaveText('gameInit получен');
  await game.getByRole('button', { name: 'Отправить результат без версии' }).click();

  await expect(page.locator('#gameModal')).toHaveClass(/hidden/);
  await expect(page.locator('#textBox')).toHaveText('Игра завершена: 6');
  const messages = await readConsoleMessages(page);
  const warnings = messages.filter(function(message) {
    return message.method === 'warn' && message.text.includes('[GAME DEPRECATION]');
  });
  expect(warnings).toHaveLength(1);
  expect(warnings[0].text).toContain('Игра testGame не вернула protocolVersion');
  expect(warnings[0].text).toContain('совместимость будет удалена в версии 1.0');
  expect(pageErrors).toEqual([]);
});

// Даже полная явно включённая диагностика не должна раскрывать текст истории, параметры игры и sessionId.
test('Debug=all не выводит чувствительные данные новеллы и мини-игры', async function({ page }) {
  const pageErrors = collectPageErrors(page);
  await installConsoleCapture(page);

  await openStory(page, '/?mode=release&Debug=all');
  await chooseRoute(page, 'Левая ветка');
  await advanceDialog(page);

  const game = page.frameLocator('#gameFrame');
  await expect(game.locator('#status')).toHaveText('gameInit получен');
  const sessionId = await game.locator('#sessionId').textContent();
  expect(sessionId).toBeTruthy();

  const messages = await readConsoleMessages(page);
  const consoleText = messages.map(function(message) { return message.text; }).join('\n');
  expect(consoleText).not.toContain('private-token-do-not-log');
  expect(consoleText).not.toContain(sessionId);
  expect(consoleText).not.toContain('Первый экран E2E');
  expect(pageErrors).toEqual([]);
});

// Даже подменённый старый AST не может снять sandbox или вернуть результат без идентификаторов протокола v2.
test('legacy-настройки старого AST не ослабляют мини-игру', async function({ page }) {
  const pageErrors = collectPageErrors(page);

  await openStory(page);
  await page.evaluate(function injectLegacySettingsIntoAst() {
    window.STORY.meta.engine.gameSandbox = 'legacy';
    window.STORY.assets.games.testGame.sandbox = 'legacy';
  });
  await chooseRoute(page, 'Левая ветка');
  await expect(page.locator('#textBox')).toHaveText('Выбрана левая ветка');
  await advanceDialog(page);

  await expect(page.locator('#gameModal')).toBeVisible();
  await expect(page.locator('#gameFrame')).toHaveAttribute('sandbox', 'allow-scripts');
  await expect(page.locator('#gameFrame')).toHaveAttribute('referrerpolicy', 'no-referrer');
  const game = page.frameLocator('#gameFrame');
  await expect(game.locator('#status')).toHaveText('gameInit получен');
  await game.getByRole('button', { name: 'Отправить результат без сессии' }).click();
  await expect(page.locator('#gameModal')).toBeVisible();
  await game.getByRole('button', { name: 'Завершить игру' }).click();

  await expect(page.locator('#gameModal')).toHaveClass(/hidden/);
  await expect(page.locator('#textBox')).toHaveText('Игра завершена: 7');
  expect(pageErrors).toEqual([]);
});

// Проверяет отдельную сессию iframe статистики, отклонение результата сюжетного iframe и ручное закрытие.
test('игра из статистики изолирована от сюжетного iframe', async function({ page }) {
  const pageErrors = collectPageErrors(page);

  await openStory(page);
  await page.locator('#btnStats').click();
  await expect(page.locator('#statsPanel')).toBeVisible();
  await page.locator('#btnShowGames').click();

  const gameCard = page.locator('#gamesGrid .gameCatalogCard').filter({
    hasText: 'Синтетическая мини-игра'
  });
  await gameCard.getByRole('button', { name: '3', exact: true }).click();
  await expect(page.locator('#statsGameModal')).toBeVisible();
  await expect(page.locator('#statsGameFrame')).toHaveAttribute('sandbox', 'allow-scripts');

  const statsGame = page.frameLocator('#statsGameFrame');
  await expect(statsGame.locator('#status')).toHaveText('gameInit получен');
  await expect(statsGame.locator('#protocolVersion')).toHaveText('2');

  // Загружает служебный fixture в неактивный сюжетный iframe и имитирует legacy-результат от неверного окна.
  await page.locator('#gameFrame').evaluate(function loadInactiveStoryFrame(frame) {
    frame.src = '/assets/__e2e__/legacy-game.html';
  });
  const inactiveStoryGame = page.frameLocator('#gameFrame');
  await expect(inactiveStoryGame.locator('#status')).toHaveText('Ожидание gameInit');
  await inactiveStoryGame.locator('body').evaluate(function sendResultFromWrongFrame() {
    window.parent.postMessage({ type: 'gameResult', result: 99 }, '*');
  });
  await expect(page.locator('#statsGameModal')).toBeVisible();

  await statsGame.getByRole('button', { name: 'Завершить игру' }).click();
  await expect(page.locator('#statsGameModal')).toHaveClass(/hidden/);
  await expect(page.locator('#gamesStatus')).toHaveText(
    'Последний запуск: Синтетическая мини-игра, сложность 3, результат 7'
  );
  await expect(page.locator('#textBox')).toHaveText('Первый экран E2E');

  await gameCard.getByRole('button', { name: '1', exact: true }).click();
  await expect(page.locator('#statsGameModal')).toBeVisible();
  await expect(statsGame.locator('#status')).toHaveText('gameInit получен');
  await page.locator('#btnCloseStatsGame').click();
  await expect(page.locator('#statsGameModal')).toHaveClass(/hidden/);
  await expect(page.locator('#gamesStatus')).toHaveText(
    'Последний запуск: Синтетическая мини-игра, сложность 1, игра закрыта вручную'
  );
  expect(pageErrors).toEqual([]);
});

// Проверяет sandbox тестера, безопасный лог и одноразовую привязку результата к gameInit v2.
test('тестер мини-игр безопасно проверяет strict-протокол', async function({ page }) {
  const pageErrors = collectPageErrors(page);
  const game = await openGameTester(page, '/assets/__e2e__/game.html');

  await expect(page.locator('#sandboxMode')).toHaveCount(0);
  await expect(page.locator('#gameFrame')).toHaveAttribute('sandbox', 'allow-scripts');
  await expect(page.locator('#gameFrame')).toHaveAttribute('referrerpolicy', 'no-referrer');
  await expect(game.locator('#gameId')).toHaveText('testGame');
  await expect(game.locator('#protocolVersion')).toHaveText('2');
  await expect(game.locator('#sessionId')).toHaveText(/^game-[a-z0-9]+/);
  await expect(game.locator('#parentDom')).toHaveText('заблокирован');
  await expect(game.locator('#parentStorage')).toHaveText('заблокировано');

  await game.getByRole('button', { name: 'Отправить опасный тип' }).click();
  await expect(page.locator('#messageLog')).toContainText('<img id="tester-xss"');
  await expect(page.locator('#messageLog #tester-xss')).toHaveCount(0);
  await expect(page.locator('body')).not.toHaveAttribute('data-xss', '1');

  await game.getByRole('button', { name: 'Отправить результат без сессии' }).click();
  await expect(page.locator('#status')).toContainText('протокол v2 требует gameId и sessionId');
  await game.getByRole('button', { name: 'Отправить неверную сессию' }).click();
  await expect(page.locator('#status')).toContainText('sessionId не совпадает');

  // Сообщение из родительского окна не должно попасть в журнал игрового iframe.
  const resultLogCount = await page.locator('#messageLog [data-message-type="gameResult"]').count();
  await page.evaluate(function sendForgedTesterResult() {
    window.postMessage({
      type: 'gameResult',
      gameId: 'testGame',
      sessionId: 'forged-session',
      result: 123
    }, '*');
  });
  await expect(page.locator('#messageLog [data-message-type="gameResult"]')).toHaveCount(resultLogCount);

  await game.getByRole('button', { name: 'Завершить игру' }).click();
  await expect(page.locator('#messageLog')).toContainText('[принят]');
  await expect(page.locator('#messageLog')).toContainText('результат этой сессии уже принят');
  await expect(page.locator('#status')).toContainText('результат этой сессии уже принят');
  expect(pageErrors).toEqual([]);
});

// Проверяет, что загрузка локального HTML через srcdoc сохраняет диагностику внутри strict sandbox.
test('тестер сохраняет диагностику локального HTML в strict-режиме', async function({ page }) {
  const pageErrors = collectPageErrors(page);
  await installRepositoryRoutes(page);
  await page.goto('/tools/game-tester.html');
  await page.locator('#gameId').fill('testGame');
  await page.locator('#gameFile').setInputFiles(path.join(fixtureRoot, 'game.html'));

  await expect(page.locator('#gameFrame')).toHaveAttribute('sandbox', 'allow-scripts');
  const game = page.frameLocator('#gameFrame');
  await expect(game.locator('#status')).toHaveText('gameInit получен');
  await expect(game.locator('#protocolVersion')).toHaveText('2');
  await expect(game.locator('#sessionId')).toHaveText(/^game-[a-z0-9]+/);
  await expect(page.locator('#diagRisk')).toContainText('Встроенная диагностика активна');
  expect(pageErrors).toEqual([]);
});

// Игнорирует сохранённый legacy-режим из старых настроек и не возвращает небезопасный переключатель.
test('старые настройки тестера не возвращают legacy-режим', async function({ page }) {
  const pageErrors = collectPageErrors(page);
  await installRepositoryRoutes(page);
  await page.goto('/tools/game-tester.html');
  await page.evaluate(function saveOldTesterSettings() {
    localStorage.setItem('vn-game-tester-settings-v4', JSON.stringify({
      gameUrl: '/assets/__e2e__/legacy-game.html',
      gameId: 'oldGame',
      difficulty: '2',
      sandboxMode: 'legacy'
    }));
  });
  await page.reload();

  await expect(page.locator('#sandboxMode')).toHaveCount(0);
  await expect(page.locator('#gameFrame')).toHaveAttribute('sandbox', 'allow-scripts');
  expect(pageErrors).toEqual([]);
});

// Старая игра может загрузиться для диагностики, но её result без идентификаторов больше не принимается.
test('тестер отклоняет результат legacy-игры', async function({ page }) {
  const pageErrors = collectPageErrors(page);
  const game = await openGameTester(page, '/assets/__e2e__/legacy-game.html');

  await expect(page.locator('#gameFrame')).toHaveAttribute('sandbox', 'allow-scripts');
  await expect(page.locator('#gameFrame')).toHaveAttribute('referrerpolicy', 'no-referrer');

  await game.getByRole('button', { name: 'Завершить старую игру' }).click();
  await expect(page.locator('#status')).toContainText('протокол v2 требует gameId и sessionId');
  await expect(page.locator('#messageLog')).toContainText('[отклонено');
  expect(pageErrors).toEqual([]);
});

// Импортирует недоверенный story360 и подтверждает, что ссылка на JS-пакет остаётся данными, а не запускаемым кодом.
test('Scene360 Editor не выполняет пакет из импортированного story360', async function({ page }) {
  const pageErrors = collectPageErrors(page);
  let packRequestCount = 0;
  page.on('request', function countUnexpectedPackRequest(request) {
    if (new URL(request.url()).pathname === '/assets/360/untrusted-360.js') packRequestCount += 1;
  });

  await openScene360Editor(page);
  await page.locator('#story360Input').setInputFiles({
    name: 'story360.js',
    mimeType: 'text/javascript',
    buffer: Buffer.from(createScene360StorySource('assets/360/untrusted-360.js'))
  });

  await expect(page.locator('#assetPathInput')).toHaveValue('assets/360/untrusted-360.js');
  await expect(page.locator('#statusBox')).toContainText('legacy JS-пакетов временно скрыт');
  expect(packRequestCount).toBe(0);
  await expect(page.locator('body')).not.toHaveAttribute('data-scene-untrusted-pack-executed', '1');
  expect(pageErrors).toEqual([]);
});

// Закрепляет упрощённые подписи, служебные секции и отсутствие неоднозначных глобальных действий.
test('Scene360 Editor показывает упрощённый интерфейс редактирования', async function({ page }) {
  const pageErrors = collectPageErrors(page);
  await openScene360Editor(page);

  await expect(page).toHaveTitle('Редактор сцен 360');
  await expect(page.getByRole('heading', { name: 'Редактор сцен 360', exact: true })).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Проект 360', exact: true })).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Текущая панорама', exact: true })).toBeVisible();
  await expect(page.locator('#testTargetBtn')).toHaveCount(0);
  await expect(page.locator('#readFocusBtn')).toHaveCount(0);
  await expect(page.locator('#savePanoramaBtn')).toHaveCount(0);
  await expect(page.locator('#saveDefaultFocusBtn')).toHaveText('Сохранить текущий ракурс как стартовый');
  await expect(page.locator('#saveStory360LocalBtn')).toHaveText('Сохранить версию в браузере');
  await expect(page.locator('#downloadStory360JsBtn')).toHaveText('Скачать обновлённый story360.js');
  await expect(page.locator('#panoramaAutosaveStatus')).toContainText('сразу применяются к открытой рабочей копии');
  await expect(page.locator('#projectSaveStatus')).toContainText('Нет сохранённой версии в браузере');
  await expect(page.locator('#recoveryOffer')).toBeHidden();
  await expect(page.locator('.viewer-wrap > #backPanoramaBtn')).toBeVisible();
  expect(await page.locator('#newPointTypeInput option').allTextContents()).toEqual([
    'Переход',
    'Текст',
    'Направление обзора',
    'Фотогалерея'
  ]);
  await expect(page.locator('#bgIdInput')).toHaveAttribute('readonly', '');
  await expect(page.getByText('Автоматически', { exact: true })).toBeVisible();
  await expect(page.locator('#exportBox')).toBeVisible();
  await expect(page.locator('#statusBox')).toBeHidden();
  await expect(page.locator('#assetStatusBox')).toContainText('CSS-пакет панорамы ещё не загружен');
  expect(await page.evaluate(function checkAssetStatusOrder() {
    var pathInput = document.getElementById('assetPathInput');
    var status = document.getElementById('assetStatusBox');
    var loadButton = document.getElementById('loadAssetPathBtn');
    return Boolean(
      pathInput && status && loadButton &&
      (pathInput.compareDocumentPosition(status) & Node.DOCUMENT_POSITION_FOLLOWING) &&
      (status.compareDocumentPosition(loadButton) & Node.DOCUMENT_POSITION_FOLLOWING)
    );
  })).toBe(true);
  expect(await page.evaluate(function checkBulkButtonOrder() {
    var download = document.getElementById('downloadStory360JsBtn');
    var bulk = document.getElementById('openBulkModalBtn');
    return Boolean(download && bulk && (download.compareDocumentPosition(bulk) & Node.DOCUMENT_POSITION_FOLLOWING));
  })).toBe(true);
  expect(await page.evaluate(function checkProjectAndPanoramaSectionOrder() {
    var fileInput = document.getElementById('story360Input');
    var projectSave = document.getElementById('saveStory360LocalBtn');
    var panoramaHeading = document.querySelector('.panorama-section-heading');
    var panoramaCreate = document.getElementById('newPanoramaBtn');
    return Boolean(
      fileInput && projectSave && panoramaHeading && panoramaCreate &&
      (fileInput.compareDocumentPosition(projectSave) & Node.DOCUMENT_POSITION_FOLLOWING) &&
      (projectSave.compareDocumentPosition(panoramaHeading) & Node.DOCUMENT_POSITION_FOLLOWING) &&
      (panoramaHeading.compareDocumentPosition(panoramaCreate) & Node.DOCUMENT_POSITION_FOLLOWING)
    );
  })).toBe(true);
  expect(pageErrors).toEqual([]);
});

// Проверяет сохранение авторской заметки панорамы и её отображение после ID в выпадающем списке.
test('Scene360 Editor сохраняет и показывает комментарии панорам', async function({ page }) {
  const pageErrors = collectPageErrors(page);
  await openScene360Editor(page);
  await page.locator('#story360Input').setInputFiles({
    name: 'story360-comments.js',
    mimeType: 'text/javascript',
    buffer: Buffer.from(createScene360CrossSpaceStorySource())
  });

  await expect(page.locator('#panoramaCommentInput')).toHaveValue('Главный вход');
  expect(await page.locator('#panoramaSelect option').allTextContents()).toEqual([
    'A.P1 "Главный вход"',
    'B.P2 "Второй этаж"'
  ]);

  await page.locator('#panoramaCommentInput').fill('Вход в учебный корпус');
  await expect(page.locator('#panoramaSelect option:checked')).toHaveText('A.P1 "Вход в учебный корпус"');
  expect(await page.evaluate(function readPanoramaComment() {
    return window.story360Data.spaces.A.panoramas.P1.comment;
  })).toBe('Вход в учебный корпус');

  await page.locator('#panoramaSelect').selectOption('B.P2');
  await expect(page.locator('#panoramaCommentInput')).toHaveValue('Второй этаж');
  await page.locator('#panoramaSelect').selectOption('A.P1');
  await expect(page.locator('#panoramaCommentInput')).toHaveValue('Вход в учебный корпус');
  expect(pageErrors).toEqual([]);
});

// Проверяет, что ручная версия остаётся точкой возврата, а более свежая аварийная копия восстанавливается только по выбору пользователя.
test('Scene360 Editor разделяет сохранённую версию и аварийное восстановление', async function({ page }) {
  const pageErrors = collectPageErrors(page);
  await openScene360Editor(page);
  await page.locator('#story360Input').setInputFiles({
    name: 'story360-checkpoint.js',
    mimeType: 'text/javascript',
    buffer: Buffer.from(createScene360CrossSpaceStorySource())
  });

  await expect(page.locator('#spaceIdInput')).toHaveValue('A');
  await expect(page.locator('#panoramaIdInput')).toHaveValue('P1');
  await expect(page.locator('#projectSaveStatus')).toContainText('принят как сохранённая версия');

  await page.locator('#panoramaIdInput').fill('P9');
  await page.locator('#panoramaIdInput').press('Enter');
  await expect(page.locator('#projectSaveStatus')).toContainText('Есть несохранённые изменения');
  expect(await page.evaluate(function checkSeparateStorageCopies() {
    return Boolean(
      localStorage.getItem(window.getDraftStorageKey()) &&
      localStorage.getItem(window.getRecoveryStorageKey())
    );
  })).toBe(true);

  let firstDialogType = '';
  page.once('dialog', async function acceptUnsavedReload(dialog) {
    firstDialogType = dialog.type();
    await dialog.accept();
  });
  await page.reload();
  expect(firstDialogType).toBe('beforeunload');

  await expect(page.locator('#panoramaIdInput')).toHaveValue('P1');
  await expect(page.locator('#recoveryOffer')).toBeVisible();
  await page.locator('#restoreRecoveryBtn').click();
  await expect(page.locator('#panoramaIdInput')).toHaveValue('P9');
  await expect(page.locator('#projectSaveStatus')).toContainText('Аварийная копия восстановлена');

  await page.locator('#saveStory360LocalBtn').click();
  await expect(page.locator('#projectSaveStatus')).toContainText('Версия сохранена в браузере');
  await expect(page.locator('#recoveryOffer')).toBeHidden();
  expect(await page.evaluate(function checkRecoveryWasCleared() {
    return localStorage.getItem(window.getRecoveryStorageKey());
  })).toBeNull();

  await page.locator('#panoramaIdInput').fill('P8');
  await page.locator('#panoramaIdInput').press('Enter');
  let secondDialogType = '';
  page.once('dialog', async function acceptSecondUnsavedReload(dialog) {
    secondDialogType = dialog.type();
    await dialog.accept();
  });
  await page.reload();
  expect(secondDialogType).toBe('beforeunload');

  await expect(page.locator('#panoramaIdInput')).toHaveValue('P9');
  await expect(page.locator('#recoveryOffer')).toBeVisible();
  await page.locator('#discardRecoveryBtn').click();
  await expect(page.locator('#recoveryOffer')).toBeHidden();
  await expect(page.locator('#projectSaveStatus')).toContainText('Аварийная копия удалена');
  expect(await page.evaluate(function checkDiscardedRecoveryWasCleared() {
    return localStorage.getItem(window.getRecoveryStorageKey());
  })).toBeNull();
  expect(pageErrors).toEqual([]);
});

// Проверяет, что создание пустой сцены больше не копирует текущие метки, а отдельное дублирование копирует их явно.
test('Scene360 Editor разделяет пустую панораму и дублирование', async function({ page }) {
  const pageErrors = collectPageErrors(page);
  await openScene360Editor(page);
  await page.locator('#story360Input').setInputFiles({
    name: 'story360-copy-controls.js',
    mimeType: 'text/javascript',
    buffer: Buffer.from(createScene360CrossSpaceStorySource())
  });

  await expect(page.locator('.point-item')).toHaveCount(1);
  await page.locator('#duplicatePanoramaBtn').click();
  await expect(page.locator('#panoramaIdInput')).toHaveValue('new');
  await expect(page.locator('.point-item')).toHaveCount(1);

  await page.locator('#newPanoramaBtn').click();
  await expect(page.locator('#panoramaIdInput')).toHaveValue('new2');
  await expect(page.locator('#assetPathInput')).toHaveValue('');
  await expect(page.locator('.point-item')).toHaveCount(0);
  expect(pageErrors).toEqual([]);
});

// Проходит цепочку P1→P2→P3 и возвращается по стеку дважды, включая динамическую подпись назначения.
test('Scene360 Editor возвращается по многошаговой истории панорам', async function({ page }) {
  const pageErrors = collectPageErrors(page);
  await openScene360Editor(page);
  await page.locator('#story360Input').setInputFiles({
    name: 'story360-history.js',
    mimeType: 'text/javascript',
    buffer: Buffer.from(createScene360HistoryStorySource())
  });

  await page.locator('.point-item').first().getByRole('button', { name: 'Перейти', exact: true }).click();
  await expect(page.locator('#panoramaIdInput')).toHaveValue('P2');
  await expect(page.locator('#backPanoramaBtn')).toHaveText('← Назад к Route.P1');

  await page.locator('.point-item').first().getByRole('button', { name: 'Перейти', exact: true }).click();
  await expect(page.locator('#panoramaIdInput')).toHaveValue('P3');
  await expect(page.locator('#backPanoramaBtn')).toHaveText('← Назад к Route.P2');

  await page.locator('#backPanoramaBtn').click();
  await expect(page.locator('#panoramaIdInput')).toHaveValue('P2');
  await expect(page.locator('#backPanoramaBtn')).toHaveText('← Назад к Route.P1');
  await page.keyboard.press('Alt+ArrowLeft');
  await expect(page.locator('#panoramaIdInput')).toHaveValue('P1');
  await expect(page.locator('#backPanoramaBtn')).toBeDisabled();
  expect(pageErrors).toEqual([]);
});

// Закрепляет отсутствие файлового поля и функции временного растрового превью в CSS-only редакторе.
test('Scene360 Editor не предлагает прямую загрузку 360-изображения', async function({ page }) {
  const pageErrors = collectPageErrors(page);
  await openScene360Editor(page);

  await expect(page.locator('#bgImageInput')).toHaveCount(0);
  await expect(page.getByText('360-изображение (2:1 equirect)')).toHaveCount(0);
  expect(await page.evaluate(function readRemovedImageLoaderType() {
    return typeof window.loadImageFile;
  })).toBe('undefined');
  expect(pageErrors).toEqual([]);
});

// Импортирует растровый путь и подтверждает отказ без сетевого запроса и без остатка прежней текстуры.
test('Scene360 Editor отклоняет 360-изображение по пути из story360', async function({ page }) {
  const pageErrors = collectPageErrors(page);
  const imagePath = 'assets/360/direct-panorama.png';
  let imageRequestCount = 0;
  page.on('request', function countUnexpectedImageRequest(request) {
    if (new URL(request.url()).pathname === `/${imagePath}`) imageRequestCount += 1;
  });
  await openScene360Editor(page);
  await page.locator('#story360Input').setInputFiles({
    name: 'story360.js',
    mimeType: 'text/javascript',
    buffer: Buffer.from(createScene360StorySource(imagePath))
  });

  await expect(page.locator('#assetPathInput')).toHaveValue(imagePath);
  await expect(page.locator('#statusBox')).toContainText('только из CSS-пакетов *-360.css');
  expect(imageRequestCount).toBe(0);
  expect(await page.evaluate(function readRejectedImageMaterial() {
    var material = window.sphereMesh && window.sphereMesh.material;
    return {
      hasMap: Boolean(material && material.map),
      color: material && material.color ? material.color.getHex() : null
    };
  })).toEqual({ hasMap: false, color: 0x000000 });
  await expect(page.locator('script[data-scene360-legacy-pack]')).toHaveCount(0);
  expect(pageErrors).toEqual([]);
});

// Передаёт результат настоящего конвертера в редактор, чтобы формат CSS не расходился между двумя инструментами.
test('Конвертер создаёт совместимый CSS-пакет 360', async function({ page }) {
  const pageErrors = collectPageErrors(page);
  await installRepositoryRoutes(page);
  await page.goto('/tools/convert-360-img-to-css.html');
  await page.locator('#fileInput').setInputFiles({
    name: 'converter-source.png',
    mimeType: 'image/png',
    buffer: Buffer.from(tinyPanoramaDataUrl.split(',')[1], 'base64')
  });
  await expect(page.locator('#status')).toContainText('Можно генерировать CSS');
  await page.locator('#btnGenerate').click();
  await expect(page.locator('#status')).toContainText('сформированы в формате CSS');
  await expect(page.locator('#btnDownload')).toBeEnabled();
  await expect(page.locator('#btnDownload')).toHaveText('Скачать оба CSS');
  await page.locator('#resultGrid').getByRole('button', { name: 'Показать CSS' }).first().click();
  const cssSource = await page.locator('#output').inputValue();
  expect(cssSource).toContain('--vn360-schema: "vn360-css-pack-v1"');
  expect(cssSource).toContain('--vn360-data-0: "data:image/');
  expect(cssSource).not.toContain('window.VN360_PACKS');

  const cssPath = 'assets/360/converter-source-360.css';
  await openScene360Editor(page);
  await page.route(`${e2eServerOrigin}/${cssPath}`, async function serveConvertedCssPanorama(route) {
    await route.fulfill({ status: 200, contentType: 'text/css; charset=utf-8', body: cssSource });
  });
  await page.locator('#story360Input').setInputFiles({
    name: 'story360.js',
    mimeType: 'text/javascript',
    buffer: Buffer.from(createScene360StorySource(cssPath))
  });

  await expect(page.locator('#statusBox')).toContainText(`Панорама загружена: ${cssPath}`);
  await expect(page.locator('iframe[data-scene360-css-pack-loader]')).toHaveCount(0);
  await expect(page.locator('script[data-scene360-legacy-pack]')).toHaveCount(0);
  expect(pageErrors).toEqual([]);
});

// Проверяет повторное открытие CSS-пакета и сохраняет пассивную миграцию старого JS через одно поле выбора.
test('Конвертер открывает готовые CSS- и JS-пакеты', async function({ page }) {
  const pageErrors = collectPageErrors(page);
  await installRepositoryRoutes(page);
  await page.goto('/tools/convert-360-img-to-css.html');

  const packInput = page.locator('#packInput');
  await expect(packInput).toHaveAttribute('accept', /\.js,\.css/);
  await packInput.setInputFiles({
    name: 'reopen-360.css',
    mimeType: 'text/css',
    buffer: Buffer.from(createScene360CssPackSource())
  });
  await expect(page.locator('#status')).toContainText('Изображение извлечено из CSS-пакета без применения его правил');
  await expect(page.locator('#imageInfo')).toContainText('CSS-пакет: режим normal, формат PNG');
  await page.locator('#btnGenerate').click();
  await expect(page.locator('#btnDownload')).toBeEnabled();

  await packInput.setInputFiles({
    name: 'legacy-360.js',
    mimeType: 'text/javascript',
    buffer: Buffer.from(createScene360PackSource('converterImportExecuted'))
  });
  await expect(page.locator('#status')).toContainText('Изображение извлечено из старого JS-пакета без выполнения JavaScript');
  await expect(page.locator('#imageInfo')).toContainText('JS-пакет: режим normal, формат PNG');
  await expect(page.locator('body')).not.toHaveAttribute('data-converter-import-executed', '1');
  expect(pageErrors).toEqual([]);
});

// Проверяет, что одиночный экспорт создаёт только декларативный CSS-пакет.
test('Конвертер сохраняет только CSS-пакеты', async function({ page }) {
  const pageErrors = collectPageErrors(page);
  await installRepositoryRoutes(page);
  await page.goto('/tools/convert-360-img-to-css.html');
  const expectedHeightOptions = ['source', '3840', '2880', '1920', '1440', '1080'];
  for (const selector of ['#normalHeight', '#mobileHeight', '#batchNormalHeight', '#batchMobileHeight']) {
    await expect(page.locator(`${selector} option`)).toHaveCount(expectedHeightOptions.length);
    expect(await page.locator(selector).locator('option').evaluateAll(function(options) {
      return options.map(function(option) { return option.value; });
    })).toEqual(expectedHeightOptions);
  }
  await page.locator('#fileInput').setInputFiles({
    name: 'format-source.png',
    mimeType: 'image/png',
    buffer: Buffer.from(tinyPanoramaDataUrl.split(',')[1], 'base64')
  });
  await page.locator('#btnGenerate').click();
  await expect(page.locator('#btnDownload')).toBeEnabled();

  await expect(page.locator('#packOutputFormat')).toHaveCount(0);
  await expect(page.getByText('Формат сохраняемых пакетов')).toHaveCount(0);
  await expect(page.locator('#btnDownload')).toHaveText('Скачать оба CSS');
  await expect(page.locator('#btnBatchStart')).toHaveText('Пакетно преобразовать и скачать CSS');
  await expect(page.locator('#resultGrid').getByRole('button', { name: 'Скачать JS', exact: true })).toHaveCount(0);
  expect(await page.locator('#output').inputValue()).not.toContain('window.VN360_PACKS');
  const cssDownloadPromise = page.waitForEvent('download');
  await page.locator('#resultGrid').getByRole('button', { name: 'Скачать CSS', exact: true }).first().click();
  const cssDownload = await cssDownloadPromise;
  expect(cssDownload.suggestedFilename()).toBe('format-source-360.css');
  expect(pageErrors).toEqual([]);
});

// Проверяет пакетный путь отдельно, чтобы Firefox получал полный лимит времени на растровую конвертацию и скачивание.
test('Конвертер пакетно сохраняет только CSS-пакеты', async function({ page }) {
  test.setTimeout(30_000);
  const pageErrors = collectPageErrors(page);
  await installRepositoryRoutes(page);
  await page.goto('/tools/convert-360-img-to-css.html');
  await page.locator('#tabBatch').click();
  await page.locator('#batchMobileChk').uncheck();
  await page.locator('#batchFileInput').setInputFiles({
    name: 'batch-source.png',
    mimeType: 'image/png',
    buffer: Buffer.from(tinyPanoramaDataUrl.split(',')[1], 'base64')
  });
  const batchDownloadPromise = page.waitForEvent('download');
  await page.locator('#btnBatchStart').click();
  const batchDownload = await batchDownloadPromise;
  expect(batchDownload.suggestedFilename()).toBe('batch-source-360.css');
  await expect(page.locator('#batchStatus')).toContainText('скачано CSS: 1');
  expect(pageErrors).toEqual([]);
});

// Загружает CSS только во временный iframe, проверяет отсутствие влияния его правил на редактор и повторную загрузку из Local после F5.
test('Scene360 Editor изолированно загружает CSS-пакет после F5', async function({ page }) {
  const pageErrors = collectPageErrors(page);
  const cssPath = 'assets/360/safe-test-360.css';
  let cssRequestCount = 0;
  await openScene360Editor(page);
  await page.route(`${e2eServerOrigin}/${cssPath}`, async function serveCssPanorama(route) {
    cssRequestCount++;
    await route.fulfill({
      status: 200,
      contentType: 'text/css; charset=utf-8',
      body: createScene360CssPackSource()
    });
  });
  await page.locator('#story360Input').setInputFiles({
    name: 'story360.js',
    mimeType: 'text/javascript',
    buffer: Buffer.from(createScene360StorySource(cssPath))
  });

  await expect(page.locator('#assetPathInput')).toHaveValue(cssPath);
  await expect(page.locator('#statusBox')).toContainText(`Панорама загружена: ${cssPath}`);
  await expect(page.locator('#statusBox')).toContainText('формат PNG');
  await expect(page.locator('iframe[data-scene360-css-pack-loader]')).toHaveCount(0);
  await expect(page.locator('script[data-scene360-legacy-pack]')).toHaveCount(0);
  expect(await page.locator('body').evaluate(function(body) {
    return {
      display: getComputedStyle(body).display,
      injectedValue: getComputedStyle(body).getPropertyValue('--scene360-css-injection').trim()
    };
  })).toEqual({ display: 'block', injectedValue: '' });

  await page.reload();
  await expect(page.locator('#assetPathInput')).toHaveValue(cssPath);
  await expect(page.locator('#statusBox')).toContainText(`Панорама загружена: ${cssPath}`);
  await expect(page.locator('iframe[data-scene360-css-pack-loader]')).toHaveCount(0);
  expect(cssRequestCount).toBeGreaterThanOrEqual(2);
  expect(pageErrors).toEqual([]);
});

// Редактор отклоняет CSS с @import и не обращается к импортируемому ресурсу, даже если сам пакет содержит корректную панораму.
test('Scene360 Editor блокирует CSS @import панорамы', async function({ page }) {
  const pageErrors = collectPageErrors(page);
  const cssPath = 'assets/360/editor-import-360.css';
  const blockedImportPath = '/__e2e__/scene360-editor-import.css';
  let importRequestCount = 0;
  await openScene360Editor(page);
  await page.route(`${e2eServerOrigin}/${cssPath}`, async function serveEditorCssWithImport(route) {
    await route.fulfill({
      status: 200,
      contentType: 'text/css; charset=utf-8',
      body: createScene360CssPackSource('normal', blockedImportPath)
    });
  });
  await page.route(`${e2eServerOrigin}${blockedImportPath}`, async function rejectEditorCssImport(route) {
    importRequestCount++;
    await route.fulfill({ status: 200, contentType: 'text/css; charset=utf-8', body: '#vn360-pack { --vn360-import-ran: "1"; }' });
  });
  await page.locator('#story360Input').setInputFiles({
    name: 'story360.js',
    mimeType: 'text/javascript',
    buffer: Buffer.from(createScene360StorySource(cssPath))
  });

  await expect(page.locator('#statusBox')).toContainText('CSS-пакет должен содержать только правило #vn360-pack');
  await expect(page.locator('iframe[data-scene360-css-pack-loader]')).toHaveCount(0);
  expect(importRequestCount).toBe(0);
  expect(pageErrors).toEqual([]);
});

// Во время новой загрузки сохраняет прежнее превью, а после ошибки MIME заменяет его чёрным фоном.
test('Scene360 Editor отклоняет подменённые данные CSS-пакета', async function({ page }) {
  const pageErrors = collectPageErrors(page);
  const validCssPath = 'assets/360/valid-before-error-360.css';
  const cssPath = 'assets/360/invalid-test-360.css';
  const invalidCssSource = createScene360CssPackSource().replace('data:image/png;base64,', 'data:text/html;base64,');
  let releaseInvalidCssResponse;
  const invalidCssResponseGate = new Promise(function(resolve) {
    releaseInvalidCssResponse = resolve;
  });
  await openScene360Editor(page);
  await page.route(`${e2eServerOrigin}/${validCssPath}`, async function serveValidCssPanorama(route) {
    await route.fulfill({ status: 200, contentType: 'text/css; charset=utf-8', body: createScene360CssPackSource() });
  });
  await page.route(`${e2eServerOrigin}/${cssPath}`, async function serveInvalidCssPanorama(route) {
    await invalidCssResponseGate;
    await route.fulfill({ status: 200, contentType: 'text/css; charset=utf-8', body: invalidCssSource });
  });
  await page.locator('#story360Input').setInputFiles({
    name: 'story360.js',
    mimeType: 'text/javascript',
    buffer: Buffer.from(createScene360StorySource(validCssPath))
  });

  await expect(page.locator('#statusBox')).toContainText(`Панорама загружена: ${validCssPath}`);
  expect(await page.evaluate(function hasLoadedPanoramaTexture() {
    return Boolean(window.sphereMesh && window.sphereMesh.material && window.sphereMesh.material.map);
  })).toBe(true);
  await page.locator('#assetPathInput').fill(cssPath);
  await page.locator('#loadAssetPathBtn').click();
  await expect(page.locator('#statusBox')).toContainText(`Загрузка безопасного CSS-пакета: ${cssPath}`);
  expect(await page.evaluate(function keepsPreviousTextureWhileLoading() {
    return Boolean(window.sphereMesh && window.sphereMesh.material && window.sphereMesh.material.map);
  })).toBe(true);
  releaseInvalidCssResponse();
  await expect(page.locator('#statusBox')).toContainText('Первая часть CSS-пакета не содержит ожидаемый data:image base64');
  await expect(page.locator('iframe[data-scene360-css-pack-loader]')).toHaveCount(0);
  await expect(page.locator('script[data-scene360-legacy-pack]')).toHaveCount(0);
  expect(await page.evaluate(function readPanoramaFallbackMaterial() {
    var material = window.sphereMesh && window.sphereMesh.material;
    return {
      hasMap: Boolean(material && material.map),
      color: material && material.color ? material.color.getHex() : null,
      wireframe: Boolean(material && material.wireframe)
    };
  })).toEqual({ hasMap: false, color: 0x000000, wireframe: false });
  expect(pageErrors).toEqual([]);
});

// После успешного превью загружает панораму без file и проверяет тот же чёрный фон без остатка прежней текстуры.
test('Scene360 Editor показывает чёрный фон при отсутствии изображения', async function({ page }) {
  const pageErrors = collectPageErrors(page);
  const validCssPath = 'assets/360/valid-before-empty-360.css';
  await openScene360Editor(page);
  await page.route(`${e2eServerOrigin}/${validCssPath}`, async function serveValidCssPanorama(route) {
    await route.fulfill({ status: 200, contentType: 'text/css; charset=utf-8', body: createScene360CssPackSource() });
  });
  await page.locator('#story360Input').setInputFiles({
    name: 'story360-with-image.js',
    mimeType: 'text/javascript',
    buffer: Buffer.from(createScene360StorySource(validCssPath))
  });
  await expect(page.locator('#statusBox')).toContainText(`Панорама загружена: ${validCssPath}`);

  await page.locator('#story360Input').setInputFiles({
    name: 'story360-without-image.js',
    mimeType: 'text/javascript',
    buffer: Buffer.from(createScene360StorySource(''))
  });
  await expect(page.locator('#statusBox')).toContainText('Панорама загружена без file/src/path');
  expect(await page.evaluate(function readEmptyPanoramaMaterial() {
    var material = window.sphereMesh && window.sphereMesh.material;
    return {
      hasMap: Boolean(material && material.map),
      color: material && material.color ? material.color.getHex() : null
    };
  })).toEqual({ hasMap: false, color: 0x000000 });
  expect(pageErrors).toEqual([]);
});

// Проверяет одинаковый запрет внешних схем и выхода из проекта через общее поле пути без скрытого legacy-интерфейса.
test('Scene360 Editor отклоняет опасные пути пакетов', async function({ page }) {
  const pageErrors = collectPageErrors(page);
  await openScene360Editor(page);

  await page.locator('#assetPathInput').fill('https://example.invalid/evil-360.js');
  await page.locator('#loadAssetPathBtn').click();
  await expect(page.locator('#statusBox')).toContainText('только относительные пути внутри проекта');

  await page.locator('#assetPathInput').fill('../assets/360/evil-360.js');
  await page.locator('#loadAssetPathBtn').click();
  await expect(page.locator('#statusBox')).toContainText('через `..` запрещён');
  expect(pageErrors).toEqual([]);
});

// Ограничивает редактируемые ID и проверяет, что Space.Panorama переходит в явное пространство и так же экспортируется.
test('Scene360 Editor поддерживает однозначный переход между пространствами', async function({ page }) {
  const pageErrors = collectPageErrors(page);
  await openScene360Editor(page);
  await page.locator('#story360Input').setInputFiles({
    name: 'story360-cross-space.js',
    mimeType: 'text/javascript',
    buffer: Buffer.from(createScene360CrossSpaceStorySource())
  });

  const markItem = page.locator('.point-item').first();
  const markIdInput = markItem.locator('input[title="ID метки"]');
  const targetInput = markItem.locator('input[placeholder="Panorama или Space.Panorama"]');
  await expect(targetInput).toHaveValue('B.P2');

  await page.locator('#spaceIdInput').fill('A-Я_1');
  await page.locator('#panoramaIdInput').fill('P-Я_3');
  await page.locator('#panoramaIdInput').press('Enter');
  expect(await page.evaluate(function readAutomaticallyRenamedPanorama() {
    return Boolean(window.story360Data.spaces.A1 && window.story360Data.spaces.A1.panoramas.P3);
  })).toBe(true);
  await markIdInput.fill('to-Б_2');
  await markIdInput.blur();
  await targetInput.fill('B..P2');

  await expect(page.locator('#spaceIdInput')).toHaveValue('A1');
  await expect(page.locator('#panoramaIdInput')).toHaveValue('P3');
  await expect(markIdInput).toHaveValue('to2');
  await expect(targetInput).toHaveValue('B.P2');

  await markItem.getByRole('button', { name: 'Перейти', exact: true }).click();
  await expect(page.locator('#spaceIdInput')).toHaveValue('B');
  await expect(page.locator('#panoramaIdInput')).toHaveValue('P2');

  await page.locator('#spaceIdInput').fill('A1');
  await page.locator('#panoramaIdInput').fill('P3');
  await page.locator('#panoramaIdInput').press('Enter');
  await expect(page.locator('#spaceIdInput')).toHaveValue('B');
  await expect(page.locator('#panoramaIdInput')).toHaveValue('P2');
  await expect(page.locator('#panoramaAutosaveStatus')).toContainText('уже существует');

  const exportedTarget = await page.evaluate(function readCrossSpaceTarget() {
    return window.story360Data.spaces.A1.panoramas.P3.marks[0].target;
  });
  expect(exportedTarget).toEqual({ type: '360', panorama: 'P2', space: 'B' });
  expect(pageErrors).toEqual([]);
});

// Закрепляет временное отсутствие JS-управления в DOM, сохраняя legacy-функции для возможного возврата.
test('Scene360 Editor скрывает элементы управления legacy JS-пакетами', async function({ page }) {
  const pageErrors = collectPageErrors(page);
  await openScene360Editor(page);

  await expect(page.locator('#packFileInput')).toHaveCount(0);
  await expect(page.locator('#legacyPackModeInput')).toHaveCount(0);
  await expect(page.locator('#legacyPackWarning')).toHaveCount(0);
  expect(await page.evaluate(function readLegacyFunctionTypes() {
    return {
      safeReader: typeof window.loadPackFileSafely,
      trustedLoader: typeof window.ensurePackScriptLoaded
    };
  })).toEqual({ safeReader: 'function', trustedLoader: 'function' });
  expect(pageErrors).toEqual([]);
});

// Вызывает сохранённую функцию напрямую и проверяет безопасный разбор JS без возвращения скрытого файлового поля.
test('Scene360 Editor сохраняет безопасное чтение JS-пакета как внутреннюю функцию', async function({ page }) {
  const pageErrors = collectPageErrors(page);
  await openScene360Editor(page);
  await page.evaluate(function loadLegacyPackThroughRetainedFunction(source) {
    var file = new File([source], 'safe-preview-360.js', { type: 'text/javascript' });
    window.loadPackFileSafely(file);
  }, createScene360PackSource('sceneSafePackExecuted'));

  await expect(page.locator('#statusBox')).toContainText('безопасно прочитан без выполнения кода');
  await expect(page.locator('#statusBox')).toContainText('формат PNG');
  await expect(page.locator('body')).not.toHaveAttribute('data-scene-safe-pack-executed', '1');
  await expect(page.locator('script[data-scene360-legacy-pack]')).toHaveCount(0);
  expect(pageErrors).toEqual([]);
});

// Программно имитирует скрытый переключатель и закрепляет сохранённую проверку подтверждения для возможного возврата UI.
test('Scene360 Editor сохраняет подтверждение во внутренней legacy-функции', async function({ page }) {
  const pageErrors = collectPageErrors(page);
  const trustedPackSource = createScene360PackSource('sceneLegacyPackExecuted');
  await openScene360Editor(page);
  await page.route(`${e2eServerOrigin}/assets/360/trusted-test-360.js`, async function serveTrustedPack(route) {
    await route.fulfill({
      status: 200,
      contentType: 'text/javascript; charset=utf-8',
      body: trustedPackSource
    });
  });
  await page.locator('#assetPathInput').fill('assets/360/trusted-test-360.js');
  await page.evaluate(function enableRetainedLegacyFunctionForTest() {
    window.legacyPackModeInput = { checked: true };
  });

  page.once('dialog', async function dismissLegacyConfirmation(dialog) {
    expect(dialog.message()).toContain('Пакет получит доступ к странице редактора');
    await dialog.dismiss();
  });
  await page.locator('#loadAssetPathBtn').click();
  await expect(page.locator('#statusBox')).toContainText('отменено пользователем');
  await expect(page.locator('body')).not.toHaveAttribute('data-scene-legacy-pack-executed', '1');

  page.once('dialog', async function acceptLegacyConfirmation(dialog) {
    expect(dialog.message()).toContain('trusted-test-360.js');
    await dialog.accept();
  });
  await page.locator('#loadAssetPathBtn').click();
  await expect(page.locator('body')).toHaveAttribute('data-scene-legacy-pack-executed', '1');
  await expect(page.locator('#statusBox')).toContainText('Панорама загружена');
  await expect(page.locator('script[data-scene360-legacy-pack]')).toHaveCount(1);
  expect(pageErrors).toEqual([]);
});
