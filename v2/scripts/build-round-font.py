"""生成站点自托管的中文圆体（NianRound），按 unicode-range 分片。

来源字体不在仓库里（6.1 MB TTF，且它是原始未修改的第三方字体）：

    C:\\Users\\teddy\\.codex\\visualizations\\2026\\09\\13\\01a099d7-35aa-7531-83c8-39abce4014d9\\chill-round.ttf
    ChillRoundF v3.000 © 2023 ChillType，SIL Open Font License 1.1
    https://github.com/Warren2060/ChillRound

OFL 第 3 条：修改版不得沿用保留字体名（ChillRoundF / ChillRoundM）。所以每个分片的
name 表都改写成 NianRound，许可证原文与修改说明随字体一起放在
v2/public/fonts/nian-round/LICENSE.txt。

分片顺序不是按码位，而是按「这个站真的会用到的字」排：先用仓库里的中文语料统计词频，
再补 GB2312 一级字（3,755）、二级字（3,008），最后是字体里剩下的全部汉字与中文标点。
这样常用字落在最前面几片，一页中文通常只需要下载其中几片；同时全字体覆盖仍然在，
以后写进档案的生僻字不会掉回系统字体。

跑法（需要 Python 3.12 —— font-tools 里的 brotli 扩展是 cp312 编译的）：

    "C:/Users/teddy/AppData/Roaming/uv/python/cpython-3.12.13-windows-x86_64-none/python.exe" \
        v2/scripts/build-round-font.py

产出：v2/public/fonts/nian-round/nian-round-NN.woff2 与 v2/app/fonts.css。
这两样都已提交，平时不需要重跑；只有换源字体或改分片策略时才跑。
"""

from __future__ import annotations

import re
import sys
from pathlib import Path

SOURCE_DIR = Path(r"C:\Users\teddy\.codex\visualizations\2026\09\13\01a099d7-35aa-7531-83c8-39abce4014d9")
SOURCE_TTF = SOURCE_DIR / "chill-round.ttf"
FONT_TOOLS = SOURCE_DIR / "font-tools"
FAMILY = "NianRound"
SLICE_SIZE = 380
COVER_SLICE_SIZE = 500

REPO = Path(__file__).resolve().parents[2]
OUT_DIR = REPO / "v2" / "public" / "fonts" / "nian-round"
CSS_PATH = REPO / "v2" / "app" / "fonts.css"

sys.path.insert(0, str(FONT_TOOLS))
from fontTools import subset  # noqa: E402
from fontTools.ttLib import TTFont  # noqa: E402


def corpus_ranking() -> list[str]:
    """仓库里现成的中文语料（文档 + 源码注释/文案）按出现次数排序。"""
    counts: dict[str, int] = {}
    roots = [REPO / "docs", REPO / "v2" / "app", REPO / "v2" / "components", REPO / "v2" / "lib", REPO / "CLAUDE.md", REPO / "AGENTS.md"]
    files: list[Path] = []
    for root in roots:
        if root.is_file():
            files.append(root)
        elif root.is_dir():
            files.extend(p for p in root.rglob("*") if p.suffix in {".md", ".ts", ".tsx", ".css", ".mjs"} and p.is_file())
    for path in files:
        try:
            text = path.read_text(encoding="utf-8", errors="ignore")
        except OSError:
            continue
        for char in text:
            if "\u2e80" <= char <= "\u9fff" or "\u3000" <= char <= "\u303f" or "\uff00" <= char <= "\uffef":
                counts[char] = counts.get(char, 0) + 1
    # 只出现一次的字多半是文档里的偶发用字，把它们留给后面按码位排的分片：排在前面
    # 只会让 CSS 里多出一串散码位，并在尾部的连续区间上打洞。
    return [char for char, count in sorted(counts.items(), key=lambda item: (-item[1], ord(item[0]))) if count > 1]


def gb2312_level(level: int) -> list[str]:
    rows = range(0xB0, 0xD8) if level == 1 else range(0xD8, 0xF8)
    out: list[str] = []
    for hi in rows:
        for lo in range(0xA1, 0xFF):
            try:
                out.append(bytes([hi, lo]).decode("gb2312"))
            except UnicodeDecodeError:
                continue
    return out


def priority_codepoints(cmap: set[int]) -> list[int]:
    """常用字，按「这个站真的会用到」的顺序：语料词频 → GB2312 一级字（3,755）。

    一页中文几乎只会落在这批字上，所以它们排在最前面、单独成片，而且片子小。
    """
    seen: set[int] = set()
    order: list[int] = []
    for char in [*corpus_ranking(), *gb2312_level(1)]:
        code = ord(char)
        if code in cmap and code not in seen and code > 0x2E7F:
            seen.add(code)
            order.append(code)
    return order


def unicode_range(codes: list[int]) -> str:
    """相邻码位合并成区间，CSS 才不会变成一串一万多个 U+xxxx。"""
    parts: list[str] = []
    start = prev = codes[0]
    for code in codes[1:]:
        if code == prev + 1:
            prev = code
            continue
        parts.append(f"U+{start:X}" if start == prev else f"U+{start:X}-{prev:X}")
        start = prev = code
    parts.append(f"U+{start:X}" if start == prev else f"U+{start:X}-{prev:X}")
    return ",".join(parts)


def build_slice(codes: list[int], out_path: Path) -> int:
    font = TTFont(SOURCE_TTF)
    options = subset.Options()
    options.flavor = "woff2"
    options.name_IDs = ["*"]
    options.drop_tables += ["DSIG"]
    subsetter = subset.Subsetter(options=options)
    subsetter.populate(unicodes=codes)
    subsetter.subset(font)
    # OFL 3)：改过的字体不能再叫 ChillRoundF。1/3/4/6/16 是家族名、唯一标识、全名、
    # PostScript 名、首选家族名——五个都要换掉，浏览器和系统才不会把它当原字体。
    for record in font["name"].names:
        if record.nameID in (1, 3, 4, 6, 16):
            record.string = FAMILY.encode(record.getEncoding(), errors="replace")
    font.flavor = "woff2"
    font.save(out_path)
    return out_path.stat().st_size


def face(name: str, codes: list[int]) -> str:
    return (
        "@font-face {\n"
        f"  font-family: '{FAMILY}';\n"
        "  font-style: normal;\n"
        # 400 900 是故意的。字体只有 Regular 一个字重；把区间声明出来，浏览器就会拿这一份字形去
        # 匹配任何字重，而不是**合成**粗体。合成粗体对圆头笔画是灾难：80px 的「往回翻翻，张年。」
        # 实测糊成一团，「翻」字的笔画直接粘在一起（2026-09-13 /memory 页实测）。
        "  font-weight: 400 900;\n"
        "  font-display: swap;\n"
        f"  src: url('/fonts/nian-round/{name}') format('woff2');\n"
        f"  unicode-range: {unicode_range(codes)};\n"
        "}"
    )


def main() -> None:
    if not SOURCE_TTF.exists():
        raise SystemExit(f"源字体不在：{SOURCE_TTF}")
    cmap = {code for code in TTFont(SOURCE_TTF).getBestCmap() if code > 0x2E7F}
    priority = priority_codepoints(cmap)
    OUT_DIR.mkdir(parents=True, exist_ok=True)
    for stale in OUT_DIR.glob("nian-round-*.woff2"):
        stale.unlink()

    # 两层分片。
    #
    # 底层 cover-NN 按码位顺序切，覆盖字体里的全部汉字与中文标点——包括常用字。它的
    # unicode-range 因此是连续区间，写进 CSS 只有几十个字节。
    # 上层 text-NN 是常用字，按词频排，片子小；它写在 CSS 的后面。
    #
    # 为什么可以重叠：同一 font-family 的多条 @font-face，unicode-range 相交时由**后写的那条**
    # 接管该码位（CSS Fonts 的匹配顺序），浏览器只会下载接管的那一片。所以常用字命中小片，
    # 生僻字才会去取对应的大片；覆盖没有缺口，CSS 也不必把一万多个散码位一个个列出来
    # （那样是 77 KB，现在是 ~26 KB）。这条行为在真机上要实测：首页只应请求 text-* 分片。
    cover = [sorted(cmap)[i:i + COVER_SLICE_SIZE] for i in range(0, len(cmap), COVER_SLICE_SIZE)]
    text = [priority[i:i + SLICE_SIZE] for i in range(0, len(priority), SLICE_SIZE)]
    faces: list[str] = []
    total = 0
    for index, chunk in enumerate(cover):
        name = f"nian-round-cover-{index:02d}.woff2"
        total += build_slice(chunk, OUT_DIR / name)
        # 覆盖层的 unicode-range 写成一个整区间，不把字体没有的码位挖掉：字体的 cmap 在
        # 4E00–9FFF 里本来就是稀疏的（12,093 / 20,992），逐洞写出来要 47 KB CSS。声明成整段的
        # 代价只是：真的用到一个字体没有的字时，浏览器会先取这一片，发现没有字形再按 font-family
        # 往后退——那种字反正也只能退到系统字体，多的只是一次请求。
        faces.append(
            "@font-face {\n"
            f"  font-family: '{FAMILY}';\n"
            "  font-style: normal;\n"
            "  font-weight: 400 900;\n"  # 同上：声明区间以免浏览器合成粗体
            "  font-display: swap;\n"
            f"  src: url('/fonts/nian-round/{name}') format('woff2');\n"
            f"  unicode-range: U+{chunk[0]:X}-{chunk[-1]:X};\n"
            "}"
        )
    for index, chunk in enumerate(text):
        name = f"nian-round-text-{index:02d}.woff2"
        size = build_slice(chunk, OUT_DIR / name)
        total += size
        faces.append(face(name, chunk))
        print(f"{name}: {len(chunk)} 字 {size / 1024:.1f} KB")
    header = (
        "/* NianRound —— 站点自托管中文圆体，由 v2/scripts/build-round-font.py 生成，不要手改。\n"
        "\n"
        "   源字体：ChillRoundF v3.000 © 2023 ChillType，SIL Open Font License 1.1\n"
        "   https://github.com/Warren2060/ChillRound\n"
        "   本站使用的是子集化并改名后的修改版（OFL 3 条：保留字体名不得沿用），\n"
        "   许可证原文与修改说明见 public/fonts/nian-round/LICENSE.txt。\n"
        "\n"
        f"   两层：cover-NN 按码位覆盖全部 {len(cmap)} 个汉字与中文标点；text-NN 是 {len(priority)} 个常用字，\n"
        "   按词频排，写在后面因而优先命中。一页中文通常只取到前几片 text-*，生僻字才会去取 cover-*。\n"
        f"   合计 {len(faces)} 片 {total / 1024 / 1024:.2f} MB。拉丁字母和数字不在分片里——它们仍然走 Nunito。\n"
        "   全部文件同源静态托管，运行时不请求 Google Fonts。 */\n\n"
    )
    CSS_PATH.write_text(header + "\n".join(faces) + "\n", encoding="utf-8")
    print(f"共 {len(faces)} 片（cover {len(cover)} / text {len(text)}）{total / 1024 / 1024:.2f} MB → {CSS_PATH}")


if __name__ == "__main__":
    main()
