# 贡献

## 维护者

chengzhao-dev <hsy13626781560@163.com>

## 提交前

```bash
node scripts/check-contrast.mjs
```

脚本必须全部通过。改动了 `css/tokens.css`、组件颜色或字体尺寸时，另外检查 1440、768、375 三档视口，确认没有横向溢出、焦点可见、色板仍可横向滚动。

## 提交信息

使用 Conventional Commits，描述用中文，结尾不加句号：

```
fix: 提高微文字对比度
feat: 增加长文示例页
docs: 补充 Quarto 集成说明
```

一次提交只做一件事。不要提交 `.tmp/`、`_site/`、`_book/`、`.quarto/` 或本机截图配置。

## 色值

色值只写在 `css/tokens.css`。组件使用语义变量；新增颜色时先决定它在四时中的语义，再给四个主题分别赋值，并运行对比度检查。
