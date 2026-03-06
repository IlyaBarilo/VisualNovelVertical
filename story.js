// story-content.js
// Содержит текст сценария в виде строки

window.STORY_TEXT = `# МЕТАДАННЫЕ
title: Вуз: демо-новелла с выбором
start_scene: intro_01
top_spacing: 20        # отступ сверху в пикселях (можно 100, 200 и т.д.)
bottom_spacing: 20     # отступ снизу в пикселях (поднимает интерфейс вверх)
blur_background: true   
# включить размытый фон
blur_strength: 50        # сила размытия в пикселях
blur_brightness: 0.9     # яркость (0.8-1.0)
blur_opacity: 0.95       # прозрачность

# РЕСУРСЫ
[bg]
campusHall = assets/bg_campus_hall.jpg
libraryEvening = assets/bg_library_evening.jpg
branchCafe = assets/bg_campus_cafe.jpg
branchLab = assets/bg_it_lab.jpg
branchYard = assets/bg_uni_yard_night.jpg

[char]
anna image neutral = assets/ch_anna_neutral.png
anna name = "Анна"
anna color = #0F0
igor image smile = assets/ch_igor_smile.png
igor name = "Игорь"
igor color = #F00

[audio]
bgmDay = assets/bgm_campus_day.mp3
bgmMystery = assets/bgm_library_mystery.mp3
sfxClick = assets/sfx_button_click.mp3

# СЦЕНЫ
scene intro_01

bg campusHall
bgm bgmDay

show anna neutral
anna: "Добро пожаловать в наш вуз! Это демо визуальной новеллы для вертикального экрана."

show igor smile
igor: "Круто. И всё это — один HTML-файл, без сервера?"

show anna neutral
anna: "Да. Фон подстраивается под 7×16 и всегда центрируется."

show igor smile
igor: "А персонаж один за раз — это даже удобно: меньше путаницы на экране."

show anna neutral
anna: "Плюс можно добавлять мини-игры и возвращать результат — для ветвлений."

show igor smile
igor: "Тогда давай сделаем выбор: пусть посетитель решит, куда пойдём дальше!"

goto scene_02

scene scene_02

bg libraryEvening
hide all

"Позже, в библиотеке. Экран светится мягко, словно зовёт к новой истории…"
"Страницы шуршат, где-то вдалеке щёлкает клавиатура. Идея почти готова."

bgm bgmMystery

show anna neutral
anna: "Есть вопрос: куда ведём посетителя дальше, чтобы он почувствовал атмосферу вуза?"

menu
"Зайти в кафе и услышать студенческие байки" -> branch_cafe_01
"Заглянуть в IT-лабораторию и увидеть магию технологий" -> branch_lab_01
"Выйти во двор и поймать ночное настроение университета" -> branch_yard_01

scene branch_cafe_01

bg branchCafe
hide all

"Кафе шумит: кружки звенят, кто-то обсуждает проекты и дедлайны, кто-то — мемы недели."
"В воздухе пахнет кофе и свежими идеями. Кажется, отсюда начинаются лучшие командные истории."

goto finale_01

scene branch_lab_01

bg branchLab
hide all

"Лаборатория светится мониторами. На экране — прототип, рядом — схема, а в голове — тысяча гипотез."
"Тут не боятся ошибок: каждая — шаг к решению. И да, иногда решения выглядят как магия."

goto finale_01

scene branch_yard_01

bg branchYard
hide all

"Во дворе тихо: фонари рисуют дорожки света, и даже шаги звучат как часть саундтрека."
"Именно в такие моменты появляются самые смелые задумки — когда вокруг спокойно, а внутри бурлит сюжет."

goto finale_01

scene finale_01

bg libraryEvening
hide all

"Демо завершено. Это пример ветвления: три пути сошлись в одну финальную сцену."
"Нажмите «Домой», чтобы начать заново и выбрать другой путь."



scene branch_lab_02

bg branchLab
hide all

"Лаборатория светится мониторами. На экране — прототип, рядом — схема, а в голове — тысяча гипотез."
"Тут не боятся ошибок: каждая — шаг к решению. И да, иногда решения выглядят как магия."

`;

