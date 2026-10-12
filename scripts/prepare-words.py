"""Deduplicate a one-word-per-line TXT and prepare its game vocabulary, without a model."""
import argparse
import json
from vocabulary import prepare_pack, resolve_pack

parser = argparse.ArgumentParser(description=__doc__)
parser.add_argument("pack", nargs="?", help="Pack directory or vocabulary TXT; optional with one active pack")
args = parser.parse_args()
try:
    directory, words = resolve_pack(args.pack)
    _, _, report, _ = prepare_pack(directory, words)
    print(json.dumps(report, ensure_ascii=False))
except (ValueError, OSError, KeyError) as error:
    parser.exit(1, f"{error}\n")
