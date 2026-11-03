# AI Review 规则本 v0.4

来源：2026-11-02 访问 Sean（Production review 流程）+ 34 张历史订单（docs/ai-review-examples.md，N1–N8 Sean 2026-11-02 确认）。
新规则只在 Sean 确认后加入。每条规则标明 ✏️ 自己改 或 💬 问 salesman。

## 流程
1. 打开订单 → Edit Order → 下载老师的 Excel，和网站逐项对比
2. 依序检查下面 A → I
3. 网站改 → Save Changes；Excel 改 → Upload Corrected Excel

## A. Sheet
- A1 ✏️ Excel 的 sheet 和网站的类别一一对上、数量也对；少了就补上

## B. Reference Sample
- B1 💬 含 ANUGERAH…、PERTAMA / KEDUA / KETIGA、科目（BAHASA MELAYU、BAHASA INGGERIS…）的行没勾 MERAH → 问 salesman（做 AI sample 让老师选）
  - 网站 AI Review：每个 sheet 一行，「Show red / black」并排显示红 / 黑两块牌子 → screenshot 给 salesman → 按 Use red / Keep black 存进这个 sheet 的 MERAH，之后不再问
- B2 ✏️ Reference Sample 没填 → 自己补（salesman 常常不填）

## C. 字放错行（最常见）
- C1 TAJUK BESAR = 活动名（HARI ANUGERAH… / MAJLIS…）
- C2 ✏️ ORDER LAIN-LAIN：没有 TAJUK BESAR 时，ANUGERAH… 可以放在 ①
- C3 ✏️ 其他所有 sheet：ANUGERAH… 一律从 ② 开始（② 固定红色）。放在 ① → 移去 ②，Reference Sample ② 补 ANUGERAH… 并勾 MERAH

## D. "-"
- D1 💬 TAJUK BESAR 已出现的字（例如 PRASEKOLAH）在 Reference Sample 某行，大部分 Order Details 行放了 "-"，个别行没放 → 问 salesman 是否漏放

## E. Jenis Plak
- E1 💬 OTHER 但没写 code / 价钱 → 问 salesman（网站已挡 submit，这是后备检查）

## F. 错字
- F1 ✏️ 逐字检查固定用词（例：KEMERLANGAAN → KECEMERLANGAN）
- F2 学生 / 老师名字不检查拼写

## H. TAHNIAH
- H1 ✏️ TAHNIAH → Tahniah，红色，Playball，字号 23（由 SEAN.jsx 处理）

## I. QTY 和价钱
- I1 有 Front Page → Front Page 和网站对比
- I2 没 Front Page → Excel 的 QTY / 价钱和网站对比
- I3 💬 Front Page 有某 Jenis Plak（如 PK 261 / A）但 Order Details 没有 → 问 salesman
- I4 💬 Front Page 某 Jenis Plak 总数 ≠ Order Details 总数（如 50 vs 45）→ 问 salesman 哪边错
- I5 ✏️ 有学生名字的行价钱 +RM1，没名字的保持原价（Production 标记，AI 从标记学习）
  - 这些 Jenis Plak 的价钱已经包含名字，不用 +RM1：所有 CRYSTAL、VB、SONGKET、57166 A、SHINING STICKER A、ALUMINIUM PLATE A、WOOD ENGRAVED A（2026-11-03）

## J. 从历史订单学到的（2026-11-02 确认）
- J1 ✏️ 模板提示字没换掉：(IKUT SUBJEK) / (IKUT TAHUN) / (IKUT JANTINA) / (… SEPERTI DI BAWAH) → 换成实际的值
- J2 ✏️ TAJUK BESAR 太长就分两行（"…, 2026" → 换行 2026）
- J3 ✏️ TOKOH 名称里带性别「TOKOH AKADEMIK (LELAKI)」→ 名称 TOKOH AKADEMIK + 性别栏 LELAKI
- J4 ✏️ SELEMPANG 颜色带编号「MERAH 0050」→「MERAH」
- J5 ✏️ Jenis Plak 写法跟网站价钱表一致（YK628 → YK - 628）
- J6 💬 漏了学校名或年份（行里只有 "-" 或少了 2026）→ 补上，不确定就问
- ~~J7 TAJUK BESAR 漏 HARI~~ 取消（2026-11-05）：TAJUK BESAR 可以是 ANUGERAH…、MAJLIS…、HARI… 开头，都是对的
- J8 💬 Jenis Plak 缺货 → 换同类替代款（PK 261 / A → PK 262 / A），先问 salesman
- 代 key in 的订单（例：Kent 的订单由 Production 输入）一样要完整 review

## K. 名次颜色（2026-11-02）
- K1 有 background 的牌子：JOHAN / NAIB JOHAN / KETIGA 不换金银铜色，一律红色（SEAN.jsx + 网站预览已改）；没有 background 的照旧用名次颜色
- K2 ✏️ 名次字（JOHAN、NAIB JOHAN、PERTAMA、KEDUA、TEMPAT KETIGA、JUARA…）优先当红色行，排在 ANUGERAH / TOKOH 前面；名次是黑色 → 要改（AI Review 规则 R1）。名次已经是红色时，ANUGERAH / TOKOH 黑色是对的，不再问

## 谁来检查：程序 vs AI
程序 = 规则固定，每次结果一样，不花钱；AI = 要看意思判断。

| 程序检查 | AI 判断 |
|---|---|
| A1 sheet 数量 | C1 / C3 哪个是活动名、哪个是奖项名 |
| B1 关键字（ANUGERAH、PERTAMA…、科目）没勾 MERAH | F1 字典以外的错字 |
| C3 非 ORDER LAIN-LAIN 的 ① 出现 ANUGERAH | J2 标题要不要分两行 |
| D1 TAJUK BESAR 的字在下面的行又出现、没放 "-" | J3 名称里的性别 |
| E1 OTHER 没 code / 价钱 | J6 漏了学校名或年份 |
| I1–I4 Front Page / Excel / 网站的 QTY 和价钱 | |
| J1 括号提示字 (IKUT …) | I5 哪些行有学生名字（+RM1） |
| J4 颜色带编号、J5 Jenis Plak 写法 | |
| J8 库存不够 | |
| F1 常用字错字（现有 typoCheck 字典） | |

## 学习循环
AI review → 给 Sean 看报告 → Sean 改了 AI 没抓到的地方 → AI 问原因 → 整理成新规则 → Sean 确认后加进本文件
