"""Clip tools for the JARVIS desktop agent: search videos, download one with its captions, cut clips.
Needs yt-dlp and ffmpeg installed on this computer. Everything is written inside the workspace (clips/).
Only use it on videos you have the right to clip (campaign sources, your own, Creative Commons)."""
import json, os, re, shutil, subprocess

CC_FILTER = "&sp=EgIwAQ%253D%253D"       # YouTube search filter: Creative Commons only
MAX_SEGMENTS, MIN_SEC, MAX_SEC = 8, 5, 180


class ClipError(Exception):
    pass


def need(tool):
    if not shutil.which(tool):
        raise ClipError("%s is not installed on this computer. Install it first (Windows: winget install %s)." % (tool, {"yt-dlp": "yt-dlp", "ffmpeg": "Gyan.FFmpeg"}[tool]))


def _run(args, timeout):
    try:
        p = subprocess.run(args, capture_output=True, text=True, timeout=timeout, stdin=subprocess.DEVNULL)
    except subprocess.TimeoutExpired:
        raise ClipError("That took too long and was stopped.")
    if p.returncode != 0:
        raise ClipError((p.stderr or p.stdout or "failed").strip()[-600:])
    return p.stdout


def search_cmd(query, n=8, cc=False):
    q = re.sub(r"\s+", " ", str(query or "")).strip()[:200]
    if not q:
        raise ClipError("Give something to search for.")
    n = max(1, min(int(n or 8), 15))
    if cc:
        url = "https://www.youtube.com/results?search_query=%s%s" % (re.sub(r"[^\w\-]+", "+", q), CC_FILTER)
        return ["yt-dlp", "--flat-playlist", "--dump-json", "--playlist-end", str(n), url]
    return ["yt-dlp", "--flat-playlist", "--dump-json", "ytsearch%d:%s" % (n, q)]


def search(query, n=8, cc=False):
    need("yt-dlp")
    out = _run(search_cmd(query, n, cc), 90)
    rows = []
    for line in out.splitlines():
        try:
            d = json.loads(line)
        except ValueError:
            continue
        rows.append({"id": d.get("id"), "title": d.get("title"), "channel": d.get("channel") or d.get("uploader"),
                     "seconds": d.get("duration"), "views": d.get("view_count"),
                     "url": d.get("url") or ("https://www.youtube.com/watch?v=%s" % d.get("id"))})
    return rows


def _ts(s):
    m = re.match(r"(?:(\d+):)?(\d+):(\d+)[.,](\d+)", s)
    h, mi, se = int(m.group(1) or 0), int(m.group(2)), int(m.group(3))
    return h * 3600 + mi * 60 + se


def parse_vtt(text, block=20):
    """WebVTT -> '[mm:ss] words' lines, grouped into ~block-second chunks, auto-caption repeats removed."""
    cues, last = [], ""
    for chunk in re.split(r"\n\s*\n", text):
        m = re.search(r"(\d+:)?\d+:\d+[.,]\d+\s*-->", chunk)
        if not m:
            continue
        lines = chunk.splitlines()
        i = next(k for k, l in enumerate(lines) if "-->" in l)
        start = _ts(lines[i].split("-->")[0].strip())
        words = re.sub(r"<[^>]+>", "", " ".join(lines[i + 1:])).strip()
        words = re.sub(r"\s+", " ", words)
        if words and words != last:
            cues.append((start, words)); last = words
    out, cur_t, cur = [], None, []
    for t, w in cues:
        if cur_t is None:
            cur_t = t
        if t - cur_t >= block and cur:
            out.append("[%02d:%02d] %s" % (cur_t // 60, cur_t % 60, " ".join(cur))); cur_t, cur = t, []
        cur.append(w)
    if cur:
        out.append("[%02d:%02d] %s" % (cur_t // 60, cur_t % 60, " ".join(cur)))
    return "\n".join(out)


def fetch(root, url):
    need("yt-dlp")
    if not str(url).startswith("https://"):
        raise ClipError("Use a full https link.")
    folder = os.path.join(root, "clips", "source")
    os.makedirs(folder, exist_ok=True)
    out = _run(["yt-dlp", "--no-playlist", "-f", "bv*[height<=720]+ba/b[height<=720]/b", "--merge-output-format", "mp4",
                "--write-auto-subs", "--write-subs", "--sub-langs", "en.*,en", "--sub-format", "vtt",
                "-o", os.path.join(folder, "%(id)s.%(ext)s"), "--print", "after_move:filepath", url], 1500).strip().splitlines()
    path = out[-1] if out else ""
    if not path or not os.path.isfile(path):
        raise ClipError("The download did not produce a file.")
    base = os.path.splitext(path)[0]
    vtts = [f for f in os.listdir(folder) if f.startswith(os.path.basename(base)) and f.endswith(".vtt")]
    transcript = ""
    if vtts:
        with open(os.path.join(folder, sorted(vtts)[0]), encoding="utf-8", errors="replace") as f:
            transcript = parse_vtt(f.read())
    return {"source": os.path.relpath(path, root).replace("\\", "/"), "transcript": transcript}


def clean_name(name, i):
    n = re.sub(r"[^\w\-]+", "_", str(name or "clip%d" % (i + 1))).strip("_")[:40]
    return n or "clip%d" % (i + 1)


def validate_segments(segments):
    if not isinstance(segments, list) or not segments:
        raise ClipError("Give at least one segment with start and end seconds.")
    if len(segments) > MAX_SEGMENTS:
        raise ClipError("At most %d clips per run." % MAX_SEGMENTS)
    out = []
    for i, s in enumerate(segments):
        try:
            a, b = float(s["start"]), float(s["end"])
        except (KeyError, TypeError, ValueError):
            raise ClipError("Each segment needs numeric start and end seconds.")
        if a < 0 or b - a < MIN_SEC or b - a > MAX_SEC:
            raise ClipError("Each clip must be %d to %d seconds long." % (MIN_SEC, MAX_SEC))
        out.append((a, b, clean_name(s.get("name"), i)))
    return out


def cut_cmd(src, dst, a, b, vertical):
    cmd = ["ffmpeg", "-y", "-ss", "%.2f" % a, "-to", "%.2f" % b, "-i", src]
    if vertical:
        cmd += ["-vf", "crop=ih*9/16:ih,scale=1080:1920"]
    return cmd + ["-c:v", "libx264", "-preset", "veryfast", "-crf", "23", "-c:a", "aac", "-movflags", "+faststart", dst]


def cut(root, source, segments, vertical=False, resolve=None):
    need("ffmpeg")
    src = resolve(root, source)
    if not os.path.isfile(src):
        raise ClipError("Source video not found.")
    segs = validate_segments(segments)
    outdir = os.path.join(root, "clips")
    made = []
    for a, b, name in segs:
        dst = os.path.join(outdir, name + ".mp4")
        _run(cut_cmd(src, dst, a, b, bool(vertical)), 600)
        made.append("clips/%s.mp4" % name)
    return {"clips": made}
