# Tufa Calendar

A dead simple calendar for the Obsidian sidebar. It shows the date, and that's the only thing it does. It never creates or changes a note.

<p>
  <img src="screenshots/month.png" alt="Month view" width="320">
  <img src="screenshots/year-of-dots.png" alt="Year of dots" width="320">
</p>

## What you see

There are two views. The grid button in the top corner switches between them.

The month view scrolls through the months. Today is highlighted and Thursdays have a small dot. Click a day to copy its date, like "September 18th, 2026". If you leave it on another month for 20 seconds, it scrolls back to today.

The year view has one dot for each day of the year. Past days are bright and today is pink. The play button sends slow ripples across the dots.

At the bottom, a small counter shows the week, the day of the year and the days left in the year, like `W39 · D268 · 97D → 2027`. The calendar fills whatever pane you put it in.

## Install

Copy `manifest.json`, `main.js` and `styles.css` into `<vault>/.obsidian/plugins/tufa-calendar/`. Then turn on Tufa Calendar in Settings → Community plugins.

## Colors

It uses your theme's colors. To change the color of the month names, set `--tufa-ink` in a CSS snippet:

```css
body { --tufa-ink: #f6c1f5; }
```

If you don't set it, it uses your normal text color.
