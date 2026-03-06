/* engine.js
   Минимальный VN-движок: офлайн, без fetch, без модулей, максимум совместимости.
*/
(function () {
  "use strict";

  // ---------- DOM ----------
  var elTitle = document.getElementById("title");
  var elBg = document.getElementById("bgLayer");
  var elChar = document.getElementById("charLayer");
  var elOverlay = document.getElementById("overlay");

  var elDialog = document.getElementById("dialog");
  var elName = document.getElementById("nameBox");
  var elText = document.getElementById("textBox");
  var elChoices = document.getElementById("choices");

  var btnMute = document.getElementById("btnMute");
  var sliderVolume = document.getElementById("volume");
  var btnRestart = document.getElementById("btnRestart");

  var elGameModal = document.getElementById("gameModal");
  var elGameFrame = document.getElementById("gameFrame");
  var btnCloseGame = document.getElementById("btnCloseGame");

  var btnStats = document.getElementById("btnStats");
  var elStatsPanel = document.getElementById("statsPanel");
  var btnCloseStats = document.getElementById("btnCloseStats");
  var elStatsBody = document.getElementById("statsBody");

  // Новые DOM-элементы
  var elBlurBgLayer = document.getElementById("blurBgLayer");
  var elBlurBgImage = document.getElementById("blurBgImage");
  
  // Для отладки
  console.log('[Engine] blurBgLayer:', elBlurBgLayer);
  console.log('[Engine] blurBgImage:', elBlurBgImage);

  btnStats.addEventListener("click", function () {
    toggleStatsPanel();
  });

  btnCloseStats.addEventListener("click", function () {
    hideStatsPanel();
  });

  // клик по затемнению (вне карточки) — закрывает
  elStatsPanel.addEventListener("click", function (e) {
    if (e.target === elStatsPanel) hideStatsPanel();
  });

  // Клик по фону/персонажу/сцене тоже листает дальше
  var elStage = document.getElementById("stage");

  // чтобы клик по кнопкам/слайдеру/меню НЕ листал
  function isUiClick(target) {
    return !!(target.closest &&
      (target.closest(".topbar") ||
      target.closest("#choices") ||
      target.closest("#gameModal")));
  }

  elStage.addEventListener("click", function (e) {
    if (isUiClick(e.target)) return;
    onNext();
  });

  // (опционально) клик по всему приложению, если у вас stage не перекрывает всё
  var elApp = document.getElementById("app");
  elApp.addEventListener("click", function (e) {
    if (!elChoices.classList.contains("hidden")) return;
    if (isUiClick(e.target)) return;
    // если клик был по диалогу, он и так обработается — но дубль не страшен,
    // onNext сам проверяет waitingNext
    onNext();
  });



  // ---------- Проверка story ----------
  if (!window.STORY) {
    console.log('[Engine] Ожидание window.STORY...');
    elText.textContent = "Загрузка сценария...";
    
    // Ждём загрузки от story-loader.js
    window.__onStoryLoaded = function(story) {
      console.log('[Engine] Сценарий загружен, перезапускаем');
      
      // Обновляем STORY
      window.STORY = story;
      
      // Перестраиваем карту сцен
      buildSceneMap();
      
      // Обновляем заголовок
      if (story.meta && story.meta.title) {
        if (elTitle) elTitle.textContent = story.meta.title;
        document.title = story.meta.title;
      }

      applySpacingSettings();
      
      // Применяем настройки аудио
      setAudioFromStoryDefaults();
      
      // Запускаем сценарий
      restart();
    };
    
    return;
  }

  var STORY = window.STORY;
  console.log('[Engine] Сценарий найден сразу:', STORY.meta.title);


  // ========== ЗАМЕНИТЕ НА ЭТОТ КОД ==========
  console.log('[Engine] STORY.assets:', STORY.assets);
  if (STORY.assets) {
    console.log('[Engine] STORY.assets.backgrounds:', STORY.assets.backgrounds);
    console.log('[Engine] STORY.assets.characters:', STORY.assets.characters);
    console.log('[Engine] STORY.assets.audio:', STORY.assets.audio);
  } else {
    console.log('[Engine] STORY.assets is undefined!');
  }
  // ===========================================

  
  // Применяем настройки отступов
  applySpacingSettings();


  // =========================================================
  // НАСТРОЙКИ ИНТЕРФЕЙСА (масштаб)
  // =========================================================

  // Ручная коррекция масштаба интерфейса
  // 1.0 = стандарт
  // 0.9 = немного меньше
  // 1.1 = немного больше
  var UI_FONT_SCALE = 2;

  // Высота экрана, под которую делался дизайн
  // используется для автоадаптации
  var UI_REFERENCE_HEIGHT = 1920;


  // ---------- Состояние движка ----------
  var state = {
    // Текущая сцена
    sceneId: STORY.meta && STORY.meta.start ? STORY.meta.start : null,
    // Индекс текущего action внутри сцены
    actionIndex: 0,
    // Кэш для быстрого поиска сцен по id
    sceneMap: {},
    // Переменные (на будущее, для if/set и результатов мини-игр)
    vars: {},
    // Флаг: ждём ли клика "дальше"
    waitingNext: false,
    // Флаг: открыта ли мини-игра
    inGame: false,
    lastNextAt: 0,
    nextLocked: false
  };

  // Флаг для отслеживания первого диалога
  var isFirstDialog = true;

  // ---------- Аудио ----------
  // Один канал для фоновой музыки и отдельный для эффектов.
  var audio = {
    bgm: new Audio(),
    sfx: new Audio(),
    muted: true,
    masterVolume: 0.4,
    // для плавного затухания (если понадобится)
    fadeTimer: null
  };

  // Чтобы музыка не включалась слишком громко при старте
  audio.bgm.loop = true;
  setAudioFromStoryDefaults();

  applyUiScale();
  window.addEventListener("resize", applyUiScale);

  // ---------- Подготовка сцен ----------
  buildSceneMap();

  // Заголовок
  if (STORY.meta && STORY.meta.title) {
    if (elTitle) elTitle.textContent = STORY.meta.title;
    document.title = STORY.meta.title;
  }

  // ---------- UI события ----------
  // Блокируем всплытие события (защита от двойных кликов оболочки)
  elDialog.addEventListener("pointerup", function(e){
    if (e && typeof e.stopPropagation === "function") {
      e.stopPropagation();
    }
  }, true);

  // основной обработчик перехода
  elDialog.addEventListener("pointerup", function(e){

    console.log(
      "[VN] pointerup",
      "waitingNext:", state.waitingNext,
      "locked:", state.nextLocked,
      "scene:", state.sceneId,
      "actionIndex:", state.actionIndex
    );

    onNext(e);

  });


  elDialog.addEventListener("keydown", function (e) {
    // Enter / Space
    if (e.key === "Enter" || e.key === " ") {
      e.preventDefault();
      onNext();
    }
  });

  btnRestart.addEventListener("click", function () {
    restart();
  });

  btnMute.addEventListener("click", function () {
    audio.muted = !audio.muted;
    applyAudioSettings();
    updateMuteIcon();
  });

  sliderVolume.addEventListener("input", function () {
    var v = parseInt(sliderVolume.value, 10);
    if (isNaN(v)) v = 80;
    audio.masterVolume = clamp(v / 100, 0, 1);
    applyAudioSettings();
  });

  btnCloseGame.addEventListener("click", function () {
    // Закрытие игры без результата
    closeGame(null);
  });

  // Слушаем результаты мини-игр через postMessage
  window.addEventListener("message", function (event) {
    // В офлайн-режиме origin может быть "null".
    // Поэтому здесь делаем проверку максимально простую:
    // ждём объект с type === 'gameResult'
    if (!event || !event.data) return;
    var data = event.data;
    if (data.type === "gameResult") {
      closeGame(data);
    }
  });

  // ---------- Старт ----------
  restart();

  // =========================================================
  //                   ОСНОВНЫЕ ФУНКЦИИ
  // =========================================================

  function restart() {
    // Никаких сохранений: просто сбрасываем переменные и идём в start.
    state.vars = {};
    state.inGame = false;
    hideChoices();
    closeGameFrameVisualOnly();
    hideOverlay();

    // Сбрасываем флаг первого диалога и класс диалога
    isFirstDialog = true;
    var dialogElement = document.getElementById('dialog');
    if (dialogElement) {
      dialogElement.classList.remove('no-hint', 'has-hint', 'has-name', 'no-name');
    }

    // сброс к стартовой сцене
    state.sceneId = STORY.meta && STORY.meta.start ? STORY.meta.start : null;
    state.actionIndex = 0;
    state.waitingNext = false;

    // (по желанию) останавливаем звук при рестарте:
    // но у вас музыка должна играть фоном -> оставим как есть?
    // Я сделаю так: если в start-сцене есть bgm action, она сама запустит.
    stopBgmImmediate();

    // Сбрасываем размытый фон
    if (elBlurBgLayer) { // Добавляем проверку
      if (STORY.meta && STORY.meta.blurBackground) {
        updateBlurBackground(elBg.src);
      } else {
        elBlurBgLayer.classList.add("hidden");
      }
    }

    runCurrent();
  }

  function runCurrent() {
    console.log(
      "[VN] runCurrent",
      "scene:", state.sceneId,
      "index:", state.actionIndex
    );

    // Запускаем выполнение action'ов, пока не дойдём до "say/text/choice/game", где нужно ждать.
    state.waitingNext = false;

    // безопасность: если сцены нет
    var scene = state.sceneMap[state.sceneId];
    if (!scene) {
      showError("Не найдена сцена: " + state.sceneId);
      return;
    }

    // обработка списка actions
    while (true) {
      // если открыта игра — не продолжаем
      if (state.inGame) return;

      // если дошли до конца сцены — по умолчанию перезапуск
      if (state.actionIndex >= scene.actions.length) {
        // для публичного экрана удобно возвращать в начало
        state.sceneId = STORY.meta && STORY.meta.start ? STORY.meta.start : state.sceneId;
        state.actionIndex = 0;
        scene = state.sceneMap[state.sceneId];
        if (!scene) {
          showError("Не найдена сцена: " + state.sceneId);
          return;
        }
        continue;
      }

      var action = scene.actions[state.actionIndex];
      state.actionIndex++;

      if (!action || !action.type) continue;

      var shouldWait = executeAction(action);
      if (shouldWait) {
        state.waitingNext = true;
        state.nextLocked = false; // готов принять ОДИН next
        return;
      }
    }
  }

  function onNext(e) {
    if (!elChoices.classList.contains("hidden")) return;
    if (state.inGame) return;
    if (!state.waitingNext) return;

    // Разрешаем только один "next" до следующего say/text
    if (state.nextLocked) return;
    state.nextLocked = true;

    // Защита от двойных событий (click после pointerup и т.п.)
    if (e && typeof e.preventDefault === "function") e.preventDefault();

    state.waitingNext = false;
    runCurrent();
  }

  // =========================================================
  //                   ACTION EXECUTION
  // =========================================================

  // Возвращает true, если надо "ждать" (клик дальше/выбор/игра)
  function executeAction(action) {
    console.log(
      "[VN] action",
      action.type,
      "scene:", state.sceneId,
      "index:", state.actionIndex - 1,
      action
    );

    switch (action.type) {
      case "bg":
        setBackground(resolveAsset(action.src));
        return false;

      case "char":
        console.log('[Engine CHAR] Processing char action:', action);

        // Новый формат: { type: "char", charId: "anna", emotion: "neutral" }
        if (action.charId) {

            console.log('[Engine CHAR] New format - charId:', action.charId, 'emotion:', action.emotion);
        
            // Проверяем структуру assets
            console.log('[Engine CHAR] STORY.assets:', STORY.assets);
            console.log('[Engine CHAR] STORY.assets.characters:', STORY.assets?.characters);

            if (STORY.assets?.characters) {
                const char = STORY.assets.characters[action.charId];
                console.log('[Engine CHAR] Character data for', action.charId, ':', char);
                
                if (char?.images) {
                    console.log('[Engine CHAR] Available emotions:', Object.keys(char.images));
                    console.log('[Engine CHAR] Requested emotion:', action.emotion);
                    console.log('[Engine CHAR] Image path:', char.images[action.emotion]);
                }
            }

            const src = resolveAsset(null, action.charId, action.emotion);
            console.log('[Engine CHAR] Resolved src:', src);
            setCharacter(src, action.pos, action.charId);
        } else {
            // Старый формат для обратной совместимости
            console.log('[Engine CHAR] Old format - src:', action.src);
            const src = resolveAsset(action.src);
            console.log('[Engine CHAR] Resolved src (old):', src);
            setCharacter(resolveAsset(action.src), action.pos);
        }
        return false;

      case "say":
        // Новый формат: { type: "say", charVar: "anna", text: "..." }
        if (action.charVar && STORY.assets && STORY.assets.characters) {
          const char = STORY.assets.characters[action.charVar];
          console.log('[Engine] say charVar:', action.charVar);
          console.log('[Engine] char data:', char);
          
          if (char && char.name) {
            console.log('[Engine] showDialog with color:', char.color);
            showDialog(char.name, action.text, char.color);
          } else {
            console.log('[Engine] showDialog without color, using charVar as name');
            showDialog(action.charVar, action.text);
          }
        } else {
          // Старый формат
          console.log('[Engine] say old format:', action.name);
          showDialog(action.name, action.text);
        }
        return true;

      case "text":
        showDialog(null, action.text);
        return true;

      case "choice":
        showChoices(action.choices || []);
        return true;

      case "goto":
        gotoScene(action.target);
        return false;

      case "overlay":
        // опционально: показать/скрыть оверлей
        if (action.show) showOverlay(action.opacity);
        else hideOverlay();
        return false;

      case "bgm":
        playBgm(resolveAsset(action.src), !!action.loop, num(action.volume, 0.7), num(action.fadeMs, 0));
        return false;

      case "sfx":
        playSfx(resolveAsset(action.src), num(action.volume, 1));
        return false;

      case "set":
        // set: { key: "...", value: ... }
        if (action.key) state.vars[action.key] = action.value;
        return false;

      case "if":
        // if: { cond: "vars.score >= 3", then: "a", else: "b" }
        // ВНИМАНИЕ: без eval для безопасности. Поддержим только простую форму:
        // { key: "score", op: ">=", value: 3, then: "...", else: "..." }
        return executeIfSafe(action);

      case "game":
        // game: { id: "quiz1", src: "games/quiz1/index.html", onResult: { setKey: "quizScore", goto: "..." } }
        openGame(action);
        return true;

      default:
        // неизвестный action — пропускаем
        return false;
    }
  }

  function executeIfSafe(action) {
    // Поддержка безопасного if без eval:
    // { type:"if", key:"quizScore", op:">=", value:2, then:"good", else:"bad" }
    var key = action.key;
    var op = action.op;
    var expected = action.value;

    var actual = state.vars[key];

    var ok = compare(actual, op, expected);

    if (ok && action.then) gotoScene(action.then);
    if (!ok && action.else) gotoScene(action.else);

    return false;
  }

  function compare(a, op, b) {
    // приводим числа, если похоже на числа
    var an = toNumberMaybe(a);
    var bn = toNumberMaybe(b);
    var useNum = (an !== null && bn !== null);

    if (useNum) {
      a = an; b = bn;
    }

    switch (op) {
      case "==": return a == b; // eslint-disable-line eqeqeq
      case "===": return a === b;
      case "!=": return a != b; // eslint-disable-line eqeqeq
      case "!==": return a !== b;
      case ">": return a > b;
      case ">=": return a >= b;
      case "<": return a < b;
      case "<=": return a <= b;
      default: return false;
    }
  }

  function toNumberMaybe(x) {
    if (typeof x === "number") return x;
    if (typeof x === "string" && x.trim() !== "" && !isNaN(Number(x))) return Number(x);
    return null;
  }

  // =========================================================
  //                   СЦЕНЫ / ПЕРЕХОДЫ
  // =========================================================

  function buildSceneMap() {
    state.sceneMap = {};
    var scenes = STORY.scenes || [];
    for (var i = 0; i < scenes.length; i++) {
      var sc = scenes[i];
      if (sc && sc.id) state.sceneMap[sc.id] = sc;
    }
  }

  function gotoScene(sceneId) {
    console.log("[VN] goto scene ->", sceneId);
    if (!sceneId) return;
    state.sceneId = sceneId;
    state.actionIndex = 0;
  }

  // =========================================================
  //                   ВИЗУАЛ
  // =========================================================

  function setBackground(src) {
    if (!src) return;
    elBg.src = src;
    
    // Обновляем размытый фон тем же изображением
    if (typeof updateBlurBackground === 'function') {
      updateBlurBackground(src);
    }
    
    // Убираем принудительное применение стилей через JS
    // CSS должен работать сам через переменные
  }

  function setCharacter(src, pos, charId) {
    console.log('[Engine setCharacter] Called with:', { src, pos, charId });
    console.log('[Engine setCharacter] elChar element:', elChar);
    
    if (!src) {
        console.log('[Engine setCharacter] No src, hiding character');
        elChar.classList.add("hidden");
        elChar.src = "";
        setTimeout(adjustCharacterScale, 50); // небольшая задержка для загрузки изображения
        return;
    }
    
    console.log('[Engine setCharacter] Setting src:', src);
    elChar.src = src;
    elChar.classList.remove("hidden");
    
    // Проверяем, загрузилось ли изображение
    elChar.onload = function() {
        console.log('[Engine setCharacter] Image loaded successfully:', src);
    };
    elChar.onerror = function() {
        console.log('[Engine setCharacter] Image failed to load:', src);
    };
    
    // Сохраняем ID персонажа для возможного использования
    if (charId) {
        elChar.dataset.charId = charId;
    }

    // pos — опционально (например: "center", "left", "right")
    if (pos === "left") {
        elChar.style.left = "35%";
        elChar.style.transform = "translateX(-50%)";
    } else if (pos === "right") {
        elChar.style.left = "65%";
        elChar.style.transform = "translateX(-50%)";
    } else {
        elChar.style.left = "50%";
        elChar.style.transform = "translateX(-50%)";
    }
  }

  function showDialog(name, text, color) {
    console.log(
      "[VN] dialog",
      name ? name : "(text)",
      text
    );

    var dialogElement = document.getElementById('dialog');

    if (name && String(name).trim() !== "") {
      elName.textContent = name;
      elName.classList.remove("hidden");
      dialogElement.classList.add('has-name');
      dialogElement.classList.remove('no-name');

      // Устанавливаем только цвет текста, без бордера и тени
      if (color) {
        elName.style.color = color;
        elName.style.background = "rgba(0,0,0,0.5)"; // Полупрозрачный фон для читаемости
        elName.style.border = "1px solid rgba(255,255,255,0.12)"; // Стандартная рамка
        elName.style.textShadow = "none"; // Убираем тень
      } else {
        elName.style.color = ""; // Сброс на цвет по умолчанию из CSS
        elName.style.background = ""; // Сброс на фон из CSS
        elName.style.textShadow = ""; // Сброс тени
      }
    } else {
      elName.textContent = "";
      elName.classList.add("hidden");
      dialogElement.classList.remove('has-name');
      dialogElement.classList.add('no-name');
    }
    elText.textContent = text ? String(text) : "";

    // Управление подсказкой и классом диалога
    var hintElement = document.querySelector('.hint');
    var dialogElement = document.getElementById('dialog');
    
    if (hintElement && dialogElement) {
      if (isFirstDialog) {
        hintElement.style.display = 'block';
        dialogElement.classList.add('has-hint');
        dialogElement.classList.remove('no-hint');
        isFirstDialog = false;
      } else {
        hintElement.style.display = 'none';
        dialogElement.classList.remove('has-hint');
        dialogElement.classList.add('no-hint');
      }
    }
  }



  function showError(text) {
    setBackground(""); // не обязательно
    setCharacter(null);
    showDialog("Ошибка", text);
  }

  function showOverlay(opacity) {
    elOverlay.classList.remove("hidden");
    var o = (typeof opacity === "number") ? opacity : 0.35;
    elOverlay.style.background = "rgba(0,0,0," + clamp(o, 0, 1) + ")";
  }

  function hideOverlay() {
    elOverlay.classList.add("hidden");
  }

  // =========================================================
  //                   ВЫБОР
  // =========================================================

  function showChoices(choices) {
    // choices: [{ text, goto, set:{...}, sfx:"@audio.xxx" }, ...]
    if (!choices || !choices.length) return;

    // Убираем предыдущее сообщение, чтобы не мешало выбору
    showDialog(null, "");

    // Скрываем подсказку "нажмите" (не обязательно)
    // (оставим как есть)

    elChoices.innerHTML = "";
    elDialog.classList.add("hiddenByChoices");
    elChoices.classList.remove("hidden");

    for (var i = 0; i < choices.length; i++) {
      (function (choice) {
        var btn = document.createElement("button");
        btn.type = "button";
        btn.className = "choiceBtn";
        btn.textContent = choice.text || ("Выбор " + (i + 1));

        btn.addEventListener("click", function () {
          // звук на кнопку (если задан)
          if (choice.sfx) {
            playSfx(resolveAsset(choice.sfx), 1);
          }

          // применить set
          if (choice.set && typeof choice.set === "object") {
            for (var k in choice.set) {
              if (Object.prototype.hasOwnProperty.call(choice.set, k)) {
                state.vars[k] = choice.set[k];
              }
            }
          }

          hideChoices();

          // переход
          if (choice.goto) {
            gotoScene(choice.goto);
          }

          // продолжить выполнение
          state.waitingNext = false;
          runCurrent();
        });

        elChoices.appendChild(btn);
      })(choices[i]);
    }
  }

  function hideChoices() {
    elDialog.classList.remove("hiddenByChoices");
    elChoices.classList.add("hidden");
    elChoices.innerHTML = "";
  }

  // =========================================================
  //                   МИНИ-ИГРЫ
  // =========================================================

  function openGame(action) {
    // action: { id, src, onResult }
    if (!action || !action.src) return;

    state.inGame = true;
    elGameModal.classList.remove("hidden");

    // Загружаем игру в iframe
    elGameFrame.src = action.src;

    // Сохраним "обработчик" результата в state
    state.currentGame = {
      id: action.id || "game",
      onResult: action.onResult || null
    };
  }

  function closeGame(resultData) {
    // resultData может быть null или объектом { type:'gameResult', gameId, score, ... }

    // закрываем iframe и модалку
    closeGameFrameVisualOnly();
    state.inGame = false;

    // если результат пришёл — обработаем
    if (resultData && state.currentGame && state.currentGame.onResult) {
      var onResult = state.currentGame.onResult;

      // Пример onResult:
      // { setKey:"quizScore", from:"score", goto:"afterQuiz" }
      if (onResult.setKey) {
        var fromKey = onResult.from || "score";
        state.vars[onResult.setKey] = resultData[fromKey];
      }
      if (onResult.goto) {
        gotoScene(onResult.goto);
      }
    }

    state.currentGame = null;

    // продолжаем выполнение
    state.waitingNext = false;
    runCurrent();
  }

  function closeGameFrameVisualOnly() {
    elGameModal.classList.add("hidden");
    // "глушим" iframe (чтобы игра остановилась)
    elGameFrame.src = "about:blank";
  }

  // =========================================================
  //                   АУДИО
  // =========================================================

  function setAudioFromStoryDefaults() {

    if (STORY.audioSettings) {

      if (typeof STORY.audioSettings.masterVolume === "number") {
        audio.masterVolume = clamp(STORY.audioSettings.masterVolume, 0, 1);
      }

      if (typeof STORY.audioSettings.muted === "boolean") {
        audio.muted = STORY.audioSettings.muted;
      }

    }

    // установить положение слайдера
    sliderVolume.value = Math.round(audio.masterVolume * 100);

    // применить громкость
    applyAudioSettings();

    // обновить кнопку
    updateMuteIcon();
  }

  function updateMuteIcon() {
    btnMute.textContent = audio.muted ? "🔇" : "🔊";
  }

  function applyAudioSettings() {
    // общий volume применяется к обоим каналам
    var v = audio.muted ? 0 : audio.masterVolume;

    // ВАЖНО: индивидуальная громкость треков умножается на master
    // Поэтому тут ставим базово master, а конкретную громкость задаём в playBgm/playSfx.
    // Но чтобы не усложнять, мы держим "currentBgmVolume" отдельно.
    audio.bgm.volume = clamp((audio.currentBgmVolume != null ? audio.currentBgmVolume : 0.7) * v, 0, 1);
    audio.sfx.volume = clamp((audio.currentSfxVolume != null ? audio.currentSfxVolume : 1) * v, 0, 1);
  }

  function playBgm(src, loop, vol, fadeMs) {
    if (!src) return;

    audio.bgm.loop = loop !== false; // по умолчанию true
    audio.currentBgmVolume = clamp(vol, 0, 1);

    // Если тот же трек — просто обновим громкость/loop
    if (audio.bgm.src && endsWith(audio.bgm.src, src)) {
      applyAudioSettings();
      return;
    }

    // Плавная смена (по желанию)
    if (fadeMs && fadeMs > 0 && !audio.muted) {
      crossfadeToBgm(src, fadeMs);
      return;
    }

    // Быстрая смена
    try {
      audio.bgm.pause();
      audio.bgm.src = src;
      audio.bgm.currentTime = 0;
      applyAudioSettings();
      // В некоторых окружениях автозапуск может быть заблокирован до первого клика.
      // Но на интерактивном экране обычно пользователь кликает — после клика заведётся.
      audio.bgm.play().catch(function () {
        // молча игнорируем (безопасно для киоска)
      });
    } catch (e) {
      // игнор
    }
  }

  function stopBgmImmediate() {
    try {
      audio.bgm.pause();
      audio.bgm.src = "";
      audio.bgm.currentTime = 0;
    } catch (e) {}
  }

  function crossfadeToBgm(newSrc, fadeMs) {
    // Простой кроссфейд без WebAudio:
    // 1) приглушаем текущую BGM до 0
    // 2) переключаем src и поднимаем громкость
    clearInterval(audio.fadeTimer);

    var steps = 20;
    var stepTime = Math.max(20, Math.floor(fadeMs / steps));

    var master = audio.muted ? 0 : audio.masterVolume;
    var target = clamp(audio.currentBgmVolume * master, 0, 1);
    var i = 0;

    // текущая громкость
    var startVol = audio.bgm.volume;

    audio.fadeTimer = setInterval(function () {
      i++;
      var t = i / steps;
      audio.bgm.volume = lerp(startVol, 0, t);

      if (i >= steps) {
        clearInterval(audio.fadeTimer);
        audio.fadeTimer = null;

        // смена трека
        try {
          audio.bgm.pause();
          audio.bgm.src = newSrc;
          audio.bgm.currentTime = 0;
          audio.bgm.play().catch(function () {});
        } catch (e) {}

        // поднимаем громкость до target
        fadeInBgm(target, fadeMs);
      }
    }, stepTime);
  }

  function fadeInBgm(targetVol, fadeMs) {
    clearInterval(audio.fadeTimer);

    var steps = 20;
    var stepTime = Math.max(20, Math.floor(fadeMs / steps));
    var i = 0;

    audio.bgm.volume = 0;

    audio.fadeTimer = setInterval(function () {
      i++;
      var t = i / steps;
      audio.bgm.volume = lerp(0, targetVol, t);

      if (i >= steps) {
        clearInterval(audio.fadeTimer);
        audio.fadeTimer = null;
        audio.bgm.volume = targetVol;
      }
    }, stepTime);
  }

  function playSfx(src, vol) {
    if (!src) return;

    audio.currentSfxVolume = clamp(vol, 0, 1);

    try {
      audio.sfx.pause();
      audio.sfx.src = src;
      audio.sfx.currentTime = 0;
      applyAudioSettings();
      audio.sfx.play().catch(function () {});
    } catch (e) {
      // игнор
    }
  }

  // =========================================================
  //                   ASSET RESOLVE
  // =========================================================

  function resolveAsset(ref, charId, emotion) {
    console.log('[Engine resolveAsset] Called with:', { ref, charId, emotion });
    
    // СНАЧАЛА проверяем персонажей, если есть charId и emotion
    if (charId && emotion && STORY.assets && STORY.assets.characters) {
        console.log('[Engine resolveAsset] Looking for character:', charId, 'emotion:', emotion);
        
        const char = STORY.assets.characters[charId];
        console.log('[Engine resolveAsset] Character object:', char);
        
        if (char && char.images) {
            console.log('[Engine resolveAsset] Available emotions:', Object.keys(char.images));
            const imagePath = char.images[emotion];
            console.log('[Engine resolveAsset] Found image path:', imagePath);
            
            if (imagePath) {
                console.log('[Engine resolveAsset] Returning character path:', imagePath);
                return imagePath;
            } else {
                console.log('[Engine resolveAsset] Emotion not found:', emotion);
            }
        } else {
            console.log('[Engine resolveAsset] Character or images not found');
        }
    }
    
    // ТОЛЬКО ПОТОМ проверяем ref === null
    if (ref === null) {
        console.log('[Engine resolveAsset] ref is null, returning null');
        return null;
    }
    
    if (!ref) {
        console.log('[Engine resolveAsset] ref is empty, returning empty string');
        return "";
    }
    
    if (typeof ref !== "string") {
        console.log('[Engine resolveAsset] ref is not a string:', ref);
        return "";
    }
    
    // Если это прямой путь (не алиас)
    if (ref.indexOf("@") !== 0) {
        console.log('[Engine resolveAsset] ref is direct path:', ref);
        return ref;
    }
    
    // Обработка алиасов @bg.xxx, @audio.xxx
    var parts = ref.substring(1).split(".");
    if (parts.length < 2) {
        console.log('[Engine resolveAsset] Invalid alias format:', ref);
        return "";
    }
    
    var group = parts[0];
    var key = parts.slice(1).join(".");
    
    console.log('[Engine resolveAsset] Alias - group:', group, 'key:', key);
    
    if (!STORY.assets) {
        console.log('[Engine resolveAsset] STORY.assets is missing');
        return "";
    }
    
    if (group === "bg") {
        if (!STORY.assets.backgrounds) {
            console.log('[Engine resolveAsset] STORY.assets.backgrounds is missing');
            return "";
        }
        console.log('[Engine resolveAsset] Available backgrounds:', Object.keys(STORY.assets.backgrounds));
        const result = STORY.assets.backgrounds[key];
        console.log('[Engine resolveAsset] Found background:', result);
        return result || "";
    }
    
    if (group === "audio") {
        if (!STORY.assets.audio) {
            console.log('[Engine resolveAsset] STORY.assets.audio is missing');
            return "";
        }
        console.log('[Engine resolveAsset] Available audio:', Object.keys(STORY.assets.audio));
        const result = STORY.assets.audio[key];
        console.log('[Engine resolveAsset] Found audio:', result);
        return result || "";
    }
    
    console.log('[Engine resolveAsset] No match found for group:', group);
    return "";
  }


  // =========================================================
  // МАСШТАБ ИНТЕРФЕЙСА
  // =========================================================

  function applyUiScale() {

    // автоматический коэффициент по высоте экрана
    var autoScale = window.innerHeight / UI_REFERENCE_HEIGHT;

    // ограничиваем чтобы интерфейс не ломался
    autoScale = clamp(autoScale, 0.85, 1.25);

    // итоговый масштаб
    var finalScale = clamp(UI_FONT_SCALE * autoScale, 0.75, 1.4);

    // применяем к CSS
    document.documentElement.style.setProperty("--uiScale", finalScale);
  }

  // =========================================================
  // ДИНАМИЧЕСКОЕ МАСШТАБИРОВАНИЕ ПЕРСОНАЖЕЙ
  // =========================================================
  // Простая формула: персонаж занимает 80% от доступной высоты экрана
  // Доступная высота = высота окна - отступ сверху - отступ снизу
  // Таким образом персонаж всегда виден полностью и не перекрывается интерфейсом

  function adjustCharacterScale() {
    var charElement = document.getElementById('charLayer');
    if (!charElement || charElement.classList.contains('hidden')) return;
    
    // Получаем значения отступов из CSS переменных
    var topSpacing = parseInt(getComputedStyle(document.documentElement).getPropertyValue('--topSpacing')) || 0;
    var bottomSpacing = parseInt(getComputedStyle(document.documentElement).getPropertyValue('--bottomSpacing')) || 0;
    
    // Доступная высота = высота окна минус отступы
    var availableHeight = window.innerHeight - topSpacing - bottomSpacing;
    
    // Персонаж занимает ровно 80% от доступной высоты
    // 80% выбрано, чтобы:
    // - персонаж был крупным и хорошо видимым
    // - оставалось пространство над головой и под ногами
    // - диалоговое окно не перекрывало персонаж
    var charHeight = Math.round(availableHeight * 0.95);
    
    // Применяем высоту
    charElement.style.height = charHeight + 'px';
    charElement.style.width = 'auto'; // ширина подстроится пропорционально
    
    console.log('[Engine] Character scale:', {
      windowHeight: window.innerHeight,
      topSpacing: topSpacing,
      bottomSpacing: bottomSpacing,
      availableHeight: availableHeight,
      charHeight: charHeight,
      percent: Math.round(charHeight / window.innerHeight * 100) + '% от окна',
      percentAvailable: '80% от доступной'
    });
  }

  // Вызываем при загрузке изображения персонажа
  function setupCharacterLoadHandler() {
    var charElement = document.getElementById('charLayer');
    if (charElement) {
      charElement.addEventListener('load', function() {
        adjustCharacterScale();
      });
    }
  }

  // Вызываем при изменении размера окна
  window.addEventListener('resize', function() {
    adjustCharacterScale();
  });

  // Вызываем после загрузки страницы
  document.addEventListener('DOMContentLoaded', function() {
    setupCharacterLoadHandler();
    adjustCharacterScale();
  });

  // Также вызываем после смены персонажа в движке
  // В функции setCharacter, после установки src, добавьте вызов:
  // setTimeout(adjustCharacterScale, 50);

  
  // =========================================================
  //                   UTILS
  // =========================================================

  function clamp(x, a, b) {
    return Math.max(a, Math.min(b, x));
  }

  function num(x, fallback) {
    return (typeof x === "number" && !isNaN(x)) ? x : fallback;
  }

  function lerp(a, b, t) {
    return a + (b - a) * t;
  }

  function endsWith(full, ending) {
    // full может быть "file:///C:/.../assets/bgm.mp3"
    // ending "assets/bgm.mp3"
    // сравнение по хвосту
    try {
      return String(full).slice(-String(ending).length) === String(ending);
    } catch (e) {
      return false;
    }
  }









  function toggleStatsPanel() {
    if (elStatsPanel.classList.contains("hidden")) showStatsPanel();
    else hideStatsPanel();
  }

  function showStatsPanel() {
    // если открыта игра — не мешаем, можно запретить или просто показывать
    // здесь оставим показывать (по вашему желанию можно блокировать)
    renderStats();
    elStatsPanel.classList.remove("hidden");
  }

  function hideStatsPanel() {
    elStatsPanel.classList.add("hidden");
  }

  // Генерация статистики по STORY.
  // Сделано так, чтобы потом легко дописывать новые показатели: просто добавляете новые строки в statsLines.
  function renderStats() {

    // Показываем индикатор загрузки
    elStatsBody.value = "Анализ файлов...";
    
    // Асинхронно проверяем файлы
    checkAssetsFiles().then(fileStats => {
      var stats = computeStoryStats(STORY);
      var errors = validateStory(STORY);
      var textInfo = computeTextInfo(STORY);
      var reach = findUnreachableScenes(STORY);
      var cycles = findCyclesSCC(STORY);

      var text = "";

      text += "=== СТАТИСТИКА СЦЕНАРИЯ ===\n\n";
      text += "Название: " + (STORY.meta && STORY.meta.title ? STORY.meta.title : "(без названия)") + "\n";
      text += "Сцен: " + stats.sceneCount + "\n";
      text += "Меню выбора: " + stats.choiceCount + "\n\n";

      text += "=== ПРОВЕРКА ФАЙЛОВ ===\n\n";
        
      // Отсутствующие файлы - проверяем ВСЕГДА, независимо от наличия звука
      if (fileStats.missing.length > 0) {
        text += "❌ ОТСУТСТВУЮТ ФАЙЛЫ:\n";
        fileStats.missing.forEach(item => {
          text += `  ${item.path}\n`;
          if (item.refs) {
            item.refs.forEach(ref => text += `    используется в: ${ref}\n`);
          }
        });
        text += "\n";
      } else {
        text += "✅ Все файлы найдены\n\n";
      }
      
      // Ошибки размеров изображений
      if (fileStats.sizeErrors.length > 0) {
        text += "❌ ПРОБЛЕМЫ С РАЗМЕРАМИ ИЗОБРАЖЕНИЙ:\n\n";
        
        fileStats.sizeErrors.forEach(item => {
          text += `Файл: ${item.path}\n`;
          text += `  Текущий размер: ${item.width}×${item.height}\n`;
          if (item.category === 'bg') {
            text += `  Требуется: не менее 1080×1920\n`;
          } else if (item.category === 'char') {
            text += `  Требуется: не менее 500×1200\n`;
          }
          text += `  Проблемы: ${item.errors.join(', ')}\n`;
          if (item.refs) {
            text += `  Используется в: ${item.refs.join(', ')}\n`;
          }
          text += "\n";
        });
      } else {
        text += "✅ Все изображения соответствуют требованиям по размеру\n\n";
      }
      

      text += "=== СТАТИСТИКА ФАЙЛОВ ===\n\n";
      text += "Всего файлов: " + fileStats.files.length + "\n";
      
      // Подсчет изображений и аудио
      var imageCount = 0;
      var audioCount = 0;
      fileStats.files.forEach(f => {
        if (f.path.match(/\.(jpg|jpeg|png|gif|webp)$/i)) imageCount++;
        else if (f.path.match(/\.(mp3|wav|ogg|flac|m4a)$/i)) audioCount++;
      });
      
      text += "  Изображения: " + imageCount + "\n";
      text += "  Аудио: " + audioCount + "\n\n";

      


      text += "=== ОБЪЁМ ТЕКСТА ===\n\n";

      text += "Всего символов: " + textInfo.characters + "\n";
      text += "Всего слов: " + textInfo.words + "\n\n";


      text += "=== ИСПОЛЬЗОВАННЫЕ ФОНЫ ===\n";
      text += stats.usedBackgroundIds.join("\n") + "\n\n";

      text += "=== ИСПОЛЬЗОВАННЫЕ ПЕРСОНАЖИ ===\n";
      text += stats.usedCharacterIds.join("\n") + "\n\n";


      text += "=== ПРОВЕРКА СЦЕНАРИЯ ===\n";

      if (errors.length === 0) {
        text += "Ошибок не найдено.\n";
      } else {
        for (var i = 0; i < errors.length; i++) {
          text += "- " + errors[i] + "\n";
        }
      }


      
      text += "\n\n=== ДОП. АНАЛИЗ СЦЕНАРИЯ ===\n\n";

      text += "Недостижимые сцены (" + reach.unreachable.length + "):\n";
      text += (reach.unreachable.length ? reach.unreachable.join("\n") : "(нет)") + "\n\n";

      text += "Циклы / SCC (" + cycles.length + "):\n";
      if (!cycles.length) {
        text += "(нет)\n";
      } else {
        for (var i = 0; i < cycles.length; i++) {
          text += "- " + cycles[i].join(" -> ") + "\n";
        }
      }


      // После вычисления stats, errors, textInfo, reach, cycles
      // (примерно строка 720-730)

      // Добавляем JSON сценария для отладки
      text += "\n\n=== JSON СЦЕНАРИЯ ===\n\n";
      try {
        // Убираем циклические ссылки (если есть)
        const storyJson = JSON.stringify(STORY, (key, value) => {
          if (key === 'sceneMap') return undefined; // не сериализуем
          return value;
        }, 2);
        text += storyJson;
      } catch (e) {
        text += "Ошибка сериализации: " + e.message;
      }


      text += "\n\n=== DOT (GraphViz) ===\n\n";
      text += buildDotGraph(STORY, reach.unreachable);

      elStatsBody.value = text;
      elStatsBody.scrollTop = 0;
    });
  }


 
  // Отброшен вариант: Проверка файлов через чтение первых 32 байт не возможно - ошибки статистики - указано, что файлов нет когда они есть

  // Проверка файлов через fetch с HEAD запросом (работает в file:// ограниченно)
  // Проверка файлов на соответствие требованиям
  function checkAssetsFiles() {
    return new Promise((resolve) => {
        const result = {
            missing: [],
            sizeErrors: [], // файлы с неправильными размерами
            files: []
        };
        
        if (!STORY.assets) {
            resolve(result);
            return;
        }
        
        // Собираем все файлы из ассетов
        const allFiles = [];
        
        // Фоны
        if (STORY.assets.backgrounds) {
            Object.entries(STORY.assets.backgrounds).forEach(([id, path]) => {
                allFiles.push({ id, path, type: 'bg', category: 'background', ref: id });
            });
        }
        
        // Персонажи (изображения)
        if (STORY.assets.characters) {
            Object.entries(STORY.assets.characters).forEach(([charId, char]) => {
                if (char.images) {
                    Object.entries(char.images).forEach(([emotion, path]) => {
                        allFiles.push({ 
                            id: `${charId}_${emotion}`, 
                            path, 
                            type: 'char', 
                            category: 'character',
                            ref: `${charId} (${emotion})`,
                            charId: charId,
                            emotion: emotion
                        });
                    });
                }
            });
        }
        
        // Аудио
        if (STORY.assets.audio) {
          Object.entries(STORY.assets.audio).forEach(([id, path]) => {
            allFiles.push({ 
              id: id, 
              path: path, 
              type: 'audio', 
              category: 'audio', 
              ref: id 
            });
          });
        }

        if (allFiles.length === 0) {
            resolve(result);
            return;
        }
        
        // Группируем по пути
        const pathGroups = {};
        allFiles.forEach(file => {
            if (!pathGroups[file.path]) {
                pathGroups[file.path] = [];
            }
            pathGroups[file.path].push(file);
        });
        
        const uniquePaths = Object.keys(pathGroups);
        let loadedCount = 0;
        let errorCount = 0;
        const totalPaths = uniquePaths.length;
        
        const fileResults = {};
        
        function checkComplete() {
            if (loadedCount + errorCount === totalPaths) {
                // Собираем результаты
                uniquePaths.forEach(path => {
                    if (fileResults[path] && fileResults[path].success) {
                        result.files.push(fileResults[path].data);
                        
                        // Проверяем соответствие требованиям
                        const fileData = fileResults[path].data;
                        if (fileData.width && fileData.height) {
                            let required = { width: 0, height: 0 };
                            
                            if (fileData.category === 'bg') {
                                required = { width: 1080, height: 1920 };
                            } else if (fileData.category === 'char') {
                                required = { width: 500, height: 1200 };
                            }
                            
                            if (required.width > 0 && required.height > 0) {
                                const errors = [];
                                if (fileData.width < required.width) {
                                    errors.push(`ширина ${fileData.width}px < ${required.width}px`);
                                }
                                if (fileData.height < required.height) {
                                    errors.push(`высота ${fileData.height}px < ${required.height}px`);
                                }
                                
                                if (errors.length > 0) {
                                    result.sizeErrors.push({
                                        path: path,
                                        refs: pathGroups[path].map(f => `${f.category}: ${f.ref}`),
                                        width: fileData.width,
                                        height: fileData.height,
                                        required: required,
                                        errors: errors
                                    });
                                }
                            }
                        }
                    } else {
                        result.missing.push({
                            path: path,
                            refs: pathGroups[path].map(f => `${f.category}: ${f.ref}`)
                        });
                    }
                });
                
                resolve(result);
            }
        }
        
        // Проверяем каждый уникальный файл через Image объект
        uniquePaths.forEach(path => {
            if (path.match(/\.(jpg|jpeg|png|gif|webp)$/i)) {
                // Проверка изображения
                const img = new Image();
                let isResolved = false;
                
                const timeout = setTimeout(() => {
                    if (!isResolved) {
                        isResolved = true;
                        errorCount++;
                        checkComplete();
                    }
                }, 5000);
                
                img.onload = function() {
                    if (isResolved) return;
                    isResolved = true;
                    clearTimeout(timeout);
                    
                    // Определяем категорию по первому файлу в группе
                    const firstFile = pathGroups[path][0];
                    const category = firstFile.type; // 'bg' или 'char'
                    
                    fileResults[path] = {
                        success: true,
                        data: {
                            path: path,
                            width: img.width,
                            height: img.height,
                            category: category,
                            refs: pathGroups[path].map(f => `${f.category}: ${f.ref}`)
                        }
                    };
                    
                    loadedCount++;
                    checkComplete();
                };
                
                img.onerror = function() {
                    if (isResolved) return;
                    isResolved = true;
                    clearTimeout(timeout);
                    
                    errorCount++;
                    checkComplete();
                };
                
                img.src = path + '?' + Date.now(); // добавляем timestamp чтобы избежать кэша
              } else if (path.match(/\.(mp3|wav|ogg|flac|m4a)$/i)) {
                // Проверка аудиофайла
                const audio = new Audio();
                let isResolved = false;
                
                const timeout = setTimeout(() => {
                  if (!isResolved) {
                    isResolved = true;
                    errorCount++;
                    checkComplete();
                  }
                }, 5000);
                
                audio.oncanplaythrough = function() {
                  if (isResolved) return;
                  isResolved = true;
                  clearTimeout(timeout);
                  
                  fileResults[path] = {
                    success: true,
                    data: {
                      path: path,
                      category: 'audio',
                      duration: Math.round(audio.duration),
                      refs: pathGroups[path].map(f => `${f.category}: ${f.ref}`)
                    }
                  };
                  
                  loadedCount++;
                  checkComplete();
                };
                
                audio.onerror = function() {
                  if (isResolved) return;
                  isResolved = true;
                  clearTimeout(timeout);
                  
                  errorCount++;
                  checkComplete();
                };
                
                audio.src = path + '?' + Date.now();
            }
        });
    });
  }








  function buildAdjacency(story) {
    var scenes = story.scenes || [];
    var sceneMap = {};
    var adj = {}; // from -> array of { to, label }

    for (var i = 0; i < scenes.length; i++) {
      if (scenes[i] && scenes[i].id) {
        sceneMap[scenes[i].id] = true;
        adj[scenes[i].id] = [];
      }
    }

    for (var s = 0; s < scenes.length; s++) {
      var sc = scenes[s];
      if (!sc || !sc.id) continue;

      var actions = sc.actions || [];
      for (var a = 0; a < actions.length; a++) {
        var act = actions[a];
        if (!act || !act.type) continue;

        if (act.type === "goto" && act.target) {
          adj[sc.id].push({ to: act.target, label: "" });
        }

        if (act.type === "choice" && act.choices && act.choices.length) {
          for (var c = 0; c < act.choices.length; c++) {
            var ch = act.choices[c];
            if (ch && ch.goto) {
              adj[sc.id].push({ to: ch.goto, label: String(ch.text || "") });
            }
          }
        }
      }
    }

    return { sceneMap: sceneMap, adj: adj };
  }

  function findUnreachableScenes(story) {
    var startId = (story.meta && story.meta.start) ? story.meta.start : null;
    var built = buildAdjacency(story);
    var sceneMap = built.sceneMap;
    var adj = built.adj;

    if (!startId || !sceneMap[startId]) {
      // Если стартовая сцена не задана/не найдена — считаем всё “сомнительным”
      return { unreachable: Object.keys(sceneMap).sort(), reachable: [] };
    }

    var visited = {};
    var stack = [startId];
    visited[startId] = true;

    while (stack.length) {
      var v = stack.pop();
      var edges = adj[v] || [];
      for (var i = 0; i < edges.length; i++) {
        var to = edges[i].to;
        if (!visited[to] && sceneMap[to]) {
          visited[to] = true;
          stack.push(to);
        }
      }
    }

    var reachable = [];
    var unreachable = [];

    for (var id in sceneMap) {
      if (!Object.prototype.hasOwnProperty.call(sceneMap, id)) continue;
      if (visited[id]) reachable.push(id);
      else unreachable.push(id);
    }

    reachable.sort();
    unreachable.sort();

    return { unreachable: unreachable, reachable: reachable };
  }


  function findCyclesSCC(story) {
    var built = buildAdjacency(story);
    var sceneMap = built.sceneMap;
    var adj = built.adj;

    var index = 0;
    var stack = [];
    var onStack = {};
    var idx = {};
    var low = {};
    var sccs = [];

    function strongconnect(v) {
      idx[v] = index;
      low[v] = index;
      index++;

      stack.push(v);
      onStack[v] = true;

      var edges = adj[v] || [];
      for (var i = 0; i < edges.length; i++) {
        var w = edges[i].to;
        if (!sceneMap[w]) continue; // игнорируем переходы в несуществующие

        if (idx[w] === undefined) {
          strongconnect(w);
          low[v] = Math.min(low[v], low[w]);
        } else if (onStack[w]) {
          low[v] = Math.min(low[v], idx[w]);
        }
      }

      // root SCC
      if (low[v] === idx[v]) {
        var comp = [];
        while (true) {
          var w2 = stack.pop();
          onStack[w2] = false;
          comp.push(w2);
          if (w2 === v) break;
        }
        sccs.push(comp);
      }
    }

    // Запускаем для всех вершин
    for (var v in sceneMap) {
      if (!Object.prototype.hasOwnProperty.call(sceneMap, v)) continue;
      if (idx[v] === undefined) strongconnect(v);
    }

    // Оставляем только “циклические” SCC:
    // - размер > 1
    // - или самопетля (v -> v)
    var cycles = [];
    for (var i = 0; i < sccs.length; i++) {
      var comp = sccs[i];
      if (comp.length > 1) {
        comp.sort();
        cycles.push(comp);
      } else {
        var single = comp[0];
        var edges = adj[single] || [];
        for (var e = 0; e < edges.length; e++) {
          if (edges[e].to === single) {
            cycles.push([single]);
            break;
          }
        }
      }
    }

    // Стабильный порядок
    cycles.sort(function (a, b) {
      return a[0].localeCompare(b[0]);
    });

    return cycles;
  }




  function buildDotGraph(story, unreachableList) {
    var scenes = story.scenes || [];
    var startId = (story.meta && story.meta.start) ? story.meta.start : (scenes[0] ? scenes[0].id : "START");

    // Набор недостижимых сцен для подсветки
    var unreachableSet = {};
    if (unreachableList && unreachableList.length) {
      for (var ui = 0; ui < unreachableList.length; ui++) {
        unreachableSet[unreachableList[ui]] = true;
      }
    }

    // Карта сцен для проверки существования
    var sceneMap = {};
    for (var i = 0; i < scenes.length; i++) {
      if (scenes[i] && scenes[i].id) sceneMap[scenes[i].id] = scenes[i];
    }

    // Сбор информации о вершинах и рёбрах
    var nodes = []; // { id, characters[], sayCount, bgmCount }
    var edges = []; // { from, to, label }

    for (var s = 0; s < scenes.length; s++) {
      var scene = scenes[s];
      if (!scene || !scene.id) continue;

      var actions = scene.actions || [];

      // --- метрики вершины ---
      var charSet = {};
      var sayCount = 0;
      var textCount = 0;
      var bgmCount = 0;

      // --- исходящие рёбра ---
      var outEdgeCount = 0;

      for (var a = 0; a < actions.length; a++) {
        var act = actions[a];
        if (!act || !act.type) continue;

        if (act.type === "char") {
          var chId = extractAliasId(act.src, "ch");
          if (chId) charSet[chId] = true;
        }

        if (act.type === "say") sayCount++;
        if (act.type === "text") textCount++;
        if (act.type === "bgm") bgmCount++;

        // goto -> ребро
        if (act.type === "goto" && act.target) {
          edges.push({ from: scene.id, to: act.target, label: "" });
          outEdgeCount++;
        }

        // choice -> ребро с текстом пункта меню
        if (act.type === "choice" && act.choices && act.choices.length) {
          for (var c = 0; c < act.choices.length; c++) {
            var ch = act.choices[c];
            if (ch && ch.goto) {
              edges.push({ from: scene.id, to: ch.goto, label: String(ch.text || "") });
              outEdgeCount++;
            }
          }
        }
      }

      // Если исходящих нет — добавим "end" в старт (удобно для киоска/демо)
      if (outEdgeCount === 0 && startId && scene.id !== startId) {
        edges.push({ from: scene.id, to: startId, label: "end" });
      }

      nodes.push({
        id: scene.id,
        characters: keysSorted(charSet),
        phraseCount: (sayCount + textCount),
        bgmCount: bgmCount
      });
    }

    // Формируем DOT
    var dot = "";
    dot += "digraph VN {\n";
    dot += "  rankdir=LR;\n";
    dot += "  labelloc=\"t\";\n";
    dot += "  label=\"" + dotEscape((story.meta && story.meta.title) ? story.meta.title : "Visual Novel") + "\";\n";
    dot += "  node [shape=box, style=\"rounded\", fontsize=10];\n";
    dot += "  edge [fontsize=9];\n\n";

    // Узлы
    for (var n = 0; n < nodes.length; n++) {
      var node = nodes[n];
      var chars = node.characters.length ? node.characters.join(", ") : "(нет)";
      var label =
        node.id + "\\n" +
        "Персонажи: " + chars + "\\n" +
        "Фраз: " + node.phraseCount + "\\n" +
        "Музыка: " + node.bgmCount;

      var nodeAttrs = 'label="' + dotEscape(label) + '"';
      // Стартовая сцена
      if (node.id === startId) {
        nodeAttrs += ', shape=doubleoctagon, color="green", fontcolor="green", penwidth=2';
      }
      // Недостижимая сцена
      if (unreachableSet[node.id]) {
        nodeAttrs += ', color="red", fontcolor="red", style="rounded,dashed", penwidth=2';
      }
      dot += '  "' + dotEscape(node.id) + '" [' + nodeAttrs + '];\n';

    }

    dot += "\n";

    // Рёбра (показываем даже если target неизвестен — так увидите ошибку в графе)
    for (var e = 0; e < edges.length; e++) {
      var ed = edges[e];
      var fromId = ed.from;
      var toId = ed.to;

      var attrs = "";
      if (ed.label && ed.label.trim() !== "") {
        attrs = " [label=\"" + dotEscape(ed.label) + "\"]";
      }

      dot += "  \"" + dotEscape(fromId) + "\" -> \"" + dotEscape(toId) + "\"" + attrs + ";\n";
    }

    dot += "}\n";
    return dot;
  }

function dotEscape(s) {
  // Экранируем для DOT-строк:
  // - обратный слэш
  // - кавычки
  // - переводы строк (на всякий)
  s = String(s);
  // s = s.replace(/\\/g, "\\\\");
  s = s.replace(/"/g, "\\\"");
  // s = s.replace(/\r?\n/g, "\n");
  return s;
}







  function computeTextInfo(story) {

    var characters = 0;
    var words = 0;

    var scenes = story.scenes || [];

    for (var s = 0; s < scenes.length; s++) {

      var actions = scenes[s].actions || [];

      for (var a = 0; a < actions.length; a++) {

        var act = actions[a];

        if (act.type === "say" || act.type === "text") {

          var t = act.text || "";

          characters += t.length;

          var w = t.trim().split(/\s+/);

          if (t.trim() !== "") words += w.length;
        }
      }
    }

    return {
      characters: characters,
      words: words
    };
  }

  function validateStory(story) {

    var errors = [];

    var sceneMap = {};
    var scenes = story.scenes || [];

    for (var i = 0; i < scenes.length; i++) {
      sceneMap[scenes[i].id] = true;
    }

    for (var s = 0; s < scenes.length; s++) {

      var actions = scenes[s].actions || [];

      for (var a = 0; a < actions.length; a++) {

        var act = actions[a];

        if (act.type === "goto") {

          if (!sceneMap[act.target]) {
            errors.push("Переход в несуществующую сцену: " + act.target);
          }
        }

        if (act.type === "bg") {

          var id = extractAliasId(act.src, "bg");

          if (id && !story.assets.backgrounds[id]) {
            errors.push("Не найден фон: " + id);
          }
        }

        if (act.type === "char") {

          var id = extractAliasId(act.src, "ch");

          if (id && !story.assets.characters[id]) {
            errors.push("Не найден персонаж: " + id);
          }
        }

      }

    }

    return errors;
  }

  // Подсчёт статистики.
  // Важно: считаем “уникальность” по алиасам @bg.xxx и @ch.xxx.
  // Это устойчиво к file:// путям и совпадениям хвостов строк.
  function computeStoryStats(story) {
    var scenes = story.scenes || [];

    var usedBg = {};      // id -> true
    var usedCh = {};      // id -> true

    var sayCount = 0;
    var textCount = 0;
    var choiceCount = 0;
    var bgmActions = 0;
    var sfxActions = 0;

    for (var s = 0; s < scenes.length; s++) {
      var actions = scenes[s].actions || [];
      for (var a = 0; a < actions.length; a++) {
        var act = actions[a];
        if (!act || !act.type) continue;

        if (act.type === "bg") {
          var bgId = extractAliasId(act.src, "bg");
          if (bgId) usedBg[bgId] = true;
        }

        if (act.type === "char") {
          // char может быть null -> скрыть
          var chId = extractAliasId(act.src, "ch");
          if (chId) usedCh[chId] = true;
        }

        if (act.type === "say") sayCount++;
        if (act.type === "text") textCount++;
        if (act.type === "choice") choiceCount++;
        if (act.type === "bgm") bgmActions++;
        if (act.type === "sfx") sfxActions++;
        
      }
    }

    // Количество персонажей и их изображений:
    // - uniqueCharacters: сколько “id” реально использовано в сценарии (@ch.xxx)
    // - characterImageCount: сколько всего картинок персонажей в assets.characters (на случай эмоций/вариаций)
    var characterImageCount = 0;
    if (story.assets && story.assets.characters) {
      for (var k in story.assets.characters) {
        if (Object.prototype.hasOwnProperty.call(story.assets.characters, k)) characterImageCount++;
      }
    }

    var backgroundAssetCount = 0;
    if (story.assets && story.assets.backgrounds) {
      for (var b in story.assets.backgrounds) {
        if (Object.prototype.hasOwnProperty.call(story.assets.backgrounds, b)) backgroundAssetCount++;
      }
    }

    return {
      sceneCount: scenes.length,
      choiceCount: choiceCount,

      // “уникальные фоны” — по факту использования в сценарии
      uniqueBackgrounds: countKeys(usedBg),
      usedBackgroundIds: keysSorted(usedBg),

      // “уникальные персонажи” — по факту использования в сценарии
      uniqueCharacters: countKeys(usedCh),
      usedCharacterIds: keysSorted(usedCh),

      // “общее количество изображений персонажей” — по assets.characters
      characterImageCount: characterImageCount,

      // (на будущее) сколько фонов всего заявлено в assets
      backgroundImageCount: backgroundAssetCount,

      sayCount: sayCount,
      textCount: textCount,
      bgmActions: bgmActions,
      sfxActions: sfxActions
    };
  }

  function extractAliasId(ref, group) {
    // ref вида "@bg.campusHall" или "@ch.annaNeutral"
    if (!ref || typeof ref !== "string") return "";
    if (ref.indexOf("@") !== 0) return "";         // если прямой путь — не трогаем
    var parts = ref.substring(1).split(".");
    if (parts.length < 2) return "";
    if (parts[0] !== group) return "";
    return parts.slice(1).join(".");
  }

  function countKeys(obj) {
    var n = 0;
    for (var k in obj) if (Object.prototype.hasOwnProperty.call(obj, k)) n++;
    return n;
  }

  function keysSorted(obj) {
    var arr = [];
    for (var k in obj) if (Object.prototype.hasOwnProperty.call(obj, k)) arr.push(k);
    arr.sort();
    return arr;
  }

  // минимальный экранизатор для вставки в innerHTML (если будете добавлять “детали”)
  function escapeHtml(s) {
    s = String(s);
    return s
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;")
      .replace(/'/g, "&#039;");
  }

// Применение настроек отступов
function applySpacingSettings() {
  if (!STORY.meta) return;
  
  const topSpacing = STORY.meta.topSpacing || 0;
  const bottomSpacing = STORY.meta.bottomSpacing || 0;
  
  document.documentElement.style.setProperty('--topSpacing', topSpacing + 'px');
  document.documentElement.style.setProperty('--bottomSpacing', bottomSpacing + 'px');
  
  console.log(`[Engine] Отступы: сверху ${topSpacing}px, снизу ${bottomSpacing}px`);

  setTimeout(adjustCharacterScale, 100); // пересчитываем размер персонажа
}

  // Управление размытым фоном
  function updateBlurBackground(src) {
    console.log('[Engine] updateBlurBackground called with src:', src);
    console.log('[Engine] elBlurBgLayer:', elBlurBgLayer);
    console.log('[Engine] elBlurBgImage:', elBlurBgImage);
    console.log('[Engine] STORY.meta:', STORY.meta);
    console.log('[Engine] STORY.meta.blurBackground:', STORY.meta?.blurBackground);
    
    if (!elBlurBgLayer || !elBlurBgImage) {
      console.warn('[Engine] Элементы размытого фона не найдены');
      return;
    }
    
    if (!STORY.meta || !STORY.meta.blurBackground) {
      console.log('[Engine] Размытый фон отключен в метаданных');
      elBlurBgLayer.classList.add("hidden");
      return;
    }
    
    if (src && src !== "") {
      console.log('[Engine] Устанавливаем размытый фон:', src);
      elBlurBgImage.src = src;
      elBlurBgLayer.classList.remove("hidden");
      
      // Принудительно применяем стили
      elBlurBgImage.style.objectFit = 'cover';
      elBlurBgImage.style.width = '100%';
      elBlurBgImage.style.height = '100%';
    } else {
      console.log('[Engine] src пустой, скрываем размытый фон');
      elBlurBgLayer.classList.add("hidden");
    }
  }


})();