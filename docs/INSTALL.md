# Windows 安装与更新

运行 `Matthew Planner Setup 0.3.0.exe`。安装程序为当前 Windows 用户安装软件，
创建桌面和开始菜单中的 **Matthew Planner** 快捷方式，无需管理员权限。

首次切换到安装版之前，请保存 Notes 并正常关闭旧便携版。以后从快捷方式打开，
避免同时启动旧便携版。安装版和旧版沿用 `%APPDATA%\Matthew Planner` 的计划与设置。

如果从 Microsoft Store 版 Codex 直接启动后看到空白计划，先正常关闭该窗口，
再从 Windows 桌面或开始菜单快捷方式打开。Windows 的应用隔离可能让 Codex 启动的
进程读取另一份 AppData 数据。原计划仍可能完整存在于真实用户目录，不要覆盖数据库。
已连接助手的入口排查见 [Work 输入说明](WORK_INPUT.md#windows-packaged-host-isolation)。

打开安装版后，右键任务栏上的 Matthew Planner 图标，选择「固定到任务栏」。
以后的安装包会更新同一安装位置，应用标识和快捷方式名称保持不变。
通过这个入口打开的是已安装的最新版本；软件不会自行从 GitHub 下载更新。

升级时下载并运行新的 Setup 安装包即可。卸载默认保留个人数据。
本项目目前未购买 Windows 代码签名证书，安装包未签名。

## 构建

```powershell
pnpm package:installer
```

输出在 `release/`，同时生成可供桌面验证的 `win-unpacked/`。
安装使用每用户 NSIS，固定 appId `local.matthew.planner`，桌面和开始菜单快捷方式
指向安装目录里的 `Matthew Planner.exe`。版本号仅用于安装包文件名。
图标源文件为 `build/icon.svg`，运行 `node scripts/build-icon.mjs` 可重新生成 PNG/ICO。
