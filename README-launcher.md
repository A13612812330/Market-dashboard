# 桌面启动

桌面快捷方式通过 `start-dashboard.vbs` 静默调用 `start-dashboard.ps1`。脚本会检查 `5190` 端口：服务未运行时在后台启动 Node 服务，等待服务就绪后再打开页面；服务已运行时直接打开页面。启动失败只记录到 `data/launcher-error.log`，不会弹出控制台窗口。

启动前可在项目根目录创建 `.env`。服务会自动读取其中的端口、管理员账号、Futu 与 AI 配置；`.env` 仅保存在当前电脑，不会被 Git 提交。

桌面快捷方式名称：`Komo Market Dashboard.lnk`

图标源文件：`assets/komo-market-icon.svg`；桌面快捷方式使用同目录生成的 `assets/komo-market-icon.ico`。
