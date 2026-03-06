// story-loader.js
// Парсит STORY_TEXT в window.STORY

(function() {
  "use strict";

  console.log('[Loader] Запуск парсера...');

  // Проверяем наличие текста
  if (!window.STORY_TEXT) {
    console.error('[Loader] window.STORY_TEXT не найден!');
    createFallbackStory('Не найден story-content.js');
    return;
  }

  // Парсим текст
  parseStory(window.STORY_TEXT);

  // ========================================
  // ПАРСЕР
  // ========================================

  function parseStory(text) {
    console.log('[Loader] Начинаем парсинг, длина:', text.length);
    
    // Структура для результата
    const story = {
      meta: {
        title: "Без названия",
        start: null
      },
      assets: {
        backgrounds: {},
        characters: {},
        audio: {}
      },
      audioSettings: {
        masterVolume: 0.8,
        muted: true
      },
      scenes: []
    };

    let currentScene = null;
    let currentSection = null; // 'meta', 'bg', 'char', 'audio', 'scenes'
    let lineNumber = 0;

    const lines = text.split(/\r?\n/);
    console.log('[Loader] Всего строк:', lines.length);

    for (let i = 0; i < lines.length; i++) {
      lineNumber = i + 1;
      let line = lines[i].trim();
      
      // Пропускаем пустые строки
      if (line === '') continue;
      
      // Определяем секции
      if (line.startsWith('# МЕТАДАННЫЕ')) {
        currentSection = 'meta';
        continue;
      }
      
      if (line.startsWith('[bg]')) {
        currentSection = 'bg';
        continue;
      }
      
      if (line.startsWith('[char]')) {
        currentSection = 'char';
        continue;
      }
      
      if (line.startsWith('[audio]')) {
        currentSection = 'audio';
        continue;
      }
      
      if (line.startsWith('# СЦЕНЫ')) {
        currentSection = 'scenes';
        continue;
      }
      
      // Парсим в зависимости от секции
      switch (currentSection) {
        case 'meta':
          parseMetaLine(line, story);
          break;
        case 'bg':
          parseAssetLine(line, 'backgrounds', story);
          break;
        case 'char':
          console.log('[Loader CHAR] Processing line:', line);
          parseAssetLine(line, 'characters', story);
          break;
        case 'audio':
          parseAssetLine(line, 'audio', story);
          break;
        case 'scenes':
          parseSceneLine(line, story, currentScene, (scene) => { currentScene = scene; }, lineNumber);
          break;
        default:
          // Если секция не определена, но строка начинается с 'scene'
          if (line.startsWith('scene ')) {
            currentSection = 'scenes';
            parseSceneLine(line, story, currentScene, (scene) => { currentScene = scene; }, lineNumber);
          }
      }
    }
    
    // Добавляем последнюю сцену
    if (currentScene) {
      story.scenes.push(currentScene);
    }
    
    // Устанавливаем стартовую сцену, если не задана
    if (!story.meta.start && story.scenes.length > 0) {
      story.meta.start = story.scenes[0].id;
    }
    
    console.log('[Loader] Парсинг завершён!');
    console.log('[Loader] Найдено сцен:', story.scenes.length);
    console.log('[Loader] Стартовая сцена:', story.meta.start);
    
    // Сохраняем JSON для отладки
    try {
      localStorage.setItem('story_debug', JSON.stringify(story, null, 2));
      console.log('[Loader] JSON сохранён в localStorage.story_debug');
    } catch (e) {}
    
    // Передаём в движок
    window.STORY = story;
    
    console.log('[Loader] ФИНАЛЬНЫЙ STORY.assets:', story.assets);
    console.log('[Loader] ФИНАЛЬНЫЙ backgrounds:', story.assets.backgrounds);
    console.log('[Loader] ФИНАЛЬНЫЙ audio:', story.assets.audio);
    
    // Уведомляем движок
    if (window.__onStoryLoaded) {
      console.log('[Loader] Уведомляем движок');
      window.__onStoryLoaded(story);
    } else {
      console.log('[Loader] Движок ещё не загружен, он подхватит window.STORY позже');
    }
  }

  // Парсинг метаданных
  function parseMetaLine(line, story) {
    // Удаляем комментарии (всё что после #)
    line = line.split('#')[0].trim();
    if (!line) return; // если после удаления комментария строка пустая
    
    if (line.includes(':')) {
      const parts = line.split(':');
      const key = parts[0].trim();
      let value = parts.slice(1).join(':').trim();
      
      // Удаляем лишние пробелы и кавычки
      value = value.trim();
      
      if (key === 'title') {
        story.meta.title = value;
      }
      if (key === 'start_scene') {
        story.meta.start = value;
      }
      // Новые настройки отступов
      if (key === 'top_spacing') {
        story.meta.topSpacing = parseInt(value) || 0;
      }
      if (key === 'bottom_spacing') {
        story.meta.bottomSpacing = parseInt(value) || 0;
      }
      // Настройка размытого фона
      if (key === 'blur_background') {
        story.meta.blurBackground = value === 'true' || value === '1';
        console.log('[Loader] blur_background =', story.meta.blurBackground, 'raw value:', value);
      }
    }
  }

  // Парсинг ресурсов (bg, char, audio)
  function parseAssetLine(line, category, story) {
    console.log('[Loader] parseAssetLine:', line, 'category:', category);
    
    // Удаляем комментарии
    // Удаляем комментарии, но сохраняем # если это цвет (после =)
    if (line.includes('#') && !line.match(/=\s*#/)) {
      line = line.split('#')[0].trim();
    } else if (line.includes('#') && line.match(/=\s*#/)) {
      // Это цвет - оставляем как есть
      console.log('[Loader] Обнаружен цвет:', line);
    }
    
    console.log('[Loader] after comment removal:', line);
    
    if (!line) return;
    
    // Более гибкое регулярное выражение - допускает пробелы вокруг =
    const match = line.match(/^(.+?)\s*=\s*(.+)$/);
    console.log('[Loader] match:', match);
    
    if (match) {
      const key = match[1].trim();
      let value = match[2].trim();
      console.log('[Loader] key:', key, 'value:', value);
      
      // Убираем кавычки из значений, если они есть
      if (value.startsWith('"') && value.endsWith('"')) {
        value = value.slice(1, -1);
        console.log('[Loader] after quote removal:', value);
      }
      
      if (category === 'characters') {
        console.log('[Loader CHAR] processing character line:', line);
        // Формат: "имя тип = значение" (anna image neutral, anna name, anna color)
        const keyParts = key.split(' ');
        console.log('[Loader CHAR] keyParts:', keyParts);
        
        if (keyParts.length >= 2) {
            const charId = keyParts[0]; // anna, igor
            const propType = keyParts[1]; // image, name, color
            
            console.log('[Loader CHAR] charId:', charId, 'propType:', propType);
            
            if (!story.assets.characters[charId]) {
                story.assets.characters[charId] = {};
                console.log('[Loader CHAR] Created new character object for:', charId);
            }
            
            if (propType === 'image') {
                // Для image нужна эмоция (третий параметр)
                const emotion = keyParts[2] || 'neutral';
                if (!story.assets.characters[charId].images) {
                    story.assets.characters[charId].images = {};
                }
                story.assets.characters[charId].images[emotion] = value;
                console.log(`[Loader CHAR] Added image for ${charId} (${emotion}): ${value}`);
                console.log('[Loader CHAR] Current character data:', story.assets.characters[charId]);
            } else if (propType === 'name') {
                story.assets.characters[charId].name = value;
                console.log(`[Loader CHAR] Added name for ${charId}: ${value}`);
            } else if (propType === 'color') {
                story.assets.characters[charId].color = value;
                console.log(`[Loader CHAR] Added color for ${charId}: ${value}`);
            }
        } else {
            console.warn(`[Loader CHAR] Invalid character format: ${key}`);
        }
      } else {
        // Для bg и audio оставляем как есть
        story.assets[category][key] = value;
        console.log(`[Loader] Добавлен ${category}: ${key} = ${value}`);
        
        // ========== ДОБАВЬТЕ ЭТОТ КОД ==========
        console.log(`[Loader] Текущее состояние ${category}:`, story.assets[category]);
        // =======================================
      }
    }
  }

  // Парсинг сцен
  function parseSceneLine(line, story, currentScene, setCurrentScene, lineNumber) {
    // Удаляем комментарии, но сохраняем оригинал для вывода ошибок
    const cleanLine = line.split('#')[0].trim();
    if (!cleanLine) return; // если строка была только комментарием
    
    // Используем cleanLine для парсинга, но line для вывода ошибок

    // Новая сцена
    if (cleanLine.startsWith('scene ')) {
      // Сохраняем предыдущую сцену
      if (currentScene) {
        story.scenes.push(currentScene);
      }
      
      const sceneId = cleanLine.substring(6).trim();
      currentScene = {
        id: sceneId,
        actions: []
      };
      setCurrentScene(currentScene);
      return;
    }
    
    if (!currentScene) {
      console.warn(`[Loader] Строка вне сцены: ${cleanLine}`);
      return;
    }
    
    const actions = currentScene.actions;
    
    // bg [имя]
    if (cleanLine.startsWith('bg ')) {
      const bgName = cleanLine.substring(3).trim();
      actions.push({
        type: 'bg',
        src: `@bg.${bgName}`
      });
      return;
    }
    
    // bgm [имя]
    if (cleanLine.startsWith('bgm ')) {
      const bgmName = cleanLine.substring(4).trim();
      actions.push({
        type: 'bgm',
        src: `@audio.${bgmName}`,
        loop: true,
        volume: 0.7,
        fadeMs: 400
      });
      return;
    }
    
    // show [имя] [эмоция]
    if (cleanLine.startsWith('show ')) {
      const parts = cleanLine.substring(5).trim().split(' ');
      const charId = parts[0]; // anna, igor
      const emotion = parts[1] || 'neutral'; // neutral, smile и т.д.
      
      actions.push({
        type: 'char',
        charId: charId,
        emotion: emotion,
        src: null, // будет заполнено в executeAction через resolveAsset
        pos: 'center'
      });
      return;
    }
    
    // hide all
    if (cleanLine === 'hide all') {
      actions.push({
        type: 'char',
        src: null
      });
      return;
    }
    
    // menu (игнорируем)
    if (cleanLine === 'menu') {
      return;
    }
    
    // goto [сцена]
    if (cleanLine.startsWith('goto ')) {
      const target = cleanLine.substring(5).trim();
      actions.push({
        type: 'goto',
        target: target
      });
      return;
    }
    
    // Диалог: переменная: "текст"
    const dialogMatch = cleanLine.match(/^([a-zA-Z0-9_]+):\s*"(.+)"$/);
    if (dialogMatch) {
      const charVar = dialogMatch[1].trim(); // anna, igor
      let text = dialogMatch[2].trim();
      
      // Экранируем спецсимволы в тексте
      text = text.replace(/\\n/g, '\n').replace(/\\t/g, '\t');
      
      actions.push({
        type: 'say',
        charVar: charVar, // переменная персонажа
        text: text
      });
      return;
    }
    
    // Выбор: Текст -> сцена
    const choiceMatch = cleanLine.match(/^"(.+)"\s*->\s*(.+)$/);
    if (choiceMatch) {
      const text = choiceMatch[1].trim();
      const target = choiceMatch[2].trim();
      
      // Ищем последний action типа choice
      let choiceAction = null;
      for (let i = actions.length - 1; i >= 0; i--) {
        if (actions[i].type === 'choice') {
          choiceAction = actions[i];
          break;
        }
      }
      
      // Если нет choice action, создаём новый
      if (!choiceAction) {
        choiceAction = {
          type: 'choice',
          choices: []
        };
        actions.push(choiceAction);
      }
      
      choiceAction.choices.push({
        text: text,
        goto: target
      });
      return;
    }
    
     // Текст в кавычках (авторский)
    const textMatch = cleanLine.match(/^"(.+)"$/);
    if (textMatch) {
      let text = textMatch[1].trim();
      // Экранируем спецсимволы
      text = text.replace(/\\n/g, '\n').replace(/\\t/g, '\t');
      
      actions.push({
        type: 'text',
        text: text
      });
      return;
    }
    
    // Если ничего не подошло и это не комментарий
    if (cleanLine && !cleanLine.startsWith('#')) {
      console.warn(`[Loader] Неизвестный формат строки ${lineNumber}: ${cleanLine}`);
    }
  }

  // Создание заглушки при ошибке
  function createFallbackStory(errorMsg) {
    console.error('[Loader] Создаём fallback сценарий:', errorMsg);
    
    window.STORY = {
      meta: {
        title: "Ошибка загрузки",
        start: "error_scene"
      },
      assets: {
        backgrounds: {},
        characters: {},
        audio: {}
      },
      scenes: [{
        id: "error_scene",
        actions: [
          {
            type: "text",
            text: "Ошибка загрузки сценария: " + errorMsg
          },
          {
            type: "text",
            text: "Проверьте, что файл story-content.js подключен и содержит window.STORY_TEXT"
          }
        ]
      }]
    };
    
    if (window.__onStoryLoaded) {
      window.__onStoryLoaded(window.STORY);
    }
  }
})();