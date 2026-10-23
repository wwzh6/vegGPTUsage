# 植被组额度查询

统一账号的七天用量圆环：**已用百分比 + 重置倒计时**。管理员配置一次，成员电脑无需填写账号 API Key。

## 让 AI 安装

> 请安装 https://github.com/wwzh6/vegGPTUsage 的“植被组额度查询”。按 AGENTS.md 和 docs/AI-INSTALL.md 使用预构建文件安装，复用本机 GitHub 登录验证仓库读取权限，不要索取或配置 COTEMU_API_KEY。

支持 Windows、Node.js ≥22.19 和 Git。仓库是私有的，成员需具备仓库读取权限；安装插件本身不会授予 GitHub 权限。运行文件已经构建，不需要 npm 或 Python。

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File scripts/install.ps1
node dist/check-access.mjs
```

重新打开 Codex 后，从全局侧边栏或会话侧面板的插件入口打开“植被组额度查询”，无需每次发送对话。宿主未展示入口时可发送“打开植被组额度查询”。全局入口是启动快捷方式，不保证圆环嵌入左侧导航栏或跨重启常驻。详见 [AI 安装工作流](docs/AI-INSTALL.md)。

## 统一配置

管理员把绑定账号的 API Key 保存为仓库的 `COTEMU_API_KEY` Actions Secret。完整密钥不进入源码、安装包或成员电脑。配置方法见 [管理员设置](docs/ADMIN-SETUP.md)。

GitHub Actions 按十分钟计划查询一次，只将整理后的用量、重置时间和查询状态发布到 `quota-data` 分支。任务受 GitHub 排程和 Actions 可用额度约束，可能延迟。客户端每十分钟检查更新，点击只读取最近的同步结果，不直接查询账号，也不触发工作流。

## 显示与权限

- 圆环保持两行。详细状态在悬停提示中；数据过时或同步失败保留旧值并标记。
- 数据属于统一密钥绑定账号，可能包含其他使用者，不代表个人花费、账单余额或实际可调用余量。
- 普通成员只读取私有仓库数据。管理员手动运行 `Sync shared quota` 可要求重新查询；鉴权失败后需管理员修复并手动重试。
- 同步端仅访问账号只读接口，不使用队伍码、队伍管理令牌或模型接口。接口依据：https://docs.cotemu.com/agent-api.md
- 隐藏停止客户端轮询；用面板原生按钮或聚焦圆环按 Esc 关闭。关闭客户端不影响组内统一同步任务。

内部插件 ID 保留 `cotemu-usage-ball@cotemu-local`，用于原地升级。旧版电脑需要升级到 0.3.0 才会改用共享数据。客户端缓存仅含脱敏数据；GitHub 凭证从 Git Credential Manager 或 GitHub CLI 读取，不写入缓存。

## 开发与发布

```powershell
npm ci --ignore-scripts
npm run check
npm run build
npm test
python scripts/package.py
```

一起提交 `dist/`、`runtime.sha256.json`。版本标签触发测试和 Release 打包；统一查询工作流独立运行。验证记录见 [VERIFICATION.md](VERIFICATION.md)。
