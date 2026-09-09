/*
 * Учебный пример пользовательского интерфейса и обработки выбора посетителя.
 * Для запуска скопируйте этот файл в user.js рядом с index.html.
 * ExampleAnalytics — вымышленный сервис: внешние скрипты не загружаются,
 * данные никуда не отправляются, cookies не создаются. Выбор сохраняется в localStorage.
 *
 * Это не готовое решение для соблюдения законодательства и не юридическая рекомендация.
 * До публикации самостоятельно проверьте применимые требования, тексты уведомлений,
 * соглашения и политику обработки данных, получение, хранение и отзыв согласия.
 * Сверяйтесь с актуальной официальной документацией выбранного реального сервиса.
 * Замена заглушек требует собственной проверки, в том числе сетевых запросов до выбора,
 * после отказа и после отзыва. Один баннер и сохранённый флаг не обеспечивают соответствия требованиям.
 */
(function() {
  "use strict";

  // Настройки демонстрации: адрес документа заполните только после подготовки собственной политики.
  var settings = {
    policyUrl: "",
    choiceVersion: "1",
    title: "Учебный пример уведомления",
    message: "ExampleAnalytics — вымышленный сервис. Данные никуда не отправляются. Этот пример сохраняет только ваш выбор в браузере."
  };

  // Создаёт авторский интерфейс один раз; встроенные стили используют оформление и переменные самой новеллы.
  function init(api) {
    var root = api.root;
    if (root.querySelector(".vn-example-notice")) return;
    // Путь страницы разделяет проекты без projectId; новая версия выбора не наследует прежнее разрешение.
    var projectKey = api.projectId || window.location.pathname;
    var storageKey = "vn:user:example-analytics:" + encodeURIComponent(projectKey) + ":" + settings.choiceVersion;
    var analyticsStarted = false;
    var choice = readChoice();

    // Загружает только известные значения; запрет хранилища не мешает UI и не означает согласия.
    function readChoice() {
      try {
        var saved = window.localStorage.getItem(storageKey);
        return saved === "accepted" || saved === "declined" ? saved : "";
      } catch (error) {
        // В приватном режиме и при file:// хранилище может быть недоступно; выбор действует до обновления страницы.
        return "";
      }
    }

    // Запоминает ответ отдельно от автосохранения истории; при запрете записи сохраняет выбор только в памяти.
    function saveChoice(value) {
      choice = value;
      try {
        window.localStorage.setItem(storageKey, value);
      } catch (error) {
        // Отказ localStorage не должен ломать кнопки или запуск новеллы.
      }
    }

    // Заглушка подключения: реальный сервис автор загружает здесь только после требуемого согласия.
    function connectAnalytics() {
      if (analyticsStarted || api.isLocal) return;
      analyticsStarted = true;
      // В реальной интеграции отдельно проверьте режим разработки, повторный запуск и ошибки загрузки сервиса.
      console.info("[ExampleAnalytics] Здесь автор подключает выбранный сервис. Пример ничего не загружает и не отправляет.");
    }

    // Заглушка отзыва: автор обязан реализовать остановку сервиса и необходимые действия с данными по его документации.
    function disconnectAnalytics() {
      if (!analyticsStarted) return;
      analyticsStarted = false;
      // Одного удаления флага недостаточно, чтобы остановить уже подключённый реальный счётчик.
      console.info("[ExampleAnalytics] Здесь автор отключает выбранный сервис. В примере сервис отсутствует.");
    }

    var style = document.createElement("style");
    // Цвета повторяют диалог и варианты выбора; общие переменные сохраняют радиусы, отступы и blur новеллы.
    // Селекторы ограничены контейнером; нижняя граница шрифта сохраняет читаемость уведомления на маленьком экране.
    style.textContent = `
#vn-user-root .vn-example-notice, #vn-user-root .vn-example-reopen {
  pointer-events: auto; font-family: inherit; font-size: clamp(14px, 1rem, 24px);
  line-height: var(--dialog-text-line-height, 1.4); color: #fff;
  background: rgba(0,0,0,0.60);
  border: max(1px, var(--ui-border-width, 1px)) solid rgba(255,255,255,0.14);
  border-radius: calc(var(--choice-radius, 0.95em) + 0.2em);
  box-shadow: 0 var(--choice-panel-shadow-y, 10px) var(--choice-panel-shadow-blur, 30px) rgba(0,0,0,0.28);
  backdrop-filter: blur(calc(var(--dialogBackdropBlur, 5px) * var(--viewportScale, 1)));
  -webkit-backdrop-filter: blur(calc(var(--dialogBackdropBlur, 5px) * var(--viewportScale, 1)));
}
#vn-user-root .vn-example-notice {
  position: absolute; bottom: max(16px, var(--dialog-bottom-gap, 0px), env(safe-area-inset-bottom, 0px));
  left: max(16px, env(safe-area-inset-left, 0px)); right: max(16px, env(safe-area-inset-right, 0px));
  width: auto; max-width: 36em; margin: 0 auto; padding: var(--dialog-padding, 0.95em);
  max-height: 65vh; overflow: auto; overscroll-behavior: contain;
}
#vn-user-root .vn-example-notice h2 {
  margin: 0 0 0.75em; font-size: 1em; font-weight: 700; line-height: 1.35;
  letter-spacing: 0.04em; text-align: center; text-transform: uppercase;
  opacity: 0.92; text-shadow: 0 1px 2px rgba(0,0,0,0.6);
}
#vn-user-root .vn-example-notice p { margin: 0 0 1em; }
#vn-user-root .vn-example-notice a { color: inherit; text-underline-offset: 0.2em; overflow-wrap: anywhere; }
#vn-user-root .vn-example-actions { display: flex; flex-wrap: wrap; gap: max(8px, var(--choices-gap, 0.85em)); margin-top: 1em; }
#vn-user-root .vn-example-actions button, #vn-user-root .vn-example-reopen {
  display: inline-flex; align-items: center; justify-content: center;
  font: inherit; line-height: 1.35; color: #fff; background: rgba(0,0,0,0.40);
  border: max(1px, var(--choice-border-width, 1px)) solid rgba(255,255,255,0.18);
  border-radius: var(--choice-radius, 0.95em);
  padding: var(--choice-padding-y, 1em) var(--choice-padding-x, 1.15em);
  min-height: 44px; cursor: pointer;
  transition: background 0.15s ease, border-color 0.15s ease, transform 0.15s ease;
}
#vn-user-root .vn-example-actions button { flex: 1 1 10em; }
#vn-user-root .vn-example-actions button:hover, #vn-user-root .vn-example-reopen:hover,
#vn-user-root .vn-example-actions button:focus-visible, #vn-user-root .vn-example-reopen:focus-visible {
  border-color: rgba(255,255,255,0.32); transform: translateY(-1px);
}
#vn-user-root .vn-example-notice :focus-visible, #vn-user-root .vn-example-reopen:focus-visible {
  outline: 3px solid rgba(255,255,255,0.95); outline-offset: 2px;
}
#vn-user-root .vn-example-reopen {
  position: absolute; right: max(16px, env(safe-area-inset-right, 0px));
  bottom: max(16px, env(safe-area-inset-bottom, 0px)); font-size: clamp(12px, 0.85rem, 20px);
  background: rgba(0,0,0,0.55);
  border-radius: var(--control-radius, 0.78em);
  padding: var(--control-padding-y, 0.72em) var(--control-padding-x, 1.12em);
}
#vn-user-root .vn-example-notice[hidden], #vn-user-root .vn-example-reopen[hidden] { display: none; }
`;
    root.appendChild(style);

    var panel = document.createElement("section");
    panel.className = "vn-example-notice";
    panel.id = "vn-example-notice";
    panel.setAttribute("role", "region");
    panel.setAttribute("aria-labelledby", "vn-example-notice-title");
    var title = document.createElement("h2");
    title.id = "vn-example-notice-title";
    title.textContent = settings.title;
    var message = document.createElement("p");
    message.textContent = settings.message;
    panel.appendChild(title);
    panel.appendChild(message);

    // Пустая настройка не создаёт фиктивную ссылку на отсутствующий документ.
    if (settings.policyUrl) {
      var policy = document.createElement("a");
      policy.href = settings.policyUrl;
      policy.textContent = "Политика обработки данных";
      policy.target = "_blank";
      policy.rel = "noopener noreferrer";
      panel.appendChild(policy);
    }

    var actions = document.createElement("div");
    actions.className = "vn-example-actions";
    var accept = document.createElement("button");
    accept.type = "button";
    accept.textContent = "Разрешить в примере";
    var decline = document.createElement("button");
    decline.type = "button";
    decline.textContent = "Отказаться";
    actions.appendChild(accept);
    actions.appendChild(decline);
    panel.appendChild(actions);

    var reopen = document.createElement("button");
    reopen.type = "button";
    reopen.className = "vn-example-reopen";
    reopen.textContent = "Изменить выбор";
    reopen.setAttribute("aria-controls", panel.id);
    root.appendChild(panel);
    root.appendChild(reopen);

    // Скрывает уведомление после явного ответа и сохраняет доступ к пересмотру выбора с клавиатуры.
    function closeNotice() {
      panel.hidden = true;
      reopen.hidden = false;
      reopen.setAttribute("aria-expanded", "false");
      reopen.focus({ preventScroll: true });
    }

    // Разрешение вызывает заглушку только после записи ответа; повторное разрешение не дублирует подключение.
    accept.addEventListener("click", function acceptChoice() {
      saveChoice("accepted");
      connectAnalytics();
      closeNotice();
    });

    // Отказ также обрабатывает отзыв предыдущего разрешения в текущей вкладке.
    decline.addEventListener("click", function declineChoice() {
      saveChoice("declined");
      disconnectAnalytics();
      closeNotice();
    });

    // Открытие панели само по себе не изменяет ответ; посетитель выбирает новое действие явно.
    reopen.addEventListener("click", function reopenNotice() {
      panel.hidden = false;
      reopen.hidden = true;
      reopen.setAttribute("aria-expanded", "true");
      decline.focus({ preventScroll: true });
    });

    // Согласует открытые вкладки одного проекта; удаление или неизвестное значение требуют нового выбора.
    window.addEventListener("storage", function syncChoice(event) {
      if (event.key !== null && event.key !== storageKey) return;
      choice = readChoice();
      if (choice === "accepted") connectAnalytics();
      else disconnectAnalytics();
      panel.hidden = Boolean(choice);
      reopen.hidden = !choice;
      reopen.setAttribute("aria-expanded", String(!choice));
    });

    // До выбора и после отказа подключения нет; file:// всегда оставляет только демонстрационный интерфейс.
    panel.hidden = Boolean(choice);
    reopen.hidden = !choice;
    reopen.setAttribute("aria-expanded", String(!choice));
    if (choice === "accepted") connectAnalytics();
  }

  window.VN_USER = { init: init };
})();
