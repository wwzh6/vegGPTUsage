# 植被组额度查询

统一账号的七天用量圆环：**已用百分比 + 重置倒计时**，下方展示可在 GitHub 编辑的文字卡片。管理员配置一次，成员电脑无需填写账号 API Key。

## 让 AI 安装

> 请安装 https://github.com/wwzh6/vegGPTUsage 的“植被组额度查询”。按 AGENTS.md 和 docs/AI-INSTALL.md 使用预构建文件安装，复用本机 GitHub 登录验证仓库读取权限，不要索取或配置 COTEMU_API_KEY。

支持 Windows、Node.js ≥22.19 和 Git。当前公开仓库支持匿名读取，无需 GitHub 登录；私有部署需要读取权限。运行文件已经构建，不需要 npm 或 Python。

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File scripts/install.ps1
node dist/check-access.mjs
```

重新打开 Codex 后，从全局侧边栏或会话侧面板的插件入口打开“植被组额度查询”，无需每次发送对话。宿主未展示入口时可发送“打开植被组额度查询”。全局入口是启动快捷方式，不保证圆环嵌入左侧导航栏或跨重启常驻。详见 [AI 安装工作流](docs/AI-INSTALL.md)。

## 统一配置

管理员在统一查询服务器配置账号 API Key。完整密钥不进入源码、安装包或成员电脑。部署方法见 [服务器同步](docs/SERVER-SYNC.md)，GitHub Actions 保留为备用方式。

服务器按每小时第 0、10、20、30、40、50 分钟查询，将脱敏结果发布到 GitHub 的 `quota-data` 分支。客户端可见时独立每十分钟检查更新，点击只读取最近快照，不直接查询账号。两个周期独立，新快照可能再等待最多一个客户端刷新周期。网络故障、上游数据延迟和限流仍可能推迟成功更新。

## 显示与权限

- 圆环保持两行。悬停只显示已用比例、距重置时间、账号数据年龄；不显示“旧”标签。查询失败保留上次值，不伪造更新时间。
- 下方文字卡片由 `main/NOTICE.md` 控制，额度查询时一并读取，无需构建或重装。见 [文字编辑说明](docs/NOTICES.md)。
- 数据属于统一密钥绑定账号，可能包含其他使用者，不代表个人花费、账单余额或实际可调用余量。
- 普通成员只读取仓库数据。服务器管理员执行 `systemctl start vegetation-quota-sync.service` 可立即查询。GitHub 的 `Sync shared quota` 在服务器接管期间保持停用；鉴权错误恢复见服务器同步说明。
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
