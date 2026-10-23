# 植被组额度查询

Codex 会话侧面板中的七天用量圆环。界面只有两行：**已用百分比**和**重置倒计时**；点击刷新，每十分钟自动更新。

## 让 AI 安装

把下面这段话发给目标电脑上的 AI：

> 请按 https://github.com/wwzh6/vegGPTUsage 的 AGENTS.md 和 docs/AI-INSTALL.md 安装“植被组额度查询”，使用预构建文件。需要密钥时打开本地遮掩输入窗口，不要在聊天中索取密钥。完成后检查插件工具是否可用。

支持 Windows、Node.js ≥22、支持会话 MCP App 入口的 Codex 桌面端。安装无需 npm 或 Python；完整步骤见 [AI 安装工作流](docs/AI-INSTALL.md)。源码已含 `dist/`，Release ZIP 也包含完整运行文件。

手动安装，在仓库或解压目录执行：

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File scripts/install.ps1 -ConfigureKey
```

密钥保存后完全退出、重启 Codex，再发送“打开植被组额度查询”。

## 密钥是什么

`COTEMU_API_KEY` 是服务商“密钥管理”中创建、绑定具体账号的 API 密钥，常见格式 `sk-ctm-…`，旧格式 `ctm_…`。它不是队伍码，也不是 `ctm-team-…` 队伍管理令牌。每台电脑本地输入；不要放入聊天、仓库、命令行参数或安装包。

该变量仅写入当前 Windows 用户环境变量，不是加密密钥库。多台电脑使用相同密钥时显示同一绑定账号的数据。

## 显示规则

- 两色圆环表示已用/剩余比例；数据属于绑定账号，可能包含其他使用者，不代表个人花费、账单余额或实际可调用余量。
- 查询失败保留旧百分比，第二行短提示、颜色与悬停信息标识状态。详细账号状态、更新时间及“仅供参考”放在悬停和无障碍文本中。
- 十五秒内点击不重复请求；429 遵守冷却；401/403 暂停自动查询；隐藏停止轮询。关闭用面板原生按钮，或聚焦圆环按 Esc；宿主保留面板时点击圆环重开。
- 只查询 `GET https://cotemu.com/api/open/accounts`，不调用队伍、写入或模型接口。接口依据：[官方说明](https://docs.cotemu.com/agent-api.md)。

插件显示名称已改；内部 ID `cotemu-usage-ball@cotemu-local` 与环境变量名保留，兼容旧版本原地升级。缓存只含脱敏展示字段，位于 `%LOCALAPPDATA%/cotemu-usage-ball/cache`。

## 开发与发布

```powershell
npm ci --ignore-scripts
npm run check
npm run build
npm test
python scripts/package.py
```

提交源码时一起提交 `dist/`、`runtime.sha256.json`。推送 `v0.2.1` 等与 manifest 一致的版本标签后，GitHub Actions 检查、测试、打包并创建 Release。不要在 GitHub 配置真实业务密钥；所有测试使用模拟数据。

`node scripts/preview.mjs` 打开本地模拟宿主预览。验证边界见 [VERIFICATION.md](VERIFICATION.md)，依赖许可见 [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md)。
