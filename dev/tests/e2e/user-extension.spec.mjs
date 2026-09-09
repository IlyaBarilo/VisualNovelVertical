import { expect, test } from '@playwright/test';
import { cp, mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { createServer } from 'node:http';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const repositoryRoot = fileURLToPath(new URL('../../../', import.meta.url));
const fixtureParent = path.join(repositoryRoot, 'dev/.playwright/user-extension');
const projectId = 'user-extension-e2e';
const storageKey = 'vn:user:example-analytics:' + projectId + ':1';
let fixtureRoot;
let server;
let origin;
let exampleSource;

// Сохраняет строгую политику file:// Firefox, чтобы не скрывать несовместимость автономного запуска.
test.use({ launchOptions: { firefoxUserPrefs: { 'security.fileuri.strict_origin_policy': true } } });

// Записывает только синтетические файлы своей копии, сохраняя CRLF.
async function writeFixture(name, source) {
  await writeFile(path.join(fixtureRoot, name), source.replace(/\r?\n/g, '\r\n'), 'utf8');
}

// Раздаёт только тестовую копию; путь проверяется до чтения, отсутствующие файлы получают настоящий 404.
async function serveFixture(request, response) {
  try {
    const pathname = decodeURIComponent(new URL(request.url, 'http://localhost').pathname);
    const relativePath = pathname === '/' ? 'index.html' : pathname.slice(1);
    const target = path.resolve(fixtureRoot, relativePath);
    if (!target.startsWith(fixtureRoot + path.sep)) {
      response.writeHead(403).end();
      return;
    }
    const source = await readFile(target);
    const mime = target.endsWith('.html') ? 'text/html' : target.endsWith('.css') ? 'text/css' : 'text/javascript';
    response.writeHead(200, { 'Content-Type': mime + '; charset=utf-8', 'Cache-Control': 'no-store' });
    response.end(source);
  } catch (error) {
    response.writeHead(404).end();
  }
}

// Копирует runtime без личных файлов и медиа, создаёт лёгкий сценарий и отдельный HTTP-origin.
test.beforeAll(async function prepareExtensionFixture() {
  test.setTimeout(60_000);
  await mkdir(fixtureParent, { recursive: true });
  fixtureRoot = await mkdtemp(path.join(fixtureParent, 'project-'));
  for (const name of ['index.html', 'engine']) {
    await cp(path.join(repositoryRoot, name), path.join(fixtureRoot, name), { recursive: true });
  }
  await mkdir(path.join(fixtureRoot, 'lib'));
  for (const name of ['three.min.js', 'jsrsasign-all-min.js']) {
    await cp(path.join(repositoryRoot, 'lib', name), path.join(fixtureRoot, 'lib', name));
  }
  const story = '[meta]\ntitle = Расширение\nprojectId = ' + projectId + '\nlang = ru\nmode = release\nautosave = false\ntransition = none\nstartScene = intro\n[scene]\nscene intro\n"Начало"\n"Продолжение"';
  await writeFixture('story.js', 'window.STORY_TEXT = ' + JSON.stringify(story) + ';');
  exampleSource = await readFile(path.join(repositoryRoot, 'user-example.js'), 'utf8');
  server = createServer(serveFixture);
  await new Promise(function listen(resolve) { server.listen(0, '127.0.0.1', resolve); });
  origin = 'http://127.0.0.1:' + server.address().port;
});

// Отсутствие расширения — исходное состояние; каждый тест явно задаёт свой user.js.
test.beforeEach(async function resetExtension() {
  await rm(path.join(fixtureRoot, 'user.js'), { force: true });
});

// Закрывает сервер и удаляет только свою проверенную временную копию.
test.afterAll(async function cleanExtensionFixture() {
  test.setTimeout(60_000);
  if (server) await new Promise(function close(resolve) { server.close(resolve); });
  if (fixtureRoot && path.dirname(fixtureRoot) === fixtureParent && path.basename(fixtureRoot).startsWith('project-')) {
    await rm(fixtureRoot, { recursive: true, force: true });
  }
});

// Не ждёт события load: необязательный сетевой скрипт может ещё загружаться при уже работающей новелле.
async function openStory(page, protocol) {
  await page.goto(protocol === 'file' ? pathToFileURL(path.join(fixtureRoot, 'index.html')).href : origin, { waitUntil: 'domcontentloaded' });
  await expect(page.locator('#textBox')).toHaveText('Начало');
}

// Выдерживает защиту от повторного нажатия и проверяет реальное продвижение истории.
async function advanceStory(page) {
  await page.waitForTimeout(350);
  await page.locator('#dialog').click({ position: { x: 15, y: 15 } });
  await expect(page.locator('#textBox')).toHaveText('Продолжение');
}

for (const protocol of ['http', 'file']) {
  // Отсутствие user.js не подменяет сценарий ошибкой и не создаёт пустой интерфейс.
  test(`${protocol}: отсутствие расширения не мешает истории`, async function({ page }) {
    await openStory(page, protocol);
    await advanceStory(page);
    await expect(page.locator('#vn-user-root')).toHaveCount(0);
  });

  // Проверяет момент init, отсутствие повторной инициализации при restart и непроницаемость авторских кликов для сцены.
  test(`${protocol}: init один раз, API и управление сценой`, async function({ page }) {
    await writeFixture('user.js', `
      window.userExecuted = true;
      window.VN_USER = {
        // Запоминает контракт и добавляет кнопку за пределами обработчиков сцены.
        init: function(api) {
          window.userInitCount = (window.userInitCount || 0) + 1;
          window.userApiState = { version: api.version, projectId: api.projectId, local: api.isLocal, ready: window.VN_ENGINE_READY, frozen: Object.isFrozen(api) };
          var button = document.createElement('button');
          button.textContent = 'Авторская кнопка';
          button.style.cssText = 'position:absolute;top:120px;left:16px;pointer-events:auto;';
          // Считает только собственные нажатия, не управляя движком.
          button.onclick = function() { button.dataset.clicks = String(Number(button.dataset.clicks || 0) + 1); };
          api.root.appendChild(button);
        }
      };`);
    await openStory(page, protocol);
    const button = page.getByRole('button', { name: 'Авторская кнопка' });
    await expect(button).toBeVisible();
    await button.click();
    await button.press('Enter');
    await expect(button).toHaveAttribute('data-clicks', '2');
    await expect(page.locator('#textBox')).toHaveText('Начало');
    expect(await page.evaluate(function readApi() { return window.userApiState; })).toEqual({ version: 1, projectId, local: protocol === 'file', ready: true, frozen: true });
    await advanceStory(page);
    await page.locator('#btnRestart').click();
    await expect(page.locator('#textBox')).toHaveText('Начало');
    expect(await page.evaluate(function readInitCount() { return [window.userExecuted, window.userInitCount]; })).toEqual([true, 1]);
    await page.reload();
    await expect(button).toBeVisible();
    expect(await page.evaluate(function readReloadCount() { return window.userInitCount; })).toBe(1);
  });

  for (const [kind, result] of [['throw', 'throw new Error("init failure")'], ['reject', 'return Promise.reject(new Error("init failure"))']]) {
    // Исключение и отказ Promise должны убрать частичный UI, не останавливая новеллу.
    test(`${protocol}: ошибка init ${kind} не ломает историю`, async function({ page }) {
      const warnings = [];
      // Сохраняет только диагностику расширения.
      page.on('console', function recordWarning(message) { if (message.type() === 'warning') warnings.push(message.text()); });
      await writeFixture('user.js', 'window.VN_USER = { init: function(api) { api.root.textContent = "Частичный UI"; ' + result + '; } };');
      await openStory(page, protocol);
      await expect.poll(function readWarning() { return warnings.some(function isUserWarning(value) { return value.includes('[User]') && value.includes('init failure'); }); }).toBe(true);
      await expect(page.locator('#vn-user-root')).toHaveCount(0);
      await advanceStory(page);
    });
  }

  // Пример не делает внешних запросов, сохраняет оба ответа и останавливает заглушку при отзыве разрешения.
  test(`${protocol}: пример — выбор, F5, отзыв и отсутствие сети`, async function({ page }) {
    await writeFixture('user.js', exampleSource);
    const external = [];
    const logs = [];
    // Внешняя сеть запрещена в тесте; локальные runtime-запросы продолжаются как обычно.
    page.on('request', function recordRequest(request) { if (/^https?:/.test(request.url()) && !request.url().startsWith(origin + '/')) external.push(request.url()); });
    // Собирает вызовы обеих заглушек, чтобы доказать порядок обработки выбора.
    page.on('console', function recordAnalytics(message) { if (message.text().startsWith('[ExampleAnalytics]')) logs.push(message.text()); });
    await openStory(page, protocol);
    const panel = page.locator('.vn-example-notice');
    const accept = page.getByRole('button', { name: 'Разрешить в примере' });
    const decline = page.getByRole('button', { name: 'Отказаться', exact: true });
    const reopen = page.getByRole('button', { name: 'Изменить выбор' });
    await expect(panel).toBeVisible();
    expect(logs).toEqual([]);
    await decline.click();
    await expect(reopen).toBeFocused();
    expect(logs).toEqual([]);
    await page.reload();
    await expect(reopen).toBeVisible();
    await expect(panel).toBeHidden();
    expect(logs).toEqual([]);
    await reopen.click();
    await expect(decline).toBeFocused();
    await accept.press('Enter');
    expect(await page.evaluate(function readChoice(key) { return localStorage.getItem(key); }, storageKey)).toBe('accepted');
    expect(logs.length).toBe(protocol === 'http' ? 1 : 0);
    await page.reload();
    await expect(reopen).toBeVisible();
    expect(logs.length).toBe(protocol === 'http' ? 2 : 0);
    await reopen.click();
    await decline.click();
    expect(logs.length).toBe(protocol === 'http' ? 3 : 0);
    if (protocol === 'http') expect(logs[2]).toContain('отключает');
    await page.reload();
    await expect(reopen).toBeVisible();
    expect(logs.length).toBe(protocol === 'http' ? 3 : 0);
    expect(await page.evaluate(function readDecline(key) { return localStorage.getItem(key); }, storageKey)).toBe('declined');
    await advanceStory(page);
    expect(external).toEqual([]);
  });

  // Блокировка localStorage не означает согласия и не ломает работу кнопок или сцены.
  test(`${protocol}: пример работает без localStorage`, async function({ page }) {
    await writeFixture('user.js', exampleSource);
    await page.addInitScript(function blockStorage() {
      // Имитирует браузерный запрет чтения и записи, не затрагивая остальные API.
      Object.defineProperty(window, 'localStorage', { get: function unavailableStorage() { throw new Error('storage blocked'); } });
    });
    await openStory(page, protocol);
    await page.getByRole('button', { name: 'Отказаться', exact: true }).click();
    await expect(page.getByRole('button', { name: 'Изменить выбор' })).toBeVisible();
    await page.reload();
    await expect(page.locator('.vn-example-notice')).toBeVisible();
    await page.getByRole('button', { name: 'Отказаться', exact: true }).click();
    await advanceStory(page);
  });
}

// Задержка доставки файла и никогда не завершающийся init не блокируют уже подготовленный интерфейс истории.
test('http: медленная загрузка и незавершённый init не задерживают историю', async function({ page }) {
  let releaseScript;
  const gate = new Promise(function waitForRelease(resolve) { releaseScript = resolve; });
  await page.route('**/user.js', async function delayScript(route) {
    await gate;
    await route.fulfill({ contentType: 'text/javascript', body: 'window.VN_USER = { init: function(api) { api.root.dataset.started = "yes"; return new Promise(function() {}); } };' });
  });
  try {
    await openStory(page, 'http');
    await advanceStory(page);
  } finally {
    releaseScript();
  }
  await expect(page.locator('#vn-user-root')).toHaveAttribute('data-started', 'yes');
  await page.locator('#btnRestart').click();
  await expect(page.locator('#textBox')).toHaveText('Начало');
});

// Некорректный файл диагностируется отдельно от обязательного runtime.
test('http: синтаксическая ошибка user.js не заменяет историю сообщением bootstrap', async function({ page }) {
  await writeFixture('user.js', 'window.VN_USER = ;');
  const errors = [];
  // Сохраняет фактическую синтаксическую ошибку браузера.
  page.on('pageerror', function recordError(error) { errors.push(error.message); });
  await openStory(page, 'http');
  await advanceStory(page);
  expect(errors.length).toBeGreaterThan(0);
  await expect(page.locator('#vn-user-root')).toHaveCount(0);
});

// Отзыв в другой вкладке останавливает уже запущенную заглушку текущей страницы.
test('http: пример синхронизирует отзыв между вкладками', async function({ page, context }) {
  await writeFixture('user.js', exampleSource);
  await openStory(page, 'http');
  const logs = [];
  // Считает остановки текущей вкладки, вызванные внешним storage-событием.
  page.on('console', function recordStop(message) { if (message.text().includes('[ExampleAnalytics]') && message.text().includes('отключает')) logs.push(message.text()); });
  await page.getByRole('button', { name: 'Разрешить в примере' }).click();
  const other = await context.newPage();
  await openStory(other, 'http');
  await other.getByRole('button', { name: 'Изменить выбор' }).click();
  await other.getByRole('button', { name: 'Отказаться', exact: true }).click();
  await expect.poll(function readStops() { return logs.length; }).toBe(1);
  await other.close();
});

// На узком экране все кнопки остаются видимыми, а корневой слой не увеличивает ширину страницы.
test('http: пример помещается на мобильном экране', async function({ page }, testInfo) {
  await page.setViewportSize({ width: 320, height: 568 });
  await writeFixture('user.js', exampleSource);
  await openStory(page, 'http');
  await expect(page.locator('.vn-example-notice')).toBeVisible();
  const bounds = await page.locator('.vn-example-notice').boundingBox();
  expect(bounds.x).toBeGreaterThanOrEqual(0);
  expect(bounds.x + bounds.width).toBeLessThanOrEqual(320);
  expect(bounds.y).toBeGreaterThanOrEqual(0);
  expect(bounds.y + bounds.height).toBeLessThanOrEqual(568);
  await expect(page.getByRole('button', { name: 'Отказаться', exact: true })).toBeInViewport();
  await page.screenshot({ path: testInfo.outputPath('user-example-mobile.png') });
});
