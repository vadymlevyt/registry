# ПОТОЧНЕ ЗАВДАННЯ

Прочитай CLAUDE.md перед початком.
Працюємо в гілці main. Після змін — npm run build, потім git push.

---

## Проблема 1 — Статистика не видна без прокрутки

Панель статистики (бар-графік) зараз їде вниз за екран.
Вона має бути одразу під сіткою календаря — завжди видна без прокрутки.

**Причина:** блок календаря не обмежений по висоті, сітка розтягується і виштовхує статистику за межі екрану.

**Рішення:**
Знайди компонент Dashboard (src/components/Dashboard/index.jsx).
Блок середньої колонки (календар) має мати: display:flex, flexDirection:column, height:100%, overflow:hidden.

Всередині цього блоку:
- навігація (← Квітень →): flexShrink:0
- рядок днів тижня (Пн Вт...): flexShrink:0  
- сітка днів: flex:1, minHeight:0, overflow:hidden — вона СТИСКАЄТЬСЯ щоб вмістити статистику
- панель статистики: flexShrink:0, висота фіксована ~80px

Таким чином сітка займає весь залишок висоти, а статистика завжди внизу і видна.

---

## Проблема 2 — Підписи під бар-графіком зсунуті

Зараз підписи ("Цивільні 15", "Кримінальні 3" тощо) стоять всі зліва.
Кожен підпис має бути по центру своєї кольорової смужки.

**Рішення:**
Зроби два рядки з однаковою структурою flex:

Рядок 1 — бар-графік:
```
<div style={{display:"flex", width:"100%", height:8, borderRadius:4, overflow:"hidden"}}>
  <div style={{flex:15, background:"#4f7cff"}} />   // Цивільні
  <div style={{flex:3,  background:"#e74c3c"}} />   // Кримінальні
  <div style={{flex:3,  background:"#f39c12"}} />   // Військові
  <div style={{flex:2,  background:"#2ecc71"}} />   // Адмін
</div>
```

Рядок 2 — підписи (та сама flex структура):
```
<div style={{display:"flex", width:"100%"}}>
  <div style={{flex:15, textAlign:"center", fontSize:10, color:"#4f7cff"}}>Цивільні 15</div>
  <div style={{flex:3,  textAlign:"center", fontSize:10, color:"#e74c3c"}}>Кримінальні 3</div>
  <div style={{flex:3,  textAlign:"center", fontSize:10, color:"#f39c12"}}>Військові 3</div>
  <div style={{flex:2,  textAlign:"center", fontSize:10, color:"#2ecc71"}}>Адмін 2</div>
</div>
```

Значення flex беруться динамічно з реальної кількості справ по категоріях.
Якщо категорія має 0 справ — не показувати її сегмент і підпис.

---

## Після виконання

npm run build
git add -A
git commit -m "fix: stats panel always visible + aligned bar chart labels"
git push origin main
