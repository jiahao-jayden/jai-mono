# Todo: Skills Extension 与 Slash Command 能力

进度:6/6

| # | 状态 | Spec | 阻塞于 | gist |
|---|---|---|---|---|
| 01 | ✅ | [建立核心 Command registry 与 Extension 注册](./specs/01-command-registry-extension-registration.md) | - | Command registry、Extension handler 与稳定 watcher 验收完成。 |
| 02 | ✅ | [迁移 Skills 为内置 Extension](./specs/02-skills-extension-migration.md) | 01 | Skills catalog、Skill tool 与 `/skill:<skill-name>` 入口已迁入 Skills Extension。 |
| 03 | ✅ | [支持 File-based prompt template command](./specs/03-file-based-prompt-commands.md) | 02 | Skills Extension 已发现本地 Markdown command，完成参数替换并注册普通 `/name`。 |
| 04 | ✅ | [接入 Server/Desktop 并锁定 Agent Plugin 边界](./specs/04-host-command-integration.md) | 02、03 | Desktop Operation 装配 Skills Extension，安全投影 command subtype，Agent Plugin 保持不支持 Command。 |
| 05 | ✅ | [扩展本地 Skill Frontmatter 兼容与用户级链接发现](./specs/05-skill-frontmatter-compatibility.md) | 02、04 | 已兼容常见 frontmatter、分离 hidden/model 可见性，并锁定 user/workspace symlink 边界。 |
| 06 | ✅ | [严格采用 Agent Skills Frontmatter Schema](./specs/06-agent-skills-frontmatter-schema.md) | 05 | 已删除本地扩展字段，恢复 name/目录契约，并只投影标准 Skill metadata。 |

⬜ 未开始(计划待评审时不可执行) · 🔄 进行中 · ✅ 完成 · ⏸ 挂起

## 未决问题

无。
