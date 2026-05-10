# 音频资源目录

代码侧（v1.7.0 声音与音乐）的音频管线已就绪。本目录下的 `.mp3` 资源**由开发者自备**，AI 不生成。

## 文件清单（路径锁定）

```
audio/
├── bgm/
│   ├── menu.mp3          # 主菜单 / setup（≤3MB，循环）
│   ├── battle.mp3        # 战斗 / blind-select / reward（≤3MB，循环）
│   ├── shop.mp3          # 商店 / pack（≤3MB，循环）
│   ├── win.mp3           # 通关 stinger（≤3MB，5–10s，one-shot）
│   └── lose.mp3          # 失败 stinger（≤3MB，5–10s，one-shot）
└── sfx/
    ├── card-deal.mp3
    ├── card-select.mp3
    ├── card-play.mp3
    ├── card-discard.mp3
    ├── joker-trigger.mp3
    ├── score-tick.mp3
    ├── ui-click.mp3
    ├── ui-hover.mp3
    ├── shop-buy.mp3
    ├── shop-sell.mp3
    ├── shop-reroll.mp3
    ├── blind-pass.mp3
    ├── boss-defeat.mp3
    ├── win-stinger.mp3
    └── lose-stinger.mp3
```

每个 SFX 单文件 ≤80 KB；建议 96 kbps mp3。

## 自建工具

- SFX：[sfxr.me](https://sfxr.me) 一键生成 chiptune blip / coin / explosion，按 docs/小丑牌教学-第7轮 第 13.1 节预设映射表导出 wav 后转 mp3。
- BGM：[pixabay.com/music](https://pixabay.com/music) 搜 `chill lo-fi` / `retro chiptune upbeat` / `lo-fi jazz` / `victory fanfare` / `sad piano stinger`，下载后按本目录文件名重命名。
- 备选 BGM：[beepbox.co](https://beepbox.co) 自行编曲。

完整自建流程见 `docs/小丑牌教学-第7轮-声音与音乐-v1.6.0.md` 第 13 章。

## 缺资源时的行为

`utils/audio.js` 在 Howl 创建时 `onloaderror` / `onplayerror` 静默忽略，资源缺失不阻塞首屏，控制台无 404 噪声。开发期可分批加资源，不必一次到位。
