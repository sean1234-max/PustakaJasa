# AI Review 教材：历史 review 修改（2026-11-02）

来源：34 张订单（老师原本 Excel → Production 改好的 Corrected Excel，逐格对比）。
其他约 160 张在网站上改的订单没有保存修改前的版本，不在这里。
✅ = 规则本已有；🆕 = 新发现，要 Sean 确认后才加进 ai-review-rules.md；❓ = 要 Sean 解释原因。

## ✅ 已有规则的实例
- C 字放错行 / 同格塞两行：ORD-0171 "SAMBUTAN HARI KANAK-KANAK 2026⏎ANUGERAH KEHADIRAN TERBAIK" 拆成 TAJUK BESAR + ②；ORD-0050 ORDER LAIN-LAIN 奖项从 D 栏移到 C 栏
- D 补 "-"：ORD-0189 TAJUK BESAR 已有 PRASEKOLAH → 各行 PRASEKOLAH 改成 "-"
- B MERAH：ORD-0046（4 个 sheet 补 MERAH）、ORD-0050
- E OTHER：ORD-0089 OTHER → SONGKET / A / RED
- F 错字：PENCEAPAIAN→PENCAPAIAN (0005)、MUIRD→MURID (0008)、TEBAIK→TERBAIK、BAHAHA (0130)
  - ⚠ ORD-0189 KEEMERLANGAN 被改成 KEMERLANGAN，正确应该是 KECEMERLANGAN（人工 review 也会漏）

## 🆕 新发现
- N1 模板提示字没换掉：(IKUT SUBJEK) / (IKUT TAHUN) / (IKUT JANTINA) / (SUBJEK SEPERTI DI BAWAH) → 换成第一行的实际值（ORD-0086、0089）
- N2 TAJUK BESAR 分两行：", 2026" → 换行 2026；长标题拆两行（ORD-0048、0155）
- N3 TOKOH 性别：「TOKOH AKADEMIK (LELAKI)」→ 名称 TOKOH AKADEMIK + 栏位 LELAKI（ORD-0089）
- N4 SELEMPANG 颜色：「MERAH 0050」→「MERAH」（ORD-0086）
- N5 Jenis Plak 写法统一：YK628 → YK - 628（0127）
- N6 漏了学校名 / 年份：ORD-0187 "-" 换成 SK TELOK GONG；ORD-0071 补 2026
- N7 TAJUK BESAR 漏 "HARI"：ANUGERAH KECEMERLANGAN 2026 → HARI ANUGERAH KECEMERLANGAN 2026（ORD-0001）

## ❓ Sean 的回答（2026-11-02）
- Q1 删掉整行 / 整个 sheet（ORD-0077、0136、0004、0005、0008）：不记得原因 → 不当教材
- Q2 ORD-0056 TAHUN → KPKP：Kent 的订单由 Production 代为 key in，原本填错 → 不是通用规则；代 key in 的订单一样要 review
- Q3 ORD-0189 ANUGERAH TERBAIK → TERBAIK：review 时改错了，应保持 ANUGERAH TERBAIK → 反例，不能学
- Q4 ORD-0101 → PBD TERBAIK：填错，后来改回 → 不当教材
- Q5 ORD-0169 PK 261 / A → PK 262 / A：PK 261 / A 缺货 → 🆕 N8

## 🆕 N8 缺货换款
- 💬 Jenis Plak 库存不够 → 换成同类的替代款（例：PK 261 / A → PK 262 / A），先问 salesman 再换
