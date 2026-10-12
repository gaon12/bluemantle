import json
import sys
import tempfile
import unittest
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "scripts"))
from vocabulary import deduplicate, prepare_pack


class VocabularyTests(unittest.TestCase):
    def test_bom_blank_lines_case_unicode_and_spacing_duplicates(self):
        words, terms, report = deduplicate("\ufeff아로나\r\n\r\n아로나 \nＡＲＯＮＡ\n arona\n싯딤의 상자\n싯딤의상자\n")
        self.assertEqual(words, ["아로나", "ARONA", "싯딤의 상자"])
        self.assertEqual(report["duplicatesRemoved"], 3)
        self.assertEqual(len(terms), 3)

    def test_known_aliases_collapse_to_one_canonical_term(self):
        catalog = [{"id": "arona", "label": "아로나", "aliases": ["Arona"], "description": "인공지능", "category": "npc"}]
        words, terms, report = deduplicate("Arona\n아로나\nARONA\n선생님", catalog)
        self.assertEqual(words, ["아로나", "선생님"])
        self.assertEqual(report["duplicatesRemoved"], 2)
        self.assertEqual(next(t for t in terms if t["id"] == "arona")["description"], "인공지능")

    def test_costume_variants_and_plus_are_distinct(self):
        words, _, _ = deduplicate("시로코\n시로코(수영복)\n시로코(라이딩)\n스킬\n스킬+")
        self.assertEqual(len(words), 5)

    def test_meme_spelling_aliases_deduplicate_without_collapsing_student_names(self):
        catalog = [
            {"id": "meme-molu", "label": "몰?루", "aliases": ["몰루", "몰?루!"], "category": "meme"},
            {"id": "meme-aru", "label": "아!루", "aliases": ["아!루!"], "category": "meme"},
            {"id": "student-aru", "label": "아루", "aliases": [], "category": "student"},
        ]
        words, terms, report = deduplicate('몰루\n몰？루\n몰?루!\n아!루\n아！루!\n아루', catalog)
        self.assertEqual(words, ['몰?루', '아!루', '아루'])
        self.assertEqual(report['duplicatesRemoved'], 3)
        self.assertEqual(len({term['id'] for term in terms}), 3)

    def test_ambiguous_alias_does_not_select_an_arbitrary_owner(self):
        catalog = [
            {"id": "a", "label": "첫 학생", "aliases": ["학생"]},
            {"id": "b", "label": "다른 학생", "aliases": ["학생"]},
        ]
        words, terms, _ = deduplicate("학생\n첫 학생\n다른 학생", catalog)
        self.assertEqual(len(words), 3)
        self.assertTrue(all("학생" not in t["aliases"] for t in terms))

    def test_invalid_or_single_word_vocabulary_fails_before_model_loading(self):
        with self.assertRaises(ValueError): deduplicate("아로나\n아로나")
        with self.assertRaisesRegex(ValueError, "line 2"): deduplicate("아로나\n" + "가" * 121)

    def test_txt_only_pack_prepares_metadata_and_is_idempotent(self):
        with tempfile.TemporaryDirectory() as directory:
            pack = Path(directory)
            manifest = {"terms": "terms.json", "categories": {}, "vocabulary": "words.txt"}
            (pack / "manifest.json").write_text(json.dumps(manifest), encoding="utf-8")
            (pack / "words.txt").write_text("아로나\n선생님\n아로나\n", encoding="utf-8")
            _, first, report, first_hash = prepare_pack(pack)
            self.assertEqual(report["duplicatesRemoved"], 1)
            self.assertEqual((pack / "words.txt").read_text(encoding="utf-8"), "아로나\n선생님\n")
            before = (pack / "terms.json").read_bytes()
            _, second, report, second_hash = prepare_pack(pack)
            self.assertEqual(before, (pack / "terms.json").read_bytes())
            self.assertEqual(first, second)
            self.assertEqual(first_hash, second_hash)
            self.assertEqual(report["duplicatesRemoved"], 0)

    def test_fresh_catalog_context_overrides_previous_generated_metadata(self):
        with tempfile.TemporaryDirectory() as directory:
            pack = Path(directory)
            (pack / "manifest.json").write_text(json.dumps({"terms": "terms.json", "categories": {"npc": "인물"}}), encoding="utf-8")
            old = {"id": "arona", "label": "아로나", "category": "npc", "description": "예전 정보"}
            (pack / "terms.json").write_text(json.dumps([old, {"id": "sensei", "label": "선생님", "category": "npc", "description": "선생님"}]), encoding="utf-8")
            (pack / "catalog.json").write_text(json.dumps([{**old, "description": "최신 정보"}]), encoding="utf-8")
            _, terms, _, _ = prepare_pack(pack)
            self.assertEqual(next(t for t in terms if t["id"] == "arona")["description"], "최신 정보")


if __name__ == "__main__": unittest.main()
