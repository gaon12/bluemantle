"""Build a broad Korean vocabulary; the game engine never imports this module."""
import argparse
import hashlib
import html
import json
import re
import shutil
import subprocess
import sys
import unicodedata
import urllib.request
from collections import Counter
from pathlib import Path
from datetime import datetime, timezone
from concurrent.futures import ThreadPoolExecutor
from vocabulary import deduplicate, prepare_pack, write_atomic, json_bytes

ROOT = Path(__file__).resolve().parents[1]


def download_json(url):
    # Bound the whole transfer; urllib's per-read timeout can leave a download hanging.
    executable = shutil.which('curl.exe' if sys.platform == 'win32' else 'curl')
    if executable:
        result = subprocess.run([
            executable, '--fail', '--silent', '--show-error', '--location', '--compressed',
            '--connect-timeout', '10', '--max-time', '180',
            '--user-agent', 'bluemantle-data-import/0.1', url,
        ], capture_output=True, timeout=190,
            creationflags=subprocess.CREATE_NO_WINDOW if sys.platform == 'win32' else 0)
        if result.returncode:
            raise RuntimeError(f"Download failed: {url}: {result.stderr.decode('utf-8', errors='replace').strip()}")
        raw = result.stdout
    else:
        request = urllib.request.Request(url, headers={'User-Agent': 'bluemantle-data-import/0.1'})
        with urllib.request.urlopen(request, timeout=30) as response:
            raw = response.read()
    json.loads(raw)
    return raw


def normalize(value):
    return re.sub(r"[\s·・._-]+", "", unicodedata.normalize("NFKC", value).lower())


def clean(value):
    value = str(value or "").replace("\\n", " ")
    value = re.sub(r"<\?\d+>", "", value)
    value = re.sub(r"<[^>]*>", "", value)
    return re.sub(r"\s+", " ", html.unescape(value)).strip()


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--pack", type=Path, default=ROOT / "data/packs/blue-archive")
    parser.add_argument("--base-url", default="https://schaledb.com/data")
    parser.add_argument("--region", default="kr")
    parser.add_argument("--repository", help="Optional archived repository for explicitly requested snapshots")
    parser.add_argument("--ref", default="main")
    parser.add_argument("--include-unreleased", action="store_true")
    parser.add_argument("--offline", action="store_true")
    args = parser.parse_args()
    pack = args.pack.resolve()
    cache = ROOT / "data/cache" / (hashlib.sha256(f"{args.repository}:{args.ref}".encode()).hexdigest()[:12] if args.repository else f"live-{args.region}")
    cache.mkdir(parents=True, exist_ok=True)
    sources = []

    def fetch(name):
        url = f"https://raw.githubusercontent.com/{args.repository}/{args.ref}/data/{args.region}/{name}.json" if args.repository else f"{args.base_url.rstrip('/')}/{args.region}/{name}.min.json"
        target = cache / f"{name}.json"
        if not args.offline or not target.exists():
            if args.offline:
                raise SystemExit(f"Missing offline source: {target}")
            print(f"Fetching {name}...", flush=True)
            raw = download_json(url)
            write_atomic(target, raw)
            print(f"Fetched {name}: {len(raw):,} bytes", flush=True)
        raw = target.read_bytes()
        sources.append({"id": f"schaledb:{name}", "url": url, "sha256": hashlib.sha256(raw).hexdigest(), "retrievedAt": datetime.fromtimestamp(target.stat().st_mtime, timezone.utc).isoformat()})
        return json.loads(raw)

    filenames = ["students", "localization", "items", "equipment", "furniture"]
    with ThreadPoolExecutor(max_workers=5) as pool:
        datasets = dict(zip(filenames, pool.map(fetch, filenames)))
    def rows(data):
        return list(data.values()) if isinstance(data, dict) else data
    students, localization = rows(datasets["students"]), datasets["localization"]
    if not args.include_unreleased:
        students = [s for s in students if len(s.get("IsReleased", [])) > 1 and s["IsReleased"][1]]
    records = {}

    def add(label, category, description, aliases=(), source="bluemantle-editorial", answer=True):
        label, description = clean(label), clean(description)
        if not label or not description or label in {"없음", "그 외"}:
            return
        key = normalize(label)
        record = records.setdefault(key, {
            "id": f"{category}-{hashlib.sha256(key.encode()).hexdigest()[:16]}",
            "label": label, "category": category, "aliases": [],
            "description": "", "answer": bool(answer), "sources": [],
        })
        if description not in record["description"]:
            # Repeated skill/item names share one vocabulary entry, with bounded context.
            record["description"] = clean(record["description"] + " " + description)[:1800]
        record["aliases"] = sorted(set(record["aliases"] + [clean(a) for a in aliases if clean(a)]))
        record["answer"] = record["answer"] or bool(answer)
        if source not in record["sources"]:
            record["sources"].append(source)

    curated = json.loads((pack / "curated.json").read_text(encoding="utf-8"))
    for term in curated["terms"]:
        add(**term)
    editorial_sources = [{"id": "bluemantle-editorial", "path": "curated.json", "sha256": hashlib.sha256((pack / 'curated.json').read_bytes()).hexdigest()}]
    memes_path = pack / 'memes.json'
    if memes_path.exists():
        memes = json.loads(memes_path.read_text(encoding='utf-8'))
        for term in memes['terms']:
            references = term.get('references', [])
            if any(reference not in memes.get('references', {}) for reference in references):
                raise ValueError(f"Unknown meme reference: {term['label']}")
            add(**{key: value for key, value in term.items() if key != 'references'}, source=memes['source'])
        editorial_sources.append({"id": memes['source'], "path": 'memes.json', "sha256": hashlib.sha256(memes_path.read_bytes()).hexdigest(), "references": memes.get('references', {})})

    school_names = localization["SchoolLong"]
    club_names = localization["Club"]
    for code, label in school_names.items():
        members = [s["Name"] for s in students if s["School"] == code][:12]
        if members:
            add(label, "school", f"키보토스의 학원. 소속 학생: {', '.join(members)}.",
                [localization.get("School", {}).get(code, label), code], "schaledb:localization")
    for code, label in club_names.items():
        members = [s["Name"] for s in students if s["Club"] == code]
        schools = sorted({school_names.get(s["School"], "") for s in students if s["Club"] == code})
        if members and code != "EmptyClub":
            add(label, "club", f"{' '.join(schools)}의 학생 조직. 소속 학생: {', '.join(members[:12])}.",
                [code], "schaledb:localization")

    for student in students:
        label = student["Name"]
        school = school_names.get(student["School"], student["School"])
        club = club_names.get(student["Club"], student["Club"])
        # The descriptions supply domain context, including obscure proper nouns.
        description = f"{school} 소속 학생. 동아리: {club}. 취미: {clean(student.get('Hobby'))}. {clean(student.get('ProfileIntroduction'))}"
        aliases = [student.get("FamilyName", "") + " " + label]
        if "(" not in label:
            aliases.append(student.get("PathName", ""))
        add(label, "student", description, aliases, "schaledb:students")
        for skill in rows(student.get("Skills", [])):
            if skill.get("Name") and not skill["Name"].endswith("+"):
                add(skill["Name"], "skill", f"{label}의 {skill.get('SkillType', '')} 스킬. {clean(skill.get('Desc'))}", source="schaledb:students")
        weapon = student.get("Weapon", {})
        if isinstance(weapon, dict) and weapon.get("Name"):
            add(weapon["Name"], "weapon", f"{label}의 고유무기. {clean(weapon.get('Desc'))}", source="schaledb:students")

    for filename, category in [("items", "item"), ("equipment", "equipment"), ("furniture", "furniture")]:
        for record in rows(datasets[filename]):
            if not args.include_unreleased and record.get("IsReleased") and not record["IsReleased"][1]:
                continue
            label, description = record.get("Name"), clean(record.get("Desc"))
            if label and description:
                add(label, category, description, source=f"schaledb:{filename}")

    for label in localization.get("EventName", {}).values():
        if isinstance(label, str):
            add(label, "event", f"블루 아카이브의 이벤트 이름. {label}의 이야기와 학생, 이벤트 임무에 관련된다.", source="schaledb:localization")

    # Canonical labels win; ambiguous aliases are discarded instead of silently picking a term.
    owners = {}
    for key, record in records.items():
        for alias in record["aliases"]:
            owners.setdefault(normalize(alias), set()).add(key)
    for key, record in records.items():
        record["aliases"] = [alias for alias in record["aliases"]
                             if normalize(alias) != key
                             and (normalize(alias) not in records)
                             and len(owners[normalize(alias)]) == 1]
    terms = sorted(records.values(), key=lambda r: r["id"])
    write_atomic(pack / "catalog.json", json_bytes(terms))
    manifest_path = pack / "manifest.json"
    manifest = json.loads(manifest_path.read_text(encoding="utf-8"))
    retrieved_date = min(source["retrievedAt"][:10] for source in sources)
    source_hash = hashlib.sha256(''.join(source["sha256"] for source in sorted(sources + editorial_sources, key=lambda s: s["id"])).encode()).hexdigest()[:8]
    manifest.update({"vocabulary": "words.txt", "catalog": "catalog.json", "dataAsOf": retrieved_date, "version": f"{retrieved_date}.{source_hash}"})
    manifest["categories"]["event"] = "이벤트"
    write_atomic(manifest_path, json_bytes(manifest))
    words_path = pack / "words.txt"
    existing = words_path.read_text(encoding="utf-8-sig") if words_path.exists() else ""
    words, _, _ = deduplicate(existing + "\n" + "\n".join(t["label"] for t in terms), terms)
    write_atomic(words_path, ("\n".join(words) + "\n").encode())
    _, prepared, report, _ = prepare_pack(pack)
    (pack / "sources.json").write_text(json.dumps({
        "service": args.base_url if not args.repository else args.repository,
        "region": args.region, "dataAsOf": retrieved_date,
        "ref": args.ref if args.repository else None,
        "note": "현재 운영 중인 SchaleDB 한국어 데이터를 수집합니다. 기본 학생/아이템 범위는 글로벌 서버 출시 기준이며, 기존 TXT의 직접 추가 용어도 보존합니다.",
        "rights": "Game text and data belong to their respective rights holders. They are not covered by the engine's MIT license.",
        "sources": sorted(sources, key=lambda s: s["id"]) + editorial_sources,
    }, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    print(json.dumps({"terms": len(prepared), "categories": dict(Counter(t["category"] for t in prepared)), "dataAsOf": retrieved_date, "duplicatesRemoved": report["duplicatesRemoved"]}, ensure_ascii=False))


if __name__ == "__main__":
    main()
