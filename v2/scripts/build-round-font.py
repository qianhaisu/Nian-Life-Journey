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
# 补充层（extra）：这个站真实用到、但不在 text-* 常用字里的字。见 extra_codepoints()。
EXTRA_PATH = REPO / "v2" / "scripts" / "data" / "round-font-extra.txt"
EXTRA_NAME = "nian-round-extra-00.woff2"

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


def extra_codepoints(cmap: set[int], covered: set[int]) -> list[int]:
    """补充层的字。

    为什么需要它：cover-NN 是按码位切的大片（每片约 100 KB），而 text-NN 只有 3,807 个常用字。
    这个站是一个真实家庭写的档案，里面有常用字之外的字——2026-09-19 在私有站上量到：6 月页 913 个
    不同的字里，9 个生僻字各自拖下了一整片 cover，约 0.9 MB 换 11 个字形；21 个月的内容文件里
    共有 93 个这样的字，分散在 22 个 cover 分片里。所以把它们并成**一个**小分片，写在所有 text-*
    的后面（后写的先接管码位），一页里出现再多这样的字也只取这一片。

    字表在 scripts/data/round-font-extra.txt，每行一个 U+ 码位。只记码位，不记文字。
    已经被 text-* 覆盖的、字体本身没有的，都会被滤掉——文件里多写几个不会出错。
    """
    if not EXTRA_PATH.exists():
        return []
    codes: set[int] = set()
    for line in EXTRA_PATH.read_text(encoding="utf-8").splitlines():
        line = line.split("#", 1)[0].strip()
        if line.upper().startswith("U+"):
            codes.add(int(line[2:], 16))
    return sorted(code for code in codes if code in cmap and code not in covered and code > 0x2E7F)


def claimed_codepoints(cmap: set[int]) -> list[int]:
    """extra-00 在 unicode-range 里**认领**、但字体本身没有字形的码位。

    为什么要认领一个没有字形的码位：cover-NN 的 unicode-range 是「首码位–末码位」的整段区间，
    不把字体没有的洞挖掉（挖出来要 47 KB CSS，见 main() 里的注释）。代价是：页面上出现一个字体
    根本没有的字，浏览器仍会去取覆盖它的那一整片 cover（约 100 KB），下完才发现没有字形、退回系统字体。
    最后一片 cover-25 是 U+9E6B–2F8D2，一个跨度把 emoji 区和 U+FE0F（emoji 后面的变体选择符）全罩住了，
    所以只要页面上有一个 emoji，就白白多下一片。

    由 extra-00 认领这些码位：浏览器会去取更小的 extra-00（~22 KB），同样发现没有字形、同样退回系统
    字体——观感一模一样，少下约 80 KB。后写的先接管，所以 extra-00 必须在 cover-* 之后（它在最后）。

    认领两类：字表里请求了、但字体没有的码位；以及 U+1F000–1FFFF 里字体没有字形的空隙
    （字体在这个区间里有 80 个真字形，整块认领会把它们抢走，所以只认领空隙）。
    """
    lacking: set[int] = set()
    if EXTRA_PATH.exists():
        for line in EXTRA_PATH.read_text(encoding="utf-8").splitlines():
            line = line.split("#", 1)[0].strip()
            if line.upper().startswith("U+"):
                code = int(line[2:], 16)
                if code > 0x2E7F and code not in cmap:
                    lacking.add(code)
    lacking.update(code for code in range(0x1F000, 0x20000) if code not in cmap)
    return sorted(lacking)


def text_covered(css: str) -> set[int]:
    """从现有 fonts.css 读出所有 text-* 片覆盖的码位（extra_only 用，免得重算词频）。"""
    covered: set[int] = set()
    for match in re.finditer(r"@font-face\s*\{([^}]*)\}", css):
        body = match.group(1)
        if "nian-round-text-" not in body:
            continue
        for part in re.search(r"unicode-range:\s*([^;]+);", body).group(1).split(","):
            lo, _, hi = part.strip().lstrip("Uu+").partition("-")
            covered.update(range(int(lo, 16), int(hi or lo, 16) + 1))
    return covered


def extra_only() -> None:
    """只新增/更新补充分片，并补丁 fonts.css——**不碰**原有的 cover-* / text-*。

    完整重建（main）会删光所有分片、按当天仓库语料重排常用字，3.3 MB 的二进制都会变；
    而补充层只是一片小文件，没必要为它把 37 片全部重来。
    """
    if not SOURCE_TTF.exists():
        raise SystemExit(f"源字体不在：{SOURCE_TTF}")
    css = CSS_PATH.read_text(encoding="utf-8")
    cmap = {code for code in TTFont(SOURCE_TTF).getBestCmap() if code > 0x2E7F}
    extra = extra_codepoints(cmap, text_covered(css))
    if not extra:
        raise SystemExit("补充字表为空或全部已被覆盖，什么也没做")
    size = build_slice(extra, OUT_DIR / EXTRA_NAME)
    # 已经有这一片就先去掉旧的，再追加到最后（后写的先接管码位，所以必须在所有 text-* 之后）。
    old = re.compile(r"@font-face\s*\{[^}]*" + re.escape(EXTRA_NAME) + r"[^}]*\}\n?")
    css = old.sub("", css).rstrip("\n") + "\n" + face(EXTRA_NAME, sorted({*extra, *claimed_codepoints(cmap)})) + "\n"
    # 只数真正的 face 块（行首的 `@font-face {`）：头部注释里写着「@font-face 里写 font-weight…」，
    # 直接数子串会多出一个（2026-09-19 第一次跑就多算成了 39）。
    faces = len(re.findall(r"^@font-face \{", css, flags=re.MULTILINE))
    total = sum(path.stat().st_size for path in OUT_DIR.glob("nian-round-*.woff2"))
    css = re.sub(r"合计 \d+ 片 [\d.]+ MB", f"合计 {faces} 片 {total / 1024 / 1024:.2f} MB", css, count=1)
    if "extra-00" not in css.split("*/", 1)[0]:
        marker = "生僻字才会去取 cover-*。\n"
        css = css.replace(
            marker,
            marker
            + "   第三层 extra-00 是这个站真实用到、却不在常用字里的字（scripts/data/round-font-extra.txt），\n"
            + "   写在最后：一页里出现再多这样的字，也只取这一片，而不是每个字各拖一整片 cover。\n",
            1,
        )
    CSS_PATH.write_text(css, encoding="utf-8")
    print(f"{EXTRA_NAME}: {len(extra)} 字 {size / 1024:.1f} KB；fonts.css 共 {faces} 片")


def main() -> None:
    if "--extra-only" in sys.argv:
        extra_only()
        return
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
    # 第三层：补充分片，必须在所有 text-* 之后（后写的先接管码位）。
    extra = extra_codepoints(cmap, set(priority))
    if extra:
        size = build_slice(extra, OUT_DIR / EXTRA_NAME)
        total += size
        faces.append(face(EXTRA_NAME, sorted({*extra, *claimed_codepoints(cmap)})))
        print(f"{EXTRA_NAME}: {len(extra)} 字 {size / 1024:.1f} KB")
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
