# Media

FocusReels plays **your own local clips**. It never downloads anything and never
talks to a video service.

Put vertical (9:16) `.mp4` / `.m4v` / `.mov` / `.webm` files in:

```
~/Library/Application Support/FocusReels/media
```

The menu-bar item has **Open media folder…** for exactly this. With one clip it
loops; with several it plays through them in a shuffled order. With none, the
overlay shows a placeholder — everything else still works, which is what the
demo scenarios rely on.

Override the folder for a test run with `FOCUSREELS_MEDIA_DIR=/path/to/clips`.
