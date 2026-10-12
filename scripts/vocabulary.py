"""Plain-text vocabulary preparation shared by every topic and embedding model."""
import hashlib
import json
import os
import re
import unicodedata
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]


def normalize(value):
    return re.sub(r"[\s·・._-]+", "", unicodedata.normalize("NFKC", value).lower())


def clean_word(value):
    return re.sub(r"\s+", " ", unicodedata.normalize("NFKC", value)).strip()


def write_atomic(path, content):
    temporary = path.with_suffix(path.suffix + ".tmp")
    temporary.write_bytes(content)
    os.replace(temporary, path)


def json_bytes(value):
    return (json.dumps(value, ensure_ascii=False, indent=2) + "\n").encode("utf-8")


def resolve_pack(argument=None):
    if argument:
        target = Path(argument).resolve()
        return (target.parent, target) if target.suffix.lower() == ".txt" else (target, None)
    packs = list((ROOT / "data/packs").glob("*/manifest.json"))
    if len(packs) != 1:
        raise ValueError("Specify a pack directory or its vocabulary TXT file")
    return packs[0].parent, None


def deduplicate(text, catalog=()):
    """Keep the first canonical spelling; collapse aliases only when unambiguous."""
    canonical, alias_owners = {}, {}
    for entry in catalog:
        key = normalize(entry["label"])
        canonical[key] = entry
    for key, entry in canonical.items():
        for alias in entry.get("aliases", []):
            alias_owners.setdefault(normalize(alias), set()).add(key)
    lookup = dict(canonical)
    for alias, owners in alias_owners.items():
        if alias not in lookup and len(owners) == 1:
            lookup[alias] = canonical[next(iter(owners))]

    seen, words, terms = set(), [], []
    inputs = 0
    for line_number, line in enumerate(text.lstrip("\ufeff").splitlines(), 1):
        word = clean_word(line)
        if not word:
            continue
        inputs += 1
        if len(word) > 120 or not normalize(word):
            raise ValueError(f"Invalid word on line {line_number}: use 1–120 characters")
        metadata = lookup.get(normalize(word), {})
        label = clean_word(metadata.get("label", word))
        key = normalize(label)
        if key in seen:
            continue
        seen.add(key)
        words.append(label)
        terms.append({
            "id": metadata.get("id") or "term-" + hashlib.sha256(key.encode()).hexdigest()[:16],
            "label": label,
            "aliases": list(dict.fromkeys(metadata.get("aliases", []) + ([word] if normalize(word) != key else []))),
            "category": metadata.get("category", "misc"),
            "description": metadata.get("description") or label,
            "answer": metadata.get("answer", True),
            "sources": metadata.get("sources", []),
        })
    if len(terms) < 2:
        raise ValueError("The TXT vocabulary must contain at least two unique words")
    if len({t["id"] for t in terms}) != len(terms):
        raise ValueError("Catalog contains duplicate IDs for different terms")
    # An alias must never shadow another explicit TXT word.
    owners = {}
    label_keys = {normalize(t["label"]) for t in terms}
    for term in terms:
        for alias in term["aliases"]:
            owners.setdefault(normalize(alias), set()).add(term["id"])
    for term in terms:
        term["aliases"] = sorted(set(a for a in term["aliases"]
            if normalize(a) not in label_keys and len(owners[normalize(a)]) == 1))
    return words, sorted(terms, key=lambda t: t["id"]), {"inputLines": inputs, "uniqueWords": len(words), "duplicatesRemoved": inputs - len(words)}


def prepare_pack(pack, vocabulary_path=None):
    pack = Path(pack).resolve()
    manifest_path = pack / "manifest.json"
    manifest = json.loads(manifest_path.read_text(encoding="utf-8"))
    words_path = vocabulary_path or pack / manifest.get("vocabulary", "words.txt")
    if words_path.parent.resolve() != pack:
        raise ValueError("The vocabulary TXT must be inside its data pack directory")
    manifest["vocabulary"] = words_path.name
    terms_path = pack / manifest["terms"]
    metadata = json.loads(terms_path.read_text(encoding="utf-8")) if terms_path.exists() else []
    catalog_path = pack / manifest.get("catalog", "catalog.json")
    if catalog_path.exists():
        # Freshly imported metadata replaces old generated descriptions.
        metadata.extend(json.loads(catalog_path.read_text(encoding="utf-8")))
    if not words_path.exists():
        if not terms_path.exists():
            raise ValueError(f"Create {words_path.name} with one word per line first")
        original = json.loads(terms_path.read_text(encoding="utf-8"))
        write_atomic(words_path, ("\n".join(t["label"] for t in original) + "\n").encode())
    words, terms, report = deduplicate(words_path.read_text(encoding="utf-8-sig"), metadata)
    for term in terms:
        manifest["categories"].setdefault(term["category"], "기타 용어")
    raw_words = ("\n".join(words) + "\n").encode("utf-8")
    write_atomic(words_path, raw_words)
    write_atomic(terms_path, json_bytes(terms))
    write_atomic(manifest_path, json_bytes(manifest))
    return manifest, terms, report, hashlib.sha256(raw_words).hexdigest()
